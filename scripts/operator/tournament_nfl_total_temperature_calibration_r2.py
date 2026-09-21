#!/usr/bin/env python3
"""Frozen direction-preserving NFL Total calibration audit (research only)."""

from __future__ import annotations

import json
import pathlib
import time

import numpy as np
import pandas as pd
from scipy.special import expit, logit, ndtri

import tournament_nfl_nonlinear_market_ensemble_r1 as r1
from tournament_nfl_market_context_residual_r1 import (
    FEATURE_RELEASE,
    add_market_context,
    model_feature_columns,
    sha256_file,
)


TOURNAMENT_RELEASE = "nfl_total_temperature_calibration_tournament_2026_09_21_r2"
TEMPERATURE = 0.25
ACTION_EDGE = 0.01


def calibrated(raw: np.ndarray) -> np.ndarray:
    return expit(TEMPERATURE * logit(np.clip(raw, 0.001, 0.999)))


def audit(frame: pd.DataFrame, features: list[str]) -> dict[str, object]:
    config = {**r1.MARKETS["total"], "action_edge": ACTION_EDGE}
    push = frame["actual_total"].eq(frame["market_total"])
    outcome = frame["actual_total"].gt(frame["market_total"]).astype(int)
    selection_train = frame["season"].isin(r1.TRAIN_SEASONS) & ~push
    selection = frame["season"].isin(r1.SELECTION_SEASONS) & ~push
    selection_model = r1.estimator("total")
    selection_model.fit(frame.loc[selection_train, features], outcome.loc[selection_train])
    selection_probability = calibrated(
        selection_model.predict_proba(frame.loc[selection, features])[:, 1]
    )
    selection_observed = outcome.loc[selection].to_numpy(int)
    selection_fair = frame.loc[selection, "market_total_fair_over"].to_numpy(float)
    selection_frame = frame.loc[selection].reset_index(drop=True)
    selection_actions = r1.actions(
        selection_frame,
        selection_probability,
        selection_fair,
        selection_observed,
        config,
    )

    fit = frame["season"].between(2016, 2023) & ~push
    confirmation_mask = frame["season"].isin(r1.CONFIRMATION_SEASONS) & ~push
    model = r1.estimator("total")
    model.fit(frame.loc[fit, features], outcome.loc[fit])
    probability = calibrated(model.predict_proba(frame.loc[confirmation_mask, features])[:, 1])
    confirmation = frame.loc[confirmation_mask].reset_index(drop=True)
    observed = outcome.loc[confirmation_mask].to_numpy(int)
    fair = confirmation["market_total_fair_over"].to_numpy(float)

    fit_residual = (
        frame.loc[fit, "actual_total"].to_numpy(float)
        - frame.loc[fit, "market_total"].to_numpy(float)
    )
    residual_scale = float(np.std(fit_residual, ddof=1))
    correction = np.clip(
        ndtri(np.clip(probability, 0.001, 0.999)) * residual_scale,
        -r1.POINT_CAP,
        r1.POINT_CAP,
    )
    market_point = confirmation["market_total"].to_numpy(float)
    actual_point = confirmation["actual_total"].to_numpy(float)
    candidate_point = market_point + correction
    candidate_metrics = r1.probability_metrics(probability, observed)
    market_metrics = r1.probability_metrics(fair, observed)
    candidate_point_metrics = r1.point_metrics(actual_point, candidate_point)
    market_point_metrics = r1.point_metrics(actual_point, market_point)

    by_season: dict[str, object] = {}
    for season in r1.CONFIRMATION_SEASONS:
        keep = confirmation["season"].eq(season).to_numpy()
        by_season[str(season)] = {
            "candidateProbability": r1.probability_metrics(probability[keep], observed[keep]),
            "marketProbability": r1.probability_metrics(fair[keep], observed[keep]),
            "candidatePoint": r1.point_metrics(actual_point[keep], candidate_point[keep]),
            "marketPoint": r1.point_metrics(actual_point[keep], market_point[keep]),
            "directions": {
                "over": int(np.sum(probability[keep] >= 0.5)),
                "under": int(np.sum(probability[keep] < 0.5)),
            },
        }

    action_report = r1.actions(confirmation, probability, fair, observed, config)
    gates = {
        "pooledAccuracyAboveHalf": candidate_metrics["accuracy"] > 0.5,
        "eachSeasonAccuracyAtLeastHalf": all(
            row["candidateProbability"]["accuracy"] >= 0.5
            for row in by_season.values()
        ),
        "pooledBrierImproves": candidate_metrics["brier"] < market_metrics["brier"],
        "seasonBrierBounded": all(
            row["candidateProbability"]["brier"]
            <= row["marketProbability"]["brier"] + 0.001
            for row in by_season.values()
        ),
        "bothDirectionsEachSeason": all(
            row["directions"]["over"] > 0 and row["directions"]["under"] > 0
            for row in by_season.values()
        ),
        "pointMaeBounded": candidate_point_metrics["mae"] <= market_point_metrics["mae"] + 0.10,
        "atLeastThirtyActions": action_report["pooled"]["resolved"] >= 30,
        "actionAccuracyAtLeastHalf": (
            action_report["pooled"]["accuracy"] is not None
            and action_report["pooled"]["accuracy"] >= 0.5
        ),
        "positiveActionUnits": action_report["pooled"]["units"] > 0,
        "seasonActionRoiBounded": all(
            row["roiPerUnitRisked"] is not None and row["roiPerUnitRisked"] >= -0.05
            for row in action_report["bySeason"].values()
        ),
        "bothActionDirections": (
            action_report["directions"]["first"] > 0
            and action_report["directions"]["second"] > 0
        ),
    }
    gates["historicalConfirmationPassed"] = all(gates.values())
    return {
        "selection": {
            "candidateProbability": r1.probability_metrics(selection_probability, selection_observed),
            "marketProbability": r1.probability_metrics(selection_fair, selection_observed),
            "actions": selection_actions,
        },
        "confirmation": {
            "candidateProbability": candidate_metrics,
            "marketProbability": market_metrics,
            "candidatePoint": candidate_point_metrics,
            "marketPoint": market_point_metrics,
            "meanAbsolutePointCorrection": float(np.mean(np.abs(correction))),
            "residualScale": residual_scale,
            "bySeason": by_season,
            "actions": action_report,
            "gates": gates,
        },
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature artifact checksum mismatch")
    frame = add_market_context(pd.read_parquet(feature_path))
    report_body = audit(frame, model_feature_columns(frame))
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-09-21-nfl-total-temperature-calibration-predeclaration.md",
        "localOnly": True,
        "productionBehaviorChanged": False,
        "temperature": TEMPERATURE,
        "actionEdge": ACTION_EDGE,
        **report_body,
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), **report_body}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
