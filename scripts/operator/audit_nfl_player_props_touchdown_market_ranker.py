#!/usr/bin/env python3
"""Read-only chronological audit of a market-aware NFL touchdown ranker."""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import audit_nfl_player_props_touchdown_scorer_quality as quality
from tournament_nfl_player_props_touchdowns import add_touchdown_features, read_pbp


OPENINGS = pathlib.Path("football-research/cache/nfl-player-props-history/nfl_player_props_2025_openings_a3bb322e60a17e03.json")
WEEK_ONE = pathlib.Path("football-research/cache/nfl-player-props-touchdowns/week1_candidate_context.json")


def implied(price: int) -> float:
    return -price / (-price + 100) if price < 0 else 100 / (price + 100)


def logit(values: pd.Series) -> np.ndarray:
    clipped = values.clip(1e-5, 1 - 1e-5).to_numpy(float)
    return np.log(clipped / (1 - clipped))


def rank_features(rows: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    result = rows.copy()
    result["raw_logit"] = logit(result["raw"])
    result["market_logit"] = logit(result["market"])
    group = result.groupby(["game_id", "team"], observed=True)
    result["market_team_rank"] = group["market"].rank(method="average", ascending=False)
    result["raw_team_rank"] = group["raw"].rank(method="average", ascending=False)
    result["market_team_share"] = result["market"] / group["market"].transform("sum").clip(lower=1e-6)
    features = ["raw_logit", "market_logit", "market_team_rank", "raw_team_rank", "market_team_share"]
    for position in quality.POSITIONS:
        column = f"position_{position.lower()}"
        result[column] = result["position"].eq(position).astype(float)
        features.append(column)
    return result, features


def fixed_blend(rows: pd.DataFrame) -> np.ndarray:
    return np.array([
        quality.residual_probability(raw, market)
        for raw, market in zip(rows["raw"], rows["market"], strict=True)
    ])


def main() -> None:
    manifest = json.loads(quality.HISTORY_MANIFEST.read_text())
    history = pd.read_parquet(manifest["featureFile"])
    market_context = pd.read_csv(quality.DEFAULT_MARKET_CONTEXT, low_memory=False)
    frame, touchdown_features = add_touchdown_features(
        history,
        read_pbp(),
        market_context[market_context["season"].between(2016, 2025) & market_context["game_type"].eq("REG")],
    )
    for position in quality.POSITIONS:
        frame[f"position_{position.lower()}"] = frame["position"].eq(position).astype(float)
    model_features = [
        *manifest["modelFeatureColumns"], *touchdown_features, "is_home",
        *(f"position_{position.lower()}" for position in quality.POSITIONS),
    ]
    eligible = frame["prior_participations"].ge(1) & frame["position"].isin(quality.POSITIONS)
    holdout = frame[eligible & frame["season"].eq(2025)].copy()
    holdout["_name"] = holdout["player_name"].map(quality.normalized_name)

    training_2023 = frame[eligible & frame["season"].le(2023)]
    calibration_rows = frame[eligible & frame["season"].eq(2024)]
    calibration_model = HistGradientBoostingClassifier(max_iter=160, max_leaf_nodes=15, learning_rate=0.05, l2_regularization=3.0, random_state=20260825)
    calibration_model.fit(training_2023[model_features], training_2023["anytime_td"])
    calibration_raw = np.clip(calibration_model.predict_proba(calibration_rows[model_features])[:, 1], 0.0025, 0.9975)
    calibrator = quality.PlattCalibrator().fit(calibration_raw, calibration_rows["anytime_td"].to_numpy(int))
    model = HistGradientBoostingClassifier(max_iter=160, max_leaf_nodes=15, learning_rate=0.05, l2_regularization=3.0, random_state=20260825)
    model.fit(frame[eligible & frame["season"].le(2024)][model_features], frame.loc[eligible & frame["season"].le(2024), "anytime_td"])
    holdout["raw"] = calibrator.predict(np.clip(model.predict_proba(holdout[model_features])[:, 1], 0.0025, 0.9975))

    opening = json.loads(OPENINGS.read_text())
    identity = holdout.groupby(["game_id", "game_date"], observed=True).apply(lambda rows: pd.Series({
        "home": rows.loc[rows["is_home"].eq(1), "team"].iloc[0],
        "away": rows.loc[rows["is_home"].eq(0), "team"].iloc[0],
    }), include_groups=False).reset_index()
    game_map: dict[str, str] = {}
    for game in opening["games"]:
        date = pd.Timestamp(game["scheduledStart"]).date()
        match = identity[identity["home"].eq(game["homeTeam"]) & identity["away"].eq(game["awayTeam"])].copy()
        if len(match):
            match["delta"] = pd.to_datetime(match["game_date"]).dt.date.map(lambda value: abs((value - date).days))
            nearest = match.sort_values("delta").iloc[0]
            if nearest["delta"] <= 1:
                game_map[str(game["id"])] = str(nearest["game_id"])
    observations = pd.DataFrame(opening["observations"])
    observations = observations[
        observations["market"].eq("anytime_td") & observations["offerType"].eq("milestone")
        & observations["side"].eq("yes") & observations["line"].eq(0.5)
    ].copy()
    observations["game_id"] = observations["providerEventId"].astype(str).map(game_map)
    observations["_name"] = observations["playerName"].map(quality.normalized_name)
    observations = observations.dropna(subset=["game_id"])
    observations["implied"] = observations["americanPrice"].map(implied)
    observations = observations.sort_values("observedAt").drop_duplicates(["game_id", "_name", "sportsbook"], keep="last")
    markets = []
    for (game_id, name), rows in observations.groupby(["game_id", "_name"], observed=True):
        values = rows["implied"].to_numpy(float)
        leaveout = np.array([(values.sum() - value) / (len(values) - 1) for value in values]) if len(values) > 1 else values
        markets.append({"game_id": game_id, "_name": name, "market": float(leaveout.max())})
    evaluated = holdout.merge(pd.DataFrame(markets), on=["game_id", "_name"], how="inner")
    evaluated, features = rank_features(evaluated)
    dates = pd.to_datetime(evaluated["game_date"])
    training = dates.lt(pd.Timestamp("2025-10-01"))
    selection = dates.ge(pd.Timestamp("2025-10-01")) & dates.lt(pd.Timestamp("2025-11-01"))
    validation = dates.ge(pd.Timestamp("2025-11-01"))
    factories = {
        "logistic_c003": lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.03, max_iter=800)),
        "hgb_leaf3": lambda: HistGradientBoostingClassifier(max_iter=160, max_leaf_nodes=3, learning_rate=0.04, l2_regularization=5.0, min_samples_leaf=40, random_state=20260917),
        "hgb_leaf7": lambda: HistGradientBoostingClassifier(max_iter=160, max_leaf_nodes=7, learning_rate=0.04, l2_regularization=8.0, min_samples_leaf=60, random_state=20260917),
        "hgb_leaf15": lambda: HistGradientBoostingClassifier(max_iter=140, max_leaf_nodes=15, learning_rate=0.04, l2_regularization=10.0, min_samples_leaf=80, random_state=20260917),
    }
    candidate_selection = {}
    for name, factory in factories.items():
        candidate = factory()
        candidate.fit(evaluated.loc[training, features], evaluated.loc[training, "anytime_td"])
        probability = candidate.predict_proba(evaluated.loc[selection, features])[:, 1]
        candidate_selection[name] = quality.scorer_metrics(evaluated.loc[selection], probability, "team")
    selected_name = max(candidate_selection, key=lambda name: candidate_selection[name]["f1"])
    ranker = factories[selected_name]()
    ranker.fit(evaluated.loc[training | selection, features], evaluated.loc[training | selection, "anytime_td"])
    incumbent_second = fixed_blend(evaluated.loc[validation])
    challenger_second = ranker.predict_proba(evaluated.loc[validation, features])[:, 1]

    week_one_payload = json.loads(WEEK_ONE.read_text())
    week_one = pd.DataFrame(week_one_payload["candidates"])
    week_one = week_one[week_one["offeredAnytimeTouchdown"] & week_one["incumbentFinalProbability"].notna()].copy()
    week_one = week_one.rename(columns={
        "gameId": "game_id", "incumbentRawProbability": "raw", "marketProbability": "market",
        "actualTouchdowns": "actual_touchdowns",
    })
    week_one["player_id"] = week_one["playerName"].map(quality.normalized_name)
    week_one["season"] = 2026
    week_one["week"] = 1
    week_one["anytime_td"] = week_one["actual_touchdowns"].fillna(0).gt(0).astype(int)
    week_one, _ = rank_features(week_one)
    final_ranker = factories[selected_name]()
    final_ranker.fit(evaluated[features], evaluated["anytime_td"])
    incumbent_week_one = week_one["incumbentFinalProbability"].to_numpy(float)
    challenger_week_one = final_ranker.predict_proba(week_one[features])[:, 1]
    result = {
        "release": "nfl_player_props_touchdown_market_ranker_audit_2026_09_17_r1",
        "chronology": {"rankerTrain": "2025 through September 30", "modelSelection": "2025 October", "validation": "2025 November onward", "externalConfirmation": "2026 Week 1"},
        "rows": {"rankerTrain": int(training.sum()), "modelSelection": int(selection.sum()), "validation": int(validation.sum()), "weekOneKnown": int(week_one["actual_touchdowns"].notna().sum())},
        "candidateSelection": candidate_selection,
        "selected": selected_name,
        "validation": {
            "incumbent": quality.scorer_metrics(evaluated.loc[validation], incumbent_second, "team"),
            "challenger": quality.scorer_metrics(evaluated.loc[validation], challenger_second, "team"),
        },
        "weekOne": {
            "incumbent": quality.external_scorer_metrics(week_one, incumbent_week_one, "team"),
            "challenger": quality.external_scorer_metrics(week_one, challenger_week_one, "team"),
        },
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
