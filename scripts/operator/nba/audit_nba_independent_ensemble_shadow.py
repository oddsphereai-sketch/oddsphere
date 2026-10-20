#!/usr/bin/env python3
"""Chronological, research-only NBA independent ensemble audit."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.operator import tournament_nba_professional_model as tournament


RELEASE = "nba_independent_ensemble_shadow_2026_10_20_r1_chronological"
MARGIN_RATING_WEIGHTS = (0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40)
TOTAL_RATING_WEIGHTS = (0.0, 0.05, 0.10, 0.15, 0.20)
ROLLING_SEASONS = (2022, 2023, 2024)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def normal_cdf(values: np.ndarray) -> np.ndarray:
    return 0.5 * (1.0 + np.vectorize(math.erf)(values / math.sqrt(2.0)))


def calibration_slope(predicted: np.ndarray, actual: np.ndarray) -> float | None:
    if len(predicted) < 2 or float(np.std(predicted)) <= 1e-9:
        return None
    return float(np.polyfit(predicted, actual, 1)[0])


def metrics(frame: pd.DataFrame, home: np.ndarray, away: np.ndarray) -> dict[str, Any]:
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    margin = home - away
    total = home + away
    winner_correct = (margin > 0) == (actual_margin > 0)
    probability = np.clip(normal_cdf(margin / 12.0), 0.001, 0.999)
    close = np.abs(margin) < 3.0
    return {
        "games": int(len(frame)),
        "teamScoreMae": float(np.mean(np.concatenate([
            np.abs(home - actual_home), np.abs(away - actual_away),
        ]))),
        "marginMae": float(np.mean(np.abs(margin - actual_margin))),
        "totalMae": float(np.mean(np.abs(total - actual_total))),
        "winnerAccuracy": float(winner_correct.mean()),
        "winnerBrier": float(np.mean(np.square(probability - (actual_margin > 0).astype(float)))),
        "predictedMarginSd": float(np.std(margin, ddof=1)),
        "actualMarginSd": float(np.std(actual_margin, ddof=1)),
        "marginCalibrationSlope": calibration_slope(margin, actual_margin),
        "insideThree": {
            "games": int(close.sum()),
            "share": float(close.mean()),
            "winnerAccuracy": float(winner_correct[close].mean()) if close.any() else None,
            "marginMae": float(np.abs(margin[close] - actual_margin[close]).mean()) if close.any() else None,
        },
    }


def predict_components(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    features: list[str],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    reference_home, reference_away, _ = tournament.fit_predict(
        train,
        evaluate,
        features,
        {"family": "ridge", "alpha": 1000.0},
        "margin_total",
    )
    rating_home, rating_away = tournament.rating_baseline(
        evaluate,
        float(train["target_home_margin"].mean()),
    )
    return reference_home, reference_away, rating_home, rating_away


def combine(
    reference_home: np.ndarray,
    reference_away: np.ndarray,
    rating_home: np.ndarray,
    rating_away: np.ndarray,
    margin_weight: float,
    total_weight: float,
) -> tuple[np.ndarray, np.ndarray]:
    reference_margin = reference_home - reference_away
    reference_total = reference_home + reference_away
    rating_margin = rating_home - rating_away
    rating_total = rating_home + rating_away
    margin = (1.0 - margin_weight) * reference_margin + margin_weight * rating_margin
    total = (1.0 - total_weight) * reference_total + total_weight * rating_total
    return (total + margin) / 2.0, (total - margin) / 2.0


def relative_joint(candidate: dict[str, Any], reference: dict[str, Any]) -> float:
    return float(np.mean([
        candidate["teamScoreMae"] / reference["teamScoreMae"],
        candidate["marginMae"] / reference["marginMae"],
        candidate["totalMae"] / reference["totalMae"],
    ]))


def main() -> None:
    parsed = parse_args()
    frame = tournament.validate(tournament.read_jsonl(parsed.features))
    groups = tournament.feature_catalog(frame)
    origins: dict[int, dict[str, Any]] = {}
    recipes: dict[str, list[dict[str, Any]]] = {}
    for season in ROLLING_SEASONS:
        train = frame[frame["season"] < season].copy()
        evaluate = frame[frame["season"] == season].copy()
        components = predict_components(train, evaluate, groups["ratings_schedule"])
        reference = metrics(evaluate, components[0], components[1])
        origins[season] = {"reference": reference}
        for margin_weight in MARGIN_RATING_WEIGHTS:
            for total_weight in TOTAL_RATING_WEIGHTS:
                name = f"margin_{margin_weight:.2f}_total_{total_weight:.2f}"
                home, away = combine(*components, margin_weight, total_weight)
                measured = metrics(evaluate, home, away)
                recipes.setdefault(name, []).append({
                    "season": season,
                    "metrics": measured,
                    "relativeJoint": relative_joint(measured, reference),
                })

    ranked = []
    for name, rows in recipes.items():
        margin_weight = float(name.split("_")[1])
        total_weight = float(name.split("_")[3])
        relative_scores = [row["relativeJoint"] for row in rows]
        margin_improvements = [
            origins[row["season"]]["reference"]["marginMae"] - row["metrics"]["marginMae"]
            for row in rows
        ]
        winner_deltas = [
            row["metrics"]["winnerAccuracy"] - origins[row["season"]]["reference"]["winnerAccuracy"]
            for row in rows
        ]
        brier_deltas = [
            row["metrics"]["winnerBrier"] - origins[row["season"]]["reference"]["winnerBrier"]
            for row in rows
        ]
        eligible = bool(
            max(relative_scores) <= 1.0025
            and float(np.mean(winner_deltas)) >= -0.0025
            and float(np.mean(brier_deltas)) <= 0.001
            and float(np.mean(margin_improvements)) > 0
        )
        ranked.append({
            "name": name,
            "marginRatingWeight": margin_weight,
            "totalRatingWeight": total_weight,
            "meanRelativeJoint": float(np.mean(relative_scores)),
            "worstRelativeJoint": float(max(relative_scores)),
            "meanMarginMaeImprovement": float(np.mean(margin_improvements)),
            "meanWinnerAccuracyDelta": float(np.mean(winner_deltas)),
            "meanWinnerBrierDelta": float(np.mean(brier_deltas)),
            "eligible": eligible,
            "origins": rows,
        })
    eligible = [candidate for candidate in ranked if candidate["eligible"]]
    eligible.sort(key=lambda candidate: (
        candidate["meanRelativeJoint"],
        -candidate["meanMarginMaeImprovement"],
        candidate["name"],
    ))
    if not eligible:
        raise ValueError("No independent ensemble candidate cleared the predeclared selection gates.")
    selected = eligible[0]

    confirmation_train = frame[frame["season"] < 2025].copy()
    confirmation = frame[frame["season"] == 2025].copy()
    components = predict_components(confirmation_train, confirmation, groups["ratings_schedule"])
    reference = metrics(confirmation, components[0], components[1])
    selected_home, selected_away = combine(
        *components,
        selected["marginRatingWeight"],
        selected["totalRatingWeight"],
    )
    candidate = metrics(confirmation, selected_home, selected_away)
    gates = {
        "teamScoreMaeImproves": candidate["teamScoreMae"] < reference["teamScoreMae"],
        "marginMaeImproves": candidate["marginMae"] < reference["marginMae"],
        "totalMaeWithinTolerance": candidate["totalMae"] <= reference["totalMae"] + 0.01,
        "winnerAccuracyNoRegression": candidate["winnerAccuracy"] >= reference["winnerAccuracy"],
        "winnerBrierNoRegression": candidate["winnerBrier"] <= reference["winnerBrier"],
        "closeWinnerAccuracyNoRegression": (
            candidate["insideThree"]["winnerAccuracy"]
            >= reference["insideThree"]["winnerAccuracy"]
        ),
    }
    promotion_eligible = all(gates.values()) and (
        selected["marginRatingWeight"] > 0 or selected["totalRatingWeight"] > 0
    )
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "chronology": {
            "rollingSelectionSeasons": list(ROLLING_SEASONS),
            "confirmationSeason": 2025,
        },
        "selection": {
            "selected": selected,
            "eligibleCandidates": len(eligible),
            "topEligible": eligible[:10],
        },
        "confirmation": {"reference": reference, "candidate": candidate},
        "gates": gates,
        "promotionEligible": promotion_eligible,
        "productionAuthority": False,
    }
    parsed.output.parent.mkdir(parents=True, exist_ok=True)
    parsed.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "selected": {
            key: selected[key]
            for key in (
                "name", "marginRatingWeight", "totalRatingWeight",
                "meanRelativeJoint", "worstRelativeJoint",
                "meanMarginMaeImprovement", "meanWinnerAccuracyDelta",
                "meanWinnerBrierDelta",
            )
        },
        "confirmation": report["confirmation"],
        "gates": gates,
        "promotionEligible": promotion_eligible,
        "output": str(parsed.output),
    }, indent=2))


if __name__ == "__main__":
    main()
