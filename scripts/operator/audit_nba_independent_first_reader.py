#!/usr/bin/env python3
"""Frozen chronological audit for the NBA independent-first categorical reader.

This audit deliberately keeps both independent score weights at 1.0. A public
consensus open-to-close spread move is used only as a historical proxy for the
production reader's stricter target-book-excluded, same-book chronology. The
proxy may re-orient the independent residual against the current spread after
an absolute two-point move; it never blends the score toward the market.

The script is research-only and never writes production data.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import audit_nba_unified_final_projection as unified
from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_independent_first_reader_audit_2026_10_16_r1"
RECIPE = {
    "marginIndependentWeight": 1.0,
    "totalIndependentWeight": 1.0,
    "movementThreshold": 2.0,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--selection-market", type=Path, required=True)
    parser.add_argument("--confirmation-market", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def evaluate(frame):
    independent = unified.metrics(frame, unified.independent_final(frame))
    candidate_final = unified.reconcile(frame, RECIPE)
    candidate = unified.metrics(frame, candidate_final)
    return independent, candidate


def season_gates(independent: dict, candidate: dict) -> dict[str, bool]:
    return {
        "teamScoreMaeImproves": candidate["teamScoreMae"] < independent["teamScoreMae"],
        "marginMaeImproves": candidate["marginMae"] < independent["marginMae"],
        "totalMaeNoRegression": candidate["totalMae"] <= independent["totalMae"],
        "winnerAccuracyImproves": candidate["winnerAccuracy"] > independent["winnerAccuracy"],
        "homeWinBrierImproves": candidate["homeWinBrier"] < independent["homeWinBrier"],
        "spreadAccuracyImproves": candidate["spread"]["accuracy"] > independent["spread"]["accuracy"],
        "totalAccuracyNoRegression": candidate["total"]["accuracy"] >= independent["total"]["accuracy"],
    }


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = unified.joined(features, groups, 2024, args.selection_market)
    confirmation = unified.joined(features, groups, 2025, args.confirmation_market)
    independent_selection, candidate_selection = evaluate(selection)
    independent_confirmation, candidate_confirmation = evaluate(confirmation)
    selection_gates = season_gates(independent_selection, candidate_selection)
    confirmation_gates = season_gates(independent_confirmation, candidate_confirmation)
    report = {
        "release": RELEASE,
        "status": "research_only_historical_proxy",
        "productionAuthority": False,
        "chronology": {"selectionSeason": 2024, "confirmationSeason": 2025},
        "recipe": RECIPE,
        "limitations": [
            "Historical market files are public consensus open/close, not authentic same-book point-in-time trails.",
            "Production requires complete target-book-excluded two-sided chronology, two persistent same-direction two-point trails, and at least one named book.",
            "The Total remains fully independent because no Total reader candidate cleared a separate validation gate.",
        ],
        "inputs": {
            "features": {"path": str(args.features), "sha256": unified.sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": unified.sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": unified.sha256(args.confirmation_market)},
        },
        "selection": {
            "independent": independent_selection,
            "independentFirstReader": candidate_selection,
            "gates": selection_gates,
        },
        "confirmation": {
            "independent": independent_confirmation,
            "independentFirstReader": candidate_confirmation,
            "gates": confirmation_gates,
        },
        "historicalProxyGate": all(selection_gates.values()) and all(confirmation_gates.values()),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE,
        "historicalProxyGate": report["historicalProxyGate"],
        "selection": candidate_selection,
        "confirmation": candidate_confirmation,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
