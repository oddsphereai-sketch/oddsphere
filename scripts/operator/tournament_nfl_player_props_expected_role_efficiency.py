#!/usr/bin/env python3
"""Cumulative efficiency tournament over the frozen expected-role foundation."""

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
FOUNDATION_PATH = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_efficiency_r2.json"
DEFAULT_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_efficiency_2026_projections_r2.parquet"
DEFAULT_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
FOUNDATION_WEIGHTS = {
    "passing_attempts": 1.0,
    "passing_completions": 0.75,
    "passing_yards": 0.75,
    "rushing_attempts": 0.75,
    "rushing_yards": 0.75,
    "receptions": 0.50,
    "receiving_yards": 0.50,
}
CHALLENGER_MODES = {
    "passing_attempts": (),
    "passing_completions": ("exposure_weighted",),
    "passing_yards": ("exposure_weighted",),
    "rushing_attempts": (),
    "rushing_yards": ("exposure_weighted",),
    "receptions": ("exposure_weighted",),
    "receiving_yards": ("exposure_weighted", "decomposed_receiving"),
}


def load(name: str, path: pathlib.Path) -> Any:
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def blend(reference: np.ndarray, component: np.ndarray, weight: float) -> np.ndarray:
    return np.clip((1.0 - weight) * reference + weight * component, 0.0, None)


def candidate_identity(name: str, market: str) -> tuple[str, float]:
    if name == "foundation":
        return "foundation", FOUNDATION_WEIGHTS[market]
    mode, weight = name.rsplit("_blend_", 1)
    return mode, int(weight) / 100.0


def mode_components(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    groups: pd.DataFrame,
    season: int,
    team_features: list[str],
    player_features: list[str],
    test_rows: dict[str, pd.DataFrame],
    known_active_row_ids: set[str] | None = None,
) -> dict[str, dict[str, np.ndarray]]:
    result = {market: {} for market in foundation.MARKETS}
    for weighted, mode in ((False, "foundation"), (True, "exposure_weighted")):
        for market in ("passing_attempts", "passing_completions", "passing_yards"):
            result[market][mode] = foundation.passing_predictions(
                frame, teams, season, team_features, player_features, test_rows[market], weighted,
            )[market]
        roles = foundation.role_predictions(
            frame, groups, season, team_features, player_features,
            {market: test_rows[market] for market in ("rushing_attempts", "rushing_yards", "receptions", "receiving_yards")},
            known_active_row_ids, mode,
        )
        for market, values in roles.items():
            result[market][mode] = values
    decomposed = foundation.role_predictions(
        frame, groups, season, team_features, player_features,
        {market: test_rows[market] for market in ("rushing_attempts", "rushing_yards", "receptions", "receiving_yards")},
        known_active_row_ids, "decomposed_receiving",
    )
    result["receiving_yards"]["decomposed_receiving"] = decomposed["receiving_yards"]
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path)
    parser.add_argument("--history-manifest", type=pathlib.Path)
    parser.add_argument("--injury-root", type=pathlib.Path)
    parser.add_argument("--offered-replay", type=pathlib.Path, default=DEFAULT_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--projections", type=pathlib.Path, default=DEFAULT_PROJECTIONS)
    args = parser.parse_args()

    foundation = load("props_expected_role_efficiency_foundation", FOUNDATION_PATH)
    external_manifest = args.external_manifest or foundation.DEFAULT_EXTERNAL_MANIFEST
    history_manifest = args.history_manifest or foundation.DEFAULT_HISTORY_MANIFEST
    injury_root = args.injury_root or foundation.DEFAULT_INJURY_ROOT
    baseline = foundation.load_module("props_efficiency_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = foundation.load_module("props_efficiency_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    history = foundation.load_module("props_efficiency_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    identity = foundation.load_module("props_efficiency_identity", ROOT / "scripts/operator/tournament_nfl_player_props_opponent_matchup_identity.py")
    role = foundation.load_module("props_efficiency_role", ROOT / "scripts/operator/tournament_nfl_player_props_role_volume_efficiency.py")
    trainer = foundation.load_module("props_efficiency_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    prior_opportunity = foundation.load_module("props_efficiency_prior", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    conditional = foundation.load_module("props_efficiency_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    external = foundation.load_module("props_efficiency_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py")
    availability = foundation.load_module("props_efficiency_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())

    manifest = json.loads(external_manifest.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), injury_root,
    )
    frame = foundation.add_role_shares(frame)
    feature_groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        feature_groups["base"].append(column)
    feature_groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("passing_yards", feature_groups)["full_external"],
        *external.relevant_features("rushing_yards", feature_groups)["full_external"],
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
    frame[list(dict.fromkeys([*player_features, *team_features]))] = frame[
        list(dict.fromkeys([*player_features, *team_features]))
    ].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    opportunity_groups = foundation.group_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)
    legacy, _, base_features, enhanced_features, _ = role.corrected_frames(
        baseline, matchup, history, identity, history_manifest, contract,
    )
    legacy_eligible = {
        market: baseline.market_eligible(legacy, contract["markets"][market])
        for market in foundation.MARKETS
    }
    candidate_eligible = {
        market: baseline.market_eligible(frame, contract["markets"][market])
        for market in foundation.MARKETS
    }

    rows_by_season: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in foundation.MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in foundation.MARKETS}
    legacy_reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in foundation.MARKETS}
    components: dict[str, dict[str, dict[int, np.ndarray]]] = {
        market: {} for market in foundation.MARKETS
    }
    foundation_projection: dict[str, dict[int, np.ndarray]] = {market: {} for market in foundation.MARKETS}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in foundation.MARKETS}

    for season in (2024, 2025):
        print(f"efficiency tournament season {season}...", flush=True)
        incumbent_rows, incumbent_prediction, _ = prior_opportunity.incumbent_predictions(
            trainer, legacy, legacy_eligible, season, base_features, enhanced_features,
        )
        _, active_prediction = conditional.conditional_predictions(
            trainer, legacy, legacy_eligible, season, base_features, enhanced_features,
        )
        test_rows: dict[str, pd.DataFrame] = {}
        for market in foundation.MARKETS:
            participated = incumbent_rows[market]["participated"].eq(1).to_numpy()
            settled = incumbent_rows[market].loc[participated]
            released = incumbent_prediction[market][participated]
            if market == "rushing_attempts":
                released = 0.25 * released + 0.75 * active_prediction[market]
            test = by_row.loc[settled["row_id"]].copy()
            if market.startswith("passing_"):
                starter = test["external_depth_starter"].eq(1).to_numpy()
                if int(starter.sum()) >= 100:
                    test = test.loc[starter]
                    released = released[starter]
            test_rows[market] = test
            rows_by_season[market][season] = test
            actual[market][season] = test[market].to_numpy(float)
            legacy_reference[market][season] = released
        calculated = mode_components(
            foundation, frame, teams, opportunity_groups, season,
            team_features, player_features, test_rows,
        )
        for market in foundation.MARKETS:
            for mode, values in calculated[market].items():
                components[market].setdefault(mode, {})[season] = values
            foundation_projection[market][season] = blend(
                legacy_reference[market][season], calculated[market]["foundation"], FOUNDATION_WEIGHTS[market],
            )
            for mode in CHALLENGER_MODES[market]:
                for weight in foundation.WEIGHTS:
                    name = f"{mode}_blend_{int(weight * 100)}"
                    candidates[market].setdefault(name, {})[season] = blend(
                        legacy_reference[market][season], calculated[market][mode], weight,
                    )

    report: dict[str, Any] = {}
    frozen: dict[str, str] = {}
    for market in foundation.MARKETS:
        selection_reference = foundation.point_metrics(actual[market][2024], foundation_projection[market][2024])
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
        )) if selectable else "foundation"
        confirmation_reference = foundation.point_metrics(actual[market][2025], foundation_projection[market][2025])
        confirmation_candidate = (
            confirmation_reference if selected == "foundation"
            else foundation.point_metrics(actual[market][2025], candidates[market][selected][2025])
        )
        confirmed = bool(
            float(confirmation_candidate["mae"]) <= float(confirmation_reference["mae"])
            and float(confirmation_candidate["rmse"]) <= float(confirmation_reference["rmse"])
        )
        frozen[market] = selected if confirmed else "foundation"
        report[market] = {
            "selection": {"foundation": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"foundation": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "frozen2026Candidate": frozen[market],
        }

    print("efficiency identities frozen; opening 2026 Weeks 1-4...", flush=True)
    diagnostic_rows = {
        market: frame[
            frame["participated"].eq(1)
            & frame["season"].eq(2026)
            & frame["position"].isin(contract["markets"][market]["positions"])
            & (candidate_eligible[market] | frame["external_depth_listed"].eq(1))
        ].copy()
        for market in foundation.MARKETS
    }
    offered_payload = json.loads(args.offered_replay.read_text(encoding="utf-8"))
    offered_contract = pd.DataFrame(offered_payload["rows"])[["week", "playerName", "team", "market"]]
    offered_contract = offered_contract[offered_contract["market"].isin(foundation.MARKETS)].copy()
    offered_contract["normalized_player"] = offered_contract["playerName"].map(foundation.normalize_player)
    offered_contract = offered_contract.drop_duplicates(["week", "team", "market", "normalized_player"])
    offered_frame = frame[frame["season"].eq(2026)].copy()
    offered_frame["normalized_player"] = offered_frame["player_name"].map(foundation.normalize_player)
    offered_rows: dict[str, pd.DataFrame] = {}
    for market in foundation.MARKETS:
        offered_rows[market] = offered_contract[offered_contract["market"].eq(market)].merge(
            offered_frame,
            on=["week", "team", "normalized_player"],
            how="left",
            validate="one_to_one",
        )
        if offered_rows[market]["row_id"].isna().any():
            raise RuntimeError(f"unmatched offered rows for {market}")
    known_active = {
        str(row_id) for market_rows in offered_rows.values() for row_id in market_rows["row_id"]
    }
    offered_components = mode_components(
        foundation, frame, teams, opportunity_groups, 2026,
        team_features, player_features, offered_rows, known_active,
    )

    projection_frames: list[pd.DataFrame] = []
    for market in foundation.MARKETS:
        chosen = frozen[market]
        mode, weight = candidate_identity(chosen, market)
        for season, phase in ((2024, "selection"), (2025, "confirmation")):
            rows = rows_by_season[market][season]
            values = rows[[
                "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                "player_name", "position", market,
            ]].copy().rename(columns={market: "actual"})
            values["market"] = market
            values["phase"] = phase
            values["candidate_name"] = chosen
            values["candidate_projection"] = (
                foundation_projection[market][season] if chosen == "foundation"
                else candidates[market][chosen][season]
            )
            values["component_projection"] = components[market][mode][season]
            values["frozen_blend_weight"] = weight
            values["released_projection"] = foundation_projection[market][season]
            projection_frames.append(values)
        offered = offered_rows[market]
        values = offered[[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", market,
        ]].copy().rename(columns={market: "actual"})
        values["market"] = market
        values["phase"] = "locked_replay"
        values["candidate_name"] = chosen
        values["candidate_projection"] = np.nan
        values["component_projection"] = offered_components[market][mode]
        values["frozen_blend_weight"] = weight
        values["released_projection"] = np.nan
        projection_frames.append(values)

    args.projections.parent.mkdir(parents=True, exist_ok=True)
    projections = pd.concat(projection_frames, ignore_index=True)
    projections.to_parquet(args.projections, index=False)
    output = {
        "release": "nfl_player_props_expected_role_efficiency_2026_10_08_r2",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "foundationRelease": "nfl_player_props_expected_role_system_2026_10_08_r1",
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025, "diagnostic": "2026 Weeks 1-4 opened"},
        "externalManifestSha256": foundation.sha256_file(external_manifest),
        "injurySources": injury_metadata,
        "projectionFile": str(args.projections.resolve()),
        "projectionFileSha256": foundation.sha256_file(args.projections),
        "frozenCandidates": frozen,
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "frozenCandidates": frozen,
        "confirmation": {market: report[market]["confirmation"] for market in foundation.MARKETS},
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
