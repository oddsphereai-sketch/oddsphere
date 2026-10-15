#!/usr/bin/env python3
"""Tournament an NFL score model on live-reproducible weekly team statistics."""

from __future__ import annotations

import json
import math
import pathlib
import time
from collections import defaultdict
from dataclasses import asdict
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

import tournament_nfl_independent_score_rebuild_r1 as r1


RELEASE = "nfl_production_aligned_independent_tournament_2026_10_15_r4"
FAST_ALPHA = 0.35
SLOW_ALPHA = 0.16
OFFSEASON_CARRY = 0.65
METRIC_PRIORS = {
    "points": 22.5,
    "plays": 64.0,
    "yards_per_play": 5.45,
    "net_pass_yards_per_dropback": 6.15,
    "rush_yards_per_attempt": 4.25,
    "sack_rate": 0.07,
    "turnover_rate": 0.022,
    "dropback_rate": 0.59,
}


def finite(value: Any, default: float = math.nan) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def normalize_team(value: Any) -> str:
    team = str(value or "").upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def observation(row: Any, points: float) -> dict[str, float]:
    attempts = finite(row.attempts, 0.0)
    sacks = finite(row.sacks_suffered, 0.0)
    carries = finite(row.carries, 0.0)
    dropbacks = attempts + sacks
    plays = max(1.0, dropbacks + carries)
    net_pass = finite(row.passing_yards, 0.0) + finite(row.sack_yards_lost, 0.0)
    rush = finite(row.rushing_yards, 0.0)
    turnovers = finite(row.passing_interceptions, 0.0) + finite(row.fumbles_lost_total, 0.0)
    return {
        "points": points,
        "plays": plays,
        "yards_per_play": (net_pass + rush) / plays,
        "net_pass_yards_per_dropback": net_pass / max(1.0, dropbacks),
        "rush_yards_per_attempt": rush / max(1.0, carries),
        "sack_rate": sacks / max(1.0, dropbacks),
        "turnover_rate": turnovers / plays,
        "dropback_rate": dropbacks / plays,
    }


def blank_state() -> dict[str, dict[str, float]]:
    return {
        "off_fast": dict(METRIC_PRIORS), "off_slow": dict(METRIC_PRIORS),
        "def_fast": dict(METRIC_PRIORS), "def_slow": dict(METRIC_PRIORS),
    }


def update(previous: float, observed: float, alpha: float) -> float:
    return alpha * observed + (1.0 - alpha) * previous


def load_team_stats(root: pathlib.Path) -> pd.DataFrame:
    manifest = json.loads((root / "football-research/cache/nflverse/real-model-r1/manifest-2016-2026-exact-replay.json").read_text())
    entries = [item for item in manifest["files"] if item["dataset"] == "team_stats"]
    if len(entries) != 11:
        raise RuntimeError(f"expected 11 team-stat files, found {len(entries)}")
    frames = []
    for item in sorted(entries, key=lambda value: int(value["season"])):
        path = pathlib.Path(item["filename"])
        if r1.sha256_file(path) != item["sha256"]:
            raise RuntimeError(f"team-stat checksum mismatch: {path}")
        frame = pq.read_table(path).to_pandas()
        frames.append(frame[frame["season_type"].eq("REG")].copy())
    result = pd.concat(frames, ignore_index=True)
    result["team"] = result["team"].map(normalize_team)
    result["opponent_team"] = result["opponent_team"].map(normalize_team)
    return result


def build_dataset(games: pd.DataFrame, stats: pd.DataFrame) -> pd.DataFrame:
    stat_lookup = {(str(row.game_id), str(row.team)): row for row in stats.itertuples(index=False)}
    states: defaultdict[str, dict[str, dict[str, float]]] = defaultdict(blank_state)
    rows: list[dict[str, Any]] = []
    current_season: int | None = None
    for (season_value, _), week_games in games.groupby(["season", "week"], sort=True):
        season = int(season_value)
        if current_season != season:
            if current_season is not None:
                for state in states.values():
                    for bucket in state.values():
                        for metric, prior in METRIC_PRIORS.items():
                            bucket[metric] = prior + OFFSEASON_CARRY * (bucket[metric] - prior)
            current_season = season

        pending: list[tuple[str, str, dict[str, float], dict[str, float]]] = []
        for game in week_games.itertuples(index=False):
            home = normalize_team(game.home_team)
            away = normalize_team(game.away_team)
            home_state = states[home]
            away_state = states[away]
            values: dict[str, Any] = {
                "game_id": str(game.game_id), "season": season, "week": int(game.week),
                "gameday": str(game.gameday), "home_team": home, "away_team": away,
                "home_score": finite(game.home_score), "away_score": finite(game.away_score),
                "actual_margin": finite(game.actual_margin), "actual_total": finite(game.actual_total),
                "market_home_margin": finite(game.market_home_margin), "market_total": finite(game.market_total),
                "home_field": 1.0 - float(bool(game.neutral_site)),
                "neutral_site": float(bool(game.neutral_site)),
                "division_game": float(bool(game.division_game)),
                "rest_diff": finite(game.rest_diff, 0.0),
                "rest_sum": finite(game.home_rest, 7.0) + finite(game.away_rest, 7.0),
                "roof_indoor": float(bool(game.roof_indoor)),
                "surface_grass": float(bool(game.surface_grass)),
                "week_context": float(game.week),
                "elo_diff": finite(game.elo_diff, 0.0),
                "elo_sum_centered": finite(game.home_elo, 1500.0) + finite(game.away_elo, 1500.0) - 3000.0,
                "games_state_min": min(finite(game.home_games_state, 0.0), finite(game.away_games_state, 0.0)),
            }
            for metric, prior in METRIC_PRIORS.items():
                for speed in ("fast", "slow"):
                    home_matchup = home_state[f"off_{speed}"][metric] + away_state[f"def_{speed}"][metric] - prior
                    away_matchup = away_state[f"off_{speed}"][metric] + home_state[f"def_{speed}"][metric] - prior
                    values[f"matchup_{speed}_{metric}_diff"] = home_matchup - away_matchup
                    values[f"matchup_{speed}_{metric}_sum"] = home_matchup + away_matchup - 2.0 * prior
            rows.append(values)

            home_stat = stat_lookup.get((str(game.game_id), home))
            away_stat = stat_lookup.get((str(game.game_id), away))
            if home_stat is None or away_stat is None:
                raise RuntimeError(f"missing team stats for {away}@{home} {game.game_id}")
            home_obs = observation(home_stat, finite(game.home_score))
            away_obs = observation(away_stat, finite(game.away_score))
            pending.extend([(home, away, home_obs, away_obs), (away, home, away_obs, home_obs)])

        for team, opponent, offense, defense_allowed in pending:
            state = states[team]
            for metric in METRIC_PRIORS:
                state["off_fast"][metric] = update(state["off_fast"][metric], offense[metric], FAST_ALPHA)
                state["off_slow"][metric] = update(state["off_slow"][metric], offense[metric], SLOW_ALPHA)
                state["def_fast"][metric] = update(state["def_fast"][metric], defense_allowed[metric], FAST_ALPHA)
                state["def_slow"][metric] = update(state["def_slow"][metric], defense_allowed[metric], SLOW_ALPHA)
    return pd.DataFrame(rows).sort_values(["season", "week", "game_id"]).reset_index(drop=True)


def features(frame: pd.DataFrame) -> pd.DataFrame:
    ignored = {"game_id", "season", "week", "gameday", "home_team", "away_team", "home_score", "away_score", "actual_margin", "actual_total", "market_home_margin", "market_total"}
    return frame[[column for column in frame.columns if column not in ignored]].astype(float)


def fit_models(train: pd.DataFrame, target: str) -> dict[str, Any]:
    x = features(train)
    y = train[target].to_numpy(float)
    factories = r1.estimator_factories()
    # The portable forest count was frozen in this predeclaration.
    factories["extra_trees_regularized"] = lambda: r1.Pipeline([
        ("imputer", r1.SimpleImputer(strategy="median", add_indicator=False)),
        ("model", r1.ExtraTreesRegressor(n_estimators=96, min_samples_leaf=12, max_features=0.65, n_jobs=-1, random_state=r1.RANDOM_STATE)),
    ])
    models = {name: factory().fit(x, y) for name, factory in factories.items()}
    return models


def recipes() -> tuple[r1.Recipe, ...]:
    return r1.recipe_definitions("production_aligned")


def predict(models: dict[str, Any], frame: pd.DataFrame, recipe: r1.Recipe) -> np.ndarray:
    values = {name: np.asarray(model.predict(features(frame)), dtype=float) for name, model in models.items()}
    return np.mean(np.vstack([values[name] for name in recipe.components]), axis=0)


def select(train: pd.DataFrame, test: pd.DataFrame, target: str) -> tuple[r1.Recipe, list[dict[str, Any]]]:
    models = fit_models(train, target)
    actual = test[target].to_numpy(float)
    ranked = []
    for recipe in recipes():
        metric = r1.point_metrics(actual, predict(models, test, recipe))
        ranked.append({"recipe": recipe, **metric})
    ranked.sort(key=lambda row: (row["mae"], row["rmse"], len(row["recipe"].components), row["recipe"].name))
    return ranked[0]["recipe"], [{"recipe": asdict(row["recipe"]), **{key: value for key, value in row.items() if key != "recipe"}} for row in ranked]


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, target: str, recipe: r1.Recipe) -> np.ndarray:
    return predict(fit_models(train, target), test, recipe)


def main() -> None:
    root = pathlib.Path.cwd()
    manifest = json.loads((root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2026_exact_replay_r1.manifest.json").read_text())
    raw = pd.read_parquet(manifest["featureFile"]).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    data = build_dataset(raw, load_team_stats(root))
    train = data[data["season"].le(2022)].reset_index(drop=True)
    selection = data[data["season"].eq(2023)].reset_index(drop=True)
    margin_recipe, margin_rankings = select(train, selection, "actual_margin")
    total_recipe, total_rankings = select(train, selection, "actual_total")

    frames = []
    margins = []
    totals = []
    by_season = {}
    for season in (2024, 2025):
        fit = data[data["season"].lt(season)].reset_index(drop=True)
        test = data[data["season"].eq(season)].reset_index(drop=True)
        margin = fit_predict(fit, test, "actual_margin", margin_recipe)
        total = fit_predict(fit, test, "actual_total", total_recipe)
        frames.append(test); margins.append(margin); totals.append(total)
        by_season[str(season)] = r1.score_report(test, margin, total)
    confirmation = pd.concat(frames, ignore_index=True)
    confirmation_report = r1.score_report(confirmation, np.concatenate(margins), np.concatenate(totals))

    fit = data[data["season"].le(2025)].reset_index(drop=True)
    exact = data[data["season"].eq(2026)].reset_index(drop=True)
    exact_margin = fit_predict(fit, exact, "actual_margin", margin_recipe)
    exact_total = fit_predict(fit, exact, "actual_total", total_recipe)
    exact_report = r1.score_report(exact, exact_margin, exact_total)
    payload = {
        "release": RELEASE, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "productionDecisionEffect": False,
        "featureColumns": list(features(train).columns),
        "selected": {"margin": asdict(margin_recipe), "total": asdict(total_recipe)},
        "selection": r1.score_report(selection, fit_predict(train, selection, "actual_margin", margin_recipe), fit_predict(train, selection, "actual_total", total_recipe)),
        "confirmationBySeason": by_season, "confirmationCombined": confirmation_report,
        "exact2026": exact_report,
        "rankings": {"margin": margin_rankings, "total": total_rankings},
        "restrictions": ["research-only", "independent features contain no market inputs", "2026 did not select architecture", "no locked-record writes"],
    }
    output_root = root / "football-research/reports/nfl-production-aligned-independent-r4"
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "tournament.json"
    output_path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"release": RELEASE, "selected": payload["selected"], "confirmation": confirmation_report, "exact2026": exact_report, "output": str(output_path)}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
