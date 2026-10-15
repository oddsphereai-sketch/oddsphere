#!/usr/bin/env python3
"""Chronological NBA spread-residual challenger audit.

The model target is actual home margin minus the pregame market-implied home
margin. Candidate selection uses 2023 to fit and 2024 to select; 2025 remains
sealed confirmation. This research tool never changes production behavior.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_spread_residual_challenger_2026_10_15_r1_chronological"
INCUMBENT = {
    "group": "ratings_schedule",
    "architecture": "margin_total",
    "model": {"family": "ridge", "alpha": 1000.0},
}
ALPHAS = (0.1, 1.0, 10.0, 100.0, 1000.0, 10000.0)
THRESHOLDS = (0.0, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.025, 0.03)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def wilson_lower(wins: int, decisions: int, z: float = 1.96) -> float | None:
    if decisions <= 0:
        return None
    rate = wins / decisions
    denominator = 1 + z * z / decisions
    center = rate + z * z / (2 * decisions)
    margin = z * math.sqrt(rate * (1 - rate) / decisions + z * z / (4 * decisions * decisions))
    return float((center - margin) / denominator)


def chronological_independent_rows(
    frame: pd.DataFrame,
    groups: dict[str, list[str]],
) -> dict[int, pd.DataFrame]:
    output: dict[int, pd.DataFrame] = {}
    for season in (2023, 2024, 2025):
        train = frame[frame["season"] < season].copy()
        evaluate = frame[frame["season"] == season].copy()
        home, away, _ = professional.fit_predict(
            train,
            evaluate,
            groups[str(INCUMBENT["group"])],
            dict(INCUMBENT["model"]),
            str(INCUMBENT["architecture"]),
        )
        line = evaluate["evaluation_opening_home_spread"].to_numpy(float)
        evaluate["independent_market_edge"] = home - away + line
        evaluate["market_line_abs"] = np.abs(line)
        evaluate["market_home_favorite"] = (line < 0).astype(float)
        evaluate["target_market_residual"] = evaluate["target_home_margin"].to_numpy(float) + line
        output[season] = evaluate[np.isfinite(line)].copy()
    return output


def fit_residual(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    features: list[str],
    alpha: float,
) -> tuple[np.ndarray, np.ndarray]:
    model = {"family": "ridge", "alpha": alpha}
    x_train, x_evaluate, _ = professional.design_matrices(train, evaluate, features, model)
    coefficients = professional.fit_regressor(
        x_train,
        train["target_market_residual"].to_numpy(float),
        model,
    )
    return (
        professional.predict_regressor(x_evaluate, coefficients),
        professional.predict_regressor(x_train, coefficients),
    )


def residual_sigma(frame: pd.DataFrame, fitted: np.ndarray) -> float:
    return float(np.std(frame["target_market_residual"].to_numpy(float) - fitted, ddof=1))


def metrics(frame: pd.DataFrame, prediction: np.ndarray, sigma: float) -> dict[str, Any]:
    actual = frame["target_market_residual"].to_numpy(float)
    resolved = ~np.isclose(actual, 0.0)
    outcome = actual[resolved] > 0
    selected_home = prediction[resolved] >= 0
    home_probability = np.clip(
        professional.normal_cdf(prediction[resolved] / max(sigma, 1e-6)),
        0.001,
        0.999,
    )
    correlation = np.corrcoef(prediction, actual)[0, 1] if len(actual) > 1 else math.nan
    return {
        "rows": int(len(actual)),
        "resolved": int(resolved.sum()),
        "residualMae": float(np.abs(prediction - actual).mean()),
        "residualRmse": float(np.sqrt(np.square(prediction - actual).mean())),
        "residualBias": float((prediction - actual).mean()),
        "residualPearson": float(correlation) if np.isfinite(correlation) else None,
        "directionAccuracy": float((selected_home == outcome).mean()) if resolved.any() else None,
        "brier": float(np.square(home_probability - outcome).mean()) if resolved.any() else None,
        "meanAbsolutePredictedResidual": float(np.abs(prediction).mean()),
        "residualSigma": sigma,
    }


def candidate_score(candidate: dict[str, Any], incumbent: dict[str, Any]) -> float:
    candidate_error = 1 - float(candidate["directionAccuracy"])
    incumbent_error = max(1e-9, 1 - float(incumbent["directionAccuracy"]))
    return float(
        0.40 * float(candidate["brier"]) / float(incumbent["brier"])
        + 0.35 * float(candidate["residualMae"]) / float(incumbent["residualMae"])
        + 0.25 * candidate_error / incumbent_error
    )


def exact_price_return(
    frame: pd.DataFrame,
    prediction: np.ndarray,
    keep: np.ndarray,
) -> dict[str, Any] | None:
    actual = frame["target_market_residual"].to_numpy(float)
    selected_home = prediction >= 0
    home_price = frame["evaluation_opening_home_spread_price"].to_numpy(float)
    away_price = frame["evaluation_opening_away_spread_price"].to_numpy(float)
    price = np.where(selected_home, home_price, away_price)
    priced = keep & np.isfinite(price) & (price != 0)
    if not priced.any():
        return None
    wins = selected_home == (actual > 0)
    profit = np.where(price > 0, price / 100, 100 / -price)
    units = np.where(wins, profit, -1.0)
    return {
        "bets": int(priced.sum()),
        "wins": int(wins[priced].sum()),
        "losses": int((~wins[priced]).sum()),
        "units": float(units[priced].sum()),
        "roi": float(units[priced].mean()),
    }


def threshold_report(
    frame: pd.DataFrame,
    prediction: np.ndarray,
    sigma: float,
    threshold: float,
) -> dict[str, Any]:
    actual = frame["target_market_residual"].to_numpy(float)
    home_probability = np.clip(
        professional.normal_cdf(prediction / max(sigma, 1e-6)),
        0.001,
        0.999,
    )
    selected_probability = np.maximum(home_probability, 1 - home_probability)
    resolved = ~np.isclose(actual, 0.0)
    keep = resolved & (selected_probability - 0.5 >= threshold)
    wins = (prediction >= 0) == (actual > 0)
    bets = int(keep.sum())
    win_count = int(wins[keep].sum())
    return {
        "threshold": threshold,
        "bets": bets,
        "wins": win_count,
        "losses": bets - win_count,
        "accuracy": float(win_count / bets) if bets else None,
        "wilson95Lower": wilson_lower(win_count, bets),
        "exactPrice": exact_price_return(frame, prediction, keep),
    }


def main() -> None:
    args = parse_args()
    frame = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(frame)
    chronological = chronological_independent_rows(frame, groups)
    development = chronological[2023]
    selection = chronological[2024]
    confirmation = chronological[2025]

    group_definitions = {
        "edge_only": ["independent_market_edge"],
        "edge_topology": ["independent_market_edge", "market_line_abs", "market_home_favorite"],
        "ratings_schedule": [
            "independent_market_edge", "market_line_abs", "market_home_favorite",
            *groups["ratings_schedule"],
        ],
        "four_factors_schedule": [
            "independent_market_edge", "market_line_abs", "market_home_favorite",
            *groups["four_factors_schedule"],
        ],
        "rotation_schedule": [
            "independent_market_edge", "market_line_abs", "market_home_favorite",
            *groups["rotation_schedule"],
        ],
    }
    group_definitions = {
        name: list(dict.fromkeys(features)) for name, features in group_definitions.items()
    }

    incumbent_development_error = (
        development["target_market_residual"].to_numpy(float)
        - development["independent_market_edge"].to_numpy(float)
    )
    incumbent_sigma = float(np.std(incumbent_development_error, ddof=1))
    incumbent_selection = metrics(
        selection,
        selection["independent_market_edge"].to_numpy(float),
        incumbent_sigma,
    )
    candidates: list[dict[str, Any]] = []
    for group, features in group_definitions.items():
        for alpha in ALPHAS:
            prediction, fitted = fit_residual(development, selection, features, alpha)
            sigma = residual_sigma(development, fitted)
            candidate_metrics = metrics(selection, prediction, sigma)
            candidates.append({
                "group": group,
                "featureCount": len(features),
                "alpha": alpha,
                "selection": candidate_metrics,
                "relativeSelectionScore": candidate_score(candidate_metrics, incumbent_selection),
                "selectionGatePassed": bool(
                    float(candidate_metrics["residualMae"]) < float(incumbent_selection["residualMae"])
                    and float(candidate_metrics["brier"]) < float(incumbent_selection["brier"])
                    and float(candidate_metrics["directionAccuracy"])
                    >= float(incumbent_selection["directionAccuracy"]) + 0.005
                ),
            })
    candidates.sort(key=lambda row: (
        not row["selectionGatePassed"],
        row["relativeSelectionScore"],
        row["selection"]["brier"],
    ))
    selected = candidates[0]
    selected_features = group_definitions[str(selected["group"])]

    fit = pd.concat([development, selection], ignore_index=True)
    confirmation_prediction, fitted = fit_residual(
        fit,
        confirmation,
        selected_features,
        float(selected["alpha"]),
    )
    confirmation_sigma = residual_sigma(fit, fitted)
    confirmation_metrics = metrics(confirmation, confirmation_prediction, confirmation_sigma)
    incumbent_fit_error = (
        fit["target_market_residual"].to_numpy(float)
        - fit["independent_market_edge"].to_numpy(float)
    )
    incumbent_confirmation_sigma = float(np.std(incumbent_fit_error, ddof=1))
    incumbent_confirmation = metrics(
        confirmation,
        confirmation["independent_market_edge"].to_numpy(float),
        incumbent_confirmation_sigma,
    )

    selection_prediction, selection_fitted = fit_residual(
        development,
        selection,
        selected_features,
        float(selected["alpha"]),
    )
    selection_sigma = residual_sigma(development, selection_fitted)
    threshold_candidates = [
        threshold_report(selection, selection_prediction, selection_sigma, threshold)
        for threshold in THRESHOLDS
    ]
    eligible_thresholds = [
        row for row in threshold_candidates
        if row["bets"] >= 100
        and row["wilson95Lower"] is not None
        and float(row["wilson95Lower"]) >= 0.50
    ]
    eligible_thresholds.sort(key=lambda row: (
        -float(row["wilson95Lower"]),
        -row["bets"],
    ))
    selected_threshold = eligible_thresholds[0] if eligible_thresholds else None
    confirmation_threshold = (
        None if selected_threshold is None else threshold_report(
            confirmation,
            confirmation_prediction,
            confirmation_sigma,
            float(selected_threshold["threshold"]),
        )
    )

    provenance_confirmation = {}
    for provenance, cohort in confirmation.groupby("evaluation_market_provenance", sort=True):
        positions = confirmation.index.get_indexer(cohort.index)
        provenance_confirmation[str(provenance)] = metrics(
            cohort,
            confirmation_prediction[positions],
            confirmation_sigma,
        )

    confirmation_gate = bool(
        float(confirmation_metrics["directionAccuracy"]) >= 0.525
        and confirmation_threshold is not None
        and confirmation_threshold["wilson95Lower"] is not None
        and float(confirmation_threshold["wilson95Lower"]) >= 0.50
        and confirmation_threshold["exactPrice"] is not None
        and confirmation_threshold["exactPrice"]["bets"] >= 500
        and confirmation_threshold["exactPrice"]["units"] > 0
    )
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "method": "fit_2023_select_2024_sealed_2025_confirmation",
        "target": "actual_home_margin_minus_pregame_market_implied_home_margin",
        "incumbent": INCUMBENT,
        "selectionMarketProvenance": selection["evaluation_market_provenance"].value_counts().to_dict(),
        "confirmationMarketProvenance": confirmation["evaluation_market_provenance"].value_counts().to_dict(),
        "incumbentSelection": incumbent_selection,
        "selected": selected,
        "thresholdSelection": {
            "selected": selected_threshold,
            "candidates": threshold_candidates,
        },
        "confirmation": {
            "candidate": confirmation_metrics,
            "incumbent": incumbent_confirmation,
            "selectedThreshold": confirmation_threshold,
            "byProvenance": provenance_confirmation,
            "gatePassed": confirmation_gate,
        },
        "promotionEligible": bool(selected["selectionGatePassed"] and confirmation_gate),
        "limitations": [
            "2023 uses a public pregame reference with unknown timestamp, 2024 uses documented multibook consensus, and 2025 mixes consensus with timestamped BALLDONTLIE openings.",
            "Historical split and same-book line-movement sequences are unavailable.",
            "Only rows with exact captured prices enter confirmation ROI.",
        ],
        "candidates": candidates,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "report": str(args.output),
        "selected": selected,
        "confirmation": report["confirmation"],
        "promotionEligible": report["promotionEligible"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
