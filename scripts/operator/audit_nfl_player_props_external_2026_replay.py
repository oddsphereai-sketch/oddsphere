#!/usr/bin/env python3
"""Exact locked-ledger replay for frozen external NFL props candidates."""

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
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy import stats


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_TOURNAMENT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_external_tournament_r1.json"
DEFAULT_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_external_2026_replay_r1.json"
PASSING = ("passing_attempts", "passing_completions", "passing_yards")
COUNT = {"passing_attempts", "passing_completions"}
SEED = 20261008


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


def point_metrics(actual: np.ndarray, prediction: np.ndarray, line: np.ndarray | None = None) -> dict[str, float | int]:
    error = prediction - actual
    result: dict[str, float | int] = {
        "rows": int(len(actual)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
    }
    if line is not None:
        result["directionAccuracy"] = float(np.mean(np.sign(prediction - line) == np.sign(actual - line)))
    return result


def probability_metrics(outcome: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    probability = np.clip(probability, 1e-6, 1 - 1e-6)
    return {
        "rows": int(len(outcome)),
        "wins": int(outcome.sum()),
        "observedRate": float(outcome.mean()),
        "meanProbability": float(probability.mean()),
        "calibrationGap": float(abs(probability.mean() - outcome.mean())),
        "brier": float(np.mean((probability - outcome) ** 2)),
        "logLoss": float(np.mean(-(outcome * np.log(probability) + (1 - outcome) * np.log(1 - probability)))),
    }


def distribution_candidates(
    market: str,
    actual: np.ndarray,
    prediction: np.ndarray,
    baseline: Any,
    recalibration: Any,
    calibration_contract: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    residuals = actual - prediction
    grid = int(calibration_contract["empiricalQuantileGridSize"])
    minimum = int(calibration_contract["minimumBucketRows"])
    output = {
        "empirical_global": recalibration.empirical_distribution(residuals, grid),
        "empirical_mean_bucket": recalibration.bucketed_empirical_distribution(residuals, prediction, grid, minimum),
    }
    if market in COUNT:
        alpha = baseline.estimate_count_alpha(actual, prediction)
        output["poisson"] = {"family": "poisson", "alpha": alpha}
        output["negative_binomial"] = {"family": "negative_binomial", "alpha": alpha}
    else:
        output["normal_residual"] = {"family": "normal_residual", "scale": float(np.sqrt(np.mean(residuals ** 2)))}
    return output


def refit_distribution(
    selected: str,
    market: str,
    actual: np.ndarray,
    prediction: np.ndarray,
    baseline: Any,
    recalibration: Any,
    calibration_contract: dict[str, Any],
) -> dict[str, Any]:
    return distribution_candidates(
        market, actual, prediction, baseline, recalibration, calibration_contract,
    )[selected]


def over_probability(mean: float, line: float, distribution: dict[str, Any], recalibration: Any) -> float:
    family = distribution["family"]
    if family in {"empirical_residual", "empirical_residual_mean_bucket"}:
        residuals = recalibration.empirical_values(distribution, np.asarray([mean]))[0]
        outcomes = np.clip(mean + residuals, 0.0, None)
        return float(np.mean(outcomes > line))
    if family == "poisson":
        return float(stats.poisson.sf(math.floor(line), max(mean, 1e-6)))
    if family == "negative_binomial":
        alpha = max(float(distribution["alpha"]), 1e-9)
        size = 1.0 / alpha
        probability = size / (size + max(mean, 1e-6))
        return float(stats.nbinom.sf(math.floor(line), size, probability))
    scale = max(float(distribution["scale"]), 1e-6)
    return float(stats.norm.sf(line, loc=mean, scale=scale))


def cluster_interval(frame: pd.DataFrame, statistic: Callable[[pd.DataFrame], float], resamples: int = 4000) -> dict[str, float]:
    games = frame["gameId"].drop_duplicates().tolist()
    random = np.random.default_rng(SEED)
    values = np.empty(resamples)
    by_game = {game: frame[frame["gameId"].eq(game)] for game in games}
    for index in range(resamples):
        sample = pd.concat([by_game[game] for game in random.choice(games, size=len(games), replace=True)], ignore_index=True)
        values[index] = statistic(sample)
    lower, median, upper = np.quantile(values, [0.025, 0.5, 0.975])
    return {"lower": float(lower), "median": float(median), "upper": float(upper)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tournament", type=pathlib.Path, default=DEFAULT_TOURNAMENT)
    parser.add_argument("--replay", type=pathlib.Path, default=DEFAULT_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("props_external_replay_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    recalibration = load_module("props_external_replay_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    tournament = json.loads(args.tournament.read_text(encoding="utf-8"))
    projection_path = pathlib.Path(tournament["projectionFile"])
    if sha256_file(projection_path) != tournament["projectionFileSha256"]:
        raise RuntimeError("tournament projection checksum mismatch")
    projections = pd.read_parquet(projection_path)
    replay_payload = json.loads(args.replay.read_text(encoding="utf-8"))
    replay = pd.DataFrame(replay_payload["rows"])
    replay["normalized_player"] = replay["playerName"].map(normalize)
    projections["normalized_player"] = projections["player_name"].map(normalize)

    distribution_report: dict[str, Any] = {}
    distributions: dict[str, dict[str, Any]] = {}
    for market in PASSING:
        selected = projections[projections["market"].eq(market) & projections["phase"].eq("selection")]
        confirmation = projections[projections["market"].eq(market) & projections["phase"].eq("confirmation")]
        candidates = distribution_candidates(
            market,
            selected["actual"].to_numpy(float),
            selected["candidate_projection"].to_numpy(float),
            baseline,
            recalibration,
            calibration_contract,
        )
        metrics = {
            name: recalibration.distribution_metrics(
                baseline,
                confirmation["actual"].to_numpy(float),
                confirmation["candidate_projection"].to_numpy(float),
                distribution,
            )
            for name, distribution in candidates.items()
        }
        selected_name = min(
            metrics,
            key=lambda name: (*recalibration.selection_key(metrics[name], calibration_contract), metrics[name]["nll"]),
        )
        combined = pd.concat([selected, confirmation], ignore_index=True)
        distributions[market] = refit_distribution(
            selected_name,
            market,
            combined["actual"].to_numpy(float),
            combined["candidate_projection"].to_numpy(float),
            baseline,
            recalibration,
            calibration_contract,
        )
        distribution_report[market] = {
            "selectedOn2025": selected_name,
            "confirmationCandidates": metrics,
            "fitRows2024To2025": int(len(combined)),
            "finalFamily": distributions[market]["family"],
        }

    holdout = projections[projections["phase"].eq("holdout") & projections["market"].isin(PASSING)].copy()
    locked = replay[replay["market"].isin(PASSING)].copy()
    joined = locked.merge(
        holdout[["week", "market", "normalized_player", "candidate_projection", "candidate_name"]],
        on=["week", "market", "normalized_player"],
        how="left",
        validate="many_to_one",
    )
    matched = joined[joined["candidate_projection"].notna()].copy()
    if matched.duplicated(["gameId", "normalized_player", "market", "line", "side"]).any():
        raise RuntimeError("locked replay join duplicated a canonical scope")
    candidate_over = np.asarray([
        over_probability(float(row.candidate_projection), float(row.line), distributions[str(row.market)], recalibration)
        for row in matched.itertuples()
    ])
    matched["candidate_side_probability"] = np.where(matched["side"].eq("over"), candidate_over, 1.0 - candidate_over)
    matched["candidate_side_probability"] = matched["candidate_side_probability"].clip(0.01, 0.99)
    matched["candidate_pick_side"] = np.where(matched["candidate_projection"] > matched["line"], "over", "under")
    matched["candidate_pick_outcome"] = np.where(matched["candidate_pick_side"].eq(matched["side"]), matched["outcome"], 1 - matched["outcome"])

    actual = matched["actual"].to_numpy(float)
    line = matched["line"].to_numpy(float)
    candidate = matched["candidate_projection"].to_numpy(float)
    independent = matched["independentProjection"].to_numpy(float)
    published = matched["publishedProjection"].to_numpy(float)
    outcome = matched["outcome"].to_numpy(float)
    raw_available = matched["raw"].notna().to_numpy()
    report = {
        "release": "nfl_player_props_external_2026_locked_replay_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "sourceChecksums": {"tournament": sha256_file(args.tournament), "replayRows": sha256_file(args.replay)},
        "scope": {
            "lockedPassingScopes": int(len(locked)),
            "matchedCandidateScopes": int(len(matched)),
            "unmatchedScopes": int(len(joined) - len(matched)),
            "unmatched": joined.loc[joined["candidate_projection"].isna(), ["week", "playerName", "market", "team"]].to_dict("records"),
            "games": int(matched["gameId"].nunique()),
        },
        "distribution": distribution_report,
        "point": {
            "candidate": point_metrics(actual, candidate, line),
            "lockedIndependent": point_metrics(actual, independent, line),
            "published": point_metrics(actual, published, line),
            "offeredLineDescriptiveBenchmark": point_metrics(actual, line),
        },
        "probabilityForLockedSide": {
            "candidate": probability_metrics(outcome, matched["candidate_side_probability"].to_numpy(float)),
            "lockedIndependentExactOnly": probability_metrics(
                outcome[raw_available], matched.loc[raw_available, "raw"].to_numpy(float),
            ),
            "market": probability_metrics(outcome, matched["marketProbability"].to_numpy(float)),
            "publishedFinal": probability_metrics(outcome, matched["final"].to_numpy(float)),
        },
        "candidateDirection": {
            "correct": int(matched["candidate_pick_outcome"].sum()),
            "rows": int(len(matched)),
            "accuracy": float(matched["candidate_pick_outcome"].mean()),
            "incumbentActionableDirectionRetained": int(matched["candidate_pick_side"].eq(matched["side"]).sum()),
            "retentionRate": float(matched["candidate_pick_side"].eq(matched["side"]).mean()),
            "oppositePriceEvidenceAvailable": False,
        },
        "byMarket": {},
        "byWeek": {},
        "gameClusterBootstrap95": {
            "candidateMinusLockedIndependentMae": cluster_interval(
                matched,
                lambda rows: float(np.mean(np.abs(rows["candidate_projection"] - rows["actual"])) - np.mean(np.abs(rows["independentProjection"] - rows["actual"]))),
            ),
            "candidateMinusPublishedMae": cluster_interval(
                matched,
                lambda rows: float(np.mean(np.abs(rows["candidate_projection"] - rows["actual"])) - np.mean(np.abs(rows["publishedProjection"] - rows["actual"]))),
            ),
            "candidateMinusMarketBrier": cluster_interval(
                matched,
                lambda rows: float(np.mean((rows["candidate_side_probability"] - rows["outcome"]) ** 2) - np.mean((rows["marketProbability"] - rows["outcome"]) ** 2)),
            ),
        },
        "promotionAuthorized": False,
        "reason": "Four completed weeks and 35 matched passing scopes are diagnostic; full-board retention and opposite-side price evidence are unavailable.",
    }
    for grouping, destination in (("market", "byMarket"), ("week", "byWeek")):
        for value, rows in matched.groupby(grouping, observed=True):
            y = rows["actual"].to_numpy(float)
            lines = rows["line"].to_numpy(float)
            report[destination][str(value)] = {
                "candidate": point_metrics(y, rows["candidate_projection"].to_numpy(float), lines),
                "lockedIndependent": point_metrics(y, rows["independentProjection"].to_numpy(float), lines),
                "published": point_metrics(y, rows["publishedProjection"].to_numpy(float), lines),
                "candidateProbability": probability_metrics(rows["outcome"].to_numpy(float), rows["candidate_side_probability"].to_numpy(float)),
            }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
