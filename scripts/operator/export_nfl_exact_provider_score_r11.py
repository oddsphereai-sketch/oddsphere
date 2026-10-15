#!/usr/bin/env python3
"""Export the selected NFL r11 independent score runtime artifact.

The artifact contains only pregame football inputs. Market prices, lines,
movement, and split evidence are intentionally absent; the market reader is a
separate categorical layer applied after this independent score is produced.
"""

from __future__ import annotations

import hashlib
import gzip
import json
import math
import pathlib
from collections import defaultdict
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.pipeline import Pipeline

import build_nfl_pregame_features as feature_builder
import tournament_nfl_dynamic_state_score_rebuild_r2 as r2
import tournament_nfl_independent_score_rebuild_r1 as r1
import tournament_nfl_provider_play_independent_r5 as r5


ARTIFACT_RELEASE = "nfl_exact_provider_score_artifact_2026_10_15_r11"
MODEL_RELEASE = "nfl_exact_provider_independent_score_2026_10_15_r11"
MARGIN_RELEASE = "nfl_exact_provider_margin_2026_10_15_r7"
TOTAL_RELEASE = "nfl_exact_provider_state_residual_total_2026_10_15_r10"
FEATURE_RELEASE = "nfl_exact_provider_runtime_features_2026_10_15_r1"
STRICT_METRICS = (
    "explosive_rate", "sack_rate", "turnover_rate", "plays",
    "redzone_td_rate", "no_huddle_rate", "points",
)
STATE_RECIPE = r2.StateRecipe(
    state_gain=0.1,
    offseason_carry=0.65,
    home_field_margin=2.5,
    league_gain=0.06,
)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite_or_none(value: Any) -> float | None:
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def imputer_payload(pipeline: Pipeline, features: list[str]) -> dict[str, Any]:
    imputer = pipeline.named_steps["imputer"]
    indicator = list(getattr(imputer.indicator_, "features_", [])) if getattr(imputer, "indicator_", None) is not None else []
    return {
        "inputFeatures": features,
        "imputerStatistics": [finite_or_none(value) for value in imputer.statistics_],
        "missingIndicatorFeatureIndexes": [int(value) for value in indicator],
    }


def export_model(pipeline: Pipeline, features: list[str]) -> dict[str, Any]:
    payload = imputer_payload(pipeline, features)
    model = pipeline.named_steps["model"]
    if isinstance(model, ExtraTreesRegressor):
        trees: list[dict[str, Any]] = []
        for estimator in model.estimators_:
            tree = estimator.tree_
            missing = getattr(tree, "missing_go_to_left", np.zeros(tree.node_count, dtype=bool))
            nodes = []
            for index in range(tree.node_count):
                threshold = float(tree.threshold[index])
                nodes.append([
                    float(np.ravel(tree.value[index])[0]),
                    int(tree.feature[index]),
                    threshold if np.isfinite(threshold) else (1e308 if threshold > 0 else -1e308),
                    1 if bool(missing[index]) else 0,
                    int(tree.children_left[index]),
                    int(tree.children_right[index]),
                    1 if int(tree.children_left[index]) == int(tree.children_right[index]) else 0,
                ])
            trees.append({"nodes": nodes})
        return {**payload, "kind": "extra_trees_regressor", "trees": trees}
    if isinstance(model, HistGradientBoostingRegressor):
        iterations: list[list[dict[str, Any]]] = []
        for iteration in model._predictors:  # noqa: SLF001 - frozen sklearn export
            trees = []
            for predictor in iteration:
                nodes = []
                for node in predictor.nodes:
                    if bool(node["is_categorical"]):
                        raise RuntimeError("categorical HGB nodes are unsupported")
                    threshold = float(node["num_threshold"])
                    nodes.append([
                        float(node["value"]), int(node["feature_idx"]),
                        threshold if np.isfinite(threshold) else (1e308 if threshold > 0 else -1e308),
                        1 if bool(node["missing_go_to_left"]) else 0,
                        int(node["left"]), int(node["right"]), 1 if bool(node["is_leaf"]) else 0,
                    ])
                trees.append({"nodes": nodes})
            iterations.append(trees)
        return {
            **payload,
            "kind": "hgb_regressor",
            "baseline": float(np.ravel(model._baseline_prediction)[0]),  # noqa: SLF001
            "trees": iterations,
        }
    scaler = pipeline.named_steps.get("scale")
    if scaler is None or not hasattr(model, "coef_"):
        raise TypeError(f"unsupported model: {type(model)}")
    return {
        **payload,
        "kind": "linear_regressor",
        "scalerMean": [float(value) for value in scaler.mean_],
        "scalerScale": [float(value) for value in scaler.scale_],
        "coefficients": [float(value) for value in np.ravel(model.coef_)],
        "intercept": float(np.ravel(np.asarray(model.intercept_))[0]),
    }


def dynamic_state_after(games: pd.DataFrame, through_season: int) -> dict[str, Any]:
    offense: defaultdict[str, float] = defaultdict(float)
    defense: defaultdict[str, float] = defaultdict(float)
    league_points = 22.5
    current_season: int | None = None
    subset = games[games["season"].le(through_season)].sort_values(["season", "week", "game_id"])
    for (season_value, _), week_games in subset.groupby(["season", "week"], sort=True):
        season = int(season_value)
        if current_season != season:
            if current_season is not None:
                for team in set(offense) | set(defense):
                    offense[team] *= STATE_RECIPE.offseason_carry
                    defense[team] *= STATE_RECIPE.offseason_carry
            current_season = season
        updates: list[tuple[str, str, float]] = []
        observed_scores: list[float] = []
        for game in week_games.itertuples(index=False):
            home = str(game.home_team); away = str(game.away_team)
            home_expected = league_points + offense[home] + defense[away] + STATE_RECIPE.home_field_margin / 2.0
            away_expected = league_points + offense[away] + defense[home] - STATE_RECIPE.home_field_margin / 2.0
            home_residual = float(game.home_score) - home_expected
            away_residual = float(game.away_score) - away_expected
            updates.extend([
                (home, "offense", home_residual), (away, "defense", home_residual),
                (away, "offense", away_residual), (home, "defense", away_residual),
            ])
            observed_scores.extend([float(game.home_score), float(game.away_score)])
        for team, unit, residual in updates:
            change = STATE_RECIPE.state_gain * residual / 2.0
            if unit == "offense": offense[team] += change
            else: defense[team] += change
        active = sorted(set(offense) | set(defense))
        offense_mean = float(np.mean([offense[team] for team in active]))
        defense_mean = float(np.mean([defense[team] for team in active]))
        for team in active:
            offense[team] -= offense_mean
            defense[team] -= defense_mean
        week_mean = float(np.mean(observed_scores))
        league_points = (1.0 - STATE_RECIPE.league_gain) * league_points + STATE_RECIPE.league_gain * week_mean
    return {
        "leaguePoints": league_points,
        "teams": {team: {"offense": offense[team], "defense": defense[team]} for team in sorted(set(offense) | set(defense))},
    }


def predict_portable(model: dict[str, Any], row: dict[str, float | None]) -> float:
    raw = np.asarray([row.get(name, np.nan) for name in model["inputFeatures"]], dtype=float)
    missing = ~np.isfinite(raw)
    base = np.asarray(model["imputerStatistics"], dtype=float)
    values = np.where(missing, base, raw)
    values = np.concatenate([values, missing[np.asarray(model["missingIndicatorFeatureIndexes"], dtype=int)].astype(float)])
    kind = model["kind"]
    if kind == "linear_regressor":
        scaled = (values - np.asarray(model["scalerMean"], dtype=float)) / np.asarray(model["scalerScale"], dtype=float)
        return float(model["intercept"] + np.dot(np.asarray(model["coefficients"], dtype=float), scaled))
    def walk(nodes: list[list[float]], vector: np.ndarray) -> float:
        index = 0
        while not bool(nodes[index][6]):
            node = nodes[index]; value = vector[int(node[1])]
            index = int(node[4] if (not np.isfinite(value) and bool(node[3])) or (np.isfinite(value) and value <= float(node[2])) else node[5])
        return float(nodes[index][0])
    if kind == "extra_trees_regressor":
        return float(np.mean([walk(tree["nodes"], values) for tree in model["trees"]]))
    if kind == "hgb_regressor":
        return float(model["baseline"] + sum(walk(tree["nodes"], values) for iteration in model["trees"] for tree in iteration))
    raise RuntimeError(kind)


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2026_exact_replay_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    games = pd.read_parquet(manifest["featureFile"]).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    train = games[games["season"].le(2025)].reset_index(drop=True)
    exact = games[games["season"].eq(2026)].reset_index(drop=True)

    original_metrics = r5.METRICS
    r5.METRICS = STRICT_METRICS
    try:
        feature_frame = r5.features(train)
        margin_pipeline = r5.factories()["extra_trees_regularized"]().fit(feature_frame, train["actual_margin"].to_numpy(float))
        base = r2.dynamic_scores(games, STATE_RECIPE)["total"]
        train_mask = games["season"].le(2025).to_numpy()
        total_target = train["actual_total"].to_numpy(float) - base[train_mask]
        residual_models = {
            name: factory().fit(feature_frame, total_target)
            for name, factory in r5.factories().items()
        }
        margin_artifact = export_model(margin_pipeline, list(feature_frame.columns))
        residual_artifacts = {
            name: export_model(residual_models[name], list(feature_frame.columns))
            for name in ("ridge_30", "ridge_100", "ridge_300", "hist_regularized", "extra_trees_regularized")
        }
    finally:
        r5.METRICS = original_metrics

    state_path = root / "football-research/cache/nfl-model/nfl_state_after_2026_exact_replay_r1.json"
    historical_state = json.loads(state_path.read_text(encoding="utf-8"))
    team_states = {}
    for team, state in historical_state["teamStates"].items():
        team_states[team] = {
            "offFast": {metric: state["offFast"][metric] for metric in STRICT_METRICS},
            "offSlow": {metric: state["offSlow"][metric] for metric in STRICT_METRICS},
            "defFast": {metric: state["defFast"][metric] for metric in STRICT_METRICS},
            "defSlow": {metric: state["defSlow"][metric] for metric in STRICT_METRICS},
            "offAdjusted": {metric: state["offAdjusted"][metric] for metric in STRICT_METRICS},
            "defAdjusted": {metric: state["defAdjusted"][metric] for metric in STRICT_METRICS},
            "elo": state["elo"], "games": state["games"],
        }

    artifact = {
        "artifactRelease": ARTIFACT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "marginRelease": MARGIN_RELEASE,
        "totalRelease": TOTAL_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": "2026-10-15T00:00:00.000Z",
        "marketInputPolicy": "prohibited_from_independent_score",
        "source": {
            "featureManifestSha256": sha256_file(manifest_path),
            "featureFileSha256": manifest["featureFileSha256"],
            "stateFileSha256": sha256_file(state_path),
            "marginTournamentRelease": "nfl_exact_provider_independent_tournament_2026_10_15_r7",
            "totalTournamentRelease": "nfl_exact_provider_total_residual_tournament_2026_10_15_r10",
        },
        "chronology": {"fitSeasons": list(range(2016, 2026)), "openedReplaySeason": 2026, "sameGameOutcomeLeakage": False},
        "metrics": list(STRICT_METRICS),
        "priors": {metric: r1.METRIC_PRIORS[metric] for metric in STRICT_METRICS},
        "teamState": {
            "fastAlpha": feature_builder.FAST_ALPHA,
            "slowAlpha": feature_builder.SLOW_ALPHA,
            "offseasonCarry": feature_builder.TEAM_OFFSEASON_CARRY,
            "trainedThroughSeason": 2026,
            "completeThroughWeek": int(exact["week"].max()),
            "teams": team_states,
        },
        "dynamicTotalState": {
            "stateGain": STATE_RECIPE.state_gain,
            "offseasonCarry": STATE_RECIPE.offseason_carry,
            "homeFieldMargin": STATE_RECIPE.home_field_margin,
            "leagueGain": STATE_RECIPE.league_gain,
            "trainedThroughSeason": 2026,
            "completeThroughWeek": int(exact["week"].max()),
            **dynamic_state_after(games, 2026),
        },
        "models": {
            "margin": margin_artifact,
            "totalResidualComponents": residual_artifacts,
        },
        "totalResidual": {"componentWeights": {name: 0.2 for name in residual_artifacts}, "weight": 1.0, "cap": 4.0},
    }

    # Exact Python-to-portable parity on every opened 2026 row.
    original_metrics = r5.METRICS
    r5.METRICS = STRICT_METRICS
    try:
        exact_features = r5.features(exact)
    finally:
        r5.METRICS = original_metrics
    direct = margin_pipeline.predict(exact_features)
    portable = np.asarray([
        predict_portable(margin_artifact, {key: finite_or_none(value) for key, value in row.items()})
        for row in exact_features.to_dict("records")
    ])
    maximum_error = float(np.max(np.abs(direct - portable)))
    if maximum_error > 1e-10:
        raise RuntimeError(f"portable margin parity failed: {maximum_error}")
    residual_direct = np.mean(np.vstack([
        residual_models[name].predict(exact_features)
        for name in residual_artifacts
    ]), axis=0)
    residual_portable = np.mean(np.vstack([
        np.asarray([
            predict_portable(model, {key: finite_or_none(value) for key, value in row.items()})
            for row in exact_features.to_dict("records")
        ])
        for model in residual_artifacts.values()
    ]), axis=0)
    exact_base = base[games["season"].eq(2026).to_numpy()]
    total_direct = exact_base + np.clip(residual_direct, -4.0, 4.0)
    total_portable = exact_base + np.clip(residual_portable, -4.0, 4.0)
    maximum_total_error = float(np.max(np.abs(total_direct - total_portable)))
    if maximum_total_error > 1e-10:
        raise RuntimeError(f"portable total parity failed: {maximum_total_error}")
    artifact["parity"] = {
        "rows": len(exact),
        "maximumAbsoluteMarginError": maximum_error,
        "maximumAbsoluteTotalError": maximum_total_error,
        "cases": [
            {
                "gameId": str(exact.iloc[index]["game_id"]),
                "features": {key: finite_or_none(value) for key, value in exact_features.iloc[index].to_dict().items()},
                "baseTotal": float(exact_base[index]),
                "margin": float(direct[index]),
                "total": float(total_direct[index]),
            }
            for index in (0, len(exact) // 2, len(exact) - 1)
        ],
    }

    serialized = json.dumps(artifact, separators=(",", ":"), allow_nan=False) + "\n"
    payload_output = root / "lib/services/football/modelArtifacts/nflExactProviderScoreR11.json.gz"
    compressed = gzip.compress(serialized.encode("utf-8"), compresslevel=9, mtime=0)
    payload_output.write_bytes(compressed)
    print(json.dumps({
        "artifactBytes": len(serialized.encode("utf-8")),
        "artifactSha256": hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
        "parityRows": len(exact),
        "runtimePayload": str(payload_output), "runtimePayloadBytes": payload_output.stat().st_size,
        "runtimePayloadSha256": sha256_file(payload_output),
        "maximumAbsoluteMarginError": maximum_error,
        "maximumAbsoluteTotalError": maximum_total_error,
    }, indent=2))


if __name__ == "__main__":
    main()
