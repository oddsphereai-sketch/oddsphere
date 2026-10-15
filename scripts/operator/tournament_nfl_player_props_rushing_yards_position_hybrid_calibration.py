#!/usr/bin/env python3
"""Chronological probability calibration for the Rushing Yards position hybrid."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import re
import time
import unicodedata
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, log_loss


ROOT = pathlib.Path(__file__).resolve().parents[2]
HYBRID_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_position_hybrid_rows_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_through_week_5_r2.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_position_hybrid_calibration_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_position_hybrid_calibration_rows_r1.parquet"
NON_QB = ("RB", "FB", "WR")
QUANTILES = np.linspace(0.0, 1.0, 1001)
INTERVALS = (0.50, 0.80, 0.90)
SEED = 20261015


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_player(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


def residual_quantiles(actual: np.ndarray, prediction: np.ndarray) -> np.ndarray:
    residual = np.asarray(actual, dtype=float) - np.asarray(prediction, dtype=float)
    return np.quantile(residual, QUANTILES)


def empirical_second_term(values: np.ndarray) -> float:
    ordered = np.sort(np.asarray(values, dtype=float))
    n = len(ordered)
    coefficients = 2 * np.arange(1, n + 1) - n - 1
    pairwise_mean = 2.0 * float(np.dot(coefficients, ordered)) / (n * n)
    return 0.5 * pairwise_mean


def crps_rows(actual: np.ndarray, prediction: np.ndarray, residuals: np.ndarray) -> np.ndarray:
    error = np.asarray(actual, dtype=float) - np.asarray(prediction, dtype=float)
    return np.mean(np.abs(error[:, None] - residuals[None, :]), axis=1) - empirical_second_term(residuals)


def distribution_metrics(actual: np.ndarray, prediction: np.ndarray, residuals: np.ndarray) -> dict[str, Any]:
    actual = np.asarray(actual, dtype=float)
    prediction = np.asarray(prediction, dtype=float)
    error = actual - prediction
    scores = crps_rows(actual, prediction, residuals)
    pit = np.searchsorted(residuals, error, side="right") / len(residuals)
    frequencies, _ = np.histogram(pit, bins=np.linspace(0, 1, 11))
    frequencies = frequencies / max(len(pit), 1)
    intervals: dict[str, Any] = {}
    coverage_errors: list[float] = []
    for level in INTERVALS:
        alpha = (1 - level) / 2
        lower = prediction + np.quantile(residuals, alpha)
        upper = prediction + np.quantile(residuals, 1 - alpha)
        coverage = float(np.mean((actual >= lower) & (actual <= upper)))
        coverage_errors.append(abs(coverage - level))
        intervals[str(int(level * 100))] = {
            "coverage": coverage,
            "coverageError": abs(coverage - level),
            "meanWidth": float(np.mean(upper - lower)),
        }
    return {
        "rows": int(len(actual)),
        "crps": float(scores.mean()),
        "pitCalibrationError": float(np.mean(np.abs(frequencies - 0.1))),
        "meanIntervalCoverageError": float(np.mean(coverage_errors)),
        "intervals": intervals,
    }


def bootstrap(rows: pd.DataFrame, reference_scores: np.ndarray, candidate_scores: np.ndarray) -> dict[str, Any]:
    values = rows[["game_id"]].copy()
    values["delta"] = np.asarray(candidate_scores) - np.asarray(reference_scores)
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    rng = np.random.default_rng(SEED)
    samples: list[float] = []
    for _ in range(20):
        indexes = rng.integers(0, len(grouped), size=(500, len(grouped)))
        selected = grouped[indexes]
        samples.extend((selected[:, :, 0].sum(axis=1) / selected[:, :, 1].sum(axis=1)).tolist())
    interval = [float(np.quantile(samples, 0.025)), float(np.quantile(samples, 0.975))]
    return {
        "games": int(len(grouped)),
        "crpsDelta": float(np.mean(candidate_scores - reference_scores)),
        "gameClusterBootstrap95": interval,
        "passes": bool(interval[1] < 0),
    }


def probability_over(projection: np.ndarray, line: np.ndarray, residuals: np.ndarray) -> np.ndarray:
    target = np.asarray(line, dtype=float) - np.asarray(projection, dtype=float)
    indexes = np.searchsorted(residuals, target, side="right")
    return np.clip(1.0 - indexes / len(residuals), 1e-5, 1 - 1e-5)


def probability_metrics(actual: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    actual = np.asarray(actual, dtype=int)
    probability = np.clip(np.asarray(probability, dtype=float), 1e-5, 1 - 1e-5)
    return {
        "rows": int(len(actual)),
        "wins": int(actual.sum()),
        "brier": float(brier_score_loss(actual, probability)),
        "logLoss": float(log_loss(actual, probability)),
        "calibrationGap": float(abs(probability.mean() - actual.mean())),
        "meanProbability": float(probability.mean()),
        "winRate": float(actual.mean()),
    }


def unit_profit(price: float, won: bool) -> float:
    if not won:
        return -1.0
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hybrid-rows", type=pathlib.Path, default=HYBRID_ROWS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    rows = pd.read_parquet(args.hybrid_rows)
    historical = rows[rows["phase"].isin(["selection", "confirmation"])].copy()
    historical = historical[historical["position"].isin(NON_QB)].copy()
    train = historical[historical["season"].eq(2024)].copy()
    test = historical[historical["season"].eq(2025)].copy()
    reference_residuals = residual_quantiles(
        train["actual"].to_numpy(float), train["reference_projection"].to_numpy(float),
    )
    candidate_residuals = residual_quantiles(
        train["actual"].to_numpy(float), train["hybrid_projection"].to_numpy(float),
    )
    reference_scores = crps_rows(
        test["actual"].to_numpy(float), test["reference_projection"].to_numpy(float), reference_residuals,
    )
    candidate_scores = crps_rows(
        test["actual"].to_numpy(float), test["hybrid_projection"].to_numpy(float), candidate_residuals,
    )
    reference_metrics = distribution_metrics(
        test["actual"].to_numpy(float), test["reference_projection"].to_numpy(float), reference_residuals,
    )
    candidate_metrics = distribution_metrics(
        test["actual"].to_numpy(float), test["hybrid_projection"].to_numpy(float), candidate_residuals,
    )
    position_metrics: dict[str, Any] = {}
    position_passes = True
    for position in sorted(test["position"].unique()):
        mask = test["position"].eq(position).to_numpy()
        reference_position = distribution_metrics(
            test.loc[mask, "actual"].to_numpy(float),
            test.loc[mask, "reference_projection"].to_numpy(float),
            reference_residuals,
        )
        candidate_position = distribution_metrics(
            test.loc[mask, "actual"].to_numpy(float),
            test.loc[mask, "hybrid_projection"].to_numpy(float),
            candidate_residuals,
        )
        position_metrics[position] = {
            "reference": reference_position,
            "candidate": candidate_position,
            "crpsDelta": candidate_position["crps"] - reference_position["crps"],
        }
        if position in {"RB", "WR"} and candidate_position["crps"] > reference_position["crps"] + 0.25:
            position_passes = False
    stability = bootstrap(test, reference_scores, candidate_scores)
    historical_passes = bool(
        candidate_metrics["crps"] < reference_metrics["crps"]
        and candidate_metrics["pitCalibrationError"] <= reference_metrics["pitCalibrationError"]
        and candidate_metrics["meanIntervalCoverageError"]
            <= reference_metrics["meanIntervalCoverageError"] + 0.01
        and stability["passes"]
        and position_passes
    )

    current_report: dict[str, Any] | None = None
    current_output = pd.DataFrame()
    if historical_passes:
        current_residuals = residual_quantiles(
            test["actual"].to_numpy(float), test["hybrid_projection"].to_numpy(float),
        )
        replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
        replay = replay[replay["market"].eq("rushing_yards")].copy()
        replay["normalized_player"] = replay["playerName"].map(normalize_player)
        current = rows[rows["phase"].eq("locked_replay") & rows["position"].isin(NON_QB)].copy()
        current["normalized_player"] = current["player_name"].map(normalize_player)
        current = current.merge(
            replay[[
                "week", "team", "normalized_player", "line", "side", "raw", "outcome",
                "lockedPrice", "grade", "marketProbability", "final", "actual",
            ]],
            on=["week", "team", "normalized_player", "line"],
            how="left",
            validate="one_to_one",
            suffixes=("", "_locked"),
        )
        if current["raw"].isna().any():
            raise RuntimeError("unmatched exact non-QB Rushing Yards probability rows")
        over = probability_over(
            current["hybrid_projection"].to_numpy(float), current["line"].to_numpy(float), current_residuals,
        )
        current["candidate_selected_probability"] = np.where(current["side"].eq("over"), over, 1 - over)
        actual = current["outcome"].to_numpy(int)
        reference_probability = current["raw"].to_numpy(float)
        candidate_probability = current["candidate_selected_probability"].to_numpy(float)
        reference_probability_metrics = probability_metrics(actual, reference_probability)
        candidate_probability_metrics = probability_metrics(actual, candidate_probability)
        candidate_same_side = candidate_probability >= 0.5
        candidate_won = np.where(candidate_same_side, actual == 1, actual == 0)
        side_changes = int((~candidate_same_side).sum())
        reference_units = float(sum(
            unit_profit(float(price), bool(won))
            for price, won in zip(current["lockedPrice"], actual == 1, strict=True)
        ))
        candidate_units = None if side_changes else float(sum(
            unit_profit(float(price), bool(won))
            for price, won in zip(current["lockedPrice"], candidate_won, strict=True)
        ))
        current_passes = bool(
            candidate_probability_metrics["brier"] <= reference_probability_metrics["brier"]
            and candidate_probability_metrics["logLoss"] <= reference_probability_metrics["logLoss"]
            and candidate_probability_metrics["calibrationGap"] <= reference_probability_metrics["calibrationGap"]
            and side_changes == 0
            and candidate_units is not None
            and candidate_units >= reference_units
        )
        current_report = {
            "rows": int(len(current)),
            "reference": reference_probability_metrics,
            "candidate": candidate_probability_metrics,
            "sideChanges": side_changes,
            "directionReference": float(actual.mean()),
            "directionCandidate": float(candidate_won.mean()),
            "referenceExactPriceUnits": reference_units,
            "candidateExactPriceUnits": candidate_units,
            "passes": current_passes,
            "residualQuantiles": current_residuals.tolist(),
        }
        current_output = current

    output_rows = test[[
        "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
        "player_name", "position", "actual", "reference_projection", "hybrid_projection",
    ]].copy()
    output_rows["reference_crps"] = reference_scores
    output_rows["candidate_crps"] = candidate_scores
    if not current_output.empty:
        output_rows = pd.concat([output_rows, current_output], ignore_index=True, sort=False)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    output_rows.to_parquet(args.rows, index=False)

    payload = {
        "release": "nfl_player_props_rushing_yards_position_hybrid_calibration_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "calibration": "1001 pooled non-QB empirical residual quantiles from immediately preceding season",
        "confirmation2025": {
            "reference": reference_metrics,
            "candidate": candidate_metrics,
            "positionMetrics": position_metrics,
            "stability": stability,
            "passes": historical_passes,
        },
        "currentSeason": current_report,
        "liveBoardImpact": {
            "productionWrites": 0,
            "promotions": 0,
            "demotions": 0,
            "sideChanges": 0,
            "lockedRowsMutated": 0,
        },
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "historicalPasses": historical_passes,
        "confirmation2025": payload["confirmation2025"],
        "currentSeason": current_report,
    }, indent=2))


if __name__ == "__main__":
    main()
