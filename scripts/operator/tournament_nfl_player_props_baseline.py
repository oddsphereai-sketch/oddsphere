#!/usr/bin/env python3
"""Chronological, price-blind NFL player-props shadow baseline tournament."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import time
from dataclasses import dataclass
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, PoissonRegressor, Ridge
from sklearn.metrics import log_loss, mean_absolute_error, mean_squared_error, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


CONTRACT_PATH = pathlib.Path("lib/services/football/nflPlayerPropsBaselineContract.json")
DEFAULT_MANIFEST = pathlib.Path("football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json")
OUTPUT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-baseline")
SEED = 20260825


@dataclass
class Candidate:
    name: str
    model: Any | None
    baseline_column: str | None = None


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_verified_dataset(manifest_path: pathlib.Path, contract: dict[str, Any]) -> tuple[pd.DataFrame, dict[str, Any]]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if manifest.get("datasetRelease") != contract["historicalDatasetRelease"]:
        raise RuntimeError("historical dataset release mismatch")
    if not feature_path.exists() or sha256_file(feature_path) != manifest.get("featureFileSha256"):
        raise RuntimeError("historical player-props feature checksum mismatch")
    if manifest.get("modelingReady") is not False or manifest.get("localOnly") is not True:
        raise RuntimeError("historical foundation safety mode mismatch")
    frame = pd.read_parquet(feature_path)
    if len(frame) != manifest.get("rows") or frame["row_id"].duplicated().any():
        raise RuntimeError("historical player-props row identity mismatch")
    return frame, manifest


def prepare_features(frame: pd.DataFrame, manifest: dict[str, Any]) -> tuple[pd.DataFrame, list[str]]:
    result = frame.copy()
    feature_columns = list(manifest["modelFeatureColumns"])
    feature_columns.append("is_home")
    for position in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position.lower()}"
        result[column] = result["position"].eq(position).astype(float)
        feature_columns.append(column)
    forbidden = set(manifest["outcomeOnlyColumns"]) | set(manifest["unstampedContextColumns"])
    overlap = forbidden.intersection(feature_columns)
    if overlap:
        raise RuntimeError(f"outcome/unstamped columns entered model features: {sorted(overlap)}")
    result[feature_columns] = result[feature_columns].replace([np.inf, -np.inf], np.nan)
    return result, feature_columns


def market_eligible(frame: pd.DataFrame, config: dict[str, Any]) -> pd.Series:
    role_column = f"prior_{config['roleMetric']}_avg5"
    return (
        frame["position"].isin(config["positions"])
        & frame["prior_participations"].ge(1)
        & frame[role_column].fillna(0).ge(float(config["minimumPriorAverage"]))
    )


def split_masks(frame: pd.DataFrame, contract: dict[str, Any]) -> dict[str, pd.Series]:
    splits = contract["splits"]
    masks = {
        "training": frame["season"].le(int(splits["trainingEnd"])),
        "selection": frame["season"].eq(int(splits["selection"])),
        "confirmation": frame["season"].eq(int(splits["confirmation"])),
        "holdout": frame["season"].eq(int(splits["holdout"])),
    }
    if any(not mask.any() for mask in masks.values()):
        raise RuntimeError("chronological tournament split is empty")
    return masks


def regression_candidates(target: str, distribution: str) -> list[Candidate]:
    candidates = [
        Candidate("ewm", None, f"prior_{target}_ewm"),
        Candidate("avg3", None, f"prior_{target}_avg3"),
        Candidate("ridge", make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=100.0))),
        Candidate("hgb", HistGradientBoostingRegressor(loss="squared_error", max_iter=140, max_leaf_nodes=15, learning_rate=0.05, l2_regularization=2.0, random_state=SEED)),
    ]
    if distribution == "count":
        candidates.append(Candidate("poisson", make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), PoissonRegressor(alpha=1.0, max_iter=400))))
    return candidates


def fresh_candidate(candidate: Candidate) -> Candidate:
    if candidate.name == "ridge":
        return Candidate(candidate.name, make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=100.0)))
    if candidate.name == "hgb":
        return Candidate(candidate.name, HistGradientBoostingRegressor(loss="squared_error", max_iter=140, max_leaf_nodes=15, learning_rate=0.05, l2_regularization=2.0, random_state=SEED))
    if candidate.name == "poisson":
        return Candidate(candidate.name, make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), PoissonRegressor(alpha=1.0, max_iter=400)))
    return Candidate(candidate.name, None, candidate.baseline_column)


def fit_predict(candidate: Candidate, train: pd.DataFrame, test: pd.DataFrame, features: list[str], target: str) -> tuple[Candidate, np.ndarray]:
    fitted = fresh_candidate(candidate)
    if fitted.baseline_column:
        prediction = test[fitted.baseline_column].fillna(train[target].mean()).to_numpy(float)
    else:
        fitted.model.fit(train[features], train[target].to_numpy(float))
        prediction = np.asarray(fitted.model.predict(test[features]), dtype=float)
    return fitted, np.clip(prediction, 0.0, None)


def point_metrics(y: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(y)),
        "mae": float(mean_absolute_error(y, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(y, prediction))),
        "bias": float(np.mean(prediction - y)),
    }


def estimate_count_alpha(y: np.ndarray, mu: np.ndarray) -> float:
    numerator = float(np.sum((y - mu) ** 2 - np.maximum(mu, 1e-6)))
    denominator = float(np.sum(np.maximum(mu, 1e-6) ** 2))
    return float(np.clip(numerator / max(denominator, 1e-9), 1e-6, 5.0))


def count_distribution_metrics(y: np.ndarray, mu: np.ndarray, family: str, alpha: float) -> dict[str, float]:
    mu = np.clip(mu, 1e-5, None)
    y_int = np.rint(np.clip(y, 0, None)).astype(int)
    if family == "negative_binomial":
        size = 1.0 / max(alpha, 1e-9)
        probability = size / (size + mu)
        log_probability = stats.nbinom.logpmf(y_int, size, probability)
        cdf = stats.nbinom.cdf
        ppf = stats.nbinom.ppf
        params = (size, probability)
    else:
        log_probability = stats.poisson.logpmf(y_int, mu)
        cdf = stats.poisson.cdf
        ppf = stats.poisson.ppf
        params = (mu,)
    coverages: dict[str, float] = {}
    for level in (0.5, 0.8, 0.9):
        tail = (1.0 - level) / 2.0
        lower = ppf(tail, *params)
        upper = ppf(1.0 - tail, *params)
        coverages[f"coverage_{int(level * 100)}"] = float(np.mean((y_int >= lower) & (y_int <= upper)))
    max_k = int(max(np.max(y_int), np.nanmax(ppf(0.999, *params)))) + 3
    crps = np.zeros(len(y_int), dtype=float)
    for k in range(max_k + 1):
        distribution = cdf(k, *params)
        crps += (distribution - (y_int <= k).astype(float)) ** 2
    prior_cdf = cdf(y_int - 1, *params)
    pit = prior_cdf + 0.5 * np.exp(log_probability)
    return {
        "nll": float(-np.mean(np.nan_to_num(log_probability, nan=-100.0, neginf=-100.0))),
        "crps": float(np.mean(crps)),
        "pitMean": float(np.mean(pit)),
        "pitKs": float(stats.kstest(pit, "uniform").statistic),
        **coverages,
    }


def normal_distribution_metrics(y: np.ndarray, mu: np.ndarray, scale: float) -> dict[str, float]:
    scale = max(float(scale), 1e-3)
    z = (y - mu) / scale
    crps = scale * (z * (2 * stats.norm.cdf(z) - 1) + 2 * stats.norm.pdf(z) - 1 / math.sqrt(math.pi))
    pit = stats.norm.cdf(z)
    result = {
        "nll": float(-np.mean(stats.norm.logpdf(y, loc=mu, scale=scale))),
        "crps": float(np.mean(crps)),
        "pitMean": float(np.mean(pit)),
        "pitKs": float(stats.kstest(pit, "uniform").statistic),
    }
    for level in (0.5, 0.8, 0.9):
        radius = stats.norm.ppf((1 + level) / 2) * scale
        result[f"coverage_{int(level * 100)}"] = float(np.mean((y >= mu - radius) & (y <= mu + radius)))
    return result


def cluster_bootstrap_delta(frame: pd.DataFrame, model_error: np.ndarray, baseline_error: np.ndarray, iterations: int = 500) -> dict[str, float]:
    clusters = pd.DataFrame({"game_id": frame["game_id"].to_numpy(), "delta": model_error - baseline_error}).groupby("game_id", observed=True)["delta"].agg(["sum", "count"])
    values = clusters.to_numpy(float)
    rng = np.random.default_rng(SEED)
    draws = np.empty(iterations)
    for index in range(iterations):
        sample = values[rng.integers(0, len(values), len(values))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    return {"meanMaeDelta": float(np.mean(draws)), "ciLow": float(np.quantile(draws, 0.025)), "ciHigh": float(np.quantile(draws, 0.975)), "gameClusters": int(len(values))}


def participation_tournament(frame: pd.DataFrame, features: list[str], masks: dict[str, pd.Series]) -> tuple[dict[str, Any], Any]:
    eligible = frame["prior_roster_game_rows"].ge(1)
    train = frame[eligible & masks["training"]]
    selection = frame[eligible & masks["selection"]]
    confirmation = frame[eligible & masks["confirmation"]]
    holdout = frame[eligible & masks["holdout"]]
    baseline_column = "prior_participated_avg5"
    candidates = {
        "prior_avg5": None,
        "logistic": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.1, max_iter=500)),
        "hgb_classifier": HistGradientBoostingClassifier(max_iter=140, max_leaf_nodes=15, learning_rate=0.05, l2_regularization=2.0, random_state=SEED),
    }

    def predict(name: str, model: Any, training: pd.DataFrame, testing: pd.DataFrame) -> tuple[Any, np.ndarray]:
        if model is None:
            rate = float(training["participated"].mean())
            return None, np.clip(testing[baseline_column].fillna(rate).to_numpy(float), 0.01, 0.99)
        model.fit(training[features], training["participated"].astype(int))
        return model, np.clip(model.predict_proba(testing[features])[:, 1], 0.01, 0.99)

    selection_results: dict[str, Any] = {}
    for name, model in candidates.items():
        _, probability = predict(name, model, train, selection)
        y = selection["participated"].to_numpy(int)
        selection_results[name] = {"brier": float(np.mean((probability - y) ** 2)), "logLoss": float(log_loss(y, probability)), "auc": float(roc_auc_score(y, probability))}
    selected = min(selection_results, key=lambda name: selection_results[name]["brier"])
    confirm_models = {
        "prior_avg5": None,
        "logistic": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.1, max_iter=500)),
        "hgb_classifier": HistGradientBoostingClassifier(max_iter=140, max_leaf_nodes=15, learning_rate=0.05, l2_regularization=2.0, random_state=SEED),
    }
    training_2023 = pd.concat([train, selection], ignore_index=True)
    _, selected_confirm = predict(selected, confirm_models[selected], training_2023, confirmation)
    _, baseline_confirm = predict("prior_avg5", None, training_2023, confirmation)
    y_confirm = confirmation["participated"].to_numpy(int)
    selected_confirm_brier = float(np.mean((selected_confirm - y_confirm) ** 2))
    baseline_confirm_brier = float(np.mean((baseline_confirm - y_confirm) ** 2))
    vetoed = selected != "prior_avg5" and selected_confirm_brier > baseline_confirm_brier * 1.01
    champion = "prior_avg5" if vetoed else selected
    training_2024 = pd.concat([training_2023, confirmation], ignore_index=True)
    holdout_models = {
        "prior_avg5": None,
        "logistic": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.1, max_iter=500)),
        "hgb_classifier": HistGradientBoostingClassifier(max_iter=140, max_leaf_nodes=15, learning_rate=0.05, l2_regularization=2.0, random_state=SEED),
    }
    fitted, probability = predict(champion, holdout_models[champion], training_2024, holdout)
    _, baseline_probability = predict("prior_avg5", None, training_2024, holdout)
    y = holdout["participated"].to_numpy(int)
    bins = pd.qcut(probability, q=10, duplicates="drop")
    calibration = pd.DataFrame({"p": probability, "y": y, "bin": bins}).groupby("bin", observed=True).agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"))
    holdout_metrics = {
        "rows": int(len(y)), "brier": float(np.mean((probability - y) ** 2)),
        "logLoss": float(log_loss(y, probability)), "auc": float(roc_auc_score(y, probability)),
        "calibrationGap": float(np.average(np.abs(calibration["predicted"] - calibration["observed"]), weights=calibration["rows"])),
        "baselineBrier": float(np.mean((baseline_probability - y) ** 2)),
        "clusteredBrierDelta": cluster_bootstrap_delta(holdout, (probability - y) ** 2, (baseline_probability - y) ** 2),
    }
    final_model, _ = predict(champion, holdout_models[champion], pd.concat([training_2024, holdout], ignore_index=True), holdout.iloc[:1])
    return {"champion": champion, "selection": selection_results, "confirmation": {"selectedBrier": selected_confirm_brier, "baselineBrier": baseline_confirm_brier, "vetoed": vetoed}, "holdout": holdout_metrics}, final_model


def market_tournament(frame: pd.DataFrame, features: list[str], masks: dict[str, pd.Series], target: str, config: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    eligible = market_eligible(frame, config)
    train = frame[eligible & masks["training"]]
    selection = frame[eligible & masks["selection"]]
    confirmation = frame[eligible & masks["confirmation"]]
    holdout = frame[eligible & masks["holdout"]]
    if min(len(train), len(selection), len(confirmation), len(holdout)) < 100:
        raise RuntimeError(f"insufficient chronological rows for {target}")
    candidates = regression_candidates(target, config["distribution"])
    selection_results: dict[str, Any] = {}
    for candidate in candidates:
        _, prediction = fit_predict(candidate, train, selection, features, target)
        selection_results[candidate.name] = point_metrics(selection[target].to_numpy(float), prediction)
    selected_name = min(selection_results, key=lambda name: float(selection_results[name]["mae"]))
    selected_candidate = next(candidate for candidate in candidates if candidate.name == selected_name)
    training_2023 = pd.concat([train, selection], ignore_index=True)
    _, selected_confirm = fit_predict(selected_candidate, training_2023, confirmation, features, target)
    _, ewm_confirm = fit_predict(next(candidate for candidate in candidates if candidate.name == "ewm"), training_2023, confirmation, features, target)
    confirm_y = confirmation[target].to_numpy(float)
    selected_confirm_metrics = point_metrics(confirm_y, selected_confirm)
    ewm_confirm_metrics = point_metrics(confirm_y, ewm_confirm)
    vetoed = selected_name != "ewm" and float(selected_confirm_metrics["mae"]) > float(ewm_confirm_metrics["mae"]) * 1.01
    champion_name = "ewm" if vetoed else selected_name
    champion = next(candidate for candidate in candidates if candidate.name == champion_name)
    training_2024 = pd.concat([training_2023, confirmation], ignore_index=True)
    fitted_holdout, holdout_prediction = fit_predict(champion, training_2024, holdout, features, target)
    _, baseline_prediction = fit_predict(next(candidate for candidate in candidates if candidate.name == "ewm"), training_2024, holdout, features, target)
    y = holdout[target].to_numpy(float)
    holdout_point = point_metrics(y, holdout_prediction)
    holdout_point["baselineMae"] = float(mean_absolute_error(y, baseline_prediction))
    holdout_point["clusteredMaeDelta"] = cluster_bootstrap_delta(holdout, np.abs(y - holdout_prediction), np.abs(y - baseline_prediction))

    # Distribution parameters use only pre-holdout out-of-sample residuals.
    _, selection_prediction = fit_predict(champion, train, selection, features, target)
    _, confirmation_prediction = fit_predict(champion, training_2023, confirmation, features, target)
    calibration_y = np.concatenate([selection[target].to_numpy(float), confirmation[target].to_numpy(float)])
    calibration_mu = np.concatenate([selection_prediction, confirmation_prediction])
    if config["distribution"] == "count":
        alpha = estimate_count_alpha(calibration_y, calibration_mu)
        poisson = count_distribution_metrics(calibration_y, calibration_mu, "poisson", alpha)
        negative_binomial = count_distribution_metrics(calibration_y, calibration_mu, "negative_binomial", alpha)
        family = "negative_binomial" if negative_binomial["nll"] < poisson["nll"] else "poisson"
        distribution_params = {"family": family, "alpha": alpha}
        distribution_metrics = count_distribution_metrics(y, holdout_prediction, family, alpha)
    else:
        scale = float(np.sqrt(np.mean((calibration_y - calibration_mu) ** 2)))
        distribution_params = {"family": "normal_residual", "scale": scale}
        distribution_metrics = normal_distribution_metrics(y, holdout_prediction, scale)
    final_training = pd.concat([training_2024, holdout], ignore_index=True)
    final_fitted, _ = fit_predict(champion, final_training, holdout.iloc[:1], features, target)
    artifact = {"kind": champion_name, "model": final_fitted.model, "baselineColumn": final_fitted.baseline_column, "distribution": distribution_params, "eligibility": config}
    report = {
        "eligibleRows": {"training": len(train), "selection": len(selection), "confirmation": len(confirmation), "holdout": len(holdout)},
        "champion": champion_name, "selection": selection_results,
        "confirmation": {"selected": selected_confirm_metrics, "ewm": ewm_confirm_metrics, "vetoed": vetoed},
        "holdout": {**holdout_point, **distribution_metrics}, "distribution": distribution_params,
    }
    return report, artifact


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-root", type=pathlib.Path, default=OUTPUT_ROOT)
    args = parser.parse_args()
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    frame, manifest = load_verified_dataset(args.manifest, contract)
    frame, features = prepare_features(frame, manifest)
    masks = split_masks(frame, contract)
    participation, participation_model = participation_tournament(frame, features, masks)
    market_reports: dict[str, Any] = {}
    market_artifacts: dict[str, Any] = {}
    for target, config in contract["markets"].items():
        print(f"tournament {target}...", flush=True)
        market_reports[target], market_artifacts[target] = market_tournament(frame, features, masks, target, config)
    args.output_root.mkdir(parents=True, exist_ok=True)
    artifact_path = args.output_root / "nfl_player_props_distribution_shadow_2026_08_25_r1.joblib"
    report_path = args.output_root / "nfl_player_props_baseline_tournament_2026_08_25_r1.json"
    artifact = {
        "shadowModelRelease": contract["shadowModelRelease"], "calibrationRelease": contract["calibrationRelease"],
        "historicalDatasetRelease": contract["historicalDatasetRelease"], "historicalFeatureSha256": manifest["featureFileSha256"],
        "mode": contract["mode"], "actionable": False, "featureColumns": features,
        "participationModel": {"kind": participation["champion"], "model": participation_model, "baselineColumn": "prior_participated_avg5"},
        "markets": market_artifacts,
        "trainingThrough": int(contract["splits"]["holdout"]),
    }
    joblib.dump(artifact, artifact_path)
    report = {
        **contract, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "historicalFeatureSha256": manifest["featureFileSha256"], "featureColumns": len(features),
        "participation": participation, "marketsReport": market_reports,
        "artifact": str(artifact_path), "artifactSha256": sha256_file(artifact_path),
        "lineProbabilityReady": False,
        "healthFindings": ["HISTORICAL_PROP_PRICES_UNAVAILABLE", "CURRENT_WEEK_CONTEXT_UNSTAMPED", "SPORTSBOOK_OFFER_POPULATION_UNOBSERVED", "COUNT_DISTRIBUTION_INTERVAL_CALIBRATION_INCOMPLETE"],
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionableChange": 0},
    }
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": contract["tournamentRelease"], "shadowModelRelease": contract["shadowModelRelease"],
        "participationChampion": participation["champion"],
        "marketChampions": {market: value["champion"] for market, value in market_reports.items()},
        "holdout": {market: value["holdout"] for market, value in market_reports.items()},
        "artifactSha256": report["artifactSha256"], "report": str(report_path),
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
