#!/usr/bin/env python3
"""Synthesize the frozen passing CFB v1 grade lanes into one release artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import tournament_cfb_v1_frozen_calibrator_grade_policy as r3
import tournament_cfb_v1_grade_policy as r1
import tournament_cfb_v1_market_calibrated_grade_policy as r2
from tournament_cfb_v1_model import build_dataset, read_sources


RELEASE = "cfb_v1_composite_grade_evidence_2026_08_25_r1"
POLICY_RELEASE = "cfb_v1_composite_grade_policy_2026_08_25_r1"
DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_25_r4"


def calibration_artifact(model, family: str, market: str) -> dict[str, Any]:
    feature_order = ["independentLogit"] if family == "independent_calibrated" else ["independentLogit", "marketFairLogit", "logitDifference", "marketZone"]
    return {
        "fitSeason": 2022,
        "family": family,
        "market": market,
        "featureOrder": feature_order,
        "coefficients": [float(value) for value in model.coef_[0]],
        "intercept": float(model.intercept_[0]),
    }


def total_evidence(raw: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    selected = r1.choose_policy(raw["2023"], "total")
    confirmation = {
        str(season): r1.summarize(r1.selected_rows(raw[str(season)], "total", selected["weight"], selected["minEdge"], selected["minEv"]))
        for season in (2024, 2025)
    }
    pooled_rows = r1.selected_rows(raw["2024"] + raw["2025"], "total", selected["weight"], selected["minEdge"], selected["minEv"])
    pooled = r1.summarize(pooled_rows)
    weekly = r1.bootstrap_weekly(pooled_rows, 20260828)
    lean = pooled["units"] > 0 and pooled["unitsWithoutLargestWin"] > 0 and all(confirmation[str(season)]["roi"] >= -0.03 for season in (2024, 2025)) and weekly["medianRoi"] > 0
    best_edge = selected["minEdge"] + 0.02
    best_ev = selected["minEv"] + 0.02
    best_confirmation = {
        str(season): r1.summarize(r1.selected_rows(raw[str(season)], "total", selected["weight"], best_edge, best_ev))
        for season in (2024, 2025)
    }
    best = lean and all(best_confirmation[str(season)]["actions"] >= 5 and best_confirmation[str(season)]["units"] > 0 and best_confirmation[str(season)]["unitsWithoutLargestWin"] > 0 for season in (2024, 2025))
    return {
        "family": "raw_independent_probability",
        "weight": selected["weight"],
        "abstention": "all",
        "minEdge": selected["minEdge"],
        "minEv": selected["minEv"],
        "selection": selected["selection"],
        "selectionWeeklyBootstrap": selected["weeklyBootstrap"],
        "confirmation": confirmation,
        "pooledConfirmation": pooled,
        "pooledWeeklyBootstrap": weekly,
        "leanQualified": lean,
        "bestAngle": {"minEdge": best_edge, "minEv": best_ev, "qualified": best, "confirmation": best_confirmation},
        "calibration": {"family": "raw_independent_probability"},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="football-research/cache/cfb-model/source")
    parser.add_argument("--frozen-report", default="football-research/reports/cfb_v1_frozen_calibrator_grade_policy_2026_08_25_r1.json")
    parser.add_argument("--output", default="football-research/reports/cfb_v1_composite_grade_evidence_2026_08_25_r1.json")
    parser.add_argument("--artifact", default="lib/services/football/modelArtifacts/cfbV1GradePolicy.json")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()
    frozen_path = Path(args.frozen_report)
    frozen = json.loads(frozen_path.read_text())
    if not frozen["policies"]["moneyline"]["leanQualified"] or not frozen["policies"]["spread"]["leanQualified"]:
        raise RuntimeError("frozen Moneyline and Spread lanes must qualify")
    frames, checksums = read_sources(Path(args.source_dir))
    data = build_dataset(frames).replace([np.inf, -np.inf], np.nan)
    raw = {str(season): r1.forecast_season(data, season, args.seed) for season in (2022, 2023, 2024, 2025)}
    policies: dict[str, Any] = {}
    calibrations: dict[str, Any] = {}
    for market in ("moneyline", "spread"):
        source = frozen["policies"][market]
        family = source["family"]
        model = r2.fit_calibrator(raw["2022"], market, family)
        calibration = calibration_artifact(model, family, market)
        calibrations[market] = calibration
        policies[market] = {**source, "calibration": calibration}
    policies["total"] = total_evidence(raw)
    if not all(policies[market]["leanQualified"] for market in r1.MARKETS):
        raise RuntimeError("composite release requires all three Lean lanes")
    report = {
        "release": RELEASE,
        "policyRelease": POLICY_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "qualificationRelease": frozen["qualificationRelease"],
        "sourceChecksums": checksums,
        "sourceReports": {"frozenCalibrator": {"release": frozen["release"], "sha256": hashlib.sha256(frozen_path.read_bytes()).hexdigest()}, "total": "reproduced_from_frozen_first_tournament"},
        "chronology": {"calibrationFit": 2022, "selection": 2023, "confirmation": [2024, 2025], "confirmationStatus": "repeated"},
        "policies": policies,
        "gates": {market: policies[market]["leanQualified"] for market in r1.MARKETS},
        "promotable": True,
        "historicalExecutionLimitation": "spread_total_minus110_moneyline_past_only_spread_curve_no_historical_named_price_or_clv",
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    artifact = {
        "policyRelease": POLICY_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "qualificationRelease": frozen["qualificationRelease"],
        "researchReportSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "chronology": report["chronology"],
        "policies": policies,
    }
    target = Path(args.artifact)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(artifact, separators=(",", ":"), sort_keys=True) + "\n")
    print(json.dumps({"output": str(output), "artifact": str(target), "promotable": True, "policies": {market: {"weight": value["weight"], "minEdge": value["minEdge"], "minEv": value["minEv"], "leanQualified": value["leanQualified"], "bestAngleQualified": value["bestAngle"]["qualified"], "confirmation": value["confirmation"]} for market, value in policies.items()}}, indent=2))


if __name__ == "__main__":
    main()
