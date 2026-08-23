#!/usr/bin/env python3
"""Frozen NFL r10 discrete possession/scoring-event distribution tournament."""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import time
from dataclasses import dataclass
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy.optimize import root
from scipy.signal import fftconvolve


TOURNAMENT_RELEASE = "nfl_discrete_drive_joint_2026_08_23_r10"
DISTRIBUTION_RELEASE = "nfl_discrete_drive_score_distribution_2026_08_23_r5"
ARTIFACT_RELEASE = "nfl_week_one_discrete_joint_artifact_2026_08_23_r5"
TRAINING_SEASONS = tuple(range(2016, 2023))
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
STACK_COMPONENTS = (
    "balanced__gbr_huber",
    "balanced__hist_7",
    "hierarchical__extra_trees",
    "hierarchical__ridge_300",
    "balanced__poisson_10",
    "baseline_rolling__ridge_300",
)
MARGIN_WEIGHTS = np.asarray([
    0.0, 0.04781762715004898, 0.6252962237179801,
    0.22585630535373197, 0.0, 0.10102984377823881,
])
TOTAL_WEIGHTS = np.asarray([
    0.1766418118432228, 0.0, 0.0,
    0.4055128228811788, 0.0, 0.41784536527559807,
])
ENVIRONMENT_SIGMA = 0.0
EVENT_CONCENTRATION = 1.0
REPRESENTATIVE_SCORE_WEIGHTS = (0.0, 0.05, 0.10, 0.20, 0.40)
R9_REPRESENTATIVE_WEIGHT = 0.05
SELECTION_MAE_TOLERANCE = 0.05
CONFIRMATION_MAE_TOLERANCE = 0.15
ENVIRONMENT_STATES = (-1.0, 0.0, 1.0)
ENVIRONMENT_WEIGHTS = (0.2, 0.6, 0.2)
TAIL_EPSILON = 1e-12


@dataclass(frozen=True)
class DriveLaw:
    events: tuple[tuple[int, int, float], ...]
    count_pairs: tuple[tuple[int, int, float], ...]


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cache_root() -> pathlib.Path:
    return pathlib.Path(os.environ.get(
        "NFL_RESEARCH_CACHE_ROOT",
        "/private/tmp/oddsphere-football-research-recovery-20260821/cache",
    )).resolve()


def load_pbp(season: int) -> pd.DataFrame:
    path = cache_root() / f"nflverse/real-model-r1/pbp/{season}.parquet"
    columns = [
        "game_id", "home_team", "away_team", "fixed_drive", "posteam", "defteam",
        "td_team", "touchdown", "field_goal_result", "extra_point_result",
        "two_point_conv_result", "safety", "defensive_two_point_conv",
        "play_type", "desc", "home_score", "away_score",
        "total_home_score", "total_away_score",
    ]
    return pd.read_parquet(path, columns=columns)


def scoring_points(row: pd.Series) -> list[tuple[str, int]]:
    points: list[tuple[str, int]] = []
    touchdown = float(row.get("touchdown") or 0.0) == 1.0
    if touchdown and isinstance(row.get("td_team"), str):
        points.append((str(row["td_team"]), 6))
    if str(row.get("field_goal_result") or "").lower() == "made" and isinstance(row.get("posteam"), str):
        points.append((str(row["posteam"]), 3))
    if str(row.get("extra_point_result") or "").lower() == "good" and isinstance(row.get("posteam"), str):
        points.append((str(row["posteam"]), 1))
    if str(row.get("two_point_conv_result") or "").lower() == "success" and isinstance(row.get("posteam"), str):
        points.append((str(row["posteam"]), 2))
    if float(row.get("safety") or 0.0) == 1.0 and isinstance(row.get("defteam"), str):
        points.append((str(row["defteam"]), 2))
    if float(row.get("defensive_two_point_conv") or 0.0) == 1.0 and isinstance(row.get("defteam"), str):
        points.append((str(row["defteam"]), 2))
    return points


def extract_drive_events(seasons: tuple[int, ...]) -> tuple[pd.DataFrame, dict[str, Any]]:
    drives: list[dict[str, Any]] = []
    reconstruction: list[dict[str, Any]] = []
    for season in seasons:
        frame = load_pbp(season)
        frame["home_points_delta"] = (
            frame.groupby("game_id", sort=False)["total_home_score"]
            .diff()
            .fillna(frame["total_home_score"])
            .clip(lower=0)
        )
        frame["away_points_delta"] = (
            frame.groupby("game_id", sort=False)["total_away_score"]
            .diff()
            .fillna(frame["total_away_score"])
            .clip(lower=0)
        )
        valid = frame[
            frame["fixed_drive"].notna()
            & frame["game_id"].notna()
        ].copy()
        game_points: dict[str, dict[str, int]] = {}
        for (game_id, fixed_drive), group in valid.groupby(["game_id", "fixed_drive"], sort=False):
            posteams = group["posteam"].dropna().astype(str)
            if posteams.empty:
                continue
            offense = posteams.iloc[0]
            home = str(group["home_team"].dropna().iloc[0])
            away = str(group["away_team"].dropna().iloc[0])
            if offense not in {home, away}:
                continue
            defense = away if offense == home else home
            home_points = int(round(float(group["home_points_delta"].sum())))
            away_points = int(round(float(group["away_points_delta"].sum())))
            owned = {
                home: home_points,
                away: away_points,
            }
            game_points.setdefault(str(game_id), {}).setdefault(home, 0)
            game_points.setdefault(str(game_id), {}).setdefault(away, 0)
            game_points[str(game_id)][home] += home_points
            game_points[str(game_id)][away] += away_points
            drives.append({
                "season": season,
                "game_id": str(game_id),
                "home_team": home,
                "away_team": away,
                "offense": offense,
                "defense": defense,
                "offense_points": owned[offense],
                "defense_points": owned[defense],
            })
        for game_id, group in frame.groupby("game_id", sort=False):
            home = str(group["home_team"].dropna().iloc[0])
            away = str(group["away_team"].dropna().iloc[0])
            expected_home = int(float(group["total_home_score"].dropna().iloc[-1]))
            expected_away = int(float(group["total_away_score"].dropna().iloc[-1]))
            actual = game_points.get(str(game_id), {})
            reconstruction.append({
                "season": season,
                "game_id": str(game_id),
                "home_expected": expected_home,
                "away_expected": expected_away,
                "home_reconstructed": actual.get(home, 0),
                "away_reconstructed": actual.get(away, 0),
            })
    drive_frame = pd.DataFrame(drives)
    check = pd.DataFrame(reconstruction)
    check["exact"] = (
        check["home_expected"].eq(check["home_reconstructed"])
        & check["away_expected"].eq(check["away_reconstructed"])
    )
    return drive_frame, {
        "games": int(len(check)),
        "exactGames": int(check["exact"].sum()),
        "exactRate": float(check["exact"].mean()),
        "failures": check.loc[~check["exact"]].head(20).to_dict("records"),
    }


def fit_drive_law(drives: pd.DataFrame) -> DriveLaw:
    events = drives.groupby(["offense_points", "defense_points"]).size().sort_values(ascending=False)
    event_rows = tuple(
        (int(offense), int(defense), float(count / events.sum()))
        for (offense, defense), count in events.items()
    )
    counts = drives.groupby(["game_id", "home_team", "away_team", "offense"]).size().rename("drives").reset_index()
    counts["side"] = np.where(counts["offense"].eq(counts["home_team"]), "home", "away")
    pairs = counts.pivot_table(index="game_id", columns="side", values="drives", aggfunc="first").dropna()
    distribution = pairs.groupby(["home", "away"]).size().sort_values(ascending=False)
    rows: list[tuple[int, int, float]] = []
    cumulative = 0.0
    for (home_count, away_count), count in distribution.items():
        weight = float(count / distribution.sum())
        rows.append((int(home_count), int(away_count), weight))
        cumulative += weight
        if cumulative >= 0.9975 and len(rows) >= 20:
            break
    total = sum(row[2] for row in rows)
    return DriveLaw(events=event_rows, count_pairs=tuple((h, a, w / total) for h, a, w in rows))


def tilted_event_law(
    events: tuple[tuple[int, int, float], ...],
    theta: float,
    concentration: float,
) -> tuple[tuple[int, int, float], ...]:
    logits = np.asarray([
        concentration * math.log(weight) + theta * offense
        for offense, _, weight in events
    ], dtype=float)
    logits -= float(logits.max())
    weights = np.exp(logits)
    weights /= weights.sum()
    return tuple((events[index][0], events[index][1], float(weight)) for index, weight in enumerate(weights))


def moments(events: tuple[tuple[int, int, float], ...]) -> tuple[float, float]:
    return (
        sum(offense * weight for offense, _, weight in events),
        sum(defense * weight for _, defense, weight in events),
    )


def solve_tilts(
    law: DriveLaw,
    home_mean: float,
    away_mean: float,
    environment_sigma: float,
    concentration: float,
) -> tuple[float, float]:
    def equations(values: np.ndarray) -> np.ndarray:
        home_total = 0.0
        away_total = 0.0
        for state, state_weight in zip(ENVIRONMENT_STATES, ENVIRONMENT_WEIGHTS, strict=True):
            home_law = tilted_event_law(law.events, float(values[0]) + environment_sigma * state, concentration)
            away_law = tilted_event_law(law.events, float(values[1]) + environment_sigma * state, concentration)
            home_for, home_against = moments(home_law)
            away_for, away_against = moments(away_law)
            for home_drives, away_drives, count_weight in law.count_pairs:
                weight = state_weight * count_weight
                home_total += weight * (home_drives * home_for + away_drives * away_against)
                away_total += weight * (away_drives * away_for + home_drives * home_against)
        return np.asarray([home_total - home_mean, away_total - away_mean])
    fitted = root(equations, np.zeros(2), method="hybr")
    if not fitted.success or np.max(np.abs(equations(fitted.x))) > 1e-6:
        raise RuntimeError(f"score-event tilt solve failed: {fitted.message}")
    return float(fitted.x[0]), float(fitted.x[1])


def drive_pmf(events: tuple[tuple[int, int, float], ...]) -> np.ndarray:
    size = max(max(offense, defense) for offense, defense, _ in events) + 1
    result = np.zeros((size, size), dtype=float)
    for offense, defense, weight in events:
        result[offense, defense] += weight
    return result


def power_convolve(base: np.ndarray, count: int) -> np.ndarray:
    result = np.ones((1, 1), dtype=float)
    for _ in range(count):
        result = fftconvolve(result, base)
        result[result < TAIL_EPSILON] = 0.0
    result /= result.sum()
    return result


def power_convolve_cache(base: np.ndarray, counts: set[int]) -> dict[int, np.ndarray]:
    cache: dict[int, np.ndarray] = {}
    result = np.ones((1, 1), dtype=float)
    for count in range(1, max(counts) + 1):
        result = fftconvolve(result, base)
        result[result < TAIL_EPSILON] = 0.0
        result /= result.sum()
        if count in counts:
            cache[count] = result.copy()
    return cache


def joint_pmf(
    law: DriveLaw,
    home_mean: float,
    away_mean: float,
    environment_sigma: float,
    concentration: float,
) -> np.ndarray:
    home_theta, away_theta = solve_tilts(law, home_mean, away_mean, environment_sigma, concentration)
    components: list[tuple[float, np.ndarray]] = []
    max_home = max_away = 0
    for state, state_weight in zip(ENVIRONMENT_STATES, ENVIRONMENT_WEIGHTS, strict=True):
        home_drive = drive_pmf(tilted_event_law(law.events, home_theta + environment_sigma * state, concentration))
        away_drive = drive_pmf(tilted_event_law(law.events, away_theta + environment_sigma * state, concentration))
        home_cache = power_convolve_cache(home_drive, {pair[0] for pair in law.count_pairs})
        away_cache = power_convolve_cache(away_drive, {pair[1] for pair in law.count_pairs})
        for home_count, away_count, count_weight in law.count_pairs:
            home_scores = home_cache[home_count]
            away_scores = away_cache[away_count]
            # Away drives index away/offense first; transpose into home/away score order.
            combined = fftconvolve(home_scores, away_scores.T)
            combined[combined < TAIL_EPSILON] = 0.0
            components.append((state_weight * count_weight, combined))
            max_home = max(max_home, combined.shape[0])
            max_away = max(max_away, combined.shape[1])
    result = np.zeros((max_home, max_away), dtype=float)
    for weight, component in components:
        result[:component.shape[0], :component.shape[1]] += weight * component
    result[result < TAIL_EPSILON] = 0.0
    result /= result.sum()
    return result


def one_dimensional(pmf: np.ndarray, kind: str) -> tuple[np.ndarray, np.ndarray]:
    home, away = np.indices(pmf.shape)
    values = (home - away if kind == "margin" else home + away).ravel()
    weights = pmf.ravel()
    unique = np.arange(int(values.min()), int(values.max()) + 1)
    result = np.asarray([weights[values == value].sum() for value in unique], dtype=float)
    return unique, result


def central_interval(values: np.ndarray, probabilities: np.ndarray, mass: float) -> tuple[int, int]:
    """Shortest contiguous integer interval containing the requested mass."""
    mean = float(np.sum(values * probabilities))
    cumulative = np.concatenate(([0.0], np.cumsum(probabilities)))
    candidates: list[tuple[tuple[float, float, float, int], tuple[int, int]]] = []
    for lower_index in range(len(values)):
        target = cumulative[lower_index] + mass
        upper_index = int(np.searchsorted(cumulative, target, side="left")) - 1
        if upper_index < lower_index or upper_index >= len(values):
            continue
        captured = float(cumulative[upper_index + 1] - cumulative[lower_index])
        lower = int(values[lower_index])
        upper = int(values[upper_index])
        key = (
            float(upper - lower),
            max(0.0, captured - mass),
            abs((lower + upper) / 2.0 - mean),
            lower,
        )
        candidates.append((key, (lower, upper)))
    if not candidates:
        raise RuntimeError("unable to construct shortest probability interval")
    return min(candidates, key=lambda row: row[0])[1]


def representative_score(pmf: np.ndarray, summary: dict[str, Any], weight: float) -> dict[str, Any]:
    """Choose a supported central score consistent with the PMF winner."""
    home_index, away_index = np.indices(pmf.shape)
    expected_margin = float(summary["expectedHomeScore"] - summary["expectedAwayScore"])
    expected_total = float(summary["expectedHomeScore"] + summary["expectedAwayScore"])
    forecast_home = float(summary["homeWinProbability"]) >= float(summary["awayWinProbability"])
    margin = home_index - away_index
    total = home_index + away_index
    supported = pmf > 0.0
    winner_consistent = margin > 0 if forecast_home else margin < 0
    margin_interval = summary["margin80"]
    total_interval = summary["total80"]
    eligible = (
        supported
        & winner_consistent
        & (margin >= margin_interval[0])
        & (margin <= margin_interval[1])
        & (total >= total_interval[0])
        & (total <= total_interval[1])
    )
    rows, columns = np.where(eligible)
    if len(rows) == 0:
        raise RuntimeError("no supported representative score satisfies the frozen policy")
    ranked: list[tuple[tuple[float, float, float, float, int, int], tuple[int, int]]] = []
    for home_score, away_score in zip(rows.tolist(), columns.tolist(), strict=True):
        probability = float(pmf[home_score, away_score])
        margin_distance = abs((home_score - away_score) - expected_margin)
        total_distance = abs((home_score + away_score) - expected_total)
        objective = -math.log(probability) + weight * (margin_distance + total_distance)
        key = (
            objective,
            margin_distance + total_distance,
            -probability,
            abs(home_score - summary["expectedHomeScore"]) + abs(away_score - summary["expectedAwayScore"]),
            home_score,
            away_score,
        )
        ranked.append((key, (home_score, away_score)))
    _, (home_score, away_score) = min(ranked, key=lambda row: row[0])
    probability = float(pmf[home_score, away_score])
    return {
        "homeScore": int(home_score),
        "awayScore": int(away_score),
        "probability": probability,
        "expectedMargin": expected_margin,
        "expectedTotal": expected_total,
        "marginDistance": abs((home_score - away_score) - expected_margin),
        "totalDistance": abs((home_score + away_score) - expected_total),
        "winnerFidelity": bool((home_score > away_score) == forecast_home),
        "tieContradiction": bool(home_score == away_score),
        "supported": bool(probability > 0.0),
    }


def summarize(pmf: np.ndarray, home_line: float | None = None, total_line: float | None = None) -> dict[str, Any]:
    home_index, away_index = np.indices(pmf.shape)
    home_win = float(pmf[home_index > away_index].sum())
    away_win = float(pmf[away_index > home_index].sum())
    tie = float(pmf[home_index == away_index].sum())
    non_tie = home_win + away_win
    mode = np.unravel_index(int(np.argmax(pmf)), pmf.shape)
    margin_values, margin_pmf = one_dimensional(pmf, "margin")
    total_values, total_pmf = one_dimensional(pmf, "total")
    result: dict[str, Any] = {
        "expectedHomeScore": float((home_index * pmf).sum()),
        "expectedAwayScore": float((away_index * pmf).sum()),
        "modalHomeScore": int(mode[0]),
        "modalAwayScore": int(mode[1]),
        "modalScoreProbability": float(pmf[mode]),
        "homeWinProbability": home_win / non_tie,
        "awayWinProbability": away_win / non_tie,
        "tieProbability": tie,
        "margin80": central_interval(margin_values, margin_pmf, 0.80),
        "total80": central_interval(total_values, total_pmf, 0.80),
        "marginDistribution": {
            "values": [int(value) for value in margin_values.tolist()],
            "probabilities": [float(value) for value in margin_pmf.tolist()],
        },
        "totalDistribution": {
            "values": [int(value) for value in total_values.tolist()],
            "probabilities": [float(value) for value in total_pmf.tolist()],
        },
    }
    if home_line is not None:
        adjusted = home_index + home_line - away_index
        cover = float(pmf[adjusted > 0].sum())
        push = float(pmf[np.isclose(adjusted, 0.0)].sum())
        lose = max(0.0, 1.0 - cover - push)
        result["spread"] = {
            "homeCoverProbability": cover / max(cover + lose, 1e-12),
            "awayCoverProbability": lose / max(cover + lose, 1e-12),
            "pushProbability": push,
        }
    if total_line is not None:
        adjusted = home_index + away_index - total_line
        over = float(pmf[adjusted > 0].sum())
        push = float(pmf[np.isclose(adjusted, 0.0)].sum())
        under = max(0.0, 1.0 - over - push)
        result["total"] = {
            "overProbability": over / max(over + under, 1e-12),
            "underProbability": under / max(over + under, 1e-12),
            "pushProbability": push,
        }
    return result


def ece(outcomes: np.ndarray, probabilities: np.ndarray) -> float:
    bins = np.minimum((np.clip(probabilities, 0.0, 1.0) * 10).astype(int), 9)
    return float(sum(
        abs(float(outcomes[bins == index].mean()) - float(probabilities[bins == index].mean()))
        * float(np.mean(bins == index))
        for index in range(10) if np.any(bins == index)
    ))


def historical_predictions() -> pd.DataFrame:
    feature_path = cache_root() / "nfl-model/nfl_pregame_features_2016_2025_r3.parquet"
    features = pd.read_parquet(feature_path, columns=[
        "game_id", "season", "week", "home_score", "away_score",
        "market_home_margin", "market_total",
    ])
    prediction_path = pathlib.Path(os.environ.get(
        "NFL_R6_BASE_PREDICTIONS_PATH",
        "/private/tmp/oddsphere-nfl-v1-comprehensive-shadow-20260822/football-research/reports/nfl-v1-comprehensive/base_predictions_r1.joblib",
    )).resolve()
    payload = joblib.load(prediction_path)["predictions"]
    base = payload[STACK_COMPONENTS[0]][["game_id", "season", "week"]].copy()
    base["projected_margin"] = sum(
        MARGIN_WEIGHTS[index] * payload[name]["projected_margin"].to_numpy(float)
        for index, name in enumerate(STACK_COMPONENTS)
    )
    base["projected_total"] = sum(
        TOTAL_WEIGHTS[index] * payload[name]["projected_total"].to_numpy(float)
        for index, name in enumerate(STACK_COMPONENTS)
    )
    base["projected_home_score"] = (base["projected_total"] + base["projected_margin"]) / 2.0
    base["projected_away_score"] = (base["projected_total"] - base["projected_margin"]) / 2.0
    return base.merge(features, on=["game_id", "season", "week"], validate="one_to_one")


def evaluate(
    frame: pd.DataFrame,
    law: DriveLaw,
    sigma: float,
    concentration: float,
    season: int,
    representative_weights: tuple[float, ...] = (),
) -> dict[str, Any]:
    sample = frame[frame["season"].eq(season)]
    log_scores: list[float] = []
    probabilities: list[float] = []
    outcomes: list[int] = []
    margin_hits = total_hits = 0
    representative_metrics = {
        weight: {
            "teamAbsoluteErrors": [],
            "exactHits": 0,
            "supported": 0,
            "winnerFidelity": 0,
            "tieContradictions": 0,
            "marginDistances": [],
            "totalDistances": [],
            "pairsByWeek": {},
        }
        for weight in representative_weights
    }
    for row in sample.itertuples(index=False):
        pmf = joint_pmf(law, float(row.projected_home_score), float(row.projected_away_score), sigma, concentration)
        actual_home = int(row.home_score)
        actual_away = int(row.away_score)
        probability = pmf[actual_home, actual_away] if actual_home < pmf.shape[0] and actual_away < pmf.shape[1] else 0.0
        log_scores.append(-math.log(max(float(probability), 1e-15)))
        summary = summarize(pmf)
        probabilities.append(float(summary["homeWinProbability"]))
        outcomes.append(int(actual_home > actual_away))
        margin = actual_home - actual_away
        total = actual_home + actual_away
        margin_hits += int(summary["margin80"][0] <= margin <= summary["margin80"][1])
        total_hits += int(summary["total80"][0] <= total <= summary["total80"][1])
        for weight, metrics in representative_metrics.items():
            representative = representative_score(pmf, summary, weight)
            metrics["teamAbsoluteErrors"].extend([
                abs(representative["homeScore"] - actual_home),
                abs(representative["awayScore"] - actual_away),
            ])
            metrics["exactHits"] += int(
                representative["homeScore"] == actual_home
                and representative["awayScore"] == actual_away
            )
            metrics["supported"] += int(representative["supported"])
            metrics["winnerFidelity"] += int(representative["winnerFidelity"])
            metrics["tieContradictions"] += int(representative["tieContradiction"])
            metrics["marginDistances"].append(representative["marginDistance"])
            metrics["totalDistances"].append(representative["totalDistance"])
            metrics["pairsByWeek"].setdefault(int(row.week), []).append(
                (representative["awayScore"], representative["homeScore"])
            )
    y = np.asarray(outcomes, dtype=float)
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-9, 1 - 1e-9)
    result = {
        "games": int(len(sample)),
        "jointNegativeLogScore": float(np.mean(log_scores)),
        "moneylineBrier": float(np.mean((p - y) ** 2)),
        "moneylineLogLoss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
        "moneylineEce10": ece(y, p),
        "margin80Coverage": margin_hits / len(sample),
        "total80Coverage": total_hits / len(sample),
    }
    if representative_metrics:
        representative_results = {}
        for weight, metrics in representative_metrics.items():
            weekly_duplicate_rates = [
                (len(pairs) - len(set(pairs))) / len(pairs)
                for pairs in metrics["pairsByWeek"].values()
                if pairs
            ]
            all_pairs = [pair for pairs in metrics["pairsByWeek"].values() for pair in pairs]
            representative_results[str(weight)] = {
                "teamScoreMae": float(np.mean(metrics["teamAbsoluteErrors"])),
                "exactScoreHitRate": metrics["exactHits"] / len(sample),
                "supportRate": metrics["supported"] / len(sample),
                "winnerFidelityRate": metrics["winnerFidelity"] / len(sample),
                "tieContradictions": int(metrics["tieContradictions"]),
                "meanMarginCenterDistance": float(np.mean(metrics["marginDistances"])),
                "meanTotalCenterDistance": float(np.mean(metrics["totalDistances"])),
                "meanWeeklyDuplicatedPairRate": float(np.mean(weekly_duplicate_rates)),
                "pooledDuplicatedPairs": int(len(all_pairs) - len(set(all_pairs))),
            }
        result["representativeScores"] = representative_results
    return result


def current_week(law: DriveLaw, sigma: float, concentration: float, representative_weight: float) -> dict[str, Any]:
    outcome_path = pathlib.Path("lib/services/football/modelArtifacts/nflV1WeekOneOutcome.json")
    outcome = json.loads(outcome_path.read_text())
    evidence_path = pathlib.Path(os.environ.get(
        "NFL_FORWARD_EVIDENCE_PATH",
        "/private/tmp/oddsphere-nfl-forward-monitor-20260822/football-research/reports/nfl_forward_evidence_r2_latest.local.json",
    )).resolve()
    evidence = json.loads(evidence_path.read_text())
    evidence_by_game = {str(row["payload"]["game"]["providerGameId"]): row["payload"] for row in evidence["latestRows"]}
    games = []
    for game in outcome["games"]:
        payload = evidence_by_game[str(game["providerGameId"])]
        books = payload["market"]["comparableCurrentBooks"]
        home_lines = [float(book["spread"]["homeLine"]) for book in books if book.get("spread")]
        totals = [float(book["total"]["line"]) for book in books if book.get("total")]
        home_line = float(np.median(home_lines))
        total_line = float(np.median(totals))
        pmf = joint_pmf(law, float(game["projectedHomeScore"]), float(game["projectedAwayScore"]), sigma, concentration)
        summary = summarize(pmf, home_line=home_line, total_line=total_line)
        representative = representative_score(pmf, summary, representative_weight)
        games.append({
            "providerGameId": str(game["providerGameId"]),
            "awayTeam": game["awayTeam"],
            "homeTeam": game["homeTeam"],
            "sourceExpectedAwayScore": game["projectedAwayScore"],
            "sourceExpectedHomeScore": game["projectedHomeScore"],
            "evaluatedHomeSpread": home_line,
            "evaluatedTotal": total_line,
            **summary,
            "representativeScore": representative,
        })
    representative_away = np.asarray([game["representativeScore"]["awayScore"] for game in games], dtype=float)
    representative_home = np.asarray([game["representativeScore"]["homeScore"] for game in games], dtype=float)
    margins = representative_home - representative_away
    totals = representative_home + representative_away
    over_count = sum(game["total"]["overProbability"] > 0.5 for game in games)
    return {
        "games": games,
        "dispersion": {
            "teamScoreSd": float(np.std(np.concatenate([representative_away, representative_home]))),
            "marginSd": float(np.std(margins)),
            "totalSd": float(np.std(totals)),
            "teamScoreRange": [float(min(representative_away.min(), representative_home.min())), float(max(representative_away.max(), representative_home.max()))],
            "marginRange": [float(margins.min()), float(margins.max())],
            "totalRange": [float(totals.min()), float(totals.max())],
            "overDirections": int(over_count),
            "underDirections": int(len(games) - over_count),
            "duplicatedRepresentativePairs": int(len(games) - len(set(zip(representative_away.tolist(), representative_home.tolist(), strict=True)))),
            "winnerFidelityRate": float(np.mean([game["representativeScore"]["winnerFidelity"] for game in games])),
            "tieContradictions": int(sum(game["representativeScore"]["tieContradiction"] for game in games)),
            "meanMarginCenterDistance": float(np.mean([game["representativeScore"]["marginDistance"] for game in games])),
            "meanTotalCenterDistance": float(np.mean([game["representativeScore"]["totalDistance"] for game in games])),
        },
    }


def main() -> None:
    drives, reconstruction = extract_drive_events(TRAINING_SEASONS)
    if reconstruction["exactRate"] != 1.0:
        raise RuntimeError(f"official scoring reconstruction failed: {reconstruction}")
    law = fit_drive_law(drives)
    predictions = historical_predictions()
    selection_metrics = evaluate(
        predictions,
        law,
        ENVIRONMENT_SIGMA,
        EVENT_CONCENTRATION,
        SELECTION_SEASON,
        REPRESENTATIVE_SCORE_WEIGHTS,
    )
    selection = [
        (weight, selection_metrics["representativeScores"][str(weight)])
        for weight in REPRESENTATIVE_SCORE_WEIGHTS
    ]
    best_selection_mae = min(metrics["teamScoreMae"] for _, metrics in selection)
    eligible_selection = [
        row for row in selection
        if row[1]["teamScoreMae"] <= best_selection_mae + SELECTION_MAE_TOLERANCE
        and row[1]["supportRate"] == 1.0
        and row[1]["winnerFidelityRate"] == 1.0
        and row[1]["tieContradictions"] == 0
    ]
    eligible_selection.sort(key=lambda row: (
        row[1]["meanWeeklyDuplicatedPairRate"],
        row[1]["meanMarginCenterDistance"] + row[1]["meanTotalCenterDistance"],
        -row[1]["exactScoreHitRate"],
        row[0],
    ))
    selected_representative_weight = eligible_selection[0][0]
    baseline = {
        str(SELECTION_SEASON): selection_metrics,
    }
    confirmation = {
        str(season): evaluate(
            predictions,
            law,
            ENVIRONMENT_SIGMA,
            EVENT_CONCENTRATION,
            season,
            tuple(sorted(set((selected_representative_weight, R9_REPRESENTATIVE_WEIGHT)))),
        )
        for season in CONFIRMATION_SEASONS
    }
    baseline.update(confirmation)
    representative_gates = {
        str(season): {
            "supportComplete": confirmation[str(season)]["representativeScores"][str(selected_representative_weight)]["supportRate"] == 1.0,
            "winnerFidelityComplete": confirmation[str(season)]["representativeScores"][str(selected_representative_weight)]["winnerFidelityRate"] == 1.0,
            "zeroTieContradictions": confirmation[str(season)]["representativeScores"][str(selected_representative_weight)]["tieContradictions"] == 0,
            "teamScoreMaeWithinTolerance": confirmation[str(season)]["representativeScores"][str(selected_representative_weight)]["teamScoreMae"] <= confirmation[str(season)]["representativeScores"][str(R9_REPRESENTATIVE_WEIGHT)]["teamScoreMae"] + CONFIRMATION_MAE_TOLERANCE,
            "weeklyDuplicateRateNoWorseThanR9": confirmation[str(season)]["representativeScores"][str(selected_representative_weight)]["meanWeeklyDuplicatedPairRate"] <= confirmation[str(season)]["representativeScores"][str(R9_REPRESENTATIVE_WEIGHT)]["meanWeeklyDuplicatedPairRate"],
        }
        for season in CONFIRMATION_SEASONS
    }
    gates = {
        str(season): {
            "finiteExactScoreLog": math.isfinite(confirmation[str(season)]["jointNegativeLogScore"]),
            "logNoWorseThanBaselineByPoint05": confirmation[str(season)]["jointNegativeLogScore"] <= baseline[str(season)]["jointNegativeLogScore"] + 0.05,
            "moneylineBrierBelowNeutral": confirmation[str(season)]["moneylineBrier"] < 0.25,
            "moneylineLogBelowNeutral": confirmation[str(season)]["moneylineLogLoss"] < math.log(2),
            "moneylineEceAtMostTenPercent": confirmation[str(season)]["moneylineEce10"] <= 0.10,
            "margin80CoverageCalibrated": 0.72 <= confirmation[str(season)]["margin80Coverage"] <= 0.88,
            "total80CoverageCalibrated": 0.72 <= confirmation[str(season)]["total80Coverage"] <= 0.88,
        } for season in CONFIRMATION_SEASONS
    }
    week = current_week(law, ENVIRONMENT_SIGMA, EVENT_CONCENTRATION, selected_representative_weight)
    dispersion = week["dispersion"]
    structural = {
        "teamScoreSdAtLeastTwo": dispersion["teamScoreSd"] >= 2.0,
        "marginSdAtLeastThree": dispersion["marginSd"] >= 3.0,
        "totalSdAtLeastTwo": dispersion["totalSd"] >= 2.0,
        "bothTotalDirectionsPresent": dispersion["overDirections"] > 0 and dispersion["underDirections"] > 0,
        "representativeWinnerFidelity": dispersion["winnerFidelityRate"] == 1.0,
        "zeroTieContradictions": dispersion["tieContradictions"] == 0,
        "representativePairsDifferentiated": dispersion["duplicatedRepresentativePairs"] <= 6,
    }
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "distributionRelease": DISTRIBUTION_RELEASE,
        "artifactRelease": ARTIFACT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "frozenChronology": {
            "driveLawTraining": list(TRAINING_SEASONS),
            "environmentSelection": SELECTION_SEASON,
            "confirmation": list(CONFIRMATION_SEASONS),
        },
        "source": {
            "pbpManifestSha256": sha256_file(cache_root() / "nflverse/real-model-r1/manifest.json"),
            "featureSha256": sha256_file(cache_root() / "nfl-model/nfl_pregame_features_2016_2025_r3.parquet"),
        },
        "scoringReconstruction": reconstruction,
        "driveLaw": {
            "events": [{"offense": offense, "defense": defense, "probability": probability} for offense, defense, probability in law.events],
            "countPairs": [{"home": home, "away": away, "probability": probability} for home, away, probability in law.count_pairs],
        },
        "representativeSelectionRanking": [{"representativeWeight": weight, **metrics} for weight, metrics in selection],
        "eligibleRepresentativeSelectionRanking": [{"representativeWeight": weight, **metrics} for weight, metrics in eligible_selection],
        "representativeSelectionMaeTolerance": SELECTION_MAE_TOLERANCE,
        "selectedEnvironmentSigma": ENVIRONMENT_SIGMA,
        "selectedEventConcentration": EVENT_CONCENTRATION,
        "selectedRepresentativeWeight": selected_representative_weight,
        "neutralEventBaseline": baseline,
        "confirmation": confirmation,
        "confirmationGates": gates,
        "representativeConfirmationGates": representative_gates,
        "historicalGatePassed": all(all(values.values()) for values in gates.values()) and all(all(values.values()) for values in representative_gates.values()),
        "currentWeek1": week,
        "currentStructuralGates": structural,
        "currentStructuralGatePassed": all(structural.values()),
    }
    report["qualified"] = report["historicalGatePassed"] and report["currentStructuralGatePassed"]
    output = pathlib.Path("football-research/reports/nfl_discrete_drive_joint_2026_08_23_r10.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "report": str(output),
        "selectedEnvironmentSigma": ENVIRONMENT_SIGMA,
        "selectedEventConcentration": EVENT_CONCENTRATION,
        "selectedRepresentativeWeight": selected_representative_weight,
        "historicalGatePassed": report["historicalGatePassed"],
        "currentStructuralGatePassed": report["currentStructuralGatePassed"],
        "qualified": report["qualified"],
        "dispersion": dispersion,
    }, indent=2))


if __name__ == "__main__":
    main()
