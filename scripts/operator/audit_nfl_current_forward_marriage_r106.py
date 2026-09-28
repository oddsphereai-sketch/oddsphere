#!/usr/bin/env python3
"""Exact current-release versus NFL market-marriage candidate audit (read only)."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any


ACTIONABLE = {"Best Angle", "Lean"}
GRADE_RANK = {"No Play": 0, "Watchlist": 1, "Lean": 2, "Best Angle": 3}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def decision_outcome(row: dict[str, Any], market: str) -> str:
    return str(row[f"{market}Outcome"])


def metric(rows: list[dict[str, Any]], market: str) -> dict[str, Any]:
    settled = [row for row in rows if decision_outcome(row, market) != "push"]
    wins = sum(decision_outcome(row, market) == "win" for row in settled)
    actionable = [row for row in settled if row["decisions"][market]["grade"] in ACTIONABLE]
    actionable_wins = sum(decision_outcome(row, market) == "win" for row in actionable)
    brier_values: list[float] = []
    log_values: list[float] = []
    for row in settled:
        probability = min(max(float(row["decisions"][market]["modelProbability"]), 1e-9), 1 - 1e-9)
        result = 1.0 if decision_outcome(row, market) == "win" else 0.0
        brier_values.append((probability - result) ** 2)
        log_values.append(-(result * math.log(probability) + (1 - result) * math.log(1 - probability)))
    return {
        "settled": len(settled),
        "wins": wins,
        "losses": len(settled) - wins,
        "accuracy": wins / len(settled) if settled else None,
        "brier": sum(brier_values) / len(brier_values) if brier_values else None,
        "logLoss": sum(log_values) / len(log_values) if log_values else None,
        "actionable": len(actionable),
        "actionableWins": actionable_wins,
        "actionableLosses": len(actionable) - actionable_wins,
        "actionableAccuracy": actionable_wins / len(actionable) if actionable else None,
        "grades": dict(Counter(row["decisions"][market]["grade"] for row in rows)),
        "nonpositiveEvActionables": sum(
            row["decisions"][market]["expectedValue"] <= 0 for row in actionable
        ),
    }


def score_metrics(rows: list[dict[str, Any]]) -> dict[str, float]:
    count = len(rows)
    team_error = 0.0
    margin_error = 0.0
    total_error = 0.0
    for row in rows:
        actual_home = (float(row["actualTotal"]) + float(row["actualMargin"])) / 2
        actual_away = (float(row["actualTotal"]) - float(row["actualMargin"])) / 2
        team_error += (
            abs(float(row["expectedHome"]) - actual_home)
            + abs(float(row["expectedAway"]) - actual_away)
        ) / 2
        margin_error += abs(float(row["finalMargin"]) - float(row["actualMargin"]))
        total_error += abs(float(row["finalTotal"]) - float(row["actualTotal"]))
    return {
        "teamScoreMae": team_error / count,
        "marginMae": margin_error / count,
        "totalMae": total_error / count,
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "games": len(rows),
        "moneyline": metric(rows, "moneyline"),
        "spread": metric(rows, "spread"),
        "total": metric(rows, "total"),
        "score": score_metrics(rows),
    }


def direction(side: str, market: str) -> str:
    return side.split()[0] if market == "total" else side


def changes(
    baseline: list[dict[str, Any]], candidate: list[dict[str, Any]], market: str
) -> dict[str, Any]:
    flips: list[dict[str, Any]] = []
    promotions: list[dict[str, Any]] = []
    demotions: list[dict[str, Any]] = []
    if len(baseline) != len(candidate):
        raise ValueError("Baseline and candidate row counts differ.")
    for old, new in zip(baseline, candidate):
        if old["providerGameId"] != new["providerGameId"]:
            raise ValueError("Baseline and candidate rows are not identity-aligned.")
        old_decision = old["decisions"][market]
        new_decision = new["decisions"][market]
        item = {
            "week": new["week"],
            "game": f'{new["awayTeam"]}@{new["homeTeam"]}',
            "fromSide": old_decision["side"],
            "toSide": new_decision["side"],
            "fromGrade": old_decision["grade"],
            "toGrade": new_decision["grade"],
            "baselineOutcome": decision_outcome(old, market),
            "candidateOutcome": decision_outcome(new, market),
        }
        if direction(old_decision["side"], market) != direction(new_decision["side"], market):
            flips.append(item)
        old_actionable = old_decision["grade"] in ACTIONABLE
        new_actionable = new_decision["grade"] in ACTIONABLE
        if not old_actionable and new_actionable:
            promotions.append(item)
        if old_actionable and not new_actionable:
            demotions.append(item)
    return {
        "sideFlips": len(flips),
        "corrected": sum(
            row["baselineOutcome"] == "loss" and row["candidateOutcome"] == "win" for row in flips
        ),
        "harmed": sum(
            row["baselineOutcome"] == "win" and row["candidateOutcome"] == "loss" for row in flips
        ),
        "promotions": len(promotions),
        "demotions": len(demotions),
        "flipRows": flips,
        "promotionRows": promotions,
        "demotionRows": demotions,
    }


def coherence_violations(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    violations: list[dict[str, Any]] = []
    for row in rows:
        away = float(row["expectedAway"])
        home = float(row["expectedHome"])
        for market in ("moneyline", "spread", "total"):
            decision = row["decisions"][market]
            line = decision["evaluatedQuote"]["line"]
            if market == "moneyline":
                coherent = (decision["side"] == row["homeTeam"]) == (home > away)
            elif market == "spread":
                selected_score = (
                    home - away + float(line)
                    if decision["side"] == row["homeTeam"]
                    else away - home + float(line)
                )
                coherent = selected_score >= -1e-9
            else:
                coherent = decision["side"].startswith("Over") == (home + away > float(line))
            if not coherent:
                violations.append({
                    "week": row["week"],
                    "game": f'{row["awayTeam"]}@{row["homeTeam"]}',
                    "market": market,
                    "side": decision["side"],
                    "line": line,
                    "expectedAway": away,
                    "expectedHome": home,
                })
    return violations


def evidence_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total_direction = [
        row for row in rows
        if (row.get("marketEvidence") or {}).get("totalDirection", {}).get("status") == "available"
    ]
    return {
        "playbookSplitGames": sum(row.get("playbookSplits") is not None for row in rows),
        "namedSharpSplitGames": sum(row.get("sharpSplits") is not None for row in rows),
        "verifiedTotalMovementGames": len(total_direction),
        "overDirections": sum(
            row["marketEvidence"]["totalDirection"]["side"] == "over" for row in total_direction
        ),
        "underDirections": sum(
            row["marketEvidence"]["totalDirection"]["side"] == "under" for row in total_direction
        ),
        "policy": {
            "direction": "verified chronological same-book line movement",
            "circa": "preferred named sharp split; internal context, never fabricated",
            "fallback": "Playbook multi-book money/tickets; lower-trust internal context",
            "missing": "unavailable, never neutral",
        },
    }


def main() -> None:
    args = parse_args()
    baseline_payload = json.loads(args.baseline.read_text())
    candidate_payload = json.loads(args.candidate.read_text())
    baseline = baseline_payload["rows"]
    candidate = candidate_payload["rows"]
    if len(baseline) != 47 or len(candidate) != 47:
        raise ValueError("The exact Weeks 1-3 audit requires 47 settled rows.")

    report: dict[str, Any] = {
        "release": "nfl_current_forward_market_marriage_audit_2026_09_28_r106",
        "readOnly": True,
        "baseline": {
            "selection": summarize([row for row in baseline if row["week"] in (1, 2)]),
            "confirmation": summarize([row for row in baseline if row["week"] == 3]),
            "all": summarize(baseline),
        },
        "candidate": {
            "selection": summarize([row for row in candidate if row["week"] in (1, 2)]),
            "confirmation": summarize([row for row in candidate if row["week"] == 3]),
            "all": summarize(candidate),
        },
        "changes": {
            market: changes(baseline, candidate, market)
            for market in ("moneyline", "spread", "total")
        },
        "evidence": evidence_summary(candidate),
        "coherenceViolations": coherence_violations(candidate),
    }
    baseline_actions = sum(
        row["decisions"][market]["grade"] in ACTIONABLE
        for row in baseline
        for market in ("moneyline", "spread", "total")
    )
    candidate_actions = sum(
        row["decisions"][market]["grade"] in ACTIONABLE
        for row in candidate
        for market in ("moneyline", "spread", "total")
    )
    baseline_action_wins = sum(
        report["baseline"]["all"][market]["actionableWins"]
        for market in ("moneyline", "spread", "total")
    )
    candidate_action_wins = sum(
        report["candidate"]["all"][market]["actionableWins"]
        for market in ("moneyline", "spread", "total")
    )
    report["board"] = {
        "baselineActionables": baseline_actions,
        "candidateActionables": candidate_actions,
        "retainedFraction": candidate_actions / baseline_actions,
        "baselineActionableAccuracy": baseline_action_wins / baseline_actions,
        "candidateActionableAccuracy": candidate_action_wins / candidate_actions,
        "promotions": sum(report["changes"][market]["promotions"] for market in report["changes"]),
        "demotions": sum(report["changes"][market]["demotions"] for market in report["changes"]),
    }

    selection_ok = all(
        report["candidate"]["selection"][market]["wins"]
        >= report["baseline"]["selection"][market]["wins"]
        for market in ("moneyline", "spread", "total")
    )
    confirmation_ok = all(
        report["candidate"]["confirmation"][market]["wins"]
        >= report["baseline"]["confirmation"][market]["wins"]
        for market in ("moneyline", "spread", "total")
    )
    score_ok = all(
        report["candidate"]["all"]["score"][name]
        < report["baseline"]["all"]["score"][name]
        for name in ("teamScoreMae", "marginMae", "totalMae")
    )
    confirmation_probability_ok = all(
        report["candidate"]["confirmation"][market]["brier"]
        <= report["baseline"]["confirmation"][market]["brier"] + 0.005
        and report["candidate"]["confirmation"][market]["logLoss"]
        <= report["baseline"]["confirmation"][market]["logLoss"] + 0.01
        for market in ("moneyline", "spread", "total")
    )
    report["gates"] = {
        "selectionNoMarketDecline": selection_ok,
        "confirmationNoMarketDecline": confirmation_ok,
        "allScoreErrorsImprove": score_ok,
        "confirmationProbabilityLossNoMaterialRegression": confirmation_probability_ok,
        "zeroCoherenceViolations": not report["coherenceViolations"],
        "actionableBoardRetainsAtLeast80Pct": report["board"]["retainedFraction"] >= 0.8,
        "actionableAccuracyImproves": (
            report["board"]["candidateActionableAccuracy"]
            > report["board"]["baselineActionableAccuracy"]
        ),
        "hasPromotionsAndDemotions": (
            report["board"]["promotions"] > 0 and report["board"]["demotions"] > 0
        ),
        "zeroNonpositiveEvActionables": all(
            report["candidate"]["all"][market]["nonpositiveEvActionables"] == 0
            for market in ("moneyline", "spread", "total")
        ),
        "bothTotalFlipDirectionsRemainPossible": (
            any(row["toSide"].startswith("Over") for row in report["changes"]["total"]["flipRows"])
            and any(row["toSide"].startswith("Under") for row in report["changes"]["total"]["flipRows"])
        ),
    }
    report["eligible"] = all(report["gates"].values())
    rendered = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n")
    print(rendered)
    if not report["eligible"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
