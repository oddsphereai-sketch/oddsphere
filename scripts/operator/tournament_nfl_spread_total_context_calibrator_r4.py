#!/usr/bin/env python3
"""Frozen NFL Spread/Total nonlinear context-calibrator tournament."""

from __future__ import annotations

import json
import math
import os
import pathlib
import sys
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_spread_total_grading_r1 as r1
import tournament_nfl_spread_total_pragmatic_v2 as pragmatic
import tournament_nfl_spread_total_residual_blend_r3 as residual


TOURNAMENT_RELEASE = "nfl_spread_total_context_calibrator_tournament_2026_08_24_r4"
FIT_WEEKS = tuple(range(1, 13))
VALIDATION_WEEKS = tuple(range(13, 19))
RECIPES = ("residual_linear", "residual_context")
C_VALUES = (0.03, 0.10, 0.30, 1.00)
CALIBRATION_SEASON = 2022
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)


@dataclass
class FittedCalibrator:
    market: str
    recipe: str
    c_value: float
    means: np.ndarray
    scales: np.ndarray
    model: LogisticRegression


def finite_rows(rows: pd.DataFrame) -> pd.DataFrame:
    return rows[
        rows["baseHealth"]
        & np.isfinite(rows["looFairProbability"])
        & np.isfinite(rows["probability"])
        & ~rows["push"]
    ].copy()


def raw_features(rows: pd.DataFrame, market: str, recipe: str) -> tuple[np.ndarray, list[str]]:
    consensus = np.clip(rows["looFairProbability"].to_numpy(float), 0.01, 0.99)
    consensus_logit = np.log(consensus / (1.0 - consensus))
    r10_column = "r10Probability" if "r10Probability" in rows.columns else "probability"
    residual_feature = rows[r10_column].to_numpy(float) - consensus
    cushion = rows["cushion"].to_numpy(float) / 7.0
    first = rows["first"].astype(float).to_numpy()
    zone = (
        rows["keySensitive"].astype(float).to_numpy()
        if market == "spread"
        else rows["totalZoneSensitive"].astype(float).to_numpy()
    )
    columns = [consensus_logit, residual_feature, cushion, first, zone]
    names = ["consensusLogit", "r10Residual", "r10Cushion", "firstSide", "keyOrZone"]
    if recipe == "residual_context":
        line = rows["line"].abs().to_numpy(float)
        line_scale = line / 7.0 if market == "spread" else np.abs(line - 45.0) / 10.0
        columns.extend([line_scale, residual_feature * zone, cushion * zone])
        names.extend(["lineScale", "residualByKeyZone", "cushionByKeyZone"])
    return np.column_stack(columns), names


def fit_calibrator(rows: pd.DataFrame, market: str, recipe: str, c_value: float) -> FittedCalibrator:
    matrix, _ = raw_features(rows, market, recipe)
    means = matrix[:, 1:].mean(axis=0)
    scales = matrix[:, 1:].std(axis=0)
    scales[scales < 1e-8] = 1.0
    transformed = matrix.copy()
    transformed[:, 1:] = (transformed[:, 1:] - means) / scales
    model = LogisticRegression(C=c_value, solver="lbfgs", max_iter=2000, random_state=r1.RANDOM_STATE)
    model.fit(transformed, rows["won"].astype(int).to_numpy())
    return FittedCalibrator(market, recipe, c_value, means, scales, model)


def predict(calibrator: FittedCalibrator, rows: pd.DataFrame) -> np.ndarray:
    matrix, _ = raw_features(rows, calibrator.market, calibrator.recipe)
    matrix[:, 1:] = (matrix[:, 1:] - calibrator.means) / calibrator.scales
    return calibrator.model.predict_proba(matrix)[:, 1]


def metrics(rows: pd.DataFrame, probabilities: np.ndarray) -> dict[str, Any]:
    outcomes = rows["won"].astype(float).to_numpy()
    p = np.clip(probabilities, 1e-6, 1 - 1e-6)
    consensus = rows["looFairProbability"].to_numpy(float)
    return {
        "rows": int(len(rows)),
        "brier": float(np.mean((p - outcomes) ** 2)),
        "logLoss": float(-np.mean(outcomes * np.log(p) + (1 - outcomes) * np.log(1 - p))),
        "absoluteCalibrationGap": float(abs(p.mean() - outcomes.mean())),
        "meanAbsoluteDeltaFromConsensusPp": float(100.0 * np.mean(np.abs(p - consensus))),
    }


def select_calibrators(rows: pd.DataFrame) -> tuple[dict[str, FittedCalibrator], dict[str, Any]]:
    canonical = residual.canonical_rows(rows, (CALIBRATION_SEASON,))
    fitted: dict[str, FittedCalibrator] = {}
    evidence: dict[str, Any] = {}
    for market in pragmatic.MARKETS:
        market_rows = finite_rows(canonical[canonical["market"].eq(market)])
        train = market_rows[market_rows["week"].isin(FIT_WEEKS)]
        validation = market_rows[market_rows["week"].isin(VALIDATION_WEEKS)]
        candidates: list[dict[str, Any]] = []
        models: dict[tuple[str, float], FittedCalibrator] = {}
        for recipe in RECIPES:
            for c_value in C_VALUES:
                model = fit_calibrator(train, market, recipe, c_value)
                models[(recipe, c_value)] = model
                probabilities = predict(model, validation)
                result = metrics(validation, probabilities)
                names = raw_features(train, market, recipe)[1]
                coefficients = {
                    name: float(model.model.coef_[0][index])
                    for index, name in enumerate(names)
                }
                football_l1 = abs(coefficients["r10Residual"]) + abs(coefficients["r10Cushion"])
                result.update({
                    "recipe": recipe,
                    "cValue": c_value,
                    "footballCoefficientL1": football_l1,
                    "coefficients": coefficients,
                    "nonCopy": football_l1 > 1e-6 and result["meanAbsoluteDeltaFromConsensusPp"] >= 0.25,
                })
                candidates.append(result)
        candidates.sort(key=lambda row: (
            row["brier"], row["logLoss"], RECIPES.index(row["recipe"]), row["cValue"]
        ))
        chosen = candidates[0]
        full = fit_calibrator(market_rows, market, str(chosen["recipe"]), float(chosen["cValue"]))
        fitted[market] = full
        evidence[market] = {
            "fitRows": int(len(train)),
            "validationRows": int(len(validation)),
            "selected": chosen,
            "candidates": candidates,
            "otherBookBaseline": metrics(validation, validation["looFairProbability"].to_numpy(float)),
            "r10Baseline": metrics(validation, validation["probability"].to_numpy(float)),
            "refitRows": int(len(market_rows)),
        }
    return fitted, evidence


def apply_calibrators(rows: pd.DataFrame, calibrators: dict[str, FittedCalibrator]) -> pd.DataFrame:
    output = rows.copy()
    output["r10Probability"] = output["probability"]
    output["otherBookProbability"] = output["looFairProbability"]
    output["probability"] = np.nan
    output["calibratorRecipe"] = None
    output["calibratorC"] = np.nan
    for market, calibrator in calibrators.items():
        market_mask = output["market"].eq(market) & np.isfinite(output["looFairProbability"])
        market_rows = output.loc[market_mask]
        matrix, _ = raw_features(market_rows, market, calibrator.recipe)
        complete = np.isfinite(matrix).all(axis=1)
        scored = market_rows.loc[complete]
        if scored.empty:
            continue
        scored_indices = scored.index
        output.loc[scored_indices, "probability"] = predict(calibrator, scored)
        output.loc[scored_indices, "calibratorRecipe"] = calibrator.recipe
        output.loc[scored_indices, "calibratorC"] = calibrator.c_value
    resolved_mass = 1.0 - output["pushProbability"]
    output["expectedValue"] = resolved_mass * (
        output["probability"] * output["price"].map(r1.multibook.profit_one)
        - (1.0 - output["probability"])
    )
    output["edgePp"] = 100.0 * (output["probability"] - output["otherBookProbability"])
    output["directionCoherent"] = output["probability"].ge(0.5)
    return output


def probability_evidence(rows: pd.DataFrame) -> dict[str, Any]:
    canonical = residual.canonical_rows(rows, (SELECTION_SEASON, *CONFIRMATION_SEASONS))
    result: dict[str, Any] = {}
    for market in pragmatic.MARKETS:
        result[market] = {}
        for season in (SELECTION_SEASON, *CONFIRMATION_SEASONS):
            sample = finite_rows(canonical[canonical["market"].eq(market) & canonical["season"].eq(season)])
            result[market][str(season)] = {
                "calibrated": metrics(sample, sample["probability"].to_numpy(float)),
                "r10": metrics(sample, sample["r10Probability"].to_numpy(float)),
                "otherBooks": metrics(sample, sample["otherBookProbability"].to_numpy(float)),
            }
    return result


def compact(summary: dict[str, Any] | None) -> dict[str, Any] | None:
    if summary is None:
        return None
    return {key: value for key, value in summary.items() if key != "selectedRows"}


def run_market(rows: pd.DataFrame, market: str, calibrator_ok: bool) -> dict[str, Any]:
    rule, candidates = pragmatic.select_rule(rows, market) if calibrator_ok else (None, [])
    report: dict[str, Any] = {
        "calibratorEligible": calibrator_ok,
        "selectionCandidateCount": len(candidates),
        "selectionEligibleCount": sum(bool(row["eligible"]) for row in candidates),
        "selectionCandidates": [compact(row) for row in candidates],
        "selectedLeanRule": None if rule is None else residual.asdict_safe(rule),
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
    lean = pragmatic.select_lean(rows, rule)
    lean_selection = pragmatic.summarize(lean, (SELECTION_SEASON,), universe)
    confirmation_rows = lean[lean["season"].isin(CONFIRMATION_SEASONS)]
    lean_confirmation = pragmatic.summarize(lean, CONFIRMATION_SEASONS, universe)
    lean_bootstrap = r1.weekly_bootstrap(confirmation_rows)
    lean_gates = pragmatic.confirmation_gates(lean_confirmation, lean_bootstrap)
    lean_authorized = bool(calibrator_ok and all(lean_gates.values()))
    watch = pragmatic.watchlist_rows(rows, rule, lean)
    watch_confirmation_rows = watch[watch["season"].isin(CONFIRMATION_SEASONS)]
    report.update({
        "leanSelection": lean_selection,
        "leanConfirmation": lean_confirmation,
        "leanConfirmationBootstrap": lean_bootstrap,
        "leanConfirmationGates": lean_gates,
        "leanAuthorized": lean_authorized,
        "watchlistSelection": pragmatic.summarize(watch, (SELECTION_SEASON,), universe),
        "watchlistConfirmation": pragmatic.summarize(watch, CONFIRMATION_SEASONS, universe),
        "watchlistConfirmationBootstrap": r1.weekly_bootstrap(watch_confirmation_rows),
        "watchlistAuthorized": bool(len(watch[watch["season"].eq(SELECTION_SEASON)]) > 0),
    })
    ba_rule, ba_candidates = pragmatic.select_best_angle(rows, rule, lean)
    report["bestAngleCandidates"] = [compact(row) for row in ba_candidates]
    if ba_rule is not None:
        ba_rows = lean[
            lean["probability"].ge(max(rule.minimum_probability, ba_rule.minimum_probability))
            & lean["expectedValue"].ge(max(rule.minimum_ev, ba_rule.minimum_ev))
            & lean["edgePp"].ge(max(rule.minimum_edge_pp, ba_rule.minimum_edge_pp))
        ].copy()
        ba_confirmation_rows = ba_rows[ba_rows["season"].isin(CONFIRMATION_SEASONS)]
        ba_confirmation = pragmatic.summarize(ba_rows, CONFIRMATION_SEASONS, universe)
        ba_bootstrap = r1.weekly_bootstrap(ba_confirmation_rows)
        ba_gates = pragmatic.best_angle_confirmation_gates(ba_confirmation, ba_bootstrap)
        report.update({
            "bestAngleRule": residual.asdict_safe(ba_rule),
            "bestAngleSelection": next(row for row in ba_candidates if row["rule"] == residual.asdict_safe(ba_rule)),
            "bestAngleConfirmation": ba_confirmation,
            "bestAngleConfirmationBootstrap": ba_bootstrap,
            "bestAngleConfirmationGates": ba_gates,
            "bestAngleAuthorized": bool(lean_authorized and all(ba_gates.values())),
        })
    return report


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get(
        "NFL_RESEARCH_SOURCE_ROOT",
        "/private/tmp/oddsphere-nfl-daily-edge-launch-r1",
    )).resolve()
    raw, source_evidence = r1.build_offer_rows(
        source_root,
        (CALIBRATION_SEASON, SELECTION_SEASON, *CONFIRMATION_SEASONS),
    )
    calibrators, calibration_evidence = select_calibrators(raw)
    rows = apply_calibrators(raw, calibrators)
    probabilities = probability_evidence(rows)
    calibrator_eligible = {
        market: bool(calibration_evidence[market]["selected"]["nonCopy"])
        for market in pragmatic.MARKETS
    }
    market_reports = {
        market: run_market(rows, market, calibrator_eligible[market])
        for market in pragmatic.MARKETS
    }
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-spread-total-context-calibrator-predeclaration.md",
        "chronology": {
            "calibratorFit": {"season": CALIBRATION_SEASON, "weeks": list(FIT_WEEKS)},
            "calibratorSelection": {"season": CALIBRATION_SEASON, "weeks": list(VALIDATION_WEEKS)},
            "policySelection": [SELECTION_SEASON],
            "confirmation": list(CONFIRMATION_SEASONS),
        },
        "shadowOnly": True,
        "productionBehaviorChanged": False,
        "sourceEvidence": source_evidence,
        "calibratorEvidence": calibration_evidence,
        "outOfSampleProbabilityEvidence": probabilities,
        "marketReports": market_reports,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    path = report_root / f"{TOURNAMENT_RELEASE}.json"
    path.write_text(json.dumps(residual.json_safe(report), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "calibrators": {
            market: calibration_evidence[market]["selected"] for market in pragmatic.MARKETS
        },
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
