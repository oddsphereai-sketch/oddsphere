#!/usr/bin/env python3
"""Chronological anytime-touchdown rare-event model and exact-price evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import unicodedata
from typing import Any

import joblib
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


CONTRACT_PATH = pathlib.Path("lib/services/football/nflPlayerPropsTouchdownContract.json")
HISTORY_MANIFEST = pathlib.Path("football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json")
SOURCE_MANIFEST = pathlib.Path("football-research/cache/nflverse/real-model-r1/manifest.json")
OUTPUT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-touchdowns")
MARKET_CONTEXT = pathlib.Path("football-research/cache/nfl-player-props-market-context/nflverse_games_2026_08_25.csv")
MARKET_CONTEXT_SHA256 = "4af638f9866594b80766668e8d4c7a135bf9ddf335366320e8486c2b46b93f9f"
SEED = 20260825
EWM_ALPHA = 0.35


def normalized_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", ascii_value)


def add_team_expectation(rows: pd.DataFrame, market_context: pd.DataFrame) -> pd.DataFrame:
    required = {"game_id", "home_team", "away_team", "spread_line", "total_line"}
    if not required.issubset(market_context.columns):
        raise RuntimeError("NFL touchdown market context columns are incomplete")
    games = market_context[list(required)].copy()
    games["home_implied_points"] = games["total_line"] / 2.0 + games["spread_line"] / 2.0
    games["away_implied_points"] = games["total_line"] - games["home_implied_points"]
    enriched = rows.merge(games, on="game_id", how="left", validate="many_to_one")
    enriched["team_implied_touchdowns"] = np.where(
        enriched["team"].eq(enriched["home_team"]), enriched["home_implied_points"] / 7.0,
        np.where(enriched["team"].eq(enriched["away_team"]), enriched["away_implied_points"] / 7.0, np.nan),
    )
    return enriched


def read_pbp() -> pd.DataFrame:
    manifest = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    frames: list[pd.DataFrame] = []
    columns = ["season", "week", "game_id", "posteam", "defteam", "yardline_100", "goal_to_go", "touchdown", "td_team", "td_player_id", "pass_attempt", "rush_attempt", "receiver_player_id", "rusher_player_id"]
    for item in manifest["files"]:
        if item["dataset"] != "pbp" or not 2016 <= int(item["season"]) <= 2025:
            continue
        path = pathlib.Path(item["filename"])
        available = set(pq.read_schema(path).names)
        frames.append(pq.read_table(path, columns=[column for column in columns if column in available]).to_pandas())
    if len(frames) != 10:
        raise RuntimeError("NFL touchdown PBP history is incomplete")
    return pd.concat(frames, ignore_index=True)


def add_touchdown_features(history: pd.DataFrame, pbp: pd.DataFrame, market_context: pd.DataFrame | None = None) -> tuple[pd.DataFrame, list[str]]:
    rows = history.copy()
    keys = ["season", "week", "game_id", "team", "player_id"]
    touchdowns = pbp[pd.to_numeric(pbp["touchdown"], errors="coerce").fillna(0).eq(1) & pbp["td_player_id"].notna()].copy()
    td = touchdowns.groupby(["season", "week", "game_id", "posteam", "td_player_id"], observed=True).size().rename("touchdowns").reset_index().rename(columns={"posteam": "team", "td_player_id": "player_id"})
    rows = rows.merge(td, on=keys, how="left", validate="one_to_one")
    rows["touchdowns"] = rows["touchdowns"].fillna(0.0)
    rows["anytime_td"] = rows["touchdowns"].gt(0).astype(int)

    yardline = pd.to_numeric(pbp["yardline_100"], errors="coerce")
    opportunities: list[pd.DataFrame] = []
    for player_column, attempt_column in (("receiver_player_id", "pass_attempt"), ("rusher_player_id", "rush_attempt")):
        subset = pbp[pbp[player_column].notna() & pd.to_numeric(pbp[attempt_column], errors="coerce").fillna(0).gt(0)].copy()
        subset["redzone_opportunity"] = yardline.loc[subset.index].le(20).astype(float)
        subset["goal_line_opportunity"] = (yardline.loc[subset.index].le(10) | subset["goal_to_go"].fillna(False).astype(bool)).astype(float)
        opportunities.append(subset.groupby(["season", "week", "game_id", "posteam", player_column], observed=True, as_index=False)[["redzone_opportunity", "goal_line_opportunity"]].sum().rename(columns={"posteam": "team", player_column: "player_id"}))
    opportunity = pd.concat(opportunities, ignore_index=True).groupby(keys, observed=True, as_index=False)[["redzone_opportunity", "goal_line_opportunity"]].sum()
    rows = rows.merge(opportunity, on=keys, how="left", validate="one_to_one")
    rows[["redzone_opportunity", "goal_line_opportunity"]] = rows[["redzone_opportunity", "goal_line_opportunity"]].fillna(0.0)

    team_td = touchdowns[touchdowns["td_team"].eq(touchdowns["posteam"])].groupby(["season", "week", "game_id", "posteam", "defteam"], observed=True).size().rename("team_touchdowns").reset_index().rename(columns={"posteam": "team", "defteam": "opponent"})
    team_games = rows[["season", "week", "game_id", "team", "opponent"]].drop_duplicates().merge(team_td, on=["season", "week", "game_id", "team", "opponent"], how="left")
    team_games["team_touchdowns"] = team_games["team_touchdowns"].fillna(0.0)
    team_games = team_games.sort_values(["team", "season", "week", "game_id"])
    team_games["prior_team_td_avg5"] = team_games.groupby("team", observed=True)["team_touchdowns"].transform(lambda values: values.shift(1).rolling(5, min_periods=1).mean())
    allowed = team_games.rename(columns={"team": "offense", "opponent": "team"}).sort_values(["team", "season", "week", "game_id"])
    allowed["prior_opponent_td_allowed_avg5"] = allowed.groupby("team", observed=True)["team_touchdowns"].transform(lambda values: values.shift(1).rolling(5, min_periods=1).mean())
    rows = rows.merge(team_games[["season", "week", "game_id", "team", "prior_team_td_avg5"]], on=["season", "week", "game_id", "team"], how="left")
    rows = rows.merge(allowed[["season", "week", "game_id", "team", "prior_opponent_td_allowed_avg5"]], on=["season", "week", "game_id", "team"], how="left")
    rows = rows.sort_values(["player_id", "season", "week", "game_id"])
    for metric in ("anytime_td", "redzone_opportunity", "goal_line_opportunity"):
        group = rows.groupby("player_id", observed=True)[metric]
        rows[f"prior_{metric}_avg5"] = group.transform(lambda values: values.shift(1).rolling(5, min_periods=1).mean())
        rows[f"prior_{metric}_ewm"] = group.transform(lambda values: values.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean())
    added = [
        "prior_anytime_td_avg5", "prior_anytime_td_ewm", "prior_redzone_opportunity_avg5",
        "prior_redzone_opportunity_ewm", "prior_goal_line_opportunity_avg5", "prior_goal_line_opportunity_ewm",
        "prior_team_td_avg5", "prior_opponent_td_allowed_avg5",
    ]
    if market_context is not None:
        rows = add_team_expectation(rows, market_context)
        added.append("team_implied_touchdowns")
    return rows, added


def candidates() -> dict[str, Any]:
    return {
        "logistic": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.1, max_iter=500)),
        "hgb_classifier": HistGradientBoostingClassifier(max_iter=160, max_leaf_nodes=15, learning_rate=0.05, l2_regularization=3.0, random_state=SEED),
    }


def fresh(name: str) -> Any:
    return candidates()[name]


def probability_metrics(y: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    bins = pd.qcut(probability, q=10, duplicates="drop")
    grouped = pd.DataFrame({"p": probability, "y": y, "bin": bins}).groupby("bin", observed=True).agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"))
    return {
        "rows": int(len(y)), "positiveRate": float(y.mean()),
        "brier": float(brier_score_loss(y, probability)), "logLoss": float(log_loss(y, probability)),
        "auc": float(roc_auc_score(y, probability)),
        "calibrationGap": float(np.average(np.abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"])),
    }


def platt_fit(probability: np.ndarray, y: np.ndarray) -> LogisticRegression:
    logits = np.log(np.clip(probability, 1e-5, 1 - 1e-5) / np.clip(1 - probability, 1e-5, 1))
    model = LogisticRegression(C=1.0, max_iter=500)
    model.fit(logits.reshape(-1, 1), y)
    return model


def platt_predict(model: LogisticRegression, probability: np.ndarray) -> np.ndarray:
    logits = np.log(np.clip(probability, 1e-5, 1 - 1e-5) / np.clip(1 - probability, 1e-5, 1))
    return model.predict_proba(logits.reshape(-1, 1))[:, 1]


def implied(price: int) -> float:
    return -price / (-price + 100) if price < 0 else 100 / (price + 100)


def profit(price: int) -> float:
    return 100 / abs(price) if price < 0 else price / 100


def summarize(rows: pd.DataFrame) -> dict[str, Any]:
    if len(rows) == 0:
        return {"bets": 0, "roi": None}
    wins = rows[rows["units"] > 0]["units"].sort_values(ascending=False)
    return {"bets": int(len(rows)), "wins": int((rows["units"] > 0).sum()), "units": float(rows["units"].sum()), "roi": float(rows["units"].mean()), "largestWinShare": float(wins.iloc[0] / wins.sum()) if len(wins) and wins.sum() > 0 else None, "games": int(rows["game_id"].nunique())}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--openings", type=pathlib.Path, required=True)
    parser.add_argument("--output-root", type=pathlib.Path, default=OUTPUT_ROOT)
    args = parser.parse_args()
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    history_manifest = json.loads(HISTORY_MANIFEST.read_text(encoding="utf-8"))
    history = pd.read_parquet(history_manifest["featureFile"])
    if hashlib.sha256(MARKET_CONTEXT.read_bytes()).hexdigest() != MARKET_CONTEXT_SHA256:
        raise RuntimeError("NFL touchdown market-context checksum mismatch")
    market_context = pd.read_csv(MARKET_CONTEXT, low_memory=False)
    frame, added = add_touchdown_features(history, read_pbp(), market_context)
    features = [*history_manifest["modelFeatureColumns"], *added, "is_home"]
    for position in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position.lower()}"
        frame[column] = frame["position"].eq(position).astype(float)
        features.append(column)
    eligible = frame["prior_participations"].ge(1) & frame["position"].isin(["QB", "RB", "FB", "WR", "TE"])
    splits = {season: frame[eligible & frame["season"].eq(season)] for season in (2023, 2024, 2025)}
    train = frame[eligible & frame["season"].le(2022)]
    selection_y = splits[2023]["anytime_td"].to_numpy(int)
    selection: dict[str, Any] = {}
    for name in ("prior_td_ewm", "logistic", "hgb_classifier"):
        if name == "prior_td_ewm":
            probability = np.clip(splits[2023]["prior_anytime_td_ewm"].fillna(train["anytime_td"].mean()).to_numpy(float), 0.01, 0.99)
        else:
            model = fresh(name); model.fit(train[features], train["anytime_td"]); probability = np.clip(model.predict_proba(splits[2023][features])[:, 1], 0.01, 0.99)
        selection[name] = probability_metrics(selection_y, probability)
    champion = min(selection, key=lambda name: selection[name]["brier"])
    if champion == "prior_td_ewm":
        raise RuntimeError("prior TD average won; artifact path requires a fitted rare-event model")
    training_2023 = frame[eligible & frame["season"].le(2023)]
    calibration_base = fresh(champion); calibration_base.fit(training_2023[features], training_2023["anytime_td"])
    calibration_raw = np.clip(calibration_base.predict_proba(splits[2024][features])[:, 1], 0.005, 0.995)
    calibrator = platt_fit(calibration_raw, splits[2024]["anytime_td"].to_numpy(int))
    training_2024 = frame[eligible & frame["season"].le(2024)]
    holdout_model = fresh(champion); holdout_model.fit(training_2024[features], training_2024["anytime_td"])
    holdout_raw = np.clip(holdout_model.predict_proba(splits[2025][features])[:, 1], 0.005, 0.995)
    holdout_probability = platt_predict(calibrator, holdout_raw)
    holdout_metrics = probability_metrics(splits[2025]["anytime_td"].to_numpy(int), holdout_probability)

    opening = json.loads(args.openings.read_text(encoding="utf-8"))
    games = {str(game["id"]): game for game in opening["games"]}
    game_identity = splits[2025].groupby(["game_id", "game_date"], observed=True).apply(lambda rows: pd.Series({"home": rows.loc[rows["is_home"].eq(1), "team"].iloc[0], "away": rows.loc[rows["is_home"].eq(0), "team"].iloc[0]}), include_groups=False).reset_index()
    game_map: dict[str, str] = {}
    for provider_id, game in games.items():
        date = pd.Timestamp(game["scheduledStart"]).date()
        match = game_identity[game_identity["home"].eq(game["homeTeam"]) & game_identity["away"].eq(game["awayTeam"])].copy()
        if len(match):
            match["delta"] = pd.to_datetime(match["game_date"]).dt.date.map(lambda value: abs((value - date).days))
            if int(match["delta"].min()) <= 1:
                game_map[provider_id] = str(match.sort_values("delta").iloc[0]["game_id"])
    prediction = splits[2025][["game_id", "player_name", "anytime_td"]].copy()
    prediction["_name"] = prediction["player_name"].astype(str).map(normalized_name)
    prediction["model_probability"] = holdout_probability
    offers = pd.DataFrame(opening["observations"])
    offers = offers[(offers["market"].eq("anytime_td")) & offers["offerType"].eq("milestone") & offers["side"].eq("yes") & offers["line"].eq(0.5)].copy()
    offers["game_id"] = offers["providerEventId"].astype(str).map(game_map)
    offers["_name"] = offers["playerName"].astype(str).map(normalized_name)
    joined = offers.merge(prediction, on=["game_id", "_name"], how="inner")
    joined["price"] = joined["americanPrice"].astype(int)
    joined = joined[joined["price"].ge(int(contract["minimumAmericanPrice"]))]
    joined["target_book_probability"] = joined["price"].map(implied)
    consensus_group = joined.groupby(["game_id", "_name"], observed=True)["target_book_probability"]
    joined["independent_book_count"] = consensus_group.transform("count") - 1
    joined["market_probability"] = np.where(
        joined["independent_book_count"].gt(0),
        (consensus_group.transform("sum") - joined["target_book_probability"]) / joined["independent_book_count"],
        joined["target_book_probability"],
    )
    joined = joined[joined["independent_book_count"].ge(1)].sort_values("price", ascending=False).drop_duplicates(["game_id", "_name"], keep="first")
    # Select the model-vs-price residual weight on the first chronological half only.
    game_dates = splits[2025][["game_id", "game_date"]].drop_duplicates().set_index("game_id")["game_date"]
    joined["date"] = pd.to_datetime(joined["game_id"].map(game_dates)).dt.date
    cutoff = pd.Timestamp("2025-11-01").date()
    first = joined[joined["date"].lt(cutoff)]
    second = joined[joined["date"].ge(cutoff)].copy()
    def residual(model: pd.Series, market: pd.Series, weight: float) -> np.ndarray:
        m = np.clip(model.to_numpy(float), 1e-5, 1 - 1e-5); k = np.clip(market.to_numpy(float), 1e-5, 1 - 1e-5)
        return 1 / (1 + np.exp(-(np.log(k / (1-k)) + weight * (np.log(m / (1-m)) - np.log(k / (1-k))))))
    first_y = first["anytime_td"].to_numpy(int)
    weight_scores = {str(weight): float(brier_score_loss(first_y, residual(first["model_probability"], first["market_probability"], float(weight)))) for weight in contract["marketResidualWeights"]}
    weight = min(contract["marketResidualWeights"], key=lambda value: weight_scores[str(value)])
    second["calibrated_probability"] = residual(second["model_probability"], second["market_probability"], float(weight))
    second["probability_edge"] = second["calibrated_probability"] - second["market_probability"]
    second["ev"] = second["calibrated_probability"] * second["price"].map(profit) - (1 - second["calibrated_probability"])
    second["units"] = np.where(second["anytime_td"].eq(1), second["price"].map(profit), -1.0)
    second["grade"] = "no_play"
    for label in ("watchlist", "lean", "bestAngle"):
        threshold = contract["priceThresholds"][label]
        mask = second["ev"].ge(threshold["minimumEv"]) & second["probability_edge"].ge(threshold["minimumProbabilityEdge"])
        second.loc[mask, "grade"] = {"watchlist": "watchlist", "lean": "lean_candidate", "bestAngle": "best_angle_candidate"}[label]
    grades = {label: summarize(second[second["grade"].eq(label)]) for label in ("best_angle_candidate", "lean_candidate", "watchlist", "no_play")}
    final_model = fresh(champion); final_model.fit(frame[eligible & frame["season"].le(2025)][features], frame[eligible & frame["season"].le(2025)]["anytime_td"])
    artifact = {"modelRelease": contract["modelRelease"], "calibrationRelease": contract["calibrationRelease"], "champion": champion, "features": features, "model": final_model, "calibrator": calibrator, "marketResidualWeight": float(weight), "actionable": False}
    args.output_root.mkdir(parents=True, exist_ok=True)
    artifact_path = args.output_root / "nfl_player_props_anytime_td_r2.joblib"
    report_path = args.output_root / "nfl_player_props_anytime_td_tournament_r2.json"
    joblib.dump(artifact, artifact_path)
    report = {**contract, "champion": champion, "selection": selection, "holdout": holdout_metrics, "marketContextSha256": MARKET_CONTEXT_SHA256, "marketContextCoverage": {"eligibleRows": int(eligible.sum()), "rowsWithTeamExpectation": int(frame.loc[eligible, "team_implied_touchdowns"].notna().sum())}, "marketBenchmark": "mean_implied_probability_from_independent_books_excluding_target_book", "priceJoinRows": int(len(joined)), "marketResidualSelection": weight_scores, "selectedMarketResidualWeight": float(weight), "confirmationGrades": grades, "artifact": str(artifact_path), "artifactSha256": hashlib.sha256(artifact_path.read_bytes()).hexdigest()}
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "champion": champion, "holdout": holdout_metrics, "priceJoinRows": len(joined), "selectedMarketResidualWeight": weight, "confirmationGrades": grades}, indent=2))


if __name__ == "__main__":
    main()
