#!/usr/bin/env python3
"""Frozen leave-one-book-out r10 residual-blend Spread/Total tournament."""

from __future__ import annotations

import json
import math
import os
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_spread_total_grading_r1 as r1
import tournament_nfl_spread_total_pragmatic_v2 as pragmatic


TOURNAMENT_RELEASE = "nfl_spread_total_residual_blend_tournament_2026_08_24_r3"
CALIBRATION_SEASON = 2022
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
ALPHAS = (0.25, 0.50, 0.75, 1.00)


def canonical_rows(rows: pd.DataFrame, seasons: tuple[int, ...]) -> pd.DataFrame:
    selected = rows[rows["season"].isin(seasons)].copy()
    selected["absolutePriceGap"] = selected["priceAdvantagePp"].abs()
    return (
        selected.sort_values(
            ["season", "gameId", "market", "looOtherBookCount", "absolutePriceGap", "book"],
            ascending=[True, True, True, False, True, True],
        )
        .groupby(["season", "gameId", "market"], sort=True, as_index=False)
        .head(1)
        .reset_index(drop=True)
    )


def probability_metrics(rows: pd.DataFrame, probability_column: str) -> dict[str, float | int]:
    resolved = rows[~rows["push"]].copy()
    probabilities = np.clip(resolved[probability_column].to_numpy(float), 1e-6, 1 - 1e-6)
    outcomes = resolved["won"].astype(float).to_numpy()
    return {
        "rows": int(len(resolved)),
        "brier": float(np.mean((probabilities - outcomes) ** 2)),
        "logLoss": float(-np.mean(outcomes * np.log(probabilities) + (1 - outcomes) * np.log(1 - probabilities))),
        "meanProbability": float(probabilities.mean()),
        "winRate": float(outcomes.mean()),
        "absoluteCalibrationGap": float(abs(probabilities.mean() - outcomes.mean())),
    }


def select_alphas(rows: pd.DataFrame) -> tuple[dict[str, float], dict[str, Any]]:
    calibration = canonical_rows(rows, (CALIBRATION_SEASON,))
    selected: dict[str, float] = {}
    evidence: dict[str, Any] = {}
    for market in pragmatic.MARKETS:
        market_rows = calibration[calibration["market"].eq(market)].copy()
        market_rows["r10Probability"] = market_rows["probability"]
        market_rows["otherBookProbability"] = market_rows["looFairProbability"]
        candidates: list[dict[str, Any]] = []
        for alpha in ALPHAS:
            market_rows["candidateProbability"] = (
                market_rows["otherBookProbability"]
                + alpha * (market_rows["r10Probability"] - market_rows["otherBookProbability"])
            ).clip(0.001, 0.999)
            metrics = probability_metrics(market_rows, "candidateProbability")
            candidates.append({"alpha": alpha, **metrics})
        candidates.sort(key=lambda row: (row["brier"], row["logLoss"], -row["alpha"]))
        chosen = candidates[0]
        selected[market] = float(chosen["alpha"])
        evidence[market] = {
            "selectedAlpha": chosen["alpha"],
            "candidates": candidates,
            "r10": probability_metrics(market_rows, "r10Probability"),
            "otherBooks": probability_metrics(market_rows, "otherBookProbability"),
        }
    return selected, evidence


def apply_blend(rows: pd.DataFrame, alphas: dict[str, float]) -> pd.DataFrame:
    output = rows.copy()
    output["r10Probability"] = output["probability"]
    output["otherBookProbability"] = output["looFairProbability"]
    output["blendAlpha"] = output["market"].map(alphas)
    output["probability"] = (
        output["otherBookProbability"]
        + output["blendAlpha"] * (output["r10Probability"] - output["otherBookProbability"])
    ).clip(0.001, 0.999)
    resolved_mass = 1.0 - output["pushProbability"]
    output["expectedValue"] = resolved_mass * (
        output["probability"] * output["price"].map(r1.multibook.profit_one)
        - (1.0 - output["probability"])
    )
    output["edgePp"] = 100.0 * (output["probability"] - output["otherBookProbability"])
    output["directionCoherent"] = output["probability"].ge(0.5)
    return output


def out_of_sample_probability_evidence(rows: pd.DataFrame) -> dict[str, Any]:
    canonical = canonical_rows(rows, (SELECTION_SEASON, *CONFIRMATION_SEASONS))
    evidence: dict[str, Any] = {}
    for market in pragmatic.MARKETS:
        evidence[market] = {}
        market_rows = canonical[canonical["market"].eq(market)]
        for season in (SELECTION_SEASON, *CONFIRMATION_SEASONS):
            season_rows = market_rows[market_rows["season"].eq(season)]
            evidence[market][str(season)] = {
                "blend": probability_metrics(season_rows, "probability"),
                "r10": probability_metrics(season_rows, "r10Probability"),
                "otherBooks": probability_metrics(season_rows, "otherBookProbability"),
                "meanAbsoluteBlendMinusMarketPp": float(
                    100.0 * (season_rows["probability"] - season_rows["otherBookProbability"]).abs().mean()
                ),
            }
    return evidence


def compact(summary: dict[str, Any] | None) -> dict[str, Any] | None:
    if summary is None:
        return None
    return {key: value for key, value in summary.items() if key != "selectedRows"}


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, (float, np.floating)) and not math.isfinite(float(value)):
        return None
    if isinstance(value, np.integer):
        return int(value)
    return value


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get(
        "NFL_RESEARCH_SOURCE_ROOT",
        "/private/tmp/oddsphere-nfl-daily-edge-launch-r1",
    )).resolve()
    raw_rows, source_evidence = r1.build_offer_rows(
        source_root,
        (CALIBRATION_SEASON, SELECTION_SEASON, *CONFIRMATION_SEASONS),
    )
    alphas, calibration_evidence = select_alphas(raw_rows)
    rows = apply_blend(raw_rows, alphas)
    probability_evidence = out_of_sample_probability_evidence(rows)
    market_reports: dict[str, Any] = {}
    for market in pragmatic.MARKETS:
        rule, selection_candidates = pragmatic.select_rule(rows, market)
        report: dict[str, Any] = {
            "blendAlpha": alphas[market],
            "selectionCandidateCount": len(selection_candidates),
            "selectionEligibleCount": sum(bool(row["eligible"]) for row in selection_candidates),
            "selectionCandidates": [compact(row) for row in selection_candidates],
            "selectedLeanRule": None if rule is None else asdict_safe(rule),
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
            universe = rows[rows["market"].eq(market)]
            all_lean = pragmatic.select_lean(rows, rule)
            lean_selection = pragmatic.summarize(all_lean, (SELECTION_SEASON,), universe)
            confirmation_rows = all_lean[all_lean["season"].isin(CONFIRMATION_SEASONS)]
            lean_confirmation = pragmatic.summarize(all_lean, CONFIRMATION_SEASONS, universe)
            lean_bootstrap = r1.weekly_bootstrap(confirmation_rows)
            lean_gates = pragmatic.confirmation_gates(lean_confirmation, lean_bootstrap)
            lean_authorized = bool(all(lean_gates.values()))
            watch = pragmatic.watchlist_rows(rows, rule, all_lean)
            watch_confirmation_rows = watch[watch["season"].isin(CONFIRMATION_SEASONS)]
            watch_selection = pragmatic.summarize(watch, (SELECTION_SEASON,), universe)
            watch_confirmation = pragmatic.summarize(watch, CONFIRMATION_SEASONS, universe)
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

            ba_rule, ba_candidates = pragmatic.select_best_angle(rows, rule, all_lean)
            report["bestAngleCandidates"] = [compact(row) for row in ba_candidates]
            if ba_rule is not None:
                ba_rows = all_lean[
                    all_lean["probability"].ge(max(rule.minimum_probability, ba_rule.minimum_probability))
                    & all_lean["expectedValue"].ge(max(rule.minimum_ev, ba_rule.minimum_ev))
                    & all_lean["edgePp"].ge(max(rule.minimum_edge_pp, ba_rule.minimum_edge_pp))
                ].copy()
                ba_confirmation_rows = ba_rows[ba_rows["season"].isin(CONFIRMATION_SEASONS)]
                ba_confirmation = pragmatic.summarize(ba_rows, CONFIRMATION_SEASONS, universe)
                ba_bootstrap = r1.weekly_bootstrap(ba_confirmation_rows)
                ba_gates = pragmatic.best_angle_confirmation_gates(ba_confirmation, ba_bootstrap)
                report.update({
                    "bestAngleRule": asdict_safe(ba_rule),
                    "bestAngleSelection": next(row for row in ba_candidates if row["rule"] == asdict_safe(ba_rule)),
                    "bestAngleConfirmation": ba_confirmation,
                    "bestAngleConfirmationBootstrap": ba_bootstrap,
                    "bestAngleConfirmationGates": ba_gates,
                    "bestAngleAuthorized": bool(lean_authorized and all(ba_gates.values())),
                })
        market_reports[market] = report

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-spread-total-residual-blend-predeclaration.md",
        "chronology": {
            "blendCalibration": [CALIBRATION_SEASON],
            "policySelection": [SELECTION_SEASON],
            "confirmation": list(CONFIRMATION_SEASONS),
        },
        "shadowOnly": True,
        "productionBehaviorChanged": False,
        "modelChanged": False,
        "trackingChanged": False,
        "stakesChanged": False,
        "sourceEvidence": source_evidence,
        "blendCalibration": calibration_evidence,
        "outOfSampleProbabilityEvidence": probability_evidence,
        "marketReports": market_reports,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    path = report_root / f"{TOURNAMENT_RELEASE}.json"
    path.write_text(json.dumps(json_safe(report), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "selectedAlphas": alphas,
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


def asdict_safe(value: Any) -> dict[str, Any]:
    return {key: getattr(value, key) for key in value.__dataclass_fields__}


if __name__ == "__main__":
    main()
