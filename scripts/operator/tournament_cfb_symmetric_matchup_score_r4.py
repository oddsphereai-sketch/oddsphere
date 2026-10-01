#!/usr/bin/env python3
"""Research-only CFB symmetric matchup score tournament.

The independent feature matrix excludes all market fields.  Betting lines are
used only after prediction to score Spread and Total direction.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet, Ridge
from sklearn.metrics import brier_score_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from tournament_cfb_v1_model import (
    META_COLUMNS,
    build_dataset,
    probability_rows,
    read_sources,
)


RELEASE = "cfb_symmetric_matchup_score_tournament_2026_09_30_r4"
TEST_SEASONS = (2023, 2024, 2025)
CURRENT_SEASON = 2026
FAMILIES = ("ridge", "elastic_net", "hist_gradient_boosting", "extra_trees")
BLENDS = (0.0, 0.25, 0.5, 0.75, 1.0)
MATCHUP_KEYS = (
    "points_for", "points_against", "margin", "total", "epa_play",
    "pass_epa", "rush_epa", "explosive", "success", "early_epa",
    "early_success", "red_zone_success", "third_success", "pace",
    "drives", "yards_drive", "field_position", "line_yards", "stuff_rate",
    "opportunity_rate", "special_teams_epa", "penalty_yards",
    "expected_turnovers", "turnover_luck", "qb_epa", "qb_success",
)
PERSONNEL_KEYS = ("roster_continuity", "roster_experience", "returning_qb")


def model_families(seed: int) -> dict[str, Pipeline]:
    def linear(model: Any) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", model),
        ])

    return {
        "ridge": linear(Ridge(alpha=36.0)),
        "elastic_net": linear(ElasticNet(
            alpha=0.055,
            l1_ratio=0.12,
            max_iter=30000,
            random_state=seed,
        )),
        "hist_gradient_boosting": Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("model", HistGradientBoostingRegressor(
                max_iter=260,
                learning_rate=0.035,
                max_leaf_nodes=12,
                min_samples_leaf=45,
                l2_regularization=9.0,
                random_state=seed,
            )),
        ]),
        "extra_trees": Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("model", ExtraTreesRegressor(
                n_estimators=360,
                min_samples_leaf=18,
                max_features=0.65,
                n_jobs=1,
                random_state=seed,
            )),
        ]),
    }


def append_current_sources(
    frames: dict[str, pd.DataFrame], current_root: Path
) -> dict[str, pd.DataFrame]:
    output = {key: value.copy() for key, value in frames.items()}
    for dataset in (
        "adv_team", "adv_situational", "adv_drives", "adv_turnover",
        "adv_passing", "schedules",
    ):
        path = current_root / f"{dataset}_{CURRENT_SEASON}.parquet"
        if not path.exists():
            raise FileNotFoundError(path)
        current = pd.read_parquet(path)
        current["season"] = CURRENT_SEASON
        output[dataset] = pd.concat([output[dataset], current], ignore_index=True)
    return output


def finite_column(frame: pd.DataFrame, name: str) -> np.ndarray:
    if name not in frame:
        return np.full(len(frame), np.nan)
    return pd.to_numeric(frame[name], errors="coerce").to_numpy(float)


def matchup_side(frame: pd.DataFrame, key: str, home: bool) -> np.ndarray:
    diff = finite_column(frame, f"matchup_{key}_diff")
    total = finite_column(frame, f"matchup_{key}_sum")
    return 0.5 * (total + diff if home else total - diff)


def team_rows(frame: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    blocks: list[pd.DataFrame] = []
    targets: list[np.ndarray] = []
    game_indexes: list[np.ndarray] = []
    for home in (True, False):
        values: dict[str, np.ndarray] = {
            "venue_side": finite_column(frame, "home_field") * (1.0 if home else -1.0),
            "neutral": finite_column(frame, "neutral"),
            "elo_advantage": finite_column(frame, "elo_diff") * (1.0 if home else -1.0),
            "rest_advantage": finite_column(frame, "rest_diff") * (1.0 if home else -1.0),
            "team_prior_games": finite_column(frame, "home_prior_games" if home else "away_prior_games"),
            "opponent_prior_games": finite_column(frame, "away_prior_games" if home else "home_prior_games"),
            "team_current_games": finite_column(frame, "home_current_games" if home else "away_current_games"),
            "opponent_current_games": finite_column(frame, "away_current_games" if home else "home_current_games"),
        }
        for key in MATCHUP_KEYS:
            team = finite_column(frame, f"{'home' if home else 'away'}_{key}")
            opponent = finite_column(frame, f"{'away' if home else 'home'}_{key}")
            matchup = matchup_side(frame, key, home)
            values[f"team_{key}"] = team
            values[f"opponent_{key}"] = opponent
            values[f"opponent_defense_{key}"] = matchup - team
            values[f"matchup_{key}"] = matchup
        for key in PERSONNEL_KEYS:
            team = finite_column(frame, f"{key}_{'sum'}")
            diff = finite_column(frame, f"{key}_{'diff'}")
            values[f"team_{key}"] = 0.5 * (team + diff if home else team - diff)
            values[f"opponent_{key}"] = 0.5 * (team - diff if home else team + diff)
        # Explicit football interactions keep the linear candidates meaningful;
        # tree candidates remain free to learn non-linear versions.
        values["pass_qb_matchup"] = values["matchup_pass_epa"] + values["matchup_qb_epa"]
        values["rush_trench_matchup"] = (
            values["matchup_rush_epa"] + values["matchup_line_yards"]
            - values["matchup_stuff_rate"]
        )
        values["scoring_opportunity_matchup"] = (
            values["matchup_drives"] + values["matchup_field_position"]
            + values["matchup_red_zone_success"]
        )
        blocks.append(pd.DataFrame(values))
        targets.append(finite_column(frame, "home_score" if home else "away_score"))
        game_indexes.append(np.arange(len(frame)))
    return (
        pd.concat(blocks, ignore_index=True),
        np.concatenate(targets),
        np.concatenate(game_indexes),
    )


def direct_features(frame: pd.DataFrame, target: str) -> pd.DataFrame:
    if target not in ("margin", "total"):
        raise ValueError(target)
    suffix = "diff" if target == "margin" else "sum"
    values: dict[str, np.ndarray] = {
        "neutral": finite_column(frame, "neutral"),
        "home_field": finite_column(frame, "home_field"),
        "elo": finite_column(frame, "elo_diff" if target == "margin" else "elo_sum_strength"),
        "rest": finite_column(frame, "rest_diff") if target == "margin" else np.abs(finite_column(frame, "rest_diff")),
        "home_prior_games": finite_column(frame, "home_prior_games"),
        "away_prior_games": finite_column(frame, "away_prior_games"),
        "home_current_games": finite_column(frame, "home_current_games"),
        "away_current_games": finite_column(frame, "away_current_games"),
    }
    for key in MATCHUP_KEYS:
        values[f"matchup_{key}_{suffix}"] = finite_column(frame, f"matchup_{key}_{suffix}")
        values[f"raw_{key}_{suffix}"] = finite_column(frame, f"{key}_{suffix}")
    for key in PERSONNEL_KEYS:
        values[f"{key}_{suffix}"] = finite_column(frame, f"{key}_{suffix}")
    if target == "margin":
        values["pass_qb_matchup_diff"] = (
            values["matchup_pass_epa_diff"] + values["matchup_qb_epa_diff"]
        )
        values["rush_trench_matchup_diff"] = (
            values["matchup_rush_epa_diff"] + values["matchup_line_yards_diff"]
            - values["matchup_stuff_rate_diff"]
        )
    else:
        values["pass_qb_matchup_sum"] = (
            values["matchup_pass_epa_sum"] + values["matchup_qb_epa_sum"]
        )
        values["rush_trench_matchup_sum"] = (
            values["matchup_rush_epa_sum"] + values["matchup_line_yards_sum"]
            - values["matchup_stuff_rate_sum"]
        )
    return pd.DataFrame(values)


def affine_calibration(
    predicted: np.ndarray,
    actual: np.ndarray,
    minimum_slope: float = 0.70,
    maximum_slope: float = 2.25,
) -> tuple[float, float]:
    valid = np.isfinite(predicted) & np.isfinite(actual)
    if valid.sum() < 200 or float(np.std(predicted[valid])) < 1e-6:
        return 1.0, 0.0
    slope, _ = np.polyfit(predicted[valid], actual[valid], 1)
    bounded_slope = float(np.clip(slope, minimum_slope, maximum_slope))
    intercept = float(np.mean(actual[valid]) - bounded_slope * np.mean(predicted[valid]))
    return bounded_slope, intercept


def apply_affine(values: np.ndarray, calibration: tuple[float, float]) -> np.ndarray:
    return values * calibration[0] + calibration[1]


def outcome_metrics(
    frame: pd.DataFrame,
    home: np.ndarray,
    away: np.ndarray,
    probability: np.ndarray,
) -> dict[str, Any]:
    actual_home = finite_column(frame, "home_score")
    actual_away = finite_column(frame, "away_score")
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    margin = home - away
    total = home + away
    winner = actual_margin > 0
    value: dict[str, Any] = {
        "games": int(len(frame)),
        "teamScoreMae": float(np.mean(np.abs(np.concatenate([home - actual_home, away - actual_away])))),
        "marginMae": float(np.mean(np.abs(margin - actual_margin))),
        "totalMae": float(np.mean(np.abs(total - actual_total))),
        "moneylineAccuracy": float(np.mean((probability >= 0.5) == winner)),
        "moneylineBrier": float(brier_score_loss(winner.astype(float), np.clip(probability, 1e-4, 1 - 1e-4))),
        "predictedTeamScoreSd": float(np.std(np.concatenate([home, away]))),
        "actualTeamScoreSd": float(np.std(np.concatenate([actual_home, actual_away]))),
        "predictedMarginSd": float(np.std(margin)),
        "actualMarginSd": float(np.std(actual_margin)),
        "predictedTotalSd": float(np.std(total)),
        "actualTotalSd": float(np.std(actual_total)),
    }
    spread_mask = frame.home_spread.notna().to_numpy()
    total_mask = frame.market_total.notna().to_numpy()
    spread_actual = actual_margin[spread_mask] + finite_column(frame, "home_spread")[spread_mask]
    total_actual = actual_total[total_mask] - finite_column(frame, "market_total")[total_mask]
    spread_push = spread_actual == 0
    total_push = total_actual == 0
    spread_wins = ((margin[spread_mask] + finite_column(frame, "home_spread")[spread_mask] > 0) == (spread_actual > 0))[~spread_push]
    total_wins = ((total[total_mask] - finite_column(frame, "market_total")[total_mask] > 0) == (total_actual > 0))[~total_push]
    value["spread"] = {
        "decided": int(len(spread_wins)),
        "accuracy": float(np.mean(spread_wins)) if len(spread_wins) else None,
    }
    value["total"] = {
        "decided": int(len(total_wins)),
        "accuracy": float(np.mean(total_wins)) if len(total_wins) else None,
    }
    return value


def train_predictions(
    data: pd.DataFrame,
    season: int,
    seed: int,
    rolling_calibration: bool = False,
) -> tuple[pd.DataFrame, dict[str, dict[str, np.ndarray]], dict[str, np.ndarray]]:
    train = data[data.season < season].reset_index(drop=True)
    test = data[data.season == season].reset_index(drop=True)
    if len(train) < 1_500 or len(test) < 200:
        raise RuntimeError(f"insufficient rolling-origin rows for {season}: {len(train)} / {len(test)}")

    train_team, train_score, _ = team_rows(train)
    test_team, _, test_game_index = team_rows(test)
    train_margin = finite_column(train, "home_score") - finite_column(train, "away_score")
    train_total = finite_column(train, "home_score") + finite_column(train, "away_score")
    train_margin_x = direct_features(train, "margin")
    test_margin_x = direct_features(test, "margin")
    train_total_x = direct_features(train, "total")
    test_total_x = direct_features(test, "total")

    if rolling_calibration:
        calibration_season = season - 1
        calibration_fit = data[data.season < calibration_season].reset_index(drop=True)
        calibration = data[data.season == calibration_season].reset_index(drop=True)
        if len(calibration_fit) < 700 or len(calibration) < 200:
            raise RuntimeError(
                f"insufficient rolling calibration rows for {season}: "
                f"{len(calibration_fit)} / {len(calibration)}"
            )
        calibration_fit_team, calibration_fit_score, _ = team_rows(calibration_fit)
        calibration_team, _, _ = team_rows(calibration)
        calibration_margin_x = direct_features(calibration, "margin")
        calibration_total_x = direct_features(calibration, "total")
        calibration_fit_margin_x = direct_features(calibration_fit, "margin")
        calibration_fit_total_x = direct_features(calibration_fit, "total")
        calibration_fit_margin = (
            finite_column(calibration_fit, "home_score")
            - finite_column(calibration_fit, "away_score")
        )
        calibration_fit_total = (
            finite_column(calibration_fit, "home_score")
            + finite_column(calibration_fit, "away_score")
        )
        calibration_actual_margin = (
            finite_column(calibration, "home_score")
            - finite_column(calibration, "away_score")
        )
        calibration_actual_total = (
            finite_column(calibration, "home_score")
            + finite_column(calibration, "away_score")
        )

    predictions: dict[str, dict[str, np.ndarray]] = {}
    for family in FAMILIES:
        if rolling_calibration:
            calibration_score_model = model_families(seed + 501)[family]
            calibration_margin_model = model_families(seed + 601)[family]
            calibration_total_model = model_families(seed + 701)[family]
            calibration_score_model.fit(calibration_fit_team, calibration_fit_score)
            calibration_margin_model.fit(calibration_fit_margin_x, calibration_fit_margin)
            calibration_total_model.fit(calibration_fit_total_x, calibration_fit_total)
            calibration_score_prediction = calibration_score_model.predict(calibration_team)
            calibration_n = len(calibration)
            calibration_shared_margin = (
                calibration_score_prediction[:calibration_n]
                - calibration_score_prediction[calibration_n:]
            )
            calibration_shared_total = (
                calibration_score_prediction[:calibration_n]
                + calibration_score_prediction[calibration_n:]
            )
            shared_margin_calibration = affine_calibration(
                calibration_shared_margin, calibration_actual_margin
            )
            shared_total_calibration = affine_calibration(
                calibration_shared_total, calibration_actual_total
            )
            direct_margin_calibration = affine_calibration(
                calibration_margin_model.predict(calibration_margin_x),
                calibration_actual_margin,
            )
            direct_total_calibration = affine_calibration(
                calibration_total_model.predict(calibration_total_x),
                calibration_actual_total,
            )
        else:
            shared_margin_calibration = (1.0, 0.0)
            shared_total_calibration = (1.0, 0.0)
            direct_margin_calibration = (1.0, 0.0)
            direct_total_calibration = (1.0, 0.0)

        score_model = model_families(seed)[family]
        margin_model = model_families(seed + 101)[family]
        total_model = model_families(seed + 202)[family]
        score_model.fit(train_team, train_score)
        margin_model.fit(train_margin_x, train_margin)
        total_model.fit(train_total_x, train_total)
        score_prediction = score_model.predict(test_team)
        n = len(test)
        shared_home = score_prediction[:n]
        shared_away = score_prediction[n:]
        if not np.array_equal(test_game_index[:n], np.arange(n)) or not np.array_equal(test_game_index[n:], np.arange(n)):
            raise RuntimeError("symmetric score row alignment failed")
        shared_margin = apply_affine(
            shared_home - shared_away, shared_margin_calibration
        )
        shared_total = apply_affine(
            shared_home + shared_away, shared_total_calibration
        )
        predictions[family] = {
            "sharedHome": (shared_total + shared_margin) / 2.0,
            "sharedAway": (shared_total - shared_margin) / 2.0,
            "sharedMargin": shared_margin,
            "sharedTotal": shared_total,
            "directMargin": apply_affine(
                margin_model.predict(test_margin_x), direct_margin_calibration
            ),
            "directTotal": apply_affine(
                total_model.predict(test_total_x), direct_total_calibration
            ),
        }

    # Incumbent: exact pre-r4 independent architecture (market-blind ElasticNet
    # home and away heads with the original feature set).
    incumbent_features = sorted(
        column for column in data.columns
        if column not in META_COLUMNS and not column.startswith("matchup_")
    )
    incumbent_home = model_families(seed + 303)["elastic_net"]
    incumbent_away = model_families(seed + 404)["elastic_net"]
    incumbent_home.fit(train[incumbent_features], finite_column(train, "home_score"))
    incumbent_away.fit(train[incumbent_features], finite_column(train, "away_score"))
    incumbent = {
        "home": incumbent_home.predict(test[incumbent_features]),
        "away": incumbent_away.predict(test[incumbent_features]),
    }
    return test, predictions, incumbent


def empirical_win_probability(
    home: np.ndarray,
    away: np.ndarray,
    residuals: np.ndarray,
) -> np.ndarray:
    """Fast exact empirical probability used for tournament ranking.

    The durable runtime still rebuilds the full football-score PMF.  Searching
    the frozen residual-margin distribution is equivalent for winner ranking
    and avoids constructing billions of Monte Carlo samples across the grid.
    """
    residual_margin = np.sort(residuals[:, 0] - residuals[:, 1])
    threshold = -(home - away)
    left = np.searchsorted(residual_margin, threshold, side="left")
    right = np.searchsorted(residual_margin, threshold, side="right")
    greater = len(residual_margin) - right
    ties = right - left
    return (greater + 0.5 * ties) / len(residual_margin)


def run(args: argparse.Namespace) -> dict[str, Any]:
    frames, checksums = read_sources(Path(args.historical_source_dir))
    residual_artifact = json.loads(Path(args.residual_artifact).read_text())
    residuals = np.asarray(residual_artifact["residualSample"], dtype=float)
    if residuals.ndim != 2 or residuals.shape[1] != 2 or len(residuals) < 500:
        raise RuntimeError("CFB residual artifact is incomplete")
    historical = build_dataset(
        frames,
        current_season_prior_games=4.0,
        include_opponent_adjusted_matchups=True,
    ).replace([np.inf, -np.inf], np.nan)
    season_cache: dict[str, Any] = {}
    all_keys = [
        f"score={score_family}::margin={margin_family}@{margin_weight:.2f}::total={total_family}@{total_weight:.2f}"
        for score_family in FAMILIES
        for margin_family in FAMILIES
        for total_family in FAMILIES
        for margin_weight in BLENDS
        for total_weight in BLENDS
    ]
    pooled: dict[str, dict[str, float]] = {
        key: {"teamAbs": 0.0, "marginAbs": 0.0, "totalAbs": 0.0, "games": 0.0,
              "spreadWins": 0.0, "spreadDecided": 0.0, "totalWins": 0.0, "totalDecided": 0.0,
              "mlWins": 0.0}
        for key in all_keys
    }

    for season in TEST_SEASONS:
        test, predictions, incumbent = train_predictions(
            historical, season, args.seed + season, args.rolling_calibration
        )
        inc_home = incumbent["home"]
        inc_away = incumbent["away"]
        inc_probability = empirical_win_probability(inc_home, inc_away, residuals)
        incumbent_metrics = outcome_metrics(test, inc_home, inc_away, inc_probability)
        candidates: dict[str, Any] = {}
        for score_family in FAMILIES:
            score = predictions[score_family]
            for margin_family in FAMILIES:
                direct_margin = predictions[margin_family]["directMargin"]
                for total_family in FAMILIES:
                    direct_total = predictions[total_family]["directTotal"]
                    for margin_weight in BLENDS:
                        margin = (
                            (1 - margin_weight) * score["sharedMargin"]
                            + margin_weight * direct_margin
                        )
                        for total_weight in BLENDS:
                            total = (
                                (1 - total_weight) * score["sharedTotal"]
                                + total_weight * direct_total
                            )
                            raw_home = np.clip((total + margin) / 2.0, 0, 80)
                            raw_away = np.clip((total - margin) / 2.0, 0, 80)
                            home = raw_home
                            away = raw_away
                            probability = empirical_win_probability(home, away, residuals)
                            key = (
                                f"score={score_family}::margin={margin_family}@{margin_weight:.2f}::"
                                f"total={total_family}@{total_weight:.2f}"
                            )
                            metrics = outcome_metrics(test, home, away, probability)
                            candidates[key] = metrics
                            accumulator = pooled[key]
                            games = float(metrics["games"])
                            accumulator["teamAbs"] += metrics["teamScoreMae"] * games * 2
                            accumulator["marginAbs"] += metrics["marginMae"] * games
                            accumulator["totalAbs"] += metrics["totalMae"] * games
                            accumulator["games"] += games
                            accumulator["mlWins"] += metrics["moneylineAccuracy"] * games
                            accumulator["spreadWins"] += metrics["spread"]["accuracy"] * metrics["spread"]["decided"]
                            accumulator["spreadDecided"] += metrics["spread"]["decided"]
                            accumulator["totalWins"] += metrics["total"]["accuracy"] * metrics["total"]["decided"]
                            accumulator["totalDecided"] += metrics["total"]["decided"]
        season_cache[str(season)] = {
            "incumbent": incumbent_metrics,
            "candidates": candidates,
        }

    pooled_metrics: dict[str, Any] = {}
    for key, value in pooled.items():
        games = value["games"]
        pooled_metrics[key] = {
            "games": int(games),
            "teamScoreMae": value["teamAbs"] / (2 * games),
            "marginMae": value["marginAbs"] / games,
            "totalMae": value["totalAbs"] / games,
            "moneylineAccuracy": value["mlWins"] / games,
            "spreadAccuracy": value["spreadWins"] / value["spreadDecided"],
            "totalAccuracy": value["totalWins"] / value["totalDecided"],
        }

    def candidate_score(item: tuple[str, dict[str, float]]) -> tuple[float, ...]:
        key, metrics = item
        season_values = [season_cache[str(season)]["candidates"][key] for season in TEST_SEASONS]
        spread_floor = min(value["spread"]["accuracy"] for value in season_values)
        total_floor = min(value["total"]["accuracy"] for value in season_values)
        return (
            -(metrics["spreadAccuracy"] + metrics["totalAccuracy"] + metrics["moneylineAccuracy"]),
            metrics["marginMae"] + metrics["totalMae"],
            metrics["teamScoreMae"],
            -spread_floor,
            -total_floor,
        )

    selected = min(pooled_metrics.items(), key=candidate_score)[0]
    selected_seasons = {
        season: season_cache[season]["candidates"][selected]
        for season in map(str, TEST_SEASONS)
    }
    incumbent_seasons = {
        season: season_cache[season]["incumbent"]
        for season in map(str, TEST_SEASONS)
    }
    # Keep the large grid out of the durable report; only the ranked leading
    # candidates are retained for reproducibility and review.
    leaders = sorted(pooled_metrics.items(), key=candidate_score)[:25]
    current = None
    if args.current_source_dir:
        current_frames = append_current_sources(
            frames, Path(args.current_source_dir)
        )
        current_data = build_dataset(
            current_frames,
            current_season_prior_games=4.0,
            include_opponent_adjusted_matchups=True,
        ).replace([np.inf, -np.inf], np.nan)
        current_test, current_predictions, current_incumbent = train_predictions(
            current_data, CURRENT_SEASON, args.seed + CURRENT_SEASON,
            args.rolling_calibration,
        )
        score_part, margin_part, total_part = selected.split("::")
        score_family = score_part.split("=")[1]
        margin_family, margin_weight_text = margin_part.split("=")[1].split("@")
        total_family, total_weight_text = total_part.split("=")[1].split("@")
        margin_weight = float(margin_weight_text)
        total_weight = float(total_weight_text)
        score = current_predictions[score_family]
        current_margin = (
            (1 - margin_weight) * score["sharedMargin"]
            + margin_weight * current_predictions[margin_family]["directMargin"]
        )
        current_total = (
            (1 - total_weight) * score["sharedTotal"]
            + total_weight * current_predictions[total_family]["directTotal"]
        )
        current_home = np.clip((current_total + current_margin) / 2.0, 0, 80)
        current_away = np.clip((current_total - current_margin) / 2.0, 0, 80)
        current_probability = empirical_win_probability(
            current_home, current_away, residuals
        )
        incumbent_probability = empirical_win_probability(
            current_incumbent["home"], current_incumbent["away"], residuals
        )
        current = {
            "candidate": outcome_metrics(
                current_test, current_home, current_away, current_probability
            ),
            "incumbent": outcome_metrics(
                current_test,
                current_incumbent["home"],
                current_incumbent["away"],
                incumbent_probability,
            ),
            "predictions": [
                {
                    "gameId": str(int(row.game_id)),
                    "gameDate": str(row.game_date),
                    "week": int(row.week),
                    "awayTeam": str(row.away_team),
                    "homeTeam": str(row.home_team),
                    "expectedAway": float(current_away[index]),
                    "expectedHome": float(current_home[index]),
                    "homeWinProbability": float(current_probability[index]),
                    "incumbentExpectedAway": float(current_incumbent["away"][index]),
                    "incumbentExpectedHome": float(current_incumbent["home"][index]),
                    "actualAway": float(row.away_score),
                    "actualHome": float(row.home_score),
                }
                for index, row in enumerate(current_test.itertuples(index=False))
            ],
        }

    return {
        "release": RELEASE,
        "productionDecisionEffect": False,
        "chronology": {
            "rollingOriginTests": list(TEST_SEASONS),
            "current2026Status": "opened_retrospective_stress_test_not_used_for_selection",
        },
        "sourceChecksums": checksums,
        "independentMarketExclusion": True,
        "selected": selected,
        "selectedPooled": pooled_metrics[selected],
        "selectedBySeason": selected_seasons,
        "incumbentBySeason": incumbent_seasons,
        "leaders": [{"candidate": key, "metrics": value} for key, value in leaders],
        "current2026": current,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--historical-source-dir", required=True)
    parser.add_argument("--current-source-dir")
    parser.add_argument(
        "--residual-artifact",
        default="lib/services/football/modelArtifacts/cfbV1JointScoreArtifact.json",
    )
    parser.add_argument("--output", default="/private/tmp/cfb-symmetric-matchup-score-r4.json")
    parser.add_argument("--seed", type=int, default=20260930)
    parser.add_argument("--rolling-calibration", action="store_true")
    args = parser.parse_args()
    report = run(args)
    Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "release": report["release"],
        "selected": report["selected"],
        "selectedPooled": report["selectedPooled"],
        "selectedBySeason": report["selectedBySeason"],
        "incumbentBySeason": report["incumbentBySeason"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
