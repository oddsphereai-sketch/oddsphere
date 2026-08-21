#!/usr/bin/env python3
"""Refit the frozen r2 regular-season architecture through 2025 for 2026 shadow use."""

from __future__ import annotations

import hashlib
import json
import pathlib
import sys
import time

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from tournament_nfl_real_model import (  # noqa: E402
    MarketRecipe,
    ProbabilityCalibrator,
    Recipe,
    estimator_factories,
    feature_columns,
)

# The source artifact was produced by running the tournament module as a script,
# so pickle recorded these classes under __main__. Keep the names bound here.
_PICKLE_CLASS_BINDINGS = (Recipe, MarketRecipe, ProbabilityCalibrator)


SOURCE_MODEL_RELEASE = "nfl_pregame_real_local_candidate_2026_08_19_r2"
MODEL_RELEASE = "nfl_pregame_real_local_current_refit_2026_08_19_r3"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
CALIBRATION_RELEASE = "nfl_empirical_residual_probability_2026_08_19_r1"


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fit_recipe(frame: pd.DataFrame, features: list[str], target: str, recipe: dict) -> dict:
    models = {}
    for component in recipe["components"]:
        name = component["model"]
        if name in models:
            continue
        model = estimator_factories()[name]()
        model.fit(frame[features], frame[target].to_numpy(float))
        models[name] = model
    return models


def main() -> None:
    root = pathlib.Path.cwd()
    report_path = root / "football-research/reports/nfl_real_pregame_model_tournament_2026_08_19_r1.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("modelRelease") != SOURCE_MODEL_RELEASE or report.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("frozen r2 tournament release mismatch")
    feature_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    feature_manifest = json.loads(feature_manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(feature_manifest["featureFile"])
    if feature_manifest.get("featureRelease") != FEATURE_RELEASE or sha256_file(feature_path) != feature_manifest["featureFileSha256"]:
        raise RuntimeError("frozen regular feature artifact mismatch")
    frame = pd.read_parquet(feature_path)
    train = frame[(frame["season"] >= 2018) & (frame["season"] <= 2025)].copy()
    features = feature_columns(train)
    margin_recipe = report["margin"]["independentRecipe"]
    total_recipe = report["total"]["independentRecipe"]
    margin_models = fit_recipe(train, features, "actual_margin", margin_recipe)
    total_models = fit_recipe(train, features, "actual_total", total_recipe)

    source_artifact_path = root / "football-research/cache/nfl-model/nfl_pregame_real_local_candidate_2026_08_19_r2.joblib"
    source_artifact = joblib.load(source_artifact_path)
    if source_artifact.get("modelRelease") != SOURCE_MODEL_RELEASE:
        raise RuntimeError("source model artifact mismatch")
    holdout_path = root / "football-research/cache/nfl-model/nfl_2025_holdout_predictions_r2.parquet"
    holdout = pd.read_parquet(holdout_path)
    margin_residuals = np.concatenate([
        np.asarray(source_artifact["marginResiduals"], dtype=float),
        holdout["actual_margin"].to_numpy(float) - holdout["market_prediction_margin"].to_numpy(float),
    ])
    total_residuals = np.concatenate([
        np.asarray(source_artifact["totalResiduals"], dtype=float),
        holdout["actual_total"].to_numpy(float) - holdout["market_prediction_total"].to_numpy(float),
    ])
    artifact = {
        "modelRelease": MODEL_RELEASE,
        "sourceTournamentModelRelease": SOURCE_MODEL_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "featureNames": features,
        "margin": {
            "independentRecipe": margin_recipe,
            "marketRecipe": report["margin"]["marketRecipe"],
            "models": margin_models,
            "residuals": margin_residuals,
        },
        "total": {
            "independentRecipe": total_recipe,
            "marketRecipe": report["total"]["marketRecipe"],
            "models": total_models,
            "residuals": total_residuals,
        },
        "calibrators": source_artifact["calibrators"],
        "kernelBandwidthPoints": source_artifact["kernelBandwidthPoints"],
        "trainedThrough": "2025-12-31",
        "localOnly": True,
        "actionable": False,
        "officialTrackingChanged": False,
    }
    output_path = root / "football-research/cache/nfl-model/nfl_pregame_real_local_current_refit_2026_08_19_r3.joblib"
    joblib.dump(artifact, output_path, compress=3)
    manifest = {
        "modelRelease": MODEL_RELEASE,
        "sourceTournamentModelRelease": SOURCE_MODEL_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "trainedThrough": artifact["trainedThrough"],
        "trainingRows": len(train),
        "featureCount": len(features),
        "modelArtifact": str(output_path),
        "modelArtifactSha256": sha256_file(output_path),
        "sourceTournamentReportSha256": sha256_file(report_path),
        "sourceModelArtifactSha256": sha256_file(source_artifact_path),
        "featureArtifactSha256": feature_manifest["featureFileSha256"],
        "architectureFrozenFromR2": True,
        "localOnly": True,
        "actionable": False,
        "launchGate": "2026_forward_validation_required",
    }
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_real_local_current_refit_2026_08_19_r3.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
