#!/usr/bin/env python3
"""Team-wide target allocation challenger over the expected-role foundation."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
FOUNDATION_SCRIPT = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
DEFAULT_FOUNDATION = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_r1.json"
DEFAULT_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_team_target_allocation_r1.json"
DEFAULT_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_team_target_allocation_2026_projections_r1.parquet"
RECEIVING = ("receptions", "receiving_yards")
INCREMENT_WEIGHTS = (0.25, 0.50, 0.75, 1.0)


def load(name: str, path: pathlib.Path) -> Any:
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def team_target_components(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    team_features: list[str],
    player_features: list[str],
    test_rows: dict[str, pd.DataFrame],
    known_active_row_ids: set[str] | None = None,
) -> dict[str, np.ndarray]:
    outputs: dict[str, np.ndarray] = {}
    for market, numerator, upper in (
        ("receptions", "receptions", 1.0),
        ("receiving_yards", "receiving_yards", 30.0),
    ):
        test = test_rows[market]
        budget = foundation.budget_prediction(
            teams, season, team_features, "team_targets", test[["game_id", "team"]],
        )
        share = foundation.normalized_team_target_share_prediction(
            frame, season, player_features, test, known_active_row_ids,
        )
        opportunity = np.clip(budget * share, 0.0, None)
        prediction = np.zeros(len(test), dtype=float)
        for group in sorted(test["expected_role_group"].unique()):
            mask = test["expected_role_group"].eq(group).to_numpy()
            subset = test.loc[mask]
            rate = foundation.rate_prediction(
                frame, season, player_features, numerator, "targets",
                group, subset, 0.0, upper,
            )
            prediction[mask] = opportunity[mask] * rate
        outputs[market] = prediction
    return outputs


def synthetic_component(
    foundation_component: np.ndarray,
    challenger_component: np.ndarray,
    foundation_weight: float,
    increment_weight: float,
) -> tuple[np.ndarray, float]:
    total_weight = 1.0 - (1.0 - increment_weight) * (1.0 - foundation_weight)
    component = (
        (1.0 - increment_weight) * foundation_weight * foundation_component
        + increment_weight * challenger_component
    ) / total_weight
    return component, total_weight


def foundation_weight_for_market(projections: pd.DataFrame, market: str) -> float:
    weights = projections.loc[
        projections["market"].eq(market), "frozen_blend_weight"
    ].dropna().unique()
    if len(weights) != 1:
        raise RuntimeError(
            f"expected one frozen foundation weight for {market}, found {weights.tolist()}"
        )
    weight = float(weights[0])
    if not 0.0 < weight <= 1.0:
        raise RuntimeError(f"invalid frozen foundation weight for {market}: {weight}")
    return weight


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation", type=pathlib.Path, default=DEFAULT_FOUNDATION)
    parser.add_argument("--replay", type=pathlib.Path, default=DEFAULT_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--projections", type=pathlib.Path, default=DEFAULT_PROJECTIONS)
    args = parser.parse_args()

    foundation = load("props_team_target_foundation", FOUNDATION_SCRIPT)
    availability = foundation.load_module(
        "props_team_target_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py",
    )
    external = foundation.load_module(
        "props_team_target_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    foundation_payload = json.loads(args.foundation.read_text(encoding="utf-8"))
    foundation_projection_path = pathlib.Path(foundation_payload["projectionFile"])
    if foundation.sha256_file(foundation_projection_path) != foundation_payload["projectionFileSha256"]:
        raise RuntimeError("foundation projection checksum mismatch")
    projections = pd.read_parquet(foundation_projection_path)

    manifest = json.loads(foundation.DEFAULT_EXTERNAL_MANIFEST.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("external feature checksum mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    feature_groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        feature_groups["base"].append(column)
    feature_groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("receiving_yards", feature_groups)["full_external"],
        *feature_groups.get("depth", []),
        *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [
        name for name in [*feature_groups["base"], *feature_groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    numeric = list(dict.fromkeys([*player_features, *team_features]))
    frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)

    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in RECEIVING}
    foundation_points: dict[str, dict[int, np.ndarray]] = {market: {} for market in RECEIVING}
    foundation_components: dict[str, dict[int, np.ndarray]] = {market: {} for market in RECEIVING}
    team_components: dict[str, dict[int, np.ndarray]] = {market: {} for market in RECEIVING}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in RECEIVING}

    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        print(f"team-target season {season}...", flush=True)
        test_rows: dict[str, pd.DataFrame] = {}
        for market in RECEIVING:
            base = projections[projections["market"].eq(market) & projections["phase"].eq(phase)].copy()
            test_rows[market] = by_row.loc[base["row_id"]].copy()
            actual[market][season] = base["actual"].to_numpy(float)
            foundation_points[market][season] = base["candidate_projection"].to_numpy(float)
            foundation_components[market][season] = base["component_projection"].to_numpy(float)
        calculated = team_target_components(
            foundation, frame, teams, season, team_features, player_features, test_rows,
        )
        for market in RECEIVING:
            team_components[market][season] = calculated[market]
            for weight in INCREMENT_WEIGHTS:
                name = f"team_target_increment_{int(weight * 100)}"
                candidates[market].setdefault(name, {})[season] = np.clip(
                    (1.0 - weight) * foundation_points[market][season] + weight * calculated[market],
                    0.0, None,
                )

    report: dict[str, Any] = {}
    frozen_increment: dict[str, float] = {}
    for market in RECEIVING:
        selection_reference = foundation.point_metrics(actual[market][2024], foundation_points[market][2024])
        selection_candidates = {
            name: foundation.point_metrics(actual[market][2024], values[2024])
            for name, values in candidates[market].items()
        }
        selectable = [
            name for name, metrics in selection_candidates.items()
            if float(metrics["mae"]) < float(selection_reference["mae"])
            and float(metrics["rmse"]) < float(selection_reference["rmse"])
        ]
        selected = min(selectable, key=lambda name: (
            float(selection_candidates[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_candidates[name]["rmse"]) / float(selection_reference["rmse"])
        )) if selectable else None
        confirmation_reference = foundation.point_metrics(actual[market][2025], foundation_points[market][2025])
        confirmation_candidate = (
            foundation.point_metrics(actual[market][2025], candidates[market][selected][2025])
            if selected else None
        )
        confirmed = bool(
            selected and confirmation_candidate
            and float(confirmation_candidate["mae"]) <= float(confirmation_reference["mae"])
            and float(confirmation_candidate["rmse"]) <= float(confirmation_reference["rmse"])
        )
        frozen_increment[market] = int(selected.rsplit("_", 1)[-1]) / 100.0 if confirmed and selected else 0.0
        report[market] = {
            "selection": {"foundation": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"foundation": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "frozenIncrementWeight": frozen_increment[market],
        }

    replay = pd.DataFrame(json.loads(args.replay.read_text(encoding="utf-8"))["rows"])
    offered = replay[replay["market"].isin(RECEIVING)][["week", "playerName", "team", "market"]].copy()
    offered["normalized_player"] = offered["playerName"].map(foundation.normalize_player)
    offered = offered.drop_duplicates(["week", "team", "market", "normalized_player"])
    current = frame[frame["season"].eq(2026)].copy()
    current["normalized_player"] = current["player_name"].map(foundation.normalize_player)
    offered_rows: dict[str, pd.DataFrame] = {}
    for market in RECEIVING:
        offered_rows[market] = offered[offered["market"].eq(market)].merge(
            current, on=["week", "team", "normalized_player"], how="left", validate="one_to_one",
        )
        if offered_rows[market]["row_id"].isna().any():
            raise RuntimeError(f"unmatched offered rows for {market}")
    known_active = {str(value) for rows in offered_rows.values() for value in rows["row_id"]}
    locked_team_components = team_target_components(
        foundation, frame, teams, 2026, team_features, player_features, offered_rows, known_active,
    )

    output_projections = projections.copy()
    frozen_candidates = {market: "foundation" for market in foundation.MARKETS}
    for market in RECEIVING:
        increment = frozen_increment[market]
        frozen_candidates[market] = (
            f"team_target_increment_{int(increment * 100)}" if increment > 0 else "foundation"
        )
        foundation_weight = foundation_weight_for_market(projections, market)
        for season, phase in ((2024, "selection"), (2025, "confirmation")):
            mask = output_projections["market"].eq(market) & output_projections["phase"].eq(phase)
            if increment > 0:
                output_projections.loc[mask, "released_projection"] = foundation_points[market][season]
                output_projections.loc[mask, "candidate_projection"] = (
                    (1.0 - increment) * foundation_points[market][season]
                    + increment * team_components[market][season]
                )
                component, total_weight = synthetic_component(
                    foundation_components[market][season], team_components[market][season],
                    foundation_weight, increment,
                )
                output_projections.loc[mask, "component_projection"] = component
                output_projections.loc[mask, "frozen_blend_weight"] = total_weight
                output_projections.loc[mask, "candidate_name"] = frozen_candidates[market]
        locked_mask = output_projections["market"].eq(market) & output_projections["phase"].eq("locked_replay")
        locked = output_projections.loc[locked_mask]
        component_by_row = pd.Series(
            locked_team_components[market], index=offered_rows[market]["row_id"],
        )
        challenger = component_by_row.reindex(locked["row_id"]).to_numpy(float)
        if increment > 0:
            component, total_weight = synthetic_component(
                locked["component_projection"].to_numpy(float), challenger,
                foundation_weight, increment,
            )
            output_projections.loc[locked_mask, "component_projection"] = component
            output_projections.loc[locked_mask, "frozen_blend_weight"] = total_weight
            output_projections.loc[locked_mask, "candidate_name"] = frozen_candidates[market]

    args.projections.parent.mkdir(parents=True, exist_ok=True)
    output_projections.to_parquet(args.projections, index=False)
    payload = {
        "release": "nfl_player_props_team_target_allocation_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "foundationRelease": foundation_payload["release"],
        "chronology": foundation_payload["chronology"],
        "injurySources": injury_metadata,
        "projectionFile": str(args.projections.resolve()),
        "projectionFileSha256": foundation.sha256_file(args.projections),
        "frozenCandidates": frozen_candidates,
        "markets": report,
    }
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "frozenCandidates": frozen_candidates, "markets": report}, indent=2))


if __name__ == "__main__":
    main()
