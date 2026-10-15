#!/usr/bin/env python3
"""Research-only completion-budget allocation tournament for Receptions."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier


ROOT = pathlib.Path(__file__).resolve().parents[2]
FOUNDATION = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
RECEPTIONS_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_rows_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_through_week_5_r2.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_completion_allocation_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_completion_allocation_rows_r1.parquet"
WEIGHTS = (0.25, 0.50, 0.75)
SEED = 20261015


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = np.asarray(prediction, dtype=float) - np.asarray(actual, dtype=float)
    return {
        "rows": int(len(error)), "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))), "bias": float(np.mean(error)),
    }


def direction(actual: np.ndarray, prediction: np.ndarray, line: np.ndarray) -> float:
    return float(np.mean(np.sign(prediction - line) == np.sign(actual - line)))


def stability(frame: pd.DataFrame, candidate: str) -> dict[str, Any]:
    values = frame.copy()
    values["delta"] = np.abs(values[candidate] - values["actual"]) - np.abs(values["incumbent"] - values["actual"])
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    random = np.random.default_rng(SEED)
    draws = np.empty(4000)
    for index in range(len(draws)):
        sample = grouped[random.integers(0, len(grouped), len(grouped))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    lower, median, upper = np.quantile(draws, [0.025, 0.5, 0.975])
    segments = {}
    for start, end in ((1, 4), (5, 9), (10, 13), (14, 18)):
        segment = values[values["week"].between(start, end)]
        segments[f"weeks_{start}_{end}"] = {"rows": int(len(segment)), "maeDelta": float(segment["delta"].mean())}
    return {
        "gameClusters": int(len(grouped)), "lower": float(lower), "median": float(median), "upper": float(upper),
        "segments": segments, "passes": bool(upper < 0 and all(value["maeDelta"] <= 0 for value in segments.values())),
    }


def reception_share_prediction(
    foundation: Any,
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    test: pd.DataFrame,
    known_active_row_ids: set[str] | None,
) -> np.ndarray:
    receiver_groups = {"BACK", "WR", "TE"}
    population = frame[frame["season"].lt(season) & frame["expected_role_group"].isin(receiver_groups)].copy()
    active = population[population["participated"].eq(1)].copy()
    share_model = foundation.model("squared_error").fit(
        active[features], active["expected_team_reception_share"].fillna(0.0).to_numpy(float),
    )
    participation_model = HistGradientBoostingClassifier(
        max_iter=140, max_leaf_nodes=15, learning_rate=0.04, min_samples_leaf=35,
        l2_regularization=12.0, random_state=foundation.SEED,
    ).fit(population[features], population["participated"].to_numpy(int))
    roster = frame[
        frame["season"].eq(season)
        & frame["expected_role_group"].isin(receiver_groups)
        & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
    ].copy()
    participation = np.asarray(participation_model.predict_proba(roster[features])[:, 1], dtype=float)
    active_ids = known_active_row_ids if known_active_row_ids is not None else set(test["row_id"])
    participation[roster["row_id"].isin(active_ids).to_numpy()] = 1.0
    raw_share = np.clip(np.asarray(share_model.predict(roster[features]), dtype=float), 0.0, 1.0) * participation
    roster["raw_share"] = raw_share
    denominator = roster.groupby(["game_id", "team"], observed=True)["raw_share"].transform("sum")
    roster["normalized_share"] = np.where(denominator.gt(0), roster["raw_share"] / denominator, 0.0)
    by_row = roster.set_index("row_id")["normalized_share"]
    values = by_row.reindex(test["row_id"]).to_numpy(float)
    missing = np.isnan(values)
    if missing.any():
        values[missing] = np.clip(np.asarray(share_model.predict(test.loc[missing, features]), dtype=float), 0.0, 1.0)
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receptions-rows", type=pathlib.Path, default=RECEPTIONS_ROWS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()
    foundation = load("receptions_completion_foundation", FOUNDATION)
    external = foundation.load_module(
        "receptions_completion_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    availability = foundation.load_module(
        "receptions_completion_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py",
    )
    manifest = json.loads(foundation.DEFAULT_EXTERNAL_MANIFEST.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    team_receptions = frame.groupby(["season", "week", "game_id", "team"], observed=True)["receptions"].transform("sum")
    frame["expected_team_reception_share"] = np.where(team_receptions.gt(0), frame["receptions"] / team_receptions, 0.0)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("receiving_yards", groups)["full_external"],
        *groups.get("depth", []), *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    frame[list(dict.fromkeys([*player_features, *team_features]))] = frame[
        list(dict.fromkeys([*player_features, *team_features]))
    ].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    completions = frame.groupby(["season", "week", "game_id", "team"], observed=True, as_index=False).agg(
        team_completions=("passing_completions", "sum"),
    )
    teams = teams.merge(completions, on=["season", "week", "game_id", "team"], how="left", validate="one_to_one")
    by_row = frame.set_index("row_id", drop=False)

    def component(test: pd.DataFrame, season: int, active_ids: set[str] | None = None) -> np.ndarray:
        budget = foundation.budget_prediction(
            teams, season, team_features, "team_completions", test[["game_id", "team"]],
        )
        share = reception_share_prediction(foundation, frame, season, player_features, test, active_ids)
        return np.clip(budget * share, 0.0, None)

    source = pd.read_parquet(args.receptions_rows)
    reports: dict[str, Any] = {}
    output_rows: list[pd.DataFrame] = []
    phase_values: dict[str, pd.DataFrame] = {}
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        base = source[source["phase"].eq(phase)].copy()
        test = by_row.loc[base["row_id"]].reset_index(drop=True)
        base = base.reset_index(drop=True)
        base["incumbent"] = base["candidate_projection"].to_numpy(float)
        base["challenger"] = component(test, season)
        for weight in WEIGHTS:
            base[f"blend_{int(weight * 100)}"] = (
                (1.0 - weight) * base["incumbent"] + weight * base["challenger"]
            )
        phase_values[phase] = base
        output_rows.append(base)
        reports[phase] = {
            "incumbent": metrics(base["actual"].to_numpy(float), base["incumbent"].to_numpy(float)),
            "candidates": {
                f"blend_{int(weight * 100)}": metrics(base["actual"].to_numpy(float), base[f"blend_{int(weight * 100)}"].to_numpy(float))
                for weight in WEIGHTS
            },
        }
    selectable = [
        name for name, result in reports["selection"]["candidates"].items()
        if result["mae"] < reports["selection"]["incumbent"]["mae"]
        and result["rmse"] < reports["selection"]["incumbent"]["rmse"]
    ]
    selected = min(selectable, key=lambda name: (
        reports["selection"]["candidates"][name]["mae"] / reports["selection"]["incumbent"]["mae"]
        + reports["selection"]["candidates"][name]["rmse"] / reports["selection"]["incumbent"]["rmse"]
    )) if selectable else None
    confirmation_stability = stability(phase_values["confirmation"], selected) if selected else None
    confirmed = bool(
        selected
        and reports["confirmation"]["candidates"][selected]["mae"] <= reports["confirmation"]["incumbent"]["mae"]
        and reports["confirmation"]["candidates"][selected]["rmse"] <= reports["confirmation"]["incumbent"]["rmse"]
        and confirmation_stability and confirmation_stability["passes"]
    )
    frozen = selected if confirmed else None

    current = source[source["phase"].eq("locked_replay")].reset_index(drop=True).copy()
    test = by_row.loc[current["row_id"]].reset_index(drop=True)
    current["incumbent"] = current["candidate_projection"].to_numpy(float)
    current["challenger"] = component(test, 2026, set(test["row_id"].astype(str)))
    for weight in WEIGHTS:
        current[f"blend_{int(weight * 100)}"] = (
            (1.0 - weight) * current["incumbent"] + weight * current["challenger"]
        )
    replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("receptions")].copy()
    replay["normalized_player"] = replay["playerName"].map(foundation.normalize_player)
    current["normalized_player"] = current["player_name"].map(foundation.normalize_player)
    if "line" not in current:
        current = current.merge(
            replay[["week", "team", "normalized_player", "line"]],
            on=["week", "team", "normalized_player"], how="left", validate="one_to_one",
        )
    if current["line"].isna().any():
        raise RuntimeError("exact Receptions line did not match")
    current_report = {
        "incumbent": metrics(current["actual"].to_numpy(float), current["incumbent"].to_numpy(float)),
        "candidate": metrics(current["actual"].to_numpy(float), current[frozen].to_numpy(float)) if frozen else None,
        "incumbentDirection": direction(current["actual"].to_numpy(float), current["incumbent"].to_numpy(float), current["line"].to_numpy(float)),
        "candidateDirection": direction(current["actual"].to_numpy(float), current[frozen].to_numpy(float), current["line"].to_numpy(float)) if frozen else None,
        "clusteredMaeDelta": stability(current, frozen) if frozen else None,
    }
    qualifies = bool(
        frozen and current_report["candidate"]
        and current_report["candidate"]["mae"] < current_report["incumbent"]["mae"]
        and current_report["candidate"]["rmse"] < current_report["incumbent"]["rmse"]
        and current_report["candidateDirection"] >= current_report["incumbentDirection"]
    )
    output_rows.append(current)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(output_rows, ignore_index=True, sort=False).to_parquet(args.rows, index=False)
    payload = {
        "release": "nfl_player_props_receptions_completion_allocation_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True, "marketIndependent": True, "marketFeatures": [],
        "candidate": "predicted team completions times complete-roster normalized reception share",
        "reports": reports, "selectionEligible": selectable, "selected": selected,
        "confirmationStability": confirmation_stability, "confirmed": confirmed,
        "frozenCandidate": frozen, "currentSeason": current_report, "qualifies": qualifies,
        "injuryMetadata": injury_metadata,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
