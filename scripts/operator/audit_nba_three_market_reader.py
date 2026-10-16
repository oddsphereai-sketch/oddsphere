#!/usr/bin/env python3
"""Chronological NBA reader audit with explicit correction attribution.

The public historical input is consensus open/close, so this operator is a
proxy audit rather than a production same-book reader backtest. It answers the
narrow decision question that a generic movement study cannot: when a market
read disagrees with the independent forecast, did overriding that forecast
correct more picks than it harmed?

Rules are selected once on 2024-25 and evaluated untouched on 2025-26. Missing
authentic same-book chronology, exact prices, and source-specific split history
remain production blockers even when a proxy rule clears the historical gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import audit_nba_unified_final_projection as unified
from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_three_market_reader_audit_2026_10_16_r1_disagreement_attribution"
MINIMUM_FLIPS = 50
MINIMUM_OVERALL_LIFT = 0.005
MINIMUM_FLIP_ACCURACY = 0.524
MINIMUM_EDGE = 0.25

Market = Literal["moneyline", "spread", "total"]


@dataclass(frozen=True)
class Rule:
    market: Market
    movement_threshold: float
    maximum_independent_edge: float | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "market": self.market,
            "movementThreshold": self.movement_threshold,
            "maximumIndependentEdge": self.maximum_independent_edge,
            "policy": "follow_movement_only_when_it_disagrees_with_independent",
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--selection-market", type=Path, required=True)
    parser.add_argument("--confirmation-market", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def wilson_lower(wins: int, decisions: int, z: float = 1.96) -> float | None:
    if decisions <= 0:
        return None
    rate = wins / decisions
    denominator = 1 + z * z / decisions
    center = rate + z * z / (2 * decisions)
    radius = z * math.sqrt(rate * (1 - rate) / decisions + z * z / (4 * decisions * decisions))
    return float((center - radius) / denominator)


def candidate_rules(market: Market) -> list[Rule]:
    if market == "moneyline":
        thresholds = (0.005, 0.01, 0.02, 0.03, 0.05)
        caps: tuple[float | None, ...] = (1.0, 2.0, 3.0, 4.0, 6.0, None)
    elif market == "spread":
        thresholds = (0.5, 1.0, 1.5, 2.0, 3.0, 4.0)
        caps = (1.0, 2.0, 3.0, 4.0, 6.0, 8.0, None)
    else:
        thresholds = (0.5, 1.0, 1.5, 2.0, 3.0, 4.0)
        caps = (1.0, 2.0, 3.0, 4.0, 6.0, 8.0, None)
    return [Rule(market, threshold, cap) for threshold in thresholds for cap in caps]


def vectors(frame: pd.DataFrame, market: Market) -> dict[str, np.ndarray]:
    if market == "moneyline":
        base = frame["independent_margin"].to_numpy(float)
        movement = (
            frame["close_home_win_prob"].to_numpy(float)
            - frame["open_home_win_prob"].to_numpy(float)
        )
        outcome = frame["target_home_margin"].to_numpy(float)
    elif market == "spread":
        base = (
            frame["independent_margin"].to_numpy(float)
            + frame["close_spread_home"].to_numpy(float)
        )
        movement = (
            frame["open_spread_home"].to_numpy(float)
            - frame["close_spread_home"].to_numpy(float)
        )
        outcome = (
            frame["target_home_margin"].to_numpy(float)
            + frame["close_spread_home"].to_numpy(float)
        )
    else:
        base = (
            frame["independent_total"].to_numpy(float)
            - frame["close_total"].to_numpy(float)
        )
        movement = (
            frame["close_total"].to_numpy(float)
            - frame["open_total"].to_numpy(float)
        )
        outcome = (
            frame["target_total"].to_numpy(float)
            - frame["close_total"].to_numpy(float)
        )
    return {"base": base, "movement": movement, "outcome": outcome}


def apply_rule(frame: pd.DataFrame, rule: Rule) -> dict[str, np.ndarray]:
    data = vectors(frame, rule.market)
    base = data["base"]
    movement = data["movement"]
    movement_active = np.abs(movement) >= rule.movement_threshold
    edge_eligible = np.ones(len(frame), dtype=bool) if rule.maximum_independent_edge is None else (
        np.abs(base) <= rule.maximum_independent_edge
    )
    disagreement = np.sign(movement) != np.sign(base)
    flips = movement_active & edge_eligible & disagreement & ~np.isclose(movement, 0.0)
    final = np.where(flips, np.sign(movement) * np.maximum(np.abs(base), MINIMUM_EDGE), base)
    return {**data, "final": final, "flips": flips}


def correctness(prediction: np.ndarray, outcome: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    resolved = ~np.isclose(outcome, 0.0)
    correct = (prediction >= 0) == (outcome > 0)
    return resolved, correct


def evaluate(frame: pd.DataFrame, rule: Rule) -> dict[str, Any]:
    applied = apply_rule(frame, rule)
    resolved, base_correct = correctness(applied["base"], applied["outcome"])
    _, final_correct = correctness(applied["final"], applied["outcome"])
    changed = applied["flips"] & resolved
    base_wins = int((base_correct & resolved).sum())
    final_wins = int((final_correct & resolved).sum())
    decisions = int(resolved.sum())
    flips = int(changed.sum())
    corrections = int((changed & ~base_correct & final_correct).sum())
    harms = int((changed & base_correct & ~final_correct).sum())
    unchanged = resolved & ~changed
    movement_active = np.abs(applied["movement"]) >= rule.movement_threshold
    return {
        "rule": rule.as_dict(),
        "decisions": decisions,
        "base": {
            "wins": base_wins,
            "losses": decisions - base_wins,
            "accuracy": base_wins / decisions,
            "wilson95Lower": wilson_lower(base_wins, decisions),
        },
        "final": {
            "wins": final_wins,
            "losses": decisions - final_wins,
            "accuracy": final_wins / decisions,
            "wilson95Lower": wilson_lower(final_wins, decisions),
        },
        "accuracyLiftPp": 100 * (final_wins - base_wins) / decisions,
        "movementActive": int(movement_active.sum()),
        "flips": flips,
        "flipCoverage": flips / decisions,
        "corrections": corrections,
        "harms": harms,
        "netCorrections": corrections - harms,
        "readerAccuracyOnFlips": corrections / flips if flips else None,
        "readerWilson95LowerOnFlips": wilson_lower(corrections, flips),
        "baseAccuracyOnFlips": harms / flips if flips else None,
        "unchangedAccuracy": float(base_correct[unchanged].mean()) if unchanged.any() else None,
    }


def selection_eligible(result: dict[str, Any]) -> bool:
    return bool(
        result["flips"] >= MINIMUM_FLIPS
        and result["accuracyLiftPp"] >= 100 * MINIMUM_OVERALL_LIFT
        and result["readerAccuracyOnFlips"] is not None
        and result["readerAccuracyOnFlips"] >= MINIMUM_FLIP_ACCURACY
        and result["netCorrections"] > 0
    )


def select_rule(frame: pd.DataFrame, market: Market) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if market == "spread":
        # Spread is an already-frozen production recipe. Do not reopen the
        # threshold grid after seeing the confirmation season.
        incumbent = evaluate(frame, Rule("spread", 2.0, None))
        incumbent["selectionEligible"] = selection_eligible(incumbent)
        incumbent["selectionMethod"] = "frozen_r3_incumbent_not_retuned"
        return incumbent, [incumbent]
    candidates = [evaluate(frame, rule) for rule in candidate_rules(market)]
    for result in candidates:
        result["selectionEligible"] = selection_eligible(result)
    ranked = sorted(candidates, key=lambda result: (
        not result["selectionEligible"],
        -result["accuracyLiftPp"],
        -(result["readerWilson95LowerOnFlips"] or -1),
        -result["flips"],
        json.dumps(result["rule"], sort_keys=True),
    ))
    return ranked[0], ranked


def confirmation_gate(selection: dict[str, Any], confirmation: dict[str, Any]) -> dict[str, bool]:
    return {
        "selectedBeforeConfirmation": bool(selection["selectionEligible"]),
        "minimumConfirmationFlips": confirmation["flips"] >= MINIMUM_FLIPS,
        "positiveConfirmationNetCorrections": confirmation["netCorrections"] > 0,
        "confirmationOverallLift": confirmation["accuracyLiftPp"] >= 100 * MINIMUM_OVERALL_LIFT,
        "confirmationFlipAccuracy": bool(
            confirmation["readerAccuracyOnFlips"] is not None
            and confirmation["readerAccuracyOnFlips"] >= MINIMUM_FLIP_ACCURACY
        ),
    }


def coherent_projection(frame: pd.DataFrame, results: dict[Market, dict[str, np.ndarray]]) -> dict[str, Any]:
    margin = frame["independent_margin"].to_numpy(float).copy()
    total = frame["independent_total"].to_numpy(float).copy()
    close_spread = frame["close_spread_home"].to_numpy(float)
    close_total = frame["close_total"].to_numpy(float)

    # Spread evidence sets a point-spread residual. Moneyline evidence then
    # applies only when the resulting winner still disagrees, preserving one
    # margin rather than publishing contradictory market-specific forecasts.
    spread = results["spread"]
    spread_flips = spread["flips"]
    margin[spread_flips] = -close_spread[spread_flips] + spread["final"][spread_flips]
    moneyline = results["moneyline"]
    moneyline_flips = moneyline["flips"] & (np.sign(margin) != np.sign(moneyline["movement"]))
    margin[moneyline_flips] = (
        np.sign(moneyline["movement"][moneyline_flips])
        * np.maximum(np.abs(margin[moneyline_flips]), MINIMUM_EDGE)
    )
    total_result = results["total"]
    total_flips = total_result["flips"]
    total[total_flips] = close_total[total_flips] + total_result["final"][total_flips]

    home = (total + margin) / 2
    away = (total - margin) / 2
    actual_margin = frame["target_home_margin"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    return {
        "teamScoreMae": float(np.mean(np.concatenate([np.abs(home - actual_home), np.abs(away - actual_away)]))),
        "marginMae": float(np.mean(np.abs(margin - actual_margin))),
        "totalMae": float(np.mean(np.abs(total - actual_total))),
        "winnerAccuracy": float(((margin >= 0) == (actual_margin > 0)).mean()),
        "spreadAccuracy": float(((margin + close_spread >= 0) == (actual_margin + close_spread > 0))[~np.isclose(actual_margin + close_spread, 0)].mean()),
        "totalAccuracy": float(((total - close_total >= 0) == (actual_total - close_total > 0))[~np.isclose(actual_total - close_total, 0)].mean()),
        "applied": {
            "moneyline": int(moneyline_flips.sum()),
            "spread": int(spread_flips.sum()),
            "total": int(total_flips.sum()),
        },
    }


def zero_flips(applied: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    return {**applied, "final": applied["base"].copy(), "flips": np.zeros(len(applied["base"]), dtype=bool)}


def market_attribution(
    frame: pd.DataFrame,
    independent: dict[str, np.ndarray],
    final: dict[str, np.ndarray],
) -> dict[str, Any]:
    actual_margin = frame["target_home_margin"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    close_spread = frame["close_spread_home"].to_numpy(float)
    close_total = frame["close_total"].to_numpy(float)

    def summarize(base: np.ndarray, candidate: np.ndarray, outcome: np.ndarray) -> dict[str, Any]:
        resolved = ~np.isclose(outcome, 0.0)
        base_correct = (base >= 0) == (outcome > 0)
        final_correct = (candidate >= 0) == (outcome > 0)
        changed = resolved & ((base >= 0) != (candidate >= 0))
        return {
            "baseAccuracy": float(base_correct[resolved].mean()),
            "finalAccuracy": float(final_correct[resolved].mean()),
            "sideChanges": int(changed.sum()),
            "corrections": int((changed & ~base_correct & final_correct).sum()),
            "harms": int((changed & base_correct & ~final_correct).sum()),
        }

    return {
        "moneyline": summarize(independent["margin"], final["margin"], actual_margin),
        "spread": summarize(
            independent["margin"] + close_spread,
            final["margin"] + close_spread,
            actual_margin + close_spread,
        ),
        "total": summarize(
            independent["total"] - close_total,
            final["total"] - close_total,
            actual_total - close_total,
        ),
    }


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection_frame = unified.joined(features, groups, 2024, args.selection_market)
    confirmation_frame = unified.joined(features, groups, 2025, args.confirmation_market)

    report_markets: dict[str, Any] = {}
    selected_rules: dict[Market, Rule] = {}
    for market in ("moneyline", "spread", "total"):
        selected, candidates = select_rule(selection_frame, market)
        rule = Rule(
            market=market,
            movement_threshold=float(selected["rule"]["movementThreshold"]),
            maximum_independent_edge=selected["rule"]["maximumIndependentEdge"],
        )
        confirmation = evaluate(confirmation_frame, rule)
        gates = confirmation_gate(selected, confirmation)
        selected_rules[market] = rule
        report_markets[market] = {
            "selectedOn2024": selected,
            "confirmedOn2025": confirmation,
            "confirmationGates": gates,
            "historicalProxyGate": all(gates.values()),
            "candidateCount": len(candidates),
            "candidates": candidates,
        }

    promoted_markets = {
        market for market, data in report_markets.items() if data["historicalProxyGate"]
    }
    selection_applied = {
        market: (
            apply_rule(selection_frame, rule)
            if market in promoted_markets
            else zero_flips(apply_rule(selection_frame, rule))
        )
        for market, rule in selected_rules.items()
    }
    confirmation_applied = {
        market: (
            apply_rule(confirmation_frame, rule)
            if market in promoted_markets
            else zero_flips(apply_rule(confirmation_frame, rule))
        )
        for market, rule in selected_rules.items()
    }
    selection_joint = coherent_projection(selection_frame, selection_applied)
    confirmation_joint = coherent_projection(confirmation_frame, confirmation_applied)
    independent_selection = unified.independent_final(selection_frame)
    independent_confirmation = unified.independent_final(confirmation_frame)
    selection_final = unified.reconcile(selection_frame, {
        "marginIndependentWeight": 1.0,
        "totalIndependentWeight": 1.0,
        "movementThreshold": 2.0,
    })
    confirmation_final = unified.reconcile(confirmation_frame, {
        "marginIndependentWeight": 1.0,
        "totalIndependentWeight": 1.0,
        "movementThreshold": 2.0,
    })
    report = {
        "release": RELEASE,
        "status": "research_only_historical_consensus_proxy",
        "chronology": {"selectionSeason": 2024, "confirmationSeason": 2025},
        "inputs": {
            "features": {"path": str(args.features), "sha256": sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": sha256(args.confirmation_market)},
        },
        "selectionPolicy": {
            "minimumFlips": MINIMUM_FLIPS,
            "minimumOverallLiftPp": 100 * MINIMUM_OVERALL_LIFT,
            "minimumReaderAccuracyOnFlips": MINIMUM_FLIP_ACCURACY,
            "candidateChosenBeforeConfirmation": True,
        },
        "markets": report_markets,
        "promotedHistoricalProxyMarkets": sorted(promoted_markets),
        "coherentJointProjection": {
            "selection": selection_joint,
            "confirmation": confirmation_joint,
            "selectionMarketAttribution": market_attribution(
                selection_frame, independent_selection, selection_final,
            ),
            "confirmationMarketAttribution": market_attribution(
                confirmation_frame, independent_confirmation, confirmation_final,
            ),
            "warning": "Only markets that clear their frozen confirmation gate are applied to this diagnostic joint projection.",
        },
        "productionAuthority": {
            "authorized": False,
            "reason": "Consensus open/close cannot prove the live reader's same-book, target-book-excluded, decision-time evidence semantics.",
            "missingEvidence": [
                "same-book timestamped opening/prior/current sequences",
                "target-book-excluded two-sided no-vig prices",
                "historical source-specific ticket and handle snapshots",
                "exact executable prices at the decision cutoff",
            ],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {
            market: {
                "rule": data["selectedOn2024"]["rule"],
                "selectionLiftPp": data["selectedOn2024"]["accuracyLiftPp"],
                "selectionFlips": data["selectedOn2024"]["flips"],
                "confirmationLiftPp": data["confirmedOn2025"]["accuracyLiftPp"],
                "confirmationFlips": data["confirmedOn2025"]["flips"],
                "confirmationCorrections": data["confirmedOn2025"]["corrections"],
                "confirmationHarms": data["confirmedOn2025"]["harms"],
                "historicalProxyGate": data["historicalProxyGate"],
            }
            for market, data in report_markets.items()
        },
        "coherentJointProjection": report["coherentJointProjection"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
