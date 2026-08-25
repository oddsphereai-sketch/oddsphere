#!/usr/bin/env python3
"""Frozen target-excluded NFL Spread/Total price-dislocation tournament."""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any

import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_spread_total_grading_r1 as r1
import tournament_nfl_spread_total_pragmatic_v2 as pragmatic
import tournament_nfl_spread_total_residual_blend_r3 as residual


TOURNAMENT_RELEASE = "nfl_spread_total_price_dislocation_tournament_2026_08_24_r5"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
R10_PROBABILITY_FLOORS = (0.50, 0.525, 0.55)
EV_FLOORS = (0.01, 0.02, 0.03)
PRICE_ADVANTAGE_FLOORS_PP = (1.0, 2.0, 3.0)
CUSHION_FLOORS = (0.0, 0.5)
BEST_ANGLE_EVS = (0.04, 0.06, 0.08)
BEST_ANGLE_PRICE_ADVANTAGES_PP = (3.0, 4.0, 5.0)


@dataclass(frozen=True)
class DislocationRule:
    market: str
    minimum_r10_probability: float
    minimum_ev: float
    minimum_price_advantage_pp: float
    minimum_cushion: float

    @property
    def name(self) -> str:
        return (
            f"{self.market}__r10p{self.minimum_r10_probability:.3f}"
            f"__ev{self.minimum_ev:.2f}__price{self.minimum_price_advantage_pp:.1f}"
            f"__cushion{self.minimum_cushion:.1f}"
        )


@dataclass(frozen=True)
class BestAngleRule:
    minimum_ev: float
    minimum_price_advantage_pp: float


def apply_market_probability(rows: pd.DataFrame) -> pd.DataFrame:
    output = rows.copy()
    output["r10Probability"] = output["probability"]
    output["otherBookProbability"] = output["looFairProbability"]
    output["probability"] = output["otherBookProbability"]
    resolved_mass = 1.0 - output["pushProbability"]
    output["expectedValue"] = resolved_mass * (
        output["probability"] * output["price"].map(r1.multibook.profit_one)
        - (1.0 - output["probability"])
    )
    output["edgePp"] = output["priceAdvantagePp"]
    output["directionCoherent"] = output["r10Probability"].ge(0.5)
    return output


def common_eligible(rows: pd.DataFrame, rule: DislocationRule) -> pd.Series:
    return (
        rows["market"].eq(rule.market)
        & rows["baseHealth"]
        & rows["directionCoherent"]
        & rows["boundedPrice"]
        & rows["r10Probability"].ge(rule.minimum_r10_probability)
        & rows["cushion"].ge(rule.minimum_cushion + rows["cushionPenalty"])
    )


def select_lean(rows: pd.DataFrame, rule: DislocationRule) -> pd.DataFrame:
    return r1.reduce_best_offer(rows[
        common_eligible(rows, rule)
        & rows["expectedValue"].ge(rule.minimum_ev)
        & rows["priceAdvantagePp"].ge(rule.minimum_price_advantage_pp)
    ].copy())


def selection_passes(summary: dict[str, Any]) -> bool:
    gap = summary["calibration"]["absoluteGap"]
    return bool(
        summary["actions"] >= 18
        and summary["weeksWithGrade"] >= 8
        and summary["units"] > 0
        and summary["unitsWithoutLargestWin"] > 0
        and gap is not None and gap <= 0.08
        and len(summary["bookMix"]) >= 2
        and pragmatic.clv_gate(summary, 0.45)
    )


def select_rule(rows: pd.DataFrame, market: str) -> tuple[DislocationRule | None, list[dict[str, Any]]]:
    candidates: list[dict[str, Any]] = []
    universe = rows[rows["market"].eq(market)]
    for r10_probability in R10_PROBABILITY_FLOORS:
        for ev in EV_FLOORS:
            for price_advantage in PRICE_ADVANTAGE_FLOORS_PP:
                for cushion in CUSHION_FLOORS:
                    rule = DislocationRule(market, r10_probability, ev, price_advantage, cushion)
                    selected = select_lean(rows, rule)
                    result = pragmatic.summarize(selected, (SELECTION_SEASON,), universe)
                    result["rule"] = asdict(rule)
                    result["ruleName"] = rule.name
                    result["eligible"] = selection_passes(result)
                    candidates.append(result)
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["unitsWithoutLargestWin"], -row["units"], row["calibration"]["absoluteGap"],
        -(row["meanClv"] if row["meanClv"] is not None else -999), row["actions"], row["ruleName"]
    ))
    if not eligible:
        return None, candidates
    return DislocationRule(**eligible[0]["rule"]), candidates


def watchlist_rows(rows: pd.DataFrame, rule: DislocationRule, lean: pd.DataFrame) -> pd.DataFrame:
    candidate = r1.reduce_best_offer(rows[
        common_eligible(rows, rule)
        & rows["expectedValue"].ge(rule.minimum_ev - 0.02)
        & rows["priceAdvantagePp"].ge(rule.minimum_price_advantage_pp - 1.0)
    ].copy())
    lean_keys = set(zip(lean["season"], lean["gameId"], lean["market"], strict=True))
    return candidate[[
        (season, game_id, market) not in lean_keys
        for season, game_id, market in zip(candidate["season"], candidate["gameId"], candidate["market"], strict=True)
    ]].copy()


def select_best_angle(rows: pd.DataFrame, lean_rule: DislocationRule, lean: pd.DataFrame) -> tuple[BestAngleRule | None, list[dict[str, Any]]]:
    candidates: list[dict[str, Any]] = []
    universe = rows[rows["market"].eq(lean_rule.market)]
    selection = lean[lean["season"].eq(SELECTION_SEASON)]
    for ev in BEST_ANGLE_EVS:
        for advantage in BEST_ANGLE_PRICE_ADVANTAGES_PP:
            rule = BestAngleRule(ev, advantage)
            selected = selection[
                selection["expectedValue"].ge(max(ev, lean_rule.minimum_ev))
                & selection["priceAdvantagePp"].ge(max(advantage, lean_rule.minimum_price_advantage_pp))
            ].copy()
            result = pragmatic.summarize(selected, (SELECTION_SEASON,), universe)
            result["rule"] = asdict(rule)
            result["eligible"] = bool(
                result["actions"] >= 12
                and result["weeksWithGrade"] >= 6
                and result["units"] > 0
                and result["unitsWithoutLargestWin"] > 0
                and result["calibration"]["absoluteGap"] is not None
                and result["calibration"]["absoluteGap"] <= 0.08
                and len(result["bookMix"]) >= 2
                and pragmatic.clv_gate(result, 0.50)
            )
            candidates.append(result)
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["unitsWithoutLargestWin"], -row["units"], row["calibration"]["absoluteGap"], row["actions"],
        row["rule"]["minimum_ev"], row["rule"]["minimum_price_advantage_pp"]
    ))
    if not eligible:
        return None, candidates
    return BestAngleRule(**eligible[0]["rule"]), candidates


def run_market(rows: pd.DataFrame, market: str) -> dict[str, Any]:
    rule, candidates = select_rule(rows, market)
    report: dict[str, Any] = {
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
    if rule is None:
        return report
    universe = rows[rows["market"].eq(market)]
    lean = select_lean(rows, rule)
    confirmation_rows = lean[lean["season"].isin(CONFIRMATION_SEASONS)]
    confirmation = pragmatic.summarize(lean, CONFIRMATION_SEASONS, universe)
    bootstrap = r1.weekly_bootstrap(confirmation_rows)
    gates = pragmatic.confirmation_gates(confirmation, bootstrap)
    authorized = bool(all(gates.values()))
    watch = watchlist_rows(rows, rule, lean)
    watch_confirmation_rows = watch[watch["season"].isin(CONFIRMATION_SEASONS)]
    report.update({
        "leanSelection": pragmatic.summarize(lean, (SELECTION_SEASON,), universe),
        "leanConfirmation": confirmation,
        "leanConfirmationBootstrap": bootstrap,
        "leanConfirmationGates": gates,
        "leanAuthorized": authorized,
        "watchlistSelection": pragmatic.summarize(watch, (SELECTION_SEASON,), universe),
        "watchlistConfirmation": pragmatic.summarize(watch, CONFIRMATION_SEASONS, universe),
        "watchlistConfirmationBootstrap": r1.weekly_bootstrap(watch_confirmation_rows),
        "watchlistAuthorized": bool(len(watch[watch["season"].eq(SELECTION_SEASON)]) > 0),
    })
    ba_rule, ba_candidates = select_best_angle(rows, rule, lean)
    report["bestAngleCandidates"] = [residual.compact(row) for row in ba_candidates]
    if ba_rule is not None:
        ba = lean[
            lean["expectedValue"].ge(max(ba_rule.minimum_ev, rule.minimum_ev))
            & lean["priceAdvantagePp"].ge(max(ba_rule.minimum_price_advantage_pp, rule.minimum_price_advantage_pp))
        ].copy()
        ba_confirmation_rows = ba[ba["season"].isin(CONFIRMATION_SEASONS)]
        ba_confirmation = pragmatic.summarize(ba, CONFIRMATION_SEASONS, universe)
        ba_bootstrap = r1.weekly_bootstrap(ba_confirmation_rows)
        ba_gates = pragmatic.best_angle_confirmation_gates(ba_confirmation, ba_bootstrap)
        report.update({
            "bestAngleRule": asdict(ba_rule),
            "bestAngleSelection": next(row for row in ba_candidates if row["rule"] == asdict(ba_rule)),
            "bestAngleConfirmation": ba_confirmation,
            "bestAngleConfirmationBootstrap": ba_bootstrap,
            "bestAngleConfirmationGates": ba_gates,
            "bestAngleAuthorized": bool(authorized and all(ba_gates.values())),
        })
    return report


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get(
        "NFL_RESEARCH_SOURCE_ROOT",
        "/private/tmp/oddsphere-nfl-daily-edge-launch-r1",
    )).resolve()
    raw, evidence = r1.build_offer_rows(source_root)
    rows = apply_market_probability(raw)
    reports = {market: run_market(rows, market) for market in pragmatic.MARKETS}
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-spread-total-price-dislocation-predeclaration.md",
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
                "bestAngleRule": values["bestAngleRule"],
                "bestAngleConfirmation": residual.compact(values["bestAngleConfirmation"]),
                "bestAngleConfirmationGates": values["bestAngleConfirmationGates"],
                "bestAngleAuthorized": values["bestAngleAuthorized"],
            }
            for market, values in reports.items()
        },
        "report": str(path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
