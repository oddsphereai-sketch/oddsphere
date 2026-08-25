#!/usr/bin/env python3
"""Evaluate predeclared, exclusive NFL prop grade lanes at exact target prices."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, log_loss


RELEASE = "nfl_player_props_actionable_lane_evidence_2026_08_25_r3_production_release"
ROWS = pathlib.Path("football-research/cache/nfl-player-props-price-backtest/nfl_player_props_2025_opening_price_rows_r1.parquet")
MARKET_REPORT = pathlib.Path("football-research/cache/nfl-player-props-market-residual/nfl_player_props_market_residual_r1.json")
TD_REPORT = pathlib.Path("football-research/cache/nfl-player-props-touchdowns/nfl_player_props_anytime_td_tournament_r2.json")
DECISION = pathlib.Path("lib/services/football/nflPlayerPropsDecisionContract.json")
OUTPUT = pathlib.Path("football-research/cache/nfl-player-props-actionable-lanes/nfl_player_props_actionable_lanes_r1.json")
SEED = 20260825


def logit(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, 1e-5, 1 - 1e-5)
    return np.log(clipped / (1 - clipped))


def residual_probability(model: np.ndarray, market: np.ndarray, weight: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-(logit(market) + weight * (logit(model) - logit(market)))))


def profit_multiple(prices: pd.Series) -> np.ndarray:
    values = prices.to_numpy(float)
    return np.where(values < 0, 100 / np.abs(values), values / 100)


def calibration_gap(outcomes: np.ndarray, probabilities: np.ndarray) -> float:
    frame = pd.DataFrame({"outcome": outcomes, "probability": probabilities})
    frame["bin"] = pd.qcut(frame["probability"], q=10, duplicates="drop")
    grouped = frame.groupby("bin", observed=True).agg(predicted=("probability", "mean"), observed=("outcome", "mean"), rows=("outcome", "size"))
    return float(np.average(np.abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"]))


def summarize(rows: pd.DataFrame) -> dict[str, Any]:
    if rows.empty:
        return {"bets": 0, "games": 0, "units": 0.0, "roi": None, "largestWinShare": None, "clusterBootstrapRoi": None}
    wins = rows.loc[rows["units"] > 0, "units"].sort_values(ascending=False)
    positive = float(wins.sum())
    clusters = rows.groupby("game_id", observed=True)["units"].agg(["sum", "count"]).to_numpy(float)
    rng = np.random.default_rng(SEED)
    draws = np.empty(1000)
    for index in range(len(draws)):
        sample = clusters[rng.integers(0, len(clusters), len(clusters))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    return {
        "bets": int(len(rows)), "games": int(rows["game_id"].nunique()), "wins": int((rows["units"] > 0).sum()),
        "units": float(rows["units"].sum()), "roi": float(rows["units"].mean()),
        "largestWinShare": None if positive <= 0 else float(wins.iloc[0] / positive),
        "clusterBootstrapRoi": {"mean": float(draws.mean()), "ciLow": float(np.quantile(draws, 0.025)), "ciHigh": float(np.quantile(draws, 0.975))},
    }


def metrics(rows: pd.DataFrame) -> dict[str, Any]:
    outcome = rows["units"].gt(0).to_numpy(int)
    probability = rows["calibrated_probability"].to_numpy(float)
    return {
        "rows": int(len(rows)), "brier": float(brier_score_loss(outcome, probability)),
        "logLoss": float(log_loss(outcome, probability)), "calibrationGap": calibration_gap(outcome, probability),
    }


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    args = parser.parse_args()
    decision = json.loads(DECISION.read_text(encoding="utf-8"))
    market_report = json.loads(MARKET_REPORT.read_text(encoding="utf-8"))
    td_report = json.loads(TD_REPORT.read_text(encoding="utf-8"))
    rows = pd.read_parquet(args.rows).copy()
    rows["date"] = pd.to_datetime(rows["game_date"])
    weights = rows["market"].map(market_report["selectedWeights"]).to_numpy(float)
    over = residual_probability(rows["model_over_probability"].to_numpy(float), rows["market_over_probability"].to_numpy(float), weights)
    rows["calibrated_probability"] = np.where(rows["side"].eq("over"), over, 1 - over)
    rows["calibrated_probability_edge"] = rows["calibrated_probability"] - rows["market_probability"]
    rows["calibrated_ev"] = rows["calibrated_probability"] * profit_multiple(rows["price"]) - (1 - rows["calibrated_probability"])
    rows = rows.sort_values("price", ascending=False).drop_duplicates(["game_id", "player_id", "market", "line", "side"], keep="first")
    selection_end = pd.Timestamp(market_report["selectionEnd"])
    confirmation_start = pd.Timestamp(market_report["confirmationStart"])
    if confirmation_start <= selection_end:
        raise RuntimeError("NFL props actionable-lane chronology overlaps")

    lane_report: dict[str, Any] = {}
    for market, lane in decision["marketLanes"].items():
        market_rows = rows[rows["market"].eq(market) & rows["side"].isin(lane["eligibleSides"])].copy()
        best = decision["volumeAndYardage"]["bestAngle"]
        lean = lane.get("leanThresholds", decision["volumeAndYardage"]["lean"])
        best_mask = lane["bestAngle"] & (market_rows["independent_book_count"] >= best["minimumIndependentBooks"]) & (market_rows["calibrated_ev"] >= best["minimumEv"]) & (market_rows["calibrated_probability_edge"] >= best["minimumProbabilityEdge"])
        lean_mask = lane["lean"] & ~best_mask & (market_rows["independent_book_count"] >= lean["minimumIndependentBooks"]) & (market_rows["calibrated_ev"] >= lean["minimumEv"]) & (market_rows["calibrated_probability_edge"] >= lean["minimumProbabilityEdge"])
        watch_mask = lane["watchlist"] & ~best_mask & ~lean_mask & (market_rows["calibrated_ev"] >= 0) & (market_rows["calibrated_probability_edge"] >= 0)
        market_rows["exclusiveGrade"] = np.select([best_mask, lean_mask, watch_mask], ["best_angle", "lean", "watchlist"], default="no_play")
        periods: dict[str, Any] = {}
        for period, period_rows in {
            "selection": market_rows[market_rows["date"] <= selection_end],
            "confirmation": market_rows[market_rows["date"] >= confirmation_start],
        }.items():
            periods[period] = {
                "calibration": None if period_rows.empty else metrics(period_rows),
                "grades": {grade: summarize(period_rows[period_rows["exclusiveGrade"].eq(grade)]) for grade in ("best_angle", "lean", "watchlist", "no_play")},
            }
        gates = decision["releaseEvidence"]
        best_pass = lane["bestAngle"] and all(
            periods[period]["grades"]["best_angle"]["bets"] >= gates["minimumBestAngleBets"]
            and periods[period]["grades"]["best_angle"]["roi"] > 0
            and periods[period]["grades"]["best_angle"]["largestWinShare"] <= gates["maximumLargestWinShare"]
            for period in ("selection", "confirmation")
        )
        lean_pass = lane["lean"] and all(
            periods[period]["grades"]["lean"]["bets"] >= gates["minimumLeanBets"]
            and periods[period]["grades"]["lean"]["roi"] > 0
            and periods[period]["grades"]["lean"]["largestWinShare"] <= gates["maximumLargestWinShare"]
            for period in ("selection", "confirmation")
        )
        lane_report[market] = {
            "eligibleSides": lane["eligibleSides"], "marketResidualQualified": bool(market_report["qualifiedMarkets"][market]),
            "thresholds": {"bestAngle": best, "lean": lean}, "periods": periods,
            "releaseGates": {"bestAngle": bool(best_pass), "lean": bool(lean_pass), "watchlist": bool(lane["watchlist"] and market_report["qualifiedMarkets"][market])},
        }

    output = {
        "release": RELEASE, "decisionRelease": decision["decisionRelease"], "provisional": False, "noQuotas": True,
        "chronology": {"selectionEnd": str(selection_end.date()), "confirmationStart": str(confirmation_start.date()), "trainingThrough": 2024, "evaluationSeason": 2025},
        "exactPriceSemantics": "best executable target-book price with same-line independent-book consensus excluding the target book",
        "source": {"rows": str(args.rows), "rowsSha256": sha256(args.rows), "marketReportSha256": sha256(MARKET_REPORT), "decisionContractSha256": sha256(DECISION)},
        "markets": lane_report,
        "touchdown": {"actionable": False, "watchlistOnly": True, "confirmationGrades": td_report["confirmationGrades"]},
        "clv": {"ready": False, "reason": "2025 source contains exact opening offers but no paired target-book closing prices; forward T-60 tracking will measure CLV by release and locked timestamp"},
        "roleGate": {"historicallyEvaluated": False, "runtimeSafeguard": "timestamped score eligibility plus calibrated participation floors; role gate can only demote an evidence-qualified price lane"},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "release": RELEASE, "gates": {market: value["releaseGates"] for market, value in lane_report.items()}}, indent=2))


if __name__ == "__main__":
    main()
