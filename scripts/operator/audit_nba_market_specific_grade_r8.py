#!/usr/bin/env python3
"""Frozen post-diagnostic replication of NBA r8 market-specific grades.

Research-only. The script reconstructs the r4 forecast and evaluates the exact
grade lanes declared in the paired r8 predeclaration. It never writes runtime
state or changes a historical lock.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import brier_score_loss, log_loss

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import audit_nba_market_specific_grades as r7
from scripts.operator import audit_nba_unified_final_projection as unified
from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_market_specific_grade_audit_2026_10_16_r8_post_diagnostic_replication"
CALIBRATED = {
    "spread": {"best_angle": 0.60, "lean": 0.56},
    "total": {"best_angle": 0.60, "lean": 0.54},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--selection-market", type=Path, required=True)
    parser.add_argument("--confirmation-market", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def grade_masks(frame, market: str) -> tuple[np.ndarray, np.ndarray]:
    if market == "spread":
        raw = frame["independent_close_edge"].to_numpy(float)
        support = frame["spread_home_support"].to_numpy(float)
        active = np.abs(support) >= 2
        corrected = active & (np.sign(raw) != np.sign(support))
        inactive = ~active
        best = (
            (inactive & (np.abs(raw) >= 2.5) & (np.abs(raw) < 3.5))
            | (corrected & (np.abs(support) >= 4))
        )
        lean = corrected & (np.abs(support) >= 3) & (np.abs(support) < 4)
        return best, lean
    if market == "total":
        corrected = frame["total_reader_corrected"].to_numpy(bool)
        aligned = frame["total_reader_aligned"].to_numpy(bool)
        inactive = ~(corrected | aligned)
        edge = np.abs(frame["raw_total_edge"].to_numpy(float))
        over = frame["total_pick"].eq("over").to_numpy(bool)
        best = corrected & (edge >= 5) & (edge < 9)
        lean = (corrected & (edge >= 9)) | (inactive & over & (edge >= 1) & (edge < 2))
        return best, lean
    raise ValueError(f"unsupported changed market {market}")


def grades(frame, market: str) -> np.ndarray:
    best, lean = grade_masks(frame, market)
    value = np.full(len(frame), "watch", dtype=object)
    value[lean] = "lean"
    value[best] = "best_angle"
    return value


def resolved_mask(frame, market: str, mask: np.ndarray) -> np.ndarray:
    return mask & ~frame[f"{market}_push"].to_numpy(bool)


def calibration(frame, market: str, candidate: np.ndarray) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for tier in ("best_angle", "lean"):
        mask = resolved_mask(frame, market, candidate == tier)
        raw = frame[f"{market}_probability"].to_numpy(float)[mask]
        outcome = frame[f"{market}_win"].to_numpy(bool)[mask].astype(int)
        calibrated = np.full(len(outcome), CALIBRATED[market][tier])
        output[tier] = {
            "decisions": int(len(outcome)),
            "observedAccuracy": float(outcome.mean()) if len(outcome) else None,
            "rawMeanProbability": float(raw.mean()) if len(raw) else None,
            "calibratedProbability": CALIBRATED[market][tier],
            "rawBrier": float(brier_score_loss(outcome, raw)) if len(outcome) else None,
            "calibratedBrier": float(brier_score_loss(outcome, calibrated)) if len(outcome) else None,
            "rawLogLoss": float(log_loss(outcome, raw, labels=[0, 1])) if len(outcome) else None,
            "calibratedLogLoss": float(log_loss(outcome, calibrated, labels=[0, 1])) if len(outcome) else None,
        }
    return output


def changed_market(frame, market: str) -> dict[str, Any]:
    incumbent = r7.incumbent_grades(frame, market)
    candidate = grades(frame, market)
    result = r7.evaluate(frame, market, candidate, incumbent)
    result["calibration"] = calibration(frame, market, candidate)
    incumbent_actionable = np.isin(incumbent, ["best_angle", "lean"])
    candidate_actionable = np.isin(candidate, ["best_angle", "lean"])
    result["promotions"] = r7.tier_metrics(
        frame, market, np.where(~incumbent_actionable & candidate_actionable, "lean", "watch"), "lean"
    )
    result["demotions"] = r7.tier_metrics(
        frame, market, np.where(incumbent_actionable & ~candidate_actionable, "lean", "watch"), "lean"
    )
    return result


def tier_gate(result: dict[str, Any], market: str) -> dict[str, bool]:
    best = result["bestAngle"]
    lean = result["lean"]
    actionable = result["actionable"]
    halves = result["actionableChronologicalHalves"]
    calibration_rows = result["calibration"].values()
    impact = result["boardImpact"]
    return {
        "bestAboveBreakEven": best["accuracy"] > 100 / 210 and best["units"] > 0,
        "leanAboveBreakEven": lean["accuracy"] > 100 / 210 and lean["units"] > 0,
        "actionableAboveBreakEven": actionable["accuracy"] > 100 / 210 and actionable["units"] > 0,
        "bestExceedsLean": best["accuracy"] > lean["accuracy"],
        "halvesAboveBreakEven": all(
            row["accuracy"] is not None and row["accuracy"] > 100 / 210
            for row in halves.values()
        ),
        "calibrationBrierNoRegression": all(
            row["calibratedBrier"] <= row["rawBrier"] for row in calibration_rows
        ),
        "calibrationLogLossNoRegression": all(
            row["calibratedLogLoss"] <= row["rawLogLoss"] for row in calibration_rows
        ),
        "pairedPromotionsAndDemotions": (
            impact["actionablePromotions"] > 0 and impact["actionableDemotions"] > 0
        ),
    }


def moneyline(frame) -> dict[str, Any]:
    incumbent = r7.incumbent_grades(frame, "moneyline")
    result = r7.evaluate(frame, "moneyline", incumbent, incumbent)
    result["unchanged"] = True
    return result


def moneyline_gate(result: dict[str, Any]) -> dict[str, bool]:
    return {
        "actionableFairPricePositive": result["actionable"]["units"] > 0,
        "bestFairPricePositive": result["bestAngle"]["units"] > 0,
        "bestExceedsLean": result["bestAngle"]["accuracy"] > result["lean"]["accuracy"],
        "halvesAboveHalf": all(
            row["accuracy"] is not None and row["accuracy"] >= 0.50
            for row in result["actionableChronologicalHalves"].values()
        ),
    }


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = r7.build_market_frame(unified.joined(features, groups, 2024, args.selection_market))
    confirmation = r7.build_market_frame(unified.joined(features, groups, 2025, args.confirmation_market))

    markets: dict[str, Any] = {}
    for market in ("moneyline", "spread", "total"):
        if market == "moneyline":
            selection_result = moneyline(selection)
            confirmation_result = moneyline(confirmation)
            selection_gates = moneyline_gate(selection_result)
            confirmation_gates = moneyline_gate(confirmation_result)
        else:
            selection_result = changed_market(selection, market)
            confirmation_result = changed_market(confirmation, market)
            selection_gates = tier_gate(selection_result, market)
            confirmation_gates = tier_gate(confirmation_result, market)
        markets[market] = {
            "selection": selection_result,
            "selectionGates": selection_gates,
            "selectionPassed": all(selection_gates.values()),
            "replication": confirmation_result,
            "replicationGates": confirmation_gates,
            "replicationPassed": all(confirmation_gates.values()),
        }

    report = {
        "release": RELEASE,
        "status": "post_diagnostic_historical_replication_no_production_change",
        "chronology": {
            "selection": "2024-25 regular season",
            "replication": "2025-26 regular season",
            "pristineHoldout": False,
        },
        "inputs": {
            "features": {"path": str(args.features), "sha256": r7.sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": r7.sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": r7.sha256(args.confirmation_market)},
        },
        "policies": {
            "moneyline": "unchanged incumbent",
            "spread": {
                "bestAngle": "inactive independent residual [2.5,3.5) or corrected reader move >=4",
                "lean": "corrected reader move [3,4)",
                "calibrated": CALIBRATED["spread"],
            },
            "total": {
                "bestAngle": "corrected reader residual [5,9)",
                "lean": "corrected reader residual >=9 or inactive Over residual [1,2)",
                "calibrated": CALIBRATED["total"],
            },
        },
        "markets": markets,
        "historicalReplicationPassed": all(
            row["selectionPassed"] and row["replicationPassed"] for row in markets.values()
        ),
        "productionAuthority": False,
        "limitations": [
            "The replication season was visible during post-diagnostic lane definition.",
            "Consensus movement is a proxy, not authentic same-book target-excluded chronology.",
            "Flat -110 Spread/Total economics are not exact selected-book ROI.",
            "Runtime exact-price EV and current-board promotion/demotion gates remain outstanding.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "historicalReplicationPassed": report["historicalReplicationPassed"],
        "markets": {
            market: {
                "selectionPassed": row["selectionPassed"],
                "replicationPassed": row["replicationPassed"],
                "selection": {
                    "actionable": row["selection"]["actionable"],
                    "bestAngle": row["selection"]["bestAngle"],
                    "lean": row["selection"]["lean"],
                    "impact": row["selection"]["boardImpact"],
                },
                "replication": {
                    "actionable": row["replication"]["actionable"],
                    "bestAngle": row["replication"]["bestAngle"],
                    "lean": row["replication"]["lean"],
                    "impact": row["replication"]["boardImpact"],
                },
                "replicationGates": row["replicationGates"],
            }
            for market, row in markets.items()
        },
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
