#!/usr/bin/env python3
"""Frozen CFB v1 market-calibrated exact-price grade tournament."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

import tournament_cfb_v1_grade_policy as r1
from tournament_cfb_v1_model import build_dataset, read_sources


RELEASE = "cfb_v1_market_calibrated_grade_tournament_2026_08_25_r1"
POLICY_RELEASE = "cfb_v1_market_calibrated_grade_policy_2026_08_25_r1"
DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_25_r2"
FAMILIES = ("independent_calibrated", "market_residual")
WEIGHTS = (0.35, 0.50, 0.65, 0.80, 1.00)
EDGE_THRESHOLDS = (0.01, 0.02, 0.03, 0.04, 0.05)
EV_THRESHOLDS = (0.00, 0.01, 0.02, 0.03)
ABSTENTIONS = {
    "moneyline": ("all", "price_300_250", "price_200_200", "favorite", "underdog"),
    "spread": ("all", "line_14", "line_7", "home_favorite", "home_underdog"),
    "total": ("all", "total_40_70", "total_45_65", "over", "under"),
}


def logit(value: float) -> float:
    value = min(0.995, max(0.005, value))
    return math.log(value / (1 - value))


def primary_rows(rows: list[dict[str, Any]], market: str) -> list[dict[str, Any]]:
    primary = "home" if market in ("moneyline", "spread") else "over"
    return [row for row in rows if row["market"] == market and row["side"] == primary and row["result"] != "push"]


def features(row: dict[str, Any], market: str, family: str) -> list[float]:
    independent = logit(float(row["independentProbability"]))
    fair = logit(float(row["marketFairProbability"]))
    if market == "moneyline":
        zone = abs(float(row["homeLine"] or 0)) / 14
    elif market == "spread":
        zone = abs(float(row["homeLine"] or 0)) / 14
    else:
        zone = (float(row["totalLine"] or 52) - 52) / 14
    if family == "independent_calibrated":
        return [independent]
    return [independent, fair, independent - fair, zone]


def fit_calibrator(past: list[dict[str, Any]], market: str, family: str) -> LogisticRegression:
    rows = primary_rows(past, market)
    model = LogisticRegression(C=1.0, max_iter=5000, class_weight=None)
    model.fit(np.asarray([features(row, market, family) for row in rows]), np.asarray([row["result"] == "win" for row in rows], dtype=int))
    return model


def calibrate_season(
    raw_by_year: dict[str, list[dict[str, Any]]], season: int, market: str, family: str
) -> list[dict[str, Any]]:
    past = [row for year in sorted(raw_by_year) if int(year) < season for row in raw_by_year[year]]
    model = fit_calibrator(past, market, family)
    primary_side = "home" if market in ("moneyline", "spread") else "over"
    output: list[dict[str, Any]] = []
    for row in raw_by_year[str(season)]:
        if row["market"] != market:
            continue
        if row["side"] == primary_side:
            probability = float(model.predict_proba(np.asarray([features(row, market, family)]))[0, 1])
        else:
            paired = {**row, "side": primary_side, "independentProbability": 1 - float(row["independentProbability"]), "marketFairProbability": 1 - float(row["marketFairProbability"])}
            probability = 1 - float(model.predict_proba(np.asarray([features(paired, market, family)]))[0, 1])
        output.append({**row, "calibratedProbability": probability, "calibrationFamily": family})
    return output


def allowed(row: dict[str, Any], market: str, abstention: str) -> bool:
    if abstention == "all":
        return True
    if market == "moneyline":
        price = int(row["price"])
        if abstention == "price_300_250": return -300 <= price <= 250
        if abstention == "price_200_200": return -200 <= price <= 200
        if abstention == "favorite": return price < 0
        return price > 0
    if market == "spread":
        line = float(row["homeLine"] or 0)
        if abstention == "line_14": return abs(line) <= 14
        if abstention == "line_7": return abs(line) <= 7
        if abstention == "home_favorite": return (line < 0 and row["side"] == "home") or (line > 0 and row["side"] == "away")
        return (line > 0 and row["side"] == "home") or (line < 0 and row["side"] == "away")
    line = float(row["totalLine"] or 0)
    if abstention == "total_40_70": return 40 <= line <= 70
    if abstention == "total_45_65": return 45 <= line <= 65
    return row["side"] == abstention


def select_rows(rows: list[dict[str, Any]], market: str, weight: float, min_edge: float, min_ev: float, abstention: str) -> list[dict[str, Any]]:
    by_game: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if not allowed(row, market, abstention):
            continue
        probability = weight * float(row["calibratedProbability"]) + (1 - weight) * float(row["marketFairProbability"])
        edge = probability - float(row["marketFairProbability"])
        ev = probability * r1.profit(int(row["price"])) - (1 - probability)
        enriched = {**row, "decisionProbability": probability, "edge": edge, "ev": ev, "units": r1.units(row["result"], int(row["price"]))}
        by_game.setdefault(str(row["gameId"]), []).append(enriched)
    selected: list[dict[str, Any]] = []
    for values in by_game.values():
        best = max(values, key=lambda value: (value["ev"], value["edge"]))
        if best["edge"] >= min_edge and best["ev"] >= min_ev:
            selected.append(best)
    return selected


def choose(selection: dict[str, dict[str, list[dict[str, Any]]]], market: str) -> dict[str, Any]:
    minimum = 15 if market == "moneyline" else 20
    candidates: list[dict[str, Any]] = []
    for family in FAMILIES:
        rows = selection[family][market]
        for weight in WEIGHTS:
            for abstention in ABSTENTIONS[market]:
                for edge in EDGE_THRESHOLDS:
                    for ev in EV_THRESHOLDS:
                        chosen = select_rows(rows, market, weight, edge, ev, abstention)
                        summary = r1.summarize(chosen)
                        weekly = r1.bootstrap_weekly(chosen, 20260825)
                        if summary["actions"] < minimum or summary["unitsWithoutLargestWin"] <= 0 or weekly["medianRoi"] <= 0:
                            continue
                        score = summary["roi"] + 0.35 * weekly["lowerRoi"] + 0.002 * math.log1p(summary["actions"])
                        candidates.append({"family": family, "weight": weight, "abstention": abstention, "minEdge": edge, "minEv": ev, "selection": summary, "selectionWeeklyBootstrap": weekly, "score": score})
    if not candidates:
        raise RuntimeError(f"No selection-qualified market-calibrated {market} policy")
    return max(candidates, key=lambda value: value["score"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="football-research/cache/cfb-model/source")
    parser.add_argument("--qualification", default="football-research/reports/cfb_v1_independent_joint_distribution_2026_08_25_r3.json")
    parser.add_argument("--output", default="football-research/reports/cfb_v1_market_calibrated_grade_policy_2026_08_25_r1.json")
    parser.add_argument("--artifact", default="lib/services/football/modelArtifacts/cfbV1GradePolicy.json")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()
    qualification = json.loads(Path(args.qualification).read_text())
    if not qualification.get("promotable"):
        raise RuntimeError("qualified CFB r3 distribution is required")
    frames, checksums = read_sources(Path(args.source_dir))
    data = build_dataset(frames).replace([np.inf, -np.inf], np.nan)
    raw_by_year = {str(season): r1.forecast_season(data, season, args.seed) for season in (2022, 2023, 2024, 2025)}
    calibrated = {
        str(season): {
            family: {market: calibrate_season(raw_by_year, season, market, family) for market in r1.MARKETS}
            for family in FAMILIES
        }
        for season in (2023, 2024, 2025)
    }
    policy: dict[str, Any] = {}
    gates: dict[str, bool] = {}
    for market in r1.MARKETS:
        selected = choose(calibrated["2023"], market)
        family = selected["family"]
        confirmation: dict[str, Any] = {}
        pooled: list[dict[str, Any]] = []
        for season in (2024, 2025):
            rows = select_rows(calibrated[str(season)][family][market], market, selected["weight"], selected["minEdge"], selected["minEv"], selected["abstention"])
            pooled.extend(rows)
            confirmation[str(season)] = r1.summarize(rows)
        pooled_summary = r1.summarize(pooled)
        pooled_weekly = r1.bootstrap_weekly(pooled, args.seed + 2)
        lean = pooled_summary["units"] > 0 and pooled_summary["unitsWithoutLargestWin"] > 0 and all(confirmation[str(year)]["roi"] >= -0.03 for year in (2024, 2025)) and pooled_weekly["medianRoi"] > 0
        best_edge = selected["minEdge"] + 0.02
        best_ev = selected["minEv"] + 0.02
        best_confirmation: dict[str, Any] = {}
        for season in (2024, 2025):
            rows = select_rows(calibrated[str(season)][family][market], market, selected["weight"], best_edge, best_ev, selected["abstention"])
            best_confirmation[str(season)] = r1.summarize(rows)
        best = lean and all(best_confirmation[str(year)]["actions"] >= 5 and best_confirmation[str(year)]["units"] > 0 and best_confirmation[str(year)]["unitsWithoutLargestWin"] > 0 for year in (2024, 2025))
        policy[market] = {key: selected[key] for key in ("family", "weight", "abstention", "minEdge", "minEv", "selection", "selectionWeeklyBootstrap")} | {"confirmation": confirmation, "pooledConfirmation": pooled_summary, "pooledWeeklyBootstrap": pooled_weekly, "leanQualified": lean, "bestAngle": {"minEdge": best_edge, "minEv": best_ev, "qualified": best, "confirmation": best_confirmation}}
        gates[market] = lean
    report = {"release": RELEASE, "policyRelease": POLICY_RELEASE, "decisionRelease": DECISION_RELEASE, "generatedAt": pd.Timestamp.utcnow().isoformat(), "qualificationRelease": qualification["release"], "sourceChecksums": checksums, "chronology": {"calibrationStarts": 2022, "selection": 2023, "confirmation": [2024, 2025], "confirmationStatus": "repeated"}, "policies": policy, "gates": gates, "promotable": all(gates.values()), "independentForecastRemains": qualification["release"], "historicalExecutionLimitation": "spread_total_minus110_moneyline_past_only_spread_curve_no_historical_named_price_or_clv"}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    artifact = {"policyRelease": POLICY_RELEASE, "decisionRelease": DECISION_RELEASE, "qualificationRelease": qualification["release"], "researchReportSha256": hashlib.sha256(output.read_bytes()).hexdigest(), "policies": policy}
    target = Path(args.artifact)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(artifact, separators=(",", ":"), sort_keys=True) + "\n")
    print(json.dumps({"output": str(output), "artifact": str(target), "promotable": report["promotable"], "policies": {market: {"family": value["family"], "weight": value["weight"], "abstention": value["abstention"], "minEdge": value["minEdge"], "minEv": value["minEv"], "leanQualified": value["leanQualified"], "bestAngleQualified": value["bestAngle"]["qualified"], "confirmation": value["confirmation"]} for market, value in policy.items()}}, indent=2))


if __name__ == "__main__":
    main()
