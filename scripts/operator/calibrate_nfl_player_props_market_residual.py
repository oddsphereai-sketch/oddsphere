#!/usr/bin/env python3
"""Chronological no-vig market-residual calibration for exact NFL prop lines."""

from __future__ import annotations

import argparse
import json
import pathlib
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, log_loss


CONTRACT_PATH = pathlib.Path("lib/services/football/nflPlayerPropsMarketResidualContract.json")
DEFAULT_ROWS = pathlib.Path("football-research/cache/nfl-player-props-price-backtest/nfl_player_props_2025_opening_price_rows_r1.parquet")
OUTPUT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-market-residual")
SEED = 20260825


def logit(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, 1e-5, 1 - 1e-5)
    return np.log(clipped / (1 - clipped))


def expit(values: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-values))


def residual_probability(model: np.ndarray, market: np.ndarray, weight: float) -> np.ndarray:
    return expit(logit(market) + weight * (logit(model) - logit(market)))


def calibration_gap(y: np.ndarray, probabilities: np.ndarray) -> float:
    bins = pd.qcut(probabilities, q=10, duplicates="drop")
    grouped = pd.DataFrame({"p": probabilities, "y": y, "bin": bins}).groupby("bin", observed=True).agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"))
    return float(np.average(np.abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"]))


def metrics(y: np.ndarray, probabilities: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, probabilities)),
        "logLoss": float(log_loss(y, probabilities)),
        "calibrationGap": calibration_gap(y, probabilities),
    }


def implied_probability(price: int) -> float:
    return -price / (-price + 100) if price < 0 else 100 / (price + 100)


def profit_multiple(price: int) -> float:
    return 100 / abs(price) if price < 0 else price / 100


def summarize_bets(rows: pd.DataFrame) -> dict[str, Any]:
    if len(rows) == 0:
        return {"bets": 0, "roi": None, "units": 0.0}
    wins = rows[rows["units"] > 0]["units"].sort_values(ascending=False)
    positive = float(wins.sum())
    return {
        "bets": int(len(rows)),
        "wins": int((rows["units"] > 0).sum()),
        "losses": int((rows["units"] < 0).sum()),
        "units": float(rows["units"].sum()),
        "roi": float(rows["units"].mean()),
        "largestWinShare": float(wins.iloc[0] / positive) if positive > 0 else None,
        "games": int(rows["game_id"].nunique()),
    }


def cluster_bootstrap(rows: pd.DataFrame, iterations: int = 1000) -> dict[str, float] | None:
    if len(rows) == 0:
        return None
    clusters = rows.groupby("game_id", observed=True)["units"].agg(["sum", "count"]).to_numpy(float)
    rng = np.random.default_rng(SEED)
    draws = np.empty(iterations)
    for index in range(iterations):
        sample = clusters[rng.integers(0, len(clusters), len(clusters))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    return {"mean": float(draws.mean()), "ciLow": float(np.quantile(draws, 0.025)), "ciHigh": float(np.quantile(draws, 0.975)), "gameClusters": int(len(clusters))}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=pathlib.Path, default=DEFAULT_ROWS)
    parser.add_argument("--output-root", type=pathlib.Path, default=OUTPUT_ROOT)
    args = parser.parse_args()
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    rows = pd.read_parquet(args.rows)
    over = rows[rows["side"].eq("over")].copy()
    over["date"] = pd.to_datetime(over["game_date"]).dt.date
    selection_end = pd.Timestamp(contract["selectionEnd"]).date()
    confirmation_start = pd.Timestamp(contract["confirmationStart"]).date()
    if confirmation_start <= selection_end:
        raise RuntimeError("NFL props market residual chronology overlaps")
    report: dict[str, Any] = {}
    weights: dict[str, float] = {}
    qualified: dict[str, bool] = {}
    graded_rows: list[pd.DataFrame] = []
    for market, market_rows in over.groupby("market", observed=True):
        selection = market_rows[market_rows["date"].le(selection_end)]
        confirmation = market_rows[market_rows["date"].ge(confirmation_start)]
        if min(len(selection), len(confirmation)) < 100:
            raise RuntimeError(f"NFL props market residual sample is too small for {market}")
        selection_y = selection["units"].gt(0).to_numpy(int)
        selection_scores: dict[str, Any] = {}
        for weight in contract["lambdaCandidates"]:
            probability = residual_probability(selection["model_over_probability"].to_numpy(float), selection["market_over_probability"].to_numpy(float), float(weight))
            selection_scores[str(weight)] = metrics(selection_y, probability)
        selected = min(contract["lambdaCandidates"], key=lambda value: float(selection_scores[str(value)]["brier"]))
        weights[market] = float(selected)
        y = confirmation["units"].gt(0).to_numpy(int)
        model_probability = confirmation["model_over_probability"].to_numpy(float)
        market_probability = confirmation["market_over_probability"].to_numpy(float)
        calibrated_probability = residual_probability(model_probability, market_probability, float(selected))
        raw_metrics = metrics(y, model_probability)
        market_metrics = metrics(y, market_probability)
        calibrated_metrics = metrics(y, calibrated_probability)
        passes = (
            calibrated_metrics["brier"] < raw_metrics["brier"]
            and calibrated_metrics["brier"] < market_metrics["brier"]
            and calibrated_metrics["calibrationGap"] <= contract["qualification"]["maximumCalibrationGap"]
        )
        qualified[market] = bool(passes)
        report[market] = {
            "selectedModelWeight": float(selected),
            "selection": selection_scores,
            "confirmation": {"rawModel": raw_metrics, "market": market_metrics, "marketResidual": calibrated_metrics},
            "qualified": bool(passes),
        }

        executable = rows[(rows["market"].eq(market)) & (pd.to_datetime(rows["game_date"]).dt.date >= confirmation_start)].copy()
        over_probability = residual_probability(executable["model_over_probability"].to_numpy(float), executable["market_over_probability"].to_numpy(float), float(selected))
        executable["calibrated_probability"] = np.where(executable["side"].eq("over"), over_probability, 1.0 - over_probability)
        executable["calibrated_probability_edge"] = executable["calibrated_probability"] - executable["market_probability"]
        executable["calibrated_ev"] = executable["calibrated_probability"] * executable["price"].map(profit_multiple) - (1.0 - executable["calibrated_probability"])
        thresholds = contract["gradeThresholds"]
        executable["market_residual_qualified"] = bool(passes)
        executable["grade"] = "no_play"
        if passes:
            watch = (executable["calibrated_ev"] >= thresholds["watchlist"]["minimumEv"]) & (executable["calibrated_probability_edge"] >= thresholds["watchlist"]["minimumProbabilityEdge"])
            lean = (executable["calibrated_ev"] >= thresholds["lean"]["minimumEv"]) & (executable["calibrated_probability_edge"] >= thresholds["lean"]["minimumProbabilityEdge"])
            best = (executable["calibrated_ev"] >= thresholds["bestAngle"]["minimumEv"]) & (executable["calibrated_probability_edge"] >= thresholds["bestAngle"]["minimumProbabilityEdge"])
            executable.loc[watch, "grade"] = "watchlist"
            executable.loc[lean, "grade"] = "lean_candidate"
            executable.loc[best, "grade"] = "best_angle_candidate"
        graded_rows.append(executable)
    graded = pd.concat(graded_rows, ignore_index=True)
    grades: dict[str, Any] = {}
    for grade in ("best_angle_candidate", "lean_candidate", "watchlist", "no_play"):
        selected_rows = graded[graded["grade"].eq(grade)]
        grades[grade] = {
            **summarize_bets(selected_rows),
            "clusterBootstrapRoi": cluster_bootstrap(selected_rows),
            "byMarket": {market: summarize_bets(group) for market, group in selected_rows.groupby("market", observed=True)},
        }
    args.output_root.mkdir(parents=True, exist_ok=True)
    rows_path = args.output_root / "nfl_player_props_market_residual_confirmation_rows_r1.parquet"
    report_path = args.output_root / "nfl_player_props_market_residual_r1.json"
    graded.to_parquet(rows_path, index=False)
    output = {
        **contract,
        "selectedWeights": weights,
        "qualifiedMarkets": qualified,
        "markets": report,
        "grades": grades,
        "rowsFile": str(rows_path),
    }
    report_path.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "selectedWeights": weights, "qualifiedMarkets": qualified, "grades": grades}, indent=2))


if __name__ == "__main__":
    main()
