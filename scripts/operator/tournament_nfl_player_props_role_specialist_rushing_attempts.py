#!/usr/bin/env python3
"""Chronological price-blind role-specialist tournament for Rushing Attempts."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-independent-first/nfl_player_props_role_specialist_rushing_attempts_r1.json"
SEASONS = (2023, 2024, 2025)
BLEND_WEIGHTS = (0.25, 0.50, 0.75, 1.00)
ACTIVE_ROLE_MINIMUM = 4.0


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def fit_poisson(trainer: Any, train: pd.DataFrame, test: pd.DataFrame, features: list[str], weighted: bool) -> np.ndarray:
    model = trainer.model_for("poisson")
    sample_weight = None
    if weighted:
        role = np.maximum(train["prior_rushing_attempts_avg5"].fillna(0).to_numpy(float), 1.5)
        sample_weight = np.sqrt(role / 1.5)
    model.fit(train[features], train["rushing_attempts"].to_numpy(float), sample_weight=sample_weight)
    return np.clip(np.asarray(model.predict(test[features]), dtype=float), 0.0, None)


def specialist_prediction(
    trainer: Any,
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    split_positions: bool,
    weighted: bool,
) -> np.ndarray:
    if not split_positions:
        return fit_poisson(trainer, train, test, features, weighted)
    output = np.empty(len(test), dtype=float)
    qb_test = test["position"].eq("QB").to_numpy()
    for is_qb in (False, True):
        train_group = train[train["position"].eq("QB") == is_qb]
        test_group = test.loc[qb_test == is_qb]
        if min(len(train_group), len(test_group)) < 100:
            raise RuntimeError(f"role specialist group too small: {is_qb} {len(train_group)} {len(test_group)}")
        output[qb_test == is_qb] = fit_poisson(trainer, train_group, test_group, features, weighted)
    return output


def cohort_metrics(accuracy: Any, rows: pd.DataFrame, actual: np.ndarray, prediction: np.ndarray) -> dict[str, Any]:
    active = rows["prior_rushing_attempts_avg5"].fillna(0).ge(ACTIVE_ROLE_MINIMUM).to_numpy()
    if active.sum() < 100:
        raise RuntimeError("active-role evaluation cohort is too small")
    return {
        "all": accuracy.point_metrics(actual, prediction),
        "activeRole": accuracy.point_metrics(actual[active], prediction[active]),
    }


def improves(candidate: dict[str, Any], incumbent: dict[str, Any]) -> bool:
    return all(
        float(candidate[cohort][metric]) < float(incumbent[cohort][metric])
        for cohort in ("all", "activeRole")
        for metric in ("mae", "rmse")
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("role_ra_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("role_ra_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("role_ra_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    accuracy = load_module("role_ra_accuracy", ROOT / "scripts/operator/tournament_nfl_player_props_projection_accuracy.py")
    recalibration = load_module("role_ra_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    history_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, history_contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    matchup_rows, matchup_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    eligible = baseline.market_eligible(frame, history_contract["markets"]["rushing_attempts"])

    rows: dict[int, pd.DataFrame] = {}
    actual: dict[int, np.ndarray] = {}
    incumbent: dict[int, np.ndarray] = {}
    architectures: dict[str, dict[int, np.ndarray]] = {
        "position_split": {},
        "active_role_weighted": {},
        "position_split_active_role_weighted": {},
    }
    for season in SEASONS:
        print(f"role-specialist Rushing Attempts season {season}...", flush=True)
        train_all = frame[eligible & frame["season"].lt(season)]
        test_all = frame[eligible & frame["season"].eq(season)]
        _, released_all = trainer.fit_recipe(train_all, test_all, "rushing_attempts", base_features, enhanced_features)
        participated = test_all["participated"].eq(1).to_numpy()
        test = test_all.loc[participated].copy()
        train = train_all[train_all["participated"].eq(1)]
        _, conditional = trainer.fit_recipe(train, test, "rushing_attempts", base_features, enhanced_features)
        rows[season] = test
        actual[season] = test["rushing_attempts"].to_numpy(float)
        incumbent[season] = 0.25 * released_all[participated] + 0.75 * conditional
        architectures["position_split"][season] = specialist_prediction(
            trainer, train, test, enhanced_features, True, False,
        )
        architectures["active_role_weighted"][season] = specialist_prediction(
            trainer, train, test, enhanced_features, False, True,
        )
        architectures["position_split_active_role_weighted"][season] = specialist_prediction(
            trainer, train, test, enhanced_features, True, True,
        )

    candidates: dict[str, dict[int, np.ndarray]] = {}
    for architecture, predictions in architectures.items():
        for weight in BLEND_WEIGHTS:
            name = f"{architecture}_blend_{int(weight * 100)}"
            candidates[name] = {
                season: (1 - weight) * incumbent[season] + weight * predictions[season]
                for season in SEASONS
            }

    selection_reference = cohort_metrics(accuracy, rows[2023], actual[2023], incumbent[2023])
    selection_candidates = {
        name: cohort_metrics(accuracy, rows[2023], actual[2023], prediction[2023])
        for name, prediction in candidates.items()
    }
    eligible_candidates = [name for name, score in selection_candidates.items() if improves(score, selection_reference)]
    selected = min(eligible_candidates, key=lambda name: (
        selection_candidates[name]["all"]["mae"] / selection_reference["all"]["mae"]
        + selection_candidates[name]["all"]["rmse"] / selection_reference["all"]["rmse"]
        + selection_candidates[name]["activeRole"]["mae"] / selection_reference["activeRole"]["mae"]
        + selection_candidates[name]["activeRole"]["rmse"] / selection_reference["activeRole"]["rmse"]
    )) if eligible_candidates else None

    confirmation_reference = cohort_metrics(accuracy, rows[2024], actual[2024], incumbent[2024])
    confirmation_candidate = cohort_metrics(
        accuracy, rows[2024], actual[2024], candidates[selected][2024]
    ) if selected else None
    confirmed = bool(confirmation_candidate and improves(confirmation_candidate, confirmation_reference))
    chosen = candidates[selected] if selected and confirmed else incumbent

    holdout_reference = cohort_metrics(accuracy, rows[2025], actual[2025], incumbent[2025])
    holdout_candidate = cohort_metrics(accuracy, rows[2025], actual[2025], chosen[2025])
    mae_delta = accuracy.clustered_delta(
        rows[2025], np.abs(chosen[2025] - actual[2025]), np.abs(incumbent[2025] - actual[2025]),
    )
    segments = accuracy.segment_metrics(rows[2025], actual[2025], incumbent[2025], chosen[2025])
    incumbent_distribution = accuracy.distribution_report(recalibration, calibration_contract, actual, incumbent)
    candidate_distribution = accuracy.distribution_report(recalibration, calibration_contract, actual, chosen)
    mean_outcome = float(np.mean(actual[2025]))
    point_pass = bool(
        confirmed
        and improves(holdout_candidate, holdout_reference)
        and float(mae_delta["ciHigh"]) < 0
        and abs(float(holdout_candidate["all"]["bias"])) <= abs(float(holdout_reference["all"]["bias"])) + 0.0025 * mean_outcome
        and float(holdout_candidate["all"]["underpredictionRate"]) <= float(holdout_reference["all"]["underpredictionRate"]) + 0.0025
        and all(float(segment["maeDelta"]) <= 0 for segment in segments)
    )
    incumbent_dist = incumbent_distribution["holdout"]
    candidate_dist = candidate_distribution["holdout"]
    distribution_pass = bool(
        float(candidate_dist["crps"]) < float(incumbent_dist["crps"])
        and float(candidate_dist["nll"]) <= float(incumbent_dist["nll"]) * 1.005
        and abs(float(candidate_dist["coverage_80"]) - 0.8) <= float(calibration_contract["selection"]["maximumAbsoluteCoverage80Error"])
        and abs(float(candidate_dist["coverage_90"]) - 0.9) <= float(calibration_contract["selection"]["maximumAbsoluteCoverage90Error"])
    )

    output = {
        "release": "nfl_player_props_role_specialist_rushing_attempts_tournament_2026_10_08_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "lineOrPriceFeatures": [],
        "targetPopulation": "prior-role eligible official participants; participated is never a pregame feature",
        "activeRoleMinimumPriorCarriesAvg5": ACTIVE_ROLE_MINIMUM,
        "selection": {
            "incumbent": selection_reference,
            "candidates": selection_candidates,
            "eligible": eligible_candidates,
            "selected": selected,
        },
        "confirmation": {
            "incumbent": confirmation_reference,
            "candidate": confirmation_candidate,
            "confirmed": confirmed,
        },
        "holdout": {
            "incumbent": holdout_reference,
            "candidate": holdout_candidate,
            "clusteredMaeDelta": mae_delta,
            "chronologicalSegments": segments,
        },
        "distribution": {"incumbent": incumbent_distribution, "candidate": candidate_distribution},
        "passes": {"point": point_pass, "distribution": distribution_pass, "all": bool(point_pass and distribution_pass)},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "selection": output["selection"],
        "confirmation": output["confirmation"],
        "holdout": output["holdout"],
        "distribution": output["distribution"],
        "passes": output["passes"],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
