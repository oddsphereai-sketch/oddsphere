#!/usr/bin/env python3
"""Mechanistic NFL possession-efficiency score engine development replay."""

from __future__ import annotations

import json
import math
import pathlib
import time
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd

import tournament_nfl_weekly_joint_score_engine_r1 as r1
from tournament_nfl_market_context_residual_r1 import FEATURE_RELEASE, add_market_context, sha256_file


TOURNAMENT_RELEASE = "nfl_possession_efficiency_score_engine_tournament_2026_09_25_r3"
SELECTION_SEASON = 2023
DEVELOPMENT_REPLAY_SEASONS = (2024, 2025)
STATE_STYLES = ("fast", "slow", "adjusted", "fast_slow")
OFFENSE_WEIGHTS = (0.25, 0.50, 0.75)
PACE_STRENGTHS = (0.50, 0.75, 1.00)
EFFICIENCY_STRENGTHS = (0.50, 0.75, 1.00)
HOME_FIELD_POINTS = (1.0, 1.5, 2.0)
MARKET_WEIGHTS = tuple(value / 10.0 for value in range(10))
PRIOR_POINTS = 22.5
PRIOR_PLAYS = 64.0
PRIOR_POINTS_PER_PLAY = PRIOR_POINTS / PRIOR_PLAYS
PRIOR_REDZONE_RATE = 0.55
PRIOR_TURNOVER_RATE = 0.022
PRIOR_SACK_RATE = 0.070


@dataclass(frozen=True)
class Recipe:
    state_style: str
    offense_weight: float
    pace_strength: float
    efficiency_strength: float
    home_field_points: float
    margin_market_weight: float
    total_market_weight: float


def finite(value: Any, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def state_value(game: pd.Series, side: str, unit: str, style: str, metric: str, prior: float) -> float:
    if style == "fast_slow":
        fast = finite(game.get(f"{side}_{unit}_fast_{metric}"), prior)
        slow = finite(game.get(f"{side}_{unit}_slow_{metric}"), prior)
        return 0.5 * (fast + slow)
    bucket = "adj" if style == "adjusted" else style
    return finite(game.get(f"{side}_{unit}_{bucket}_{metric}"), prior)


def independent_scores(games: pd.DataFrame, recipe: Recipe) -> dict[str, np.ndarray]:
    home_scores: list[float] = []
    away_scores: list[float] = []
    for _, game in games.iterrows():
        estimates: dict[str, float] = {}
        for side, opponent in (("home", "away"), ("away", "home")):
            off_points = state_value(game, side, "off", recipe.state_style, "points", PRIOR_POINTS)
            off_plays = max(40.0, state_value(game, side, "off", recipe.state_style, "plays", PRIOR_PLAYS))
            def_points = state_value(game, opponent, "def", recipe.state_style, "points", PRIOR_POINTS)
            def_plays = max(40.0, state_value(game, opponent, "def", recipe.state_style, "plays", PRIOR_PLAYS))
            raw_plays = recipe.offense_weight * off_plays + (1.0 - recipe.offense_weight) * def_plays
            expected_plays = PRIOR_PLAYS + recipe.pace_strength * (raw_plays - PRIOR_PLAYS)
            offense_ppp = off_points / off_plays
            defense_ppp = def_points / def_plays
            raw_ppp = recipe.offense_weight * offense_ppp + (1.0 - recipe.offense_weight) * defense_ppp
            expected_ppp = PRIOR_POINTS_PER_PLAY + recipe.efficiency_strength * (raw_ppp - PRIOR_POINTS_PER_PLAY)

            off_rz = state_value(game, side, "off", recipe.state_style, "redzone_td_rate", PRIOR_REDZONE_RATE)
            def_rz = state_value(game, opponent, "def", recipe.state_style, "redzone_td_rate", PRIOR_REDZONE_RATE)
            redzone = recipe.offense_weight * off_rz + (1.0 - recipe.offense_weight) * def_rz
            off_to = state_value(game, side, "off", recipe.state_style, "turnover_rate", PRIOR_TURNOVER_RATE)
            def_to = state_value(game, opponent, "def", recipe.state_style, "turnover_rate", PRIOR_TURNOVER_RATE)
            turnovers = recipe.offense_weight * off_to + (1.0 - recipe.offense_weight) * def_to
            off_sack = state_value(game, side, "off", recipe.state_style, "sack_rate", PRIOR_SACK_RATE)
            def_sack = state_value(game, opponent, "def", recipe.state_style, "sack_rate", PRIOR_SACK_RATE)
            sacks = recipe.offense_weight * off_sack + (1.0 - recipe.offense_weight) * def_sack
            context_points = np.clip(
                3.0 * (redzone - PRIOR_REDZONE_RATE)
                - 30.0 * (turnovers - PRIOR_TURNOVER_RATE)
                - 10.0 * (sacks - PRIOR_SACK_RATE),
                -3.0,
                3.0,
            )
            estimate = expected_plays * expected_ppp + float(context_points)
            estimate += recipe.home_field_points / 2.0 if side == "home" else -recipe.home_field_points / 2.0
            estimates[side] = float(np.clip(estimate, 8.0, 42.0))
        home_scores.append(estimates["home"])
        away_scores.append(estimates["away"])
    home = np.asarray(home_scores)
    away = np.asarray(away_scores)
    return {"home": home, "away": away, "margin": home - away, "total": home + away}


def calibrated_scores(games: pd.DataFrame, independent: dict[str, np.ndarray], recipe: Recipe) -> dict[str, np.ndarray]:
    market_margin = games["market_home_margin"].to_numpy(float)
    market_total = games["market_total"].to_numpy(float)
    margin = (1.0 - recipe.margin_market_weight) * independent["margin"] + recipe.margin_market_weight * market_margin
    total = (1.0 - recipe.total_market_weight) * independent["total"] + recipe.total_market_weight * market_total
    return {"home": (total + margin) / 2.0, "away": (total - margin) / 2.0, "margin": margin, "total": total}


def rank(metrics: dict[str, Any], recipe: Recipe) -> tuple[float, ...]:
    market = metrics["market"]
    joint = (
        metrics["teamScore"]["mae"] / market["teamScore"]["mae"]
        + metrics["margin"]["mae"] / market["margin"]["mae"]
        + metrics["total"]["mae"] / market["total"]["mae"]
    )
    return (
        joint,
        -float(metrics["moneylineDirection"]["accuracy"] or 0.0),
        -float(metrics["spreadDirection"]["accuracy"] or 0.0),
        -float(metrics["totalDirection"]["accuracy"] or 0.0),
        recipe.margin_market_weight + recipe.total_market_weight,
        recipe.state_style,
    )


def select_recipe(games: pd.DataFrame) -> tuple[Recipe, list[dict[str, Any]]]:
    selection = games[games["season"].eq(SELECTION_SEASON)].reset_index(drop=True)
    rankings: list[dict[str, Any]] = []
    for style in STATE_STYLES:
        for offense_weight in OFFENSE_WEIGHTS:
            for pace_strength in PACE_STRENGTHS:
                for efficiency_strength in EFFICIENCY_STRENGTHS:
                    for home_field in HOME_FIELD_POINTS:
                        base_recipe = Recipe(style, offense_weight, pace_strength, efficiency_strength, home_field, 0.0, 0.0)
                        independent = independent_scores(selection, base_recipe)
                        independent_metrics = r1.score_metrics(selection, independent)
                        for margin_weight in MARKET_WEIGHTS:
                            for total_weight in MARKET_WEIGHTS:
                                recipe = Recipe(
                                    style, offense_weight, pace_strength, efficiency_strength,
                                    home_field, margin_weight, total_weight,
                                )
                                scores = calibrated_scores(selection, independent, recipe)
                                metrics = r1.score_metrics(selection, scores)
                                rankings.append({
                                    "recipe": recipe,
                                    "metrics": metrics,
                                    "independentMetrics": independent_metrics,
                                    "rank": rank(metrics, recipe),
                                })
    rankings.sort(key=lambda row: row["rank"])
    return rankings[0]["recipe"], rankings


def seasonal_slices(games: pd.DataFrame, scores: dict[str, np.ndarray]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, weeks in {
        "weeks1to4": (1, 4), "weeks5to9": (5, 9), "weeks10plus": (10, 18),
    }.items():
        keep = games["week"].between(*weeks).to_numpy()
        subset = games.loc[keep].reset_index(drop=True)
        subset_scores = {key: value[keep] for key, value in scores.items()}
        result[name] = r1.score_metrics(subset, subset_scores)
    return result


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature checksum mismatch")
    games = add_market_context(pd.read_parquet(feature_path)).sort_values(
        ["season", "week", "game_id"]
    ).reset_index(drop=True)

    selected, rankings = select_recipe(games)
    residual_sample = games[games["season"].between(2020, SELECTION_SEASON)].reset_index(drop=True)
    residual_scores = calibrated_scores(residual_sample, independent_scores(residual_sample, selected), selected)
    margin_sigma = float(np.std(residual_sample["actual_margin"] - residual_scores["margin"], ddof=1))
    total_sigma = float(np.std(residual_sample["actual_total"] - residual_scores["total"], ddof=1))

    replay = games[games["season"].isin(DEVELOPMENT_REPLAY_SEASONS)].reset_index(drop=True)
    independent = independent_scores(replay, selected)
    calibrated = calibrated_scores(replay, independent, selected)
    score = r1.score_metrics(replay, calibrated)
    probability = r1.probability_report(replay, calibrated, margin_sigma, total_sigma)
    by_season = {
        str(season): {
            "independent": r1.score_metrics(
                replay[replay["season"].eq(season)].reset_index(drop=True),
                {key: value[replay["season"].eq(season).to_numpy()] for key, value in independent.items()},
            ),
            "calibrated": r1.score_metrics(
                replay[replay["season"].eq(season)].reset_index(drop=True),
                {key: value[replay["season"].eq(season).to_numpy()] for key, value in calibrated.items()},
            ),
        }
        for season in DEVELOPMENT_REPLAY_SEASONS
    }
    gates = {
        "teamScoreMaeImproves": score["teamScore"]["mae"] < score["market"]["teamScore"]["mae"],
        "marginMaeImproves": score["margin"]["mae"] < score["market"]["margin"]["mae"],
        "totalMaeImproves": score["total"]["mae"] < score["market"]["total"]["mae"],
        "moneylineAccuracyNonRegression": score["moneylineDirection"]["accuracy"] >= score["market"]["moneylineDirection"]["accuracy"],
        "spreadDirectionAtLeastHalf": (score["spreadDirection"]["accuracy"] or 0.0) >= 0.5,
        "totalDirectionAtLeastHalf": (score["totalDirection"]["accuracy"] or 0.0) >= 0.5,
        "allBrierNonRegression": all(value["candidate"]["brier"] <= value["market"]["brier"] for value in probability.values()),
        "bothSpreadDirections": score["spreadDirection"]["positive"] > 0 and score["spreadDirection"]["negative"] > 0,
        "bothTotalDirections": score["totalDirection"]["positive"] > 0 and score["totalDirection"]["negative"] > 0,
        "forwardPromotionEligible": False,
    }
    gates["developmentReplayPassed"] = all(value for key, value in gates.items() if key != "forwardPromotionEligible")

    def ranking_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "recipe": asdict(row["recipe"]),
            "metrics": row["metrics"],
            "independentMetrics": row["independentMetrics"],
            "jointLoss": row["rank"][0],
        }

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "productionChanged": False,
        "promotionEligible": False,
        "selectionSeason": SELECTION_SEASON,
        "developmentReplaySeasons": list(DEVELOPMENT_REPLAY_SEASONS),
        "selected": ranking_row(rankings[0]),
        "selectionTopTen": [ranking_row(row) for row in rankings[:10]],
        "residualScale": {"margin": margin_sigma, "total": total_sigma},
        "developmentReplay": {
            "independent": r1.score_metrics(replay, independent),
            "calibrated": score,
            "probability": probability,
            "bySeason": by_season,
            "seasonalSlices": seasonal_slices(replay, calibrated),
            "gates": gates,
        },
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "selected": report["selected"],
        "developmentIndependent": report["developmentReplay"]["independent"],
        "developmentCalibrated": report["developmentReplay"]["calibrated"],
        "seasonalSlices": report["developmentReplay"]["seasonalSlices"],
        "probability": probability,
        "gates": gates,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
