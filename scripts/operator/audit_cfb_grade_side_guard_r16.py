#!/usr/bin/env python3
"""Replay the frozen CFB grade policy after fixing the PMF side first."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import tournament_cfb_v1_grade_policy as r1
import tournament_cfb_v1_market_calibrated_grade_policy as r2
from tournament_cfb_v1_model import build_dataset, read_sources


RELEASE = "cfb_grade_side_guard_2026_08_27_r16"


def coherent_rows(rows: list[dict[str, Any]], market: str) -> list[dict[str, Any]]:
    by_game: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row["market"] == market:
            by_game.setdefault(str(row["gameId"]), []).append(row)
    output: list[dict[str, Any]] = []
    for game_rows in by_game.values():
        if len(game_rows) != 2:
            raise RuntimeError(f"{market} game does not have two modeled sides")
        output.append(max(game_rows, key=lambda row: (float(row["independentProbability"]), row["side"])))
    return output


def evaluated(rows: list[dict[str, Any]], market: str, policy: dict[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for row in coherent_rows(rows, market):
        probability = float(policy["weight"]) * float(row["calibratedProbability"]) + (1 - float(policy["weight"])) * float(row["marketFairProbability"])
        edge = probability - float(row["marketFairProbability"])
        ev = probability * r1.profit(int(row["price"])) - (1 - probability)
        output.append({**row, "decisionProbability": probability, "edge": edge, "ev": ev, "units": r1.units(row["result"], int(row["price"]))})
    return output


def selected(rows: list[dict[str, Any]], market: str, policy: dict[str, Any], best: bool = False) -> list[dict[str, Any]]:
    edge = float(policy["bestAngle"]["minEdge"] if best else policy["minEdge"])
    ev = float(policy["bestAngle"]["minEv"] if best else policy["minEv"])
    return [row for row in evaluated(rows, market, policy) if r2.allowed(row, market, str(policy["abstention"])) and row["edge"] >= edge and row["ev"] >= ev]


def proper(rows: list[dict[str, Any]], market: str, policy: dict[str, Any]) -> dict[str, float]:
    values = [row for row in evaluated(rows, market, policy) if row["result"] != "push"]
    actual = np.asarray([1.0 if row["result"] == "win" else 0.0 for row in values])
    model = np.asarray([float(row["decisionProbability"]) for row in values])
    market_p = np.asarray([float(row["marketFairProbability"]) for row in values])
    def brier(probability: np.ndarray) -> float:
        return float(np.mean((probability - actual) ** 2))
    def loss(probability: np.ndarray) -> float:
        bounded = np.clip(probability, 0.005, 0.995)
        return float(-np.mean(actual * np.log(bounded) + (1 - actual) * np.log(1 - bounded)))
    return {"rows": int(len(values)), "modelBrier": brier(model), "marketBrier": brier(market_p), "modelLogLoss": loss(model), "marketLogLoss": loss(market_p)}


def positive_bootstrap(rows: list[dict[str, Any]], seed: int) -> dict[str, float]:
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--policy", default="lib/services/football/modelArtifacts/cfbV1GradePolicy.json")
    parser.add_argument("--output", default="football-research/reports/cfb_grade_side_guard_2026_08_27_r16.local.json")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()
    artifact = json.loads(Path(args.policy).read_text())
    frames, checksums = read_sources(Path(args.source_dir))
    data = build_dataset(frames).replace([np.inf, -np.inf], np.nan)
    raw = {str(season): r1.forecast_season(data, season, args.seed) for season in (2022, 2023, 2024, 2025)}
    results: dict[str, Any] = {}
    for market in r1.MARKETS:
        policy = artifact["policies"][market]
        calibrated = {
            str(season): (
                [{**row, "calibratedProbability": float(row["independentProbability"]), "calibrationFamily": "raw_independent_probability"} for row in raw[str(season)] if row["market"] == market]
                if policy["family"] == "raw_independent_probability"
                else r2.calibrate_season(raw, season, market, str(policy["family"]))
            )
            for season in (2023, 2024, 2025)
        }
        confirmation: dict[str, Any] = {}
        best_confirmation: dict[str, Any] = {}
        proper_scores: dict[str, Any] = {}
        pooled: list[dict[str, Any]] = []
        for season in (2024, 2025):
            actions = selected(calibrated[str(season)], market, policy)
            pooled.extend(actions)
            confirmation[str(season)] = r1.summarize(actions)
            best_confirmation[str(season)] = r1.summarize(selected(calibrated[str(season)], market, policy, best=True))
            proper_scores[str(season)] = proper(calibrated[str(season)], market, policy)
        bootstrap = positive_bootstrap(pooled, args.seed + 10)
        lean = all(confirmation[str(season)]["actions"] >= 5 and confirmation[str(season)]["units"] > 0 and confirmation[str(season)]["unitsWithoutLargestWin"] > 0 for season in (2024, 2025)) and sum(row["units"] for row in pooled) > 0 and bootstrap["probabilityPositive"] >= 0.80
        best = lean and bool(policy["bestAngle"]["qualified"]) and all(best_confirmation[str(season)]["actions"] >= 5 and best_confirmation[str(season)]["units"] > 0 and best_confirmation[str(season)]["unitsWithoutLargestWin"] > 0 for season in (2024, 2025))
        old = {str(season): r2.select_rows(calibrated[str(season)], market, float(policy["weight"]), float(policy["minEdge"]), float(policy["minEv"]), str(policy["abstention"])) for season in (2024, 2025)}
        results[market] = {
            "policy": {key: policy[key] for key in ("family", "weight", "abstention", "minEdge", "minEv")},
            "selection": r1.summarize(selected(calibrated["2023"], market, policy)),
            "confirmation": confirmation,
            "bestAngleConfirmation": best_confirmation,
            "properScores": proper_scores,
            "bootstrap": bootstrap,
            "leanQualified": lean,
            "bestAngleQualified": best,
            "removedOppositeSideActions": {str(season): len(old[str(season)]) - len(selected(calibrated[str(season)], market, policy)) for season in (2024, 2025)},
        }
    report = {"release": RELEASE, "generatedAt": pd.Timestamp.utcnow().isoformat(), "sourceChecksums": checksums, "frozenPolicyRelease": artifact["policyRelease"], "chronology": {"selection": 2023, "confirmation": [2024, 2025], "confirmationStatus": "repeated", "forwardHoldout": 2026}, "markets": results, "historicalExecutionLimitation": "spread_total_fixed_minus110;moneyline_spread_curve_reconstruction;no_named_book_or_clv", "productionAuthorized": False}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"output": str(output), "markets": results}, indent=2))


if __name__ == "__main__":
    main()
