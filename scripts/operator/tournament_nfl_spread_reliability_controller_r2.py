#!/usr/bin/env python3
"""Frozen walk-forward NFL Spread reliability controller (research only)."""

from __future__ import annotations

import json
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import ndtri

import tournament_nfl_nonlinear_market_ensemble_r1 as base
from tournament_nfl_market_context_residual_r1 import (
    FEATURE_RELEASE,
    add_market_context,
    model_feature_columns,
    sha256_file,
)


TOURNAMENT_RELEASE = "nfl_spread_reliability_controller_tournament_2026_09_21_r2"
DEVELOPMENT_SEASONS = tuple(range(2019, 2024))
CONFIRMATION_SEASONS = (2024, 2025)
MINIMUM_RESOLVED = 16
INVERT_BELOW_ACCURACY = 0.475
ACTION_EDGE = 0.032


def season_probabilities(
    frame: pd.DataFrame,
    features: list[str],
    season: int,
) -> tuple[pd.DataFrame, np.ndarray, np.ndarray, np.ndarray]:
    push = frame["actual_margin"].eq(frame["market_home_margin"])
    outcome = frame["actual_margin"].gt(frame["market_home_margin"]).astype(int)
    train = frame["season"].lt(season) & ~push
    test = frame["season"].eq(season) & ~push
    model = base.estimator("spread")
    model.fit(frame.loc[train, features], outcome.loc[train])
    raw = model.predict_proba(frame.loc[test, features])[:, 1]
    rows = frame.loc[test].copy()
    fair = rows["market_spread_fair_home"].to_numpy(float)
    base_probability = base.blended_probability(raw, fair, base.MARKETS["spread"]["model_weight"])
    observed = outcome.loc[test].to_numpy(int)
    controlled = np.empty_like(base_probability)
    prior_correct: list[bool] = []
    inverted = np.zeros(len(rows), dtype=bool)

    rows = rows.reset_index(drop=True)
    for _, week_rows in rows.groupby("week", sort=True):
        indices = week_rows.index.to_numpy()
        reliability = float(np.mean(prior_correct)) if len(prior_correct) >= MINIMUM_RESOLVED else 1.0
        invert = reliability < INVERT_BELOW_ACCURACY
        controlled[indices] = 1.0 - base_probability[indices] if invert else base_probability[indices]
        inverted[indices] = invert
        prior_correct.extend(list((base_probability[indices] >= 0.5) == observed[indices]))
    return rows, controlled, fair, observed


def summarize_actions(
    rows: pd.DataFrame,
    probability: np.ndarray,
    fair: np.ndarray,
    outcome: np.ndarray,
    seasons: tuple[int, ...],
) -> dict[str, Any]:
    edge = probability - fair
    first = edge >= ACTION_EDGE
    second = edge <= -ACTION_EDGE
    selected = first | second
    records: list[dict[str, Any]] = []
    for index in np.where(selected)[0]:
        take_first = bool(first[index])
        won = bool(outcome[index]) if take_first else not bool(outcome[index])
        price = float(rows.iloc[index]["home_spread_odds" if take_first else "away_spread_odds"])
        records.append({
            "season": int(rows.iloc[index]["season"]),
            "won": won,
            "first": take_first,
            "units": base.profit_one(price) if won else -1.0,
        })

    def summary(subset: list[dict[str, Any]]) -> dict[str, Any]:
        wins = sum(bool(row["won"]) for row in subset)
        units = float(sum(row["units"] for row in subset))
        return {
            "resolved": len(subset),
            "wins": wins,
            "losses": len(subset) - wins,
            "accuracy": wins / len(subset) if subset else None,
            "units": units,
            "roiPerUnitRisked": units / len(subset) if subset else None,
        }

    return {
        "minimumEdge": ACTION_EDGE,
        "directions": {"home": int(first.sum()), "away": int(second.sum())},
        "pooled": summary(records),
        "bySeason": {
            str(season): summary([row for row in records if row["season"] == season])
            for season in seasons
        },
    }


def evaluate(
    frame: pd.DataFrame,
    features: list[str],
    seasons: tuple[int, ...],
) -> dict[str, Any]:
    frames: list[pd.DataFrame] = []
    probabilities: list[np.ndarray] = []
    fairs: list[np.ndarray] = []
    outcomes: list[np.ndarray] = []
    by_season: dict[str, Any] = {}
    for season in seasons:
        rows, probability, fair, outcome = season_probabilities(frame, features, season)
        fit_residual = (
            frame.loc[frame["season"].lt(season), "actual_margin"].to_numpy(float)
            - frame.loc[frame["season"].lt(season), "market_home_margin"].to_numpy(float)
        )
        scale = float(np.std(fit_residual, ddof=1))
        correction = np.clip(ndtri(np.clip(probability, 0.001, 0.999)) * scale, -base.POINT_CAP, base.POINT_CAP)
        actual = rows["actual_margin"].to_numpy(float)
        market = rows["market_home_margin"].to_numpy(float)
        candidate = market + correction
        by_season[str(season)] = {
            "candidateProbability": base.probability_metrics(probability, outcome),
            "marketProbability": base.probability_metrics(fair, outcome),
            "candidatePoint": base.point_metrics(actual, candidate),
            "marketPoint": base.point_metrics(actual, market),
            "meanAbsolutePointCorrection": float(np.mean(np.abs(correction))),
            "directions": {
                "home": int(np.sum(probability >= 0.5)),
                "away": int(np.sum(probability < 0.5)),
            },
        }
        frames.append(rows)
        probabilities.append(probability)
        fairs.append(fair)
        outcomes.append(outcome)

    rows = pd.concat(frames, ignore_index=True)
    probability = np.concatenate(probabilities)
    fair = np.concatenate(fairs)
    outcome = np.concatenate(outcomes)
    point_actual = rows["actual_margin"].to_numpy(float)
    point_market = rows["market_home_margin"].to_numpy(float)
    # Reconstruct pooled candidate points season by season using the recorded
    # per-season residual scales.
    point_candidate_parts = []
    offset = 0
    for season in seasons:
        count = int(rows["season"].eq(season).sum())
        season_probability = probability[offset:offset + count]
        fit_residual = (
            frame.loc[frame["season"].lt(season), "actual_margin"].to_numpy(float)
            - frame.loc[frame["season"].lt(season), "market_home_margin"].to_numpy(float)
        )
        correction = np.clip(
            ndtri(np.clip(season_probability, 0.001, 0.999)) * float(np.std(fit_residual, ddof=1)),
            -base.POINT_CAP,
            base.POINT_CAP,
        )
        point_candidate_parts.append(point_market[offset:offset + count] + correction)
        offset += count
    point_candidate = np.concatenate(point_candidate_parts)
    return {
        "candidateProbability": base.probability_metrics(probability, outcome),
        "marketProbability": base.probability_metrics(fair, outcome),
        "candidatePoint": base.point_metrics(point_actual, point_candidate),
        "marketPoint": base.point_metrics(point_actual, point_market),
        "bySeason": by_season,
        "actions": summarize_actions(rows, probability, fair, outcome, seasons),
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
    frame = add_market_context(pd.read_parquet(feature_path)).sort_values(
        ["season", "week", "gameday", "game_id"]
    ).reset_index(drop=True)
    features = model_feature_columns(frame)
    development = evaluate(frame, features, DEVELOPMENT_SEASONS)
    confirmation = evaluate(frame, features, CONFIRMATION_SEASONS)
    gates = {
        "pooledAccuracyAboveHalf": confirmation["candidateProbability"]["accuracy"] > 0.5,
        "eachSeasonAccuracyAtLeastHalf": all(
            row["candidateProbability"]["accuracy"] >= 0.5
            for row in confirmation["bySeason"].values()
        ),
        "pooledBrierBounded": (
            confirmation["candidateProbability"]["brier"]
            <= confirmation["marketProbability"]["brier"] + 0.001
        ),
        "seasonBrierBounded": all(
            row["candidateProbability"]["brier"]
            <= row["marketProbability"]["brier"] + 0.0025
            for row in confirmation["bySeason"].values()
        ),
        "bothDirectionsEachSeason": all(
            row["directions"]["home"] > 0 and row["directions"]["away"] > 0
            for row in confirmation["bySeason"].values()
        ),
        "pointMaeBounded": (
            confirmation["candidatePoint"]["mae"]
            <= confirmation["marketPoint"]["mae"] + 0.10
        ),
        "atLeastThirtyActions": confirmation["actions"]["pooled"]["resolved"] >= 30,
        "actionAccuracyAtLeastHalf": (
            confirmation["actions"]["pooled"]["accuracy"] is not None
            and confirmation["actions"]["pooled"]["accuracy"] >= 0.5
        ),
        "positiveActionUnits": confirmation["actions"]["pooled"]["units"] > 0,
        "seasonActionRoiBounded": all(
            row["roiPerUnitRisked"] is not None and row["roiPerUnitRisked"] >= -0.05
            for row in confirmation["actions"]["bySeason"].values()
        ),
        "bothActionDirections": (
            confirmation["actions"]["directions"]["home"] > 0
            and confirmation["actions"]["directions"]["away"] > 0
        ),
    }
    gates["historicalConfirmationPassed"] = all(gates.values())
    confirmation["gates"] = gates
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-09-21-nfl-spread-reliability-controller-predeclaration.md",
        "localOnly": True,
        "productionBehaviorChanged": False,
        "developmentSeasons": DEVELOPMENT_SEASONS,
        "confirmationSeasons": CONFIRMATION_SEASONS,
        "minimumResolved": MINIMUM_RESOLVED,
        "invertBelowAccuracy": INVERT_BELOW_ACCURACY,
        "actionEdge": ACTION_EDGE,
        "development": development,
        "confirmation": confirmation,
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "development": development,
        "confirmation": confirmation,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
