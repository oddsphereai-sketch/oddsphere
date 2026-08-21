#!/usr/bin/env python3
"""Chronological, price-aware NFL sharp-brain candidate tournament.

This script is local research only. It never writes predictions, grades,
stakes, tracking rows, or production state. It asks a narrower question than
the score model: can a calibrated market-plus-football decision layer produce
at least one positive-EV action in every regular-season week and retain value
in the next season?

Historical odds in the nflverse feature artifact are terminal prices, not
OddSphere lock snapshots. Results are therefore a research diagnostic, never
an official betting record or launch proof.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


TOURNAMENT_RELEASE = "nfl_sharp_brain_candidate_tournament_2026_08_20_r3"
CANDIDATE_DECISION_RELEASE = "nfl_sharp_brain_distribution_stack_shadow_2026_08_20_r3"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
TRAIN_START = 2018
MODEL_SELECTION_SEASON = 2023
CALIBRATION_SEASON = 2024
CALIBRATION_MAX_WEEK = 9
POLICY_SELECTION_MIN_WEEK = 10
HISTORICAL_REPLAY_SEASON = 2025
RANDOM_STATE = 20082026
MARKETS = ("moneyline", "spread", "total")


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def american_implied(values: pd.Series | np.ndarray) -> np.ndarray:
    price = np.asarray(values, dtype=float)
    result = np.full(price.shape, np.nan, dtype=float)
    positive = price > 0
    negative = price < 0
    result[positive] = 100.0 / (price[positive] + 100.0)
    result[negative] = -price[negative] / (-price[negative] + 100.0)
    return result


def no_vig(first: pd.Series, second: pd.Series) -> np.ndarray:
    first_implied = american_implied(first)
    second_implied = american_implied(second)
    return first_implied / (first_implied + second_implied)


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def market_arrays(frame: pd.DataFrame, market: str) -> dict[str, np.ndarray]:
    if market == "moneyline":
        first_price = frame["home_moneyline"].to_numpy(float)
        second_price = frame["away_moneyline"].to_numpy(float)
        outcome = frame["actual_margin"].gt(0).to_numpy(bool)
        push = frame["actual_margin"].eq(0).to_numpy(bool)
        line = np.zeros(len(frame), dtype=float)
        first_side, second_side = "home", "away"
    elif market == "spread":
        first_price = frame["home_spread_odds"].to_numpy(float)
        second_price = frame["away_spread_odds"].to_numpy(float)
        market_line = frame["market_home_margin"].to_numpy(float)
        outcome = frame["actual_margin"].to_numpy(float) > market_line
        push = frame["actual_margin"].to_numpy(float) == market_line
        line = market_line
        first_side, second_side = "home", "away"
    elif market == "total":
        first_price = frame["over_odds"].to_numpy(float)
        second_price = frame["under_odds"].to_numpy(float)
        market_line = frame["market_total"].to_numpy(float)
        outcome = frame["actual_total"].to_numpy(float) > market_line
        push = frame["actual_total"].to_numpy(float) == market_line
        line = market_line
        first_side, second_side = "over", "under"
    else:
        raise ValueError(f"unsupported market {market}")
    first_implied = american_implied(first_price)
    second_implied = american_implied(second_price)
    fair = first_implied / (first_implied + second_implied)
    return {
        "firstPrice": first_price,
        "secondPrice": second_price,
        "fair": fair,
        "outcome": outcome,
        "push": push,
        "line": line,
        "firstSide": np.full(len(frame), first_side, dtype=object),
        "secondSide": np.full(len(frame), second_side, dtype=object),
    }


def football_feature_columns(frame: pd.DataFrame) -> list[str]:
    direct = {
        "week", "neutral_site", "division_game", "home_rest", "away_rest", "rest_diff",
        "temperature", "wind", "roof_indoor", "surface_grass", "home_elo", "away_elo", "elo_diff",
        "home_games_state", "away_games_state", "home_injury_weight", "away_injury_weight",
        "home_qb_injury_weight", "away_qb_injury_weight", "home_out_count", "away_out_count",
        "home_roster_continuity", "away_roster_continuity", "home_qb_epa", "away_qb_epa",
        "home_qb_cpoe", "away_qb_cpoe", "home_qb_sack_rate", "away_qb_sack_rate",
        "home_qb_turnover_rate", "away_qb_turnover_rate", "home_qb_log_dropbacks", "away_qb_log_dropbacks",
        "home_qb_same_as_last_start", "away_qb_same_as_last_start", "home_coach_continuity", "away_coach_continuity",
    }
    suffixes = (
        "epa", "pass_epa", "rush_epa", "success", "early_down_pass_epa", "explosive_rate",
        "sack_rate", "turnover_rate", "plays", "redzone_td_rate", "pass_oe", "points",
    )
    prefixes = (
        "home_matchup_fast_", "away_matchup_fast_", "home_matchup_slow_", "away_matchup_slow_",
        "home_off_adj_", "away_off_adj_", "home_def_adj_", "away_def_adj_",
    )
    columns = [
        column for column in frame.columns
        if column in direct or (column.startswith(prefixes) and column.endswith(suffixes))
    ]
    non_numeric = [column for column in columns if not pd.api.types.is_numeric_dtype(frame[column])]
    if non_numeric:
        raise RuntimeError(f"non-numeric candidate features: {non_numeric}")
    return sorted(columns)


def design_matrix(frame: pd.DataFrame, columns: list[str], market: str) -> pd.DataFrame:
    matrix = frame[columns].copy()
    arrays = market_arrays(frame, market)
    matrix["market_fair_probability"] = arrays["fair"]
    matrix["market_line"] = arrays["line"]
    return matrix


def probability_metrics(probability: np.ndarray, outcome: np.ndarray, push: np.ndarray) -> dict[str, Any]:
    keep = ~np.asarray(push, dtype=bool)
    p = np.clip(np.asarray(probability, dtype=float)[keep], 0.001, 0.999)
    y = np.asarray(outcome, dtype=int)[keep]
    bins = np.minimum(9, np.floor(p * 10).astype(int))
    ece = 0.0
    for index in range(10):
        mask = bins == index
        if mask.any():
            ece += float(mask.mean()) * abs(float(p[mask].mean()) - float(y[mask].mean()))
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
        "ece10": ece,
        "meanProbability": float(p.mean()),
        "outcomeRate": float(y.mean()),
    }


def classifier(c_value: float) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", LogisticRegression(C=c_value, max_iter=5000, random_state=RANDOM_STATE)),
    ])


def fit_market_candidate(frame: pd.DataFrame, feature_columns: list[str], market: str) -> dict[str, Any]:
    arrays = market_arrays(frame, market)
    eligible = np.isfinite(arrays["firstPrice"]) & np.isfinite(arrays["secondPrice"]) & ~arrays["push"]
    development = (frame["season"] >= TRAIN_START) & (frame["season"] < MODEL_SELECTION_SEASON) & eligible
    model_selection = (frame["season"] == MODEL_SELECTION_SEASON) & eligible
    if int(development.sum()) < 500 or int(model_selection.sum()) < 200:
        raise RuntimeError(f"insufficient {market} chronology for model selection")
    x_all = design_matrix(frame, feature_columns, market)
    y_all = arrays["outcome"].astype(int)
    c_ranking: list[dict[str, Any]] = []
    for c_value in [0.01, 0.03, 0.1, 0.3, 1.0]:
        model = classifier(c_value)
        model.fit(x_all.loc[development], y_all[development])
        probability = model.predict_proba(x_all.loc[model_selection])[:, 1]
        market_probability = arrays["fair"][model_selection]
        outcome = y_all[model_selection]
        c_ranking.append({
            "c": c_value,
            "raw": probability_metrics(probability, outcome, np.zeros(len(outcome), dtype=bool)),
            "market": probability_metrics(market_probability, outcome, np.zeros(len(outcome), dtype=bool)),
        })
    c_ranking.sort(key=lambda row: (row["raw"]["brier"], row["raw"]["logLoss"], row["c"]))
    selected_c = float(c_ranking[0]["c"])
    final_training = (frame["season"] >= TRAIN_START) & (frame["season"] <= MODEL_SELECTION_SEASON) & eligible
    final_model = classifier(selected_c)
    final_model.fit(x_all.loc[final_training], y_all[final_training])
    raw_probability = final_model.predict_proba(x_all)[:, 1]

    calibration = (
        (frame["season"] == CALIBRATION_SEASON) &
        (frame["week"] <= CALIBRATION_MAX_WEEK) &
        eligible
    )
    blend_ranking: list[dict[str, Any]] = []
    for weight in np.arange(0.0, 1.01, 0.1):
        blended = arrays["fair"] + float(weight) * (raw_probability - arrays["fair"])
        metrics = probability_metrics(
            blended[calibration], y_all[calibration], np.zeros(int(calibration.sum()), dtype=bool)
        )
        blend_ranking.append({"modelWeight": float(round(weight, 2)), **metrics})
    blend_ranking.sort(key=lambda row: (row["brier"], row["logLoss"], row["modelWeight"]))
    selected_weight = float(blend_ranking[0]["modelWeight"])
    # A real next-season model would be refit after the prior season ends.
    # Keep every selection choice frozen, then refit the same architecture on
    # 2018-2024 before producing the 2025 historical replay probabilities.
    replay_training = (frame["season"] >= TRAIN_START) & (frame["season"] < HISTORICAL_REPLAY_SEASON) & eligible
    replay_model = classifier(selected_c)
    replay_model.fit(x_all.loc[replay_training], y_all[replay_training])
    replay_rows = frame["season"] == HISTORICAL_REPLAY_SEASON
    raw_probability[replay_rows] = replay_model.predict_proba(x_all.loc[replay_rows])[:, 1]
    probability = np.clip(arrays["fair"] + selected_weight * (raw_probability - arrays["fair"]), 0.01, 0.99)
    return {
        "family": "regularized_market_plus_football_logit",
        "market": market,
        "selectedC": selected_c,
        "selectedModelWeight": selected_weight,
        "cSelection": c_ranking,
        "blendSelection": blend_ranking,
        "probability": probability,
        "marketProbability": arrays["fair"],
        "outcome": arrays["outcome"],
        "push": arrays["push"],
        "firstPrice": arrays["firstPrice"],
        "secondPrice": arrays["secondPrice"],
        "firstSide": arrays["firstSide"],
        "secondSide": arrays["secondSide"],
    }


def kernel_distribution_probability(
    frame: pd.DataFrame,
    market: str,
    test_season: int,
    bandwidth: float,
    division_stratified: bool,
) -> np.ndarray:
    arrays = market_arrays(frame, market)
    probability = np.full(len(frame), np.nan, dtype=float)
    training_mask = (
        (frame["season"] >= 2016) &
        (frame["season"] < test_season) &
        np.isfinite(arrays["fair"]) &
        ~arrays["push"]
    )
    test_positions = np.where(frame["season"].to_numpy(int) == test_season)[0]
    training_positions = np.where(training_mask.to_numpy(bool))[0]
    if len(training_positions) < 1000:
        raise RuntimeError(f"insufficient prior rows for {market} distribution in {test_season}")
    if market == "moneyline":
        training_location = arrays["fair"][training_positions]
        test_location = arrays["fair"][test_positions]
    elif market == "spread":
        training_location = frame["market_home_margin"].to_numpy(float)[training_positions]
        test_location = frame["market_home_margin"].to_numpy(float)[test_positions]
    else:
        training_location = frame["market_total"].to_numpy(float)[training_positions]
        test_location = frame["market_total"].to_numpy(float)[test_positions]
    training_outcome = arrays["outcome"][training_positions].astype(float)
    training_season = frame["season"].to_numpy(int)[training_positions]
    training_division = frame["division_game"].to_numpy(float)[training_positions]
    test_division = frame["division_game"].to_numpy(float)[test_positions]
    for offset, position in enumerate(test_positions):
        distance = (training_location - test_location[offset]) / bandwidth
        weight = np.exp(-0.5 * np.square(distance))
        # Prior seasons nearer to the decision date carry more weight without
        # allowing any current/future outcome into the estimate.
        weight *= np.power(0.88, test_season - training_season - 1)
        if division_stratified and market in {"spread", "total"}:
            # Pre-specified direction comes from Shank (2019): divisional
            # familiarity is relevant to home-cover and total distributions.
            weight *= np.where(training_division == test_division[offset], 2.0, 0.5)
        weight_sum = float(weight.sum())
        market_prior = float(arrays["fair"][position])
        pseudo_count = 60.0
        probability[position] = (float(np.dot(weight, training_outcome)) + pseudo_count * market_prior) / (weight_sum + pseudo_count)
    return probability


def fit_distribution_candidate(frame: pd.DataFrame, market: str) -> dict[str, Any]:
    arrays = market_arrays(frame, market)
    bandwidths = [0.025, 0.05, 0.075, 0.1] if market == "moneyline" else [0.5, 1.0, 1.5, 2.5, 4.0]
    variants: list[dict[str, Any]] = []
    selected_probabilities: dict[tuple[float, bool], dict[int, np.ndarray]] = {}
    selection_mask = frame["season"] == MODEL_SELECTION_SEASON
    for bandwidth in bandwidths:
        for division_stratified in ([False] if market == "moneyline" else [False, True]):
            predictions = {
                season: kernel_distribution_probability(frame, market, season, bandwidth, division_stratified)
                for season in [MODEL_SELECTION_SEASON, CALIBRATION_SEASON, HISTORICAL_REPLAY_SEASON]
            }
            selected_probabilities[(bandwidth, division_stratified)] = predictions
            variants.append({
                "bandwidth": bandwidth,
                "divisionStratified": division_stratified,
                **probability_metrics(
                    predictions[MODEL_SELECTION_SEASON][selection_mask],
                    arrays["outcome"][selection_mask],
                    arrays["push"][selection_mask],
                ),
            })
    variants.sort(key=lambda row: (row["brier"], row["logLoss"], row["divisionStratified"], row["bandwidth"]))
    selected_bandwidth = float(variants[0]["bandwidth"])
    selected_division = bool(variants[0]["divisionStratified"])
    predictions = selected_probabilities[(selected_bandwidth, selected_division)]
    raw_probability = arrays["fair"].copy()
    for season in [MODEL_SELECTION_SEASON, CALIBRATION_SEASON, HISTORICAL_REPLAY_SEASON]:
        mask = frame["season"] == season
        raw_probability[mask] = predictions[season][mask]
    calibration = (frame["season"] == CALIBRATION_SEASON) & (frame["week"] <= CALIBRATION_MAX_WEEK)
    blend_ranking: list[dict[str, Any]] = []
    for weight in np.arange(0.0, 1.01, 0.1):
        blended = arrays["fair"] + float(weight) * (raw_probability - arrays["fair"])
        blend_ranking.append({
            "modelWeight": float(round(weight, 2)),
            **probability_metrics(
                blended[calibration], arrays["outcome"][calibration], arrays["push"][calibration]
            ),
        })
    blend_ranking.sort(key=lambda row: (row["brier"], row["logLoss"], row["modelWeight"]))
    selected_weight = float(blend_ranking[0]["modelWeight"])
    probability = np.clip(arrays["fair"] + selected_weight * (raw_probability - arrays["fair"]), 0.01, 0.99)
    return {
        "family": "market_conditioned_empirical_distribution",
        "market": market,
        "selectedBandwidth": selected_bandwidth,
        "selectedDivisionStratification": selected_division,
        "selectedModelWeight": selected_weight,
        "variantSelection": variants,
        "blendSelection": blend_ranking,
        "probability": probability,
        "marketProbability": arrays["fair"],
        "outcome": arrays["outcome"],
        "push": arrays["push"],
        "firstPrice": arrays["firstPrice"],
        "secondPrice": arrays["secondPrice"],
        "firstSide": arrays["firstSide"],
        "secondSide": arrays["secondSide"],
    }


def select_candidate_family(logistic: dict[str, Any], distribution: dict[str, Any]) -> dict[str, Any]:
    candidates = [logistic, distribution]
    candidates.sort(key=lambda candidate: (
        candidate["blendSelection"][0]["brier"],
        candidate["blendSelection"][0]["logLoss"],
        candidate["family"],
    ))
    return candidates[0]


def decision_rows(frame: pd.DataFrame, candidates: dict[str, dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for market, candidate in candidates.items():
        for position, (_, game) in enumerate(frame.iterrows()):
            first_probability = float(candidate["probability"][position])
            second_probability = 1.0 - first_probability
            first_price = float(candidate["firstPrice"][position])
            second_price = float(candidate["secondPrice"][position])
            if not all(math.isfinite(value) for value in [first_probability, first_price, second_price]):
                continue
            first_ev = first_probability * profit_one(first_price) - (1.0 - first_probability)
            second_ev = second_probability * profit_one(second_price) - (1.0 - second_probability)
            select_first = first_ev >= second_ev
            selected_probability = first_probability if select_first else second_probability
            selected_market_probability = float(candidate["marketProbability"][position]) if select_first else 1.0 - float(candidate["marketProbability"][position])
            selected_price = first_price if select_first else second_price
            selected_ev = first_ev if select_first else second_ev
            selected_side = candidate["firstSide"][position] if select_first else candidate["secondSide"][position]
            push = bool(candidate["push"][position])
            won = bool(candidate["outcome"][position]) if select_first else not bool(candidate["outcome"][position])
            units = 0.0 if push else profit_one(selected_price) if won else -1.0
            rows.append({
                "season": int(game["season"]),
                "week": int(game["week"]),
                "gameId": str(game["game_id"]),
                "market": market,
                "side": str(selected_side),
                "modelProbability": selected_probability,
                "marketProbability": selected_market_probability,
                "edgePp": 100.0 * (selected_probability - selected_market_probability),
                "expectedValue": selected_ev,
                "priceAmerican": selected_price,
                "won": won,
                "push": push,
                "units": units,
            })
    return pd.DataFrame(rows)


def policy_result(rows: pd.DataFrame, policy: dict[str, Any], season: int, minimum_week: int = 1) -> dict[str, Any]:
    season_rows = rows[(rows["season"] == season) & (rows["week"] >= minimum_week)].copy()
    expected_weeks = sorted(int(value) for value in season_rows["week"].unique())
    allowed_markets = set(policy["markets"])
    eligible = season_rows[
        season_rows["market"].isin(allowed_markets) &
        (season_rows["expectedValue"] >= float(policy["minimumExpectedValue"]))
    ]
    selected = (
        eligible.sort_values(["week", "expectedValue", "edgePp"], ascending=[True, False, False])
        .groupby("week", as_index=False, sort=True)
        .head(int(policy["maximumActionsPerWeek"]))
    )
    counts = selected.groupby("week").size().to_dict()
    zero_action_weeks = [week for week in expected_weeks if int(counts.get(week, 0)) == 0]
    market_mix = selected["market"].value_counts().sort_index().to_dict()
    week_units = selected.groupby("week")["units"].sum().to_dict()
    action_count = int(len(selected))
    wins = int((selected["won"] & ~selected["push"]).sum())
    losses = int((~selected["won"] & ~selected["push"]).sum())
    pushes = int(selected["push"].sum())
    units = float(selected["units"].sum())
    return {
        "season": season,
        "weeks": len(expected_weeks),
        "zeroActionWeeks": zero_action_weeks,
        "weeklyActionCoverage": 1.0 - len(zero_action_weeks) / len(expected_weeks) if expected_weeks else 0.0,
        "actions": action_count,
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "units": units,
        "roiPerUnitRisked": units / action_count if action_count else None,
        "marketMix": {str(key): int(value) for key, value in market_mix.items()},
        "weekUnits": {str(int(key)): float(value) for key, value in week_units.items()},
        "minimumWeeklyUnits": float(min(week_units.values())) if week_units else None,
    }


def select_policy(rows: pd.DataFrame) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    market_sets = [MARKETS, ("moneyline",), ("spread",), ("total",), ("moneyline", "spread"), ("moneyline", "total")]
    ranking: list[dict[str, Any]] = []
    for markets in market_sets:
        for minimum_ev in [0.0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04]:
            for maximum_actions in [1, 2, 3, 4]:
                policy = {
                    "markets": list(markets),
                    "minimumExpectedValue": minimum_ev,
                    "maximumActionsPerWeek": maximum_actions,
                }
                result = policy_result(rows, policy, CALIBRATION_SEASON, POLICY_SELECTION_MIN_WEEK)
                ranking.append({"policy": policy, "selection": result})
    valid = [
        row for row in ranking
        if not row["selection"]["zeroActionWeeks"] and
        row["selection"]["actions"] >= 9 and
        row["selection"]["units"] > 0
    ]
    valid.sort(key=lambda row: (
        -row["selection"]["units"],
        -row["selection"]["roiPerUnitRisked"],
        row["selection"]["actions"],
        row["policy"]["minimumExpectedValue"],
    ))
    return (valid[0]["policy"] if valid else None), valid[:20]


def current_r3_2025_diagnostic(root: pathlib.Path) -> dict[str, Any]:
    path = root / "football-research/cache/nfl-model/nfl_2025_holdout_predictions_r2.parquet"
    holdout = pd.read_parquet(path)
    candidates: dict[str, dict[str, Any]] = {}
    definitions = {
        "moneyline": "home_win_probability",
        "spread": "home_cover_probability",
        "total": "over_probability",
    }
    for market, probability_column in definitions.items():
        arrays = market_arrays(holdout, market)
        candidates[market] = {
            "probability": holdout[probability_column].to_numpy(float),
            "marketProbability": arrays["fair"],
            "outcome": arrays["outcome"],
            "push": arrays["push"],
            "firstPrice": arrays["firstPrice"],
            "secondPrice": arrays["secondPrice"],
            "firstSide": arrays["firstSide"],
            "secondSide": arrays["secondSide"],
        }
    rows = decision_rows(holdout, candidates)
    diagnostics: list[dict[str, Any]] = []
    for minimum_ev in [0.0, 0.01, 0.02, 0.03]:
        for maximum_actions in [1, 2, 3]:
            policy = {
                "markets": list(MARKETS),
                "minimumExpectedValue": minimum_ev,
                "maximumActionsPerWeek": maximum_actions,
            }
            diagnostics.append({"policy": policy, "result": policy_result(rows, policy, 2025)})
    return {
        "source": str(path),
        "sourceSha256": sha256_file(path),
        "warning": "2025 was already opened by the r2 model audit; these rankings are descriptive and cannot select a new release",
        "policies": diagnostics,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature artifact checksum mismatch")
    frame = pd.read_parquet(feature_path).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    features = football_feature_columns(frame)
    logistic_candidates = {market: fit_market_candidate(frame, features, market) for market in MARKETS}
    distribution_candidates = {market: fit_distribution_candidate(frame, market) for market in MARKETS}
    candidates = {
        market: select_candidate_family(logistic_candidates[market], distribution_candidates[market])
        for market in MARKETS
    }
    rows = decision_rows(frame, candidates)
    selected_policy, policy_ranking = select_policy(rows)
    historical_replay = policy_result(rows, selected_policy, HISTORICAL_REPLAY_SEASON) if selected_policy else None
    probability_report: dict[str, Any] = {}
    for market, candidate in candidates.items():
        season_mask = frame["season"] == HISTORICAL_REPLAY_SEASON
        probability_report[market] = {
            "selectedFamily": candidate["family"],
            "selectedC": candidate.get("selectedC"),
            "selectedBandwidth": candidate.get("selectedBandwidth"),
            "selectedDivisionStratification": candidate.get("selectedDivisionStratification"),
            "selectedModelWeight": candidate["selectedModelWeight"],
            "marketOnly2025": probability_metrics(
                candidate["marketProbability"][season_mask],
                candidate["outcome"][season_mask],
                candidate["push"][season_mask],
            ),
            "candidate2025": probability_metrics(
                candidate["probability"][season_mask],
                candidate["outcome"][season_mask],
                candidate["push"][season_mask],
            ),
            "topCSelection": candidate.get("cSelection", [])[:5],
            "topDistributionSelection": candidate.get("variantSelection", [])[:5],
            "topBlendSelection": candidate["blendSelection"][:5],
            "familyCalibrationComparison": {
                "logistic": logistic_candidates[market]["blendSelection"][0],
                "distribution": distribution_candidates[market]["blendSelection"][0],
            },
        }
    passed = bool(
        selected_policy and historical_replay and
        not historical_replay["zeroActionWeeks"] and
        historical_replay["units"] > 0 and
        all(
            probability_report[market]["candidate2025"]["brier"] <= probability_report[market]["marketOnly2025"]["brier"]
            for market in MARKETS
        )
    )
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "candidateDecisionRelease": CANDIDATE_DECISION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "actionable": False,
        "productionChanged": False,
        "trackingChanged": False,
        "featureRelease": FEATURE_RELEASE,
        "featureArtifact": str(feature_path),
        "featureArtifactSha256": manifest["featureFileSha256"],
        "featureCount": len(features) + 2,
        "chronology": {
            "modelDevelopment": "2018-2022",
            "modelSelection": "2023",
            "probabilityCalibration": "2024 Weeks 1-9",
            "decisionPolicySelection": "2024 Weeks 10+",
            "historicalReplayEvaluation": "2025 (previously opened; not untouched)",
        },
        "probabilities": probability_report,
        "selectedPolicy": selected_policy,
        "topPolicySelection": policy_ranking,
        "historicalReplay2025": historical_replay,
        "currentR3Historical2025Diagnostic": current_r3_2025_diagnostic(root),
        "launchGate": {
            "passed": passed,
            "status": "candidate_passed_research_gate" if passed else "no_candidate_passed",
            "requirements": [
                "at least one positive-EV action in every complete regular-season week",
                "positive aggregate units in the next-season historical replay",
                "candidate Brier no worse than market-only in moneyline, spread, and total",
                "2026 forward locked-price validation before any production promotion",
            ],
        },
        "limitations": [
            "historical prices are terminal nflverse prices rather than timestamped OddSphere lock prices",
            "opening movement and public/sharp split histories are not present and are excluded",
            "2025 has already been inspected in earlier model work and is historical replay rather than untouched selection evidence",
            "policy ranking is exploratory and must not be promoted without a new forward partition",
            "preseason is excluded from fitting, official grading, staking, settlement, and lifetime tracking",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "candidateDecisionRelease": CANDIDATE_DECISION_RELEASE,
        "selectedPolicy": selected_policy,
        "historicalReplay2025": historical_replay,
        "probabilities2025": {
            market: {
                "marketBrier": values["marketOnly2025"]["brier"],
                "candidateBrier": values["candidate2025"]["brier"],
                "modelWeight": values["selectedModelWeight"],
                "family": values["selectedFamily"],
            }
            for market, values in probability_report.items()
        },
        "launchGate": report["launchGate"],
        "report": str(report_path),
    }, indent=2))


if __name__ == "__main__":
    main()
