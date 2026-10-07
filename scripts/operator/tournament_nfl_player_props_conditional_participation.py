#!/usr/bin/env python3
"""Settlement-aligned conditional-participation NFL props point tournament."""

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
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-projection-accuracy/nfl_player_props_conditional_participation_r2.json"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
SEASONS = (2023, 2024, 2025)


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def conditional_predictions(
    trainer: Any,
    frame: pd.DataFrame,
    eligible: dict[str, pd.Series],
    season: int,
    base_features: list[str],
    enhanced_features: list[str],
) -> tuple[dict[str, pd.DataFrame], dict[str, np.ndarray]]:
    rows: dict[str, pd.DataFrame] = {}
    prediction: dict[str, np.ndarray] = {}
    for market in MARKETS:
        train = frame[eligible[market] & frame["participated"].eq(1) & frame["season"].lt(season)]
        test = frame[eligible[market] & frame["participated"].eq(1) & frame["season"].eq(season)]
        rows[market] = test
        _, prediction[market] = trainer.fit_recipe(train, test, market, base_features, enhanced_features)
    qb_train = frame[eligible["passing_attempts"] & frame["participated"].eq(1) & frame["season"].lt(season)]
    qb_test = rows["passing_attempts"]
    _, completion_rate = trainer.fit_rate_model(
        qb_train, qb_test, enhanced_features, "passing_completions", "passing_attempts", True,
    )
    _, yards_per_attempt = trainer.fit_rate_model(
        qb_train, qb_test, enhanced_features, "passing_yards", "passing_attempts", False,
    )
    attempts = prediction["passing_attempts"]
    prediction["passing_completions"] = np.minimum(
        attempts, 0.75 * attempts * completion_rate + 0.25 * prediction["passing_completions"],
    )
    prediction["passing_yards"] = np.clip(
        0.75 * attempts * yards_per_attempt + 0.25 * prediction["passing_yards"], 0.0, None,
    )
    return rows, prediction


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    baseline = load_module("props_conditional_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_conditional_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("props_conditional_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    opportunity = load_module("props_conditional_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    recalibration = load_module("props_conditional_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    accuracy = load_module("props_conditional_accuracy", ROOT / "scripts/operator/tournament_nfl_player_props_projection_accuracy.py")
    history_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, history_contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    matchup_rows, matchup_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    eligible = {market: baseline.market_eligible(frame, history_contract["markets"][market]) for market in MARKETS}

    rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    incumbent: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    candidate: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}
    nonparticipants: dict[str, dict[int, int]] = {market: {} for market in MARKETS}
    for season in SEASONS:
        print(f"conditional-participation season {season}...", flush=True)
        incumbent_rows, incumbent_prediction, _ = opportunity.incumbent_predictions(
            trainer, frame, eligible, season, base_features, enhanced_features,
        )
        candidate_rows, candidate_prediction = conditional_predictions(
            trainer, frame, eligible, season, base_features, enhanced_features,
        )
        for market in MARKETS:
            all_rows = incumbent_rows[market]
            participated = all_rows["participated"].eq(1).to_numpy()
            filtered = all_rows.loc[participated]
            if not filtered.index.equals(candidate_rows[market].index):
                raise RuntimeError(f"conditional row identity mismatch for {market} {season}")
            rows[market][season] = filtered
            actual[market][season] = filtered[market].to_numpy(float)
            incumbent[market][season] = incumbent_prediction[market][participated]
            for weight in (0.25, 0.50, 0.75, 1.0):
                name = f"conditional_blend_{int(weight * 100)}"
                candidate[market].setdefault(name, {})[season] = (
                    (1.0 - weight) * incumbent[market][season]
                    + weight * candidate_prediction[market]
                )
            nonparticipants[market][season] = int((~participated).sum())

    report: dict[str, Any] = {}
    for market in MARKETS:
        selection_reference = accuracy.point_metrics(actual[market][2023], incumbent[market][2023])
        selection_candidates = {
            name: accuracy.point_metrics(actual[market][2023], predictions[2023])
            for name, predictions in candidate[market].items()
        }
        selectable = [name for name, values in selection_candidates.items() if (
            float(values["mae"]) < float(selection_reference["mae"])
            and float(values["rmse"]) < float(selection_reference["rmse"])
        )]
        selected = min(selectable, key=lambda name: (
            float(selection_candidates[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_candidates[name]["rmse"]) / float(selection_reference["rmse"])
        )) if selectable else None
        confirmation_reference = accuracy.point_metrics(actual[market][2024], incumbent[market][2024])
        confirmation_candidate = accuracy.point_metrics(actual[market][2024], candidate[market][selected][2024]) if selected else None
        confirmed = bool(
            selected
            and confirmation_candidate
            and float(confirmation_candidate["mae"]) < float(confirmation_reference["mae"])
            and float(confirmation_candidate["rmse"]) < float(confirmation_reference["rmse"])
        )
        chosen = candidate[market][selected] if confirmed and selected else incumbent[market]
        holdout_y = actual[market][2025]
        holdout_reference = accuracy.point_metrics(holdout_y, incumbent[market][2025])
        holdout_candidate = accuracy.point_metrics(holdout_y, chosen[2025])
        mae_bootstrap = accuracy.clustered_delta(
            rows[market][2025], np.abs(chosen[2025] - holdout_y), np.abs(incumbent[market][2025] - holdout_y),
        )
        bias_bootstrap = accuracy.clustered_delta(
            rows[market][2025], chosen[2025] - holdout_y, incumbent[market][2025] - holdout_y,
        )
        segments = accuracy.segment_metrics(rows[market][2025], holdout_y, incumbent[market][2025], chosen[2025])
        incumbent_distribution = accuracy.distribution_report(recalibration, calibration_contract, actual[market], incumbent[market])
        candidate_distribution = accuracy.distribution_report(recalibration, calibration_contract, actual[market], chosen)
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
        incumbent_dist = incumbent_distribution["holdout"]
        candidate_dist = candidate_distribution["holdout"]
        distribution_pass = bool(
            float(candidate_dist["crps"]) < float(incumbent_dist["crps"])
            and float(candidate_dist["nll"]) <= float(incumbent_dist["nll"]) * 1.005
            and abs(float(candidate_dist["coverage_80"]) - 0.8) <= float(calibration_contract["selection"]["maximumAbsoluteCoverage80Error"])
            and abs(float(candidate_dist["coverage_90"]) - 0.9) <= float(calibration_contract["selection"]["maximumAbsoluteCoverage90Error"])
        )
        report[market] = {
            "excludedNonparticipants": nonparticipants[market],
            "selection": {"incumbent": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"incumbent": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "holdout": {
                "incumbent": holdout_reference,
                "candidate": holdout_candidate,
                "clusteredMaeDelta": mae_bootstrap,
                "clusteredBiasDelta": bias_bootstrap,
                "chronologicalSegments": segments,
            },
            "distribution": {"incumbent": incumbent_distribution, "candidate": candidate_distribution},
            "passes": {"point": point_pass, "distribution": distribution_pass, "all": bool(point_pass and distribution_pass)},
        }
    output = {
        "release": "nfl_player_props_conditional_participation_tournament_2026_10_07_r2_conservative_blend",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "targetPopulation": "prior-role eligible rows with official participated=1; participated is never a model feature",
        "architecture": "released full-family market recipes and QB joint equations, refit on the settlement-aligned population and blended at a 2023-selected fixed weight",
        "blendWeights": [0.25, 0.5, 0.75, 1.0],
        "lineOrPriceFeatures": [],
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {
            market: {
                "selection": values["selection"],
                "confirmation": values["confirmation"],
                "holdout": values["holdout"],
                "distribution": values["distribution"],
                "passes": values["passes"],
            }
            for market, values in report.items()
        },
    }, indent=2))


if __name__ == "__main__":
    main()
