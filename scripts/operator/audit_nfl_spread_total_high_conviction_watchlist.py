#!/usr/bin/env python3
"""Reproduce the frozen non-actionable NFL Spread/Total Watchlist cohort."""

from __future__ import annotations

import json
import pathlib
import time

import joblib

import tournament_nfl_spread_total_grading_r1 as r1
import tournament_nfl_spread_total_pragmatic_v2 as pragmatic
import tournament_nfl_spread_total_residual_blend_r3 as residual


AUDIT_RELEASE = "nfl_spread_total_high_conviction_watchlist_audit_2026_08_24_r1"
SEASONS = (2023, 2024, 2025)


def cohort(rows, market: str):
    selected = rows[
        rows["market"].eq(market)
        & rows["baseHealth"]
        & rows["directionCoherent"]
        & rows["looOtherBookCount"].ge(2)
        & rows["price"].between(-200, 200, inclusive="both")
        & rows["probability"].ge(0.60)
        & rows["expectedValue"].ge(0.0)
        & rows["edgePp"].ge(3.0)
        & rows["cushion"].ge(1.0 + rows["cushionPenalty"])
    ].copy()
    return r1.reduce_best_offer(selected)


def main() -> None:
    root = pathlib.Path.cwd()
    cached = joblib.load(root / "football-research/cache/nfl-model/nfl_spread_total_offer_rows_2021_2025.joblib")
    rows = cached["rows"]
    reports = {}
    for market in ("spread", "total"):
        selected = cohort(rows, market)
        summary = pragmatic.summarize(selected, SEASONS, rows[rows["market"].eq(market)])
        reports[market] = {
            "summary": summary,
            "weeklyBootstrap": r1.weekly_bootstrap(selected[selected["season"].isin(SEASONS)]),
            "nonActionable": True,
            "leanAuthorized": False,
            "bestAngleAuthorized": False,
        }
    report = {
        "auditRelease": AUDIT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-spread-total-high-conviction-watchlist-predeclaration.md",
        "seasons": list(SEASONS),
        "sourceEvidence": cached["evidence"],
        "fixedSemantics": {
            "minimumProbability": 0.60, "minimumExpectedValue": 0.0,
            "minimumEdgePercentagePoints": 3.0, "minimumCushion": 1.0,
            "keyOrExtremeZoneAdditionalCushion": 0.5,
        },
        "marketReports": reports,
        "productionBehaviorChanged": False,
    }
    path = root / "football-research/reports" / f"{AUDIT_RELEASE}.json"
    path.write_text(json.dumps(residual.json_safe(report), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "auditRelease": AUDIT_RELEASE,
        "markets": {market: {
            "summary": residual.compact(values["summary"]),
            "weeklyBootstrap": values["weeklyBootstrap"],
            "nonActionable": True,
        } for market, values in reports.items()},
        "report": str(path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
