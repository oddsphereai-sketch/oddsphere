#!/usr/bin/env python3
"""Select independent threshold distributions for expected-role prop heads."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import re
import sys
import time
import unicodedata
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.linear_model import LogisticRegression


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_team_target_allocation_2026_projections_r1.parquet"
DEFAULT_FOUNDATION_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
DEFAULT_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_independent_distribution_release_r1.json"
DEFAULT_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_independent_distribution_release_2025_rows_r1.parquet"
MARKETS = ("passing_attempts", "receptions", "receiving_yards")
COUNT_MARKETS = {"passing_attempts", "receptions"}
MIXTURE_WEIGHTS = (0.0, 0.25, 0.50, 0.75, 1.0)
SEED = 20261008


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_player(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


def normalize_team(value: str) -> str:
    team = str(value).upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def probability_metrics(actual: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    values = np.clip(np.asarray(probability, dtype=float), 1e-6, 1.0 - 1e-6)
    outcome = np.asarray(actual, dtype=float)
    return {
        "rows": int(len(outcome)),
        "wins": int(outcome.sum()),
        "observedRate": float(outcome.mean()),
        "meanProbability": float(values.mean()),
        "calibrationGap": float(abs(values.mean() - outcome.mean())),
        "brier": float(np.mean((values - outcome) ** 2)),
        "logLoss": float(np.mean(-(outcome * np.log(values) + (1.0 - outcome) * np.log(1.0 - values)))),
        "directionAccuracy": float(np.mean((values > 0.5) == outcome)),
    }


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = np.asarray(prediction, dtype=float) - np.asarray(actual, dtype=float)
    return {
        "rows": int(len(error)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
    }


def fit_candidates(
    market: str,
    rows: pd.DataFrame,
    prediction: np.ndarray,
    conditioning: Any,
    baseline: Any,
    grid: int,
    minimum: int,
) -> dict[str, dict[str, Any]]:
    actual = rows["actual"].to_numpy(float)
    residuals = actual - prediction
    candidates = {
        "empirical_global": conditioning.fit_conditional(rows, residuals, prediction, grid, minimum, False, 1),
        "empirical_mean_quartile": conditioning.fit_conditional(rows, residuals, prediction, grid, minimum, False, 4),
        "empirical_mean_quintile": conditioning.fit_conditional(rows, residuals, prediction, grid, minimum, False, 5),
        "empirical_role": conditioning.fit_conditional(rows, residuals, prediction, grid, minimum, True, 1),
        "empirical_role_mean_tertile": conditioning.fit_conditional(rows, residuals, prediction, grid, minimum, True, 3),
        "scaled_mean": conditioning.fit_scaled(rows, residuals, prediction, grid, minimum, False),
        "scaled_role": conditioning.fit_scaled(rows, residuals, prediction, grid, minimum, True),
    }
    residual_location = float(np.mean(residuals))
    residual_scale = max(float(np.std(residuals)), 0.25)
    if market in COUNT_MARKETS:
        alpha = float(baseline.estimate_count_alpha(actual, np.clip(prediction, 1e-6, None)))
        candidates["poisson"] = {"family": "poisson", "alpha": alpha}
        candidates["negative_binomial"] = {"family": "negative_binomial", "alpha": alpha}
    else:
        candidates["normal"] = {
            "family": "normal_residual",
            "location": residual_location,
            "scale": residual_scale,
        }
        for degrees in (3, 5, 8):
            candidates[f"student_t_{degrees}"] = {
                "family": "student_t_residual",
                "degrees": degrees,
                "location": residual_location,
                "scale": max(residual_scale * math.sqrt((degrees - 2) / degrees), 0.25),
            }
    return candidates


def fit_foundation_candidates(
    market: str,
    rows: pd.DataFrame,
    prediction: np.ndarray,
    conditioning: Any,
    baseline: Any,
    grid: int,
    minimum: int,
) -> dict[str, dict[str, Any]]:
    actual = rows["actual"].to_numpy(float)
    residuals = actual - prediction
    candidates = {
        "empirical_global": conditioning.fit_conditional(
            rows, residuals, prediction, grid, minimum, False, 1,
        ),
        "empirical_mean_quartile": conditioning.fit_conditional(
            rows, residuals, prediction, grid, minimum, False, 4,
        ),
    }
    if market in COUNT_MARKETS:
        alpha = float(baseline.estimate_count_alpha(actual, np.clip(prediction, 1e-6, None)))
        candidates["poisson"] = {"family": "poisson", "alpha": alpha}
        candidates["negative_binomial"] = {"family": "negative_binomial", "alpha": alpha}
    else:
        candidates["normal"] = {
            "family": "normal_residual",
            "location": 0.0,
            "scale": max(float(np.sqrt(np.mean(residuals ** 2))), 0.25),
        }
    return candidates


def distribution_metrics(
    distribution: dict[str, Any],
    rows: pd.DataFrame,
    means: np.ndarray,
    conditioning: Any,
    baseline: Any,
) -> dict[str, float]:
    family = str(distribution["family"])
    actual = rows["actual"].to_numpy(float)
    if family in {"conditional_empirical_residual", "scaled_empirical_residual"}:
        return conditioning.metrics(actual, means, rows, distribution)[0]
    if family in {"poisson", "negative_binomial"}:
        return baseline.count_distribution_metrics(
            actual, means, family, float(distribution.get("alpha", 1e-6)),
        )
    if family == "normal_residual" and float(distribution.get("location", 0.0)) == 0.0:
        return baseline.normal_distribution_metrics(actual, means, float(distribution["scale"]))
    raise ValueError(f"unsupported foundation distribution family: {family}")


def over_probability(
    distribution: dict[str, Any],
    rows: pd.DataFrame,
    means: np.ndarray,
    lines: np.ndarray,
    conditioning: Any,
) -> np.ndarray:
    family = str(distribution["family"])
    if family in {"conditional_empirical_residual", "scaled_empirical_residual"}:
        grids = conditioning.residual_grids(distribution, rows, means)
        return np.asarray([
            np.mean(np.clip(mean + residuals, 0.0, None) > line)
            for mean, line, residuals in zip(means, lines, grids, strict=True)
        ], dtype=float)
    if family == "poisson":
        return stats.poisson.sf(np.floor(lines), np.maximum(means, 1e-6))
    if family == "negative_binomial":
        alpha = max(float(distribution["alpha"]), 1e-9)
        size = 1.0 / alpha
        probability = size / (size + np.maximum(means, 1e-6))
        return stats.nbinom.sf(np.floor(lines), size, probability)
    location = means + float(distribution["location"])
    scale = max(float(distribution["scale"]), 1e-6)
    if family == "student_t_residual":
        return stats.t.sf((lines - location) / scale, df=int(distribution["degrees"]))
    return stats.norm.sf(lines, loc=location, scale=scale)


def fit_logistic(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    clipped = np.clip(np.asarray(probability, dtype=float), 1e-5, 1.0 - 1e-5)
    feature = np.log(clipped / (1.0 - clipped)).reshape(-1, 1)
    fitted = LogisticRegression(C=1.0, solver="lbfgs", random_state=SEED).fit(feature, outcome.astype(int))
    return {"intercept": float(fitted.intercept_[0]), "slope": float(fitted.coef_[0, 0])}


def apply_logistic(probability: np.ndarray, calibration: dict[str, float] | None) -> np.ndarray:
    if calibration is None:
        return np.asarray(probability, dtype=float)
    clipped = np.clip(np.asarray(probability, dtype=float), 1e-5, 1.0 - 1e-5)
    logit = np.log(clipped / (1.0 - clipped))
    value = float(calibration["intercept"]) + float(calibration["slope"]) * logit
    return 1.0 / (1.0 + np.exp(-value))


def game_mapping(games: list[dict[str, Any]], projections: pd.DataFrame) -> dict[str, str]:
    identities: dict[tuple[str, str], list[str]] = {}
    for game_id in projections["game_id"].drop_duplicates().astype(str):
        parts = game_id.split("_")
        if len(parts) < 4:
            continue
        key = (normalize_team(parts[-2]), normalize_team(parts[-1]))
        identities.setdefault(key, []).append(game_id)
    output: dict[str, str] = {}
    for game in games:
        key = (normalize_team(game["awayTeam"]), normalize_team(game["homeTeam"]))
        matches = identities.get(key, [])
        if len(matches) == 1:
            output[str(game["id"])] = matches[0]
    return output


def opening_thresholds(path: pathlib.Path, projections: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("release") not in {
        "nfl_player_props_2025_opening_prices_2026_08_25_r1",
        "nfl_player_props_2025_opening_prices_2026_09_01_r2_provider_recovery",
    }:
        raise RuntimeError("unsupported NFL player-props opening archive")
    mapping = game_mapping(payload["games"], projections)
    observations = pd.DataFrame(payload["observations"])
    observations = observations[
        observations["market"].isin(MARKETS)
        & observations["offerType"].eq("over_under")
        & observations["side"].isin(["over", "under"])
    ].copy()
    observations["game_id"] = observations["providerEventId"].astype(str).map(mapping)
    observations["normalized_player"] = observations["playerName"].map(normalize_player)
    observations = observations.dropna(subset=["game_id"])
    pair_keys = ["game_id", "normalized_player", "market", "sportsbook", "line", "observedAt"]
    paired = observations.pivot_table(
        index=pair_keys, columns="side", values="americanPrice", aggfunc="last",
    ).reset_index().dropna(subset=["over", "under"])
    thresholds = paired[["game_id", "normalized_player", "market", "line"]].drop_duplicates()
    return thresholds, {
        "release": payload["release"],
        "sha256": sha256(path),
        "games": int(len(payload["games"])),
        "gamesMapped": int(len(mapping)),
        "pairedBookOffers": int(len(paired)),
        "uniqueThresholds": int(len(thresholds)),
    }


def model_points(rows: pd.DataFrame, market: str) -> tuple[np.ndarray, np.ndarray]:
    if market == "passing_attempts":
        return rows["released_projection"].to_numpy(float), rows["candidate_projection"].to_numpy(float)
    return rows["released_projection"].to_numpy(float), rows["candidate_projection"].to_numpy(float)


def selection_key(metrics: dict[str, float | int]) -> tuple[float, float, float, float]:
    return (
        float(metrics["brier"]),
        float(metrics["logLoss"]),
        float(metrics["calibrationGap"]),
        -float(metrics["directionAccuracy"]),
    )


def calibration_selection_key(
    metrics: dict[str, float], contract: dict[str, Any],
) -> tuple[float, float, float, float]:
    coverage_error = abs(metrics["coverage_80"] - 0.8) + abs(metrics["coverage_90"] - 0.9)
    eligible = (
        abs(metrics["coverage_80"] - 0.8)
        <= float(contract["selection"]["maximumAbsoluteCoverage80Error"])
        and abs(metrics["coverage_90"] - 0.9)
        <= float(contract["selection"]["maximumAbsoluteCoverage90Error"])
    )
    return (
        0.0 if eligible else 1.0,
        metrics["crps"] if eligible else coverage_error,
        coverage_error,
        metrics["crps"],
    )


def refit_selected(
    market: str,
    name: str,
    rows: pd.DataFrame,
    prediction: np.ndarray,
    conditioning: Any,
    baseline: Any,
    grid: int,
    minimum: int,
) -> dict[str, Any]:
    return fit_candidates(market, rows, prediction, conditioning, baseline, grid, minimum)[name]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--openings", type=pathlib.Path, required=True)
    parser.add_argument("--projections", type=pathlib.Path, default=DEFAULT_PROJECTIONS)
    parser.add_argument(
        "--foundation-projections", type=pathlib.Path, default=DEFAULT_FOUNDATION_PROJECTIONS,
    )
    parser.add_argument("--replay", type=pathlib.Path, default=DEFAULT_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--rows-output", type=pathlib.Path, default=DEFAULT_ROWS)
    args = parser.parse_args()

    conditioning = load(
        "props_independent_distribution_conditioning",
        ROOT / "scripts/operator/tournament_nfl_player_props_distribution_conditioning.py",
    )
    baseline = load(
        "props_independent_distribution_baseline",
        ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py",
    )
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    grid = int(contract["empiricalQuantileGridSize"])
    minimum = int(contract["minimumBucketRows"])

    projections = pd.read_parquet(args.projections)
    projections["normalized_player"] = projections["player_name"].map(normalize_player)
    foundation_projections = pd.read_parquet(args.foundation_projections)
    foundation_projections["normalized_player"] = foundation_projections["player_name"].map(normalize_player)
    confirmation = projections[
        projections["phase"].eq("confirmation") & projections["market"].isin(MARKETS)
    ].copy()
    thresholds, opening_report = opening_thresholds(args.openings, confirmation)
    historical = thresholds.merge(
        confirmation,
        on=["game_id", "normalized_player", "market"],
        how="inner",
        validate="many_to_one",
    )
    historical = historical[historical["actual"].ne(historical["line"])].copy()
    historical["outcome_over"] = historical["actual"].gt(historical["line"]).astype(float)
    if len(historical) < 1_000:
        raise RuntimeError(f"historical threshold join is too small: {len(historical)}")

    replay = pd.DataFrame(json.loads(args.replay.read_text(encoding="utf-8"))["rows"])
    replay["normalized_player"] = replay["playerName"].map(normalize_player)
    locked_projection = projections[
        projections["phase"].eq("locked_replay") & projections["market"].isin(MARKETS)
    ].copy()
    locked_projection = locked_projection.rename(columns={
        "position": "candidate_position",
        "component_projection": "candidate_component_projection",
        "frozen_blend_weight": "candidate_blend_weight",
    })
    locked_foundation = foundation_projections[
        foundation_projections["phase"].eq("locked_replay")
        & foundation_projections["market"].isin(MARKETS)
    ][[
        "week", "market", "normalized_player", "position",
        "component_projection", "frozen_blend_weight",
    ]].rename(columns={
        "position": "foundation_position",
        "component_projection": "foundation_component_projection",
        "frozen_blend_weight": "foundation_blend_weight",
    })
    locked = replay[replay["market"].isin(MARKETS)].merge(
        locked_projection[[
            "week", "market", "normalized_player", "candidate_position",
            "candidate_component_projection", "candidate_blend_weight",
        ]],
        on=["week", "market", "normalized_player"],
        how="left",
        validate="many_to_one",
    )
    locked = locked.merge(
        locked_foundation,
        on=["week", "market", "normalized_player"],
        how="left",
        validate="many_to_one",
    )
    if locked["candidate_component_projection"].isna().any():
        raise RuntimeError("exact 2026 replay has unmatched affected scopes")
    locked["position"] = locked["candidate_position"].fillna(locked["foundation_position"])
    locked["candidate_projection"] = (
        (1.0 - locked["candidate_blend_weight"]) * locked["independentProjection"]
        + locked["candidate_blend_weight"] * locked["candidate_component_projection"]
    )
    locked["released_projection"] = locked["independentProjection"]
    receiving = locked["market"].isin(["receptions", "receiving_yards"])
    if locked.loc[receiving, "foundation_component_projection"].isna().any():
        raise RuntimeError("exact 2026 replay has unmatched receiving foundation scopes")
    locked.loc[receiving, "released_projection"] = (
        (1.0 - locked.loc[receiving, "foundation_blend_weight"])
        * locked.loc[receiving, "independentProjection"]
        + locked.loc[receiving, "foundation_blend_weight"]
        * locked.loc[receiving, "foundation_component_projection"]
    )

    market_report: dict[str, Any] = {}
    chosen: dict[str, Any] = {}
    historical_rows: list[pd.DataFrame] = []
    locked_outputs: list[pd.DataFrame] = []
    for market in MARKETS:
        selection = projections[projections["phase"].eq("selection") & projections["market"].eq(market)].copy()
        confirmation_rows = projections[
            projections["phase"].eq("confirmation") & projections["market"].eq(market)
        ].copy()
        foundation_fit, challenger_fit = model_points(selection, market)
        foundation_confirmation, challenger_confirmation = model_points(confirmation_rows, market)
        foundation_candidates = fit_foundation_candidates(
            market, selection, foundation_fit, conditioning, baseline, grid, minimum,
        )
        challenger_candidates = fit_candidates(
            market, selection, challenger_fit, conditioning, baseline, grid, minimum,
        )

        history = historical[historical["market"].eq(market)].copy()
        confirmation_index = confirmation_rows.set_index("row_id")
        history["foundation_projection"] = confirmation_index.loc[history["row_id"], "released_projection"].to_numpy(float)
        history["challenger_projection"] = confirmation_index.loc[history["row_id"], "candidate_projection"].to_numpy(float)
        early = history["week"].le(9).to_numpy()
        late = ~early
        robustness_blocks = ((7, 9), (10, 12), (13, 15), (16, 18))
        oof = history["week"].ge(7).to_numpy()
        if int(early.sum()) < 100 or int(late.sum()) < 100 or int(oof.sum()) < 100:
            raise RuntimeError(f"insufficient chronological threshold rows for {market}")

        foundation_late: dict[str, dict[str, float | int]] = {}
        foundation_distribution_metrics: dict[str, dict[str, float]] = {}
        foundation_probabilities: dict[str, np.ndarray] = {}
        for name, distribution in foundation_candidates.items():
            probability = over_probability(
                distribution,
                history,
                history["foundation_projection"].to_numpy(float),
                history["line"].to_numpy(float),
                conditioning,
            )
            foundation_probabilities[name] = probability
            foundation_late[name] = probability_metrics(
                history.loc[late, "outcome_over"].to_numpy(float), probability[late],
            )
            foundation_distribution_metrics[name] = distribution_metrics(
                distribution,
                confirmation_rows,
                foundation_confirmation,
                conditioning,
                baseline,
            )
        foundation_name = min(
            foundation_distribution_metrics,
            key=lambda name: (
                *calibration_selection_key(foundation_distribution_metrics[name], contract),
                foundation_distribution_metrics[name]["nll"],
            ),
        )
        foundation_probability = foundation_probabilities[foundation_name]
        foundation_metrics = probability_metrics(
            history.loc[oof, "outcome_over"].to_numpy(float), foundation_probability[oof],
        )
        foundation_blocks = {
            f"weeks_{start}_{end}": probability_metrics(
                history.loc[
                    history["week"].between(start, end), "outcome_over"
                ].to_numpy(float),
                foundation_probability[history["week"].between(start, end).to_numpy()],
            )
            for start, end in robustness_blocks
        }

        candidates: dict[str, Any] = {}
        for distribution_name, distribution in challenger_candidates.items():
            challenger_probability = over_probability(
                distribution,
                history,
                history["challenger_projection"].to_numpy(float),
                history["line"].to_numpy(float),
                conditioning,
            )
            for weight in MIXTURE_WEIGHTS:
                mixed = (1.0 - weight) * foundation_probability + weight * challenger_probability
                for calibration_name in ("identity", "logistic"):
                    calibrated = np.full(len(history), np.nan)
                    block_metrics: dict[str, dict[str, float | int]] = {}
                    for start, end in robustness_blocks:
                        training = history["week"].lt(start).to_numpy()
                        testing = history["week"].between(start, end).to_numpy()
                        calibration = (
                            fit_logistic(
                                mixed[training],
                                history.loc[training, "outcome_over"].to_numpy(float),
                            ) if calibration_name == "logistic" else None
                        )
                        calibrated[testing] = apply_logistic(mixed[testing], calibration)
                        block_metrics[f"weeks_{start}_{end}"] = probability_metrics(
                            history.loc[testing, "outcome_over"].to_numpy(float),
                            calibrated[testing],
                        )
                    name = f"{distribution_name}__mix_{int(weight * 100)}__{calibration_name}"
                    candidates[name] = {
                        "distribution": distribution_name,
                        "challengerWeight": weight,
                        "calibration": calibration_name,
                        "validation": probability_metrics(
                            history.loc[oof, "outcome_over"].to_numpy(float), calibrated[oof],
                        ),
                        "blocks": block_metrics,
                    }
        eligible: list[str] = []
        for name, values in candidates.items():
            block_deltas = [
                float(values["blocks"][key]["brier"]) - float(foundation_blocks[key]["brier"])
                for key in foundation_blocks
            ]
            values["brierBlockDeltas"] = block_deltas
            values["improvedBrierBlocks"] = int(sum(delta < 0.0 for delta in block_deltas))
            values["worstBrierBlockDelta"] = float(max(block_deltas))
            if (
                float(values["validation"]["brier"]) < float(foundation_metrics["brier"])
                and float(values["validation"]["logLoss"]) < float(foundation_metrics["logLoss"])
                and float(values["validation"]["directionAccuracy"])
                >= float(foundation_metrics["directionAccuracy"])
                and int(values["improvedBrierBlocks"]) >= 3
                and float(values["worstBrierBlockDelta"]) <= 0.005
            ):
                eligible.append(name)
        selected_name = min(
            eligible,
            key=lambda name: (
                float(candidates[name]["worstBrierBlockDelta"]),
                float(candidates[name]["validation"]["brier"]),
                float(candidates[name]["validation"]["logLoss"]),
                0 if candidates[name]["calibration"] == "identity" else 1,
                -float(candidates[name]["validation"]["directionAccuracy"]),
            ),
        ) if eligible else None
        selected = candidates[selected_name] if selected_name else None

        combined_rows = pd.concat([selection, confirmation_rows], ignore_index=True)
        combined_foundation, combined_challenger = model_points(combined_rows, market)
        foundation_final = fit_foundation_candidates(
            market, combined_rows, combined_foundation,
            conditioning, baseline, grid, minimum,
        )[foundation_name]
        selected_distribution_name = str(selected["distribution"]) if selected else foundation_name
        challenger_final = refit_selected(
            market, selected_distribution_name, combined_rows, combined_challenger,
            conditioning, baseline, grid, minimum,
        )
        full_foundation_probability = over_probability(
            foundation_final,
            history,
            history["foundation_projection"].to_numpy(float),
            history["line"].to_numpy(float),
            conditioning,
        )
        full_challenger_probability = over_probability(
            challenger_final,
            history,
            history["challenger_projection"].to_numpy(float),
            history["line"].to_numpy(float),
            conditioning,
        )
        chosen_weight = float(selected["challengerWeight"]) if selected else 0.0
        full_mixed = (1.0 - chosen_weight) * full_foundation_probability + chosen_weight * full_challenger_probability
        final_calibration = (
            fit_logistic(full_mixed, history["outcome_over"].to_numpy(float))
            if selected and selected["calibration"] == "logistic" else None
        )
        history["foundation_over_probability"] = full_foundation_probability
        history["candidate_over_probability"] = apply_logistic(full_mixed, final_calibration)
        historical_rows.append(history)

        current = locked[locked["market"].eq(market)].copy()
        foundation_locked = current["released_projection"].to_numpy(float)
        challenger_locked = current["candidate_projection"].to_numpy(float)
        foundation_over = over_probability(
            foundation_final, current, foundation_locked, current["line"].to_numpy(float), conditioning,
        )
        challenger_over = over_probability(
            challenger_final, current, challenger_locked, current["line"].to_numpy(float), conditioning,
        )
        candidate_over = apply_logistic(
            (1.0 - chosen_weight) * foundation_over + chosen_weight * challenger_over,
            final_calibration,
        )
        current["foundation_over_probability"] = foundation_over
        current["candidate_over_probability"] = candidate_over
        current["foundation_side_probability"] = np.where(
            current["side"].eq("over"), foundation_over, 1.0 - foundation_over,
        )
        current["candidate_side_probability"] = np.where(
            current["side"].eq("over"), candidate_over, 1.0 - candidate_over,
        )
        current["foundation_probability_outcome"] = np.where(
            (foundation_over > 0.5) == current["side"].eq("over"), current["outcome"], 1 - current["outcome"],
        )
        current["candidate_probability_outcome"] = np.where(
            (candidate_over > 0.5) == current["side"].eq("over"), current["outcome"], 1 - current["outcome"],
        )
        locked_outputs.append(current)
        foundation_locked_metrics = probability_metrics(
            current["outcome"].to_numpy(float), current["foundation_side_probability"].to_numpy(float),
        )
        candidate_locked_metrics = probability_metrics(
            current["outcome"].to_numpy(float), current["candidate_side_probability"].to_numpy(float),
        )
        replay_pass = bool(
            selected
            and point_metrics(current["actual"].to_numpy(float), challenger_locked)["mae"]
            <= point_metrics(current["actual"].to_numpy(float), foundation_locked)["mae"]
            and point_metrics(current["actual"].to_numpy(float), challenger_locked)["rmse"]
            <= point_metrics(current["actual"].to_numpy(float), foundation_locked)["rmse"]
            and candidate_locked_metrics["brier"] <= foundation_locked_metrics["brier"]
            and candidate_locked_metrics["logLoss"] <= foundation_locked_metrics["logLoss"]
            and candidate_locked_metrics["directionAccuracy"] >= foundation_locked_metrics["directionAccuracy"]
        )
        market_report[market] = {
            "selectionRows": {
                "early": int(early.sum()),
                "late": int(late.sum()),
                "robustOutOfFold": int(oof.sum()),
                "pushesExcluded": int(len(thresholds[thresholds["market"].eq(market)]) - len(history)),
            },
            "foundationDistribution": foundation_name,
            "foundationValidation": foundation_metrics,
            "foundationValidationBlocks": foundation_blocks,
            "selected": selected_name,
            "selectedValidation": selected["validation"] if selected else None,
            "candidateCount": len(candidates),
            "historicalPoint": {
                "foundation2024": point_metrics(selection["actual"].to_numpy(float), foundation_fit),
                "challenger2024": point_metrics(selection["actual"].to_numpy(float), challenger_fit),
                "foundation2025": point_metrics(confirmation_rows["actual"].to_numpy(float), foundation_confirmation),
                "challenger2025": point_metrics(confirmation_rows["actual"].to_numpy(float), challenger_confirmation),
            },
            "locked2026": {
                "rows": int(len(current)),
                "foundationPoint": point_metrics(current["actual"].to_numpy(float), foundation_locked),
                "challengerPoint": point_metrics(current["actual"].to_numpy(float), challenger_locked),
                "foundationProbability": foundation_locked_metrics,
                "candidateProbability": candidate_locked_metrics,
                "passes": replay_pass,
            },
        }
        chosen[market] = {
            "foundationDistributionName": foundation_name,
            "foundationDistribution": foundation_final,
            "challengerDistributionName": selected_distribution_name,
            "challengerDistribution": challenger_final,
            "challengerWeight": chosen_weight if replay_pass else 0.0,
            "probabilityCalibration": final_calibration if replay_pass else None,
            "selection": selected_name,
            "passes": replay_pass,
            "incumbentRetained": not replay_pass,
        }

    locked_all = pd.concat(locked_outputs, ignore_index=True)
    candidate_probability = probability_metrics(
        locked_all["outcome"].to_numpy(float), locked_all["candidate_side_probability"].to_numpy(float),
    )
    foundation_probability = probability_metrics(
        locked_all["outcome"].to_numpy(float), locked_all["foundation_side_probability"].to_numpy(float),
    )
    args.rows_output.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(historical_rows, ignore_index=True).to_parquet(args.rows_output, index=False)
    output = {
        "release": "nfl_player_props_independent_distribution_release_tournament_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "chronology": {
            "pointSelection": 2024,
            "pointConfirmation": 2025,
            "distributionFit": 2024,
            "probabilityCalibrationFit": "2025 Weeks 1-9",
            "probabilitySelection": "2025 Weeks 10-18",
            "openedReplay": "2026 Weeks 1-4",
        },
        "sourceChecksums": {
            "projections": sha256(args.projections),
            "foundationProjections": sha256(args.foundation_projections),
            "replay": sha256(args.replay),
            "openings": sha256(args.openings),
        },
        "openingCoverage": opening_report,
        "markets": market_report,
        "selectedArtifacts": chosen,
        "affectedReplay": {
            "rows": int(len(locked_all)),
            "foundationProbability": foundation_probability,
            "candidateProbability": candidate_probability,
            "passes": bool(all(values["passes"] for values in chosen.values())),
        },
        "rowsFile": str(args.rows_output.resolve()),
        "rowsSha256": sha256(args.rows_output),
    }
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "openingCoverage": opening_report,
        "markets": market_report,
        "affectedReplay": output["affectedReplay"],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
