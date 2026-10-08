#!/usr/bin/env python3
"""Chronological NFL player-props tournament for reproducible matchup features.

This is research-only. It compares the current official-outcome direct HGB heads
with models that add team/opponent efficiency, play mix, pressure, conversion,
red-zone, turnover, and kickoff-environment inputs that can be reproduced by the
existing current-season state and forward-evidence writer without provider calls.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error


BASELINE_PATH = pathlib.Path("scripts/operator/tournament_nfl_player_props_baseline.py")
DEFAULT_MANIFEST = pathlib.Path(
    "football-research/cache/nfl-player-props-history/"
    "nfl_player_props_2016_2025_r1.manifest.json"
)
SOURCE_MANIFEST = pathlib.Path(
    "football-research/cache/nflverse/real-model-r1/manifest.json"
)
DEFAULT_OUTPUT = pathlib.Path(
    "football-research/cache/nfl-player-props-matchup/"
    "nfl_player_props_matchup_tournament_r1.json"
)
SEED = 20260928
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)


def load_baseline() -> Any:
    spec = importlib.util.spec_from_file_location("nfl_props_matchup_baseline", BASELINE_PATH)
    if not spec or not spec.loader:
        raise RuntimeError("NFL props baseline module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def source_files(manifest: dict[str, Any], dataset: str) -> list[pathlib.Path]:
    source = pathlib.Path(str(manifest["sourceManifestSha256"]))
    del source  # checksum is already verified by the historical builder
    rows = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))["files"]
    return [pathlib.Path(item["filename"]) for item in rows
            if item["dataset"] == dataset and 2016 <= int(item["season"]) <= 2025]


def read_parquets(paths: list[pathlib.Path], columns: list[str]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for path in paths:
        available = set(pq.read_schema(path).names)
        frames.append(pq.read_table(path, columns=[c for c in columns if c in available]).to_pandas())
    if len(frames) != 10:
        raise RuntimeError("NFL matchup feature source is incomplete")
    return pd.concat(frames, ignore_index=True)


def safe_ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator.astype(float).div(denominator.astype(float).replace(0, np.nan))


def team_game_metrics(manifest: dict[str, Any]) -> pd.DataFrame:
    columns = [
        "season", "week", "season_type", "game_id", "team", "opponent_team",
        "attempts", "completions", "passing_yards", "passing_interceptions",
        "sacks_suffered", "passing_first_downs", "passing_epa", "passing_cpoe",
        "passing_20", "carries", "rushing_yards", "rushing_first_downs",
        "rushing_epa", "rushing_20", "rushing_fumbles_lost", "receiving_air_yards",
        "receiving_yards_after_catch", "targets",
    ]
    rows = read_parquets(source_files(manifest, "team_stats"), columns)
    rows = rows[rows["season_type"].fillna("").eq("REG")].copy()
    rows["team"] = rows["team"].replace({"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"})
    rows["opponent"] = rows["opponent_team"].replace({"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"})
    numeric = [c for c in columns if c not in {"season", "week", "season_type", "game_id", "team", "opponent_team"}]
    rows[numeric] = rows[numeric].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    dropbacks = rows["attempts"] + rows["sacks_suffered"]
    plays = dropbacks + rows["carries"]
    first_downs = rows["passing_first_downs"] + rows["rushing_first_downs"]
    rows["pass_rate"] = safe_ratio(dropbacks, plays)
    rows["completion_rate"] = safe_ratio(rows["completions"], rows["attempts"])
    rows["pass_yards_per_attempt"] = safe_ratio(rows["passing_yards"], rows["attempts"])
    rows["sack_rate"] = safe_ratio(rows["sacks_suffered"], dropbacks)
    rows["rush_yards_per_attempt"] = safe_ratio(rows["rushing_yards"], rows["carries"])
    rows["pass_epa_per_dropback"] = safe_ratio(rows["passing_epa"], dropbacks)
    rows["rush_epa_per_attempt"] = safe_ratio(rows["rushing_epa"], rows["carries"])
    rows["first_down_rate"] = safe_ratio(first_downs, plays)
    rows["explosive_pass_rate"] = safe_ratio(rows["passing_20"], rows["attempts"])
    rows["explosive_rush_rate"] = safe_ratio(rows["rushing_20"], rows["carries"])
    rows["turnover_rate"] = safe_ratio(rows["passing_interceptions"] + rows["rushing_fumbles_lost"], plays)
    rows["air_yards_per_target"] = safe_ratio(rows["receiving_air_yards"], rows["targets"])
    rows["yac_per_target"] = safe_ratio(rows["receiving_yards_after_catch"], rows["targets"])
    metrics = [
        "pass_rate", "completion_rate", "pass_yards_per_attempt", "sack_rate",
        "rush_yards_per_attempt", "pass_epa_per_dropback", "rush_epa_per_attempt",
        "first_down_rate", "explosive_pass_rate", "explosive_rush_rate",
        "turnover_rate", "air_yards_per_target", "yac_per_target", "passing_cpoe",
    ]
    return rows[["season", "week", "game_id", "team", "opponent", *metrics]]


def add_shifted_team_features(
    rows: pd.DataFrame,
    opponent_identity: str = "legacy_self",
) -> tuple[pd.DataFrame, list[str]]:
    """Build pregame team and defense histories without leaking the current game.

    ``legacy_self`` preserves the original tournament/export behavior for exact
    reproducibility. It keys allowed metrics by the offensive team's identity,
    so the resulting ``matchup_opponent_allowed_*`` columns actually describe
    that team's own defense. ``actual_opponent`` keys those same shifted states
    by the offense on the source row and therefore attaches the defense of the
    opponent the player will face.

    New research must request ``actual_opponent`` explicitly until a validated
    release promotes the corrected identity through the full runtime pipeline.
    """
    if opponent_identity not in {"legacy_self", "actual_opponent"}:
        raise ValueError(f"unsupported opponent identity: {opponent_identity}")
    identity = ["season", "week", "game_id", "team"]
    metrics = [c for c in rows.columns if c not in {*identity, "opponent"}]
    own = rows.sort_values(["team", "season", "week", "game_id"]).copy()
    own_features: list[str] = []
    for metric in metrics:
        group = own.groupby("team", observed=True)[metric]
        for window in (3, 5):
            name = f"matchup_team_{metric}_avg{window}"
            own[name] = group.transform(lambda x, w=window: x.shift(1).rolling(w, min_periods=1).mean())
            own_features.append(name)
        name = f"matchup_team_{metric}_ewm"
        own[name] = group.transform(lambda x: x.shift(1).ewm(alpha=0.35, adjust=False).mean())
        own_features.append(name)
    defense = rows.rename(columns={"team": "offense", "opponent": "defense"}).sort_values(["defense", "season", "week", "game_id"]).copy()
    defense_features: list[str] = []
    for metric in metrics:
        group = defense.groupby("defense", observed=True)[metric]
        for window in (3, 5):
            name = f"matchup_opponent_allowed_{metric}_avg{window}"
            defense[name] = group.transform(lambda x, w=window: x.shift(1).rolling(w, min_periods=1).mean())
            defense_features.append(name)
        name = f"matchup_opponent_allowed_{metric}_ewm"
        defense[name] = group.transform(lambda x: x.shift(1).ewm(alpha=0.35, adjust=False).mean())
        defense_features.append(name)
    defense_key = "defense" if opponent_identity == "legacy_self" else "offense"
    defense_for_join = defense[["season", "week", "game_id", defense_key, *defense_features]].rename(
        columns={defense_key: "team"},
    )
    joined = own[[*identity, *own_features]].merge(
        defense_for_join, on=identity, validate="one_to_one"
    )
    return joined, [*own_features, *defense_features]


def add_opponent_shifted_team_features(rows: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Return shifted features keyed to the actual opponent defense."""
    return add_shifted_team_features(rows, opponent_identity="actual_opponent")


def game_environment(manifest: dict[str, Any]) -> tuple[pd.DataFrame, list[str]]:
    columns = ["season", "week", "season_type", "game_id", "roof", "temp", "wind"]
    rows = read_parquets(source_files(manifest, "pbp"), columns)
    rows = rows[rows["season_type"].fillna("").eq("REG")].drop_duplicates("game_id").copy()
    rows["matchup_temperature_f"] = pd.to_numeric(rows["temp"], errors="coerce")
    rows["matchup_wind_mph"] = pd.to_numeric(rows["wind"], errors="coerce")
    roof = rows["roof"].fillna("").astype(str).str.lower()
    rows["matchup_roof_outdoor"] = roof.str.contains("outdoors|outdoor|open").astype(float)
    rows["matchup_roof_fixed"] = roof.str.contains("dome|closed").astype(float)
    rows["matchup_week"] = pd.to_numeric(rows["week"], errors="coerce").astype(float)
    features = ["matchup_temperature_f", "matchup_wind_mph", "matchup_roof_outdoor", "matchup_roof_fixed", "matchup_week"]
    return rows[["season", "week", "game_id", *features]], features


def hgb(loss: str = "squared_error", leaves: int = 15, minimum_leaf: int = 20, regularization: float = 3.0) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss=loss, max_iter=180, max_leaf_nodes=leaves, learning_rate=0.045,
        min_samples_leaf=minimum_leaf, l2_regularization=regularization, random_state=SEED,
    )


def fit_predict(name: str, train: pd.DataFrame, test: pd.DataFrame, features: list[str], target: str) -> np.ndarray:
    if name == "hgb_squared":
        model = hgb("squared_error", 15)
    elif name == "hgb_absolute":
        model = hgb("absolute_error", 15)
    elif name == "hgb_poisson":
        model = hgb("poisson", 15, 25, 4.0)
    elif name == "hgb_shallow":
        model = hgb("squared_error", 7, 30, 5.0)
    elif name == "hgb_regularized":
        model = hgb("squared_error", 15, 45, 8.0)
    elif name == "hgb_wide":
        model = hgb("squared_error", 31)
    elif name == "extra_trees":
        model = ExtraTreesRegressor(n_estimators=240, min_samples_leaf=12, max_features=0.65, n_jobs=-1, random_state=SEED)
    elif name == "extra_trees_compact_48":
        model = ExtraTreesRegressor(
            n_estimators=48, max_depth=12, min_samples_leaf=12,
            max_features=0.65, n_jobs=-1, random_state=SEED,
        )
    elif name == "extra_trees_compact_72":
        model = ExtraTreesRegressor(
            n_estimators=72, max_depth=14, min_samples_leaf=12,
            max_features=0.65, n_jobs=-1, random_state=SEED,
        )
    elif name == "extra_trees_stable_48":
        model = ExtraTreesRegressor(
            n_estimators=48, max_depth=10, min_samples_leaf=20,
            max_features=0.75, n_jobs=-1, random_state=SEED,
        )
    elif name == "extra_trees_stable_24":
        model = ExtraTreesRegressor(
            n_estimators=24, max_depth=10, min_samples_leaf=20,
            max_features=0.75, n_jobs=-1, random_state=SEED,
        )
    elif name == "extra_trees_compact_32":
        model = ExtraTreesRegressor(
            n_estimators=32, max_depth=12, min_samples_leaf=14,
            max_features=0.65, n_jobs=-1, random_state=SEED,
        )
    else:
        raise ValueError(name)
    model.fit(train[features], train[target].to_numpy(float))
    return np.clip(np.asarray(model.predict(test[features]), dtype=float), 0.0, None)


def metrics(y: np.ndarray, p: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(y)), "mae": float(mean_absolute_error(y, p)),
        "rmse": float(math.sqrt(mean_squared_error(y, p))),
        "bias": float(np.mean(p - y)),
    }


def with_incumbent_blends(predictions: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    output = dict(predictions)
    incumbent = predictions["incumbent_hgb"]
    for name, prediction in list(predictions.items()):
        if name == "incumbent_hgb":
            continue
        for weight in (0.25, 0.5, 0.75):
            output[f"blend_{int(weight * 100)}_{name}"] = (1 - weight) * incumbent + weight * prediction
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    baseline = load_baseline()
    contract = json.loads(pathlib.Path("lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    team_features, team_feature_names = add_shifted_team_features(team_game_metrics(manifest))
    environment, environment_names = game_environment(manifest)
    frame = frame.merge(team_features, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *team_feature_names, *environment_names]
    masks = baseline.split_masks(frame, contract)
    report: dict[str, Any] = {}
    for target in MARKETS:
        config = contract["markets"][target]
        eligible = baseline.market_eligible(frame, config)
        train = frame[eligible & masks["training"]]
        selection = frame[eligible & masks["selection"]]
        confirmation = frame[eligible & masks["confirmation"]]
        holdout = frame[eligible & masks["holdout"]]
        candidates = {
            "incumbent_hgb": ("hgb_squared", base_features),
            "matchup_hgb": ("hgb_squared", enhanced_features),
            "matchup_shallow": ("hgb_shallow", enhanced_features),
            "matchup_regularized": ("hgb_regularized", enhanced_features),
        }
        if config["distribution"] != "count":
            candidates.update({
                "matchup_forest_compact_48": ("extra_trees_compact_48", enhanced_features),
                "matchup_forest_compact_72": ("extra_trees_compact_72", enhanced_features),
                "matchup_forest_stable_48": ("extra_trees_stable_48", enhanced_features),
                "matchup_forest_stable_24": ("extra_trees_stable_24", enhanced_features),
                "matchup_forest_compact_32": ("extra_trees_compact_32", enhanced_features),
            })
        if config["distribution"] == "count":
            candidates["matchup_poisson"] = ("hgb_poisson", enhanced_features)
        selection_predictions = with_incumbent_blends({
            name: fit_predict(model, train, selection, features, target)
            for name, (model, features) in candidates.items()
        })
        selection_scores = {name: metrics(selection[target].to_numpy(float), prediction)
                            for name, prediction in selection_predictions.items()}
        incumbent_selection = selection_scores["incumbent_hgb"]
        def joint_score(values: dict[str, float | int], reference: dict[str, float | int]) -> float:
            return (
                float(values["mae"]) / float(reference["mae"])
                + float(values["rmse"]) / float(reference["rmse"])
                + 0.10 * abs(float(values["bias"])) / max(float(reference["mae"]), 1e-6)
            )
        train_2023 = pd.concat([train, selection], ignore_index=True)
        confirmation_predictions = with_incumbent_blends({
            name: fit_predict(model, train_2023, confirmation, features, target)
            for name, (model, features) in candidates.items()
        })
        confirmation_scores = {name: metrics(confirmation[target].to_numpy(float), prediction)
                               for name, prediction in confirmation_predictions.items()}
        incumbent_confirmation = confirmation_scores["incumbent_hgb"]
        eligible_candidates = [name for name in selection_scores if (
            float(selection_scores[name]["mae"]) <= float(incumbent_selection["mae"]) * 1.01
            and float(selection_scores[name]["rmse"]) <= float(incumbent_selection["rmse"]) * 1.01
            and float(confirmation_scores[name]["mae"]) <= float(incumbent_confirmation["mae"]) * 1.01
            and float(confirmation_scores[name]["rmse"]) <= float(incumbent_confirmation["rmse"]) * 1.01
        )]
        selected = min(eligible_candidates, key=lambda name: (
            joint_score(selection_scores[name], incumbent_selection)
            + joint_score(confirmation_scores[name], incumbent_confirmation)
        ))
        confirmed = selected
        train_2024 = pd.concat([train_2023, confirmation], ignore_index=True)
        holdout_predictions = with_incumbent_blends({
            name: fit_predict(model, train_2024, holdout, features, target)
            for name, (model, features) in candidates.items()
        })
        incumbent_holdout = holdout_predictions["incumbent_hgb"]
        candidate_holdout = holdout_predictions[confirmed]
        y = holdout[target].to_numpy(float)
        report[target] = {
            "selection": selection_scores,
            "selected": selected,
            "confirmation": confirmation_scores,
            "confirmed": confirmed,
            "holdout": {
                "incumbent": metrics(y, incumbent_holdout),
                "candidate": metrics(y, candidate_holdout),
                "maeDelta": float(mean_absolute_error(y, candidate_holdout) - mean_absolute_error(y, incumbent_holdout)),
                "allCandidates": {name: metrics(y, prediction) for name, prediction in holdout_predictions.items()},
            },
        }
    output = {
        "release": "nfl_player_props_matchup_tournament_2026_09_28_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "addedFeatureCount": len(team_feature_names) + len(environment_names),
        "addedFeatureFamilies": [
            "team_and_opponent_play_mix", "passing_and_rushing_efficiency", "sack_pressure",
            "first_down_and_explosive_rates", "turnovers", "air_yards_and_yac", "weather_and_roof",
        ],
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "markets": {
        market: {"selected": value["selected"], "confirmed": value["confirmed"], "holdout": value["holdout"]}
        for market, value in report.items()
    }}, indent=2))


if __name__ == "__main__":
    main()
