#!/usr/bin/env python3
"""Frozen NFL nonlinear market/football ensemble tournament (research only)."""

from __future__ import annotations

import json
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import expit, logit, ndtri
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error
from sklearn.pipeline import Pipeline

from tournament_nfl_market_context_residual_r1 import (
    FEATURE_RELEASE,
    add_market_context,
    model_feature_columns,
    sha256_file,
)


TOURNAMENT_RELEASE = "nfl_nonlinear_market_ensemble_tournament_2026_09_21_r1"
TRAIN_SEASONS = tuple(range(2016, 2022))
SELECTION_SEASONS = (2022, 2023)
CONFIRMATION_SEASONS = (2024, 2025)
POINT_CAP = 4.0
RANDOM_STATE = 21

MARKETS = {
    "spread": {
        "target": "actual_margin",
        "line": "market_home_margin",
        "fair": "market_spread_fair_home",
        "first_price": "home_spread_odds",
        "second_price": "away_spread_odds",
        "model_weight": 0.10,
        "action_edge": 0.013,
    },
    "total": {
        "target": "actual_total",
        "line": "market_total",
        "fair": "market_total_fair_over",
        "first_price": "over_odds",
        "second_price": "under_odds",
        "model_weight": 1.0,
        "action_edge": 0.025,
    },
}


def estimator(market: str) -> Pipeline:
    if market == "spread":
        model = HistGradientBoostingClassifier(
            learning_rate=0.025,
            max_iter=300,
            max_leaf_nodes=15,
            min_samples_leaf=40,
            l2_regularization=20.0,
            random_state=RANDOM_STATE,
        )
    else:
        model = RandomForestClassifier(
            n_estimators=500,
            min_samples_leaf=10,
            max_features=0.35,
            class_weight="balanced_subsample",
            n_jobs=-1,
            random_state=RANDOM_STATE,
        )
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("model", model),
    ])


def probability_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    p = np.clip(np.asarray(probability, dtype=float), 0.001, 0.999)
    y = np.asarray(outcome, dtype=int)
    return {
        "rows": int(len(y)),
        "accuracy": float(np.mean((p >= 0.5) == y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
    }


def point_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "bias": float(np.mean(predicted - actual)),
    }


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def blended_probability(raw: np.ndarray, fair: np.ndarray, weight: float) -> np.ndarray:
    return expit(
        (1.0 - weight) * logit(np.clip(fair, 0.001, 0.999))
        + weight * logit(np.clip(raw, 0.001, 0.999))
    )


def actions(
    frame: pd.DataFrame,
    probability: np.ndarray,
    fair: np.ndarray,
    outcome: np.ndarray,
    config: dict[str, Any],
) -> dict[str, Any]:
    edge = probability - fair
    first = edge >= config["action_edge"]
    second = edge <= -config["action_edge"]
    selected = first | second
    rows: list[dict[str, Any]] = []
    for index in np.where(selected)[0]:
        take_first = bool(first[index])
        won = bool(outcome[index]) if take_first else not bool(outcome[index])
        price = float(frame.iloc[index][config["first_price"] if take_first else config["second_price"]])
        rows.append({
            "season": int(frame.iloc[index]["season"]),
            "won": won,
            "first": take_first,
            "units": profit_one(price) if won else -1.0,
        })

    def summary(subset: list[dict[str, Any]]) -> dict[str, Any]:
        units = float(sum(row["units"] for row in subset))
        wins = sum(bool(row["won"]) for row in subset)
        return {
            "resolved": len(subset),
            "wins": wins,
            "losses": len(subset) - wins,
            "accuracy": wins / len(subset) if subset else None,
            "units": units,
            "roiPerUnitRisked": units / len(subset) if subset else None,
        }

    return {
        "minimumEdge": config["action_edge"],
        "directions": {"first": int(first.sum()), "second": int(second.sum())},
        "pooled": summary(rows),
        "bySeason": {
            str(season): summary([row for row in rows if row["season"] == season])
            for season in CONFIRMATION_SEASONS
        },
    }


def audit_market(frame: pd.DataFrame, features: list[str], market: str) -> dict[str, Any]:
    config = MARKETS[market]
    push = frame[config["target"]].eq(frame[config["line"]])
    outcome = frame[config["target"]].gt(frame[config["line"]]).astype(int)
    train = frame["season"].isin(TRAIN_SEASONS) & ~push
    selection = frame["season"].isin(SELECTION_SEASONS) & ~push

    selection_model = estimator(market)
    selection_model.fit(frame.loc[train, features], outcome.loc[train])
    selection_raw = selection_model.predict_proba(frame.loc[selection, features])[:, 1]
    selection_fair = frame.loc[selection, config["fair"]].to_numpy(float)
    selection_probability = blended_probability(
        selection_raw, selection_fair, config["model_weight"]
    )
    selection_outcome = outcome.loc[selection].to_numpy(int)
    selection_seasons = frame.loc[selection, "season"].to_numpy(int)

    fit = frame["season"].between(2016, 2023) & ~push
    confirmation_mask = frame["season"].isin(CONFIRMATION_SEASONS) & ~push
    model = estimator(market)
    model.fit(frame.loc[fit, features], outcome.loc[fit])
    raw = model.predict_proba(frame.loc[confirmation_mask, features])[:, 1]
    confirmation = frame.loc[confirmation_mask].reset_index(drop=True)
    fair = confirmation[config["fair"]].to_numpy(float)
    probability = blended_probability(raw, fair, config["model_weight"])
    observed = outcome.loc[confirmation_mask].to_numpy(int)

    fit_residual = (
        frame.loc[fit, config["target"]].to_numpy(float)
        - frame.loc[fit, config["line"]].to_numpy(float)
    )
    residual_scale = float(np.std(fit_residual, ddof=1))
    correction = np.clip(
        ndtri(np.clip(probability, 0.001, 0.999)) * residual_scale,
        -POINT_CAP,
        POINT_CAP,
    )
    market_point = confirmation[config["line"]].to_numpy(float)
    candidate_point = market_point + correction
    actual_point = confirmation[config["target"]].to_numpy(float)
    candidate_metrics = probability_metrics(probability, observed)
    baseline_metrics = probability_metrics(fair, observed)
    candidate_point_metrics = point_metrics(actual_point, candidate_point)
    baseline_point_metrics = point_metrics(actual_point, market_point)

    by_season: dict[str, Any] = {}
    for season in CONFIRMATION_SEASONS:
        keep = confirmation["season"].eq(season).to_numpy()
        by_season[str(season)] = {
            "candidateProbability": probability_metrics(probability[keep], observed[keep]),
            "marketProbability": probability_metrics(fair[keep], observed[keep]),
            "candidatePoint": point_metrics(actual_point[keep], candidate_point[keep]),
            "marketPoint": point_metrics(actual_point[keep], market_point[keep]),
            "directions": {
                "first": int(np.sum(probability[keep] >= 0.5)),
                "second": int(np.sum(probability[keep] < 0.5)),
            },
        }

    action_report = actions(confirmation, probability, fair, observed, config)
    gates = {
        "pooledAccuracyAboveHalf": candidate_metrics["accuracy"] > 0.5,
        "eachSeasonAccuracyAtLeastHalf": all(
            row["candidateProbability"]["accuracy"] >= 0.5 for row in by_season.values()
        ),
        "pooledBrierBounded": candidate_metrics["brier"] <= baseline_metrics["brier"] + 0.001,
        "seasonBrierBounded": all(
            row["candidateProbability"]["brier"]
            <= row["marketProbability"]["brier"] + 0.0025
            for row in by_season.values()
        ),
        "bothDirectionsEachSeason": all(
            row["directions"]["first"] > 0 and row["directions"]["second"] > 0
            for row in by_season.values()
        ),
        "pointMaeBounded": candidate_point_metrics["mae"] <= baseline_point_metrics["mae"] + 0.10,
        "atLeastThirtyActions": action_report["pooled"]["resolved"] >= 30,
        "actionAccuracyAtLeastHalf": (
            action_report["pooled"]["accuracy"] is not None
            and action_report["pooled"]["accuracy"] >= 0.5
        ),
        "positiveActionUnits": action_report["pooled"]["units"] > 0,
        "seasonActionRoiBounded": all(
            row["roiPerUnitRisked"] is not None and row["roiPerUnitRisked"] >= -0.05
            for row in action_report["bySeason"].values()
        ),
        "bothActionDirections": (
            action_report["directions"]["first"] > 0
            and action_report["directions"]["second"] > 0
        ),
    }
    gates["historicalConfirmationPassed"] = all(gates.values())

    return {
        "selection": {
            "probability": probability_metrics(selection_probability, selection_outcome),
            "bySeason": {
                str(season): probability_metrics(
                    selection_probability[selection_seasons == season],
                    selection_outcome[selection_seasons == season],
                )
                for season in SELECTION_SEASONS
            },
            "directions": {
                "first": int(np.sum(selection_probability >= 0.5)),
                "second": int(np.sum(selection_probability < 0.5)),
            },
        },
        "confirmation": {
            "candidateProbability": candidate_metrics,
            "marketProbability": baseline_metrics,
            "candidatePoint": candidate_point_metrics,
            "marketPoint": baseline_point_metrics,
            "meanAbsolutePointCorrection": float(np.mean(np.abs(correction))),
            "residualScale": residual_scale,
            "bySeason": by_season,
            "actions": action_report,
            "gates": gates,
        },
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature artifact checksum mismatch")
    frame = add_market_context(pd.read_parquet(feature_path))
    features = model_feature_columns(frame)
    spread = audit_market(frame, features, "spread")
    total = audit_market(frame, features, "total")
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-09-21-nfl-nonlinear-market-ensemble-predeclaration.md",
        "localOnly": True,
        "productionBehaviorChanged": False,
        "trainingSeasons": TRAIN_SEASONS,
        "selectionSeasons": SELECTION_SEASONS,
        "confirmationSeasons": CONFIRMATION_SEASONS,
        "featureArtifactSha256": manifest["featureFileSha256"],
        "featureCount": len(features),
        "spread": spread,
        "total": total,
        "launchGate": {
            "status": "historical_confirmation_only",
            "reason": "live replay, release implementation, board impact, verification, and forward evidence remain required",
        },
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "spread": spread,
        "total": total,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
