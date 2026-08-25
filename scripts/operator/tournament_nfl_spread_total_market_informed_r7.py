#!/usr/bin/env python3
"""Frozen market-informed residual classifier for NFL Spread and Total."""

from __future__ import annotations

import json
import math
import os
import pathlib
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_spread_total_grading_r1 as r1
import tournament_nfl_spread_total_pragmatic_v2 as pragmatic
import tournament_nfl_spread_total_residual_blend_r3 as residual


TOURNAMENT_RELEASE = "nfl_spread_total_market_informed_tournament_2026_08_24_r7"
FIT_SEASON = 2021
MODEL_SELECTION_SEASON = 2022
POLICY_SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
FEATURES = (
    "r10_logit", "loo_logit", "residual_logit", "cushion", "line_abs",
    "week_scaled", "first_side", "key_sensitive", "zone_sensitive",
)
PROBABILITY_FLOORS = (0.525, 0.55, 0.575, 0.60, 0.625, 0.65)
EV_FLOORS = (0.00, 0.01, 0.02, 0.03)
EDGE_FLOORS_PP = (0.0, 1.0, 2.0, 3.0, 4.0)
CUSHION_FLOORS = (0.0, 0.5, 1.0, 2.0)
RANDOM_STATE = 24082029


@dataclass(frozen=True)
class HeadRecipe:
    family: str
    c: float | None = None
    depth: int | None = None
    learning_rate: float | None = None
    l2: float | None = None

    @property
    def name(self) -> str:
        if self.family == "logistic":
            return f"logistic_c{self.c}"
        return f"hist_depth{self.depth}_lr{self.learning_rate}_l2{self.l2}"


def logit(value: pd.Series) -> pd.Series:
    clipped = value.clip(1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped))


def add_features(rows: pd.DataFrame) -> pd.DataFrame:
    output = rows[
        rows["baseHealth"]
        & rows["directionCoherent"]
        & rows["looOtherBookCount"].ge(2)
        & rows["price"].between(-200, 200, inclusive="both")
    ].copy()
    output["r10_logit"] = logit(output["probability"])
    output["loo_logit"] = logit(output["looFairProbability"])
    output["residual_logit"] = output["r10_logit"] - output["loo_logit"]
    output["line_abs"] = output["line"].abs()
    output["week_scaled"] = output["week"].astype(float) / 18.0
    output["first_side"] = output["first"].astype(float)
    output["key_sensitive"] = output["keySensitive"].astype(float)
    output["zone_sensitive"] = output["totalZoneSensitive"].astype(float)
    finite = np.isfinite(output[list(FEATURES)].to_numpy(float)).all(axis=1)
    return output[finite].copy()


def game_weights(rows: pd.DataFrame) -> np.ndarray:
    counts = rows.groupby(["season", "gameId", "market"])["book"].transform("count")
    return (1.0 / counts.clip(lower=1)).to_numpy(float)


def recipes() -> list[HeadRecipe]:
    output = [HeadRecipe("logistic", c=value) for value in (0.03, 0.1, 0.3, 1.0)]
    output.extend(
        HeadRecipe("hist", depth=depth, learning_rate=rate, l2=l2)
        for depth in (2, 3) for rate in (0.03, 0.05) for l2 in (1.0, 5.0)
    )
    return output


def build_model(recipe: HeadRecipe) -> Any:
    if recipe.family == "logistic":
        return Pipeline([
            ("scale", StandardScaler()),
            ("model", LogisticRegression(C=float(recipe.c), max_iter=4000, random_state=RANDOM_STATE)),
        ])
    return HistGradientBoostingClassifier(
        max_depth=int(recipe.depth),
        learning_rate=float(recipe.learning_rate),
        l2_regularization=float(recipe.l2),
        max_iter=150,
        min_samples_leaf=15,
        random_state=RANDOM_STATE,
    )


def weighted_metrics(rows: pd.DataFrame, probabilities: np.ndarray) -> dict[str, float | int]:
    weights = game_weights(rows)
    outcomes = rows["won"].astype(int).to_numpy()
    return {
        "rows": int(len(rows)),
        "uniqueGames": int(rows["gameId"].nunique()),
        "brier": float(brier_score_loss(outcomes, probabilities, sample_weight=weights)),
        "logLoss": float(log_loss(outcomes, probabilities, sample_weight=weights, labels=[0, 1])),
        "meanProbability": float(np.average(probabilities, weights=weights)),
        "winRate": float(np.average(outcomes, weights=weights)),
        "calibrationGap": float(abs(np.average(probabilities, weights=weights) - np.average(outcomes, weights=weights))),
    }


def select_head(rows: pd.DataFrame, market: str) -> tuple[HeadRecipe, list[dict[str, Any]], bool]:
    train = rows[rows["season"].eq(FIT_SEASON) & rows["market"].eq(market)].copy()
    selection = rows[rows["season"].eq(MODEL_SELECTION_SEASON) & rows["market"].eq(market)].copy()
    if train["won"].nunique() != 2 or selection["won"].nunique() != 2:
        raise RuntimeError(f"{market} classifier chronology lacks both outcomes")
    baseline = weighted_metrics(selection, selection["looFairProbability"].to_numpy(float))
    candidates: list[dict[str, Any]] = []
    for recipe in recipes():
        model = build_model(recipe)
        model.fit(train[list(FEATURES)], train["won"].astype(int), **fit_weight_args(model, game_weights(train)))
        probabilities = model.predict_proba(selection[list(FEATURES)])[:, 1]
        metrics = weighted_metrics(selection, probabilities)
        eligible = bool(
            metrics["brier"] <= baseline["brier"] + 0.005
            and metrics["logLoss"] <= baseline["logLoss"] + 0.01
        )
        candidates.append({
            "recipe": asdict(recipe), "name": recipe.name, "metrics": metrics,
            "baseline": baseline, "eligible": eligible,
        })
    eligible = [row for row in candidates if row["eligible"]]
    ranked = eligible if eligible else candidates
    ranked.sort(key=lambda row: (row["metrics"]["brier"], row["metrics"]["logLoss"], row["name"]))
    return HeadRecipe(**ranked[0]["recipe"]), candidates, bool(eligible)


def fit_weight_args(model: Any, weights: np.ndarray) -> dict[str, Any]:
    return {"model__sample_weight": weights} if isinstance(model, Pipeline) else {"sample_weight": weights}


def fit_final_head(rows: pd.DataFrame, market: str, recipe: HeadRecipe) -> Any:
    train = rows[rows["season"].isin((FIT_SEASON, MODEL_SELECTION_SEASON)) & rows["market"].eq(market)].copy()
    model = build_model(recipe)
    model.fit(train[list(FEATURES)], train["won"].astype(int), **fit_weight_args(model, game_weights(train)))
    return model


def apply_head(rows: pd.DataFrame, market: str, model: Any) -> pd.DataFrame:
    output = rows[rows["market"].eq(market)].copy()
    output["r10Probability"] = output["probability"]
    output["probability"] = model.predict_proba(output[list(FEATURES)])[:, 1]
    resolved = 1.0 - output["pushProbability"]
    output["expectedValue"] = resolved * (
        output["probability"] * output["price"].map(r1.multibook.profit_one)
        - (1.0 - output["probability"])
    )
    output["edgePp"] = 100.0 * (output["probability"] - output["looFairProbability"])
    return output


def common_eligible(rows: pd.DataFrame, rule: pragmatic.PragmaticRule) -> pd.Series:
    return (
        rows["baseHealth"]
        & rows["directionCoherent"]
        & rows["price"].between(-200, 200, inclusive="both")
        & rows["looOtherBookCount"].ge(2)
        & rows["priceAdvantagePp"].ge(-2.0)
        & rows["cushion"].ge(rule.minimum_cushion + rows["cushionPenalty"])
    )


def select_policy_rows(rows: pd.DataFrame, rule: pragmatic.PragmaticRule) -> pd.DataFrame:
    return r1.reduce_best_offer(rows[
        common_eligible(rows, rule)
        & rows["probability"].ge(rule.minimum_probability)
        & rows["expectedValue"].ge(rule.minimum_ev)
        & rows["edgePp"].ge(rule.minimum_edge_pp)
    ].copy())


def selection_passes(summary: dict[str, Any]) -> bool:
    gap = summary["calibration"]["absoluteGap"]
    return bool(
        summary["actions"] >= 12 and summary["weeksWithGrade"] >= 6
        and summary["units"] > 0 and summary["unitsWithoutLargestWin"] >= -0.5
        and gap is not None and gap <= 0.12 and len(summary["bookMix"]) >= 2
    )


def select_policy(rows: pd.DataFrame, market: str) -> tuple[pragmatic.PragmaticRule | None, list[dict[str, Any]]]:
    candidates: list[dict[str, Any]] = []
    for probability in PROBABILITY_FLOORS:
        for ev in EV_FLOORS:
            for edge in EDGE_FLOORS_PP:
                for cushion in CUSHION_FLOORS:
                    rule = pragmatic.PragmaticRule(market, probability, ev, edge, cushion)
                    summary = pragmatic.summarize(
                        select_policy_rows(rows, rule), (POLICY_SELECTION_SEASON,), rows
                    )
                    summary["rule"] = asdict(rule)
                    summary["ruleName"] = rule.name
                    summary["eligible"] = selection_passes(summary)
                    candidates.append(summary)
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["unitsWithoutLargestWin"], -row["units"], row["calibration"]["absoluteGap"],
        row["actions"], row["ruleName"],
    ))
    return (None, candidates) if not eligible else (pragmatic.PragmaticRule(**eligible[0]["rule"]), candidates)


def confirmation_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    return {
        "minimumCounts": summary["actions"] >= 24 and all(row["actions"] >= 8 for row in seasons),
        "positivePooledUnits": summary["units"] > 0,
        "largestWinIndependent": summary["unitsWithoutLargestWin"] > 0,
        "seasonRobustness": sum(row["units"] > 0 for row in seasons) >= 1 and all(
            row["roi"] is not None and row["roi"] >= -0.10 for row in seasons
        ),
        "calibration": summary["calibration"]["absoluteGap"] is not None
        and summary["calibration"]["absoluteGap"] <= 0.10 and all(
            row["calibration"]["absoluteGap"] is not None
            and row["calibration"]["absoluteGap"] <= 0.15 for row in seasons
        ),
        "bootstrapPositive": bootstrap["probabilityPositiveUnits"] is not None
        and bootstrap["probabilityPositiveUnits"] >= 0.60,
        "multiBook": len(summary["bookMix"]) >= 2,
    }


def watchlist_rows(rows: pd.DataFrame, rule: pragmatic.PragmaticRule, lean: pd.DataFrame) -> pd.DataFrame:
    candidate = r1.reduce_best_offer(rows[
        common_eligible(rows, rule)
        & rows["probability"].ge(rule.minimum_probability - 0.025)
        & rows["expectedValue"].ge(rule.minimum_ev - 0.02)
        & rows["edgePp"].ge(rule.minimum_edge_pp - 2.0)
    ].copy())
    lean_keys = set(zip(lean["season"], lean["gameId"], lean["market"], strict=True))
    return candidate[[
        (season, game_id, market) not in lean_keys
        for season, game_id, market in zip(candidate["season"], candidate["gameId"], candidate["market"], strict=True)
    ]].copy()


def best_angle_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    return {
        "minimumCounts": summary["actions"] >= 16 and all(row["actions"] >= 5 for row in seasons),
        "positiveEachSeason": all(row["units"] > 0 for row in seasons),
        "largestWinIndependentEachSeason": all(row["unitsWithoutLargestWin"] > 0 for row in seasons),
        "minimumRoi": summary["roi"] is not None and summary["roi"] >= 0.04,
        "calibration": all(row["calibration"]["absoluteGap"] is not None
                           and row["calibration"]["absoluteGap"] <= 0.10 for row in seasons),
        "bootstrapPositive": bootstrap["probabilityPositiveUnits"] is not None
        and bootstrap["probabilityPositiveUnits"] >= 0.75,
        "multiBook": len(summary["bookMix"]) >= 2,
    }


def run_market(all_rows: pd.DataFrame, market: str) -> dict[str, Any]:
    recipe, head_candidates, head_gate_passed = select_head(all_rows, market)
    model = fit_final_head(all_rows, market, recipe)
    rows = apply_head(all_rows[all_rows["season"].isin((POLICY_SELECTION_SEASON, *CONFIRMATION_SEASONS))], market, model)
    rule, policy_candidates = select_policy(rows, market)
    output: dict[str, Any] = {
        "selectedHead": asdict(recipe), "headGatePassed": head_gate_passed, "headCandidates": head_candidates,
        "selectionEligibleCount": sum(bool(row["eligible"]) for row in policy_candidates),
        "policyCandidates": [residual.compact(row) for row in policy_candidates],
        "selectedLeanRule": None if rule is None else asdict(rule),
        "leanSelection": None, "leanConfirmation": None, "leanConfirmationBootstrap": None,
        "leanConfirmationGates": {}, "leanAuthorized": False,
        "watchlistSelection": None, "watchlistConfirmation": None, "watchlistAuthorized": False,
        "bestAngleConfirmation": None, "bestAngleConfirmationBootstrap": None,
        "bestAngleConfirmationGates": {}, "bestAngleAuthorized": False,
    }
    if rule is None:
        return output
    lean = select_policy_rows(rows, rule)
    confirmation = pragmatic.summarize(lean, CONFIRMATION_SEASONS, rows)
    bootstrap = r1.weekly_bootstrap(lean[lean["season"].isin(CONFIRMATION_SEASONS)])
    gates = confirmation_gates(confirmation, bootstrap)
    watch = watchlist_rows(rows, rule, lean)
    ba = lean[
        lean["probability"].ge(max(rule.minimum_probability, 0.625))
        & lean["expectedValue"].ge(max(rule.minimum_ev, 0.04))
        & lean["edgePp"].ge(max(rule.minimum_edge_pp, 3.0))
    ].copy()
    ba_confirmation = pragmatic.summarize(ba, CONFIRMATION_SEASONS, rows)
    ba_bootstrap = r1.weekly_bootstrap(ba[ba["season"].isin(CONFIRMATION_SEASONS)])
    ba_gates = best_angle_gates(ba_confirmation, ba_bootstrap)
    output.update({
        "leanSelection": pragmatic.summarize(lean, (POLICY_SELECTION_SEASON,), rows),
        "leanConfirmation": confirmation, "leanConfirmationBootstrap": bootstrap,
        "leanConfirmationGates": gates, "leanAuthorized": bool(head_gate_passed and all(gates.values())),
        "watchlistSelection": pragmatic.summarize(watch, (POLICY_SELECTION_SEASON,), rows),
        "watchlistConfirmation": pragmatic.summarize(watch, CONFIRMATION_SEASONS, rows),
        "watchlistAuthorized": bool(len(watch[watch["season"].eq(POLICY_SELECTION_SEASON)]) > 0),
        "bestAngleConfirmation": ba_confirmation, "bestAngleConfirmationBootstrap": ba_bootstrap,
        "bestAngleConfirmationGates": ba_gates,
        "bestAngleAuthorized": bool(head_gate_passed and all(gates.values()) and all(ba_gates.values())),
    })
    return output


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get(
        "NFL_RESEARCH_SOURCE_ROOT", "/private/tmp/oddsphere-nfl-daily-edge-launch-r1"
    )).resolve()
    cache_path = root / "football-research/cache/nfl-model/nfl_spread_total_offer_rows_2021_2025.joblib"
    if cache_path.exists():
        cached = joblib.load(cache_path)
        raw, evidence = cached["rows"], cached["evidence"]
    else:
        raw, evidence = r1.build_offer_rows(source_root, (2021, 2022, 2023, 2024, 2025))
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"rows": raw, "evidence": evidence}, cache_path)
    rows = add_features(raw)
    reports = {market: run_market(rows, market) for market in ("spread", "total")}
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-spread-total-market-informed-classifier-predeclaration.md",
        "chronology": {"fit": [2021], "headSelection": [2022], "policySelection": [2023], "confirmation": [2024, 2025]},
        "shadowOnly": True, "productionBehaviorChanged": False,
        "sourceEvidence": evidence, "marketReports": reports,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
    }
    path = root / "football-research/reports" / f"{TOURNAMENT_RELEASE}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(residual.json_safe(report), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "markets": {market: {
            "selectedHead": values["selectedHead"],
            "headGatePassed": values["headGatePassed"],
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
        } for market, values in reports.items()},
        "report": str(path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
