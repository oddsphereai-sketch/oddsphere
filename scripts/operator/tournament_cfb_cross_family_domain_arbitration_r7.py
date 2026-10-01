#!/usr/bin/env python3
"""Research-only CFB cross-family scoring-domain arbitration."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from cfb_professional_research_metrics import (
    aggregate_total_metrics,
    detailed_metrics,
    market_total_metrics,
    selected_predictions,
)
from tournament_cfb_symmetric_matchup_score_r4 import (
    CURRENT_SEASON,
    TEST_SEASONS,
    append_current_sources,
    build_dataset,
    read_sources,
    train_predictions,
)


RELEASE = "cfb_cross_family_domain_arbitration_tournament_2026_10_01_r7"
THRESHOLDS = (3.0, 5.0, 7.0)
STRENGTHS = (0.75, 1.0)


def weekly_arbitration(
    frame: Any,
    baseline_total: np.ndarray,
    predictions: dict[str, dict[str, np.ndarray]],
    threshold: float,
    strength: float,
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    robust_total = np.median(
        np.vstack([
            predictions["hist_gradient_boosting"]["directTotal"],
            predictions["extra_trees"]["directTotal"],
        ]),
        axis=0,
    )
    correction = np.zeros(len(frame), dtype=float)
    audit: list[dict[str, Any]] = []
    week_values = frame.week.to_numpy()
    for week in sorted(set(int(value) for value in week_values)):
        indexes = np.flatnonzero(week_values == week)
        disagreement = float(np.mean(robust_total[indexes] - baseline_total[indexes]))
        applied = disagreement * strength if abs(disagreement) >= threshold else 0.0
        correction[indexes] = applied
        audit.append({
            "week": week,
            "games": int(len(indexes)),
            "meanFamilyDisagreement": disagreement,
            "appliedCorrection": applied,
        })
    return baseline_total + correction, audit


def run(args: argparse.Namespace) -> dict[str, Any]:
    r4_report = json.loads(Path(args.r4_report).read_text())
    selected_r4 = str(r4_report["selected"])
    residual_artifact = json.loads(Path(args.residual_artifact).read_text())
    residual_sample = np.asarray(residual_artifact["residualSample"], dtype=float)
    frames, checksums = read_sources(Path(args.historical_source_dir))
    historical = build_dataset(
        frames,
        current_season_prior_games=4.0,
        include_opponent_adjusted_matchups=True,
    ).replace([np.inf, -np.inf], np.nan)

    seasons: dict[int, dict[str, Any]] = {}
    historical_actual_totals: list[np.ndarray] = []
    for season in TEST_SEASONS:
        frame, predictions, _ = train_predictions(
            historical, season, args.seed + season, args.rolling_calibration
        )
        margin, baseline_total = selected_predictions(predictions, selected_r4)
        historical_actual_totals.append(
            frame.home_score.to_numpy(float) + frame.away_score.to_numpy(float)
        )
        seasons[season] = {
            "frame": frame,
            "predictions": predictions,
            "margin": margin,
            "baselineTotal": baseline_total,
        }
    past_scoring_mean = float(np.mean(np.concatenate(historical_actual_totals)))

    current_frames = append_current_sources(frames, Path(args.current_source_dir))
    current_data = build_dataset(
        current_frames,
        current_season_prior_games=4.0,
        include_opponent_adjusted_matchups=True,
    ).replace([np.inf, -np.inf], np.nan)
    current_frame, current_heads, _ = train_predictions(
        current_data, CURRENT_SEASON, args.seed + CURRENT_SEASON, args.rolling_calibration
    )
    current_margin, current_baseline_total = selected_predictions(current_heads, selected_r4)

    baseline_by_season = {
        str(season): detailed_metrics(
            value["frame"], value["margin"], value["baselineTotal"], residual_sample
        )
        for season, value in seasons.items()
    }
    baseline_pooled = aggregate_total_metrics(list(baseline_by_season.values()))
    candidates: list[dict[str, Any]] = []
    for threshold in THRESHOLDS:
        for strength in STRENGTHS:
            by_season: dict[str, Any] = {}
            historical_audit: dict[str, Any] = {}
            for season, value in seasons.items():
                candidate_total, audit = weekly_arbitration(
                    value["frame"], value["baselineTotal"], value["predictions"], threshold, strength
                )
                by_season[str(season)] = detailed_metrics(
                    value["frame"], value["margin"], candidate_total, residual_sample
                )
                historical_audit[str(season)] = audit
            pooled = aggregate_total_metrics(list(by_season.values()))
            current_total, current_audit = weekly_arbitration(
                current_frame, current_baseline_total, current_heads, threshold, strength
            )
            gates = {
                "currentMeanParity": abs(float(np.mean(current_total)) - past_scoring_mean) <= 3.5,
                "historicalTotalMae": pooled["totalMae"] <= baseline_pooled["totalMae"] + 0.05,
                "historicalTeamScoreMae": pooled["teamScoreMae"] <= baseline_pooled["teamScoreMae"] + 0.05,
                "historicalTotalAccuracy": pooled["totalAccuracy"] >= baseline_pooled["totalAccuracy"] - 0.001,
                "historicalSeasonMae": all(
                    by_season[str(season)]["totalMae"]
                    <= baseline_by_season[str(season)]["totalMae"] + 0.20
                    for season in TEST_SEASONS
                ),
            }
            candidates.append({
                "threshold": threshold,
                "strength": strength,
                "currentPredictedTotalMean": float(np.mean(current_total)),
                "currentPredictedTotalSd": float(np.std(current_total)),
                "currentAudit": current_audit,
                "pooled": pooled,
                "bySeason": by_season,
                "historicalAudit": historical_audit,
                "gates": gates,
                "allGatesPass": all(gates.values()),
            })

    eligible = [candidate for candidate in candidates if candidate["allGatesPass"]]
    eligible.sort(key=lambda candidate: (
        candidate["pooled"]["totalMae"],
        -candidate["pooled"]["totalAccuracy"],
        abs(candidate["currentPredictedTotalMean"] - past_scoring_mean),
        -candidate["threshold"],
        candidate["strength"],
    ))
    selected = eligible[0] if eligible else None
    current_evaluation = None
    current_predictions: list[dict[str, Any]] = []
    historical_predictions: dict[str, list[dict[str, Any]]] = {}
    if selected is not None:
        for season, value in seasons.items():
            season_total, _ = weekly_arbitration(
                value["frame"],
                value["baselineTotal"],
                value["predictions"],
                float(selected["threshold"]),
                float(selected["strength"]),
            )
            season_home = (season_total + value["margin"]) / 2.0
            season_away = (season_total - value["margin"]) / 2.0
            historical_predictions[str(season)] = [
                {
                    "gameId": str(int(row.game_id)),
                    "gameDate": str(row.game_date),
                    "week": int(row.week),
                    "awayTeam": str(row.away_team),
                    "homeTeam": str(row.home_team),
                    "expectedAway": float(season_away[index]),
                    "expectedHome": float(season_home[index]),
                    "actualAway": float(row.away_score),
                    "actualHome": float(row.home_score),
                    "homeSpread": float(row.home_spread),
                    "totalLine": float(row.market_total),
                }
                for index, row in enumerate(value["frame"].itertuples(index=False))
            ]
        selected_total, selected_audit = weekly_arbitration(
            current_frame,
            current_baseline_total,
            current_heads,
            float(selected["threshold"]),
            float(selected["strength"]),
        )
        baseline_home = (current_baseline_total + current_margin) / 2.0
        baseline_away = (current_baseline_total - current_margin) / 2.0
        selected_home = (selected_total + current_margin) / 2.0
        selected_away = (selected_total - current_margin) / 2.0
        current_predictions = [
            {
                "gameId": str(int(row.game_id)),
                "gameDate": str(row.game_date),
                "week": int(row.week),
                "awayTeam": str(row.away_team),
                "homeTeam": str(row.home_team),
                "expectedAway": float(selected_away[index]),
                "expectedHome": float(selected_home[index]),
                "baselineExpectedAway": float(baseline_away[index]),
                "baselineExpectedHome": float(baseline_home[index]),
                "actualAway": float(row.away_score),
                "actualHome": float(row.home_score),
            }
            for index, row in enumerate(current_frame.itertuples(index=False))
        ]
        baseline_market_rows = [
            dict(row, expectedAway=row["baselineExpectedAway"], expectedHome=row["baselineExpectedHome"])
            for row in current_predictions
        ]
        current_evaluation = {
            "audit": selected_audit,
            "baseline": detailed_metrics(
                current_frame, current_margin, current_baseline_total, residual_sample
            ),
            "candidate": detailed_metrics(
                current_frame, current_margin, selected_total, residual_sample
            ),
            "marketBaseline": market_total_metrics(baseline_market_rows, Path(args.market_evidence)),
            "marketCandidate": market_total_metrics(current_predictions, Path(args.market_evidence)),
        }

    return {
        "release": RELEASE,
        "productionDecisionEffect": False,
        "selectedR4": selected_r4,
        "pastScoringMean2023To2025": past_scoring_mean,
        "baselinePooled": baseline_pooled,
        "baselineBySeason": baseline_by_season,
        "candidates": candidates,
        "selected": selected,
        "current2026": None if current_evaluation is None else {
            **current_evaluation,
            "predictions": current_predictions,
        },
        "currentPredictions": current_predictions,
        "historicalPredictions": historical_predictions,
        "sourceChecksums": checksums,
        "independentMarketExclusion": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--historical-source-dir", required=True)
    parser.add_argument("--current-source-dir", required=True)
    parser.add_argument("--market-evidence", required=True)
    parser.add_argument("--r4-report", required=True)
    parser.add_argument(
        "--residual-artifact",
        default="lib/services/football/modelArtifacts/cfbV1JointScoreArtifact.json",
    )
    parser.add_argument("--output", default="/private/tmp/cfb-cross-family-domain-arbitration-r7.json")
    parser.add_argument("--seed", type=int, default=20260930)
    parser.add_argument("--rolling-calibration", action="store_true")
    args = parser.parse_args()
    report = run(args)
    Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "release": report["release"],
        "pastScoringMean2023To2025": report["pastScoringMean2023To2025"],
        "baselinePooled": report["baselinePooled"],
        "selected": report["selected"],
        "current2026": report["current2026"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
