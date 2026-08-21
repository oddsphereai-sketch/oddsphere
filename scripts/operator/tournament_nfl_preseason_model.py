#!/usr/bin/env python3
"""Fit a separate NFL preseason model from genuine preseason outcomes.

The small-sample model intentionally excludes the regular-season calibration and
is permanently tracking-ineligible. Selection uses pooled expanding-window 2022-
2024 predictions; 2025 is opened once as the historical holdout.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from typing import Any, Callable

import joblib
import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.base import RegressorMixin
from sklearn.ensemble import ExtraTreesRegressor, GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import brier_score_loss, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


TOURNAMENT_RELEASE = "nfl_preseason_real_model_tournament_2026_08_19_r1"
MODEL_RELEASE = "nfl_preseason_real_local_candidate_2026_08_19_r2"
FEATURE_RELEASE = "nfl_preseason_prior_regular_state_features_2026_08_19_r1"
SOURCE_RELEASE = "bdl_nfl_preseason_games_2019_2025_2026_08_19_r2"
REGULAR_FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
HOLDOUT_SEASON = 2025
RANDOM_STATE = 19082026

METRIC_PRIORS = {
    "epa": 0.0, "pass_epa": 0.0, "rush_epa": 0.0, "success": 0.43,
    "early_down_pass_epa": 0.0, "explosive_rate": 0.105, "sack_rate": 0.070,
    "turnover_rate": 0.022, "plays": 64.0, "redzone_td_rate": 0.55,
    "no_huddle_rate": 0.10, "pass_oe": 0.0, "points": 22.5,
}


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_team(value: Any) -> str:
    team = str(value or "").upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def model_factories() -> dict[str, Callable[[], RegressorMixin]]:
    def ridge(alpha: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", Ridge(alpha=alpha)),
        ])

    def tree(model: RegressorMixin) -> Pipeline:
        return Pipeline([("imputer", SimpleImputer(strategy="median")), ("model", model)])

    return {
        "ridge_30": lambda: ridge(30.0),
        "ridge_100": lambda: ridge(100.0),
        "ridge_300": lambda: ridge(300.0),
        "gbr_huber": lambda: tree(GradientBoostingRegressor(
            loss="huber", n_estimators=180, learning_rate=0.025, max_depth=2,
            min_samples_leaf=10, random_state=RANDOM_STATE,
        )),
        "extra_trees": lambda: tree(ExtraTreesRegressor(
            n_estimators=500, min_samples_leaf=6, max_features=0.7,
            n_jobs=-1, random_state=RANDOM_STATE,
        )),
        "random_forest": lambda: tree(RandomForestRegressor(
            n_estimators=500, min_samples_leaf=8, max_features=0.7,
            n_jobs=-1, random_state=RANDOM_STATE,
        )),
    }


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float]:
    error = prediction - actual
    return {
        "mae": float(mean_absolute_error(actual, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(actual, prediction))),
        "bias": float(np.mean(error)),
        "correlation": float(np.corrcoef(actual, prediction)[0, 1]),
    }


def load_data(root: pathlib.Path) -> tuple[pd.DataFrame, list[str], dict[str, Any]]:
    manifest_path = root / "football-research/cache/balldontlie/nfl_preseason_games_2019_2025.latest.json"
    source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if source_manifest.get("cacheRelease") != SOURCE_RELEASE:
        raise RuntimeError("preseason source release mismatch")
    source_path = manifest_path.parent / source_manifest["filename"]
    if sha256_file(source_path) != source_manifest["sha256"]:
        raise RuntimeError("preseason source checksum mismatch")
    games = json.loads(source_path.read_text(encoding="utf-8"))

    feature_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    regular_manifest = json.loads(feature_manifest_path.read_text(encoding="utf-8"))
    if regular_manifest.get("featureRelease") != REGULAR_FEATURE_RELEASE:
        raise RuntimeError("regular feature source release mismatch")
    feature_path = pathlib.Path(regular_manifest["featureFile"])
    if sha256_file(feature_path) != regular_manifest["featureFileSha256"]:
        raise RuntimeError("regular feature checksum mismatch")
    regular = pd.read_parquet(feature_path)

    state_columns = [column for column in regular.columns if any(token in column for token in [
        "_elo", "_off_fast_", "_off_slow_", "_def_fast_", "_def_slow_", "_off_adj_", "_def_adj_"
    ])]
    team_states: dict[tuple[int, str], dict[str, float]] = {}
    for season, season_rows in regular.groupby("season"):
        week_one = season_rows[season_rows["week"] == season_rows["week"].min()]
        for game in week_one.itertuples(index=False):
            row = game._asdict()
            for side in ["home", "away"]:
                team = str(row[f"{side}_team"])
                team_states[(int(season), team)] = {
                    column.removeprefix(f"{side}_"): float(row[column])
                    for column in state_columns if column.startswith(f"{side}_")
                }

    teams = sorted({normalize_team(game[side]["abbreviation"]) for game in games for side in ["home", "away"]})
    rows: list[dict[str, Any]] = []
    for game in games:
        season = int(game["season"])
        if season == 2020:
            continue
        home = normalize_team(game["home"]["abbreviation"])
        away = normalize_team(game["away"]["abbreviation"])
        home_state = team_states.get((season, home))
        away_state = team_states.get((season, away))
        if home_state is None or away_state is None:
            raise RuntimeError(f"missing prior regular state for {away} at {home}, {season}")
        row: dict[str, Any] = {
            "feature_release": FEATURE_RELEASE,
            "game_id": str(game["id"]),
            "season": season,
            "week": int(game["week"]),
            "home_team": home,
            "away_team": away,
            "actual_margin": float(game["homeScore"]) - float(game["awayScore"]),
            "actual_total": float(game["homeScore"]) + float(game["awayScore"]),
            "home_elo": home_state["elo"],
            "away_elo": away_state["elo"],
            "elo_diff": home_state["elo"] - away_state["elo"],
        }
        for metric, prior in METRIC_PRIORS.items():
            for side, state in [("home", home_state), ("away", away_state)]:
                for bucket in ["off_fast", "off_slow", "def_fast", "def_slow", "off_adj", "def_adj"]:
                    row[f"{side}_{bucket}_{metric}"] = state[f"{bucket}_{metric}"]
            row[f"home_matchup_fast_{metric}"] = home_state[f"off_fast_{metric}"] - (away_state[f"def_fast_{metric}"] - prior)
            row[f"away_matchup_fast_{metric}"] = away_state[f"off_fast_{metric}"] - (home_state[f"def_fast_{metric}"] - prior)
            row[f"home_matchup_slow_{metric}"] = home_state[f"off_slow_{metric}"] - (away_state[f"def_slow_{metric}"] - prior)
            row[f"away_matchup_slow_{metric}"] = away_state[f"off_slow_{metric}"] - (home_state[f"def_slow_{metric}"] - prior)
        for team in teams:
            row[f"team_effect_{team}"] = float(home == team) - float(away == team)
        rows.append(row)
    frame = pd.DataFrame(rows).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    excluded = {"game_id", "season", "home_team", "away_team", "actual_margin", "actual_total"}
    feature_names = sorted(column for column in frame.columns if column not in excluded and pd.api.types.is_numeric_dtype(frame[column]))
    source = {
        "preseasonManifestSha256": sha256_file(manifest_path),
        "preseasonDataSha256": source_manifest["sha256"],
        "regularFeatureSha256": regular_manifest["featureFileSha256"],
    }
    return frame, feature_names, source


def fit_target(frame: pd.DataFrame, feature_names: list[str], target: str) -> tuple[dict[str, Any], dict[str, Any]]:
    factories = model_factories()
    oos_predictions: dict[str, list[np.ndarray]] = {name: [] for name in factories}
    oos_actual: list[np.ndarray] = []
    oos_seasons: list[np.ndarray] = []
    for season in [2022, 2023, 2024]:
        train = frame[frame["season"] < season]
        test = frame[frame["season"] == season]
        oos_actual.append(test[target].to_numpy(float))
        oos_seasons.append(np.full(len(test), season))
        for name, factory in factories.items():
            model = factory()
            model.fit(train[feature_names], train[target].to_numpy(float))
            oos_predictions[name].append(np.asarray(model.predict(test[feature_names]), dtype=float))
    actual = np.concatenate(oos_actual)
    predictions = {name: np.concatenate(values) for name, values in oos_predictions.items()}
    candidates: list[tuple[str, tuple[tuple[str, float], ...], np.ndarray]] = [
        (name, ((name, 1.0),), values) for name, values in predictions.items()
    ]
    names = sorted(predictions)
    for index, first in enumerate(names):
        for second in names[index + 1:]:
            candidates.append((
                f"blend_{first}_{second}", ((first, 0.5), (second, 0.5)),
                0.5 * predictions[first] + 0.5 * predictions[second],
            ))
    ranked = [{"name": name, "components": components, **point_metrics(actual, values)} for name, components, values in candidates]
    ranked.sort(key=lambda item: (item["mae"], item["rmse"], len(item["components"])))
    selected = ranked[0]
    selected_oos = next(values for name, _, values in candidates if name == selected["name"])

    development = frame[frame["season"] < HOLDOUT_SEASON]
    holdout = frame[frame["season"] == HOLDOUT_SEASON].copy()
    models: dict[str, RegressorMixin] = {}
    holdout_prediction = np.zeros(len(holdout))
    for name, weight in selected["components"]:
        model = factories[name]()
        model.fit(development[feature_names], development[target].to_numpy(float))
        models[name] = model
        holdout_prediction += weight * np.asarray(model.predict(holdout[feature_names]), dtype=float)
    holdout["prediction"] = holdout_prediction
    residuals = actual - selected_oos
    report = {
        "target": target,
        "selectedRecipe": {"name": selected["name"], "components": selected["components"]},
        "selection": {"seasons": [2022, 2023, 2024], "rows": len(actual), **point_metrics(actual, selected_oos)},
        "holdout": {"season": HOLDOUT_SEASON, "rows": len(holdout), **point_metrics(holdout[target].to_numpy(float), holdout_prediction)},
        "topCandidates": ranked[:10],
        "residualStdDev": float(np.std(residuals, ddof=1)),
    }
    artifact = {"models": models, "components": selected["components"], "residuals": residuals, "holdout": holdout}
    return report, artifact


def empirical_probability(prediction: np.ndarray, threshold: float, residuals: np.ndarray) -> np.ndarray:
    return np.mean(norm.cdf((prediction[:, None] + residuals[None, :] - threshold) / 1.5), axis=1)


def main() -> None:
    root = pathlib.Path.cwd()
    frame, feature_names, sources = load_data(root)
    if len(frame) != 309 or frame["game_id"].duplicated().any():
        raise RuntimeError(f"unexpected preseason model frame: {len(frame)}")
    margin_report, margin_artifact = fit_target(frame, feature_names, "actual_margin")
    total_report, total_artifact = fit_target(frame, feature_names, "actual_total")
    holdout = margin_artifact["holdout"].merge(
        total_artifact["holdout"][["game_id", "prediction"]], on="game_id", suffixes=("_margin", "_total"), validate="one_to_one"
    )
    home_win = empirical_probability(
        holdout["prediction_margin"].to_numpy(float), 0.0, margin_artifact["residuals"]
    )
    non_ties = holdout["actual_margin"].ne(0).to_numpy(bool)
    win_brier = float(brier_score_loss(holdout.loc[non_ties, "actual_margin"].gt(0), home_win[non_ties]))

    artifact_root = root / "football-research/cache/nfl-model"
    artifact_path = artifact_root / "nfl_preseason_real_local_candidate_2026_08_19_r2.joblib"
    artifact = {
        "modelRelease": MODEL_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "featureNames": feature_names,
        "margin": {key: value for key, value in margin_artifact.items() if key != "holdout"},
        "total": {key: value for key, value in total_artifact.items() if key != "holdout"},
        "trainedThrough": "2024-08-31",
        "trackingEligible": False,
    }
    joblib.dump(artifact, artifact_path, compress=3)
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": sources,
        "rows": len(frame),
        "featureCount": len(feature_names),
        "margin": margin_report,
        "total": total_report,
        "holdoutHomeWinBrier": win_brier,
        "artifact": str(artifact_path),
        "artifactSha256": sha256_file(artifact_path),
        "localOnly": True,
        "actionable": False,
        "trackingEligible": False,
        "trackingPolicy": "preseason_permanently_excluded",
        "limitations": [
            "309 games is a small regime-specific sample",
            "historical quarterback rotation and starter snap plans are unavailable",
            "historical comparable-timestamp preseason odds are unavailable, so market value is not backtested",
            "current price may be shown as context but is not an input to the fitted preseason projection",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "modelRelease": MODEL_RELEASE,
        "margin": margin_report,
        "total": total_report,
        "holdoutHomeWinBrier": win_brier,
        "report": str(report_path),
        "artifactSha256": report["artifactSha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
