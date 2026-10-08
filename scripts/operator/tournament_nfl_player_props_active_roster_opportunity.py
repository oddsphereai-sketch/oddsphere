#!/usr/bin/env python3
"""Chronological active-roster, team-budget NFL player-props tournament."""

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
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-opportunity-budget/nfl_player_props_active_roster_opportunity_r1.json"
SEASONS = (2023, 2024, 2025)
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
BLEND_WEIGHTS = (0.25, 0.50, 0.75, 1.0)
OPPORTUNITIES = {
    "passing": {"target": "passing_attempts", "positions": ("QB",)},
    "rushing": {"target": "rushing_attempts", "positions": ("QB", "RB", "FB", "WR", "TE")},
    "targets": {"target": "targets", "positions": ("RB", "FB", "WR", "TE")},
}


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def conditional_allocation(
    opportunity: Any,
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    budget: pd.Series,
    target: str,
    positions: tuple[str, ...],
) -> pd.Series:
    universe = frame[
        frame["position"].isin(positions)
        & frame["prior_roster_game_rows"].ge(1)
    ]
    train = universe[universe["season"].lt(season) & universe["participated"].eq(1)]
    test = universe[universe["season"].eq(season)].copy()
    model = opportunity.poisson_model().fit(train[features], train[target].to_numpy(float))
    conditional_score = np.clip(np.asarray(model.predict(test[features]), dtype=float), 1e-6, None)
    participation_prior = float(universe[universe["season"].lt(season)]["participated"].mean())
    active_probability = np.clip(
        test["prior_participated_avg5"].fillna(participation_prior).to_numpy(float), 0.05, 0.99,
    )
    keys = pd.MultiIndex.from_frame(test[["game_id", "team"]])
    team_budget = budget.reindex(keys).to_numpy(float)
    if np.isnan(team_budget).any():
        raise RuntimeError(f"team budget missing for {target}")
    work = pd.DataFrame({
        "game_id": test["game_id"].to_numpy(),
        "team": test["team"].to_numpy(),
        "expected": active_probability * conditional_score,
    }, index=test.index)
    expected_total = work.groupby(["game_id", "team"], observed=True)["expected"].transform("sum").to_numpy(float)
    conditional_denominator = expected_total - active_probability * conditional_score + conditional_score
    allocation = team_budget * conditional_score / np.maximum(conditional_denominator, 1e-9)
    return pd.Series(np.clip(allocation, 0.0, None), index=test.index)


def align(values: pd.Series, rows: pd.DataFrame, label: str) -> np.ndarray:
    aligned = values.reindex(rows.index)
    if aligned.isna().any():
        raise RuntimeError(f"{label} allocation missing {int(aligned.isna().sum())} rows")
    return aligned.to_numpy(float)


def rate_prediction(
    trainer: Any,
    frame: pd.DataFrame,
    eligible: pd.Series,
    rows: pd.DataFrame,
    season: int,
    features: list[str],
    numerator: str,
    denominator: str,
    probability: bool,
) -> np.ndarray:
    train = frame[eligible & frame["participated"].eq(1) & frame["season"].lt(season)]
    _, prediction = trainer.fit_rate_model(
        train, rows, features, numerator, denominator, probability,
    )
    return prediction


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("props_active_budget_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_active_budget_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("props_active_budget_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    opportunity = load_module("props_active_budget_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    conditional = load_module("props_active_budget_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    accuracy = load_module("props_active_budget_accuracy", ROOT / "scripts/operator/tournament_nfl_player_props_projection_accuracy.py")
    recalibration = load_module("props_active_budget_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    history_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())

    frame, manifest = baseline.load_verified_dataset(args.manifest, history_contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    matchup_rows, matchup_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    team_features = [
        name for name in enhanced_features
        if name == "is_home" or name.startswith(("prior_team_", "prior_opponent_", "matchup_"))
    ]
    teams = opportunity.team_games(frame, team_features)
    eligible = {market: baseline.market_eligible(frame, history_contract["markets"][market]) for market in MARKETS}

    rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}
    coherence: dict[int, dict[str, int]] = {}

    for season in SEASONS:
        print(f"active-roster opportunity season {season}...", flush=True)
        conditional_rows, conditional_prediction = conditional.conditional_predictions(
            trainer, frame, eligible, season, base_features, enhanced_features,
        )
        budgets = {
            name: opportunity.budget_predictions(teams, season, team_features, config["target"])
            for name, config in OPPORTUNITIES.items()
        }
        allocations = {
            name: conditional_allocation(
                opportunity, frame, season, enhanced_features, budgets[name],
                config["target"], config["positions"],
            )
            for name, config in OPPORTUNITIES.items()
        }

        passing_rows = conditional_rows["passing_attempts"]
        passing_attempts = align(allocations["passing"], passing_rows, "passing")
        completion_rate = np.clip(
            conditional_prediction["passing_completions"]
            / np.maximum(conditional_prediction["passing_attempts"], 1e-6), 0.35, 0.85,
        )
        yards_per_attempt = np.clip(
            conditional_prediction["passing_yards"]
            / np.maximum(conditional_prediction["passing_attempts"], 1e-6), 3.0, 12.0,
        )

        rushing_rows = conditional_rows["rushing_attempts"]
        rushing_attempts = align(allocations["rushing"], rushing_rows, "rushing")
        yards_per_carry = rate_prediction(
            trainer, frame, eligible["rushing_attempts"], rushing_rows, season,
            enhanced_features, "rushing_yards", "rushing_attempts", False,
        )

        receiving_rows = conditional_rows["receptions"]
        targets = align(allocations["targets"], receiving_rows, "targets")
        catch_rate = rate_prediction(
            trainer, frame, eligible["receptions"], receiving_rows, season,
            enhanced_features, "receptions", "targets", True,
        )
        yards_per_target = rate_prediction(
            trainer, frame, eligible["receptions"], receiving_rows, season,
            enhanced_features, "receiving_yards", "targets", False,
        )
        architecture = {
            "passing_attempts": passing_attempts,
            "passing_completions": np.minimum(passing_attempts, passing_attempts * completion_rate),
            "passing_yards": passing_attempts * yards_per_attempt,
            "rushing_attempts": rushing_attempts,
            "rushing_yards": rushing_attempts * np.clip(yards_per_carry, 0.0, None),
            "receptions": np.minimum(targets, targets * np.clip(catch_rate, 0.0, 1.0)),
            "receiving_yards": targets * np.clip(yards_per_target, 0.0, None),
        }
        coherence[season] = {
            "completionGreaterThanAttemptsRows": int(np.sum(architecture["passing_completions"] > architecture["passing_attempts"] + 1e-9)),
            "negativeProjectionRows": int(sum(np.sum(value < -1e-9) for value in architecture.values())),
        }
        for market in MARKETS:
            market_rows = conditional_rows[market]
            rows[market][season] = market_rows
            actual[market][season] = market_rows[market].to_numpy(float)
            reference[market][season] = conditional_prediction[market]
            for weight in BLEND_WEIGHTS:
                name = f"active_budget_blend_{int(weight * 100)}"
                candidates[market].setdefault(name, {})[season] = np.clip(
                    (1.0 - weight) * conditional_prediction[market] + weight * architecture[market],
                    0.0, None,
                )

    report: dict[str, Any] = {}
    for market in MARKETS:
        selection_reference = accuracy.point_metrics(actual[market][2023], reference[market][2023])
        selection_candidates = {
            name: accuracy.point_metrics(actual[market][2023], prediction[2023])
            for name, prediction in candidates[market].items()
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
        confirmation_candidate = accuracy.point_metrics(actual[market][2024], candidates[market][selected][2024]) if selected else None
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
            and abs(float(candidate_dist["coverage_80"]) - 0.8) <= float(calibration_contract["selection"]["maximumAbsoluteCoverage80Error"])
            and abs(float(candidate_dist["coverage_90"]) - 0.9) <= float(calibration_contract["selection"]["maximumAbsoluteCoverage90Error"])
        )
        report[market] = {
            "selection": {"reference": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"reference": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "holdout": {
                "reference": holdout_reference, "candidate": holdout_candidate,
                "clusteredMaeDelta": mae_bootstrap, "chronologicalSegments": segments,
            },
            "distribution": {"reference": reference_distribution, "candidate": candidate_distribution},
            "passes": {"point": point_pass, "distribution": distribution_pass, "all": bool(point_pass and distribution_pass)},
        }

    output = {
        "release": "nfl_player_props_active_roster_opportunity_tournament_2026_10_08_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "reference": "settlement-aligned active-only conditional point and distribution candidate",
        "architecture": {
            "teamBudgets": ["passing_attempts", "rushing_attempts", "targets"],
            "playerScores": "active-only conditional opportunity models",
            "teammateAvailability": "shifted prior_participated_avg5 clipped to [0.05, 0.99]",
            "evaluatedPlayerState": "conditioned active because sportsbook-settled population excludes voids",
            "blendWeights": BLEND_WEIGHTS,
            "lineOrPriceFeatures": [],
        },
        "coherence": coherence,
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
        "coherence": coherence,
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
