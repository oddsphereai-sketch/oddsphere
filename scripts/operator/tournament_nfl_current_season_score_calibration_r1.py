#!/usr/bin/env python3
"""Frozen NFL rolling team-score calibration tournament (research only)."""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from collections import defaultdict
from typing import Any

import numpy as np
import pandas as pd


TOURNAMENT_RELEASE = "nfl_current_season_score_calibration_tournament_2026_09_25_r1"
SELECTION_SEASONS = (2021, 2022, 2023)
CONFIRMATION_SEASONS = (2024, 2025)
WEIGHTS = (0.10, 0.20, 0.30, 0.40)
DECAY = 0.92
MAX_GAMES = 24
PRIOR_GAMES = 5.0
ACTION_EDGE = 0.01


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implied(price: np.ndarray | float) -> np.ndarray:
    values = np.asarray(price, dtype=float)
    return np.where(values > 0, 100.0 / (values + 100.0), -values / (-values + 100.0))


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / -price


def load_games(root: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    manifest_path = root / "football-research/cache/nflverse/games.latest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = root / "football-research/cache/nflverse" / str(manifest["filename"])
    if sha256_file(source) != manifest["sha256"]:
        raise RuntimeError("nflverse games checksum mismatch")
    frame = pd.read_csv(source, low_memory=False)
    required = [
        "game_id", "season", "week", "gameday", "gametime", "game_type",
        "away_team", "home_team", "away_score", "home_score", "spread_line",
        "total_line", "away_spread_odds", "home_spread_odds", "over_odds", "under_odds",
    ]
    missing = [column for column in required if column not in frame.columns]
    if missing:
        raise RuntimeError(f"nflverse source missing columns: {missing}")
    frame = frame.loc[
        frame["game_type"].eq("REG")
        & frame["season"].between(2016, 2025)
        & frame[required[7:]].notna().all(axis=1)
    ].copy()
    frame["kickoff"] = pd.to_datetime(
        frame["gameday"].astype(str) + " " + frame["gametime"].fillna("00:00").astype(str),
        errors="coerce", utc=True,
    )
    frame = frame.loc[frame["kickoff"].notna()].sort_values(["kickoff", "game_id"]).reset_index(drop=True)
    frame["actual_margin"] = frame["home_score"] - frame["away_score"]
    frame["actual_total"] = frame["home_score"] + frame["away_score"]
    frame["market_margin"] = frame["spread_line"]
    frame["market_total"] = frame["total_line"]
    return frame, {"manifest": manifest_path.name, **manifest, "verifiedSha256": sha256_file(source)}


def weighted_mean(values: list[float], prior_mean: float) -> float:
    recent = values[-MAX_GAMES:]
    if not recent:
        return prior_mean
    powers = np.arange(len(recent) - 1, -1, -1, dtype=float)
    weights = DECAY ** powers
    return float((np.dot(weights, recent) + PRIOR_GAMES * prior_mean) / (weights.sum() + PRIOR_GAMES))


def add_independent_scores(frame: pd.DataFrame) -> pd.DataFrame:
    points_for: dict[str, list[float]] = defaultdict(list)
    points_against: dict[str, list[float]] = defaultdict(list)
    league_home: list[float] = []
    league_away: list[float] = []
    rows: list[dict[str, Any]] = []
    for kickoff, group in frame.groupby("kickoff", sort=True):
        league_mean = float(np.mean(league_home + league_away)) if league_home else 22.5
        home_base = float(np.mean(league_home[-768:])) if league_home else 23.3
        away_base = float(np.mean(league_away[-768:])) if league_away else 21.7
        pending: list[pd.Series] = []
        for _, game in group.iterrows():
            home = str(game["home_team"])
            away = str(game["away_team"])
            home_off = weighted_mean(points_for[home], league_mean)
            away_off = weighted_mean(points_for[away], league_mean)
            home_def = weighted_mean(points_against[home], league_mean)
            away_def = weighted_mean(points_against[away], league_mean)
            independent_home = float(np.clip(home_base + 0.5 * (home_off - league_mean) + 0.5 * (away_def - league_mean), 8, 42))
            independent_away = float(np.clip(away_base + 0.5 * (away_off - league_mean) + 0.5 * (home_def - league_mean), 8, 42))
            rows.append({
                **game.to_dict(),
                "independent_home": independent_home,
                "independent_away": independent_away,
                "independent_margin": independent_home - independent_away,
                "independent_total": independent_home + independent_away,
            })
            pending.append(game)
        for game in pending:
            home = str(game["home_team"])
            away = str(game["away_team"])
            home_score = float(game["home_score"])
            away_score = float(game["away_score"])
            points_for[home].append(home_score)
            points_against[home].append(away_score)
            points_for[away].append(away_score)
            points_against[away].append(home_score)
            league_home.append(home_score)
            league_away.append(away_score)
    return pd.DataFrame(rows)


def point_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    error = predicted - actual
    return {
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(np.sqrt(np.mean(error * error))),
        "bias": float(np.mean(error)),
    }


def select_weight(frame: pd.DataFrame, market: str) -> tuple[float, list[dict[str, Any]]]:
    selected = frame[frame["season"].isin(SELECTION_SEASONS)]
    actual = selected[f"actual_{market}"].to_numpy(float)
    anchor = selected[f"market_{market}"].to_numpy(float)
    independent = selected[f"independent_{market}"].to_numpy(float)
    rows = []
    for weight in WEIGHTS:
        predicted = anchor + weight * (independent - anchor)
        rows.append({"weight": weight, **point_metrics(actual, predicted)})
    rows.sort(key=lambda row: (row["mae"], row["rmse"], row["weight"]))
    return float(rows[0]["weight"]), rows


def empirical_positive_probability(predicted: np.ndarray, line: np.ndarray, residuals: np.ndarray) -> np.ndarray:
    samples = predicted[:, None] + residuals[None, :]
    positive = np.sum(samples > line[:, None], axis=1)
    negative = np.sum(samples < line[:, None], axis=1)
    return positive / np.maximum(positive + negative, 1)


def probability_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(outcome)),
        "accuracy": float(np.mean((probability >= 0.5) == outcome)),
        "brier": float(np.mean((probability - outcome) ** 2)),
    }


def action_summary(rows: pd.DataFrame, probability: np.ndarray, fair: np.ndarray, outcome: np.ndarray, market: str) -> dict[str, Any]:
    first = probability - fair >= ACTION_EDGE
    second = fair - probability >= ACTION_EDGE
    selected = first | second
    records: list[dict[str, Any]] = []
    first_price = "home_spread_odds" if market == "margin" else "over_odds"
    second_price = "away_spread_odds" if market == "margin" else "under_odds"
    for index in np.where(selected)[0]:
        choose_first = bool(first[index])
        won = bool(outcome[index]) if choose_first else not bool(outcome[index])
        price = float(rows.iloc[index][first_price if choose_first else second_price])
        records.append({
            "season": int(rows.iloc[index]["season"]),
            "first": choose_first,
            "won": won,
            "units": profit_one(price) if won else -1.0,
        })

    def summarize(values: list[dict[str, Any]]) -> dict[str, Any]:
        wins = sum(bool(row["won"]) for row in values)
        units = float(sum(float(row["units"]) for row in values))
        return {
            "resolved": len(values), "wins": wins, "losses": len(values) - wins,
            "accuracy": wins / len(values) if values else None,
            "units": units, "roiPerUnitRisked": units / len(values) if values else None,
        }

    return {
        "minimumEdge": ACTION_EDGE,
        "directions": {"first": int(first.sum()), "second": int(second.sum())},
        "pooled": summarize(records),
        "bySeason": {str(season): summarize([row for row in records if row["season"] == season]) for season in CONFIRMATION_SEASONS},
    }


def evaluate_market(frame: pd.DataFrame, market: str, weight: float) -> dict[str, Any]:
    confirmation = frame[frame["season"].isin(CONFIRMATION_SEASONS)].reset_index(drop=True)
    actual = confirmation[f"actual_{market}"].to_numpy(float)
    anchor = confirmation[f"market_{market}"].to_numpy(float)
    independent = confirmation[f"independent_{market}"].to_numpy(float)
    candidate = anchor + weight * (independent - anchor)
    push = actual == anchor
    resolved = ~push
    observed = (actual[resolved] > anchor[resolved]).astype(int)
    candidate_probability = np.empty(int(resolved.sum()), dtype=float)
    offset = 0
    for season in CONFIRMATION_SEASONS:
        season_mask = confirmation["season"].eq(season).to_numpy() & resolved
        history = frame[frame["season"].lt(season)]
        historical_candidate = history[f"market_{market}"].to_numpy(float) + weight * (
            history[f"independent_{market}"].to_numpy(float) - history[f"market_{market}"].to_numpy(float)
        )
        residuals = history[f"actual_{market}"].to_numpy(float) - historical_candidate
        count = int(season_mask.sum())
        candidate_probability[offset:offset + count] = empirical_positive_probability(
            candidate[season_mask], anchor[season_mask], residuals
        )
        offset += count
    resolved_rows = confirmation.loc[resolved].reset_index(drop=True)
    if market == "margin":
        first_raw = implied(resolved_rows["home_spread_odds"].to_numpy(float))
        second_raw = implied(resolved_rows["away_spread_odds"].to_numpy(float))
    else:
        first_raw = implied(resolved_rows["over_odds"].to_numpy(float))
        second_raw = implied(resolved_rows["under_odds"].to_numpy(float))
    fair = first_raw / (first_raw + second_raw)
    by_season: dict[str, Any] = {}
    cursor = 0
    for season in CONFIRMATION_SEASONS:
        keep_all = confirmation["season"].eq(season).to_numpy()
        keep_resolved = resolved_rows["season"].eq(season).to_numpy()
        count = int(keep_resolved.sum())
        season_probability = candidate_probability[cursor:cursor + count]
        season_observed = observed[cursor:cursor + count]
        by_season[str(season)] = {
            "candidatePoint": point_metrics(actual[keep_all], candidate[keep_all]),
            "marketPoint": point_metrics(actual[keep_all], anchor[keep_all]),
            "candidateProbability": probability_metrics(season_probability, season_observed),
            "marketProbability": probability_metrics(fair[keep_resolved], season_observed),
            "directions": {"first": int(np.sum(season_probability >= 0.5)), "second": int(np.sum(season_probability < 0.5))},
        }
        cursor += count
    candidate_metrics = probability_metrics(candidate_probability, observed)
    market_metrics = probability_metrics(fair, observed)
    candidate_point = point_metrics(actual, candidate)
    market_point = point_metrics(actual, anchor)
    actions = action_summary(resolved_rows, candidate_probability, fair, observed, market)
    gates = {
        "pooledPointMaeImproves": candidate_point["mae"] < market_point["mae"],
        "seasonPointMaeBounded": all(row["candidatePoint"]["mae"] <= row["marketPoint"]["mae"] + 0.10 for row in by_season.values()),
        "pooledAccuracyAboveHalf": candidate_metrics["accuracy"] > 0.5,
        "seasonAccuracyAtLeast48": all(row["candidateProbability"]["accuracy"] >= 0.48 for row in by_season.values()),
        "bothDirectionsEachSeason": all(row["directions"]["first"] > 0 and row["directions"]["second"] > 0 for row in by_season.values()),
        "pooledBrierBounded": candidate_metrics["brier"] <= market_metrics["brier"] + 0.001,
        "seasonBrierBounded": all(row["candidateProbability"]["brier"] <= row["marketProbability"]["brier"] + 0.0025 for row in by_season.values()),
        "atLeastThirtyActions": actions["pooled"]["resolved"] >= 30,
        "actionAccuracyAtLeastHalf": actions["pooled"]["accuracy"] is not None and actions["pooled"]["accuracy"] >= 0.5,
        "positiveActionUnits": actions["pooled"]["units"] > 0,
        "seasonActionRoiBounded": all(row["roiPerUnitRisked"] is not None and row["roiPerUnitRisked"] >= -0.05 for row in actions["bySeason"].values()),
        "bothActionDirections": actions["directions"]["first"] > 0 and actions["directions"]["second"] > 0,
    }
    gates["historicalConfirmationPassed"] = all(gates.values())
    return {
        "selectedWeight": weight,
        "candidatePoint": candidate_point,
        "marketPoint": market_point,
        "candidateProbability": candidate_metrics,
        "marketProbability": market_metrics,
        "bySeason": by_season,
        "actions": actions,
        "gates": gates,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    frame, source = load_games(root)
    frame = add_independent_scores(frame)
    margin_weight, margin_selection = select_weight(frame, "margin")
    total_weight, total_selection = select_weight(frame, "total")
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-09-25-nfl-current-season-score-calibration-predeclaration.md",
        "localOnly": True,
        "productionBehaviorChanged": False,
        "source": source,
        "selectionSeasons": SELECTION_SEASONS,
        "confirmationSeasons": CONFIRMATION_SEASONS,
        "selection": {"margin": margin_selection, "total": total_selection},
        "confirmation": {
            "margin": evaluate_market(frame, "margin", margin_weight),
            "total": evaluate_market(frame, "total", total_weight),
        },
    }
    report["historicalConfirmationPassed"] = all(
        report["confirmation"][market]["gates"]["historicalConfirmationPassed"]
        for market in ("margin", "total")
    )
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "selectedWeights": {"margin": margin_weight, "total": total_weight},
        "confirmation": report["confirmation"],
        "historicalConfirmationPassed": report["historicalConfirmationPassed"],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
