#!/usr/bin/env python3
"""Frozen conviction-first NFL Spread/Total pragmatic v1 tournament."""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_spread_total_grading_r1 as r1


TOURNAMENT_RELEASE = "nfl_spread_total_pragmatic_tournament_2026_08_24_r2"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
MARKETS = ("spread", "total")
PROBABILITY_FLOORS = (0.55, 0.575, 0.60, 0.625)
EV_FLOORS = (0.00, 0.01, 0.02)
EDGE_FLOORS_PP = (0.0, 1.0, 2.0)
CUSHION_FLOORS = (0.0, 0.5, 1.0)
BEST_ANGLE_PROBABILITY_FLOORS = (0.60, 0.625, 0.65, 0.675)
BEST_ANGLE_EV_FLOORS = (0.04, 0.06)
BEST_ANGLE_EDGE_FLOORS_PP = (3.0, 4.0)
RANDOM_STATE = 24082027


@dataclass(frozen=True)
class PragmaticRule:
    market: str
    minimum_probability: float
    minimum_ev: float
    minimum_edge_pp: float
    minimum_cushion: float

    @property
    def name(self) -> str:
        return (
            f"{self.market}__p{self.minimum_probability:.3f}__ev{self.minimum_ev:.2f}"
            f"__edge{self.minimum_edge_pp:.1f}__cushion{self.minimum_cushion:.1f}"
        )


@dataclass(frozen=True)
class BestAngleRule:
    minimum_probability: float
    minimum_ev: float
    minimum_edge_pp: float

    @property
    def name(self) -> str:
        return (
            f"p{self.minimum_probability:.3f}__ev{self.minimum_ev:.2f}"
            f"__edge{self.minimum_edge_pp:.1f}"
        )


def common_eligible(rows: pd.DataFrame, rule: PragmaticRule) -> pd.Series:
    return (
        rows["market"].eq(rule.market)
        & rows["baseHealth"]
        & rows["directionCoherent"]
        & rows["boundedPrice"]
        & rows["priceAdvantagePp"].ge(-1.0)
        & rows["cushion"].ge(rule.minimum_cushion + rows["cushionPenalty"])
    )


def select_lean(rows: pd.DataFrame, rule: PragmaticRule) -> pd.DataFrame:
    return r1.reduce_best_offer(rows[
        common_eligible(rows, rule)
        & rows["probability"].ge(rule.minimum_probability)
        & rows["expectedValue"].ge(rule.minimum_ev)
        & rows["edgePp"].ge(rule.minimum_edge_pp)
    ].copy())


def calibration(rows: pd.DataFrame) -> dict[str, float | int | None]:
    resolved = rows[~rows["push"]]
    if resolved.empty:
        return {"rows": 0, "meanProbability": None, "winRate": None, "absoluteGap": None, "brier": None}
    probabilities = resolved["probability"].to_numpy(float)
    outcomes = resolved["won"].astype(float).to_numpy()
    return {
        "rows": int(len(resolved)),
        "meanProbability": float(probabilities.mean()),
        "winRate": float(outcomes.mean()),
        "absoluteGap": float(abs(probabilities.mean() - outcomes.mean())),
        "brier": float(np.mean((probabilities - outcomes) ** 2)),
    }


def summarize(rows: pd.DataFrame, seasons: tuple[int, ...], universe: pd.DataFrame) -> dict[str, Any]:
    result = r1.summarize(rows, seasons, universe)
    selected = rows[rows["season"].isin(seasons)]
    result["calibration"] = calibration(selected)
    for season in seasons:
        result["bySeason"][str(season)]["calibration"] = calibration(selected[selected["season"].eq(season)])
    return result


def clv_gate(summary: dict[str, Any], positive_rate: float) -> bool:
    return bool(
        (summary["meanClv"] is not None and summary["meanClv"] >= 0)
        or (summary["positiveClvRate"] is not None and summary["positiveClvRate"] >= positive_rate)
    )


def selection_passes(summary: dict[str, Any]) -> bool:
    gap = summary["calibration"]["absoluteGap"]
    return bool(
        summary["actions"] >= 18
        and summary["weeksWithGrade"] >= 8
        and summary["units"] > 0
        and summary["unitsWithoutLargestWin"] > 0
        and gap is not None and gap <= 0.08
        and len(summary["bookMix"]) >= 2
        and clv_gate(summary, 0.45)
    )


def confirmation_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    pooled_gap = summary["calibration"]["absoluteGap"]
    return {
        "minimumCounts": summary["actions"] >= 40 and all(row["actions"] >= 15 for row in seasons),
        "positivePooledUnits": summary["units"] > 0,
        "largestWinIndependent": summary["unitsWithoutLargestWin"] > 0,
        "seasonRobustness": (
            sum(row["units"] > 0 for row in seasons) >= 1
            and all(row["roi"] is not None and row["roi"] >= -0.05 for row in seasons)
        ),
        "calibration": (
            pooled_gap is not None and pooled_gap <= 0.08
            and all(row["calibration"]["absoluteGap"] is not None and row["calibration"]["absoluteGap"] <= 0.12 for row in seasons)
        ),
        "bootstrapPositive": bootstrap["probabilityPositiveUnits"] is not None and bootstrap["probabilityPositiveUnits"] >= 0.65,
        "clv": clv_gate(summary, 0.45),
        "multiBook": len(summary["bookMix"]) >= 2,
    }


def select_rule(rows: pd.DataFrame, market: str) -> tuple[PragmaticRule | None, list[dict[str, Any]]]:
    candidates: list[dict[str, Any]] = []
    universe = rows[rows["market"].eq(market)]
    for probability in PROBABILITY_FLOORS:
        for ev in EV_FLOORS:
            for edge in EDGE_FLOORS_PP:
                for cushion in CUSHION_FLOORS:
                    rule = PragmaticRule(market, probability, ev, edge, cushion)
                    selected = select_lean(rows, rule)
                    result = summarize(selected, (SELECTION_SEASON,), universe)
                    result["rule"] = asdict(rule)
                    result["ruleName"] = rule.name
                    result["eligible"] = selection_passes(result)
                    candidates.append(result)
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["unitsWithoutLargestWin"],
        -row["units"],
        row["calibration"]["absoluteGap"],
        -(row["meanClv"] if row["meanClv"] is not None else -999),
        row["actions"],
        row["ruleName"],
    ))
    if not eligible:
        return None, candidates
    return PragmaticRule(**eligible[0]["rule"]), candidates


def watchlist_rows(rows: pd.DataFrame, rule: PragmaticRule, lean: pd.DataFrame) -> pd.DataFrame:
    eligible = common_eligible(rows, rule) & rows["probability"].ge(rule.minimum_probability)
    near_edge = rows["expectedValue"].ge(-0.02) & rows["edgePp"].ge(-2.0)
    meaningful_disagreement = rows["edgePp"].ge(4.0) & rows["expectedValue"].ge(-0.03)
    candidates = r1.reduce_best_offer(rows[eligible & (near_edge | meaningful_disagreement)].copy())
    lean_keys = set(zip(lean["season"], lean["gameId"], lean["market"], strict=True))
    return candidates[[
        (season, game_id, market) not in lean_keys
        for season, game_id, market in zip(candidates["season"], candidates["gameId"], candidates["market"], strict=True)
    ]].copy()


def select_best_angle(rows: pd.DataFrame, lean_rule: PragmaticRule, all_lean: pd.DataFrame) -> tuple[BestAngleRule | None, list[dict[str, Any]]]:
    candidates: list[dict[str, Any]] = []
    universe = rows[rows["market"].eq(lean_rule.market)]
    selection_lean = all_lean[all_lean["season"].eq(SELECTION_SEASON)]
    for probability in BEST_ANGLE_PROBABILITY_FLOORS:
        for ev in BEST_ANGLE_EV_FLOORS:
            for edge in BEST_ANGLE_EDGE_FLOORS_PP:
                rule = BestAngleRule(probability, ev, edge)
                selected = selection_lean[
                    selection_lean["probability"].ge(max(lean_rule.minimum_probability, probability))
                    & selection_lean["expectedValue"].ge(max(lean_rule.minimum_ev, ev))
                    & selection_lean["edgePp"].ge(max(lean_rule.minimum_edge_pp, edge))
                ].copy()
                result = summarize(selected, (SELECTION_SEASON,), universe)
                result["rule"] = asdict(rule)
                result["ruleName"] = rule.name
                gap = result["calibration"]["absoluteGap"]
                result["eligible"] = bool(
                    result["actions"] >= 12
                    and result["weeksWithGrade"] >= 6
                    and result["units"] > 0
                    and result["unitsWithoutLargestWin"] > 0
                    and gap is not None and gap <= 0.08
                    and len(result["bookMix"]) >= 2
                    and clv_gate(result, 0.50)
                )
                candidates.append(result)
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["unitsWithoutLargestWin"], -row["units"], row["calibration"]["absoluteGap"], row["actions"], row["ruleName"]
    ))
    if not eligible:
        return None, candidates
    return BestAngleRule(**eligible[0]["rule"]), candidates


def best_angle_confirmation_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    pooled_gap = summary["calibration"]["absoluteGap"]
    return {
        "minimumCounts": summary["actions"] >= 30 and all(row["actions"] >= 10 for row in seasons),
        "positiveEachSeason": all(row["units"] > 0 for row in seasons),
        "largestWinIndependent": summary["unitsWithoutLargestWin"] > 0 and all(row["unitsWithoutLargestWin"] > 0 for row in seasons),
        "minimumRoi": summary["roi"] is not None and summary["roi"] >= 0.03,
        "calibration": (
            pooled_gap is not None and pooled_gap <= 0.08
            and all(row["calibration"]["absoluteGap"] is not None and row["calibration"]["absoluteGap"] <= 0.12 for row in seasons)
        ),
        "bootstrapPositive": bootstrap["probabilityPositiveUnits"] is not None and bootstrap["probabilityPositiveUnits"] >= 0.80,
        "clv": clv_gate(summary, 0.50),
        "multiBook": len(summary["bookMix"]) >= 2,
    }


def compact(summary: dict[str, Any] | None) -> dict[str, Any] | None:
    if summary is None:
        return None
    return {key: value for key, value in summary.items() if key != "selectedRows"}


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get(
        "NFL_RESEARCH_SOURCE_ROOT",
        "/private/tmp/oddsphere-nfl-daily-edge-launch-r1",
    )).resolve()
    rows, evidence = r1.build_offer_rows(source_root)
    market_reports: dict[str, Any] = {}
    for market in MARKETS:
        rule, selection_candidates = select_rule(rows, market)
        report: dict[str, Any] = {
            "selectionCandidateCount": len(selection_candidates),
            "selectionEligibleCount": sum(bool(row["eligible"]) for row in selection_candidates),
            "selectionCandidates": [compact(row) for row in selection_candidates],
            "selectedLeanRule": None if rule is None else asdict(rule),
            "leanSelection": None,
            "leanConfirmation": None,
            "leanConfirmationBootstrap": None,
            "leanConfirmationGates": {},
            "leanAuthorized": False,
            "watchlistSelection": None,
            "watchlistConfirmation": None,
            "watchlistConfirmationBootstrap": None,
            "watchlistAuthorized": False,
            "bestAngleRule": None,
            "bestAngleSelection": None,
            "bestAngleConfirmation": None,
            "bestAngleConfirmationBootstrap": None,
            "bestAngleConfirmationGates": {},
            "bestAngleAuthorized": False,
            "bestAngleCandidates": [],
        }
        if rule is not None:
            all_lean = select_lean(rows, rule)
            lean_selection = summarize(all_lean, (SELECTION_SEASON,), rows[rows["market"].eq(market)])
            lean_confirmation_rows = all_lean[all_lean["season"].isin(CONFIRMATION_SEASONS)]
            lean_confirmation = summarize(all_lean, CONFIRMATION_SEASONS, rows[rows["market"].eq(market)])
            lean_bootstrap = r1.weekly_bootstrap(lean_confirmation_rows)
            lean_gates = confirmation_gates(lean_confirmation, lean_bootstrap)
            lean_authorized = bool(all(lean_gates.values()))
            all_watch = watchlist_rows(rows, rule, all_lean)
            watch_selection = summarize(all_watch, (SELECTION_SEASON,), rows[rows["market"].eq(market)])
            watch_confirmation_rows = all_watch[all_watch["season"].isin(CONFIRMATION_SEASONS)]
            watch_confirmation = summarize(all_watch, CONFIRMATION_SEASONS, rows[rows["market"].eq(market)])
            watch_authorized = bool(watch_selection["actions"] >= 1 and watch_selection["weeksWithGrade"] >= 1)
            report.update({
                "leanSelection": lean_selection,
                "leanConfirmation": lean_confirmation,
                "leanConfirmationBootstrap": lean_bootstrap,
                "leanConfirmationGates": lean_gates,
                "leanAuthorized": lean_authorized,
                "watchlistSelection": watch_selection,
                "watchlistConfirmation": watch_confirmation,
                "watchlistConfirmationBootstrap": r1.weekly_bootstrap(watch_confirmation_rows),
                "watchlistAuthorized": watch_authorized,
            })

            ba_rule, ba_candidates = select_best_angle(rows, rule, all_lean)
            report["bestAngleCandidates"] = [compact(row) for row in ba_candidates]
            if ba_rule is not None:
                ba_rows = all_lean[
                    all_lean["probability"].ge(max(rule.minimum_probability, ba_rule.minimum_probability))
                    & all_lean["expectedValue"].ge(max(rule.minimum_ev, ba_rule.minimum_ev))
                    & all_lean["edgePp"].ge(max(rule.minimum_edge_pp, ba_rule.minimum_edge_pp))
                ].copy()
                ba_confirmation_rows = ba_rows[ba_rows["season"].isin(CONFIRMATION_SEASONS)]
                ba_confirmation = summarize(ba_rows, CONFIRMATION_SEASONS, rows[rows["market"].eq(market)])
                ba_bootstrap = r1.weekly_bootstrap(ba_confirmation_rows)
                ba_gates = best_angle_confirmation_gates(ba_confirmation, ba_bootstrap)
                report.update({
                    "bestAngleRule": asdict(ba_rule),
                    "bestAngleSelection": next(row for row in ba_candidates if row["rule"] == asdict(ba_rule)),
                    "bestAngleConfirmation": ba_confirmation,
                    "bestAngleConfirmationBootstrap": ba_bootstrap,
                    "bestAngleConfirmationGates": ba_gates,
                    "bestAngleAuthorized": bool(lean_authorized and all(ba_gates.values())),
                })
        market_reports[market] = report

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-spread-total-pragmatic-v1-predeclaration.md",
        "chronology": {"selection": [SELECTION_SEASON], "confirmation": list(CONFIRMATION_SEASONS)},
        "shadowOnly": True,
        "productionBehaviorChanged": False,
        "modelChanged": False,
        "trackingChanged": False,
        "stakesChanged": False,
        "data": evidence,
        "marketReports": market_reports,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
        "limitations": [
            "The release is explicitly provisional even if a lane passes; bootstrap intervals may cross zero.",
            "Historical as-of QB, depth, injury, split, weather, and intraweek movement revisions cannot be reconstructed.",
            "2024-2025 are chronological confirmation but have been inspected by prior NFL research.",
            "No current Week 1 row enters policy selection or threshold choice.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    path = report_root / f"{TOURNAMENT_RELEASE}.json"
    path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "markets": {
            market: {
                "selectionEligibleCount": values["selectionEligibleCount"],
                "selectedLeanRule": values["selectedLeanRule"],
                "leanSelection": compact(values["leanSelection"]),
                "leanConfirmation": compact(values["leanConfirmation"]),
                "leanConfirmationBootstrap": values["leanConfirmationBootstrap"],
                "leanConfirmationGates": values["leanConfirmationGates"],
                "leanAuthorized": values["leanAuthorized"],
                "watchlistSelection": compact(values["watchlistSelection"]),
                "watchlistConfirmation": compact(values["watchlistConfirmation"]),
                "watchlistAuthorized": values["watchlistAuthorized"],
                "bestAngleRule": values["bestAngleRule"],
                "bestAngleConfirmation": compact(values["bestAngleConfirmation"]),
                "bestAngleConfirmationGates": values["bestAngleConfirmationGates"],
                "bestAngleAuthorized": values["bestAngleAuthorized"],
            }
            for market, values in market_reports.items()
        },
        "report": str(path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
