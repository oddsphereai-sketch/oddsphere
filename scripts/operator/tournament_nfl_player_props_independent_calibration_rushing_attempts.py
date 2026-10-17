#!/usr/bin/env python3
"""Chronological price-blind probability calibration for Rushing Attempts."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


ROOT = pathlib.Path(__file__).resolve().parents[2]
CORE_PATH = ROOT / "scripts/operator/tournament_nfl_player_props_independent_first_rushing_attempts.py"
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OPENINGS = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2025_openings_af5f84007ba40ea5.json"
DEFAULT_ARTIFACT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeMarketRushingAttempts.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-independent-first/nfl_player_props_independent_calibration_rushing_attempts_r1.json"
FIT_END = pd.Timestamp("2025-09-30").date()
SELECTION_START = pd.Timestamp("2025-10-01").date()
SELECTION_END = pd.Timestamp("2025-10-31").date()
CONFIRMATION_START = pd.Timestamp("2025-11-01").date()
WEIGHTS = (0.00, 0.20, 0.35, 0.50, 0.65, 0.80, 1.00)
SHIPPABLE_WEIGHTS = (0.65, 0.80, 1.00)


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def designs(rows: pd.DataFrame) -> dict[str, np.ndarray]:
    probability_logit = core.logit(rows["model_over_probability"].to_numpy(float))
    residual = (
        rows["independent_projection"].to_numpy(float)
        - rows["line"].to_numpy(float)
    )
    is_qb = rows["position"].astype(str).str.upper().eq("QB").to_numpy(float)
    return {
        "platt_active_probability": probability_logit.reshape(-1, 1),
        "logistic_projection_line_residual": residual.reshape(-1, 1),
        "logistic_residual_position_interaction": np.column_stack(
            [residual, is_qb, residual * is_qb]
        ),
    }


def fit_candidates(fit: pd.DataFrame, frames: dict[str, pd.DataFrame]) -> dict[str, dict[str, np.ndarray]]:
    y = fit["outcome_over"].to_numpy(int)
    if len(np.unique(y)) != 2:
        raise RuntimeError("calibration fit does not contain both outcomes")
    fit_designs = designs(fit)
    output: dict[str, dict[str, np.ndarray]] = {
        "active_empirical_residual": {
            name: frame["model_over_probability"].to_numpy(float)
            for name, frame in frames.items()
        }
    }
    for candidate, fit_x in fit_designs.items():
        model = make_pipeline(
            StandardScaler(),
            LogisticRegression(C=0.5, solver="lbfgs", max_iter=1000),
        ).fit(fit_x, y)
        output[candidate] = {
            name: np.clip(model.predict_proba(designs(frame)[candidate])[:, 1], 1e-6, 1 - 1e-6)
            for name, frame in frames.items()
        }
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--openings", type=pathlib.Path, default=DEFAULT_OPENINGS)
    parser.add_argument("--artifact", type=pathlib.Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    history, manifest, history_path = core.load_history(args.manifest)
    openings = json.loads(args.openings.read_text(encoding="utf-8"))
    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    rows, coverage = core.build_scoring_rows(history, openings, artifact)
    rows["date"] = pd.to_datetime(rows["game_date"]).dt.date
    frames = {
        "fit": rows[rows["date"].le(FIT_END)].copy(),
        "selection": rows[rows["date"].between(SELECTION_START, SELECTION_END)].copy(),
        "confirmation": rows[rows["date"].ge(CONFIRMATION_START)].copy(),
    }
    if min(map(len, frames.values())) < 75:
        raise RuntimeError(f"chronological sample is too small: {[len(value) for value in frames.values()]}")

    predictions = fit_candidates(frames["fit"], frames)
    independent_scores: dict[str, Any] = {}
    for candidate, split_predictions in predictions.items():
        independent_scores[candidate] = {
            split: core.probability_metrics(frame["outcome_over"].to_numpy(int), split_predictions[split])
            for split, frame in frames.items()
        }
    reference = independent_scores["active_empirical_residual"]["selection"]
    eligible_calibrators = [name for name, score in independent_scores.items() if (
        name != "active_empirical_residual"
        and score["selection"]["brier"] < reference["brier"]
        and score["selection"]["logLoss"] < reference["logLoss"]
    )]
    selected_calibrator = min(
        eligible_calibrators,
        key=lambda name: independent_scores[name]["selection"]["brier"],
    ) if eligible_calibrators else None

    production: dict[str, Any] = {}
    for split, frame in frames.items():
        current = core.residual_probability(
            frame["model_over_probability"].to_numpy(float),
            frame["market_over_probability"].to_numpy(float),
            0.20,
        )
        production[split] = core.probability_metrics(frame["outcome_over"].to_numpy(int), current)

    weights: dict[str, Any] = {}
    eligible_weights: list[float] = []
    selected_weight: float | None = None
    passes = False
    uncertainty = None
    if selected_calibrator is not None:
        for weight in WEIGHTS:
            label = f"{weight:.2f}"
            weights[label] = {}
            for split, frame in frames.items():
                probability = core.residual_probability(
                    predictions[selected_calibrator][split],
                    frame["market_over_probability"].to_numpy(float),
                    weight,
                )
                weights[label][split] = core.probability_metrics(
                    frame["outcome_over"].to_numpy(int), probability
                )
        eligible_weights = [weight for weight in SHIPPABLE_WEIGHTS if (
            weights[f"{weight:.2f}"]["selection"]["brier"] < production["selection"]["brier"]
            and weights[f"{weight:.2f}"]["selection"]["logLoss"] < production["selection"]["logLoss"]
        )]
        selected_weight = min(
            eligible_weights,
            key=lambda weight: weights[f"{weight:.2f}"]["selection"]["brier"],
        ) if eligible_weights else None
        if selected_weight is not None:
            candidate = weights[f"{selected_weight:.2f}"]["confirmation"]
            incumbent = production["confirmation"]
            passes = bool(
                candidate["brier"] < incumbent["brier"]
                and candidate["logLoss"] < incumbent["logLoss"]
                and candidate["directionAccuracy"] >= incumbent["directionAccuracy"]
                and candidate["calibrationGap"] <= incumbent["calibrationGap"] + 0.005
            )
            confirmation = frames["confirmation"]
            uncertainty = core.clustered_brier_delta(
                confirmation,
                core.residual_probability(
                    predictions[selected_calibrator]["confirmation"],
                    confirmation["market_over_probability"].to_numpy(float),
                    selected_weight,
                ),
                core.residual_probability(
                    confirmation["model_over_probability"].to_numpy(float),
                    confirmation["market_over_probability"].to_numpy(float),
                    0.20,
                ),
            )

    output = {
        "release": "nfl_player_props_independent_calibration_rushing_attempts_tournament_2026_10_08_r1",
        "readOnly": True,
        "writes": 0,
        "providerCalls": 0,
        "lineOrPriceFeatures": [],
        "thresholdUse": "offered line is used only as the scoring threshold",
        "chronology": {
            "fitEnd": str(FIT_END),
            "selectionStart": str(SELECTION_START),
            "selectionEnd": str(SELECTION_END),
            "confirmationStart": str(CONFIRMATION_START),
            **{f"{name}Rows": int(len(frame)) for name, frame in frames.items()},
        },
        "checksums": {
            "manifest": core.sha256_file(args.manifest),
            "history": core.sha256_file(history_path),
            "openings": core.sha256_file(args.openings),
            "artifact": core.sha256_file(args.artifact),
        },
        "sourceReleases": {
            "openings": openings["release"],
            "historicalManifest": manifest.get("datasetRelease") or manifest.get("release"),
        },
        "coverage": coverage,
        "independentCalibrators": independent_scores,
        "productionReference": production,
        "candidateWeights": weights,
        "selection": {
            "eligibleCalibrators": eligible_calibrators,
            "selectedCalibrator": selected_calibrator,
            "eligibleIndependentFirstWeights": eligible_weights,
            "selectedWeight": selected_weight,
            "passesConfirmation": passes,
            "clusteredConfirmationBrierDelta": uncertainty,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "chronology": output["chronology"],
        "independentCalibrators": independent_scores,
        "productionReference": production,
        "candidateWeights": weights,
        "selection": output["selection"],
    }, indent=2, allow_nan=False))


core = load_module("independent_first_ra_core", CORE_PATH)


if __name__ == "__main__":
    main()
