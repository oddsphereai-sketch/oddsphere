#!/usr/bin/env python3
"""Frozen high-conviction provisional NFL Spread/Total tournament."""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
from dataclasses import asdict
from typing import Any

import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_spread_total_grading_r1 as r1
import tournament_nfl_spread_total_pragmatic_v2 as pragmatic
import tournament_nfl_spread_total_residual_blend_r3 as residual


TOURNAMENT_RELEASE = "nfl_spread_total_high_conviction_tournament_2026_08_24_r6"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
PROBABILITY_FLOORS = (0.55, 0.575, 0.60, 0.625, 0.65, 0.675, 0.70)
EV_FLOORS = (0.00, 0.01, 0.02, 0.03)
EDGE_FLOORS_PP = (0.0, 1.0, 2.0, 3.0)
CUSHION_FLOORS = (0.0, 0.5, 1.0, 1.5, 2.0)


def bounded_price(rows: pd.DataFrame) -> pd.Series:
    return rows["price"].between(-200, 200, inclusive="both")


def common_eligible(rows: pd.DataFrame, rule: pragmatic.PragmaticRule) -> pd.Series:
    return (
        rows["market"].eq(rule.market)
        & rows["baseHealth"]
        & rows["directionCoherent"]
        & bounded_price(rows)
        & rows["looOtherBookCount"].ge(2)
        & rows["priceAdvantagePp"].ge(-2.0)
        & rows["cushion"].ge(rule.minimum_cushion + rows["cushionPenalty"])
    )


def select_lean(rows: pd.DataFrame, rule: pragmatic.PragmaticRule) -> pd.DataFrame:
    return r1.reduce_best_offer(rows[
        common_eligible(rows, rule)
        & rows["probability"].ge(rule.minimum_probability)
        & rows["expectedValue"].ge(rule.minimum_ev)
        & rows["edgePp"].ge(rule.minimum_edge_pp)
    ].copy())


def selection_passes(summary: dict[str, Any]) -> bool:
    gap = summary["calibration"]["absoluteGap"]
    return bool(
        summary["actions"] >= 10
        and summary["weeksWithGrade"] >= 6
        and summary["units"] > 0
        and summary["unitsWithoutLargestWin"] >= -1.0
        and gap is not None and gap <= 0.15
        and len(summary["bookMix"]) >= 2
    )


def select_rule(rows: pd.DataFrame, market: str) -> tuple[pragmatic.PragmaticRule | None, list[dict[str, Any]]]:
    universe = rows[rows["market"].eq(market)]
    candidates: list[dict[str, Any]] = []
    for probability in PROBABILITY_FLOORS:
        for ev in EV_FLOORS:
            for edge in EDGE_FLOORS_PP:
                for cushion in CUSHION_FLOORS:
                    rule = pragmatic.PragmaticRule(market, probability, ev, edge, cushion)
                    summary = pragmatic.summarize(select_lean(rows, rule), (SELECTION_SEASON,), universe)
                    summary["rule"] = asdict(rule)
                    summary["ruleName"] = rule.name
                    summary["eligible"] = selection_passes(summary)
                    candidates.append(summary)
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["unitsWithoutLargestWin"], -row["units"],
        row["calibration"]["absoluteGap"], row["actions"], row["ruleName"],
    ))
    return (None, candidates) if not eligible else (pragmatic.PragmaticRule(**eligible[0]["rule"]), candidates)


def confirmation_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    return {
        "minimumCounts": summary["actions"] >= 20 and all(row["actions"] >= 7 for row in seasons),
        "positivePooledUnits": summary["units"] > 0,
        "largestWinIndependent": summary["unitsWithoutLargestWin"] > 0,
        "seasonRobustness": (
            sum(row["units"] > 0 for row in seasons) >= 1
            and all(row["roi"] is not None and row["roi"] >= -0.10 for row in seasons)
        ),
        "calibration": (
            summary["calibration"]["absoluteGap"] is not None
            and summary["calibration"]["absoluteGap"] <= 0.12
            and all(row["calibration"]["absoluteGap"] is not None
                    and row["calibration"]["absoluteGap"] <= 0.18 for row in seasons)
        ),
        "bootstrapPositive": (
            bootstrap["probabilityPositiveUnits"] is not None
            and bootstrap["probabilityPositiveUnits"] >= 0.60
        ),
        "multiBook": len(summary["bookMix"]) >= 2,
    }


def watchlist_rows(
    rows: pd.DataFrame,
    rule: pragmatic.PragmaticRule,
    lean: pd.DataFrame,
) -> pd.DataFrame:
    candidate = r1.reduce_best_offer(rows[
        common_eligible(rows, rule)
        & rows["probability"].ge(rule.minimum_probability)
        & (
            (
                rows["expectedValue"].ge(rule.minimum_ev - 0.02)
                & rows["edgePp"].ge(rule.minimum_edge_pp - 2.0)
            )
            | (
                rows["expectedValue"].ge(rule.minimum_ev - 0.03)
                & rows["edgePp"].ge(rule.minimum_edge_pp + 2.0)
            )
        )
    ].copy())
    lean_keys = set(zip(lean["season"], lean["gameId"], lean["market"], strict=True))
    return candidate[[
        (season, game_id, market) not in lean_keys
        for season, game_id, market in zip(
            candidate["season"], candidate["gameId"], candidate["market"], strict=True
        )
    ]].copy()


def best_angle_rows(lean: pd.DataFrame, rule: pragmatic.PragmaticRule) -> pd.DataFrame:
    return lean[
        lean["probability"].ge(max(rule.minimum_probability, 0.65))
        & lean["expectedValue"].ge(max(rule.minimum_ev, 0.04))
        & lean["edgePp"].ge(max(rule.minimum_edge_pp, 3.0))
    ].copy()


def best_angle_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    return {
        "minimumCounts": summary["actions"] >= 16 and all(row["actions"] >= 5 for row in seasons),
        "positiveEachSeason": all(row["units"] > 0 for row in seasons),
        "largestWinIndependentEachSeason": all(row["unitsWithoutLargestWin"] > 0 for row in seasons),
        "minimumRoi": summary["roi"] is not None and summary["roi"] >= 0.04,
        "calibration": all(
            row["calibration"]["absoluteGap"] is not None
            and row["calibration"]["absoluteGap"] <= 0.12 for row in seasons
        ),
        "bootstrapPositive": (
            bootstrap["probabilityPositiveUnits"] is not None
            and bootstrap["probabilityPositiveUnits"] >= 0.75
        ),
        "multiBook": len(summary["bookMix"]) >= 2,
    }


def run_market(rows: pd.DataFrame, market: str) -> dict[str, Any]:
    universe = rows[rows["market"].eq(market)]
    rule, candidates = select_rule(rows, market)
    output: dict[str, Any] = {
        "selectionCandidateCount": len(candidates),
        "selectionEligibleCount": sum(bool(row["eligible"]) for row in candidates),
        "selectionCandidates": [residual.compact(row) for row in candidates],
        "selectedLeanRule": None if rule is None else asdict(rule),
        "leanSelection": None,
        "leanConfirmation": None,
        "leanConfirmationBootstrap": None,
        "leanConfirmationGates": {},
        "leanAuthorized": False,
        "watchlistSelection": None,
        "watchlistConfirmation": None,
        "watchlistAuthorized": False,
        "bestAngleSelection": None,
        "bestAngleConfirmation": None,
        "bestAngleConfirmationBootstrap": None,
        "bestAngleConfirmationGates": {},
        "bestAngleAuthorized": False,
    }
    if rule is None:
        return output
    lean = select_lean(rows, rule)
    confirmation_rows = lean[lean["season"].isin(CONFIRMATION_SEASONS)]
    selection = pragmatic.summarize(lean, (SELECTION_SEASON,), universe)
    confirmation = pragmatic.summarize(lean, CONFIRMATION_SEASONS, universe)
    bootstrap = r1.weekly_bootstrap(confirmation_rows)
    gates = confirmation_gates(confirmation, bootstrap)
    watch = watchlist_rows(rows, rule, lean)
    ba = best_angle_rows(lean, rule)
    ba_confirmation = pragmatic.summarize(ba, CONFIRMATION_SEASONS, universe)
    ba_bootstrap = r1.weekly_bootstrap(ba[ba["season"].isin(CONFIRMATION_SEASONS)])
    ba_gates = best_angle_gates(ba_confirmation, ba_bootstrap)
    output.update({
        "leanSelection": selection,
        "leanConfirmation": confirmation,
        "leanConfirmationBootstrap": bootstrap,
        "leanConfirmationGates": gates,
        "leanAuthorized": bool(all(gates.values())),
        "watchlistSelection": pragmatic.summarize(watch, (SELECTION_SEASON,), universe),
        "watchlistConfirmation": pragmatic.summarize(watch, CONFIRMATION_SEASONS, universe),
        "watchlistAuthorized": bool(len(watch[watch["season"].eq(SELECTION_SEASON)]) > 0),
        "bestAngleSelection": pragmatic.summarize(ba, (SELECTION_SEASON,), universe),
        "bestAngleConfirmation": ba_confirmation,
        "bestAngleConfirmationBootstrap": ba_bootstrap,
        "bestAngleConfirmationGates": ba_gates,
        "bestAngleAuthorized": bool(all(gates.values()) and all(ba_gates.values())),
    })
    return output


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get(
        "NFL_RESEARCH_SOURCE_ROOT", "/private/tmp/oddsphere-nfl-daily-edge-launch-r1"
    )).resolve()
    rows, evidence = r1.build_offer_rows(source_root)
    reports = {market: run_market(rows, market) for market in pragmatic.MARKETS}
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-spread-total-high-conviction-predeclaration.md",
        "chronology": {"selection": [SELECTION_SEASON], "confirmation": list(CONFIRMATION_SEASONS)},
        "shadowOnly": True,
        "productionBehaviorChanged": False,
        "sourceEvidence": evidence,
        "marketReports": reports,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    path = report_root / f"{TOURNAMENT_RELEASE}.json"
    path.write_text(json.dumps(residual.json_safe(report), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "markets": {
            market: {
                "selectionEligibleCount": values["selectionEligibleCount"],
                "selectedLeanRule": values["selectedLeanRule"],
                "leanSelection": residual.compact(values["leanSelection"]),
                "leanConfirmation": residual.compact(values["leanConfirmation"]),
                "leanConfirmationBootstrap": values["leanConfirmationBootstrap"],
                "leanConfirmationGates": values["leanConfirmationGates"],
                "leanAuthorized": values["leanAuthorized"],
                "watchlistSelection": residual.compact(values["watchlistSelection"]),
                "watchlistConfirmation": residual.compact(values["watchlistConfirmation"]),
                "watchlistAuthorized": values["watchlistAuthorized"],
                "bestAngleConfirmation": residual.compact(values["bestAngleConfirmation"]),
                "bestAngleConfirmationGates": values["bestAngleConfirmationGates"],
                "bestAngleAuthorized": values["bestAngleAuthorized"],
            } for market, values in reports.items()
        },
        "report": str(path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
