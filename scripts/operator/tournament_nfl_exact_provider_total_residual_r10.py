#!/usr/bin/env python3
"""Select a live-reproducible residual correction for dynamic NFL Total."""

from __future__ import annotations

import json
import pathlib
import time
from dataclasses import asdict
from typing import Any

import numpy as np
import pandas as pd

import tournament_nfl_dynamic_state_score_rebuild_r2 as r2
import tournament_nfl_independent_score_rebuild_r1 as r1
import tournament_nfl_provider_play_independent_r5 as r5


RELEASE = "nfl_exact_provider_total_residual_tournament_2026_10_15_r10"
STRICT_METRICS = (
    "explosive_rate", "sack_rate", "turnover_rate", "plays",
    "redzone_td_rate", "no_huddle_rate", "points",
)


def recipe_from_report(value: dict[str, Any]) -> r2.StateRecipe:
    return r2.StateRecipe(
        state_gain=float(value["state_gain"]),
        offseason_carry=float(value["offseason_carry"]),
        home_field_margin=float(value["home_field_margin"]),
        league_gain=float(value["league_gain"]),
    )


def model_recipes() -> tuple[r1.Recipe, ...]:
    base = tuple(r1.Recipe("exact_provider", name, (name,)) for name in r5.factories())
    return base + (
        r1.Recipe("exact_provider", "ridge_ensemble", ("ridge_30", "ridge_100", "ridge_300")),
        r1.Recipe("exact_provider", "all_ensemble", tuple(r5.factories())),
    )


def fit_models(frame: pd.DataFrame, target: np.ndarray, components: tuple[str, ...] | None = None) -> dict[str, Any]:
    factories = r5.factories()
    names = tuple(factories) if components is None else components
    return {name: factories[name]().fit(r5.features(frame), target) for name in names}


def raw_prediction(models: dict[str, Any], frame: pd.DataFrame, recipe: r1.Recipe) -> np.ndarray:
    values = {name: np.asarray(model.predict(r5.features(frame)), dtype=float) for name, model in models.items()}
    return np.mean(np.vstack([values[name] for name in recipe.components]), axis=0)


def select(train: pd.DataFrame, test: pd.DataFrame, train_base: np.ndarray, test_base: np.ndarray) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    residual = train["actual_total"].to_numpy(float) - train_base
    actual = test["actual_total"].to_numpy(float)
    models = fit_models(train, residual)
    ranked = []
    for recipe in model_recipes():
        raw = raw_prediction(models, test, recipe)
        for weight in r2.CORRECTION_WEIGHTS:
            for cap in r2.CORRECTION_CAPS:
                prediction = test_base + np.clip(weight * raw, -cap, cap)
                ranked.append({"recipe": recipe, "weight": weight, "cap": cap, **r1.point_metrics(actual, prediction)})
    ranked.sort(key=lambda row: (row["mae"], row["rmse"], row["weight"], row["cap"], len(row["recipe"].components)))
    winner = ranked[0]
    selected = {"model": asdict(winner["recipe"]), "weight": winner["weight"], "cap": winner["cap"]}
    serialized = [{"recipe": {"model": asdict(row["recipe"]), "weight": row["weight"], "cap": row["cap"]}, **{key: value for key, value in row.items() if key not in ("recipe", "weight", "cap")}} for row in ranked]
    return selected, serialized


def apply(train: pd.DataFrame, test: pd.DataFrame, train_base: np.ndarray, test_base: np.ndarray, selected: dict[str, Any]) -> np.ndarray:
    value = selected["model"]
    recipe = r1.Recipe(str(value["feature_family"]), str(value["name"]), tuple(value["components"]))
    residual = train["actual_total"].to_numpy(float) - train_base
    models = fit_models(train, residual, recipe.components)
    raw = raw_prediction(models, test, recipe)
    return test_base + np.clip(float(selected["weight"]) * raw, -float(selected["cap"]), float(selected["cap"]))


def main() -> None:
    root = pathlib.Path.cwd()
    manifest = json.loads((root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2026_exact_replay_r1.manifest.json").read_text())
    games = pd.read_parquet(manifest["featureFile"]).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    r2_report = json.loads((root / "football-research/reports/nfl-dynamic-state-score-rebuild-r2/tournament.json").read_text())
    state_recipe = recipe_from_report(r2_report["selected"]["state"])
    base = r2.dynamic_scores(games, state_recipe)["total"]
    original_metrics = r5.METRICS
    r5.METRICS = STRICT_METRICS
    try:
        train_mask = games["season"].le(2022).to_numpy(); selection_mask = games["season"].eq(2023).to_numpy()
        selected, rankings = select(games.loc[train_mask].reset_index(drop=True), games.loc[selection_mask].reset_index(drop=True), base[train_mask], base[selection_mask])
        by_season = {}; confirmation_frames = []; confirmation_values = []
        for season in (2024, 2025):
            fit_mask = games["season"].lt(season).to_numpy(); test_mask = games["season"].eq(season).to_numpy()
            test = games.loc[test_mask].reset_index(drop=True)
            prediction = apply(games.loc[fit_mask].reset_index(drop=True), test, base[fit_mask], base[test_mask], selected)
            by_season[str(season)] = r1.point_metrics(test["actual_total"].to_numpy(float), prediction)
            confirmation_frames.append(test); confirmation_values.append(prediction)
        confirmation = pd.concat(confirmation_frames, ignore_index=True)
        confirmation_metrics = r1.point_metrics(confirmation["actual_total"].to_numpy(float), np.concatenate(confirmation_values))
        fit_mask = games["season"].le(2025).to_numpy(); exact_mask = games["season"].eq(2026).to_numpy()
        exact = games.loc[exact_mask].reset_index(drop=True)
        exact_prediction = apply(games.loc[fit_mask].reset_index(drop=True), exact, base[fit_mask], base[exact_mask], selected)
        exact_metrics = r1.point_metrics(exact["actual_total"].to_numpy(float), exact_prediction)
        scores = [{"gameId": str(row.game_id), "total": float(exact_prediction[index])} for index, row in enumerate(exact.itertuples(index=False))]
    finally:
        r5.METRICS = original_metrics
    payload = {"release": RELEASE, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "selected": selected, "state": asdict(state_recipe), "confirmationBySeason": by_season, "confirmationCombined": confirmation_metrics, "exact2026": exact_metrics, "exact2026Totals": scores, "rankings": rankings, "productionDecisionEffect": False}
    output_root = root / "football-research/reports/nfl-exact-provider-total-residual-r10"; output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "tournament.json"; output_path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"release": RELEASE, "selected": selected, "confirmation": confirmation_metrics, "exact2026": exact_metrics, "output": str(output_path)}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
