#!/usr/bin/env python3
"""Export the fixed R44 NFL pressure-direction runtime artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


ARTIFACT_RELEASE = "nfl_pressure_direction_runtime_artifact_2026_09_27_r1"
MODEL_RELEASE = "nfl_pressure_direction_margin_2026_09_27_r1"
FEATURE_RELEASE = "nfl_player_value_features_2016_2025_2026_08_20_r3"
TRAINED_THROUGH = 2025
C = 0.03
HALF_LIFE_WEEKS = 128.0
CORRECTION_SCALE = 0.5
CORRECTION_CAP = 3.0
OFFSEASON_CARRY = 0.65
FAST_ALPHA = 0.35
SLOW_ALPHA = 0.16
PRIORS = {"sack_rate": 0.070, "turnover_rate": 0.022}


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--feature-path", type=pathlib.Path, required=True)
    parser.add_argument("--state-path", type=pathlib.Path, required=True)
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=pathlib.Path("lib/services/football/modelArtifacts/nflPressureDirectionRuntime.json"),
    )
    args = parser.parse_args()

    frame = pd.read_parquet(args.feature_path).replace([np.inf, -np.inf], np.nan)
    if set(frame["season"].dropna().astype(int).unique()) - set(range(2016, TRAINED_THROUGH + 1)):
        raise RuntimeError("R44 feature artifact contains an unexpected season")
    numeric = [column for column in frame.columns if pd.api.types.is_numeric_dtype(frame[column])]
    features = sorted(column for column in numeric if "matchup_" in column and any(
        token in column for token in ("sack_rate", "turnover_rate")
    ))
    if len(features) != 8:
        raise RuntimeError(f"R44 pressure feature contract drift: {features}")
    fit = frame[frame[["actual_margin", "market_home_margin"]].notna().all(axis=1)].copy()
    residual = fit["actual_margin"].to_numpy(float) - fit["market_home_margin"].to_numpy(float)
    resolved = ~np.isclose(residual, 0.0)
    model = make_pipeline(
        SimpleImputer(strategy="median", add_indicator=True),
        StandardScaler(),
        LogisticRegression(C=C, penalty="l2", solver="lbfgs", max_iter=2000),
    )
    age = 2026 * 20.0 - (fit.loc[resolved, "season"].to_numpy(float) * 20.0 + fit.loc[resolved, "week"].to_numpy(float))
    weights = np.power(0.5, age / HALF_LIFE_WEEKS)
    model.fit(fit.loc[resolved, features], residual[resolved] > 0.0, logisticregression__sample_weight=weights)
    imputer = model.named_steps["simpleimputer"]
    scaler = model.named_steps["standardscaler"]
    logistic = model.named_steps["logisticregression"]

    source_state = json.loads(args.state_path.read_text(encoding="utf-8"))
    if source_state.get("trainedThrough") != "2025-12-31":
        raise RuntimeError("R44 state artifact is not trained through 2025")
    teams = {
        team: {
            bucket: {metric: float(values[bucket][metric]) for metric in PRIORS}
            for bucket in ("offFast", "offSlow", "defFast", "defSlow")
        }
        for team, values in sorted(source_state["teamStates"].items())
    }
    if len(teams) != 32:
        raise RuntimeError("R44 state artifact must contain 32 teams")

    artifact = {
        "artifactRelease": ARTIFACT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "trainedThrough": TRAINED_THROUGH,
        "source": {
            "featureSha256": sha256(args.feature_path),
            "stateSha256": sha256(args.state_path),
        },
        "recipe": {
            "regularizationC": C,
            "halfLifeWeeks": HALF_LIFE_WEEKS,
            "correctionScale": CORRECTION_SCALE,
            "correctionCap": CORRECTION_CAP,
            "residualSd": float(np.std(residual, ddof=1)),
            "offseasonCarry": OFFSEASON_CARRY,
            "fastAlpha": FAST_ALPHA,
            "slowAlpha": SLOW_ALPHA,
            "priors": PRIORS,
        },
        "features": features,
        "imputer": {
            "statistics": [float(value) for value in imputer.statistics_],
            "indicatorFeatures": [int(value) for value in imputer.indicator_.features_],
        },
        "scaler": {
            "mean": [float(value) for value in scaler.mean_],
            "scale": [float(value) for value in scaler.scale_],
        },
        "logistic": {
            "coefficients": [float(value) for value in logistic.coef_[0]],
            "intercept": float(logistic.intercept_[0]),
        },
        "teams": teams,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "artifactRelease": ARTIFACT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "features": len(features),
        "teams": len(teams),
        "output": str(args.output),
        "sha256": sha256(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
