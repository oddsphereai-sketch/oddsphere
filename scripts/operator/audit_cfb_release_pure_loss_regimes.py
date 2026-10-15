#!/usr/bin/env python3
"""Audit release-pure CFB reader corrections and harms by pregame regime.

This is SELECT/file-only research. It joins the immutable public result ledger
to the release-pure replay and evaluates only fields available before kickoff.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any


MARKETS = ("moneyline", "spread", "total")
NUMERIC_FEATURES = (
    "market_disagreement",
    "opening_disagreement",
    "market_path",
    "independent_margin_abs",
    "independent_total",
    "active_market_disagreement_abs",
    "independent_market_disagreement_abs",
    "legacy_market_distance_change",
    "spread_all_axis_move",
    "spread_all_move_count",
    "spread_all_reversal_count",
    "moneyline_all_probability_move",
    "moneyline_all_move_count",
    "moneyline_all_reversal_count",
    "total_all_axis_move",
    "total_all_probability_move",
    "total_all_reversal_count",
    "split_public",
    "split_public_money_majority",
    "split_public_ticket_majority",
    "split_public_acceleration",
    "split_public_path_alignment",
    "split_public_disagreement_alignment",
    "moneyline_split_public_money_majority",
    "moneyline_split_public_ticket_majority",
    "cross_market_split_public_agreement",
    "cross_market_move_agreement",
)


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def opposite(side: str) -> str:
    return "second" if side == "first" else "first"


def block(starts_at: str) -> str:
    date = starts_at[:10]
    if date <= "2026-09-27":
        return "development"
    if date <= "2026-10-04":
        return "confirmation"
    return "holdout"


def independent_side(game: dict[str, Any], market: str, line: float | None) -> str | None:
    if market == "moneyline":
        probability = finite(game.get("independentHomeWinProbability"))
        return None if probability is None else ("second" if probability >= 0.5 else "first")
    score = game.get("independentScore") or {}
    away = finite(score.get("away"))
    home = finite(score.get("home"))
    if away is None or home is None or line is None:
        return None
    if market == "spread":
        return "second" if home - away + line >= 0 else "first"
    return "first" if home + away - line >= 0 else "second"


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    corrections = sum(row["readerEffect"] == "correction" for row in rows)
    harms = sum(row["readerEffect"] == "harm" for row in rows)
    return {
        "rows": len(rows),
        "corrections": corrections,
        "harms": harms,
        "netReaderCorrections": corrections - harms,
        "revertToIndependentDelta": harms - corrections,
        "byBlock": {
            name: {
                "rows": len(selected := [row for row in rows if row["block"] == name]),
                "corrections": sum(row["readerEffect"] == "correction" for row in selected),
                "harms": sum(row["readerEffect"] == "harm" for row in selected),
                "revertDelta": sum(row["readerEffect"] == "harm" for row in selected)
                - sum(row["readerEffect"] == "correction" for row in selected),
            }
            for name in ("development", "confirmation", "holdout")
        },
    }


def threshold_candidates(rows: list[dict[str, Any]], feature: str) -> list[float]:
    development = [row for row in rows if row["block"] == "development"]
    values = sorted({value for row in development if (value := finite(row["features"].get(feature))) is not None})
    if len(values) < 4:
        return []
    indexes = sorted({max(0, min(len(values) - 2, round((len(values) - 1) * q))) for q in (0.1, 0.2, 0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75, 0.8, 0.9)})
    return [(values[index] + values[index + 1]) / 2 for index in indexes]


def stable(summary: dict[str, Any], minimum_rows: int) -> bool:
    if summary["rows"] < minimum_rows or summary["revertToIndependentDelta"] <= 0:
        return False
    confirmation = summary["byBlock"]["confirmation"]
    holdout = summary["byBlock"]["holdout"]
    return confirmation["rows"] >= 2 and holdout["rows"] >= 2 and confirmation["revertDelta"] >= 0 and holdout["revertDelta"] >= 0 and (confirmation["revertDelta"] + holdout["revertDelta"]) > 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--replay", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--minimum-rows", type=int, default=8)
    args = parser.parse_args()

    replay = json.loads(args.replay.read_text())
    ledger = json.loads(args.ledger.read_text())
    records = {
        (str(record["gameId"]), record["market"]): record
        for record in ledger["canonicalRecords"]
    }
    rows_by_market: dict[str, list[dict[str, Any]]] = defaultdict(list)
    coordinator_rows: list[dict[str, Any]] = []
    all_rows: list[dict[str, Any]] = []

    for game in replay["games"]:
        for market in MARKETS:
            decision = game["markets"].get(market)
            record = records.get((str(game["gameId"]), market))
            if not decision or not record or record["storedGrade"] not in ("win", "loss"):
                continue
            active_side = decision["activeSide"]
            candidate_side = decision["candidateSide"]
            line = finite(decision.get("line"))
            independent = independent_side(game, market, line)
            if independent is None:
                continue
            actual = active_side if record["storedGrade"] == "win" else opposite(active_side)
            if candidate_side == independent:
                effect = "no_change"
            elif candidate_side == actual:
                effect = "correction"
            else:
                effect = "harm"
            features = dict(decision.get("observedEvidence") or {})
            features.update({
                "axis_shift": finite(decision.get("axisShift")),
                "active_probability": finite(decision.get("activeProbability")),
                "candidate_probability": finite(decision.get("candidateProbability")),
                "line_abs": abs(line) if line is not None else None,
                "both_fbs": finite(features.get("both_fbs")),
                "same_conference": finite(features.get("same_conference")),
            })
            row = {
                "gameId": str(game["gameId"]),
                "matchup": game["matchup"],
                "startsAt": game["startsAt"],
                "block": block(game["startsAt"]),
                "market": market,
                "regime": decision.get("regime"),
                "line": line,
                "actualSide": actual,
                "independentSide": independent,
                "readerSide": candidate_side,
                "readerEffect": effect,
                "features": features,
            }
            all_rows.append(row)
            if effect != "no_change":
                rows_by_market[market].append(row)

            coordinator = game.get("coordinator") or {}
            if market == "moneyline" and coordinator.get("applied") is True:
                combined_home = finite(coordinator.get("combinedHomeWinProbability"))
                learned_home = finite(coordinator.get("learnedHomeWinProbability"))
                final_side = candidate_side
                before_coordinator = opposite(final_side)
                coordinator_rows.append({
                    **row,
                    "independentSide": before_coordinator,
                    "readerSide": final_side,
                    "readerEffect": "correction" if final_side == actual else "harm",
                    "features": {
                        **features,
                        "coordinator_authority": finite(coordinator.get("authority")),
                        "coordinator_combined_selected_probability": None if combined_home is None else max(combined_home, 1 - combined_home),
                        "coordinator_learned_selected_probability": None if learned_home is None else (
                            learned_home if final_side == "second" else 1 - learned_home
                        ),
                    },
                })

    output: dict[str, Any] = {
        "release": "cfb_release_pure_loss_regime_audit_2026_10_15_r2_finite_development_thresholds",
        "readOnly": True,
        "protocol": {
            "control": replay.get("release"),
            "outcomes": ledger.get("auditRelease"),
            "developmentThrough": "2026-09-27",
            "confirmationThrough": "2026-10-04",
            "holdoutStarts": "2026-10-05",
            "thresholdGeneration": "development block finite values only",
            "selectionRule": "retrospective diagnostic: report only pregame conditions with nonnegative confirmation and holdout revert deltas and positive combined confirmation+holdout delta",
        },
        "markets": {},
    }

    for market in MARKETS:
        disagreements = rows_by_market[market]
        regimes = {name: summarize([row for row in disagreements if row["regime"] == name]) for name in sorted({str(row["regime"]) for row in disagreements})}
        rules = []
        feature_names = sorted(set(NUMERIC_FEATURES) | {"axis_shift", "active_probability", "candidate_probability", "line_abs", "both_fbs", "same_conference"})
        for feature in feature_names:
            for threshold in threshold_candidates(disagreements, feature):
                for operator in ("lte", "gte"):
                    selected = []
                    for row in disagreements:
                        value = finite(row["features"].get(feature))
                        if value is None:
                            continue
                        if (operator == "lte" and value <= threshold) or (operator == "gte" and value >= threshold):
                            selected.append(row)
                    result = summarize(selected)
                    if stable(result, args.minimum_rows):
                        rules.append({"feature": feature, "operator": operator, "threshold": threshold, **result})
        rules.sort(key=lambda row: (-row["revertToIndependentDelta"], -row["byBlock"]["holdout"]["revertDelta"], -row["rows"], row["feature"], row["operator"], row["threshold"]))
        output["markets"][market] = {
            "readerDisagreements": summarize(disagreements),
            "byRegime": regimes,
            "stableSingleFeatureRevertRules": rules[:25],
            "disagreementRows": disagreements,
        }

    coordinator_features = (
        "coordinator_authority",
        "coordinator_combined_selected_probability",
        "coordinator_learned_selected_probability",
        "candidate_probability",
    )
    coordinator_rules = []
    for feature in coordinator_features:
        for threshold in threshold_candidates(coordinator_rows, feature):
            for operator in ("lte", "gte"):
                selected = []
                for row in coordinator_rows:
                    value = finite(row["features"].get(feature))
                    if value is None:
                        continue
                    if (operator == "lte" and value <= threshold) or (operator == "gte" and value >= threshold):
                        selected.append(row)
                result = summarize(selected)
                if stable(result, args.minimum_rows):
                    coordinator_rules.append({"feature": feature, "operator": operator, "threshold": threshold, **result})
    coordinator_rules.sort(key=lambda row: (-row["revertToIndependentDelta"], -row["byBlock"]["holdout"]["revertDelta"], -row["rows"], row["feature"], row["operator"], row["threshold"]))
    output["finalWinnerCoordinator"] = {
        "boundaryCrosses": summarize(coordinator_rows),
        "stableSingleFeatureRevertRules": coordinator_rules[:25],
        "fixedMinimumSelectedProbability0575": summarize([
            row for row in coordinator_rows
            if (value := finite(row["features"].get("coordinator_combined_selected_probability"))) is not None
            and value < 0.575
        ]),
        "boundaryCrossRows": coordinator_rows,
    }

    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
