#!/usr/bin/env python3
"""Release-pure NFL Weeks 1-3 market-arbitration audit (read only)."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


PUBLIC_GAP_MINIMUM_PP = 8.0
SHARP_GAP_MINIMUM_PP = 10.0
LINE_MOVE_MINIMUM = 0.5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--replay", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def sign(value: float, epsilon: float = 1e-9) -> int:
    if value > epsilon:
        return 1
    if value < -epsilon:
        return -1
    return 0


def finite(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def gap(split: dict[str, Any] | None, market: str) -> float | None:
    if not split:
        return None
    money_key = "homeMoneyPct" if market == "spread" else "overMoneyPct"
    bets_key = "homeBetsPct" if market == "spread" else "overBetsPct"
    money = finite(split.get(money_key))
    bets = finite(split.get(bets_key))
    return None if money is None or bets is None else money - bets


def qualified_direction(row: dict[str, Any], market: str) -> tuple[int, dict[str, Any]]:
    opening = row["opening"]["quote"]
    current = row["current"]
    if market == "spread":
        opening_line = finite((opening.get("spread") or {}).get("homeLine"))
        current_line = finite((current.get("spread") or {}).get("homeLine"))
        move = None if opening_line is None or current_line is None else opening_line - current_line
    else:
        opening_line = finite((opening.get("total") or {}).get("line"))
        current_line = finite((current.get("total") or {}).get("line"))
        move = None if opening_line is None or current_line is None else current_line - opening_line
    move_direction = 0 if move is None or abs(move) < LINE_MOVE_MINIMUM else sign(move)
    public_market = (row.get("playbookSplits") or {}).get(market)
    sharp_market = (row.get("sharpSplits") or {}).get(market)
    public_gap = gap(public_market, market)
    sharp_gap = gap(sharp_market, market)
    public_direction = 0 if public_gap is None or abs(public_gap) < PUBLIC_GAP_MINIMUM_PP else sign(public_gap)
    sharp_direction = 0 if sharp_gap is None or abs(sharp_gap) < SHARP_GAP_MINIMUM_PP else sign(sharp_gap)
    corroborated = move_direction != 0 and public_direction == move_direction
    sharp_veto = sharp_direction != 0 and sharp_direction != move_direction
    direction = move_direction if corroborated and not sharp_veto else 0
    return direction, {
        "move": move,
        "moveDirection": move_direction,
        "publicGapPp": public_gap,
        "publicDirection": public_direction,
        "sharpGapPp": sharp_gap,
        "sharpDirection": sharp_direction,
        "sharpAvailable": sharp_market is not None,
        "corroborated": corroborated,
        "sharpVeto": sharp_veto,
    }


def settled(correct_side: int, actual_score: float) -> str:
    actual_side = sign(actual_score)
    if actual_side == 0:
        return "push"
    return "win" if correct_side == actual_side else "loss"


def score_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for row in payload["rows"]:
        spread_decision = row["decisions"]["spread"]
        total_decision = row["decisions"]["total"]
        spread_line = float(spread_decision["evaluatedQuote"]["line"])
        home_spread = spread_line if spread_decision["side"] == row["homeTeam"] else -spread_line
        total_line = float(total_decision["evaluatedQuote"]["line"])
        base_margin = float(row["paidMargin"])
        base_total = float(row["paidTotal"])
        margin_direction, margin_evidence = qualified_direction(row, "spread")
        total_direction, total_evidence = qualified_direction(row, "total")
        base_spread_side = sign(base_margin + home_spread)
        base_total_side = sign(base_total - total_line)
        candidate_margin = base_margin
        candidate_total = base_total
        margin_flipped = margin_direction != 0 and base_spread_side != 0 and margin_direction != base_spread_side
        total_flipped = total_direction != 0 and base_total_side != 0 and total_direction != base_total_side
        if margin_flipped:
            candidate_margin = 2 * (-home_spread) - base_margin
        if total_flipped:
            candidate_total = 2 * total_line - base_total
        candidate_spread_side = sign(candidate_margin + home_spread)
        candidate_total_side = sign(candidate_total - total_line)
        base_ml_side = sign(base_margin)
        candidate_ml_side = sign(candidate_margin)
        r22_ml_side = 1 if row["decisions"]["moneyline"]["side"] == row["homeTeam"] else -1
        r22_spread_side = 1 if spread_decision["side"] == row["homeTeam"] else -1
        r22_total_side = 1 if total_decision["side"].startswith("Over") else -1
        actual_margin = float(row["actualMargin"])
        actual_total = float(row["actualTotal"])
        actual_spread_score = actual_margin + home_spread
        actual_total_score = actual_total - total_line
        base_away = (base_total - base_margin) / 2
        base_home = (base_total + base_margin) / 2
        candidate_away = (candidate_total - candidate_margin) / 2
        candidate_home = (candidate_total + candidate_margin) / 2
        actual_away = (actual_total - actual_margin) / 2
        actual_home = (actual_total + actual_margin) / 2
        results.append({
            "week": int(row["week"]),
            "providerGameId": row["providerGameId"],
            "game": f'{row["awayTeam"]}@{row["homeTeam"]}',
            "homeSpread": home_spread,
            "totalLine": total_line,
            "marginEvidence": margin_evidence,
            "totalEvidence": total_evidence,
            "marginFlipped": margin_flipped,
            "totalFlipped": total_flipped,
            "baseMargin": base_margin,
            "candidateMargin": candidate_margin,
            "actualMargin": actual_margin,
            "baseTotal": base_total,
            "candidateTotal": candidate_total,
            "actualTotal": actual_total,
            "baseMoneylineOutcome": settled(base_ml_side, actual_margin),
            "r22MoneylineOutcome": settled(r22_ml_side, actual_margin),
            "candidateMoneylineOutcome": settled(candidate_ml_side, actual_margin),
            "baseSpreadOutcome": settled(base_spread_side, actual_spread_score),
            "r22SpreadOutcome": settled(r22_spread_side, actual_spread_score),
            "candidateSpreadOutcome": settled(candidate_spread_side, actual_spread_score),
            "baseTotalOutcome": settled(base_total_side, actual_total_score),
            "r22TotalOutcome": settled(r22_total_side, actual_total_score),
            "candidateTotalOutcome": settled(candidate_total_side, actual_total_score),
            "r22MoneylineChanged": r22_ml_side != base_ml_side,
            "r22SpreadChanged": r22_spread_side != base_spread_side,
            "r22TotalChanged": r22_total_side != base_total_side,
            "baseTeamScoreAbsError": (abs(base_away - actual_away) + abs(base_home - actual_home)) / 2,
            "candidateTeamScoreAbsError": (abs(candidate_away - actual_away) + abs(candidate_home - actual_home)) / 2,
            "baseMarginAbsError": abs(base_margin - actual_margin),
            "candidateMarginAbsError": abs(candidate_margin - actual_margin),
            "baseTotalAbsError": abs(base_total - actual_total),
            "candidateTotalAbsError": abs(candidate_total - actual_total),
        })
    return results


def market_summary(rows: list[dict[str, Any]], market: str) -> dict[str, Any]:
    base_key = f"base{market}Outcome"
    candidate_key = f"candidate{market}Outcome"
    r22_key = f"r22{market}Outcome"
    settled_rows = [row for row in rows if row[base_key] != "push"]
    base_wins = sum(row[base_key] == "win" for row in settled_rows)
    candidate_wins = sum(row[candidate_key] == "win" for row in settled_rows)
    r22_wins = sum(row[r22_key] == "win" for row in settled_rows)
    flip_key = "marginFlipped" if market in ("Moneyline", "Spread") else "totalFlipped"
    flipped = [row for row in settled_rows if row[flip_key] and row[base_key] != row[candidate_key]]
    corrected = sum(row[base_key] == "loss" and row[candidate_key] == "win" for row in flipped)
    harmed = sum(row[base_key] == "win" and row[candidate_key] == "loss" for row in flipped)
    r22_flipped = [row for row in settled_rows if row[f"r22{market}Changed"]]
    r22_corrected = sum(row[base_key] == "loss" and row[r22_key] == "win" for row in r22_flipped)
    r22_harmed = sum(row[base_key] == "win" and row[r22_key] == "loss" for row in r22_flipped)
    return {
        "settled": len(settled_rows),
        "pushes": len(rows) - len(settled_rows),
        "baseWins": base_wins,
        "baseAccuracy": base_wins / len(settled_rows) if settled_rows else None,
        "candidateWins": candidate_wins,
        "candidateAccuracy": candidate_wins / len(settled_rows) if settled_rows else None,
        "changedSides": len(flipped),
        "corrected": corrected,
        "harmed": harmed,
        "r22Wins": r22_wins,
        "r22Accuracy": r22_wins / len(settled_rows) if settled_rows else None,
        "r22ChangedSides": len(r22_flipped),
        "r22Corrected": r22_corrected,
        "r22Harmed": r22_harmed,
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "games": len(rows),
        "moneyline": market_summary(rows, "Moneyline"),
        "spread": market_summary(rows, "Spread"),
        "total": market_summary(rows, "Total"),
        "baseTeamScoreMae": sum(row["baseTeamScoreAbsError"] for row in rows) / len(rows),
        "candidateTeamScoreMae": sum(row["candidateTeamScoreAbsError"] for row in rows) / len(rows),
        "baseMarginMae": sum(row["baseMarginAbsError"] for row in rows) / len(rows),
        "candidateMarginMae": sum(row["candidateMarginAbsError"] for row in rows) / len(rows),
        "baseTotalMae": sum(row["baseTotalAbsError"] for row in rows) / len(rows),
        "candidateTotalMae": sum(row["candidateTotalAbsError"] for row in rows) / len(rows),
    }


def main() -> None:
    args = parse_args()
    payload = json.loads(args.replay.read_text())
    rows = score_rows(payload)
    report = {
        "release": "nfl_current_forward_market_marriage_audit_2026_09_28_r105",
        "selection": summarize([row for row in rows if row["week"] in (1, 2)]),
        "confirmation": summarize([row for row in rows if row["week"] == 3]),
        "all": summarize(rows),
        "flips": [row for row in rows if row["marginFlipped"] or row["totalFlipped"]],
    }
    rendered = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n")
    print(rendered)


if __name__ == "__main__":
    main()
