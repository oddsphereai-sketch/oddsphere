#!/usr/bin/env python3
"""Frozen NFL actionable grade completion tournament.

This operator is read-only with respect to production. It joins immutable
historical offers to pregame football features, evaluates the predeclared
moneyline top tier and Spread/Total exact-price lanes, and writes one ignored
local audit report.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import time
from dataclasses import asdict, dataclass
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, GradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import tournament_nfl_grading_tiers_r3 as moneyline_tiers
import tournament_nfl_spread_total_grading_r1 as r1
import tournament_nfl_spread_total_pragmatic_v2 as pragmatic
import tournament_nfl_spread_total_residual_blend_r3 as residual


TOURNAMENT_RELEASE = "nfl_actionable_grades_tournament_2026_08_25_r8"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
PROBABILITY_FLOORS = (0.515, 0.525, 0.535, 0.55, 0.575)
EV_FLOORS = (0.00, 0.01, 0.02, 0.03)
EDGE_FLOORS_PP = (0.0, 1.0, 2.0, 3.0)
CUSHION_FLOORS = (0.0, 0.5, 1.0)
RANDOM_STATE = 25082026
ROLLING_FAST_ALPHA = 0.35
ROLLING_SLOW_ALPHA = 0.15
ROLLING_OFFSEASON_CARRY = 0.50


@dataclass(frozen=True)
class GradeRule:
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


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def logit(values: pd.Series | np.ndarray) -> np.ndarray:
    probability = np.clip(np.asarray(values, dtype=float), 0.01, 0.99)
    return np.log(probability / (1.0 - probability))


def inv_logit(values: pd.Series | np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.asarray(values, dtype=float)))


def binary_metrics(outcome: np.ndarray, probability: np.ndarray) -> dict[str, Any]:
    y = np.asarray(outcome, dtype=int)
    p = np.clip(np.asarray(probability, dtype=float), 0.01, 0.99)
    buckets = np.minimum(9, np.floor(p * 10).astype(int))
    ece = sum(
        int(np.sum(buckets == bucket))
        * abs(float(np.mean(p[buckets == bucket])) - float(np.mean(y[buckets == bucket])))
        for bucket in np.unique(buckets)
    ) / len(y)
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
        "ece": float(ece),
        "accuracy": float(np.mean((p >= 0.5) == y)),
        "probabilitySd": float(np.std(p, ddof=1)),
        "probabilityRange": [float(np.min(p)), float(np.max(p))],
    }


def fit_beta_calibrator(raw: np.ndarray, outcome: np.ndarray) -> LogisticRegression:
    p = np.clip(np.asarray(raw, dtype=float), 0.01, 0.99)
    model = LogisticRegression(C=0.5, max_iter=4_000, random_state=RANDOM_STATE)
    return model.fit(np.column_stack([np.log(p), np.log1p(-p)]), np.asarray(outcome, dtype=int))


def apply_beta_calibrator(model: LogisticRegression, raw: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(raw, dtype=float), 0.01, 0.99)
    x = np.column_stack([np.log(p), np.log1p(-p)])
    return np.clip(model.predict_proba(x)[:, 1], 0.01, 0.99)


def load_inputs(root: pathlib.Path) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, pd.DataFrame], dict[str, Any]]:
    offer_path = root / "football-research/cache/nfl-model/nfl_spread_total_offer_rows_2021_2025.joblib"
    offer_payload = joblib.load(offer_path)
    feature_path = root / "football-research/reports/nfl-v1-comprehensive/nfl_v1_comprehensive_features_2016_2025_r1.parquet"
    capture_path = pathlib.Path(os.environ.get(
        "NFL_THRESHOLD_CAPTURE_PATH", "/private/tmp/nfl_actionable_threshold_capture_r6.joblib"
    )).resolve()
    features = pd.read_parquet(feature_path)
    offers = offer_payload["rows"].copy()
    captured = joblib.load(capture_path)
    return features, offers, captured, {
        "featureSha256": sha256_file(feature_path),
        "offerSha256": sha256_file(offer_path.resolve()),
        "thresholdCaptureSha256": sha256_file(capture_path),
        "offerEvidence": offer_payload["evidence"],
    }


def transport_probability(raw_target: np.ndarray, raw_reference: np.ndarray,
                          corrected_reference: np.ndarray, first: np.ndarray) -> np.ndarray:
    correction = logit(corrected_reference) - logit(raw_reference)
    signed = np.where(np.asarray(first, dtype=bool), correction, -correction)
    return np.clip(inv_logit(logit(raw_target) + signed), 0.01, 0.99)


def apply_spread_head(offers: pd.DataFrame, captured: dict[str, pd.DataFrame]) -> pd.DataFrame:
    reference = captured["spread_historical"].rename(columns={
        "game_id": "featureGameId", "head_probability": "correctedHomeProbability",
        "raw_home_cover_probability": "rawHomeProbability",
    })[["featureGameId", "rawHomeProbability", "correctedHomeProbability"]]
    rows = offers[offers["market"].eq("spread")].merge(reference, on="featureGameId", validate="many_to_one")
    rows["r10Probability"] = rows["probability"]
    rows["probability"] = transport_probability(
        rows["r10Probability"].to_numpy(float), rows["rawHomeProbability"].to_numpy(float),
        rows["correctedHomeProbability"].to_numpy(float), rows["first"].to_numpy(bool),
    )
    return recompute_offer_math(rows)


def game_market_frame(features: pd.DataFrame, offers: pd.DataFrame) -> pd.DataFrame:
    spread = offers[offers["market"].eq("spread")].copy()
    spread["homeSpread"] = np.where(spread["first"], spread["line"], -spread["line"])
    spread_lines = spread.groupby("featureGameId", as_index=False)["homeSpread"].median()
    total_lines = (
        offers[offers["market"].eq("total")]
        .groupby("featureGameId", as_index=False)["line"].median()
        .rename(columns={"line": "openingTotal"})
    )
    frame = features[features["season"].between(2021, 2025)].copy()
    frame = frame.merge(spread_lines, left_on="game_id", right_on="featureGameId", validate="one_to_one")
    frame = frame.merge(total_lines, on="featureGameId", validate="one_to_one")
    frame["openingHomeMargin"] = -frame["homeSpread"]
    frame["impliedHomePoints"] = (frame["openingTotal"] + frame["openingHomeMargin"]) / 2.0
    frame["impliedAwayPoints"] = (frame["openingTotal"] - frame["openingHomeMargin"]) / 2.0
    frame["homeScoreResidual"] = frame["home_score"] - frame["impliedHomePoints"]
    frame["awayScoreResidual"] = frame["away_score"] - frame["impliedAwayPoints"]
    return attach_score_residual_memory(frame)


def attach_score_residual_memory(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    columns = (
        "homeScoreResidualFast", "awayScoreResidualFast", "homeScoreResidualSlow",
        "awayScoreResidualSlow", "scoreResidualGames",
    )
    for column in columns:
        result[column] = 0.0
    states: dict[str, dict[str, float]] = {}
    previous_season: int | None = None
    ordered = result.sort_values(["season", "week", "game_id"])
    for (season_value, _week), games in ordered.groupby(["season", "week"], sort=True, observed=True):
        season = int(season_value)
        if previous_season is not None and season != previous_season:
            for state in states.values():
                state["fast"] *= ROLLING_OFFSEASON_CARRY
                state["slow"] *= ROLLING_OFFSEASON_CARRY
                state["games"] *= ROLLING_OFFSEASON_CARRY
        for index, row in games.iterrows():
            home = states.setdefault(str(row["home_team"]), {"fast": 0.0, "slow": 0.0, "games": 0.0})
            away = states.setdefault(str(row["away_team"]), {"fast": 0.0, "slow": 0.0, "games": 0.0})
            result.at[index, "homeScoreResidualFast"] = home["fast"]
            result.at[index, "awayScoreResidualFast"] = away["fast"]
            result.at[index, "homeScoreResidualSlow"] = home["slow"]
            result.at[index, "awayScoreResidualSlow"] = away["slow"]
            result.at[index, "scoreResidualGames"] = math.log1p(min(home["games"], away["games"]))
        for _, row in games.iterrows():
            for team, value in ((str(row["home_team"]), float(row["homeScoreResidual"])),
                                (str(row["away_team"]), float(row["awayScoreResidual"]))):
                state = states.setdefault(team, {"fast": 0.0, "slow": 0.0, "games": 0.0})
                state["fast"] = ROLLING_FAST_ALPHA * value + (1 - ROLLING_FAST_ALPHA) * state["fast"]
                state["slow"] = ROLLING_SLOW_ALPHA * value + (1 - ROLLING_SLOW_ALPHA) * state["slow"]
                state["games"] += 1.0
        previous_season = season
    result.attrs["scoreResidualStates"] = {
        team: dict(values) for team, values in states.items()
    }
    return result


def total_feature_columns(frame: pd.DataFrame) -> list[str]:
    explicit = [
        "neutral_site", "division_game", "home_rest", "away_rest", "rest_diff", "surface_grass",
        "away_travel_miles", "away_travel_timezones", "away_travel_direction", "home_elo", "away_elo",
        "elo_diff", "impliedHomePoints", "impliedAwayPoints", "openingTotal", "openingHomeMargin",
        "homeScoreResidualFast", "awayScoreResidualFast", "homeScoreResidualSlow",
        "awayScoreResidualSlow", "scoreResidualGames",
    ]
    suffixes = (
        "_epa", "_pass_epa", "_rush_epa", "_success", "_early_down_pass_epa",
        "_explosive_rate", "_sack_rate", "_turnover_rate", "_plays", "_redzone_td_rate",
        "_pass_oe", "_points", "_early_down_success", "_qb_hit_rate", "_first_down_rate",
        "_third_down_rate", "_penalty_yards_per_play", "_special_teams_epa_per_play",
    )
    generated = [
        column for column in frame.columns
        if (
            (column.startswith(("home_matchup_fast_", "away_matchup_fast_", "home_matchup_slow_", "away_matchup_slow_"))
             and column.endswith(suffixes))
            or column.startswith(("home_qb_room_", "away_qb_room_"))
            or column.endswith(("roster_continuity_lagged", "roster_experience_lagged", "snap_continuity_lagged", "coach_continuity"))
        )
    ]
    return [column for column in [*explicit, *generated] if column in frame.columns]


def total_model(name: str) -> Any:
    if name == "ridge":
        return Pipeline([
            ("impute", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()), ("model", Ridge(alpha=300.0)),
        ])
    if name == "extra_trees":
        return Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("model", ExtraTreesRegressor(
                n_estimators=300, min_samples_leaf=18, max_features=0.35,
                n_jobs=-1, random_state=RANDOM_STATE,
            )),
        ])
    if name == "huber_gb":
        return Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("model", GradientBoostingRegressor(
                loss="huber", learning_rate=0.03, n_estimators=120, max_depth=1,
                min_samples_leaf=40, max_features=0.40, random_state=RANDOM_STATE,
            )),
        ])
    raise ValueError(name)


def component_predictions(frame: pd.DataFrame, name: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    columns = total_feature_columns(frame)
    train = frame[frame["season"].isin((2021, 2022))]
    error_fit = frame[frame["season"].eq(2021)]
    error_test = frame[frame["season"].eq(2022)]

    def predict(model_name: str, target: str) -> tuple[np.ndarray, np.ndarray]:
        early_model = total_model(model_name).fit(error_fit[columns], error_fit[target])
        errors = error_test[target].to_numpy(float) - early_model.predict(error_test[columns])
        final_model = total_model(model_name).fit(train[columns], train[target])
        return np.asarray(final_model.predict(frame[columns]), dtype=float), errors

    if name == "ensemble":
        home_ridge, home_ridge_error = predict("ridge", "homeScoreResidual")
        away_ridge, away_ridge_error = predict("ridge", "awayScoreResidual")
        home_tree, home_tree_error = predict("extra_trees", "homeScoreResidual")
        away_tree, away_tree_error = predict("extra_trees", "awayScoreResidual")
        home = 0.5 * (home_ridge + home_tree)
        away = 0.5 * (away_ridge + away_tree)
        errors = 0.5 * (home_ridge_error + home_tree_error) + 0.5 * (away_ridge_error + away_tree_error)
        return home, away, np.sort(errors)
    home, home_errors = predict(name, "homeScoreResidual")
    away, away_errors = predict(name, "awayScoreResidual")
    return home, away, np.sort(home_errors + away_errors)


def expanding_component_probability(frame: pd.DataFrame, name: str, season: int) -> np.ndarray:
    columns = total_feature_columns(frame)
    target = frame[frame["season"].eq(season)]
    prior_season = season - 1
    error_fit = frame[frame["season"].between(2021, prior_season - 1)]
    error_test = frame[frame["season"].eq(prior_season)]
    training = frame[frame["season"].between(2021, season - 1)]

    def predict(model_name: str, target_column: str) -> tuple[np.ndarray, np.ndarray]:
        error_model = total_model(model_name).fit(error_fit[columns], error_fit[target_column])
        errors = error_test[target_column].to_numpy(float) - error_model.predict(error_test[columns])
        final_model = total_model(model_name).fit(training[columns], training[target_column])
        return np.asarray(final_model.predict(target[columns]), dtype=float), errors

    if name == "ensemble":
        home_ridge, home_ridge_error = predict("ridge", "homeScoreResidual")
        away_ridge, away_ridge_error = predict("ridge", "awayScoreResidual")
        home_tree, home_tree_error = predict("extra_trees", "homeScoreResidual")
        away_tree, away_tree_error = predict("extra_trees", "awayScoreResidual")
        predicted = 0.5 * (home_ridge + home_tree) + 0.5 * (away_ridge + away_tree)
        errors = 0.5 * (home_ridge_error + home_tree_error) + 0.5 * (away_ridge_error + away_tree_error)
    else:
        home, home_errors = predict(name, "homeScoreResidual")
        away, away_errors = predict(name, "awayScoreResidual")
        predicted = home + away
        errors = home_errors + away_errors
    return empirical_over_probability(predicted, np.sort(errors))


def empirical_over_probability(predicted_residual: np.ndarray, sorted_errors: np.ndarray) -> np.ndarray:
    return np.clip(
        1.0 - np.searchsorted(sorted_errors, -np.asarray(predicted_residual), side="right") / len(sorted_errors),
        0.01, 0.99,
    )


def fit_total_head(frame: pd.DataFrame) -> tuple[str, pd.DataFrame, list[dict[str, Any]], dict[str, Any]]:
    candidates: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    ranking = []
    selection = frame["season"].eq(SELECTION_SEASON)
    outcome = (frame.loc[selection, "actual_total"] > frame.loc[selection, "openingTotal"]).astype(int).to_numpy()
    neutral = binary_metrics(outcome, np.full(len(outcome), 0.5))
    for name in ("ridge", "huber_gb", "extra_trees", "ensemble"):
        home, away, errors = component_predictions(frame, name)
        raw = empirical_over_probability(home + away, errors)
        metrics = binary_metrics(outcome, raw[selection.to_numpy()])
        eligible = bool(
            metrics["brier"] < neutral["brier"] and metrics["logLoss"] < neutral["logLoss"]
            and metrics["ece"] <= 0.10 and metrics["probabilitySd"] >= 0.015
        )
        ranking.append({"name": name, "selection": metrics, "neutral": neutral, "eligible": eligible})
        candidates[name] = (raw, errors)
    eligible = [row for row in ranking if row["eligible"]]
    pool = eligible if eligible else ranking
    pool.sort(key=lambda row: (row["selection"]["brier"], row["selection"]["logLoss"], row["name"]))
    selected_name = pool[0]["name"]
    parts = []
    year_metrics: dict[str, Any] = {}
    for season in (2023, 2024, 2025):
        sample = frame[frame["season"].eq(season)][["game_id", "season", "week", "openingTotal", "actual_total"]].copy()
        raw = expanding_component_probability(frame, selected_name, season)
        sample["rawOverProbability"] = raw
        sample["correctedOverProbability"] = raw
        y = sample["actual_total"].gt(sample["openingTotal"]).astype(int).to_numpy()
        year_metrics[str(season)] = {
            "candidate": binary_metrics(y, raw),
            "neutral": binary_metrics(y, np.full(len(y), 0.5)),
        }
        parts.append(sample.drop(columns=["actual_total"]))
    return selected_name, pd.concat(parts, ignore_index=True), ranking, year_metrics


def apply_total_head(offers: pd.DataFrame, total_head: pd.DataFrame,
                     captured: dict[str, pd.DataFrame]) -> pd.DataFrame:
    reference = total_head.rename(columns={"game_id": "featureGameId"})
    r10_reference = captured["total_historical"].rename(columns={
        "game_id": "featureGameId", "raw_over_probability": "rawR10OverProbability",
    })[["featureGameId", "rawR10OverProbability"]]
    rows = offers[offers["market"].eq("total")].merge(
        reference[["featureGameId", "rawOverProbability", "correctedOverProbability"]],
        on="featureGameId", validate="many_to_one",
    ).merge(r10_reference, on="featureGameId", validate="many_to_one")
    rows["r10Probability"] = rows["probability"]
    raw_reference = np.where(rows["first"], rows["rawR10OverProbability"], 1 - rows["rawR10OverProbability"])
    corrected_reference = np.where(
        rows["first"], rows["correctedOverProbability"], 1 - rows["correctedOverProbability"]
    )
    rows["probability"] = transport_probability(
        rows["r10Probability"].to_numpy(float), raw_reference, corrected_reference,
        np.ones(len(rows), dtype=bool),
    )
    return recompute_offer_math(rows)


def recompute_offer_math(rows: pd.DataFrame) -> pd.DataFrame:
    output = rows.copy()
    resolved = 1.0 - output["pushProbability"]
    output["expectedValue"] = resolved * (
        output["probability"] * output["price"].map(r1.multibook.profit_one)
        - (1.0 - output["probability"])
    )
    output["edgePp"] = 100.0 * (output["probability"] - output["looFairProbability"])
    output["directionCoherent"] = output["probability"].ge(0.5)
    return output


def select_rows(rows: pd.DataFrame, rule: GradeRule) -> pd.DataFrame:
    eligible = (
        rows["market"].eq(rule.market) & rows["baseHealth"] & rows["directionCoherent"]
        & rows["looOtherBookCount"].ge(2) & rows["price"].between(-200, 200, inclusive="both")
        & rows["probability"].ge(rule.minimum_probability)
        & rows["expectedValue"].ge(rule.minimum_ev) & rows["edgePp"].ge(rule.minimum_edge_pp)
        & rows["cushion"].ge(rule.minimum_cushion + rows["cushionPenalty"])
    )
    return r1.reduce_best_offer(rows[eligible].copy())


def selection_passes(summary: dict[str, Any]) -> bool:
    gap = summary["calibration"]["absoluteGap"]
    return bool(
        summary["actions"] >= 12 and summary["weeksWithGrade"] >= 6
        and summary["units"] > 0 and summary["unitsWithoutLargestWin"] > 0
        and summary["meanClv"] is not None and summary["meanClv"] >= 0
        and gap is not None and gap <= 0.10 and len(summary["bookMix"]) >= 2
    )


def select_rule(rows: pd.DataFrame, market: str) -> tuple[GradeRule | None, list[dict[str, Any]]]:
    candidates = []
    universe = rows[rows["market"].eq(market)]
    for probability in PROBABILITY_FLOORS:
        for ev in EV_FLOORS:
            for edge in EDGE_FLOORS_PP:
                for cushion in CUSHION_FLOORS:
                    rule = GradeRule(market, probability, ev, edge, cushion)
                    summary = pragmatic.summarize(select_rows(rows, rule), (SELECTION_SEASON,), universe)
                    candidates.append({"rule": asdict(rule), "ruleName": rule.name,
                                       "selection": residual.compact(summary), "eligible": selection_passes(summary)})
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["selection"]["unitsWithoutLargestWin"], -row["selection"]["meanClv"],
        row["selection"]["calibration"]["absoluteGap"], -row["selection"]["actions"], row["ruleName"],
    ))
    return (None, candidates) if not eligible else (GradeRule(**eligible[0]["rule"]), candidates)


def confirmation_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    pooled_calibration = summary["calibration"]
    return {
        "minimumCounts": summary["actions"] >= 24 and all(row["actions"] >= 8 for row in seasons),
        "positivePooledUnits": summary["units"] > 0,
        "positiveEachSeason": all(row["units"] > 0 for row in seasons),
        "largestWinIndependent": summary["unitsWithoutLargestWin"] > 0,
        "seasonRobustness": any(row["units"] > 0 for row in seasons) and all(
            row["roi"] is not None and row["roi"] >= -0.05 for row in seasons
        ),
        "calibrationOverconfidence": pooled_calibration["meanProbability"] is not None
        and pooled_calibration["winRate"] is not None
        and pooled_calibration["meanProbability"] - pooled_calibration["winRate"] <= 0.10
        and all(
            row["calibration"]["meanProbability"] is not None
            and row["calibration"]["winRate"] is not None
            and row["calibration"]["meanProbability"] - row["calibration"]["winRate"] <= 0.15
            for row in seasons
        ),
        "nonnegativeMeanClv": summary["meanClv"] is not None and summary["meanClv"] >= 0,
        "bootstrapReported": bootstrap["probabilityPositiveUnits"] is not None
        and bootstrap["roiCi95"] is not None,
        "multiBook": len(summary["bookMix"]) >= 2,
    }


def evaluate_market(rows: pd.DataFrame, market: str) -> dict[str, Any]:
    rule, ranking = select_rule(rows, market)
    output: dict[str, Any] = {
        "selectionEligibleCount": sum(bool(row["eligible"]) for row in ranking),
        "selectedRule": None if rule is None else asdict(rule),
        "selection": None, "confirmation": None, "bootstrap": None,
        "confirmationGates": {}, "leanAuthorized": False,
    }
    if rule is None:
        return output
    selected = select_rows(rows, rule)
    universe = rows[rows["market"].eq(market)]
    selection = pragmatic.summarize(selected, (SELECTION_SEASON,), universe)
    confirmation = pragmatic.summarize(selected, CONFIRMATION_SEASONS, universe)
    bootstrap = r1.weekly_bootstrap(selected[selected["season"].isin(CONFIRMATION_SEASONS)])
    gates = confirmation_gates(confirmation, bootstrap)
    output.update({
        "selection": residual.compact(selection), "confirmation": residual.compact(confirmation),
        "bootstrap": bootstrap, "confirmationGates": gates, "leanAuthorized": all(gates.values()),
    })
    return output


def evaluate_fixed_market(rows: pd.DataFrame, rule: GradeRule) -> dict[str, Any]:
    selected = select_rows(rows, rule)
    universe = rows[rows["market"].eq(rule.market)]
    selection = pragmatic.summarize(selected, (SELECTION_SEASON,), universe)
    confirmation = pragmatic.summarize(selected, CONFIRMATION_SEASONS, universe)
    bootstrap = r1.weekly_bootstrap(selected[selected["season"].isin(CONFIRMATION_SEASONS)])
    gates = confirmation_gates(confirmation, bootstrap)
    return {
        "selectedRule": asdict(rule),
        "selection": residual.compact(selection),
        "confirmation": residual.compact(confirmation),
        "bootstrap": bootstrap,
        "confirmationGates": gates,
        "leanAuthorized": all(gates.values()),
    }


def evaluate_moneyline(root: pathlib.Path) -> dict[str, Any]:
    # The preserved r1 provider exports are no longer present locally. The r2
    # exports are the append-only supersets and reproduce the frozen r6 metrics;
    # stamp their checksums in this new audit rather than silently substituting.
    moneyline_tiers.r2.OPENING_RELEASES[2021] = "bdl_nfl_opening_history_2021_2026_08_20_r2"
    moneyline_tiers.r2.OPENING_RELEASES[2025] = "bdl_nfl_opening_history_2025_2026_08_20_r2"
    rows, evidence = moneyline_tiers.build_historical_rows(root)
    rule = moneyline_tiers.BestAngleRule(0.02, 4.0)
    candidate = rows[
        rows["baselineLean"] & rows["expectedValue"].ge(rule.minimum_ev)
        & rows["edgePp"].ge(rule.minimum_edge_pp)
    ].copy()
    selection = moneyline_tiers.summarize(candidate, (SELECTION_SEASON,), rows)
    confirmation = moneyline_tiers.summarize(candidate, CONFIRMATION_SEASONS, rows)
    bootstrap = moneyline_tiers.weekly_cluster_bootstrap(
        candidate[candidate["season"].isin(CONFIRMATION_SEASONS)]
    )
    seasons = list(confirmation["bySeason"].values())
    calibration = []
    for season in CONFIRMATION_SEASONS:
        sample = candidate[candidate["season"].eq(season)]
        calibration.append(abs(float(sample["probability"].mean()) - float(sample["won"].mean())))
    gates = {
        "minimumCounts": confirmation["actions"] >= 24 and all(row["actions"] >= 8 for row in seasons),
        "positiveEachSeason": all(row["units"] > 0 for row in seasons),
        "largestWinIndependentEachSeason": all(row["unitsWithoutLargestWin"] > 0 for row in seasons),
        "pooledRoi": confirmation["roi"] is not None and confirmation["roi"] > 0.02,
        "clv": confirmation["meanClv"] is not None and confirmation["meanClv"] >= 0
        and confirmation["positiveClvRate"] is not None and confirmation["positiveClvRate"] >= 0.40,
        "calibration": all(gap <= 0.10 for gap in calibration),
        "bootstrapPositive": bootstrap["probabilityPositiveUnits"] is not None
        and bootstrap["probabilityPositiveUnits"] >= 0.80,
    }
    return {
        "rule": asdict(rule), "selection": residual.compact(selection),
        "confirmation": residual.compact(confirmation), "confirmationCalibrationGaps": calibration,
        "bootstrap": bootstrap, "gates": gates, "bestAngleAuthorized": all(gates.values()),
        "sourceEvidence": evidence,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    features, offers, captured, evidence = load_inputs(root)
    spread_rows = apply_spread_head(offers, captured)
    total_frame = game_market_frame(features, offers)
    total_head_name, total_head, total_head_ranking, total_head_metrics = fit_total_head(total_frame)
    total_rows = apply_total_head(offers, total_head, captured)
    spread_rule = GradeRule("spread", 0.51, 0.0, 0.0, 0.0)
    total_rule = GradeRule("total", 0.535, 0.02, 1.0, 1.0)
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-25-nfl-actionable-grades-r8-predeclaration.md",
        "chronology": {"fit": [2021, 2022], "selection": [2023], "confirmation": list(CONFIRMATION_SEASONS)},
        "shadowOnly": True, "productionChanged": False, "writerChanged": False,
        "trackingChanged": False, "stakesChanged": False,
        "sourceEvidence": evidence,
        "moneyline": evaluate_moneyline(root),
        "spread": evaluate_fixed_market(spread_rows, spread_rule),
        "total": {
            "selectedHead": total_head_name, "headSelectionRanking": total_head_ranking,
            "expandingYearByYear": total_head_metrics,
            **evaluate_fixed_market(total_rows, total_rule),
        },
    }
    report["qualified"] = bool(
        report["moneyline"]["bestAngleAuthorized"]
        and report["spread"]["leanAuthorized"] and report["total"]["leanAuthorized"]
    )
    path = root / "football-research/reports" / f"{TOURNAMENT_RELEASE}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(residual.json_safe(report), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(residual.compact({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "moneyline": {key: report["moneyline"][key] for key in ("confirmation", "bootstrap", "gates", "bestAngleAuthorized")},
        "spread": report["spread"], "total": report["total"], "qualified": report["qualified"],
        "report": str(path),
    }), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
