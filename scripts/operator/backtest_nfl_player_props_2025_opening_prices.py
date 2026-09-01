#!/usr/bin/env python3
"""Exact-opening-price holdout evaluation for calibrated NFL volume/yardage props."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys
import unicodedata
from typing import Any

import joblib
import numpy as np
import pandas as pd


DECISION_CONTRACT = pathlib.Path("lib/services/football/nflPlayerPropsDecisionContract.json")
RECALIBRATION_SCRIPT = pathlib.Path("scripts/operator/recalibrate_nfl_player_props_distributions.py")
SCORER_PATH = pathlib.Path("lib/services/football/nfl_player_props_shadow_model.py")
HISTORY_MANIFEST = pathlib.Path("football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json")
R2_ARTIFACT = pathlib.Path("football-research/cache/nfl-player-props-calibration/nfl_player_props_distribution_shadow_2026_08_25_r2.joblib")
OUTPUT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-price-backtest")
SEED = 20260825


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def normalized_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", ascii_value)


def normalize_team(value: str) -> str:
    team = value.upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def implied_probability(price: int) -> float:
    return -price / (-price + 100) if price < 0 else 100 / (price + 100)


def profit_multiple(price: int) -> float:
    return 100 / abs(price) if price < 0 else price / 100


def grade(row: pd.Series, contract: dict[str, Any]) -> str:
    thresholds = contract["volumeAndYardage"]
    if row["ev"] >= thresholds["bestAngle"]["minimumEv"] and row["probability_edge"] >= thresholds["bestAngle"]["minimumProbabilityEdge"]:
        return "best_angle_candidate"
    if row["ev"] >= thresholds["lean"]["minimumEv"] and row["probability_edge"] >= thresholds["lean"]["minimumProbabilityEdge"]:
        return "lean_candidate"
    if row["ev"] >= thresholds["watchlist"]["minimumEv"] and row["probability_edge"] >= thresholds["watchlist"]["minimumProbabilityEdge"]:
        return "watchlist"
    return "no_play"


def summarize(rows: pd.DataFrame) -> dict[str, Any]:
    if len(rows) == 0:
        return {"bets": 0, "units": 0.0, "roi": None}
    wins = rows[rows["units"] > 0]["units"].sort_values(ascending=False)
    total_positive = float(wins.sum())
    return {
        "bets": int(len(rows)),
        "wins": int((rows["units"] > 0).sum()),
        "losses": int((rows["units"] < 0).sum()),
        "pushes": int((rows["units"] == 0).sum()),
        "units": float(rows["units"].sum()),
        "roi": float(rows["units"].mean()),
        "averageEv": float(rows["ev"].mean()),
        "averageProbabilityEdge": float(rows["probability_edge"].mean()),
        "largestWinShare": float(wins.iloc[0] / total_positive) if total_positive > 0 else None,
        "games": int(rows["game_id"].nunique()),
        "players": int(rows["player_name"].nunique()),
    }


def bootstrap_roi(rows: pd.DataFrame, iterations: int = 1000) -> dict[str, float] | None:
    if len(rows) == 0:
        return None
    clusters = rows.groupby("game_id", observed=True)["units"].agg(["sum", "count"]).to_numpy(float)
    rng = np.random.default_rng(SEED)
    draws = np.empty(iterations)
    for index in range(iterations):
        sample = clusters[rng.integers(0, len(clusters), len(clusters))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    return {"mean": float(draws.mean()), "ciLow": float(np.quantile(draws, 0.025)), "ciHigh": float(np.quantile(draws, 0.975)), "gameClusters": int(len(clusters))}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--openings", type=pathlib.Path, required=True)
    parser.add_argument("--output-root", type=pathlib.Path, default=OUTPUT_ROOT)
    args = parser.parse_args()
    decision = json.loads(DECISION_CONTRACT.read_text(encoding="utf-8"))
    recalibration = load_module("nfl_props_price_backtest_recalibration", RECALIBRATION_SCRIPT)
    scorer = load_module("nfl_props_price_backtest_scorer", SCORER_PATH)
    baseline = recalibration.load_baseline_module()
    baseline_contract = json.loads(baseline.CONTRACT_PATH.read_text(encoding="utf-8"))
    frame, manifest = baseline.load_verified_dataset(HISTORY_MANIFEST, baseline_contract)
    frame, features = baseline.prepare_features(frame, manifest)
    r2_artifact = joblib.load(R2_ARTIFACT)
    calibration_contract = json.loads(recalibration.CONTRACT_PATH.read_text(encoding="utf-8"))
    if r2_artifact["calibrationRelease"] != calibration_contract["calibrationRelease"]:
        raise RuntimeError("NFL props price backtest calibration release mismatch")
    opening = json.loads(args.openings.read_text(encoding="utf-8"))
    if opening["release"] != "nfl_player_props_2025_opening_prices_2026_09_01_r2_provider_recovery":
        raise RuntimeError("NFL props opening-price release mismatch")

    holdout = frame[frame["season"].eq(2025)].copy()
    holdout["_name"] = holdout["player_name"].astype(str).map(normalized_name)
    game_identity = holdout.groupby(["game_id", "game_date"], observed=True).apply(
        lambda rows: pd.Series({
            "home_team": rows.loc[rows["is_home"].eq(1), "team"].iloc[0],
            "away_team": rows.loc[rows["is_home"].eq(0), "team"].iloc[0],
        }),
        include_groups=False,
    ).reset_index()
    game_map: dict[str, str] = {}
    for game in opening["games"]:
        date = pd.Timestamp(game["scheduledStart"]).date()
        match = game_identity[
            game_identity["home_team"].map(normalize_team).eq(normalize_team(game["homeTeam"]))
            & game_identity["away_team"].map(normalize_team).eq(normalize_team(game["awayTeam"]))
        ].copy()
        if len(match):
            match["date_delta"] = pd.to_datetime(match["game_date"]).dt.date.map(lambda value: abs((value - date).days))
            nearest = match.sort_values("date_delta")
            if int(nearest.iloc[0]["date_delta"]) <= 1 and (len(nearest) == 1 or nearest.iloc[0]["date_delta"] < nearest.iloc[1]["date_delta"]):
                game_map[str(game["id"])] = str(nearest.iloc[0]["game_id"])
    if len(game_map) < 260:
        raise RuntimeError(f"NFL props opening/history game identity coverage is low: {len(game_map)}")

    prediction_rows: list[pd.DataFrame] = []
    for market, config in baseline_contract["markets"].items():
        eligible = baseline.market_eligible(frame, config)
        champion_name = json.loads(recalibration.CONTRACT_PATH.read_text(encoding="utf-8"))["projectionChampions"][market]
        champion = next(value for value in baseline.regression_candidates(market, config["distribution"]) if value.name == champion_name)
        training = frame[eligible & frame["season"].le(2024)]
        testing = frame[eligible & frame["season"].eq(2025)].copy()
        _, means = baseline.fit_predict(champion, training, testing, features, market)
        distribution = r2_artifact["markets"][market]["distribution"]
        testing = testing[["row_id", "game_id", "game_date", "player_id", "player_name", "team", market]].copy()
        testing["market"] = market
        testing["projection"] = means
        testing["_name"] = testing["player_name"].astype(str).map(normalized_name)
        testing["model_over_probability"] = scorer.over_probability(means, np.zeros(len(means)), distribution)
        prediction_rows.append(testing)
    predictions = pd.concat(prediction_rows, ignore_index=True)

    observations = pd.DataFrame(opening["observations"])
    observations = observations[
        observations["market"].isin(baseline_contract["markets"])
        & observations["offerType"].eq("over_under")
        & observations["side"].isin(["over", "under"])
    ].copy()
    observations["game_id"] = observations["providerEventId"].astype(str).map(game_map)
    observations["_name"] = observations["playerName"].astype(str).map(normalized_name)
    observations = observations.dropna(subset=["game_id"])
    pivot_keys = ["game_id", "_name", "playerName", "sportsbook", "market", "line", "observedAt"]
    paired = observations.pivot_table(index=pivot_keys, columns="side", values="americanPrice", aggfunc="last").reset_index()
    paired = paired.dropna(subset=["over", "under"])
    paired["over"] = paired["over"].astype(int)
    paired["under"] = paired["under"].astype(int)
    joined = paired.merge(predictions, on=["game_id", "_name", "market"], how="inner", validate="many_to_one")
    if len(joined) < 1_000:
        raise RuntimeError(f"NFL props exact opening-price join is too small: {len(joined)}")
    model_over: list[float] = []
    for market, rows in joined.groupby("market", sort=False, observed=True):
        distribution = r2_artifact["markets"][market]["distribution"]
        probabilities = scorer.over_probability(rows["projection"].to_numpy(float), rows["line"].to_numpy(float), distribution)
        model_over.extend(zip(rows.index, probabilities, strict=True))
    probability_by_index = dict(model_over)
    joined["model_over_probability"] = joined.index.map(probability_by_index)
    over_implied = joined["over"].map(implied_probability)
    under_implied = joined["under"].map(implied_probability)
    joined["market_over_probability"] = over_implied / (over_implied + under_implied)
    consensus_keys = ["game_id", "_name", "market", "line"]
    group = joined.groupby(consensus_keys, observed=True)["market_over_probability"]
    joined["independent_book_count"] = group.transform("count") - 1
    joined["target_book_over_probability"] = joined["market_over_probability"]
    joined["market_over_probability"] = np.where(
        joined["independent_book_count"].gt(0),
        (group.transform("sum") - joined["target_book_over_probability"]) / joined["independent_book_count"],
        joined["target_book_over_probability"],
    )

    sides: list[pd.DataFrame] = []
    for side in ("over", "under"):
        part = joined.copy()
        part["side"] = side
        part["price"] = part[side].astype(int)
        part["model_probability"] = part["model_over_probability"] if side == "over" else 1.0 - part["model_over_probability"]
        part["market_probability"] = part["market_over_probability"] if side == "over" else 1.0 - part["market_over_probability"]
        part["target_book_probability"] = part["target_book_over_probability"] if side == "over" else 1.0 - part["target_book_over_probability"]
        part["probability_edge"] = part["model_probability"] - part["market_probability"]
        part["ev"] = part["model_probability"] * part["price"].map(profit_multiple) - (1.0 - part["model_probability"])
        actual = part.apply(lambda row: float(row[row["market"]]), axis=1)
        win = actual.gt(part["line"]) if side == "over" else actual.lt(part["line"])
        push = actual.eq(part["line"])
        part["units"] = np.where(push, 0.0, np.where(win, part["price"].map(profit_multiple), -1.0))
        part["grade"] = part.apply(lambda row: grade(row, decision), axis=1)
        sides.append(part)
    graded = pd.concat(sides, ignore_index=True)
    # One executable quote per player/game/market/line/side: retain the best exact price.
    graded = graded[graded["independent_book_count"].ge(1)].sort_values("price", ascending=False).drop_duplicates(["game_id", "_name", "market", "line", "side"], keep="first")
    split_date = pd.Timestamp("2025-11-01").date()
    graded["half"] = np.where(pd.to_datetime(graded["game_date"]).dt.date < split_date, "first", "second")

    grade_report: dict[str, Any] = {}
    for label in ("best_angle_candidate", "lean_candidate", "watchlist", "no_play"):
        rows = graded[graded["grade"].eq(label)]
        grade_report[label] = {
            **summarize(rows),
            "clusterBootstrapRoi": bootstrap_roi(rows),
            "byHalf": {half: summarize(group) for half, group in rows.groupby("half", observed=True)},
            "byMarket": {market: summarize(group) for market, group in rows.groupby("market", observed=True)},
        }
    release_rules = decision["releaseEvidence"]
    best = grade_report["best_angle_candidate"]
    lean = grade_report["lean_candidate"]
    release_gate = {
        "bestAngle": bool(best["bets"] >= release_rules["minimumBestAngleBets"] and best["roi"] is not None and best["roi"] > 0 and (best["largestWinShare"] or 1) <= release_rules["maximumLargestWinShare"] and all(value["roi"] is not None and value["roi"] > 0 for value in best["byHalf"].values()) and all(value["roi"] is not None and value["roi"] > 0 for value in best["byMarket"].values())),
        "lean": bool(lean["bets"] >= release_rules["minimumLeanBets"] and lean["roi"] is not None and lean["roi"] > 0 and (lean["largestWinShare"] or 1) <= release_rules["maximumLargestWinShare"] and all(value["roi"] is not None and value["roi"] > 0 for value in lean["byHalf"].values()) and all(value["roi"] is not None and value["roi"] > 0 for value in lean["byMarket"].values())),
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    rows_path = args.output_root / "nfl_player_props_2025_opening_price_rows_r1.parquet"
    report_path = args.output_root / "nfl_player_props_2025_opening_price_backtest_r1.json"
    graded.to_parquet(rows_path, index=False)
    report = {
        "decisionRelease": decision["decisionRelease"],
        "modelRelease": decision["modelRelease"],
        "calibrationRelease": decision["calibrationRelease"],
        "openingPriceRelease": opening["release"],
        "openingPriceSha256": baseline.sha256_file(args.openings),
        "gamesMapped": len(game_map),
        "pairedOffers": int(len(paired)),
        "joinedOffers": int(len(joined)),
        "evaluatedSides": int(len(graded)),
        "marketBenchmark": "mean_no_vig_probability_from_independent_books_excluding_target_book",
        "grades": grade_report,
        "releaseGate": release_gate,
        "rowsFile": str(rows_path),
        "rowsSha256": baseline.sha256_file(rows_path),
    }
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), **{key: report[key] for key in ("gamesMapped", "pairedOffers", "joinedOffers", "evaluatedSides", "grades", "releaseGate")}}, indent=2))


if __name__ == "__main__":
    main()
