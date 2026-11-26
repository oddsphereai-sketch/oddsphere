#!/usr/bin/env python3
"""Repaired robustness audit for the predeclared NBA Four Factors r2 test."""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pandas as pd

import audit_nba_four_factors_matchup_r2 as r2


RELEASE = "nba_four_factors_matchup_add_one_2026_10_29_r2_robustness"


def paired_week_block_interval(
    candidate: np.ndarray,
    baseline: np.ndarray,
    blocks: np.ndarray,
    seed: int,
) -> dict[str, float | int]:
    differences = candidate - baseline
    unique_blocks = np.unique(blocks)
    blocks_by_season: dict[str, list[np.ndarray]] = {}
    for block in unique_blocks:
        season = str(block).split("-", 1)[0]
        blocks_by_season.setdefault(season, []).append(np.flatnonzero(blocks == block))
    rng = np.random.default_rng(seed)
    draws = np.empty(r2.BOOTSTRAP_SAMPLES)
    for draw in range(r2.BOOTSTRAP_SAMPLES):
        sampled: list[np.ndarray] = []
        for season_blocks in blocks_by_season.values():
            chosen = rng.integers(0, len(season_blocks), len(season_blocks))
            sampled.extend(season_blocks[index] for index in chosen)
        indexes = np.concatenate(sampled)
        draws[draw] = float(np.mean(differences[indexes]))
    return {
        "delta": float(np.mean(differences)),
        "lower95": float(np.quantile(draws, 0.025)),
        "upper95": float(np.quantile(draws, 0.975)),
        "samples": r2.BOOTSTRAP_SAMPLES,
        "blocks": len(unique_blocks),
        "resamplingUnit": "season_stratified_calendar_week",
    }


def maturity_diagnostics(
    frame: pd.DataFrame,
    base_margin: np.ndarray,
    base_total: np.ndarray,
    candidate_margin: np.ndarray,
    candidate_total: np.ndarray,
) -> dict[str, Any]:
    minimum_games = np.minimum(
        pd.to_numeric(frame["home_current_games"], errors="coerce").fillna(0).to_numpy(float),
        pd.to_numeric(frame["away_current_games"], errors="coerce").fillna(0).to_numpy(float),
    )
    actual_margin = frame["target_home_margin"].to_numpy(float)
    base_errors = r2.per_game_errors(frame, base_margin, base_total)
    candidate_errors = r2.per_game_errors(frame, candidate_margin, candidate_total)
    output: dict[str, Any] = {}
    for name, lower, upper in (("0_4", 0, 5), ("5_14", 5, 15), ("15_plus", 15, math.inf)):
        selected = (minimum_games >= lower) & (minimum_games < upper)
        output[name] = {
            "games": int(selected.sum()),
            "teamScoreMaeDelta": float(np.mean(candidate_errors["teamScoreMae"][selected] - base_errors["teamScoreMae"][selected])),
            "marginMaeDelta": float(np.mean(candidate_errors["marginMae"][selected] - base_errors["marginMae"][selected])),
            "totalMaeDelta": float(np.mean(candidate_errors["totalMae"][selected] - base_errors["totalMae"][selected])),
            "winnerAccuracyDelta": float(
                np.mean((candidate_margin[selected] > 0) == (actual_margin[selected] > 0))
                - np.mean((base_margin[selected] > 0) == (actual_margin[selected] > 0))
            ),
        }
    return output


def main() -> None:
    options = r2.arguments()
    frame = r2.load_jsonl(options.features)
    artifact = json.loads(options.artifact.read_text())
    if artifact.get("release") != r2.ARTIFACT_RELEASE:
        raise ValueError(f"unexpected incumbent artifact: {artifact.get('release')}")
    for target in ("target_home_score", "target_away_score", "target_home_margin", "target_total"):
        frame[target] = pd.to_numeric(frame[target], errors="raise")
    seasons = sorted(int(value) for value in frame["season"].unique())
    if seasons != [2021, 2022, 2023, 2024, 2025]:
        raise ValueError(f"unexpected NBA seasons: {seasons}")

    base_features = list(artifact["design"]["features"])
    base_missing = list(artifact["design"]["missingIndicatorColumns"])
    derived = r2.add_blended_four_factor_features(frame)
    candidate_features = [*base_features, *derived]
    candidate_missing = base_missing
    selection_rows = frame[frame["season"].isin(r2.SELECTION_SEASONS)]
    coverage = {name: float(selection_rows[name].notna().mean()) for name in derived}

    baseline_folds = r2.evaluate(
        frame, r2.SELECTION_SEASONS, base_features, base_missing, r2.BASE_ALPHA,
    )
    baseline_by_season = {fold["season"]: fold for fold in baseline_folds}
    candidate_folds = r2.evaluate(
        frame, r2.SELECTION_SEASONS, candidate_features, candidate_missing,
        r2.BASE_ALPHA, baseline_by_season,
    )
    pooled_frame = pd.concat([fold["frame"] for fold in baseline_folds], ignore_index=True)
    base_margin = r2.concatenate_folds(baseline_folds, "margin")
    base_total = r2.concatenate_folds(baseline_folds, "total")
    base_sigma = r2.concatenate_folds(baseline_folds, "sigma")
    candidate_margin = r2.concatenate_folds(candidate_folds, "margin")
    candidate_total = r2.concatenate_folds(candidate_folds, "total")
    candidate_sigma = r2.concatenate_folds(candidate_folds, "sigma")
    baseline_metrics = r2.metrics(pooled_frame, base_margin, base_total, base_sigma, base_margin)
    candidate_metrics = r2.metrics(
        pooled_frame, candidate_margin, candidate_total, candidate_sigma, base_margin,
    )
    delta = r2.metric_delta(candidate_metrics, baseline_metrics)
    base_errors = r2.per_game_errors(pooled_frame, base_margin, base_total)
    candidate_errors = r2.per_game_errors(pooled_frame, candidate_margin, candidate_total)
    timestamps = pd.to_datetime(pooled_frame["feature_cutoff"], utc=True, errors="raise")
    iso = timestamps.dt.isocalendar()
    blocks = np.array([
        f"{season}-{year}-W{week:02d}"
        for season, year, week in zip(pooled_frame["season"], iso.year, iso.week)
    ])
    intervals = {
        name: paired_week_block_interval(
            candidate_errors[name], base_errors[name], blocks,
            r2.BOOTSTRAP_SEED + offset,
        )
        for offset, name in enumerate(("teamScoreMae", "marginMae", "totalMae"))
    }
    season_deltas = {
        str(candidate["season"]): r2.metric_delta(
            candidate["metrics"], baseline_by_season[candidate["season"]]["metrics"],
        )
        for candidate in candidate_folds
    }

    cohort_gates: dict[str, Any] = {}
    cohorts_pass = True
    for name, base_band in baseline_metrics["incumbentMarginBands"].items():
        candidate_band = candidate_metrics["incumbentMarginBands"][name]
        gated = base_band["games"] >= 150
        margin_change = candidate_band["marginMae"] - base_band["marginMae"]
        direction_change = candidate_band["winnerAccuracy"] - base_band["winnerAccuracy"]
        passed = (not gated) or (margin_change <= 0.5 and direction_change >= -0.02)
        cohorts_pass = cohorts_pass and passed
        cohort_gates[name] = {
            "games": base_band["games"],
            "gated": gated,
            "marginMaeDelta": margin_change,
            "winnerAccuracyDelta": direction_change,
            "passed": passed,
        }

    coverage_gates: dict[str, Any] = {}
    coverage_pass = True
    for level in ("0.8", "0.9", "0.95"):
        nominal = float(level)
        base_error = abs(baseline_metrics["marginIntervalCoverage"][level] - nominal)
        candidate_error = abs(candidate_metrics["marginIntervalCoverage"][level] - nominal)
        passed = candidate_error - base_error <= 0.02
        coverage_pass = coverage_pass and passed
        coverage_gates[level] = {
            "baselineAbsoluteError": base_error,
            "candidateAbsoluteError": candidate_error,
            "degradation": candidate_error - base_error,
            "passed": passed,
        }

    gates = {
        "teamScoreMae": delta["teamScoreMae"] <= -0.10 and intervals["teamScoreMae"]["upper95"] < 0,
        "marginMae": delta["marginMae"] <= 0 and intervals["marginMae"]["upper95"] < 0.10,
        "totalMae": delta["totalMae"] <= 0 and intervals["totalMae"]["upper95"] < 0.10,
        "winnerBrier": delta["winnerBrier"] <= 0,
        "winnerLogLoss": delta["winnerLogLoss"] <= 0,
        "winnerAccuracy": delta["winnerAccuracy"] >= -0.005,
        "compressionSlope": abs(candidate_metrics["actualOnPredictedMarginSlope"] - 1) < abs(baseline_metrics["actualOnPredictedMarginSlope"] - 1),
        "tail20Brier": delta["tail20Brier"] <= 0,
        "intervalCoverage": coverage_pass,
        "cohorts": cohorts_pass,
        "eachSelectionSeason": all(
            change["teamScoreMae"] < 0 and change["marginMae"] < 0.10 and change["totalMae"] < 0.10
            for change in season_deltas.values()
        ),
    }
    selected = all(gates.values())

    replication: dict[str, Any] | None = None
    if selected:
        baseline_replication = r2.evaluate(
            frame, (r2.REPLICATION_SEASON,), base_features, base_missing, r2.BASE_ALPHA,
        )[0]
        candidate_replication = r2.evaluate(
            frame, (r2.REPLICATION_SEASON,), candidate_features, candidate_missing,
            r2.BASE_ALPHA, {r2.REPLICATION_SEASON: baseline_replication},
        )[0]
        replication = {
            "season": r2.REPLICATION_SEASON,
            "pristineHoldout": False,
            "baseline": r2.serializable_fold(baseline_replication),
            "candidate": r2.serializable_fold(candidate_replication),
            "delta": r2.metric_delta(candidate_replication["metrics"], baseline_replication["metrics"]),
        }

    report = {
        "release": RELEASE,
        "mode": "offline_research_only",
        "productionAuthority": False,
        "providerCalls": 0,
        "databaseReads": 0,
        "databaseWrites": 0,
        "featureRelease": r2.FEATURE_RELEASE,
        "featureLedgerSha256": r2.LEDGER_SHA256,
        "artifactReleaseReference": r2.ARTIFACT_RELEASE,
        "selectionSeasons": list(r2.SELECTION_SEASONS),
        "replicationSeason": r2.REPLICATION_SEASON,
        "replicationScored": selected,
        "candidate": "four_factors_blended_matchup__alpha_1000_exact_eight",
        "derivedFeatures": derived,
        "derivedFeatureCoverage": coverage,
        "derivedFeatureMissingIndicators": [],
        "baseline": {
            "folds": [r2.serializable_fold(fold) for fold in baseline_folds],
            "pooledMetrics": baseline_metrics,
        },
        "candidateResult": {
            "folds": [r2.serializable_fold(fold) for fold in candidate_folds],
            "pooledMetrics": candidate_metrics,
            "pooledDelta": delta,
            "pairedWeekBlockBootstrap": intervals,
            "seasonDeltas": season_deltas,
            "maturityDiagnostics": maturity_diagnostics(
                pooled_frame, base_margin, base_total, candidate_margin, candidate_total,
            ),
            "cohortGates": cohort_gates,
            "coverageGates": coverage_gates,
            "gates": gates,
            "passed": selected,
        },
        "selected": "four_factors_blended_matchup__alpha_1000_exact_eight" if selected else None,
        "replication": replication,
        "interpretationBoundary": (
            "This robustness audit is opened development evidence only and cannot change a live "
            "model, score, prediction, grade, stake, lock, reader, board, or persisted shadow row."
        ),
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "report": str(options.output),
        "selected": report["selected"],
        "replicationScored": selected,
        "gateFailures": [name for name, passed in gates.items() if not passed],
        "pooledDelta": delta,
        "pairedWeekBlockBootstrap": intervals,
    }, indent=2))


if __name__ == "__main__":
    main()
