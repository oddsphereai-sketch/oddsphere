#!/usr/bin/env python3
"""Chronological, research-only NBA margin-compression repair audit."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.operator import tournament_nba_professional_model as tournament
from scripts.operator.nba import audit_nba_independent_ensemble_shadow as ensemble
from scripts.operator.nba import diagnose_nba_independent_ensemble_confirmation as diagnostic


RELEASE = "nba_margin_compression_repair_2026_10_20_r1_chronological"
SHADOW_ARTIFACT_RELEASE = (
    "nba_professional_margin_shadow_2026_10_20_r2_alpha300_rating30_total20"
)
SELECTION_SEASONS = (2022, 2023, 2024)
ALPHAS = (10.0, 30.0, 100.0, 300.0, 1000.0, 3000.0)
MARGIN_RATING_WEIGHTS = (0.0, 0.15, 0.30)
TOTAL_RATING_WEIGHTS = (0.0, 0.20)
CALIBRATION_STRENGTHS = (0.0, 0.50, 1.0)
CALIBRATION_CLIP = (0.85, 1.25)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--artifact-output", type=Path)
    return parser.parse_args()


def fit_components(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    features: list[str],
    alpha: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    home, away, _ = tournament.fit_predict(
        train,
        evaluate,
        features,
        {"family": "ridge", "alpha": alpha},
        "margin_total",
    )
    rating_home, rating_away = tournament.rating_baseline(
        evaluate,
        float(train["target_home_margin"].mean()),
    )
    return home, away, rating_home, rating_away


def nested_oof_components(
    train: pd.DataFrame,
    features: list[str],
    alpha: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    margins: list[np.ndarray] = []
    rating_margins: list[np.ndarray] = []
    actuals: list[np.ndarray] = []
    seasons = sorted(int(value) for value in train["season"].unique())
    for season in seasons[1:]:
        nested_train = train[train["season"] < season].copy()
        nested_evaluate = train[train["season"] == season].copy()
        if len(nested_train) < 1000 or nested_evaluate.empty:
            continue
        home, away, rating_home, rating_away = fit_components(
            nested_train, nested_evaluate, features, alpha,
        )
        margins.append(home - away)
        rating_margins.append(rating_home - rating_away)
        actuals.append(nested_evaluate["target_home_margin"].to_numpy(float))
    if not margins:
        ordered = train.sort_values(["feature_cutoff", "game_id"]).copy()
        split = int(len(ordered) * 0.60)
        nested_train = ordered.iloc[:split].copy()
        nested_evaluate = ordered.iloc[split:].copy()
        if len(nested_train) < 500 or len(nested_evaluate) < 300:
            raise ValueError("Chronological fallback calibration has insufficient games.")
        home, away, rating_home, rating_away = fit_components(
            nested_train, nested_evaluate, features, alpha,
        )
        margins.append(home - away)
        rating_margins.append(rating_home - rating_away)
        actuals.append(nested_evaluate["target_home_margin"].to_numpy(float))
    return np.concatenate(margins), np.concatenate(rating_margins), np.concatenate(actuals)


def slope_through_zero(predicted: np.ndarray, actual: np.ndarray) -> float:
    denominator = float(predicted @ predicted)
    if denominator <= 1e-9:
        return 1.0
    raw = float((predicted @ actual) / denominator)
    return float(np.clip(raw, CALIBRATION_CLIP[0], CALIBRATION_CLIP[1]))


def candidate_scores(
    components: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray],
    calibration_components: tuple[np.ndarray, np.ndarray, np.ndarray],
    margin_weight: float,
    total_weight: float,
    calibration_strength: float,
) -> tuple[np.ndarray, np.ndarray, float]:
    base_home, base_away, rating_home, rating_away = components
    base_margin = base_home - base_away
    base_total = base_home + base_away
    rating_margin = rating_home - rating_away
    rating_total = rating_home + rating_away
    margin = (1.0 - margin_weight) * base_margin + margin_weight * rating_margin
    total = (1.0 - total_weight) * base_total + total_weight * rating_total

    oof_margin, oof_rating_margin, oof_actual = calibration_components
    oof_blend = (1.0 - margin_weight) * oof_margin + margin_weight * oof_rating_margin
    learned_scale = slope_through_zero(oof_blend, oof_actual)
    applied_scale = 1.0 + calibration_strength * (learned_scale - 1.0)
    margin = margin * applied_scale
    return (total + margin) / 2.0, (total - margin) / 2.0, applied_scale


def mean_metric(rows: list[dict[str, Any]], key: str) -> float:
    return float(np.mean([float(row["metrics"][key]) for row in rows]))


def mean_calibration_error(rows: list[dict[str, Any]]) -> float:
    return float(np.mean([
        abs(float(row["metrics"]["marginCalibrationSlope"]) - 1.0)
        for row in rows
    ]))


def joint_score(rows: list[dict[str, Any]], references: dict[int, dict[str, Any]]) -> float:
    relative_margin = []
    relative_team = []
    relative_total = []
    relative_brier = []
    relative_calibration = []
    for row in rows:
        reference = references[int(row["season"])]
        measured = row["metrics"]
        relative_margin.append(measured["marginMae"] / reference["marginMae"])
        relative_team.append(measured["teamScoreMae"] / reference["teamScoreMae"])
        relative_total.append(measured["totalMae"] / reference["totalMae"])
        relative_brier.append(measured["winnerBrier"] / reference["winnerBrier"])
        candidate_gap = abs(float(measured["marginCalibrationSlope"]) - 1.0)
        reference_gap = max(abs(float(reference["marginCalibrationSlope"]) - 1.0), 1e-6)
        relative_calibration.append(candidate_gap / reference_gap)
    return float(
        0.35 * np.mean(relative_margin)
        + 0.20 * np.mean(relative_team)
        + 0.15 * np.mean(relative_total)
        + 0.15 * np.mean(relative_brier)
        + 0.15 * np.mean(relative_calibration)
    )


def recipe_key(alpha: float, margin_weight: float, total_weight: float, strength: float) -> str:
    return f"a{alpha:g}_mw{margin_weight:.2f}_tw{total_weight:.2f}_cs{strength:.2f}"


def main() -> None:
    args = parse_args()
    frame = tournament.validate(tournament.read_jsonl(args.features))
    groups = tournament.feature_catalog(frame)
    features = groups["ratings_schedule"]

    evaluation_cache: dict[tuple[int, float], tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = {}
    calibration_cache: dict[tuple[int, float], tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    references: dict[int, dict[str, Any]] = {}
    for season in SELECTION_SEASONS:
        train = frame[frame["season"] < season].copy()
        evaluate = frame[frame["season"] == season].copy()
        for alpha in ALPHAS:
            evaluation_cache[(season, alpha)] = fit_components(train, evaluate, features, alpha)
            calibration_cache[(season, alpha)] = nested_oof_components(train, features, alpha)
        incumbent = evaluation_cache[(season, 1000.0)]
        references[season] = ensemble.metrics(evaluate, incumbent[0], incumbent[1])

    candidates: list[dict[str, Any]] = []
    for alpha in ALPHAS:
        for margin_weight in MARGIN_RATING_WEIGHTS:
            for total_weight in TOTAL_RATING_WEIGHTS:
                for strength in CALIBRATION_STRENGTHS:
                    rows = []
                    for season in SELECTION_SEASONS:
                        evaluate = frame[frame["season"] == season].copy()
                        home, away, applied_scale = candidate_scores(
                            evaluation_cache[(season, alpha)],
                            calibration_cache[(season, alpha)],
                            margin_weight,
                            total_weight,
                            strength,
                        )
                        rows.append({
                            "season": season,
                            "appliedMarginScale": applied_scale,
                            "metrics": ensemble.metrics(evaluate, home, away),
                        })
                    mean_margin = mean_metric(rows, "marginMae")
                    mean_team = mean_metric(rows, "teamScoreMae")
                    mean_total = mean_metric(rows, "totalMae")
                    mean_winner = mean_metric(rows, "winnerAccuracy")
                    mean_brier = mean_metric(rows, "winnerBrier")
                    reference_margin = float(np.mean([references[s]["marginMae"] for s in SELECTION_SEASONS]))
                    reference_team = float(np.mean([references[s]["teamScoreMae"] for s in SELECTION_SEASONS]))
                    reference_total = float(np.mean([references[s]["totalMae"] for s in SELECTION_SEASONS]))
                    reference_winner = float(np.mean([references[s]["winnerAccuracy"] for s in SELECTION_SEASONS]))
                    reference_brier = float(np.mean([references[s]["winnerBrier"] for s in SELECTION_SEASONS]))
                    improvements = sum(
                        row["metrics"]["marginMae"] < references[int(row["season"])]["marginMae"]
                        for row in rows
                    )
                    eligible = bool(
                        mean_margin < reference_margin
                        and improvements >= 2
                        and mean_calibration_error(rows) < float(np.mean([
                            abs(float(references[s]["marginCalibrationSlope"]) - 1.0)
                            for s in SELECTION_SEASONS
                        ]))
                        and mean_winner >= reference_winner - 0.0025
                        and mean_brier <= reference_brier + 0.001
                        and mean_team <= reference_team + 0.02
                        and mean_total <= reference_total + 0.02
                    )
                    candidates.append({
                        "name": recipe_key(alpha, margin_weight, total_weight, strength),
                        "recipe": {
                            "alpha": alpha,
                            "marginRatingWeight": margin_weight,
                            "totalRatingWeight": total_weight,
                            "calibrationStrength": strength,
                        },
                        "rollingOrigins": rows,
                        "summary": {
                            "meanMarginMae": mean_margin,
                            "meanTeamScoreMae": mean_team,
                            "meanTotalMae": mean_total,
                            "meanWinnerAccuracy": mean_winner,
                            "meanWinnerBrier": mean_brier,
                            "meanCalibrationError": mean_calibration_error(rows),
                            "marginMaeSeasonsImproved": int(improvements),
                            "jointScore": joint_score(rows, references),
                        },
                        "selectionEligible": eligible,
                    })

    eligible = [row for row in candidates if row["selectionEligible"]]
    if not eligible:
        raise ValueError("No anti-compression candidate cleared the frozen selection gates.")
    eligible.sort(key=lambda row: (row["summary"]["jointScore"], row["name"]))
    selected = eligible[0]

    confirmation_train = frame[frame["season"] < 2025].copy()
    confirmation = frame[frame["season"] == 2025].copy()
    recipe = selected["recipe"]
    alpha = float(recipe["alpha"])
    confirmation_components = fit_components(confirmation_train, confirmation, features, alpha)
    confirmation_calibration = nested_oof_components(confirmation_train, features, alpha)
    candidate_home, candidate_away, applied_scale = candidate_scores(
        confirmation_components,
        confirmation_calibration,
        float(recipe["marginRatingWeight"]),
        float(recipe["totalRatingWeight"]),
        float(recipe["calibrationStrength"]),
    )
    incumbent_components = fit_components(confirmation_train, confirmation, features, 1000.0)
    incumbent_home, incumbent_away = incumbent_components[0], incumbent_components[1]
    reference = ensemble.metrics(confirmation, incumbent_home, incumbent_away)
    candidate = ensemble.metrics(confirmation, candidate_home, candidate_away)
    fixed_close = diagnostic.fixed_close_diagnostics(
        confirmation,
        incumbent_home,
        incumbent_away,
        candidate_home,
        candidate_away,
    )
    reference_market = diagnostic.market_diagnostics(confirmation, incumbent_home, incumbent_away)
    candidate_market = diagnostic.market_diagnostics(confirmation, candidate_home, candidate_away)
    reference_calibration_error = abs(float(reference["marginCalibrationSlope"]) - 1.0)
    candidate_calibration_error = abs(float(candidate["marginCalibrationSlope"]) - 1.0)
    reference_dispersion_gap = abs(float(reference["actualMarginSd"]) - float(reference["predictedMarginSd"]))
    candidate_dispersion_gap = abs(float(candidate["actualMarginSd"]) - float(candidate["predictedMarginSd"]))
    reference_spread = reference_market["againstOpeningSpread"]["accuracy"]
    candidate_spread = candidate_market["againstOpeningSpread"]["accuracy"]
    gates = {
        "marginMaeImprovesByAtLeastPointOne": candidate["marginMae"] <= reference["marginMae"] - 0.10,
        "teamScoreMaeImproves": candidate["teamScoreMae"] < reference["teamScoreMae"],
        "totalMaeWithinPointZeroOne": candidate["totalMae"] <= reference["totalMae"] + 0.01,
        "winnerAccuracyNoRegression": candidate["winnerAccuracy"] >= reference["winnerAccuracy"],
        "winnerBrierNoRegression": candidate["winnerBrier"] <= reference["winnerBrier"],
        "calibrationErrorImprovesTwentyPercent": candidate_calibration_error <= reference_calibration_error * 0.80,
        "dispersionGapImproves": candidate_dispersion_gap < reference_dispersion_gap,
        "fixedCloseWinnerAccuracyNoRegression": (
            fixed_close["referenceCloseSameGames"]["accuracy"]
            >= fixed_close["referenceOnReferenceCloseSameGames"]["accuracy"]
        ),
        "openingSpreadAccuracyNoRegression": (
            candidate_spread is not None and reference_spread is not None and candidate_spread >= reference_spread
        ),
    }
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "chronology": {
            "selectionSeasons": list(SELECTION_SEASONS),
            "confirmationSeason": 2025,
        },
        "incumbent": {
            "alpha": 1000.0,
            "marginRatingWeight": 0.0,
            "totalRatingWeight": 0.0,
            "calibrationStrength": 0.0,
        },
        "selection": {
            "eligibleCandidates": len(eligible),
            "selected": selected,
            "topEligible": eligible[:10],
        },
        "confirmation": {
            "appliedMarginScale": applied_scale,
            "reference": reference,
            "candidate": candidate,
            "fixedClose": fixed_close,
            "referenceMarket": reference_market,
            "candidateMarket": candidate_market,
        },
        "gates": gates,
        "promotionEligible": all(gates.values()),
        "productionAuthority": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")

    artifact_path = None
    if args.artifact_output is not None:
        model = {"family": "ridge", "alpha": alpha}
        design, _, design_state = tournament.design_matrices(
            frame, frame.iloc[:1].copy(), features, model,
        )
        artifact = {
            "release": SHADOW_ARTIFACT_RELEASE,
            "tournamentRelease": RELEASE,
            "featureRelease": tournament.FEATURE_RELEASE,
            "status": "prospective_shadow_zero_production_authority",
            "promotionAuthorized": False,
            "trainingRows": int(len(frame)),
            "trainingSeasons": sorted(int(value) for value in frame["season"].unique()),
            "featureFileSha256": hashlib.sha256(args.features.read_bytes()).hexdigest(),
            "featureGroup": "ratings_schedule",
            "architecture": "margin_total",
            "model": model,
            "design": design_state,
            "coefficients": {
                "target_home_margin": tournament.fit_regressor(
                    design, frame["target_home_margin"].to_numpy(float), model,
                ).tolist(),
                "target_total": tournament.fit_regressor(
                    design, frame["target_total"].to_numpy(float), model,
                ).tolist(),
            },
            "shadowBlend": {
                "marginRatingWeight": float(recipe["marginRatingWeight"]),
                "totalRatingWeight": float(recipe["totalRatingWeight"]),
                "calibrationStrength": float(recipe["calibrationStrength"]),
            },
        }
        args.artifact_output.parent.mkdir(parents=True, exist_ok=True)
        args.artifact_output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n")
        artifact_path = str(args.artifact_output)
    print(json.dumps({
        "selected": {
            "name": selected["name"],
            "recipe": selected["recipe"],
            "summary": selected["summary"],
        },
        "confirmation": report["confirmation"],
        "gates": gates,
        "promotionEligible": report["promotionEligible"],
        "output": str(args.output),
        "artifactOutput": artifact_path,
    }, indent=2))


if __name__ == "__main__":
    main()
