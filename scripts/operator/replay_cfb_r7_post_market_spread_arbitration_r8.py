#!/usr/bin/env python3
"""Replay one coherent r7 -> r8 CFB score after qualified split arbitration."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import numpy as np


RELEASE = "cfb_r7_post_market_spread_arbitration_replay_2026_10_01_r8"


def normalized(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    aliases = {
        "umass": "massachusetts", "uconn": "connecticut", "appstate": "appalachianstate",
        "ulmonroe": "louisianamonroe", "utsa": "texassanantonio", "utep": "texaselpaso",
        "fiu": "floridainternational", "smu": "southernmethodist", "olemiss": "mississippi",
    }
    text = re.sub(r"[^a-z0-9]", "", text)
    for source, target in aliases.items():
        if text.startswith(source):
            return target + text[len(source):]
    return text


def timestamp(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def match_prediction(row: dict[str, Any], predictions: list[dict[str, Any]]) -> dict[str, Any] | None:
    start = timestamp(str(row["startTime"]))
    nearby = [prediction for prediction in predictions if abs(timestamp(prediction["gameDate"]) - start) <= 4 * 3600]
    ranked = sorted(((
        0.5 * SequenceMatcher(None, normalized(row["awayTeamName"]), normalized(prediction["awayTeam"])).ratio()
        + 0.5 * SequenceMatcher(None, normalized(row["homeTeamName"]), normalized(prediction["homeTeam"])).ratio(),
        prediction,
    ) for prediction in nearby), key=lambda value: value[0])
    if not ranked or ranked[-1][0] < 0.72:
        return None
    if len(ranked) > 1 and ranked[-1][0] - ranked[-2][0] < 0.04:
        return None
    return ranked[-1][1]


def match_evidence(prediction: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates: list[tuple[float, dict[str, Any]]] = []
    start = timestamp(prediction["gameDate"])
    for row in rows:
        game = row.get("game") or {}
        row_start = game.get("scheduledStart") or row.get("game_start_at")
        if not row_start or abs(timestamp(row_start) - start) > 4 * 3600:
            continue
        away = ((game.get("away") or {}).get("name") or "")
        home = ((game.get("home") or {}).get("name") or "")
        score = (
            0.5 * SequenceMatcher(None, normalized(away), normalized(prediction["awayTeam"])).ratio()
            + 0.5 * SequenceMatcher(None, normalized(home), normalized(prediction["homeTeam"])).ratio()
        )
        candidates.append((score, row))
    candidates.sort(key=lambda value: value[0])
    return candidates[-1][1] if candidates and candidates[-1][0] >= 0.72 else None


def spread_signal(row: dict[str, Any]) -> tuple[str, float, int] | None:
    spread = ((row.get("splits") or {}).get("spread") or {})
    bets = spread.get("bets") or {}
    money = spread.get("money") or {}
    books = int(((spread.get("source") or {}).get("booksUsed") or 0))
    values = [bets.get("homePercent"), bets.get("awayPercent"), money.get("homePercent"), money.get("awayPercent")]
    if not all(isinstance(value, (int, float)) for value in values):
        return None
    gaps = {
        "home": float(money["homePercent"] - bets["homePercent"]),
        "away": float(money["awayPercent"] - bets["awayPercent"]),
    }
    side = max(gaps, key=lambda key: gaps[key])
    divergence = abs(gaps[side])
    return side, divergence, books


def result(side: str, value: float, positive_side: str) -> str:
    if abs(value) < 1e-9:
        return "push"
    return "win" if (side == positive_side) == (value > 0) else "loss"


def summarize(rows: list[dict[str, Any]], prefix: str) -> dict[str, Any]:
    actual_home = np.asarray([row["actualHome"] for row in rows], dtype=float)
    actual_away = np.asarray([row["actualAway"] for row in rows], dtype=float)
    home = np.asarray([row[f"{prefix}Home"] for row in rows], dtype=float)
    away = np.asarray([row[f"{prefix}Away"] for row in rows], dtype=float)
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    margin = home - away
    total = home + away
    ml_wins = sum((row[f"{prefix}Home"] >= row[f"{prefix}Away"]) == (row["actualHome"] > row["actualAway"]) for row in rows)
    spread_results = [row[f"{prefix}SpreadResult"] for row in rows]
    total_results = [row[f"{prefix}TotalResult"] for row in rows]
    spread_decided = [value for value in spread_results if value != "push"]
    total_decided = [value for value in total_results if value != "push"]
    return {
        "games": len(rows),
        "teamScoreMae": float(np.mean(np.abs(np.concatenate([home - actual_home, away - actual_away])))),
        "marginMae": float(np.mean(np.abs(margin - actual_margin))),
        "totalMae": float(np.mean(np.abs(total - actual_total))),
        "moneyline": {"wins": ml_wins, "accuracy": ml_wins / len(rows) if rows else None},
        "spread": {
            "wins": spread_decided.count("win"), "decided": len(spread_decided),
            "accuracy": spread_decided.count("win") / len(spread_decided) if spread_decided else None,
        },
        "total": {
            "wins": total_decided.count("win"), "decided": len(total_decided),
            "accuracy": total_decided.count("win") / len(total_decided) if total_decided else None,
        },
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    candidate = json.loads(Path(args.candidate_report).read_text())
    predictions = candidate.get("currentPredictions") or candidate["current2026"]["predictions"]
    history = json.loads(Path(args.playbook_history).read_text())
    evidence = json.loads(Path(args.market_evidence).read_text())
    used: set[str] = set()
    rows: list[dict[str, Any]] = []
    for split_row in history["rows"]:
        prediction = match_prediction(split_row, predictions)
        if not prediction or prediction["gameId"] in used:
            continue
        evidence_row = match_evidence(prediction, evidence["rows"])
        line = (evidence_row or {}).get("playbook_line") or {}
        home_spread = line.get("homeSpread")
        total_line = line.get("total")
        if not isinstance(home_spread, (int, float)) or not isinstance(total_line, (int, float)):
            continue
        used.add(prediction["gameId"])
        baseline_home = float(prediction["expectedHome"])
        baseline_away = float(prediction["expectedAway"])
        baseline_margin = baseline_home - baseline_away
        baseline_total = baseline_home + baseline_away
        candidate_side = "home" if baseline_margin + home_spread >= 0 else "away"
        signal = spread_signal(split_row)
        qualified = bool(signal and signal[2] >= 8 and signal[1] >= 5)
        flip = bool(qualified and signal and signal[0] != candidate_side)
        final_margin = (-2.0 * home_spread - baseline_margin) if flip else baseline_margin
        final_home = (baseline_total + final_margin) / 2.0
        final_away = (baseline_total - final_margin) / 2.0
        actual_home = float(prediction["actualHome"])
        actual_away = float(prediction["actualAway"])
        values = {
            "gameId": prediction["gameId"], "week": int(prediction["week"]),
            "homeSpread": float(home_spread), "totalLine": float(total_line),
            "actualHome": actual_home, "actualAway": actual_away,
            "baselineHome": baseline_home, "baselineAway": baseline_away,
            "finalHome": final_home, "finalAway": final_away,
            "signalSide": signal[0] if signal else None,
            "signalDivergencePp": signal[1] if signal else None,
            "signalBooks": signal[2] if signal else None,
            "qualified": qualified, "flip": flip,
        }
        for prefix, home, away in (("baseline", baseline_home, baseline_away), ("final", final_home, final_away)):
            values[f"{prefix}SpreadResult"] = result(
                "home" if home + home_spread >= away else "away",
                actual_home + home_spread - actual_away,
                "home",
            )
            values[f"{prefix}TotalResult"] = result(
                "over" if home + away >= total_line else "under",
                actual_home + actual_away - total_line,
                "over",
            )
        rows.append(values)

    selection = [row for row in rows if row["week"] <= 2]
    confirmation = [row for row in rows if row["week"] >= 3]
    return {
        "release": RELEASE,
        "productionDecisionEffect": False,
        "sources": {
            "candidate": candidate["release"], "playbook": history["release"], "evidence": evidence["release"],
        },
        "coverage": {"matchedGames": len(rows), "flips": sum(row["flip"] for row in rows)},
        "rule": {"market": "spread", "minimumBooks": 8, "minimumMoneyTicketDivergencePp": 5, "construction": "reflect_margin_across_current_line"},
        "selectionWeeks1to2": {"baseline": summarize(selection, "baseline"), "final": summarize(selection, "final"), "flips": sum(row["flip"] for row in selection)},
        "confirmationWeeks3to4": {"baseline": summarize(confirmation, "baseline"), "final": summarize(confirmation, "final"), "flips": sum(row["flip"] for row in confirmation)},
        "all": {"baseline": summarize(rows, "baseline"), "final": summarize(rows, "final"), "flips": sum(row["flip"] for row in rows)},
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-report", required=True)
    parser.add_argument("--playbook-history", required=True)
    parser.add_argument("--market-evidence", required=True)
    parser.add_argument("--output", default="/private/tmp/cfb-r7-post-market-spread-arbitration-r8.json")
    args = parser.parse_args()
    report = run(args)
    Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "rows"}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
