#!/usr/bin/env python3
"""Research role/volume-conditioned NFL player-props residual distributions."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-distribution-conditioning/nfl_player_props_distribution_conditioning_r1.json"
SEASONS = (2023, 2024, 2025)
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
SEED = 20261007


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def empirical(residuals: np.ndarray, grid_size: int) -> list[float]:
    values = np.asarray(residuals, dtype=float)
    values = values[np.isfinite(values)]
    if len(values) < 100:
        raise RuntimeError("insufficient residuals for empirical distribution")
    return np.quantile(values, np.linspace(0.0, 1.0, grid_size), method="linear").tolist()


def fit_conditional(
    rows: pd.DataFrame,
    residuals: np.ndarray,
    means: np.ndarray,
    grid_size: int,
    minimum_rows: int,
    role_conditioned: bool,
    mean_bins: int,
) -> dict[str, Any]:
    fallback = empirical(residuals, grid_size)
    positions = sorted(rows["position"].dropna().astype(str).unique()) if role_conditioned else [None]
    groups: list[dict[str, Any]] = []
    row_positions = rows["position"].astype(str).to_numpy()
    for position in positions:
        role_mask = np.ones(len(rows), dtype=bool) if position is None else row_positions == position
        if int(role_mask.sum()) < minimum_rows:
            continue
        if mean_bins <= 1:
            edges = np.asarray([float(np.min(means[role_mask])), float(np.max(means[role_mask]))])
        else:
            edges = np.unique(np.quantile(means[role_mask], np.linspace(0.0, 1.0, mean_bins + 1)))
        for index in range(max(1, len(edges) - 1)):
            lower = float(edges[index])
            upper = float(edges[index + 1])
            mask = role_mask & (means >= lower) & (means <= upper if index == len(edges) - 2 else means < upper)
            if int(mask.sum()) < minimum_rows:
                continue
            groups.append({
                "position": position,
                "lower": lower,
                "upper": upper,
                "rows": int(mask.sum()),
                "residualQuantiles": empirical(residuals[mask], grid_size),
            })
    return {
        "family": "conditional_empirical_residual",
        "roleConditioned": role_conditioned,
        "meanBins": mean_bins,
        "fallbackResidualQuantiles": fallback,
        "groups": groups,
    }


def fit_scaled(
    rows: pd.DataFrame,
    residuals: np.ndarray,
    means: np.ndarray,
    grid_size: int,
    minimum_rows: int,
    role_conditioned: bool,
) -> dict[str, Any]:
    positions = sorted(rows["position"].dropna().astype(str).unique()) if role_conditioned else [None]
    row_positions = rows["position"].astype(str).to_numpy()
    scales: list[dict[str, Any]] = []
    assigned = np.full(len(rows), np.nan)
    global_scale = float(np.sqrt(np.mean(np.square(residuals))))
    for position in positions:
        role_mask = np.ones(len(rows), dtype=bool) if position is None else row_positions == position
        if int(role_mask.sum()) < minimum_rows:
            continue
        edges = np.unique(np.quantile(means[role_mask], np.linspace(0.0, 1.0, 5)))
        for index in range(max(1, len(edges) - 1)):
            lower = float(edges[index])
            upper = float(edges[index + 1])
            mask = role_mask & (means >= lower) & (means <= upper if index == len(edges) - 2 else means < upper)
            if int(mask.sum()) < minimum_rows:
                continue
            scale = max(float(np.sqrt(np.mean(np.square(residuals[mask])))), 0.25)
            assigned[mask] = scale
            scales.append({"position": position, "lower": lower, "upper": upper, "rows": int(mask.sum()), "scale": scale})
    assigned = np.where(np.isfinite(assigned), assigned, global_scale)
    return {
        "family": "scaled_empirical_residual",
        "roleConditioned": role_conditioned,
        "fallbackScale": global_scale,
        "standardizedResidualQuantiles": empirical(residuals / np.maximum(assigned, 0.25), grid_size),
        "scales": scales,
    }


def residual_grids(distribution: dict[str, Any], rows: pd.DataFrame, means: np.ndarray) -> list[np.ndarray]:
    positions = rows["position"].astype(str).to_numpy()
    if distribution["family"] == "conditional_empirical_residual":
        fallback = np.asarray(distribution["fallbackResidualQuantiles"], dtype=float)
        output: list[np.ndarray] = []
        for position, mean in zip(positions, means, strict=True):
            selected = fallback
            for group in distribution["groups"]:
                if group["position"] is not None and group["position"] != position:
                    continue
                if float(group["lower"]) <= mean <= float(group["upper"]):
                    selected = np.asarray(group["residualQuantiles"], dtype=float)
                    break
            output.append(selected)
        return output
    standardized = np.asarray(distribution["standardizedResidualQuantiles"], dtype=float)
    output = []
    for position, mean in zip(positions, means, strict=True):
        scale = float(distribution["fallbackScale"])
        for group in distribution["scales"]:
            if group["position"] is not None and group["position"] != position:
                continue
            if float(group["lower"]) <= mean <= float(group["upper"]):
                scale = float(group["scale"])
                break
        output.append(standardized * scale)
    return output


def metrics(
    actual: np.ndarray,
    means: np.ndarray,
    rows: pd.DataFrame,
    distribution: dict[str, Any],
) -> tuple[dict[str, float], np.ndarray]:
    grids = residual_grids(distribution, rows, means)
    pits = np.empty(len(actual))
    crps = np.empty(len(actual))
    nll = np.empty(len(actual))
    coverage = {50: np.empty(len(actual), dtype=bool), 80: np.empty(len(actual), dtype=bool), 90: np.empty(len(actual), dtype=bool)}
    for index, (outcome, mean, residual_values) in enumerate(zip(actual, means, grids, strict=True)):
        outcomes = np.clip(mean + residual_values, 0.0, None)
        pits[index] = np.mean(outcomes <= outcome)
        ordered = np.sort(outcomes)
        pair = np.sum((2 * np.arange(1, len(ordered) + 1) - len(ordered) - 1) * ordered) / (len(ordered) ** 2)
        crps[index] = np.mean(np.abs(outcomes - outcome)) - pair
        bandwidth = max(float(np.std(outcomes)) * len(outcomes) ** (-0.2), 0.25)
        density = np.mean(stats.norm.pdf((outcome - outcomes) / bandwidth)) / bandwidth
        nll[index] = -math.log(max(float(density), 1e-12))
        for level in coverage:
            tail = (1.0 - level / 100.0) / 2.0
            lower, upper = np.quantile(outcomes, [tail, 1.0 - tail])
            coverage[level][index] = lower <= outcome <= upper
    return ({
        "nll": float(np.mean(nll)),
        "crps": float(np.mean(crps)),
        "pitMean": float(np.mean(pits)),
        "pitKs": float(stats.kstest(pits, "uniform").statistic),
        **{f"coverage_{level}": float(values.mean()) for level, values in coverage.items()},
    }, crps)


def clustered_delta(rows: pd.DataFrame, candidate: np.ndarray, incumbent: np.ndarray) -> dict[str, float | int]:
    clusters = pd.DataFrame({"game_id": rows["game_id"].to_numpy(), "delta": candidate - incumbent}).groupby("game_id", observed=True)["delta"].agg(["sum", "count"])
    values = clusters.to_numpy(float)
    rng = np.random.default_rng(SEED)
    draws = np.empty(500)
    for index in range(len(draws)):
        sample = values[rng.integers(0, len(values), len(values))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    return {
        "meanCrpsDelta": float(np.mean(draws)),
        "ciLow": float(np.quantile(draws, 0.025)),
        "ciHigh": float(np.quantile(draws, 0.975)),
        "gameClusters": int(len(values)),
    }


def coverage_eligible(values: dict[str, float], contract: dict[str, Any]) -> bool:
    return (
        abs(values["coverage_80"] - 0.8) <= float(contract["selection"]["maximumAbsoluteCoverage80Error"])
        and abs(values["coverage_90"] - 0.9) <= float(contract["selection"]["maximumAbsoluteCoverage90Error"])
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("props_dist_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_dist_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("props_dist_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    opportunity = load_module("props_dist_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    recalibration = load_module("props_dist_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    history_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, history_contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    matchup_rows, matchup_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    eligible = {market: baseline.market_eligible(frame, history_contract["markets"][market]) for market in MARKETS}

    rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    predictions: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    for season in SEASONS:
        print(f"distribution-conditioning season {season}...", flush=True)
        season_rows, season_predictions, _ = opportunity.incumbent_predictions(
            trainer, frame, eligible, season, base_features, enhanced_features,
        )
        for market in MARKETS:
            rows[market][season] = season_rows[market]
            actual[market][season] = season_rows[market][market].to_numpy(float)
            predictions[market][season] = season_predictions[market]

    grid = int(calibration_contract["empiricalQuantileGridSize"])
    minimum = int(calibration_contract["minimumBucketRows"])
    report: dict[str, Any] = {}
    production_distributions: dict[str, Any] = {}
    for market in MARKETS:
        fit_rows = rows[market][2023]
        fit_residuals = actual[market][2023] - predictions[market][2023]
        fit_means = predictions[market][2023]
        incumbent_fit = {
            "global": fit_conditional(fit_rows, fit_residuals, fit_means, grid, minimum, False, 1),
            "mean_quartile": fit_conditional(fit_rows, fit_residuals, fit_means, grid, minimum, False, 4),
        }
        incumbent_selection = {
            name: metrics(actual[market][2024], predictions[market][2024], rows[market][2024], distribution)[0]
            for name, distribution in incumbent_fit.items()
        }
        incumbent_name = min(
            incumbent_selection,
            key=lambda name: recalibration.selection_key(incumbent_selection[name], calibration_contract),
        )
        candidate_fit = {
            "mean_quintile": fit_conditional(fit_rows, fit_residuals, fit_means, grid, minimum, False, 5),
            "role_global": fit_conditional(fit_rows, fit_residuals, fit_means, grid, minimum, True, 1),
            "role_mean_quartile": fit_conditional(fit_rows, fit_residuals, fit_means, grid, minimum, True, 4),
            "scaled_mean_quartile": fit_scaled(fit_rows, fit_residuals, fit_means, grid, minimum, False),
            "scaled_role_mean_quartile": fit_scaled(fit_rows, fit_residuals, fit_means, grid, minimum, True),
        }
        candidate_selection = {
            name: metrics(actual[market][2024], predictions[market][2024], rows[market][2024], distribution)[0]
            for name, distribution in candidate_fit.items()
        }
        incumbent_metrics = incumbent_selection[incumbent_name]
        selectable = [name for name, values in candidate_selection.items() if (
            coverage_eligible(values, calibration_contract)
            and values["crps"] < incumbent_metrics["crps"]
            and values["nll"] <= incumbent_metrics["nll"] * 1.005
        )]
        selected = min(selectable, key=lambda name: candidate_selection[name]["crps"]) if selectable else None

        combined_rows = pd.concat([rows[market][2023], rows[market][2024]], ignore_index=True)
        combined_actual = np.concatenate([actual[market][2023], actual[market][2024]])
        combined_means = np.concatenate([predictions[market][2023], predictions[market][2024]])
        combined_residuals = combined_actual - combined_means
        incumbent_final = (
            fit_conditional(combined_rows, combined_residuals, combined_means, grid, minimum, False, 1)
            if incumbent_name == "global"
            else fit_conditional(combined_rows, combined_residuals, combined_means, grid, minimum, False, 4)
        )
        if selected is None:
            candidate_final = incumbent_final
        elif selected == "mean_quintile":
            candidate_final = fit_conditional(combined_rows, combined_residuals, combined_means, grid, minimum, False, 5)
        elif selected == "role_global":
            candidate_final = fit_conditional(combined_rows, combined_residuals, combined_means, grid, minimum, True, 1)
        elif selected == "role_mean_quartile":
            candidate_final = fit_conditional(combined_rows, combined_residuals, combined_means, grid, minimum, True, 4)
        elif selected == "scaled_mean_quartile":
            candidate_final = fit_scaled(combined_rows, combined_residuals, combined_means, grid, minimum, False)
        else:
            candidate_final = fit_scaled(combined_rows, combined_residuals, combined_means, grid, minimum, True)
        incumbent_holdout, incumbent_crps = metrics(
            actual[market][2025], predictions[market][2025], rows[market][2025], incumbent_final,
        )
        candidate_holdout, candidate_crps = metrics(
            actual[market][2025], predictions[market][2025], rows[market][2025], candidate_final,
        )
        holdout_pass = bool(selected and coverage_eligible(candidate_holdout, calibration_contract)
                            and candidate_holdout["crps"] < incumbent_holdout["crps"]
                            and candidate_holdout["nll"] <= incumbent_holdout["nll"] * 1.005)
        production_distributions[market] = (
            recalibration.bucketed_empirical_distribution(
                combined_residuals, combined_means, grid, minimum, bucket_count=5,
            )
            if holdout_pass
            else recalibration.bucketed_empirical_distribution(
                combined_residuals, combined_means, grid, minimum,
            ) if incumbent_name == "mean_quartile" else recalibration.empirical_distribution(
                combined_residuals, grid,
            )
        )
        report[market] = {
            "incumbentSelection": {"selected": incumbent_name, "candidates": incumbent_selection},
            "candidateSelection": {"selected": selected, "candidates": candidate_selection},
            "holdout": {
                "incumbent": incumbent_holdout,
                "candidate": candidate_holdout,
                "passes": holdout_pass,
                "clusteredCrpsDelta": clustered_delta(rows[market][2025], candidate_crps, incumbent_crps),
            },
        }

    output = {
        "release": "nfl_player_props_distribution_conditioning_tournament_2026_10_07_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"pointTrainingEnd": 2022, "calibrationFit": 2023, "selection": 2024, "holdout": 2025},
        "pointModel": "refit current full-family recipes; unchanged",
        "markets": report,
        "productionDistributions": production_distributions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {
            market: {
                "incumbent": values["incumbentSelection"]["selected"],
                "selected": values["candidateSelection"]["selected"],
                "holdout": values["holdout"],
            }
            for market, values in report.items()
        },
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
