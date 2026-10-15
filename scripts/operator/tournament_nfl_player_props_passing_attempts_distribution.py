#!/usr/bin/env python3
"""Research-only Passing Attempts residual-distribution tournament."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
import time
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy.stats import norm, t


ROOT = pathlib.Path(__file__).resolve().parents[2]
DECOMPOSITION = ROOT / "scripts/operator/tournament_nfl_player_props_passing_attempts_decomposition.py"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_distribution_r1.json"
SEED = 20261015
EPSILON = 1e-6


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def empirical_cdf(residuals: np.ndarray, value: np.ndarray, bandwidth: float) -> np.ndarray:
    residuals = np.asarray(residuals, dtype=float)
    value = np.asarray(value, dtype=float)
    if bandwidth <= 0:
        return np.mean(residuals[None, :] <= value[:, None], axis=1)
    return np.mean(norm.cdf((value[:, None] - residuals[None, :]) / bandwidth), axis=1)


def conditional_cdf(
    train: pd.DataFrame,
    projection: np.ndarray,
    value: np.ndarray,
    bins: int,
    weight: float,
    bandwidth: float = 1.0,
) -> np.ndarray:
    global_cdf = empirical_cdf(train["residual"].to_numpy(float), value, bandwidth)
    boundaries = np.unique(np.quantile(train["projection"], np.linspace(0, 1, bins + 1)))
    if len(boundaries) < 3:
        return global_cdf
    target_bin = np.clip(np.searchsorted(boundaries[1:-1], projection, side="right"), 0, len(boundaries) - 2)
    train_bin = np.clip(np.searchsorted(boundaries[1:-1], train["projection"], side="right"), 0, len(boundaries) - 2)
    result = global_cdf.copy()
    for index in np.unique(target_bin):
        mask = target_bin == index
        residuals = train.loc[train_bin == index, "residual"].to_numpy(float)
        if len(residuals) < 30:
            continue
        conditioned = empirical_cdf(residuals, value[mask], bandwidth)
        result[mask] = (1.0 - weight) * global_cdf[mask] + weight * conditioned
    return result


def candidate_cdf(name: str, train: pd.DataFrame, projection: np.ndarray, value: np.ndarray) -> np.ndarray:
    if name.startswith("kde_"):
        bandwidth = float(name.split("_", 1)[1])
        return empirical_cdf(train["residual"].to_numpy(float), value, bandwidth)
    if name.startswith("tertile_") or name.startswith("quintile_"):
        parts = name.split("_")
        bins = 3 if parts[0] == "tertile" else 5
        return conditional_cdf(train, projection, value, bins, float(parts[1]) / 100.0)
    if name.startswith("student_t_"):
        degrees = int(name.rsplit("_", 1)[1])
        residuals = train["residual"].to_numpy(float)
        scale = max(float(np.std(residuals, ddof=1)) * math.sqrt((degrees - 2) / degrees), 0.5)
        return t.cdf(value / scale, df=degrees)
    if name == "empirical_global":
        return empirical_cdf(train["residual"].to_numpy(float), value, 0.0)
    raise ValueError(f"unknown candidate: {name}")


def score_rows(train: pd.DataFrame, test: pd.DataFrame, name: str) -> dict[str, float | int]:
    projection = test["projection"].to_numpy(float)
    actual = test["actual"].to_numpy(float)
    grid = np.arange(0.0, 71.0)
    crps = np.empty(len(test), dtype=float)
    log_score = np.empty(len(test), dtype=float)
    for index in range(len(test)):
        cdf = candidate_cdf(name, train, np.full(len(grid), projection[index]), grid - projection[index])
        observed = (grid >= actual[index]).astype(float)
        crps[index] = np.sum((cdf - observed) ** 2)
        upper = candidate_cdf(name, train, np.array([projection[index]]), np.array([actual[index] + 0.5 - projection[index]]))[0]
        lower = candidate_cdf(name, train, np.array([projection[index]]), np.array([actual[index] - 0.5 - projection[index]]))[0]
        log_score[index] = -math.log(max(float(upper - lower), EPSILON))
    return {
        "rows": int(len(test)),
        "crps": float(np.mean(crps)),
        "logScore": float(np.mean(log_score)),
    }


def crossfit_score(frame: pd.DataFrame, name: str, folds: int = 5) -> dict[str, float | int]:
    game_ids = sorted(frame["game_id"].astype(str).unique())
    fold_by_game = {game_id: index % folds for index, game_id in enumerate(game_ids)}
    scores: list[tuple[int, float, float]] = []
    for fold in range(folds):
        test = frame[frame["game_id"].astype(str).map(fold_by_game).eq(fold)]
        train = frame[~frame.index.isin(test.index)]
        result = score_rows(train, test, name)
        scores.append((int(result["rows"]), float(result["crps"]), float(result["logScore"])))
    rows = sum(item[0] for item in scores)
    return {
        "rows": rows,
        "crps": sum(item[0] * item[1] for item in scores) / rows,
        "logScore": sum(item[0] * item[2] for item in scores) / rows,
        "gameFolds": folds,
    }


def binary_scores(outcome: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    probability = np.clip(np.asarray(probability, dtype=float), EPSILON, 1.0 - EPSILON)
    outcome = np.asarray(outcome, dtype=float)
    return {
        "rows": int(len(outcome)),
        "brier": float(np.mean((probability - outcome) ** 2)),
        "logLoss": float(-np.mean(outcome * np.log(probability) + (1.0 - outcome) * np.log(1.0 - probability))),
        "calibrationBias": float(np.mean(probability - outcome)),
        "direction": float(np.mean((probability >= 0.5) == (outcome >= 0.5))),
        "meanProbability": float(np.mean(probability)),
        "outcomeRate": float(np.mean(outcome)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    args = parser.parse_args()
    decomp = load("pa_distribution_decomposition", DECOMPOSITION)
    projections = pd.read_parquet(decomp.FOUNDATION_PROJECTIONS)
    projections = projections[projections["market"].eq("passing_attempts")].copy()
    selection = projections[projections["phase"].eq("selection")].copy()
    confirmation = projections[projections["phase"].eq("confirmation")].copy()
    for frame in (selection, confirmation):
        frame["projection"] = frame["candidate_projection"].to_numpy(float)
        frame["residual"] = frame["actual"] - frame["projection"]

    candidates = [
        "kde_0.5", "kde_1", "kde_2", "kde_3",
        *[f"tertile_{weight}" for weight in (25, 50, 75)],
        *[f"quintile_{weight}" for weight in (25, 50, 75)],
        "student_t_3", "student_t_5", "student_t_8",
    ]
    selection_reference = crossfit_score(selection, "empirical_global")
    selection_candidates = {name: crossfit_score(selection, name) for name in candidates}
    eligible = [
        name for name, result in selection_candidates.items()
        if float(result["crps"]) < float(selection_reference["crps"])
        and float(result["logScore"]) < float(selection_reference["logScore"])
    ]
    selected = min(eligible, key=lambda name: (
        float(selection_candidates[name]["crps"]) / float(selection_reference["crps"])
        + float(selection_candidates[name]["logScore"]) / float(selection_reference["logScore"])
    )) if eligible else None
    confirmation_reference = score_rows(selection, confirmation, "empirical_global")
    confirmation_candidate = score_rows(selection, confirmation, selected) if selected else None
    confirmed = bool(
        selected and confirmation_candidate
        and float(confirmation_candidate["crps"]) < float(confirmation_reference["crps"])
        and float(confirmation_candidate["logScore"]) < float(confirmation_reference["logScore"])
    )
    frozen = selected if confirmed else None

    replay = pd.DataFrame(json.loads(decomp.LOCKED_REPLAY.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("passing_attempts")].copy()
    replay["outcome"] = (replay["actual"] > replay["line"]).astype(float)
    exact_incumbent = replay["raw"].notna()
    incumbent = binary_scores(
        replay.loc[exact_incumbent, "outcome"].to_numpy(float),
        replay.loc[exact_incumbent, "raw"].to_numpy(float),
    )
    candidate_probability: np.ndarray | None = None
    candidate_report: dict[str, float | int] | None = None
    if frozen:
        training = pd.concat([selection, confirmation], ignore_index=True)
        projection = replay["independentProjection"].to_numpy(float)
        threshold = replay["line"].to_numpy(float) - projection
        candidate_probability = 1.0 - candidate_cdf(frozen, training, projection, threshold)
        candidate_report = binary_scores(
            replay.loc[exact_incumbent, "outcome"].to_numpy(float),
            candidate_probability[exact_incumbent.to_numpy()],
        )
        candidate_all_rows = binary_scores(replay["outcome"].to_numpy(float), candidate_probability)
    else:
        candidate_all_rows = None
    current_gate = bool(
        frozen and candidate_report and int(exact_incumbent.sum()) == len(replay)
        and float(candidate_report["brier"]) < float(incumbent["brier"])
        and float(candidate_report["logLoss"]) < float(incumbent["logLoss"])
        and float(candidate_report["direction"]) >= float(incumbent["direction"])
    )
    output = {
        "release": "nfl_player_props_passing_attempts_distribution_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "pointProjectionChanged": False,
        "selection": {
            "reference": selection_reference,
            "candidates": selection_candidates,
            "selected": selected,
        },
        "confirmation": {
            "reference": confirmation_reference,
            "candidate": confirmation_candidate,
            "confirmed": confirmed,
        },
        "frozenCandidate": frozen,
        "currentSeasonLockedReplay": {
            "rows": int(len(replay)),
            "storedIndependentProbabilityRows": int(exact_incumbent.sum()),
            "missingIndependentProbabilityRows": int((~exact_incumbent).sum()),
            "missingProvenance": replay.loc[~exact_incumbent, "rawProvenance"].value_counts().to_dict(),
            "incumbent": incumbent,
            "candidate": candidate_report,
            "candidateAllRowsDiagnostic": candidate_all_rows,
            "candidateProbabilities": candidate_probability.tolist() if candidate_probability is not None else None,
        },
        "gateBlockedByIncompleteLockedBaseline": int(exact_incumbent.sum()) != len(replay),
        "currentProbabilityGatePassed": current_gate,
        "productionAuthorized": False,
        "sourceChecksums": {
            "foundationProjections": decomp.sha256_file(decomp.FOUNDATION_PROJECTIONS),
            "lockedReplay": decomp.sha256_file(decomp.LOCKED_REPLAY),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
