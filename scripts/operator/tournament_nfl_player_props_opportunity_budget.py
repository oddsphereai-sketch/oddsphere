#!/usr/bin/env python3
"""Research explicit team budgets and partially pooled player opportunity shares.

This is a local-only chronological tournament.  It deliberately reuses the
current full-family recipes as the incumbent, then asks whether a team budget
allocated across the complete relevant roster improves the seven displayed
markets without peeking at the 2025 holdout.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-opportunity-budget/nfl_player_props_opportunity_budget_r1.json"
SEED = 20261007
SEASONS = (2023, 2024, 2025)
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
POOL_WEIGHTS = (0.25, 0.50, 0.75, 1.0)
BLEND_WEIGHTS = (0.25, 0.50, 0.75, 1.0)

OPPORTUNITIES = {
    "passing": {
        "target": "passing_attempts",
        "positions": ("QB",),
        "prior_share": "prior_pass_attempt_share_ewm",
    },
    "rushing": {
        "target": "rushing_attempts",
        "positions": ("QB", "RB", "FB", "WR", "TE"),
        "prior_share": "prior_rush_attempt_share_ewm",
    },
    "targets": {
        "target": "targets",
        "positions": ("RB", "FB", "WR", "TE"),
        "prior_share": "prior_target_share_ewm",
    },
}


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def poisson_model(minimum_leaf: int = 25, regularization: float = 4.0) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss="poisson", max_iter=180, max_leaf_nodes=15,
        learning_rate=0.045, min_samples_leaf=minimum_leaf,
        l2_regularization=regularization, random_state=SEED,
    )


def point_metrics(y: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(y)),
        "mae": float(mean_absolute_error(y, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(y, prediction))),
        "bias": float(np.mean(prediction - y)),
    }


def team_games(frame: pd.DataFrame, team_features: list[str]) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team"]
    outcomes = frame.groupby(keys, observed=True).agg(
        passing_attempts=("passing_attempts", "sum"),
        rushing_attempts=("rushing_attempts", "sum"),
        targets=("targets", "sum"),
    ).reset_index()
    context = frame.sort_values(keys + ["player_id"]).drop_duplicates(keys)[keys + team_features]
    return outcomes.merge(context, on=keys, validate="one_to_one")


def budget_predictions(
    teams: pd.DataFrame,
    season: int,
    features: list[str],
    target: str,
) -> pd.Series:
    train = teams[teams["season"].lt(season)]
    test = teams[teams["season"].eq(season)]
    model = poisson_model(20, 5.0).fit(train[features], train[target].to_numpy(float))
    prediction = np.clip(np.asarray(model.predict(test[features]), dtype=float), 1e-6, None)
    index = pd.MultiIndex.from_frame(test[["game_id", "team"]])
    return pd.Series(prediction, index=index)


def allocated_opportunities(
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    budget: pd.Series,
    target: str,
    positions: tuple[str, ...],
    prior_share: str,
    pool_weights: tuple[float, ...],
) -> dict[float, pd.Series]:
    universe = frame[frame["position"].isin(positions) & frame["prior_roster_game_rows"].ge(1)]
    train = universe[universe["season"].lt(season)]
    test = universe[universe["season"].eq(season)].copy()
    model = poisson_model().fit(train[features], train[target].to_numpy(float))
    individual = np.clip(np.asarray(model.predict(test[features]), dtype=float), 1e-6, None)
    keys = pd.MultiIndex.from_frame(test[["game_id", "team"]])
    team_budget = budget.reindex(keys).to_numpy(float)
    prior = np.clip(test[prior_share].fillna(0.0).to_numpy(float), 0.0, 1.0)
    output: dict[float, pd.Series] = {}
    for pool_weight in pool_weights:
        raw = (1.0 - pool_weight) * individual + pool_weight * team_budget * prior
        raw = np.clip(raw, 1e-6, None)
        work = pd.DataFrame({"game_id": test["game_id"], "team": test["team"], "raw": raw}, index=test.index)
        denominator = work.groupby(["game_id", "team"], observed=True)["raw"].transform("sum").to_numpy(float)
        allocation = team_budget * raw / np.maximum(denominator, 1e-9)
        output[pool_weight] = pd.Series(allocation, index=test.index)
    return output


def incumbent_predictions(
    trainer: Any,
    frame: pd.DataFrame,
    eligible: dict[str, pd.Series],
    season: int,
    base_features: list[str],
    enhanced_features: list[str],
) -> tuple[dict[str, pd.DataFrame], dict[str, np.ndarray], dict[str, np.ndarray]]:
    rows: dict[str, pd.DataFrame] = {}
    direct: dict[str, np.ndarray] = {}
    for market in MARKETS:
        train = frame[eligible[market] & frame["season"].lt(season)]
        test = frame[eligible[market] & frame["season"].eq(season)]
        rows[market] = test
        _, direct[market] = trainer.fit_recipe(train, test, market, base_features, enhanced_features)
    qb_train = frame[eligible["passing_attempts"] & frame["season"].lt(season)]
    qb_test = rows["passing_attempts"]
    _, completion_rate = trainer.fit_rate_model(
        qb_train, qb_test, enhanced_features, "passing_completions", "passing_attempts", True,
    )
    _, yards_per_attempt = trainer.fit_rate_model(
        qb_train, qb_test, enhanced_features, "passing_yards", "passing_attempts", False,
    )
    attempts = direct["passing_attempts"]
    direct["passing_completions"] = np.minimum(
        attempts, 0.75 * attempts * completion_rate + 0.25 * direct["passing_completions"],
    )
    direct["passing_yards"] = 0.75 * attempts * yards_per_attempt + 0.25 * direct["passing_yards"]
    auxiliary = {"completion_rate": completion_rate, "yards_per_attempt": yards_per_attempt}
    return rows, direct, auxiliary


def conditional_rate(
    trainer: Any,
    frame: pd.DataFrame,
    eligible_mask: pd.Series,
    test: pd.DataFrame,
    season: int,
    features: list[str],
    numerator: str,
    denominator: str,
    probability: bool,
) -> np.ndarray:
    train = frame[eligible_mask & frame["season"].lt(season)]
    _, prediction = trainer.fit_rate_model(
        train, test, features, numerator, denominator, probability,
    )
    return prediction


def candidate_predictions(
    trainer: Any,
    frame: pd.DataFrame,
    rows: dict[str, pd.DataFrame],
    incumbent: dict[str, np.ndarray],
    qb_auxiliary: dict[str, np.ndarray],
    eligible: dict[str, pd.Series],
    allocations: dict[str, pd.Series],
    season: int,
    enhanced_features: list[str],
) -> dict[str, np.ndarray]:
    def align(name: str, market: str) -> np.ndarray:
        values = allocations[name].reindex(rows[market].index)
        if values.isna().any():
            raise RuntimeError(f"{name} allocation missing {int(values.isna().sum())} {market} rows")
        return values.to_numpy(float)

    passing = align("passing", "passing_attempts")
    rushing = align("rushing", "rushing_attempts")
    targets = align("targets", "receptions")
    receiving_rows = rows["receptions"]
    catch_rate = conditional_rate(
        trainer, frame, eligible["receptions"], receiving_rows, season, enhanced_features,
        "receptions", "targets", True,
    )
    yards_per_target = conditional_rate(
        trainer, frame, eligible["receptions"], receiving_rows, season, enhanced_features,
        "receiving_yards", "targets", False,
    )
    rushing_rows = rows["rushing_attempts"]
    yards_per_carry = conditional_rate(
        trainer, frame, eligible["rushing_attempts"], rushing_rows, season, enhanced_features,
        "rushing_yards", "rushing_attempts", False,
    )
    return {
        "passing_attempts": passing,
        "passing_completions": np.minimum(
            passing,
            0.75 * passing * qb_auxiliary["completion_rate"] + 0.25 * incumbent["passing_completions"],
        ),
        "passing_yards": 0.75 * passing * qb_auxiliary["yards_per_attempt"] + 0.25 * incumbent["passing_yards"],
        "rushing_attempts": rushing,
        "rushing_yards": rushing * yards_per_carry,
        "receptions": np.minimum(targets, targets * catch_rate),
        "receiving_yards": targets * yards_per_target,
    }


def distribution_report(
    recalibration: Any,
    calibration_contract: dict[str, Any],
    actual: dict[int, np.ndarray],
    prediction: dict[int, np.ndarray],
) -> dict[str, Any]:
    grid = int(calibration_contract["empiricalQuantileGridSize"])
    minimum = int(calibration_contract["minimumBucketRows"])
    fit_y, select_y, holdout_y = (actual[season] for season in SEASONS)
    fit_mu, select_mu, holdout_mu = (prediction[season] for season in SEASONS)
    choices = {
        "empirical_residual_global": recalibration.empirical_distribution(fit_y - fit_mu, grid),
        "empirical_residual_mean_quartile": recalibration.bucketed_empirical_distribution(
            fit_y - fit_mu, fit_mu, grid, minimum,
        ),
    }
    selection = {
        name: recalibration.empirical_metrics(select_y, select_mu, distribution)
        for name, distribution in choices.items()
    }
    selected = min(selection, key=lambda name: recalibration.selection_key(selection[name], calibration_contract))
    combined_y = np.concatenate([fit_y, select_y])
    combined_mu = np.concatenate([fit_mu, select_mu])
    final = (
        recalibration.empirical_distribution(combined_y - combined_mu, grid)
        if selected == "empirical_residual_global"
        else recalibration.bucketed_empirical_distribution(combined_y - combined_mu, combined_mu, grid, minimum)
    )
    return {
        "selected": selected,
        "confirmation": selection[selected],
        "holdout": recalibration.empirical_metrics(holdout_y, holdout_mu, final),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("props_budget_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_budget_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("props_budget_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    recalibration = load_module("props_budget_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
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
    teams = team_games(frame, team_features)
    eligible = {market: baseline.market_eligible(frame, contract["markets"][market]) for market in MARKETS}

    rows_by_season: dict[int, dict[str, pd.DataFrame]] = {}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    incumbent: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}
    coherence: dict[str, dict[str, int]] = {}
    for season in SEASONS:
        print(f"opportunity-budget season {season}...", flush=True)
        rows, incumbent_season, qb_auxiliary = incumbent_predictions(
            trainer, frame, eligible, season, base_features, enhanced_features,
        )
        rows_by_season[season] = rows
        for market in MARKETS:
            actual[market][season] = rows[market][market].to_numpy(float)
            incumbent[market][season] = incumbent_season[market]
        budgets = {
            name: budget_predictions(teams, season, team_features, config["target"])
            for name, config in OPPORTUNITIES.items()
        }
        allocations_by_opportunity = {
            name: allocated_opportunities(
                frame, season, enhanced_features, budgets[name], config["target"],
                config["positions"], config["prior_share"], POOL_WEIGHTS,
            )
            for name, config in OPPORTUNITIES.items()
        }
        for pool_weight in POOL_WEIGHTS:
            allocations = {
                name: values[pool_weight]
                for name, values in allocations_by_opportunity.items()
            }
            architecture = candidate_predictions(
                trainer, frame, rows, incumbent_season, qb_auxiliary, eligible,
                allocations, season, enhanced_features,
            )
            for market in MARKETS:
                for blend_weight in BLEND_WEIGHTS:
                    name = f"pool_{int(pool_weight * 100)}_blend_{int(blend_weight * 100)}"
                    prediction = (
                        (1.0 - blend_weight) * incumbent_season[market]
                        + blend_weight * architecture[market]
                    )
                    candidates[market].setdefault(name, {})[season] = np.clip(prediction, 0.0, None)
            key = f"pool_{int(pool_weight * 100)}_{season}"
            coherence[key] = {
                "completionGreaterThanAttemptsRows": int(np.sum(
                    architecture["passing_completions"] > architecture["passing_attempts"] + 1e-9
                )),
                "negativeProjectionRows": int(sum(np.sum(values < -1e-9) for values in architecture.values())),
            }

    report: dict[str, Any] = {}
    for market in MARKETS:
        selection_reference = point_metrics(actual[market][2023], incumbent[market][2023])
        selection_scores = {
            name: point_metrics(actual[market][2023], predictions[2023])
            for name, predictions in candidates[market].items()
        }
        eligible_names = [name for name, score in selection_scores.items() if (
            float(score["mae"]) < float(selection_reference["mae"])
            and float(score["rmse"]) < float(selection_reference["rmse"])
        )]
        selected = min(eligible_names, key=lambda name: (
            float(selection_scores[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_scores[name]["rmse"]) / float(selection_reference["rmse"])
        )) if eligible_names else None
        confirmation_reference = point_metrics(actual[market][2024], incumbent[market][2024])
        confirmation_candidate = (
            point_metrics(actual[market][2024], candidates[market][selected][2024]) if selected else None
        )
        confirmed = bool(selected and confirmation_candidate
                         and float(confirmation_candidate["mae"]) < float(confirmation_reference["mae"])
                         and float(confirmation_candidate["rmse"]) < float(confirmation_reference["rmse"]))
        chosen_predictions = candidates[market][selected] if confirmed and selected else incumbent[market]
        holdout_reference = point_metrics(actual[market][2025], incumbent[market][2025])
        holdout_candidate = point_metrics(actual[market][2025], chosen_predictions[2025])
        clustered = baseline.cluster_bootstrap_delta(
            rows_by_season[2025][market],
            np.abs(actual[market][2025] - chosen_predictions[2025]),
            np.abs(actual[market][2025] - incumbent[market][2025]),
        )
        report[market] = {
            "selection": {"incumbent": selection_reference, "candidates": selection_scores, "selected": selected},
            "confirmation": {"incumbent": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "holdout": {"incumbent": holdout_reference, "candidate": holdout_candidate, "clusteredMaeDelta": clustered},
            "distribution": {
                "incumbent": distribution_report(recalibration, calibration_contract, actual[market], incumbent[market]),
                "candidate": distribution_report(recalibration, calibration_contract, actual[market], chosen_predictions),
            },
        }

    output = {
        "release": "nfl_player_props_opportunity_budget_tournament_2026_10_07_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "architecture": {
            "teamBudgets": ["passing_attempts", "rushing_attempts", "targets"],
            "allocation": "full relevant roster normalized share with role-prior partial pooling",
            "poolWeights": POOL_WEIGHTS,
            "incumbentBlendWeights": BLEND_WEIGHTS,
            "teamFeatureCount": len(team_features),
            "playerFeatureCount": len(enhanced_features),
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
                "distribution": values["distribution"],
            }
            for market, values in report.items()
        },
        "coherence": coherence,
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
