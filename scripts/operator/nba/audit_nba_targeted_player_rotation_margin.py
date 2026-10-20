#!/usr/bin/env python3
"""Chronological targeted player/rotation NBA margin audit."""

from __future__ import annotations

import argparse
import json
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


RELEASE = "nba_targeted_player_rotation_margin_2026_10_20_r1_chronological"
SELECTION_SEASONS = (2022, 2023, 2024)
ALPHAS = (100.0, 300.0, 1000.0, 3000.0)
RATING_WEIGHTS = (0.0, 0.30)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def additions(frame: pd.DataFrame) -> dict[str, list[str]]:
    numeric = [c for c in frame.columns if pd.api.types.is_numeric_dtype(frame[c])]
    impact_tokens = (
        "playerImpactEstimate_", "rotationEstimatedNetRating_",
        "usageWeighted_", "usageMax_", "usageConcentration_",
    )
    rotation_tokens = (
        "rotation_expected_", "rotation_continuity_", "rotation_latest_",
        "top3MinutesShare_", "top8MinutesShare_", "rotationPlayers_",
        "rotationMinutesEntropy_",
    )
    matchup_tokens = (
        "matchup_home_efg_edge_", "matchup_away_efg_edge_",
        "matchup_home_turnover_edge_", "matchup_away_turnover_edge_",
        "matchup_home_rebound_edge_", "matchup_away_rebound_edge_",
        "matchup_home_free_throw_edge_", "matchup_away_free_throw_edge_",
    )
    choose = lambda tokens: sorted(c for c in numeric if any(t in c for t in tokens))
    impact = choose(impact_tokens)
    rotation = choose(rotation_tokens)
    matchup = choose(matchup_tokens)
    return {
        "player_impact": impact,
        "rotation_shape": rotation,
        "player_rotation": sorted(set(impact + rotation)),
        "player_rotation_matchup": sorted(set(impact + rotation + matchup)),
    }


def fit_margin(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    features: list[str],
    alpha: float,
) -> np.ndarray:
    model = {"family": "ridge", "alpha": alpha}
    x_train, x_evaluate, _ = tournament.design_matrices(train, evaluate, features, model)
    coefficients = tournament.fit_regressor(
        x_train, train["target_home_margin"].to_numpy(float), model,
    )
    return tournament.predict_regressor(x_evaluate, coefficients)


def evaluate_origin(
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    alpha: float,
    rating_weight: float,
    base_features: list[str],
) -> tuple[dict[str, Any], np.ndarray, np.ndarray]:
    train = frame[frame["season"] < season].copy()
    evaluate = frame[frame["season"] == season].copy()
    incumbent_home, incumbent_away, _ = tournament.fit_predict(
        train, evaluate, base_features,
        {"family": "ridge", "alpha": 1000.0}, "margin_total",
    )
    candidate_margin = fit_margin(train, evaluate, features, alpha)
    rating_home, rating_away = tournament.rating_baseline(
        evaluate, float(train["target_home_margin"].mean()),
    )
    candidate_margin = (
        (1.0 - rating_weight) * candidate_margin
        + rating_weight * (rating_home - rating_away)
    )
    incumbent_total = incumbent_home + incumbent_away
    home = (incumbent_total + candidate_margin) / 2.0
    away = (incumbent_total - candidate_margin) / 2.0
    return ensemble.metrics(evaluate, home, away), home, away


def averages(rows: list[dict[str, Any]]) -> dict[str, float]:
    keys = ("marginMae", "teamScoreMae", "totalMae", "winnerAccuracy", "winnerBrier")
    output = {key: float(np.mean([row["metrics"][key] for row in rows])) for key in keys}
    output["calibrationError"] = float(np.mean([
        abs(float(row["metrics"]["marginCalibrationSlope"]) - 1.0) for row in rows
    ]))
    return output


def main() -> None:
    args = parse_args()
    frame = tournament.validate(tournament.read_jsonl(args.features))
    catalog = tournament.feature_catalog(frame)
    base = catalog["ratings_schedule"]
    extra = additions(frame)
    groups = {"ratings_schedule": base}
    groups.update({name: sorted(set(base + values)) for name, values in extra.items()})

    references: dict[int, dict[str, Any]] = {}
    for season in SELECTION_SEASONS:
        references[season], _, _ = evaluate_origin(
            frame, season, base, 1000.0, 0.0, base,
        )
    reference_rows = [{"season": s, "metrics": references[s]} for s in SELECTION_SEASONS]
    reference_mean = averages(reference_rows)

    candidates = []
    for group_name, features in groups.items():
        for alpha in ALPHAS:
            for rating_weight in RATING_WEIGHTS:
                rows = []
                for season in SELECTION_SEASONS:
                    metrics, _, _ = evaluate_origin(
                        frame, season, features, alpha, rating_weight, base,
                    )
                    rows.append({"season": season, "metrics": metrics})
                mean = averages(rows)
                improved_seasons = sum(
                    row["metrics"]["marginMae"] < references[int(row["season"])]["marginMae"]
                    for row in rows
                )
                eligible = bool(
                    mean["marginMae"] < reference_mean["marginMae"]
                    and improved_seasons >= 2
                    and mean["calibrationError"] < reference_mean["calibrationError"]
                    and mean["winnerAccuracy"] >= reference_mean["winnerAccuracy"] - 0.0025
                    and mean["winnerBrier"] <= reference_mean["winnerBrier"] + 0.001
                    and mean["teamScoreMae"] <= reference_mean["teamScoreMae"] + 0.02
                    and abs(mean["totalMae"] - reference_mean["totalMae"]) <= 1e-10
                )
                joint = float(
                    0.50 * mean["marginMae"] / reference_mean["marginMae"]
                    + 0.20 * mean["teamScoreMae"] / reference_mean["teamScoreMae"]
                    + 0.15 * mean["winnerBrier"] / reference_mean["winnerBrier"]
                    + 0.15 * mean["calibrationError"] / max(reference_mean["calibrationError"], 1e-6)
                )
                candidates.append({
                    "name": f"{group_name}:a{alpha:g}:rw{rating_weight:.2f}",
                    "group": group_name,
                    "featureCount": len(features),
                    "alpha": alpha,
                    "ratingWeight": rating_weight,
                    "rollingOrigins": rows,
                    "summary": {**mean, "marginMaeSeasonsImproved": improved_seasons, "jointScore": joint},
                    "selectionEligible": eligible,
                })
    eligible = [row for row in candidates if row["selectionEligible"]]
    if not eligible:
        raise ValueError("No targeted player/rotation candidate cleared selection gates.")
    eligible.sort(key=lambda row: (row["summary"]["jointScore"], row["name"]))
    selected = eligible[0]

    reference, incumbent_home, incumbent_away = evaluate_origin(
        frame, 2025, base, 1000.0, 0.0, base,
    )
    candidate, candidate_home, candidate_away = evaluate_origin(
        frame, 2025, groups[selected["group"]], float(selected["alpha"]),
        float(selected["ratingWeight"]), base,
    )
    confirmation = frame[frame["season"] == 2025].copy()
    fixed_close = diagnostic.fixed_close_diagnostics(
        confirmation, incumbent_home, incumbent_away, candidate_home, candidate_away,
    )
    reference_market = diagnostic.market_diagnostics(confirmation, incumbent_home, incumbent_away)
    candidate_market = diagnostic.market_diagnostics(confirmation, candidate_home, candidate_away)
    ref_cal = abs(float(reference["marginCalibrationSlope"]) - 1.0)
    cand_cal = abs(float(candidate["marginCalibrationSlope"]) - 1.0)
    ref_gap = abs(float(reference["actualMarginSd"]) - float(reference["predictedMarginSd"]))
    cand_gap = abs(float(candidate["actualMarginSd"]) - float(candidate["predictedMarginSd"]))
    gates = {
        "marginMaeImprovesByAtLeastPointOne": candidate["marginMae"] <= reference["marginMae"] - 0.10,
        "teamScoreMaeImproves": candidate["teamScoreMae"] < reference["teamScoreMae"],
        "totalMaeIdentical": abs(candidate["totalMae"] - reference["totalMae"]) <= 1e-10,
        "winnerAccuracyNoRegression": candidate["winnerAccuracy"] >= reference["winnerAccuracy"],
        "winnerBrierNoRegression": candidate["winnerBrier"] <= reference["winnerBrier"],
        "calibrationErrorImprovesTwentyPercent": cand_cal <= ref_cal * 0.80,
        "dispersionGapImproves": cand_gap < ref_gap,
        "fixedCloseWinnerAccuracyNoRegression": (
            fixed_close["referenceCloseSameGames"]["accuracy"]
            >= fixed_close["referenceOnReferenceCloseSameGames"]["accuracy"]
        ),
        "openingSpreadAccuracyNoRegression": (
            candidate_market["againstOpeningSpread"]["accuracy"]
            >= reference_market["againstOpeningSpread"]["accuracy"]
        ),
    }
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "chronology": {"selectionSeasons": list(SELECTION_SEASONS), "confirmationSeason": 2025},
        "selection": {"eligibleCandidates": len(eligible), "selected": selected, "topEligible": eligible[:10]},
        "confirmation": {
            "reference": reference,
            "candidate": candidate,
            "fixedClose": fixed_close,
            "referenceMarket": reference_market,
            "candidateMarket": candidate_market,
        },
        "gates": gates,
        "prospectiveShadowEligible": all(gates.values()),
        "productionAuthority": False,
        "limitations": [
            "The confirmation season has been examined by prior project audits.",
            "Historical player features infer expected rotations from prior games; they do not contain authentic archived pregame injury designations.",
            "Opening consensus is an evaluation benchmark, not an authentic replay of the live r6 market reader.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "selected": selected,
        "confirmation": report["confirmation"],
        "gates": gates,
        "prospectiveShadowEligible": report["prospectiveShadowEligible"],
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
