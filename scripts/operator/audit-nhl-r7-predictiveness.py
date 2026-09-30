#!/usr/bin/env python3
"""Reconstruct the live NHL r7 score path and measure ranking predictiveness."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCORE_BETA = np.asarray([
    2.9780546116531066, 0.1796256256709038, 0.19790828165857607,
    0.1916787455944218, 0.21571727756307035, 0.31307021298110915,
    0.043241636066699105, 0.3101399816597343, 0.05952024232239039,
    0.213239319922914, -0.011341534853054044, -0.03964933962980568,
    -0.017808995904590084, -0.12139146738681414, 0.05824064025009689,
    0.3687578559301108, 0.07458718668794515, -0.11097641372547018,
    0.04338959014834951, 0.08307004907456006,
])
OPPONENT_TOTAL_BETA = np.asarray([
    3.0092264324209728, 0.1481247256394834, 0.06044622628279624,
    0.0658335615941799, 0.01674823600200073, 0.024440281416022905,
    0.1548981486711866, 0.2645738074648139, 0.04459037866682026,
    0.2317113325107479, -0.036653759502945235, -0.0484924145180711,
    0.04369799028078689, 0.041393280178392854, -0.15294922160128802,
    0.6404383539681211, 0.01849762920161113, -0.1782855236868974,
    0.1599451336069983, 0.33277559680418367, 0.3350351206594338,
])
ABILITY_BETA = np.asarray([
    -0.17236562564475472, 0.7948403714740907, 0.37042700976601217,
    -0.6233355872095584, -0.03540520777115418, -0.014228820288914758,
    -0.015795062368390175, -0.06228140429571857,
])


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def logistic(value: float) -> float:
    return 1 / (1 + math.exp(-clamp(value, -20, 20)))


def logit(value: float) -> float:
    p = clamp(value, 0.03, 0.97)
    return math.log(p / (1 - p))


def r7_predictions(rows: list[dict[str, Any]], coherent: Any, research: Any) -> list[tuple[float, float]]:
    output = []
    for row in rows:
        home_x = np.asarray(row["home_x"], dtype=float)
        away_x = np.asarray(row["away_x"], dtype=float)
        # The production runtime has a twentieth base slot fixed to zero;
        # opponent-adjusted state is appended only for the Total head.
        score_home_x = np.concatenate([home_x[:19], np.asarray([0.0])])
        score_away_x = np.concatenate([away_x[:19], np.asarray([0.0])])
        score_home = clamp(float(np.dot(score_home_x, SCORE_BETA)), 1.25, 5.25)
        score_away = clamp(float(np.dot(score_away_x, SCORE_BETA)), 1.25, 5.25)
        with_scores = {
            **row,
            "home_x": score_home_x,
            "away_x": score_away_x,
            "ind_home": score_home,
            "ind_away": score_away,
        }
        ability_probability = logistic(float(np.dot(np.asarray(research.logistic_features(with_scores)), ABILITY_BETA)))
        ability_margin = logit(ability_probability) / 0.78
        independent_margin = 0.55 * (score_home - score_away) + 0.45 * ability_margin
        market_probability = row["market"].get("home_prob")
        market_margin = independent_margin if market_probability is None else logit(float(market_probability)) / 0.78
        active_margin = 0.8 * independent_margin + 0.2 * market_margin
        active_total = score_home + score_away
        active_home = max(0.025, (active_total + active_margin) / 2)
        active_away = max(0.025, (active_total - active_margin) / 2)
        active_probability = coherent.distribution(active_home, active_away)["home_win"]
        total_home = clamp(float(np.dot(home_x, OPPONENT_TOTAL_BETA)), 1.25, 5.25)
        total_away = clamp(float(np.dot(away_x, OPPONENT_TOTAL_BETA)), 1.25, 5.25)
        total = clamp(total_home + total_away, 4.5, 8.0)
        margin = coherent.goal_diff_for_home_win(total, active_probability)
        output.append(((total + margin) / 2, (total - margin) / 2))
    return output


def pearson(predicted: np.ndarray, actual: np.ndarray) -> float:
    return float(np.corrcoef(predicted, actual)[0, 1])


def slope(predicted: np.ndarray, actual: np.ndarray) -> float:
    variance = float(np.var(predicted))
    return float(np.cov(predicted, actual, ddof=0)[0, 1] / variance) if variance > 1e-12 else 0.0


def decile_separation(predicted: np.ndarray, actual: np.ndarray) -> dict[str, float]:
    order = np.argsort(predicted)
    count = max(1, len(order) // 10)
    low, high = order[:count], order[-count:]
    return {
        "predicted_low_mean": float(np.mean(predicted[low])),
        "predicted_high_mean": float(np.mean(predicted[high])),
        "actual_low_mean": float(np.mean(actual[low])),
        "actual_high_mean": float(np.mean(actual[high])),
        "actual_separation": float(np.mean(actual[high]) - np.mean(actual[low])),
    }


def report(rows: list[dict[str, Any]], predictions: list[tuple[float, float]], coherent: Any) -> dict[str, Any]:
    predicted_home = np.asarray([home for home, _ in predictions])
    predicted_away = np.asarray([away for _, away in predictions])
    actual_home = np.asarray([row["home_goals"] for row in rows], dtype=float)
    actual_away = np.asarray([row["away_goals"] for row in rows], dtype=float)
    predicted_team = np.concatenate([predicted_home, predicted_away])
    actual_team = np.concatenate([actual_home, actual_away])
    predicted_total = predicted_home + predicted_away
    actual_total = actual_home + actual_away
    predicted_margin = predicted_home - predicted_away
    actual_margin = actual_home - actual_away
    base = coherent.evaluate(rows, predictions)
    by_date: dict[str, list[float]] = {}
    for row, total in zip(rows, predicted_total, strict=True):
        by_date.setdefault(str(row["date"]), []).append(float(total))
    slate_ranges = [max(values) - min(values) for values in by_date.values() if len(values) >= 5]
    base["slate_dispersion"] = {
        "dates_with_at_least_five_games": len(slate_ranges),
        "median_total_range": float(np.median(slate_ranges)) if slate_ranges else None,
        "pct_dates_range_at_most_live_0_33": float(np.mean(np.asarray(slate_ranges) <= 0.33)) if slate_ranges else None,
        "pct_dates_range_at_most_0_40": float(np.mean(np.asarray(slate_ranges) <= 0.40)) if slate_ranges else None,
    }
    base["predictiveness"] = {
        "team_score_correlation": pearson(predicted_team, actual_team),
        "total_correlation": pearson(predicted_total, actual_total),
        "margin_correlation": pearson(predicted_margin, actual_margin),
        "team_score_calibration_slope": slope(predicted_team, actual_team),
        "total_calibration_slope": slope(predicted_total, actual_total),
        "margin_calibration_slope": slope(predicted_margin, actual_margin),
        "team_score_deciles": decile_separation(predicted_team, actual_team),
        "total_deciles": decile_separation(predicted_total, actual_total),
        "margin_deciles": decile_separation(predicted_margin, actual_margin),
        "actual_std": {
            "team": float(np.std(actual_team)),
            "total": float(np.std(actual_total)),
            "margin": float(np.std(actual_margin)),
        },
    }
    return base


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--goalies", required=True, type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    coherent = load("nhl_r7_predictive_coherent", root / "scripts/operator/research-nhl-coherent-score-r8.py")
    base = load("nhl_r7_predictive_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    research = load("nhl_r7_predictive_features", root / "scripts/operator/research-nhl-matchup-features-r6.py")
    stability = load("nhl_r7_predictive_stability", root / "scripts/operator/research-nhl-training-stability-r6.py")
    games = coherent.apply_settled_scores(
        stability.load_games(args.moneypuck, base),
        coherent.load_settled_scores(args.bdl),
    )
    starter, goalie_results = research.read_goalies(args.goalies)
    openings = coherent.load_multiseason_openings(args.bdl)
    rows = research.build_examples(base, games, 0.085, ["opponent_adjusted"], starter, goalie_results)
    priced = coherent.join_market([row for row in rows if row["season"] == 2025], openings)
    predictions = r7_predictions(priced, coherent, research)
    cut = int(len(priced) * 0.70)
    payload = {
        "release": "nhl_r7_predictiveness_audit_2026_09_29_r1",
        "full_2025": report(priced, predictions, coherent),
        "final_30pct": report(priced[cut:], predictions[cut:], coherent),
    }
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
