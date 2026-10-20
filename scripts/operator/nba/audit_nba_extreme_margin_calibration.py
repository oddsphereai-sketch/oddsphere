#!/usr/bin/env python3
"""Chronological audit of NBA expected-margin and blowout calibration.

The independent score remains market-free. Candidate mean calibrations use
only the prior season's independent forecast and final margin. The existing
categorical market reader is then applied as the final-product layer. Closing
lines are evaluation and reader-proxy fields, never independent inputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.operator import audit_nba_unified_final_projection as unified
from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_extreme_margin_calibration_audit_2026_10_20_r2"
GLOBAL_MARGIN_SIGMA = 12.964104634449086
KNOTS = (3.0, 6.0, 9.0, 12.0)
RIDGE_ALPHAS = (10.0, 100.0, 1000.0)
SIGMA_PSEUDO_COUNTS = (25, 50, 100)
SIGMA_BANDS = (0.0, 3.0, 6.0, 9.0, float("inf"))
MIXTURE_CORE_MULTIPLIERS = (0.75, 0.85, 0.95)
MIXTURE_TAIL_WEIGHTS = (0.05, 0.10, 0.15, 0.20)
MIXTURE_TAIL_MULTIPLIERS = (1.5, 2.0, 2.5)
EPSILON = 1e-12


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--selection-market", type=Path, required=True)
    parser.add_argument("--confirmation-market", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def normal_cdf(values: np.ndarray) -> np.ndarray:
    return np.array([
        0.5 * (1.0 + math.erf(float(value) / math.sqrt(2.0)))
        for value in values
    ])


def binary_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    clipped = np.clip(probability, 1e-9, 1 - 1e-9)
    return {
        "brier": float(np.mean(np.square(clipped - outcome))),
        "logLoss": float(np.mean(-(outcome * np.log(clipped) + (1 - outcome) * np.log(1 - clipped)))),
        "calibrationInTheLarge": float(np.mean(clipped) - np.mean(outcome)),
        "forecastMean": float(np.mean(clipped)),
        "outcomeRate": float(np.mean(outcome)),
    }


def reliability(probability: np.ndarray, outcome: np.ndarray) -> list[dict[str, Any]]:
    edges = (0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 1.0000001)
    rows = []
    for lower, upper in zip(edges[:-1], edges[1:]):
        mask = (probability >= lower) & (probability < upper)
        if not mask.any():
            continue
        rows.append({
            "lower": lower,
            "upper": min(upper, 1.0),
            "games": int(mask.sum()),
            "forecastMean": float(np.mean(probability[mask])),
            "outcomeRate": float(np.mean(outcome[mask])),
        })
    return rows


@dataclass(frozen=True)
class MeanRecipe:
    name: str
    coefficients: tuple[float, ...]
    alpha: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "coefficients": list(self.coefficients),
            "alpha": self.alpha,
            "knots": list(KNOTS) if self.name == "piecewise" else [],
        }


@dataclass(frozen=True)
class SigmaRecipe:
    name: str
    pseudo_count: int | None
    band_sigmas: tuple[float, ...]
    core_multiplier: float | None = None
    tail_weight: float | None = None
    tail_multiplier: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "pseudoCount": self.pseudo_count,
            "bands": list(SIGMA_BANDS),
            "bandSigmas": list(self.band_sigmas),
            "coreMultiplier": self.core_multiplier,
            "tailWeight": self.tail_weight,
            "tailMultiplier": self.tail_multiplier,
        }


def signed_piecewise_design(margin: np.ndarray) -> np.ndarray:
    magnitude = np.abs(margin)
    direction = np.sign(margin)
    return np.column_stack([
        margin,
        *[direction * np.maximum(magnitude - knot, 0.0) for knot in KNOTS],
    ])


def fit_mean_recipes(frame: pd.DataFrame) -> list[MeanRecipe]:
    prediction = frame["independent_margin"].to_numpy(float)
    target = frame["target_home_margin"].to_numpy(float)
    slope = float(np.dot(prediction, target) / max(float(np.dot(prediction, prediction)), EPSILON))
    recipes = [
        MeanRecipe("identity", (1.0,)),
        MeanRecipe("slope", (slope,)),
    ]
    design = signed_piecewise_design(prediction)
    gram = design.T @ design
    for alpha in RIDGE_ALPHAS:
        coefficients = np.linalg.solve(
            gram + alpha * np.eye(gram.shape[0]),
            design.T @ target,
        )
        interval_slopes = np.cumsum(coefficients)
        if np.all(interval_slopes > 0):
            recipes.append(MeanRecipe("piecewise", tuple(float(value) for value in coefficients), alpha))
    return recipes


def apply_mean_recipe(margin: np.ndarray, recipe: MeanRecipe) -> np.ndarray:
    if recipe.name == "identity":
        return margin.copy()
    if recipe.name == "slope":
        return margin * recipe.coefficients[0]
    if recipe.name == "piecewise":
        return signed_piecewise_design(margin) @ np.array(recipe.coefficients)
    raise ValueError(f"unsupported mean recipe {recipe.name}")


def final_projection(frame: pd.DataFrame, independent_margin: np.ndarray) -> dict[str, np.ndarray]:
    market_margin = -frame["close_spread_home"].to_numpy(float)
    spread_support = frame["spread_home_support"].to_numpy(float)
    qualified_spread = np.abs(spread_support) >= 2.0
    spread_direction = np.where(spread_support >= 0, 1.0, -1.0)
    spread_residual = independent_margin - market_margin
    incumbent_margin = market_margin + spread_direction * np.maximum(np.abs(spread_residual), 0.25)
    spread_applied = qualified_spread & (np.sign(spread_residual) != spread_direction)
    final_margin = independent_margin.copy()
    for index in np.flatnonzero(spread_applied):
        lower = -np.inf
        upper = np.inf
        if incumbent_margin[index] >= 0:
            lower = max(lower, 0.25)
        else:
            upper = min(upper, -0.25)
        if spread_direction[index] > 0:
            lower = max(lower, market_margin[index] + 0.25)
        else:
            upper = min(upper, market_margin[index] - 0.25)
        final_margin[index] = (
            min(max(independent_margin[index], lower), upper)
            if lower <= upper else incumbent_margin[index]
        )

    independent_total = frame["independent_total"].to_numpy(float)
    market_total = frame["close_total"].to_numpy(float)
    total_move = market_total - frame["open_total"].to_numpy(float)
    total_residual = independent_total - market_total
    total_qualified = (np.abs(total_move) >= 5.0) & (np.abs(total_residual) >= 5.0)
    total_direction = np.where(total_move >= 0, 1.0, -1.0)
    total_applied = total_qualified & (np.sign(total_residual) != total_direction)
    final_total = np.where(total_applied, market_total + total_direction * 0.25, independent_total)
    return {
        "margin": final_margin,
        "total": final_total,
        "marketMargin": market_margin,
        "marketTotal": market_total,
        "spreadApplied": spread_applied,
        "totalApplied": total_applied,
    }


def sigma_band_index(margin: np.ndarray) -> np.ndarray:
    magnitude = np.abs(margin)
    return np.digitize(magnitude, SIGMA_BANDS[1:-1], right=False)


def fit_sigma_recipes(frame: pd.DataFrame, final_margin: np.ndarray) -> list[SigmaRecipe]:
    actual = frame["target_home_margin"].to_numpy(float)
    residual = actual - final_margin
    indexes = sigma_band_index(final_margin)
    recipes = [SigmaRecipe("global", None, (GLOBAL_MARGIN_SIGMA,) * 4)]
    global_variance = GLOBAL_MARGIN_SIGMA ** 2
    for pseudo_count in SIGMA_PSEUDO_COUNTS:
        sigmas = []
        for band in range(4):
            values = residual[indexes == band]
            variance_sum = float(np.sum(np.square(values)))
            variance = (variance_sum + pseudo_count * global_variance) / (len(values) + pseudo_count)
            sigmas.append(float(math.sqrt(variance)))
        recipes.append(SigmaRecipe("banded", pseudo_count, tuple(sigmas)))
    for core_multiplier in MIXTURE_CORE_MULTIPLIERS:
        for tail_weight in MIXTURE_TAIL_WEIGHTS:
            for tail_multiplier in MIXTURE_TAIL_MULTIPLIERS:
                recipes.append(SigmaRecipe(
                    "mixture",
                    None,
                    (GLOBAL_MARGIN_SIGMA,) * 4,
                    core_multiplier,
                    tail_weight,
                    tail_multiplier,
                ))
    return recipes


def apply_sigma_recipe(margin: np.ndarray, recipe: SigmaRecipe) -> np.ndarray:
    indexes = sigma_band_index(margin)
    sigmas = np.array(recipe.band_sigmas)
    return sigmas[indexes]


def residual_cdf(values: np.ndarray, margin: np.ndarray, recipe: SigmaRecipe) -> np.ndarray:
    if recipe.name != "mixture":
        return normal_cdf(values / apply_sigma_recipe(margin, recipe))
    core_sigma = GLOBAL_MARGIN_SIGMA * float(recipe.core_multiplier)
    tail_sigma = GLOBAL_MARGIN_SIGMA * float(recipe.tail_multiplier)
    tail_weight = float(recipe.tail_weight)
    return (
        (1.0 - tail_weight) * normal_cdf(values / core_sigma)
        + tail_weight * normal_cdf(values / tail_sigma)
    )


def resolved_accuracy(prediction: np.ndarray, actual: np.ndarray) -> dict[str, Any]:
    resolved = ~np.isclose(actual, 0.0)
    wins = (prediction[resolved] >= 0) == (actual[resolved] > 0)
    return {
        "decisions": int(resolved.sum()),
        "wins": int(wins.sum()),
        "pushes": int((~resolved).sum()),
        "accuracy": float(np.mean(wins)) if wins.size else None,
    }


def spread_accuracy(
    frame: pd.DataFrame,
    final_margin: np.ndarray,
    cushion: float = 0.0,
    mask: np.ndarray | None = None,
) -> dict[str, Any]:
    market_margin = -frame["close_spread_home"].to_numpy(float)
    actual_spread_result = frame["target_home_margin"].to_numpy(float) - market_margin
    selected_home = final_margin - market_margin >= 0
    selected_result = np.where(selected_home, actual_spread_result, -actual_spread_result) + cushion
    if mask is not None:
        selected_result = selected_result[mask]
    return resolved_accuracy(np.ones(len(selected_result)), selected_result)


def cohort_report(frame: pd.DataFrame, final_margin: np.ndarray) -> dict[str, Any]:
    market_margin = -frame["close_spread_home"].to_numpy(float)
    actual_margin = frame["target_home_margin"].to_numpy(float)
    absolute_line = np.abs(market_margin)
    favorite_home = market_margin > 0
    selected_home = final_margin - market_margin >= 0
    selected_favorite = selected_home == favorite_home
    actual_spread = actual_margin - market_margin
    selected_result = np.where(selected_home, actual_spread, -actual_spread)
    resolved = ~np.isclose(selected_result, 0.0)
    correct = selected_result > 0
    buckets = {
        "0_2_5": absolute_line < 3,
        "3_5_5": (absolute_line >= 3) & (absolute_line < 6),
        "6_8_5": (absolute_line >= 6) & (absolute_line < 9),
        "9_11_5": (absolute_line >= 9) & (absolute_line < 12),
        "12_plus": absolute_line >= 12,
        "10_plus": absolute_line >= 10,
    }
    output = {}
    for name, mask in buckets.items():
        decided = mask & resolved
        output[name] = {
            "games": int(mask.sum()),
            "meanMarketAbsMargin": float(np.mean(np.abs(market_margin[mask]))),
            "meanProjectedAbsMargin": float(np.mean(np.abs(final_margin[mask]))),
            "meanActualAbsMargin": float(np.mean(np.abs(actual_margin[mask]))),
            "favoriteSelections": int((selected_favorite & mask).sum()),
            "underdogSelections": int((~selected_favorite & mask).sum()),
            "favoriteSelectionRate": float(np.mean(selected_favorite[mask])),
            "spreadAccuracy": float(np.mean(correct[decided])) if decided.any() else None,
        }
    return output


def margin_calibration(frame: pd.DataFrame, predicted_margin: np.ndarray) -> dict[str, Any]:
    actual_margin = frame["target_home_margin"].to_numpy(float)
    direction = np.where(predicted_margin >= 0, 1.0, -1.0)
    predicted_magnitude = np.abs(predicted_margin)
    oriented_actual = actual_margin * direction
    edges = (0.0, 3.0, 6.0, 9.0, 12.0, 15.0, 20.0, float("inf"))
    rows = []
    for lower, upper in zip(edges[:-1], edges[1:]):
        mask = (predicted_magnitude >= lower) & (predicted_magnitude < upper)
        if not mask.any():
            continue
        rows.append({
            "lower": lower,
            "upper": None if math.isinf(upper) else upper,
            "games": int(mask.sum()),
            "meanProjectedMagnitude": float(np.mean(predicted_magnitude[mask])),
            "meanOrientedActualMargin": float(np.mean(oriented_actual[mask])),
            "winnerAccuracy": float(np.mean(oriented_actual[mask] > 0)),
            "actual20PlusInPredictedDirectionRate": float(np.mean(oriented_actual[mask] >= 20)),
        })
    slope = float(
        np.dot(predicted_margin, actual_margin)
        / max(float(np.dot(predicted_margin, predicted_margin)), EPSILON)
    )
    return {
        "zeroCenteredCalibrationSlope": slope,
        "bands": rows,
    }


def metrics(
    frame: pd.DataFrame,
    final: dict[str, np.ndarray],
    sigma_recipe: SigmaRecipe,
) -> dict[str, Any]:
    margin = final["margin"]
    total = final["total"]
    actual_margin = frame["target_home_margin"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    home = (total + margin) / 2
    away = (total - margin) / 2

    home_win_probability = np.clip(1.0 - residual_cdf(-margin, margin, sigma_recipe), 1e-9, 1 - 1e-9)
    home_win = (actual_margin > 0).astype(float)
    winner = binary_metrics(home_win_probability, home_win)
    winner["accuracy"] = float(np.mean((margin >= 0) == (actual_margin > 0)))

    blowout_probability = np.clip(
        residual_cdf(-20.0 - margin, margin, sigma_recipe)
        + 1.0 - residual_cdf(20.0 - margin, margin, sigma_recipe),
        1e-9,
        1 - 1e-9,
    )
    blowout = (np.abs(actual_margin) >= 20).astype(float)
    blowout_metrics = binary_metrics(blowout_probability, blowout)
    blowout_metrics["reliability"] = reliability(blowout_probability, blowout)

    spread_residual = margin - final["marketMargin"]
    selected_home = spread_residual >= 0
    home_favorite = final["marketMargin"] > 0
    underdog = selected_home != home_favorite
    actual_spread = actual_margin - final["marketMargin"]
    selected_spread_result = np.where(selected_home, actual_spread, -actual_spread)
    resolved = ~np.isclose(selected_spread_result, 0.0)

    total_edge = total - final["marketTotal"]
    actual_total_edge = actual_total - final["marketTotal"]
    large_spread = np.abs(final["marketMargin"]) >= 10
    return {
        "games": int(len(frame)),
        "teamScoreMae": float(np.mean(np.concatenate([np.abs(home - actual_home), np.abs(away - actual_away)]))),
        "marginMae": float(np.mean(np.abs(margin - actual_margin))),
        "totalMae": float(np.mean(np.abs(total - actual_total))),
        "winner": winner,
        "blowout20Plus": blowout_metrics,
        "spread": spread_accuracy(frame, margin),
        "spread10Plus": spread_accuracy(frame, margin, mask=large_spread),
        "spreadPlus3": spread_accuracy(frame, margin, cushion=3.0),
        "spreadPlus6": spread_accuracy(frame, margin, cushion=6.0),
        "total": resolved_accuracy(total_edge, actual_total_edge),
        "underdog": {
            "decisions": int((underdog & resolved).sum()),
            "accuracy": float(np.mean(selected_spread_result[underdog & resolved] > 0))
            if (underdog & resolved).any() else None,
        },
        "marginDistribution": {
            "absGe10Rate": float(np.mean(np.abs(margin) >= 10)),
            "absGe15Rate": float(np.mean(np.abs(margin) >= 15)),
            "absGe20Rate": float(np.mean(np.abs(margin) >= 20)),
            "maxAbs": float(np.max(np.abs(margin))),
            "actualAbsGe20Rate": float(np.mean(np.abs(actual_margin) >= 20)),
        },
        "marginCalibration": margin_calibration(frame, margin),
        "cohorts": cohort_report(frame, margin),
        "reader": {
            "spreadApplied": int(final["spreadApplied"].sum()),
            "totalApplied": int(final["totalApplied"].sum()),
        },
    }


def gate(candidate: dict[str, Any], incumbent: dict[str, Any]) -> dict[str, bool]:
    no_worse = lambda value, baseline: value <= baseline + 1e-12
    no_lower = lambda value, baseline: value + 1e-12 >= baseline
    return {
        "blowoutBrierImproves": candidate["blowout20Plus"]["brier"] < incumbent["blowout20Plus"]["brier"],
        "blowoutLogLossImproves": candidate["blowout20Plus"]["logLoss"] < incumbent["blowout20Plus"]["logLoss"],
        "blowoutCalibrationImproves": abs(candidate["blowout20Plus"]["calibrationInTheLarge"]) < abs(incumbent["blowout20Plus"]["calibrationInTheLarge"]),
        "teamScoreMaeNoRegression": no_worse(candidate["teamScoreMae"], incumbent["teamScoreMae"]),
        "marginMaeNoRegression": no_worse(candidate["marginMae"], incumbent["marginMae"]),
        "totalMaeNoRegression": no_worse(candidate["totalMae"], incumbent["totalMae"]),
        "winnerAccuracyNoRegression": no_lower(candidate["winner"]["accuracy"], incumbent["winner"]["accuracy"]),
        "winnerBrierNoRegression": no_worse(candidate["winner"]["brier"], incumbent["winner"]["brier"]),
        "winnerLogLossNoRegression": no_worse(candidate["winner"]["logLoss"], incumbent["winner"]["logLoss"]),
        "spreadNoRegression": no_lower(candidate["spread"]["accuracy"], incumbent["spread"]["accuracy"]),
        "spread10PlusNoRegression": no_lower(candidate["spread10Plus"]["accuracy"], incumbent["spread10Plus"]["accuracy"]),
        "spreadPlus3NoRegression": no_lower(candidate["spreadPlus3"]["accuracy"], incumbent["spreadPlus3"]["accuracy"]),
        "spreadPlus6NoRegression": no_lower(candidate["spreadPlus6"]["accuracy"], incumbent["spreadPlus6"]["accuracy"]),
        "totalDirectionNoRegression": no_lower(candidate["total"]["accuracy"], incumbent["total"]["accuracy"]),
        "underdogNoRegression": no_lower(candidate["underdog"]["accuracy"], incumbent["underdog"]["accuracy"]),
    }


def evaluated_candidates(frame: pd.DataFrame) -> list[dict[str, Any]]:
    independent = frame["independent_margin"].to_numpy(float)
    rows = []
    for mean_recipe in fit_mean_recipes(frame):
        calibrated = apply_mean_recipe(independent, mean_recipe)
        final = final_projection(frame, calibrated)
        for sigma_recipe in fit_sigma_recipes(frame, final["margin"]):
            scored = metrics(frame, final, sigma_recipe)
            rows.append({
                "meanRecipe": mean_recipe,
                "sigmaRecipe": sigma_recipe,
                "metrics": scored,
            })
    incumbent = next(
        row for row in rows
        if row["meanRecipe"].name == "identity" and row["sigmaRecipe"].name == "global"
    )
    for row in rows:
        row["gates"] = gate(row["metrics"], incumbent["metrics"])
        row["eligible"] = all(row["gates"].values())
    return rows


def serialize_candidate(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "meanRecipe": row["meanRecipe"].as_dict(),
        "sigmaRecipe": row["sigmaRecipe"].as_dict(),
        "metrics": row["metrics"],
        "gates": row["gates"],
        "eligible": row["eligible"],
    }


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = unified.joined(features, groups, 2024, args.selection_market).sort_values("date_et").reset_index(drop=True)
    candidates = evaluated_candidates(selection)
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        row["metrics"]["blowout20Plus"]["brier"],
        row["metrics"]["marginMae"],
        row["metrics"]["teamScoreMae"],
        row["meanRecipe"].name != "identity",
        row["sigmaRecipe"].name != "global",
        row["meanRecipe"].alpha or 0,
        row["sigmaRecipe"].pseudo_count or 0,
        row["sigmaRecipe"].core_multiplier or 0,
        row["sigmaRecipe"].tail_weight or 0,
        row["sigmaRecipe"].tail_multiplier or 0,
    ))

    selected = eligible[0] if eligible else None
    incumbent_selection = next(
        row for row in candidates
        if row["meanRecipe"].name == "identity" and row["sigmaRecipe"].name == "global"
    )

    # Confirmation is intentionally constructed only after the selection recipe is frozen.
    confirmation = unified.joined(features, groups, 2025, args.confirmation_market).sort_values("date_et").reset_index(drop=True)
    independent_confirmation = confirmation["independent_margin"].to_numpy(float)
    incumbent_final = final_projection(confirmation, independent_confirmation)
    incumbent_confirmation = metrics(
        confirmation,
        incumbent_final,
        SigmaRecipe("global", None, (GLOBAL_MARGIN_SIGMA,) * 4),
    )

    selected_confirmation = None
    confirmation_gates = None
    if selected is not None:
        calibrated = apply_mean_recipe(independent_confirmation, selected["meanRecipe"])
        selected_final = final_projection(confirmation, calibrated)
        selected_confirmation = metrics(
            confirmation,
            selected_final,
            selected["sigmaRecipe"],
        )
        confirmation_gates = gate(selected_confirmation, incumbent_confirmation)

    report = {
        "release": RELEASE,
        "status": "accepted_candidate" if confirmation_gates and all(confirmation_gates.values()) else "rejected_no_candidate",
        "productionAuthority": False,
        "chronology": {
            "selectionSeason": 2024,
            "selectionGames": len(selection),
            "confirmationSeason": 2025,
            "confirmationGames": len(confirmation),
        },
        "inputs": {
            "features": {"path": str(args.features), "sha256": sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": sha256(args.confirmation_market)},
        },
        "selection": {
            "evaluatedCandidates": len(candidates),
            "eligibleCandidates": len(eligible),
            "incumbent": serialize_candidate(incumbent_selection),
            "selected": None if selected is None else serialize_candidate(selected),
            "candidates": [serialize_candidate(row) for row in candidates],
        },
        "confirmation": {
            "incumbent": incumbent_confirmation,
            "candidate": selected_confirmation,
            "gates": confirmation_gates,
            "allGatesPassed": bool(confirmation_gates and all(confirmation_gates.values())),
        },
        "diagnostics": {
            "selectionIndependentMarginCalibration": margin_calibration(
                selection,
                selection["independent_margin"].to_numpy(float),
            ),
            "confirmationIndependentMarginCalibration": margin_calibration(
                confirmation,
                confirmation["independent_margin"].to_numpy(float),
            ),
        },
        "limitations": [
            "2025 has been opened by prior NBA audits and is chronological confirmation, not a pristine future holdout.",
            "Historical reader evidence is public consensus open-to-close proxy data, not exact live same-book trails.",
            "A 20-point realized outcome need not have a 20-point conditional mean; blowout probability calibration is evaluated separately.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE,
        "status": report["status"],
        "selectionEligible": len(eligible),
        "selected": None if selected is None else {
            "meanRecipe": selected["meanRecipe"].as_dict(),
            "sigmaRecipe": selected["sigmaRecipe"].as_dict(),
            "metrics": selected["metrics"],
        },
        "confirmation": report["confirmation"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
