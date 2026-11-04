#!/usr/bin/env python3
"""Market-free component/joint Rushing + Receiving Yards tournament."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

import tournament_nfl_player_props_passing_touchdowns as common
import tournament_nfl_player_props_remaining_yards as prior


RELEASE = "nfl_player_props_combined_yards_joint_2026_10_16_r1"
LINES = (39.5, 49.5, 59.5, 69.5, 79.5)
CANDIDATES = ("component_hgb_raw", "component_hgb_log_smear", "opportunity_efficiency_hgb")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    cli = parse_args()
    frame = prior.build_combined_yards(pd.read_parquet(cli.features))
    train = frame[frame["season"].between(2017, 2024)].copy()
    validation = frame[frame["season"].eq(2025)].copy()
    current = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    columns = prior.model_features(frame, "rushing_receiving_yards")

    train_components = {"foundation": foundation_components(train)}
    validation_components = {"foundation": foundation_components(validation)}
    fitted = fit_candidates(train, columns)
    for name in CANDIDATES:
        train_components[name] = predict_candidate(fitted[name], train, columns, name)
        validation_components[name] = predict_candidate(fitted[name], validation, columns, name)
    train_pools = {
        name: residual_pools(train, components) for name, components in train_components.items()
    }
    validation_probabilities = {
        name: empirical_probabilities(validation, components, train_pools[name])
        for name, components in validation_components.items()
    }
    validation_metrics = {
        name: metrics(validation, components, validation_probabilities[name])
        for name, components in validation_components.items()
    }
    selected = min(CANDIDATES, key=lambda name: (
        validation_metrics[name]["mae"], validation_metrics[name]["rmse"],
        validation_metrics[name]["averageThresholdBrier"], name,
    ))

    through_2025 = pd.concat([train, validation], ignore_index=True)
    final_model = fit_candidates(through_2025, columns, only=selected)[selected]
    current_components = {
        "foundation": foundation_components(current),
        selected: predict_candidate(final_model, current, columns, selected),
    }
    final_pools = {
        "foundation": residual_pools(validation, validation_components["foundation"]),
        selected: residual_pools(validation, validation_components[selected]),
    }
    current_probabilities = {
        name: empirical_probabilities(current, components, final_pools[name])
        for name, components in current_components.items()
    }
    current_metrics = {
        name: metrics(current, components, current_probabilities[name])
        for name, components in current_components.items()
    }
    bootstrap = paired_bootstrap(
        current, current_components["foundation"], current_components[selected],
        current_probabilities["foundation"], current_probabilities[selected],
    )
    gate = advancement_gate(current_metrics["foundation"], current_metrics[selected], bootstrap)
    result = {
        "release": RELEASE,
        "readOnly": True,
        "productionWrites": 0,
        "marketFeatures": [],
        "marketOfferRows": 0,
        "selectionSeason": 2025,
        "currentSeasonDiagnostic": {"season": 2026, "weeks": [2, 3, 4, 5], "untouchedHoldout": False},
        "architecture": {
            "components": ["rushing_yards", "receiving_yards"],
            "opportunities": ["rushing_attempts", "targets"],
            "efficiencies": ["yards_per_carry", "yards_per_target"],
            "probabilities": "position-conditioned empirical paired component residuals with nonnegative components",
        },
        "data": {"trainRows": len(train), "validationRows": len(validation), "currentRows": len(current), "featureCount": len(columns)},
        "validation2025": validation_metrics,
        "selection": {"winner": selected, "criterion": "minimum MAE; RMSE then average threshold Brier"},
        "validationResidualDependence": {
            "foundation": dependence_summary(validation, validation_components["foundation"]),
            selected: dependence_summary(validation, validation_components[selected]),
        },
        "currentSeason2026Weeks2To5": current_metrics,
        "currentSeasonPairedGameBootstrap95": bootstrap,
        "advancement": {
            **gate,
            "productionAuthorized": False,
            "reason": "Research-only: the current-season slice has already been inspected and no release-pure exact-price economic ledger exists.",
        },
        "limitations": [
            "The 2026 replay is a repeated diagnostic, not an untouched holdout.",
            "Complete routes, alignment, red-zone routes, and end-zone targets are not entitled in current feeds.",
            "The eligible-player frame is a role proxy rather than the historical sportsbook offer universe.",
        ],
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE, "selection": result["selection"],
        "validation2025": validation_metrics, "currentSeason2026Weeks2To5": current_metrics,
        "bootstrap": bootstrap, "advancement": result["advancement"],
    }, indent=2, allow_nan=False))


def hgb() -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", HistGradientBoostingRegressor(
            loss="squared_error", learning_rate=0.035, max_iter=250, max_leaf_nodes=15,
            max_depth=4, min_samples_leaf=60, l2_regularization=15.0, random_state=20261016,
        )),
    ])


def fit_candidates(frame: pd.DataFrame, columns: list[str], only: str | None = None) -> dict:
    requested = CANDIDATES if only is None else (only,)
    x = numeric_x(frame, columns)
    fitted = {}
    for name in requested:
        if name == "component_hgb_raw":
            models = {target: hgb().fit(x, outcome(frame, target)) for target in ("rushing_yards", "receiving_yards")}
            fitted[name] = {"models": models}
        elif name == "component_hgb_log_smear":
            models, smears = {}, {}
            for target in ("rushing_yards", "receiving_yards"):
                actual = outcome(frame, target)
                model = hgb().fit(x, np.log1p(actual))
                models[target] = model
                smears[target] = float(np.mean(np.exp(np.log1p(actual) - model.predict(x))))
            fitted[name] = {"models": models, "smears": smears}
        else:
            opportunity = {target: hgb().fit(x, outcome(frame, target)) for target in ("rushing_attempts", "targets")}
            efficiency = {}
            for yards, volume in (("rushing_yards", "rushing_attempts"), ("receiving_yards", "targets")):
                actual_volume = outcome(frame, volume)
                eligible = actual_volume > 0
                efficiency[yards] = hgb().fit(x.loc[eligible], outcome(frame, yards)[eligible] / actual_volume[eligible])
            fitted[name] = {"opportunity": opportunity, "efficiency": efficiency}
    return fitted


def predict_candidate(model: dict, frame: pd.DataFrame, columns: list[str], name: str) -> dict[str, np.ndarray]:
    x = numeric_x(frame, columns)
    if name == "component_hgb_raw":
        return {target: np.clip(model["models"][target].predict(x), 0, 250) for target in ("rushing_yards", "receiving_yards")}
    if name == "component_hgb_log_smear":
        return {
            target: np.clip(np.exp(model["models"][target].predict(x)) * model["smears"][target] - 1, 0, 250)
            for target in ("rushing_yards", "receiving_yards")
        }
    attempts = np.clip(model["opportunity"]["rushing_attempts"].predict(x), 0, 35)
    targets = np.clip(model["opportunity"]["targets"].predict(x), 0, 20)
    ypc = np.clip(model["efficiency"]["rushing_yards"].predict(x), 0, 15)
    ypt = np.clip(model["efficiency"]["receiving_yards"].predict(x), 0, 25)
    return {"rushing_yards": attempts * ypc, "receiving_yards": targets * ypt}


def foundation_components(frame: pd.DataFrame) -> dict[str, np.ndarray]:
    return {
        "rushing_yards": common.row_mean(frame, ["prior_rushing_yards_avg3", "prior_rushing_yards_avg5", "prior_rushing_yards_ewm"], fallback=0),
        "receiving_yards": common.row_mean(frame, ["prior_receiving_yards_avg3", "prior_receiving_yards_avg5", "prior_receiving_yards_ewm"], fallback=0),
    }


def residual_pools(frame: pd.DataFrame, components: dict[str, np.ndarray]) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    rush = outcome(frame, "rushing_yards") - components["rushing_yards"]
    receive = outcome(frame, "receiving_yards") - components["receiving_yards"]
    pools = {"__all__": bounded_pair(rush, receive)}
    positions = frame["position"].fillna("UNK").astype(str).to_numpy()
    for position in np.unique(positions):
        take = positions == position
        if take.sum() >= 100:
            pools[position] = bounded_pair(rush[take], receive[take])
    return pools


def bounded_pair(rush: np.ndarray, receive: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if len(rush) <= 4_000:
        return rush, receive
    indices = np.linspace(0, len(rush) - 1, 4_000, dtype=int)
    return rush[indices], receive[indices]


def empirical_probabilities(frame: pd.DataFrame, components: dict[str, np.ndarray], pools: dict) -> np.ndarray:
    result = np.zeros((len(frame), len(LINES)))
    positions = frame["position"].fillna("UNK").astype(str).to_numpy()
    for index, position in enumerate(positions):
        rush_residual, receive_residual = pools.get(position, pools["__all__"])
        samples = np.clip(components["rushing_yards"][index] + rush_residual, 0, None)
        samples += np.clip(components["receiving_yards"][index] + receive_residual, 0, None)
        result[index] = [np.mean(samples > line) for line in LINES]
    return result


def metrics(frame: pd.DataFrame, components: dict[str, np.ndarray], probabilities: np.ndarray) -> dict:
    actual = outcome(frame, "rushing_yards") + outcome(frame, "receiving_yards")
    projection = components["rushing_yards"] + components["receiving_yards"]
    thresholds = {}
    for index, line in enumerate(LINES):
        observed = (actual > line).astype(float)
        thresholds[str(line)] = {
            "brier": float(np.mean(np.square(probabilities[:, index] - observed))),
            "observedRate": float(np.mean(observed)), "meanProbability": float(np.mean(probabilities[:, index])),
        }
    return {
        "rows": len(frame), "meanActual": float(np.mean(actual)), "meanProjection": float(np.mean(projection)),
        "meanRushingProjection": float(np.mean(components["rushing_yards"])),
        "meanReceivingProjection": float(np.mean(components["receiving_yards"])),
        "mae": float(np.mean(np.abs(actual - projection))),
        "rmse": float(math.sqrt(np.mean(np.square(actual - projection)))),
        "averageThresholdBrier": float(np.mean([row["brier"] for row in thresholds.values()])),
        "thresholds": thresholds,
    }


def dependence_summary(frame: pd.DataFrame, components: dict[str, np.ndarray]) -> dict:
    rush = outcome(frame, "rushing_yards") - components["rushing_yards"]
    receive = outcome(frame, "receiving_yards") - components["receiving_yards"]
    return {"pairedRows": len(frame), "residualCovariance": float(np.cov(rush, receive, ddof=1)[0, 1]), "residualCorrelation": float(np.corrcoef(rush, receive)[0, 1])}


def paired_bootstrap(frame: pd.DataFrame, base: dict, candidate: dict, base_probability: np.ndarray, candidate_probability: np.ndarray, iterations: int = 2_000) -> dict:
    games = frame["game_id"].astype(str).to_numpy()
    unique = np.unique(games)
    indices = {game: np.flatnonzero(games == game) for game in unique}
    rng = np.random.default_rng(20261016)
    samples = {"maeDelta": [], "rmseDelta": [], "averageThresholdBrierDelta": []}
    for _ in range(iterations):
        take = np.concatenate([indices[game] for game in rng.choice(unique, size=len(unique), replace=True)])
        sliced = frame.iloc[take]
        base_metric = metrics(sliced, {key: value[take] for key, value in base.items()}, base_probability[take])
        cand_metric = metrics(sliced, {key: value[take] for key, value in candidate.items()}, candidate_probability[take])
        samples["maeDelta"].append(cand_metric["mae"] - base_metric["mae"])
        samples["rmseDelta"].append(cand_metric["rmse"] - base_metric["rmse"])
        samples["averageThresholdBrierDelta"].append(cand_metric["averageThresholdBrier"] - base_metric["averageThresholdBrier"])
    return {"clusters": len(unique), "iterations": iterations, "deltaDefinition": "candidate minus foundation; negative favors candidate", **{key: common.interval(values) for key, values in samples.items()}}


def advancement_gate(foundation: dict, candidate: dict, bootstrap: dict) -> dict:
    wins = sum(candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"] for line in LINES)
    rmse_ci = bootstrap["rmseDelta"]["ci"]
    checks = {
        "maeImproved": candidate["mae"] < foundation["mae"],
        "rmseImproved": candidate["rmse"] < foundation["rmse"],
        "averageBrierImproved": candidate["averageThresholdBrier"] < foundation["averageThresholdBrier"],
        "thresholdBrierWinsAtLeastFour": wins >= 4,
        "absoluteMeanBiasBelowFive": abs(candidate["meanProjection"] - candidate["meanActual"]) < 5,
        "rmseBootstrapExcludesZeroImproving": rmse_ci[1] < 0,
    }
    return {"accuracyGatePass": all(checks.values()), "thresholdBrierWins": wins, "checks": checks}


def numeric_x(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    return frame[columns].apply(pd.to_numeric, errors="coerce")


def outcome(frame: pd.DataFrame, column: str) -> np.ndarray:
    return pd.to_numeric(frame[column], errors="coerce").fillna(0).clip(lower=0).to_numpy(float)


if __name__ == "__main__":
    main()
