#!/usr/bin/env python3
"""Tournament an independent NFL model on provider-reproducible play metrics."""

from __future__ import annotations

import json
import pathlib
import sys
import time
from dataclasses import asdict
from typing import Any

import numpy as np
import pandas as pd

import tournament_nfl_independent_score_rebuild_r1 as r1


STRICT_PROVIDER = "--strict-provider" in sys.argv
RELEASE = (
    "nfl_exact_provider_independent_tournament_2026_10_15_r7"
    if STRICT_PROVIDER else
    "nfl_provider_play_independent_tournament_2026_10_15_r5"
)
METRICS = (
    ("explosive_rate", "sack_rate", "turnover_rate", "plays", "redzone_td_rate", "no_huddle_rate", "points")
    if STRICT_PROVIDER else
    ("success", "explosive_rate", "sack_rate", "turnover_rate", "plays", "redzone_td_rate", "no_huddle_rate", "points")
)


def features(frame: pd.DataFrame) -> pd.DataFrame:
    values: dict[str, Any] = {
        "home_field": 1.0 - frame["neutral_site"].astype(float),
        "neutral_site": frame["neutral_site"].astype(float),
        "division_game": frame["division_game"].astype(float),
        "rest_diff": frame["rest_diff"].astype(float),
        "rest_sum": frame["home_rest"].astype(float) + frame["away_rest"].astype(float),
        "roof_indoor": frame["roof_indoor"].astype(float),
        "surface_grass": frame["surface_grass"].astype(float),
        "week": frame["week"].astype(float),
        "elo_diff": frame["elo_diff"].astype(float),
        "elo_sum_centered": frame["home_elo"].astype(float) + frame["away_elo"].astype(float) - 3000.0,
        "games_state_min": np.minimum(frame["home_games_state"], frame["away_games_state"]).astype(float),
    }
    for metric in METRICS:
        prior = r1.METRIC_PRIORS[metric]
        for speed in ("fast", "slow"):
            home = frame[f"home_matchup_{speed}_{metric}"].astype(float)
            away = frame[f"away_matchup_{speed}_{metric}"].astype(float)
            values[f"matchup_{speed}_{metric}_diff"] = home - away
            values[f"matchup_{speed}_{metric}_sum"] = home + away - 2.0 * prior
        home_adjusted = frame[f"home_off_adj_{metric}"].astype(float) - (frame[f"away_def_adj_{metric}"].astype(float) - prior)
        away_adjusted = frame[f"away_off_adj_{metric}"].astype(float) - (frame[f"home_def_adj_{metric}"].astype(float) - prior)
        values[f"matchup_adjusted_{metric}_diff"] = home_adjusted - away_adjusted
        values[f"matchup_adjusted_{metric}_sum"] = home_adjusted + away_adjusted - 2.0 * prior
    return pd.DataFrame(values, index=frame.index)


def factories() -> dict[str, Any]:
    result = r1.estimator_factories()
    result["extra_trees_regularized"] = lambda: r1.Pipeline([
        ("imputer", r1.SimpleImputer(strategy="median", add_indicator=False)),
        ("model", r1.ExtraTreesRegressor(n_estimators=96, min_samples_leaf=12, max_features=0.65, n_jobs=-1, random_state=r1.RANDOM_STATE)),
    ])
    return result


def recipes() -> tuple[r1.Recipe, ...]:
    base = tuple(r1.Recipe("provider_play", name, (name,)) for name in factories())
    return base + (
        r1.Recipe("provider_play", "ridge_ensemble", ("ridge_30", "ridge_100", "ridge_300")),
        r1.Recipe("provider_play", "all_ensemble", tuple(factories())),
    )


def fit_components(frame: pd.DataFrame, target: str, components: tuple[str, ...] | None = None) -> dict[str, Any]:
    selected = factories()
    names = tuple(selected) if components is None else components
    return {name: selected[name]().fit(features(frame), frame[target].to_numpy(float)) for name in names}


def predict(models: dict[str, Any], frame: pd.DataFrame, recipe: r1.Recipe) -> np.ndarray:
    values = {name: np.asarray(model.predict(features(frame)), dtype=float) for name, model in models.items()}
    return np.mean(np.vstack([values[name] for name in recipe.components]), axis=0)


def select(train: pd.DataFrame, test: pd.DataFrame, target: str) -> tuple[r1.Recipe, list[dict[str, Any]]]:
    models = fit_components(train, target)
    actual = test[target].to_numpy(float)
    ranked = []
    for recipe in recipes():
        metric = r1.point_metrics(actual, predict(models, test, recipe))
        ranked.append({"recipe": recipe, **metric})
    ranked.sort(key=lambda row: (row["mae"], row["rmse"], len(row["recipe"].components), row["recipe"].name))
    return ranked[0]["recipe"], [{"recipe": asdict(row["recipe"]), **{key: value for key, value in row.items() if key != "recipe"}} for row in ranked]


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, target: str, recipe: r1.Recipe) -> np.ndarray:
    return predict(fit_components(train, target, recipe.components), test, recipe)


def main() -> None:
    root = pathlib.Path.cwd()
    manifest = json.loads((root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2026_exact_replay_r1.manifest.json").read_text())
    games = pd.read_parquet(manifest["featureFile"]).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    train = games[games["season"].le(2022)].reset_index(drop=True)
    selection = games[games["season"].eq(2023)].reset_index(drop=True)
    margin_recipe, margin_rankings = select(train, selection, "actual_margin")
    total_recipe, total_rankings = select(train, selection, "actual_total")

    frames = []; margins = []; totals = []; by_season = {}
    for season in r1.CONFIRMATION_SEASONS:
        fit = games[games["season"].lt(season)].reset_index(drop=True)
        test = games[games["season"].eq(season)].reset_index(drop=True)
        margin = fit_predict(fit, test, "actual_margin", margin_recipe)
        total = fit_predict(fit, test, "actual_total", total_recipe)
        frames.append(test); margins.append(margin); totals.append(total)
        by_season[str(season)] = r1.score_report(test, margin, total)
    confirmation = pd.concat(frames, ignore_index=True)
    confirmation_report = r1.score_report(confirmation, np.concatenate(margins), np.concatenate(totals))

    fit = games[games["season"].le(2025)].reset_index(drop=True)
    exact = games[games["season"].eq(2026)].reset_index(drop=True)
    exact_margin = fit_predict(fit, exact, "actual_margin", margin_recipe)
    exact_total = fit_predict(fit, exact, "actual_total", total_recipe)
    exact_report = r1.score_report(exact, exact_margin, exact_total)
    payload = {
        "release": RELEASE, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "productionDecisionEffect": False, "metrics": list(METRICS), "featureColumns": list(features(train).columns),
        "selected": {"margin": asdict(margin_recipe), "total": asdict(total_recipe)},
        "selection": r1.score_report(selection, fit_predict(train, selection, "actual_margin", margin_recipe), fit_predict(train, selection, "actual_total", total_recipe)),
        "confirmationBySeason": by_season, "confirmationCombined": confirmation_report,
        "exact2026": exact_report, "rankings": {"margin": margin_rankings, "total": total_rankings},
        "restrictions": ["research-only", "market-free independent features", "2026 did not select architecture", "no locked-record writes"],
    }
    output_root = root / (
        "football-research/reports/nfl-exact-provider-independent-r7"
        if STRICT_PROVIDER else
        "football-research/reports/nfl-provider-play-independent-r5"
    )
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "tournament.json"
    output_path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"release": RELEASE, "selected": payload["selected"], "confirmation": confirmation_report, "exact2026": exact_report, "output": str(output_path)}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
