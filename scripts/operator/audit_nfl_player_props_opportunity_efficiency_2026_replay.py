#!/usr/bin/env python3
"""Exact locked replay for frozen opportunity × share × efficiency candidates."""

from __future__ import annotations

import argparse
import json
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_TOURNAMENT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_opportunity_efficiency_external_r2_depth_role.json"
DEFAULT_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_opportunity_efficiency_2026_replay_r2_depth_role.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tournament", type=pathlib.Path, default=DEFAULT_TOURNAMENT)
    parser.add_argument("--replay", type=pathlib.Path, default=DEFAULT_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--release",
        default="nfl_player_props_opportunity_efficiency_2026_locked_replay_2026_10_08_r2_depth_role",
    )
    args = parser.parse_args()

    utility = load("props_hierarchy_replay_utility", ROOT / "scripts/operator/audit_nfl_player_props_external_2026_replay.py")
    baseline = load("props_hierarchy_replay_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    recalibration = load("props_hierarchy_replay_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    tournament = json.loads(args.tournament.read_text(encoding="utf-8"))
    projection_path = pathlib.Path(tournament["projectionFile"])
    if utility.sha256_file(projection_path) != tournament["projectionFileSha256"]:
        raise RuntimeError("hierarchy projection checksum mismatch")
    projections = pd.read_parquet(projection_path)
    replay_payload = json.loads(args.replay.read_text(encoding="utf-8"))
    replay = pd.DataFrame(replay_payload["rows"])
    markets = [market for market, candidate in tournament["frozenCandidates"].items() if candidate]
    if not markets:
        raise RuntimeError("depth-role tournament froze no candidate markets")
    replay["normalized_player"] = replay["playerName"].map(utility.normalize)
    projections["normalized_player"] = projections["player_name"].map(utility.normalize)

    # Receptions is a count distribution; the shared passing replay utility
    # intentionally has a narrower count-market set.
    utility.COUNT = {*utility.COUNT, "receptions"}
    distributions: dict[str, dict[str, Any]] = {}
    distribution_report: dict[str, Any] = {}
    for market in markets:
        selected = projections[projections["market"].eq(market) & projections["phase"].eq("selection")]
        confirmation = projections[projections["market"].eq(market) & projections["phase"].eq("confirmation")]
        candidates = utility.distribution_candidates(
            market,
            selected["actual"].to_numpy(float),
            selected["candidate_projection"].to_numpy(float),
            baseline,
            recalibration,
            calibration_contract,
        )
        metrics = {
            name: recalibration.distribution_metrics(
                baseline,
                confirmation["actual"].to_numpy(float),
                confirmation["candidate_projection"].to_numpy(float),
                distribution,
            )
            for name, distribution in candidates.items()
        }
        selected_name = min(
            metrics,
            key=lambda name: (*recalibration.selection_key(metrics[name], calibration_contract), metrics[name]["nll"]),
        )
        combined = pd.concat([selected, confirmation], ignore_index=True)
        distributions[market] = utility.refit_distribution(
            selected_name,
            market,
            combined["actual"].to_numpy(float),
            combined["candidate_projection"].to_numpy(float),
            baseline,
            recalibration,
            calibration_contract,
        )
        distribution_report[market] = {
            "selectedOn2025": selected_name,
            "confirmationCandidates": metrics,
            "fitRows2024To2025": int(len(combined)),
            "finalFamily": distributions[market]["family"],
        }

    locked = replay[replay["market"].isin(markets)].copy()
    diagnostic = projections[projections["phase"].eq("diagnostic")]
    joined = locked.merge(
        diagnostic[[
            "week", "market", "normalized_player", "component_projection",
            "candidate_name", "frozen_blend_weight",
        ]],
        on=["week", "market", "normalized_player"],
        how="left",
        validate="many_to_one",
    )
    matched = joined[joined["component_projection"].notna() & joined["independentProjection"].notna()].copy()
    matched["candidate_projection"] = (
        (1.0 - matched["frozen_blend_weight"]) * matched["independentProjection"]
        + matched["frozen_blend_weight"] * matched["component_projection"]
    )
    candidate_over = np.asarray([
        utility.over_probability(
            float(row.candidate_projection), float(row.line), distributions[str(row.market)], recalibration,
        )
        for row in matched.itertuples()
    ])
    matched["candidate_side_probability"] = np.where(matched["side"].eq("over"), candidate_over, 1.0 - candidate_over)
    matched["candidate_side_probability"] = matched["candidate_side_probability"].clip(0.01, 0.99)
    matched["candidate_pick_side"] = np.where(matched["candidate_projection"] > matched["line"], "over", "under")
    matched["candidate_pick_outcome"] = np.where(
        matched["candidate_pick_side"].eq(matched["side"]), matched["outcome"], 1 - matched["outcome"],
    )

    actual = matched["actual"].to_numpy(float)
    line = matched["line"].to_numpy(float)
    candidate = matched["candidate_projection"].to_numpy(float)
    independent = matched["independentProjection"].to_numpy(float)
    published = matched["publishedProjection"].to_numpy(float)
    outcome = matched["outcome"].to_numpy(float)
    raw_available = matched["raw"].notna().to_numpy()
    report: dict[str, Any] = {
        "release": args.release,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "sourceChecksums": {
            "tournament": utility.sha256_file(args.tournament),
            "replayRows": utility.sha256_file(args.replay),
        },
        "scope": {
            "markets": markets,
            "lockedScopes": int(len(locked)),
            "matchedCandidateScopes": int(len(matched)),
            "coverage": float(len(matched) / len(locked)),
            "unmatchedScopes": int(len(joined) - len(matched)),
            "unmatched": joined.loc[
                joined["component_projection"].isna() | joined["independentProjection"].isna(),
                ["week", "playerName", "market", "team"],
            ].to_dict("records"),
            "games": int(matched["gameId"].nunique()),
        },
        "distribution": distribution_report,
        "point": {
            "candidate": utility.point_metrics(actual, candidate, line),
            "lockedIndependent": utility.point_metrics(actual, independent, line),
            "published": utility.point_metrics(actual, published, line),
            "offeredLineDescriptiveBenchmark": utility.point_metrics(actual, line),
        },
        "probabilityForLockedSide": {
            "candidate": utility.probability_metrics(outcome, matched["candidate_side_probability"].to_numpy(float)),
            "lockedIndependentExactOnly": utility.probability_metrics(
                outcome[raw_available], matched.loc[raw_available, "raw"].to_numpy(float),
            ),
            "market": utility.probability_metrics(outcome, matched["marketProbability"].to_numpy(float)),
            "publishedFinal": utility.probability_metrics(outcome, matched["final"].to_numpy(float)),
        },
        "candidateDirection": {
            "correct": int(matched["candidate_pick_outcome"].sum()),
            "rows": int(len(matched)),
            "accuracy": float(matched["candidate_pick_outcome"].mean()),
            "incumbentActionableDirectionRetained": int(matched["candidate_pick_side"].eq(matched["side"]).sum()),
            "retentionRate": float(matched["candidate_pick_side"].eq(matched["side"]).mean()),
            "oppositePriceEvidenceAvailable": False,
        },
        "byMarket": {},
        "byWeek": {},
        "gameClusterBootstrap95": {
            "candidateMinusLockedIndependentMae": utility.cluster_interval(
                matched,
                lambda rows: float(np.mean(np.abs(rows["candidate_projection"] - rows["actual"])) - np.mean(np.abs(rows["independentProjection"] - rows["actual"]))),
            ),
            "candidateMinusPublishedMae": utility.cluster_interval(
                matched,
                lambda rows: float(np.mean(np.abs(rows["candidate_projection"] - rows["actual"])) - np.mean(np.abs(rows["publishedProjection"] - rows["actual"]))),
            ),
            "candidateMinusMarketBrier": utility.cluster_interval(
                matched,
                lambda rows: float(np.mean((rows["candidate_side_probability"] - rows["outcome"]) ** 2) - np.mean((rows["marketProbability"] - rows["outcome"]) ** 2)),
            ),
        },
        "promotionAuthorized": False,
        "reason": "The 2026 diagnostic was already opened; full-board retention and opposite-side price evidence are unavailable.",
    }
    for grouping, destination in (("market", "byMarket"), ("week", "byWeek")):
        for value, rows in matched.groupby(grouping, observed=True):
            y = rows["actual"].to_numpy(float)
            lines = rows["line"].to_numpy(float)
            report[destination][str(value)] = {
                "candidate": utility.point_metrics(y, rows["candidate_projection"].to_numpy(float), lines),
                "lockedIndependent": utility.point_metrics(y, rows["independentProjection"].to_numpy(float), lines),
                "published": utility.point_metrics(y, rows["publishedProjection"].to_numpy(float), lines),
                "candidateProbability": utility.probability_metrics(
                    rows["outcome"].to_numpy(float), rows["candidate_side_probability"].to_numpy(float),
                ),
            }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, allow_nan=False))


def load(name: str, path: pathlib.Path) -> Any:
    import importlib.util
    import sys

    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


if __name__ == "__main__":
    main()
