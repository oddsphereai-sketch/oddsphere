#!/usr/bin/env python3
"""Chronological role × team volume × efficiency NFL player-props tournament."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-opportunity-budget/nfl_player_props_role_volume_efficiency_r1.json"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
SEASONS = (2023, 2024, 2025)
BLEND_WEIGHTS = (0.25, 0.50, 0.75, 1.0)


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def corrected_frames(
    baseline: Any,
    matchup: Any,
    history: Any,
    identity: Any,
    manifest_path: pathlib.Path,
    contract: dict[str, Any],
) -> tuple[pd.DataFrame, pd.DataFrame, list[str], list[str], dict[str, Any]]:
    frame, manifest = baseline.load_verified_dataset(manifest_path, contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    team_metrics = matchup.team_game_metrics(manifest)
    legacy_matchup, matchup_names = matchup.add_shifted_team_features(team_metrics)
    corrected_matchup, corrected_names = matchup.add_opponent_shifted_team_features(team_metrics)
    if matchup_names != corrected_names:
        raise RuntimeError("matchup contracts differ")
    environment, environment_names = matchup.game_environment(manifest)
    legacy_frame = identity.enriched_frame(frame, legacy_matchup, environment)
    base_team_features, base_team_names = history.add_opponent_team_prior_features(
        identity.historical_team_outcomes(matchup, manifest),
    )
    opponent_names = [name for name in base_team_names if name.startswith("prior_opponent_")]
    corrected_base = frame.drop(columns=opponent_names).merge(
        base_team_features[["season", "week", "game_id", "team", *opponent_names]],
        on=["season", "week", "game_id", "team"],
        how="left",
        validate="many_to_one",
        sort=False,
    )
    corrected_frame = identity.enriched_frame(corrected_base, corrected_matchup, environment)
    keys = ["season", "week", "game_id", "team", "player_id"]
    if not legacy_frame[keys].equals(corrected_frame[keys]):
        raise RuntimeError("legacy/corrected frame identities differ")
    return legacy_frame, corrected_frame, base_features, [*base_features, *matchup_names, *environment_names], manifest


def finite(rows: pd.DataFrame, column: str, fallback: float) -> np.ndarray:
    return np.nan_to_num(rows[column].to_numpy(float), nan=fallback, posinf=fallback, neginf=fallback)


def smoothed_rate(
    train: pd.DataFrame,
    rows: pd.DataFrame,
    numerator: str,
    denominator: str,
    lower: float,
    upper: float,
    prior_weight: float = 2.0,
) -> np.ndarray:
    denominator_sum = float(train[denominator].sum())
    league = float(train[numerator].sum() / denominator_sum) if denominator_sum > 0 else (lower + upper) / 2
    prior_numerator = finite(rows, f"prior_{numerator}_ewm", 0.0)
    prior_denominator = finite(rows, f"prior_{denominator}_ewm", 0.0)
    rate = (prior_numerator + prior_weight * league) / np.maximum(prior_denominator + prior_weight, 1e-9)
    return np.clip(rate, lower, upper)


def role_volume_prediction(
    train: pd.DataFrame,
    rows: pd.DataFrame,
    market: str,
) -> np.ndarray:
    if market.startswith("passing_"):
        team_metric = "pass_attempts"
        share_metric = "pass_attempt_share"
    elif market.startswith("rushing_"):
        team_metric = "rush_attempts"
        share_metric = "rush_attempt_share"
    else:
        team_metric = "targets"
        share_metric = "target_share"
    team_own = finite(rows, f"prior_team_{team_metric}_ewm", float(train[f"team_{team_metric}"].mean()) if f"team_{team_metric}" in train else 30.0)
    team_allowed = finite(rows, f"prior_opponent_allowed_{team_metric}_ewm", float(np.nanmean(team_own)))
    budget = 0.5 * team_own + 0.5 * team_allowed
    share_ewm = finite(rows, f"prior_{share_metric}_ewm", 0.0)
    share_avg3 = finite(rows, f"prior_{share_metric}_avg3", 0.0)
    share = np.clip(0.5 * share_ewm + 0.5 * share_avg3, 0.0, 1.0)
    opportunities = np.clip(budget * share, 0.0, None)
    if market == "passing_attempts":
        return opportunities
    if market == "passing_completions":
        return np.minimum(
            opportunities,
            opportunities * smoothed_rate(train, rows, "passing_completions", "passing_attempts", 0.35, 0.85),
        )
    if market == "passing_yards":
        return opportunities * smoothed_rate(train, rows, "passing_yards", "passing_attempts", 3.0, 12.0, 4.0)
    if market == "rushing_attempts":
        return opportunities
    if market == "rushing_yards":
        return opportunities * smoothed_rate(train, rows, "rushing_yards", "rushing_attempts", 0.0, 10.0, 4.0)
    if market == "receptions":
        return np.minimum(
            opportunities,
            opportunities * smoothed_rate(train, rows, "receptions", "targets", 0.25, 0.95),
        )
    if market == "receiving_yards":
        return opportunities * smoothed_rate(train, rows, "receiving_yards", "targets", 0.0, 20.0, 4.0)
    raise ValueError(market)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("props_role_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_role_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    history = load_module("props_role_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    identity = load_module("props_role_identity", ROOT / "scripts/operator/tournament_nfl_player_props_opponent_matchup_identity.py")
    trainer = load_module("props_role_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    conditional = load_module("props_role_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    accuracy = load_module("props_role_accuracy", ROOT / "scripts/operator/tournament_nfl_player_props_projection_accuracy.py")
    recalibration = load_module("props_role_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    history_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    legacy_frame, corrected_frame, base_features, enhanced_features, manifest = corrected_frames(
        baseline, matchup, history, identity, args.manifest, history_contract,
    )
    legacy_eligible = {
        market: baseline.market_eligible(legacy_frame, history_contract["markets"][market])
        for market in MARKETS
    }
    corrected_eligible = {
        market: baseline.market_eligible(corrected_frame, history_contract["markets"][market])
        for market in MARKETS
    }

    rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}

    for season in SEASONS:
        print(f"role-volume-efficiency season {season}...", flush=True)
        legacy_rows, legacy_prediction = conditional.conditional_predictions(
            trainer, legacy_frame, legacy_eligible, season, base_features, enhanced_features,
        )
        corrected_rows, corrected_prediction = conditional.conditional_predictions(
            trainer, corrected_frame, corrected_eligible, season, base_features, enhanced_features,
        )
        for market in MARKETS:
            market_rows = corrected_rows[market]
            if not legacy_rows[market][["row_id"]].reset_index(drop=True).equals(
                market_rows[["row_id"]].reset_index(drop=True)
            ):
                raise RuntimeError(f"row mismatch for {market} {season}")
            train = corrected_frame[
                corrected_eligible[market]
                & corrected_frame["participated"].eq(1)
                & corrected_frame["season"].lt(season)
            ]
            source_predictions = {
                "corrected_direct": corrected_prediction[market],
                "active_ewm": finite(market_rows, f"prior_{market}_ewm", float(train[market].mean())),
                "active_avg3": finite(market_rows, f"prior_{market}_avg3", float(train[market].mean())),
                "active_avg5": finite(market_rows, f"prior_{market}_avg5", float(train[market].mean())),
                "active_season_avg": finite(market_rows, f"prior_{market}_season_avg", float(train[market].mean())),
                "active_recency_mean": 0.5 * finite(market_rows, f"prior_{market}_ewm", float(train[market].mean()))
                + 0.5 * finite(market_rows, f"prior_{market}_avg3", float(train[market].mean())),
                "role_volume_efficiency": role_volume_prediction(train, market_rows, market),
            }
            rows[market][season] = market_rows
            actual[market][season] = market_rows[market].to_numpy(float)
            reference[market][season] = legacy_prediction[market]
            for source_name, source_prediction in source_predictions.items():
                for weight in BLEND_WEIGHTS:
                    name = f"{source_name}_blend_{int(weight * 100)}"
                    candidates[market].setdefault(name, {})[season] = np.clip(
                        (1.0 - weight) * legacy_prediction[market] + weight * source_prediction,
                        0.0,
                        None,
                    )

    report: dict[str, Any] = {}
    for market in MARKETS:
        selection_reference = accuracy.point_metrics(actual[market][2023], reference[market][2023])
        selection_candidates = {
            name: accuracy.point_metrics(actual[market][2023], values[2023])
            for name, values in candidates[market].items()
        }
        selectable = [name for name, values in selection_candidates.items() if (
            float(values["mae"]) < float(selection_reference["mae"])
            and float(values["rmse"]) < float(selection_reference["rmse"])
        )]
        selected = min(selectable, key=lambda name: (
            float(selection_candidates[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_candidates[name]["rmse"]) / float(selection_reference["rmse"])
        )) if selectable else None
        confirmation_reference = accuracy.point_metrics(actual[market][2024], reference[market][2024])
        confirmation_candidate = (
            accuracy.point_metrics(actual[market][2024], candidates[market][selected][2024])
            if selected else None
        )
        confirmed = bool(
            selected and confirmation_candidate
            and float(confirmation_candidate["mae"]) < float(confirmation_reference["mae"])
            and float(confirmation_candidate["rmse"]) < float(confirmation_reference["rmse"])
        )
        chosen = candidates[market][selected] if confirmed and selected else reference[market]
        holdout_y = actual[market][2025]
        holdout_reference = accuracy.point_metrics(holdout_y, reference[market][2025])
        holdout_candidate = accuracy.point_metrics(holdout_y, chosen[2025])
        mae_bootstrap = accuracy.clustered_delta(
            rows[market][2025], np.abs(chosen[2025] - holdout_y), np.abs(reference[market][2025] - holdout_y),
        )
        bias_bootstrap = accuracy.clustered_delta(
            rows[market][2025], chosen[2025] - holdout_y, reference[market][2025] - holdout_y,
        )
        segments = accuracy.segment_metrics(
            rows[market][2025], holdout_y, reference[market][2025], chosen[2025],
        )
        reference_distribution = accuracy.distribution_report(
            recalibration, calibration_contract, actual[market], reference[market],
        )
        candidate_distribution = accuracy.distribution_report(
            recalibration, calibration_contract, actual[market], chosen,
        )
        market_mean = float(np.mean(holdout_y))
        point_pass = bool(
            confirmed
            and float(holdout_candidate["mae"]) < float(holdout_reference["mae"])
            and float(holdout_candidate["rmse"]) < float(holdout_reference["rmse"])
            and float(mae_bootstrap["ciHigh"]) < 0.0
            and abs(float(holdout_candidate["bias"])) <= abs(float(holdout_reference["bias"])) + 0.0025 * market_mean
            and float(holdout_candidate["underpredictionRate"]) <= float(holdout_reference["underpredictionRate"]) + 0.0025
            and all(float(segment["maeDelta"]) <= 0.0 for segment in segments)
        )
        reference_dist = reference_distribution["holdout"]
        candidate_dist = candidate_distribution["holdout"]
        distribution_pass = bool(
            float(candidate_dist["crps"]) < float(reference_dist["crps"])
            and float(candidate_dist["nll"]) <= float(reference_dist["nll"]) * 1.005
            and abs(float(candidate_dist["coverage_80"]) - 0.8)
            <= float(calibration_contract["selection"]["maximumAbsoluteCoverage80Error"])
            and abs(float(candidate_dist["coverage_90"]) - 0.9)
            <= float(calibration_contract["selection"]["maximumAbsoluteCoverage90Error"])
        )
        report[market] = {
            "selection": {"reference": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"reference": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "holdout": {
                "reference": holdout_reference,
                "candidate": holdout_candidate,
                "clusteredMaeDelta": mae_bootstrap,
                "clusteredBiasDelta": bias_bootstrap,
                "chronologicalSegments": segments,
            },
            "distribution": {"reference": reference_distribution, "candidate": candidate_distribution},
            "passes": {"point": point_pass, "distribution": distribution_pass, "all": bool(point_pass and distribution_pass)},
        }

    output = {
        "release": "nfl_player_props_role_volume_efficiency_tournament_2026_10_08_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "targetPopulation": "prior-role eligible rows with official participated=1; participated is never a model feature",
        "architecture": "active recency, corrected direct, and explicit player role share × corrected team/opponent volume × conditional efficiency",
        "blendWeights": list(BLEND_WEIGHTS),
        "lineOrPriceFeatures": [],
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {
            market: {
                "selected": values["selection"]["selected"],
                "confirmed": values["confirmation"]["confirmed"],
                "holdout": values["holdout"],
                "passes": values["passes"],
            }
            for market, values in report.items()
        },
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
