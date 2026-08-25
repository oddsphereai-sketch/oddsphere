#!/usr/bin/env python3
"""Predeclared chronological recalibration for the NFL props r1 point champions."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy import stats


CONTRACT_PATH = pathlib.Path("lib/services/football/nflPlayerPropsCalibrationContract.json")
BASELINE_PATH = pathlib.Path("scripts/operator/tournament_nfl_player_props_baseline.py")
DEFAULT_MANIFEST = pathlib.Path("football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json")
DEFAULT_R1_ARTIFACT = pathlib.Path("football-research/cache/nfl-player-props-baseline/nfl_player_props_distribution_shadow_2026_08_25_r1.joblib")
OUTPUT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-calibration")


def load_baseline_module() -> Any:
    spec = importlib.util.spec_from_file_location("nfl_props_baseline_recalibration", BASELINE_PATH)
    if not spec or not spec.loader:
        raise RuntimeError("NFL props baseline module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def empirical_distribution(residuals: np.ndarray, grid_size: int) -> dict[str, Any]:
    clean = np.asarray(residuals, dtype=float)
    clean = clean[np.isfinite(clean)]
    if len(clean) < 100:
        raise RuntimeError("insufficient residuals for empirical calibration")
    probabilities = np.linspace(0.0, 1.0, grid_size)
    quantiles = np.quantile(clean, probabilities, method="linear")
    return {
        "family": "empirical_residual",
        "probabilities": probabilities.tolist(),
        "residualQuantiles": quantiles.tolist(),
        "residualRows": int(len(clean)),
    }


def bucketed_empirical_distribution(
    residuals: np.ndarray,
    means: np.ndarray,
    grid_size: int,
    minimum_rows: int,
) -> dict[str, Any]:
    edges = np.unique(np.quantile(means, [0.0, 0.25, 0.5, 0.75, 1.0]))
    if len(edges) < 3:
        return empirical_distribution(residuals, grid_size)
    global_distribution = empirical_distribution(residuals, grid_size)
    buckets: list[dict[str, Any]] = []
    for index in range(len(edges) - 1):
        lower = float(edges[index])
        upper = float(edges[index + 1])
        mask = (means >= lower) & (means <= upper if index == len(edges) - 2 else means < upper)
        if int(mask.sum()) < minimum_rows:
            distribution = global_distribution
        else:
            distribution = empirical_distribution(residuals[mask], grid_size)
        buckets.append({"lower": lower, "upper": upper, "distribution": distribution})
    return {"family": "empirical_residual_mean_bucket", "buckets": buckets, "fallback": global_distribution}


def empirical_values(distribution: dict[str, Any], means: np.ndarray) -> list[np.ndarray]:
    if distribution["family"] == "empirical_residual":
        values = np.asarray(distribution["residualQuantiles"], dtype=float)
        return [values] * len(means)
    values: list[np.ndarray] = []
    for mean in means:
        selected = distribution["fallback"]
        for bucket in distribution["buckets"]:
            if float(bucket["lower"]) <= mean <= float(bucket["upper"]):
                selected = bucket["distribution"]
                break
        values.append(np.asarray(selected["residualQuantiles"], dtype=float))
    return values


def empirical_metrics(y: np.ndarray, means: np.ndarray, distribution: dict[str, Any]) -> dict[str, float]:
    residual_grids = empirical_values(distribution, means)
    pits = np.empty(len(y))
    crps = np.empty(len(y))
    coverage: dict[int, np.ndarray] = {50: np.empty(len(y), dtype=bool), 80: np.empty(len(y), dtype=bool), 90: np.empty(len(y), dtype=bool)}
    nll = np.empty(len(y))
    for index, (actual, mean, residuals) in enumerate(zip(y, means, residual_grids, strict=True)):
        outcomes = np.clip(mean + residuals, 0.0, None)
        pits[index] = np.mean(outcomes <= actual)
        sorted_outcomes = np.sort(outcomes)
        pair_term = np.sum((2 * np.arange(1, len(sorted_outcomes) + 1) - len(sorted_outcomes) - 1) * sorted_outcomes) / (len(sorted_outcomes) ** 2)
        crps[index] = np.mean(np.abs(outcomes - actual)) - pair_term
        bandwidth = max(float(np.std(outcomes)) * len(outcomes) ** (-0.2), 0.25)
        density = np.mean(stats.norm.pdf((actual - outcomes) / bandwidth)) / bandwidth
        nll[index] = -np.log(max(density, 1e-12))
        for level in coverage:
            tail = (1.0 - level / 100.0) / 2.0
            lower, upper = np.quantile(outcomes, [tail, 1.0 - tail])
            coverage[level][index] = lower <= actual <= upper
    return {
        "nll": float(np.mean(nll)),
        "crps": float(np.mean(crps)),
        "pitMean": float(np.mean(pits)),
        "pitKs": float(stats.kstest(pits, "uniform").statistic),
        **{f"coverage_{level}": float(values.mean()) for level, values in coverage.items()},
    }


def parametric_distribution(baseline: Any, y: np.ndarray, means: np.ndarray, kind: str) -> dict[str, Any]:
    if kind == "count":
        alpha = baseline.estimate_count_alpha(y, means)
        poisson = baseline.count_distribution_metrics(y, means, "poisson", alpha)
        negative_binomial = baseline.count_distribution_metrics(y, means, "negative_binomial", alpha)
        family = "negative_binomial" if negative_binomial["nll"] < poisson["nll"] else "poisson"
        return {"family": family, "alpha": alpha}
    return {"family": "normal_residual", "scale": float(np.sqrt(np.mean((y - means) ** 2)))}


def distribution_metrics(baseline: Any, y: np.ndarray, means: np.ndarray, distribution: dict[str, Any]) -> dict[str, float]:
    family = distribution["family"]
    if family in {"empirical_residual", "empirical_residual_mean_bucket"}:
        return empirical_metrics(y, means, distribution)
    if family in {"poisson", "negative_binomial"}:
        return baseline.count_distribution_metrics(y, means, family, float(distribution.get("alpha", 1e-6)))
    return baseline.normal_distribution_metrics(y, means, float(distribution["scale"]))


def selection_key(metrics: dict[str, float], contract: dict[str, Any]) -> tuple[float, ...]:
    coverage_error = abs(metrics["coverage_80"] - 0.8) + abs(metrics["coverage_90"] - 0.9)
    eligible = (
        abs(metrics["coverage_80"] - 0.8) <= float(contract["selection"]["maximumAbsoluteCoverage80Error"])
        and abs(metrics["coverage_90"] - 0.9) <= float(contract["selection"]["maximumAbsoluteCoverage90Error"])
    )
    return (0.0 if eligible else 1.0, metrics["crps"] if eligible else coverage_error, coverage_error, metrics["crps"])


def market_predictions(baseline: Any, frame: pd.DataFrame, features: list[str], market: str, config: dict[str, Any], champion: str) -> dict[int, np.ndarray]:
    eligible = baseline.market_eligible(frame, config)
    candidate = next(value for value in baseline.regression_candidates(market, config["distribution"]) if value.name == champion)
    predictions: dict[int, np.ndarray] = {}
    for season in (2023, 2024, 2025):
        train = frame[eligible & frame["season"].lt(season)]
        test = frame[eligible & frame["season"].eq(season)]
        _, predictions[season] = baseline.fit_predict(candidate, train, test, features, market)
    return predictions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--r1-artifact", type=pathlib.Path, default=DEFAULT_R1_ARTIFACT)
    parser.add_argument("--output-root", type=pathlib.Path, default=OUTPUT_ROOT)
    args = parser.parse_args()
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    baseline = load_baseline_module()
    history_contract = json.loads(baseline.CONTRACT_PATH.read_text(encoding="utf-8"))
    frame, manifest = baseline.load_verified_dataset(args.manifest, history_contract)
    frame, features = baseline.prepare_features(frame, manifest)
    if contract["chronology"] != {"projectionTrainingEnd": 2022, "calibrationFit": 2023, "calibrationSelection": 2024, "lockedEvaluation": 2025}:
        raise RuntimeError("NFL props recalibration chronology changed")
    r1_artifact = joblib.load(args.r1_artifact)
    if r1_artifact["shadowModelRelease"] != contract["shadowModelRelease"]:
        raise RuntimeError("NFL props r1 artifact release mismatch")

    reports: dict[str, Any] = {}
    calibrated_markets = dict(r1_artifact["markets"])
    for market, config in history_contract["markets"].items():
        champion = contract["projectionChampions"][market]
        predictions = market_predictions(baseline, frame, features, market, config, champion)
        eligible = baseline.market_eligible(frame, config)
        rows = {season: frame[eligible & frame["season"].eq(season)] for season in (2023, 2024, 2025)}
        fit_y = rows[2023][market].to_numpy(float)
        fit_mu = predictions[2023]
        candidates = {
            "parametric_r1": parametric_distribution(baseline, fit_y, fit_mu, config["distribution"]),
            "empirical_residual_global": empirical_distribution(fit_y - fit_mu, int(contract["empiricalQuantileGridSize"])),
            "empirical_residual_mean_quartile": bucketed_empirical_distribution(
                fit_y - fit_mu, fit_mu, int(contract["empiricalQuantileGridSize"]), int(contract["minimumBucketRows"]),
            ),
        }
        selection_y = rows[2024][market].to_numpy(float)
        selection_metrics = {name: distribution_metrics(baseline, selection_y, predictions[2024], distribution) for name, distribution in candidates.items()}
        selected = min(selection_metrics, key=lambda name: selection_key(selection_metrics[name], contract))

        # Refit only the frozen calibration family on combined pre-2025 OOS residuals.
        combined_y = np.concatenate([fit_y, selection_y])
        combined_mu = np.concatenate([fit_mu, predictions[2024]])
        if selected == "parametric_r1":
            final_distribution = parametric_distribution(baseline, combined_y, combined_mu, config["distribution"])
        elif selected == "empirical_residual_global":
            final_distribution = empirical_distribution(combined_y - combined_mu, int(contract["empiricalQuantileGridSize"]))
        else:
            final_distribution = bucketed_empirical_distribution(
                combined_y - combined_mu, combined_mu, int(contract["empiricalQuantileGridSize"]), int(contract["minimumBucketRows"]),
            )
        evaluation_y = rows[2025][market].to_numpy(float)
        evaluation = distribution_metrics(baseline, evaluation_y, predictions[2025], final_distribution)
        reports[market] = {
            "champion": champion,
            "calibrationFitRows": int(len(fit_y)),
            "selectionRows": int(len(selection_y)),
            "evaluationRows": int(len(evaluation_y)),
            "selectionCandidates": selection_metrics,
            "selectedCalibration": selected,
            "lockedEvaluation": evaluation,
        }
        calibrated_markets[market] = {**calibrated_markets[market], "distribution": final_distribution}
        print(f"recalibrated {market}: {selected}", flush=True)

    artifact = {
        **r1_artifact,
        "calibrationRelease": contract["calibrationRelease"],
        "lineProbabilityReady": False,
        "markets": calibrated_markets,
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    artifact_path = args.output_root / "nfl_player_props_distribution_shadow_2026_08_25_r2.joblib"
    report_path = args.output_root / "nfl_player_props_recalibration_tournament_2026_08_25_r2.json"
    joblib.dump(artifact, artifact_path)
    report = {
        **contract,
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "marketsReport": reports,
        "artifact": str(artifact_path),
        "artifactSha256": baseline.sha256_file(artifact_path),
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionableChange": 0},
    }
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "artifactSha256": report["artifactSha256"], "selected": {market: value["selectedCalibration"] for market, value in reports.items()}}, indent=2))


if __name__ == "__main__":
    main()
