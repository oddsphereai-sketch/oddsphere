#!/usr/bin/env python3
"""CFB v1 exact-price tournament with pre-selection frozen calibrators."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import tournament_cfb_v1_grade_policy as r1
import tournament_cfb_v1_market_calibrated_grade_policy as r2
from tournament_cfb_v1_model import build_dataset, read_sources


RELEASE = "cfb_v1_frozen_calibrator_grade_tournament_2026_08_25_r1"
POLICY_RELEASE = "cfb_v1_frozen_calibrator_grade_policy_2026_08_25_r1"
DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_25_r3"


def apply_frozen(
    raw_by_year: dict[str, list[dict[str, Any]]],
    season: int,
    market: str,
    family: str,
) -> list[dict[str, Any]]:
    model = r2.fit_calibrator(raw_by_year["2022"], market, family)
    primary = "home" if market in ("moneyline", "spread") else "over"
    output: list[dict[str, Any]] = []
    for row in raw_by_year[str(season)]:
        if row["market"] != market:
            continue
        if row["side"] == primary:
            probability = float(model.predict_proba(np.asarray([r2.features(row, market, family)]))[0, 1])
        else:
            paired = {
                **row,
                "side": primary,
                "independentProbability": 1 - float(row["independentProbability"]),
                "marketFairProbability": 1 - float(row["marketFairProbability"]),
            }
            probability = 1 - float(model.predict_proba(np.asarray([r2.features(paired, market, family)]))[0, 1])
        output.append({**row, "calibratedProbability": probability, "calibrationFamily": family})
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="football-research/cache/cfb-model/source")
    parser.add_argument("--qualification", default="football-research/reports/cfb_v1_independent_joint_distribution_2026_08_25_r3.json")
    parser.add_argument("--output", default="football-research/reports/cfb_v1_frozen_calibrator_grade_policy_2026_08_25_r1.json")
    parser.add_argument("--artifact", default="lib/services/football/modelArtifacts/cfbV1GradePolicy.json")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()
    qualification = json.loads(Path(args.qualification).read_text())
    if not qualification.get("promotable"):
        raise RuntimeError("qualified CFB r3 distribution is required")
    frames, checksums = read_sources(Path(args.source_dir))
    data = build_dataset(frames).replace([np.inf, -np.inf], np.nan)
    raw = {str(season): r1.forecast_season(data, season, args.seed) for season in (2022, 2023, 2024, 2025)}
    calibrated = {
        str(season): {
            family: {market: apply_frozen(raw, season, market, family) for market in r1.MARKETS}
            for family in r2.FAMILIES
        }
        for season in (2023, 2024, 2025)
    }
    policies: dict[str, Any] = {}
    gates: dict[str, bool] = {}
    for market in r1.MARKETS:
        selected = r2.choose(calibrated["2023"], market)
        family = selected["family"]
        confirmation: dict[str, Any] = {}
        pooled: list[dict[str, Any]] = []
        for season in (2024, 2025):
            rows = r2.select_rows(calibrated[str(season)][family][market], market, selected["weight"], selected["minEdge"], selected["minEv"], selected["abstention"])
            pooled.extend(rows)
            confirmation[str(season)] = r1.summarize(rows)
        pooled_summary = r1.summarize(pooled)
        pooled_weekly = r1.bootstrap_weekly(pooled, args.seed + 3)
        lean = pooled_summary["units"] > 0 and pooled_summary["unitsWithoutLargestWin"] > 0 and all(confirmation[str(year)]["roi"] >= -0.03 for year in (2024, 2025)) and pooled_weekly["medianRoi"] > 0
        best_edge = selected["minEdge"] + 0.02
        best_ev = selected["minEv"] + 0.02
        best_confirmation: dict[str, Any] = {}
        for season in (2024, 2025):
            rows = r2.select_rows(calibrated[str(season)][family][market], market, selected["weight"], best_edge, best_ev, selected["abstention"])
            best_confirmation[str(season)] = r1.summarize(rows)
        best = lean and all(best_confirmation[str(year)]["actions"] >= 5 and best_confirmation[str(year)]["units"] > 0 and best_confirmation[str(year)]["unitsWithoutLargestWin"] > 0 for year in (2024, 2025))
        policies[market] = {key: selected[key] for key in ("family", "weight", "abstention", "minEdge", "minEv", "selection", "selectionWeeklyBootstrap")} | {"calibrationFitSeason": 2022, "confirmation": confirmation, "pooledConfirmation": pooled_summary, "pooledWeeklyBootstrap": pooled_weekly, "leanQualified": lean, "bestAngle": {"minEdge": best_edge, "minEv": best_ev, "qualified": best, "confirmation": best_confirmation}}
        gates[market] = lean
    report = {"release": RELEASE, "policyRelease": POLICY_RELEASE, "decisionRelease": DECISION_RELEASE, "generatedAt": pd.Timestamp.utcnow().isoformat(), "qualificationRelease": qualification["release"], "sourceChecksums": checksums, "chronology": {"calibrationFit": 2022, "selection": 2023, "confirmation": [2024, 2025], "confirmationStatus": "repeated"}, "policies": policies, "gates": gates, "promotable": all(gates.values()), "independentForecastRemains": qualification["release"], "historicalExecutionLimitation": "spread_total_minus110_moneyline_past_only_spread_curve_no_historical_named_price_or_clv"}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    artifact = {"policyRelease": POLICY_RELEASE, "decisionRelease": DECISION_RELEASE, "qualificationRelease": qualification["release"], "researchReportSha256": hashlib.sha256(output.read_bytes()).hexdigest(), "policies": policies}
    target = Path(args.artifact)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(artifact, separators=(",", ":"), sort_keys=True) + "\n")
    print(json.dumps({"output": str(output), "artifact": str(target), "promotable": report["promotable"], "policies": {market: {"family": value["family"], "weight": value["weight"], "abstention": value["abstention"], "minEdge": value["minEdge"], "minEv": value["minEv"], "leanQualified": value["leanQualified"], "bestAngleQualified": value["bestAngle"]["qualified"], "confirmation": value["confirmation"]} for market, value in policies.items()}}, indent=2))


if __name__ == "__main__":
    main()
