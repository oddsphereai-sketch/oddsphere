"""Local-only NFL player-props shadow artifact loader and scorer.

This module returns projections and research probabilities. It has no grade,
stake, price, database, writer, route, or member-reader behavior.
"""

from __future__ import annotations

import math
import pathlib
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy import stats


EXPECTED_MODEL_RELEASE = "nfl_player_props_distribution_shadow_2026_08_25_r1"
EXPECTED_CALIBRATION_RELEASE = "nfl_player_props_distribution_calibration_shadow_2026_08_25_r2"


def load_shadow_artifact(path: pathlib.Path) -> dict[str, Any]:
    artifact = joblib.load(path)
    if artifact.get("shadowModelRelease") != EXPECTED_MODEL_RELEASE:
        raise RuntimeError("NFL props shadow model release mismatch")
    if artifact.get("calibrationRelease") != EXPECTED_CALIBRATION_RELEASE:
        raise RuntimeError("NFL props shadow calibration release mismatch")
    if artifact.get("mode") != "local_shadow_only" or artifact.get("actionable") is not False:
        raise RuntimeError("NFL props shadow artifact safety mode mismatch")
    return artifact


def over_probability(mean: np.ndarray, line: np.ndarray, distribution: dict[str, Any]) -> np.ndarray:
    mean = np.clip(np.asarray(mean, dtype=float), 1e-6, None)
    line = np.asarray(line, dtype=float)
    family = distribution["family"]
    if family == "negative_binomial":
        size = 1.0 / max(float(distribution["alpha"]), 1e-9)
        probability = size / (size + mean)
        return stats.nbinom.sf(np.floor(line), size, probability)
    if family == "poisson":
        return stats.poisson.sf(np.floor(line), mean)
    if family == "normal_residual":
        return stats.norm.sf(line, loc=mean, scale=max(float(distribution["scale"]), 1e-3))
    if family in {"empirical_residual", "empirical_residual_mean_bucket"}:
        probabilities = np.empty(len(mean), dtype=float)
        for index, (row_mean, row_line) in enumerate(zip(mean, line, strict=True)):
            selected = distribution
            if family == "empirical_residual_mean_bucket":
                selected = distribution["fallback"]
                for bucket in distribution["buckets"]:
                    if float(bucket["lower"]) <= row_mean <= float(bucket["upper"]):
                        selected = bucket["distribution"]
                        break
            residuals = np.asarray(selected["residualQuantiles"], dtype=float)
            cdf = np.searchsorted(residuals, row_line - row_mean, side="right") / len(residuals)
            probabilities[index] = 1.0 - cdf
        return probabilities
    raise RuntimeError(f"unsupported NFL props distribution family: {family}")


def _predict_component(component: dict[str, Any], frame: pd.DataFrame, features: list[str]) -> np.ndarray:
    if component.get("baselineColumn"):
        column = str(component["baselineColumn"])
        if column not in frame:
            raise RuntimeError(f"NFL props scoring row is missing {column}")
        return np.clip(frame[column].fillna(0).to_numpy(float), 0, None)
    model = component.get("model")
    if model is None:
        raise RuntimeError("NFL props scoring component has no model")
    return np.clip(np.asarray(model.predict(frame[features]), dtype=float), 0, None)


def score_shadow_rows(
    artifact: dict[str, Any],
    frame: pd.DataFrame,
    offered_lines: dict[str, np.ndarray] | None = None,
) -> pd.DataFrame:
    features = list(artifact["featureColumns"])
    missing = [column for column in features if column not in frame]
    if missing:
        raise RuntimeError(f"NFL props scoring rows are missing {len(missing)} features")
    result = frame[[column for column in ("row_id", "game_id", "player_id", "player_name", "team", "position") if column in frame]].copy()
    participation = artifact["participationModel"]
    if participation["kind"] == "prior_avg5":
        probability = frame[participation["baselineColumn"]].fillna(0).to_numpy(float)
    else:
        probability = participation["model"].predict_proba(frame[features])[:, 1]
    result["participation_probability"] = np.clip(probability, 0.01, 0.99)
    for market, component in artifact["markets"].items():
        mean = _predict_component(component, frame, features)
        result[f"{market}_projection"] = mean
        if offered_lines and market in offered_lines:
            lines = np.asarray(offered_lines[market], dtype=float)
            if len(lines) != len(frame) or not np.isfinite(lines).all():
                raise RuntimeError(f"NFL props {market} offered lines are invalid")
            result[f"{market}_line"] = lines
            result[f"{market}_over_probability_research_only"] = over_probability(mean, lines, component["distribution"])
    result["shadow_model_release"] = artifact["shadowModelRelease"]
    result["calibration_release"] = artifact["calibrationRelease"]
    result["actionable"] = False
    result["line_probability_ready"] = False
    return result
