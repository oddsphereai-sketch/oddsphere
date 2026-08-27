#!/usr/bin/env python3
"""Frozen same-PMF-side CFB grade policy tournament (research only)."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import tournament_cfb_v1_grade_policy as r1
from tournament_cfb_v1_model import build_dataset, read_sources


RELEASE = "cfb_independent_pmf_grade_coherence_2026_08_27_r15"
WEIGHTS = (0.25, 0.35, 0.50, 0.65, 1.00)
EDGES = (0.01, 0.02, 0.03, 0.04, 0.05)
EVS = (0.00, 0.01, 0.02, 0.03)
ABSTENTIONS = {
    "moneyline": ("all", "price_300_250", "price_200_200", "favorite", "underdog"),
    "spread": ("all", "line_14", "line_7", "home_favorite", "home_underdog"),
    "total": ("all", "total_40_70", "total_45_65", "over", "under"),
}


def allowed(row: dict[str, Any], market: str, abstention: str) -> bool:
    if abstention == "all":
        return True
    if market == "moneyline":
        price = int(row["price"])
        if abstention == "price_300_250":
            return -300 <= price <= 250
        if abstention == "price_200_200":
            return -200 <= price <= 200
        return price < 0 if abstention == "favorite" else price > 0
    if market == "spread":
        line = float(row["homeLine"] or 0)
        if abstention == "line_14":
            return abs(line) <= 14
        if abstention == "line_7":
            return abs(line) <= 7
        favorite = (line < 0 and row["side"] == "home") or (line > 0 and row["side"] == "away")
        return favorite if abstention == "home_favorite" else not favorite
    line = float(row["totalLine"] or 0)
    if abstention == "total_40_70":
        return 40 <= line <= 70
    if abstention == "total_45_65":
        return 45 <= line <= 65
    return row["side"] == abstention


def coherent_sides(rows: list[dict[str, Any]], market: str) -> list[dict[str, Any]]:
    by_game: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row["market"] == market:
            by_game.setdefault(str(row["gameId"]), []).append(row)
    output: list[dict[str, Any]] = []
    for game_rows in by_game.values():
        if len(game_rows) != 2:
            raise RuntimeError(f"{market} game does not have exactly two modeled sides")
        output.append(max(game_rows, key=lambda row: (float(row["independentProbability"]), row["side"])))
    return output


def enrich(rows: list[dict[str, Any]], market: str, weight: float) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for row in coherent_sides(rows, market):
        probability = weight * float(row["independentProbability"]) + (1 - weight) * float(row["marketFairProbability"])
        edge = probability - float(row["marketFairProbability"])
        ev = probability * r1.profit(int(row["price"])) - (1 - probability)
        output.append({**row, "decisionProbability": probability, "edge": edge, "ev": ev, "units": r1.units(row["result"], int(row["price"]))})
    return output


def selected(rows: list[dict[str, Any]], market: str, weight: float, edge: float, ev: float, abstention: str) -> list[dict[str, Any]]:
    return [row for row in enrich(rows, market, weight) if allowed(row, market, abstention) and row["edge"] >= edge and row["ev"] >= ev]


def proper_scores(rows: list[dict[str, Any]], market: str, weight: float) -> dict[str, float]:
    candidates = [row for row in enrich(rows, market, weight) if row["result"] != "push"]
    actual = np.asarray([1.0 if row["result"] == "win" else 0.0 for row in candidates])
    model = np.asarray([float(row["decisionProbability"]) for row in candidates])
    market_p = np.asarray([float(row["marketFairProbability"]) for row in candidates])
    def brier(values: np.ndarray) -> float:
        return float(np.mean((values - actual) ** 2))
    def log_loss(values: np.ndarray) -> float:
        clipped = np.clip(values, 0.005, 0.995)
        return float(-np.mean(actual * np.log(clipped) + (1 - actual) * np.log(1 - clipped)))
    return {"rows": int(len(candidates)), "modelBrier": brier(model), "marketBrier": brier(market_p), "modelLogLoss": log_loss(model), "marketLogLoss": log_loss(market_p)}


def bootstrap_probability_positive(rows: list[dict[str, Any]], seed: int) -> dict[str, float]:
    buckets: dict[tuple[int, int], list[float]] = {}
    for row in rows:
        buckets.setdefault((int(row["season"]), int(row["week"])), []).append(float(row["units"]))
    weeks = list(buckets.values())
    if not weeks:
        return {"probabilityPositive": 0.0, "lowerRoi": 0.0, "medianRoi": 0.0, "upperRoi": 0.0}
    rng = np.random.default_rng(seed)
    samples: list[float] = []
    for _ in range(10000):
        chosen = [weeks[index] for index in rng.integers(0, len(weeks), len(weeks))]
        flat = [unit for week in chosen for unit in week]
        samples.append(sum(flat) / len(flat))
    values = np.asarray(samples)
    return {"probabilityPositive": float((values > 0).mean()), "lowerRoi": float(np.quantile(values, 0.025)), "medianRoi": float(np.median(values)), "upperRoi": float(np.quantile(values, 0.975))}


def choose(rows: list[dict[str, Any]], market: str) -> dict[str, Any]:
    minimum = 15 if market == "moneyline" else 20
    candidates: list[dict[str, Any]] = []
    for weight in WEIGHTS:
        for abstention in ABSTENTIONS[market]:
            for edge in EDGES:
                for ev in EVS:
                    actions = selected(rows, market, weight, edge, ev, abstention)
                    summary = r1.summarize(actions)
                    weekly = r1.bootstrap_weekly(actions, 20260827)
                    if summary["actions"] < minimum or summary["unitsWithoutLargestWin"] <= 0 or weekly["medianRoi"] <= 0:
                        continue
                    score = summary["roi"] + 0.35 * weekly["lowerRoi"] + 0.002 * math.log1p(summary["actions"])
                    candidates.append({"weight": weight, "abstention": abstention, "minEdge": edge, "minEv": ev, "selection": summary, "selectionWeeklyBootstrap": weekly, "score": score})
    if not candidates:
        raise RuntimeError(f"No selection-qualified coherent {market} policy")
    return max(candidates, key=lambda row: row["score"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--output", default="football-research/reports/cfb_independent_pmf_grade_coherence_2026_08_27_r15.local.json")
    parser.add_argument("--seed", type=int, default=20260827)
    args = parser.parse_args()
    frames, checksums = read_sources(Path(args.source_dir))
    data = build_dataset(frames).replace([np.inf, -np.inf], np.nan)
    yearly = {str(season): r1.forecast_season(data, season, args.seed) for season in (2023, 2024, 2025)}
    policies: dict[str, Any] = {}
    for market in r1.MARKETS:
        policy = choose(yearly["2023"], market)
        confirmation: dict[str, Any] = {}
        pooled: list[dict[str, Any]] = []
        proper: dict[str, Any] = {}
        for season in (2024, 2025):
            actions = selected(yearly[str(season)], market, policy["weight"], policy["minEdge"], policy["minEv"], policy["abstention"])
            pooled.extend(actions)
            confirmation[str(season)] = r1.summarize(actions)
            proper[str(season)] = proper_scores(yearly[str(season)], market, policy["weight"])
        bootstrap = bootstrap_probability_positive(pooled, args.seed + 1)
        season_gate = all(confirmation[str(season)]["actions"] >= 5 and confirmation[str(season)]["units"] > 0 and confirmation[str(season)]["unitsWithoutLargestWin"] > 0 for season in (2024, 2025))
        proper_gate = all(proper[str(season)]["modelBrier"] <= proper[str(season)]["marketBrier"] and proper[str(season)]["modelLogLoss"] <= proper[str(season)]["marketLogLoss"] for season in (2024, 2025))
        lean = season_gate and proper_gate and bootstrap["probabilityPositive"] >= 0.80
        best_confirmation = {
            str(season): r1.summarize(selected(yearly[str(season)], market, policy["weight"], policy["minEdge"] + 0.02, policy["minEv"] + 0.02, policy["abstention"]))
            for season in (2024, 2025)
        }
        best = lean and all(best_confirmation[str(season)]["actions"] >= 5 and best_confirmation[str(season)]["units"] > 0 and best_confirmation[str(season)]["unitsWithoutLargestWin"] > 0 for season in (2024, 2025))
        policies[market] = {**{key: policy[key] for key in ("weight", "abstention", "minEdge", "minEv", "selection", "selectionWeeklyBootstrap")}, "confirmation": confirmation, "properScores": proper, "pooled": r1.summarize(pooled), "pooledBootstrap": bootstrap, "leanQualified": lean, "bestAngle": {"minEdge": policy["minEdge"] + 0.02, "minEv": policy["minEv"] + 0.02, "qualified": best, "confirmation": best_confirmation}}
    result = {"release": RELEASE, "generatedAt": pd.Timestamp.utcnow().isoformat(), "sourceChecksums": checksums, "chronology": {"selection": 2023, "confirmation": [2024, 2025], "confirmationStatus": "repeated", "forwardHoldout": 2026}, "policies": policies, "historicalExecutionLimitation": "spread_total_fixed_minus110;moneyline_spread_curve_reconstruction;no_named_book_or_clv", "productionAuthorized": False}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"output": str(output), "policies": {market: {"weight": value["weight"], "abstention": value["abstention"], "minEdge": value["minEdge"], "minEv": value["minEv"], "leanQualified": value["leanQualified"], "bestAngleQualified": value["bestAngle"]["qualified"], "confirmation": value["confirmation"], "properScores": value["properScores"], "bootstrap": value["pooledBootstrap"]} for market, value in policies.items()}}, indent=2))


if __name__ == "__main__":
    main()
