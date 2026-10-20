#!/usr/bin/env python3
"""Chronological audit of a smooth NBA market-residual correction.

The candidate is not a score blend. It learns only the residual error that is
conditionally associated with market movement/price evidence. All features
are constructed so zero evidence yields an exact zero correction.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.operator import audit_nba_unified_final_projection as unified
from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_continuous_market_residual_reader_audit_2026_10_20_r1"
ALPHAS = (1.0, 3.0, 10.0, 30.0, 100.0, 300.0, 1000.0)
SATURATION_SCALES = (2.0, 4.0, 6.0, 8.0, 12.0)
Market = Literal["margin", "total"]


@dataclass(frozen=True)
class Recipe:
    alpha: float
    saturation: float

    def as_dict(self) -> dict[str, float]:
        return {"alpha": self.alpha, "saturationPoints": self.saturation}


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


def signed_hinges(value: np.ndarray, knots: tuple[float, ...]) -> list[np.ndarray]:
    magnitude = np.abs(value)
    direction = np.sign(value)
    return [direction * np.maximum(magnitude - knot, 0.0) for knot in knots]


def evidence_design(frame: pd.DataFrame, market: Market) -> tuple[np.ndarray, list[str]]:
    books = frame["bookmakers"].to_numpy(float)
    books_scale = np.maximum(books / np.nanmedian(books), 0.25)
    if market == "margin":
        movement = frame["spread_home_support"].to_numpy(float)
        price_move = (
            frame["close_home_win_prob"].to_numpy(float)
            - frame["open_home_win_prob"].to_numpy(float)
        ) * 20.0
        independent_edge = (
            frame["independent_margin"].to_numpy(float)
            + frame["close_spread_home"].to_numpy(float)
        )
        knots = (0.5, 1.0, 2.0, 3.0, 4.0)
        columns = [
            movement,
            price_move,
            movement * books_scale,
            price_move * books_scale,
            movement * price_move,
            independent_edge * np.abs(movement),
            independent_edge * np.abs(price_move),
            *signed_hinges(movement, knots),
            *signed_hinges(price_move, knots),
        ]
        names = [
            "spread_move",
            "moneyline_price_move_x20",
            "spread_move_x_book_breadth",
            "price_move_x_book_breadth",
            "spread_x_price_alignment",
            "model_edge_x_abs_spread_move",
            "model_edge_x_abs_price_move",
            *[f"spread_move_hinge_{k}" for k in knots],
            *[f"price_move_hinge_{k}" for k in knots],
        ]
    else:
        movement = (
            frame["close_total"].to_numpy(float)
            - frame["open_total"].to_numpy(float)
        )
        price_skew = (frame["close_over_prob"].to_numpy(float) - 0.5) * 20.0
        independent_edge = (
            frame["independent_total"].to_numpy(float)
            - frame["close_total"].to_numpy(float)
        )
        knots = (0.5, 1.0, 2.0, 3.0, 5.0)
        columns = [
            movement,
            price_skew,
            movement * books_scale,
            price_skew * books_scale,
            movement * price_skew,
            independent_edge * np.abs(movement),
            independent_edge * np.abs(price_skew),
            *signed_hinges(movement, knots),
            *signed_hinges(price_skew, knots),
        ]
        names = [
            "total_move",
            "closing_over_price_skew_x20",
            "total_move_x_book_breadth",
            "price_skew_x_book_breadth",
            "total_x_price_alignment",
            "model_edge_x_abs_total_move",
            "model_edge_x_abs_price_skew",
            *[f"total_move_hinge_{k}" for k in knots],
            *[f"price_skew_hinge_{k}" for k in knots],
        ]
    design = np.column_stack(columns).astype(float)
    if not np.isfinite(design).all():
        raise ValueError(f"{market} evidence design contains non-finite values")
    return design, names


@dataclass
class FittedHead:
    market: Market
    recipe: Recipe
    scales: np.ndarray
    coefficients: np.ndarray
    names: list[str]

    def correction(self, frame: pd.DataFrame) -> np.ndarray:
        design, names = evidence_design(frame, self.market)
        if names != self.names:
            raise ValueError("NBA continuous reader design columns changed after fit")
        raw = (design / self.scales) @ self.coefficients
        return self.recipe.saturation * np.tanh(raw / self.recipe.saturation)


def fit_head(frame: pd.DataFrame, market: Market, recipe: Recipe) -> FittedHead:
    design, names = evidence_design(frame, market)
    scales = np.sqrt(np.mean(np.square(design), axis=0))
    scales = np.where(scales > 1e-9, scales, 1.0)
    standardized = design / scales
    if market == "margin":
        target = (
            frame["target_home_margin"].to_numpy(float)
            - frame["independent_margin"].to_numpy(float)
        )
    else:
        target = (
            frame["target_total"].to_numpy(float)
            - frame["independent_total"].to_numpy(float)
        )
    gram = standardized.T @ standardized
    coefficients = np.linalg.solve(
        gram + recipe.alpha * np.eye(gram.shape[0]),
        standardized.T @ target,
    )
    return FittedHead(market, recipe, scales, coefficients, names)


def score_arrays(
    frame: pd.DataFrame,
    margin_correction: np.ndarray | None = None,
    total_correction: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    independent_margin = frame["independent_margin"].to_numpy(float)
    independent_total = frame["independent_total"].to_numpy(float)
    margin_delta = np.zeros(len(frame)) if margin_correction is None else margin_correction
    total_delta = np.zeros(len(frame)) if total_correction is None else total_correction
    margin = independent_margin + margin_delta
    total = independent_total + total_delta
    market_margin = -frame["close_spread_home"].to_numpy(float)
    return {
        "home": (total + margin) / 2,
        "away": (total - margin) / 2,
        "margin": margin,
        "total": total,
        "marketMargin": market_margin,
        "marketTotal": frame["close_total"].to_numpy(float),
        "spreadResidual": margin - market_margin,
        "movementActive": (np.abs(margin_delta) > 1e-9) | (np.abs(total_delta) > 1e-9),
    }


def incumbent_hard_gate(frame: pd.DataFrame) -> dict[str, np.ndarray]:
    independent_margin = frame["independent_margin"].to_numpy(float)
    independent_total = frame["independent_total"].to_numpy(float)
    market_margin = -frame["close_spread_home"].to_numpy(float)
    spread_move = frame["spread_home_support"].to_numpy(float)
    spread_residual = independent_margin - market_margin
    spread_active = np.abs(spread_move) >= 2.0
    margin = np.where(
        spread_active,
        market_margin + np.sign(spread_move) * np.maximum(np.abs(spread_residual), 0.25),
        independent_margin,
    )
    market_total = frame["close_total"].to_numpy(float)
    total_move = market_total - frame["open_total"].to_numpy(float)
    total_residual = independent_total - market_total
    total_active = (
        (np.abs(total_move) >= 5.0)
        & (np.abs(total_residual) >= 5.0)
        & (np.sign(total_move) != np.sign(total_residual))
    )
    total = np.where(total_active, market_total - total_residual, independent_total)
    return {
        "home": (total + margin) / 2,
        "away": (total - margin) / 2,
        "margin": margin,
        "total": total,
        "marketMargin": market_margin,
        "marketTotal": market_total,
        "spreadResidual": margin - market_margin,
        "movementActive": spread_active | total_active,
    }


def compact_metrics(frame: pd.DataFrame, scored: dict[str, np.ndarray]) -> dict[str, Any]:
    metrics = unified.metrics(frame, scored)
    correction_margin = scored["margin"] - frame["independent_margin"].to_numpy(float)
    correction_total = scored["total"] - frame["independent_total"].to_numpy(float)
    close_spread = frame["close_spread_home"].to_numpy(float)
    actual_margin = frame["target_home_margin"].to_numpy(float)
    picked_home = scored["margin"] + close_spread >= 0
    picked_underdog = picked_home == (close_spread > 0)
    resolved = ~np.isclose(actual_margin + close_spread, 0.0)
    correct = picked_home == (actual_margin + close_spread > 0)
    underdog = picked_underdog & resolved
    return {
        "games": metrics["games"],
        "teamScoreMae": metrics["teamScoreMae"],
        "marginMae": metrics["marginMae"],
        "totalMae": metrics["totalMae"],
        "winnerAccuracy": metrics["winnerAccuracy"],
        "homeWinBrier": metrics["homeWinBrier"],
        "spreadAccuracy": metrics["spread"]["accuracy"],
        "spreadWilson95Lower": metrics["spread"]["wilson95Lower"],
        "spreadPlus3Accuracy": metrics["spreadPlus3"]["accuracy"],
        "spreadPlus6Accuracy": metrics["spreadPlus6"]["accuracy"],
        "totalAccuracy": metrics["total"]["accuracy"],
        "underdog": {
            "decisions": int(underdog.sum()),
            "accuracy": float(correct[underdog].mean()) if underdog.any() else None,
        },
        "corrections": {
            "marginMeanAbs": float(np.mean(np.abs(correction_margin))),
            "marginP95Abs": float(np.quantile(np.abs(correction_margin), 0.95)),
            "marginMaxAbs": float(np.max(np.abs(correction_margin))),
            "totalMeanAbs": float(np.mean(np.abs(correction_total))),
            "totalP95Abs": float(np.quantile(np.abs(correction_total), 0.95)),
            "totalMaxAbs": float(np.max(np.abs(correction_total))),
        },
    }


def select_margin_head(train: pd.DataFrame, validation: pd.DataFrame) -> tuple[FittedHead | None, list[dict[str, Any]]]:
    baseline = compact_metrics(validation, score_arrays(validation))
    results: list[dict[str, Any]] = []
    for alpha in ALPHAS:
        for saturation in SATURATION_SCALES:
            recipe = Recipe(alpha, saturation)
            head = fit_head(train, "margin", recipe)
            metrics = compact_metrics(validation, score_arrays(validation, head.correction(validation), None))
            eligible = bool(
                metrics["marginMae"] < baseline["marginMae"]
                and metrics["winnerAccuracy"] >= baseline["winnerAccuracy"] - 0.002
                and metrics["homeWinBrier"] <= baseline["homeWinBrier"] + 0.001
                and metrics["spreadAccuracy"] >= baseline["spreadAccuracy"]
            )
            results.append({"recipe": recipe.as_dict(), "eligible": eligible, "metrics": metrics})
    eligible = [row for row in results if row["eligible"]]
    eligible.sort(key=lambda row: (
        row["metrics"]["marginMae"],
        row["metrics"]["teamScoreMae"],
        -row["metrics"]["spreadAccuracy"],
        row["recipe"]["alpha"],
        row["recipe"]["saturationPoints"],
    ))
    if not eligible:
        return None, results
    selected = eligible[0]["recipe"]
    return fit_head(train, "margin", Recipe(selected["alpha"], selected["saturationPoints"])), results


def select_total_head(train: pd.DataFrame, validation: pd.DataFrame) -> tuple[FittedHead | None, list[dict[str, Any]]]:
    baseline = compact_metrics(validation, score_arrays(validation))
    results: list[dict[str, Any]] = []
    for alpha in ALPHAS:
        for saturation in SATURATION_SCALES:
            recipe = Recipe(alpha, saturation)
            head = fit_head(train, "total", recipe)
            metrics = compact_metrics(validation, score_arrays(validation, None, head.correction(validation)))
            eligible = bool(
                metrics["totalMae"] < baseline["totalMae"]
                and metrics["totalAccuracy"] >= baseline["totalAccuracy"]
            )
            results.append({"recipe": recipe.as_dict(), "eligible": eligible, "metrics": metrics})
    eligible = [row for row in results if row["eligible"]]
    eligible.sort(key=lambda row: (
        row["metrics"]["totalMae"],
        row["metrics"]["teamScoreMae"],
        -row["metrics"]["totalAccuracy"],
        row["recipe"]["alpha"],
        row["recipe"]["saturationPoints"],
    ))
    if not eligible:
        return None, results
    selected = eligible[0]["recipe"]
    return fit_head(train, "total", Recipe(selected["alpha"], selected["saturationPoints"])), results


def gate(candidate: dict[str, Any], comparator: dict[str, Any]) -> dict[str, bool]:
    return {
        "teamScoreMaeImproves": candidate["teamScoreMae"] < comparator["teamScoreMae"],
        "marginMaeImproves": candidate["marginMae"] < comparator["marginMae"],
        "totalMaeImproves": candidate["totalMae"] < comparator["totalMae"],
        "winnerAccuracyNoRegression": candidate["winnerAccuracy"] >= comparator["winnerAccuracy"],
        "homeWinBrierNoRegression": candidate["homeWinBrier"] <= comparator["homeWinBrier"],
        "spreadAccuracyNoRegression": candidate["spreadAccuracy"] >= comparator["spreadAccuracy"],
        "totalAccuracyNoRegression": candidate["totalAccuracy"] >= comparator["totalAccuracy"],
    }


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = unified.joined(features, groups, 2024, args.selection_market).sort_values("date_et").reset_index(drop=True)
    split = int(math.floor(len(selection) * 0.60))
    train = selection.iloc[:split].reset_index(drop=True)
    validation = selection.iloc[split:].reset_index(drop=True)
    selected_margin, margin_candidates = select_margin_head(train, validation)
    selected_total, total_candidates = select_total_head(train, validation)

    margin_recipe = None if selected_margin is None else selected_margin.recipe
    total_recipe = None if selected_total is None else selected_total.recipe
    final_margin_head = None if margin_recipe is None else fit_head(selection, "margin", margin_recipe)
    final_total_head = None if total_recipe is None else fit_head(selection, "total", total_recipe)

    # Confirmation is intentionally loaded only after both recipes are frozen.
    confirmation = unified.joined(features, groups, 2025, args.confirmation_market).sort_values("date_et").reset_index(drop=True)
    candidate_scored = score_arrays(
        confirmation,
        None if final_margin_head is None else final_margin_head.correction(confirmation),
        None if final_total_head is None else final_total_head.correction(confirmation),
    )
    independent = compact_metrics(confirmation, score_arrays(confirmation))
    incumbent = compact_metrics(confirmation, incumbent_hard_gate(confirmation))
    candidate = compact_metrics(confirmation, candidate_scored)
    versus_independent = gate(candidate, independent)
    versus_incumbent = gate(candidate, incumbent)
    coherent = bool(all(np.isfinite(candidate_scored[key]).all() for key in ("home", "away", "margin", "total")))
    passed = bool(all(versus_independent.values()) and all(versus_incumbent.values()) and coherent)

    report = {
        "release": RELEASE,
        "status": "accepted_proxy" if passed else "rejected_proxy",
        "productionAuthority": False,
        "chronology": {
            "selectionSeason": 2024,
            "selectionTrainGames": len(train),
            "selectionValidationGames": len(validation),
            "confirmationSeason": 2025,
            "confirmationGames": len(confirmation),
        },
        "inputs": {
            "features": {"path": str(args.features), "sha256": sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": sha256(args.confirmation_market)},
        },
        "selected": {
            "margin": None if margin_recipe is None else margin_recipe.as_dict(),
            "total": None if total_recipe is None else total_recipe.as_dict(),
        },
        "selection": {
            "marginEligible": sum(1 for row in margin_candidates if row["eligible"]),
            "totalEligible": sum(1 for row in total_candidates if row["eligible"]),
            "marginCandidates": margin_candidates,
            "totalCandidates": total_candidates,
        },
        "confirmation": {
            "independent": independent,
            "hardGateIncumbent": incumbent,
            "continuousCandidate": candidate,
            "versusIndependentGates": versus_independent,
            "versusHardGateGates": versus_incumbent,
            "coherentAllGames": coherent,
            "allConfirmationGatesPassed": passed,
        },
        "limitations": [
            "Historical evidence is public consensus open-to-close, not the live same-book reader trail.",
            "The proxy lacks source-specific splits, target-book exclusion, decision-time snapshots, and injury-news timestamps.",
            "A proxy pass cannot authorize production; a failure rejects this recipe.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE,
        "selected": report["selected"],
        "confirmation": report["confirmation"],
        "status": report["status"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
