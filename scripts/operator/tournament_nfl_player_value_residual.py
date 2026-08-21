#!/usr/bin/env python3
"""Test NFL player-value corrections against the market-reference champion.

Hyperparameters are selected on expanding-window 2020-2022 predictions, then
reported unchanged on 2023-2024 confirmation seasons and the already-inspected
2025 historical season. Even a passing historical candidate remains shadow-only
until locked 2026 forward evidence exists.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy.special import expit, logit
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


TOURNAMENT_RELEASE = "nfl_market_residual_player_value_tournament_2026_08_20_r2"
MODEL_RELEASE = "nfl_market_residual_player_value_shadow_2026_08_20_r2"
CALIBRATION_RELEASE = "nfl_market_logit_player_value_adjustment_2026_08_20_r2"
FEATURE_RELEASE = "nfl_player_value_features_2016_2025_2026_08_20_r3"
REFERENCE_RELEASE = "nfl_market_reference_core_2026_08_20_r1"

EVALUATION_SEASONS = tuple(range(2020, 2026))
SELECTION_SEASONS = (2020, 2021, 2022)
CONFIRMATION_SEASONS = (2023, 2024)
HISTORICAL_FINAL_SEASON = 2025
RIDGE_ALPHAS = (30.0, 100.0, 300.0, 1000.0)
CORRECTION_WEIGHTS = (0.25, 0.50, 0.75, 1.00)
CORRECTION_CAP_POINTS = 4.0
RANDOM_STATE = 20082026


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implied(price: pd.Series | np.ndarray) -> np.ndarray:
    values = np.asarray(price, dtype=float)
    result = np.full(values.shape, np.nan, dtype=float)
    positive = values > 0
    negative = values < 0
    result[positive] = 100.0 / (values[positive] + 100.0)
    result[negative] = -values[negative] / (-values[negative] + 100.0)
    return result


def no_vig(first: pd.Series | np.ndarray, second: pd.Series | np.ndarray) -> np.ndarray:
    a = implied(first)
    b = implied(second)
    denominator = a + b
    return np.divide(a, denominator, out=np.full(a.shape, np.nan), where=denominator > 0)


def make_model(alpha: float) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("ridge", Ridge(alpha=alpha, random_state=RANDOM_STATE)),
    ])


def feature_sets(frame: pd.DataFrame) -> dict[str, list[str]]:
    availability = [
        "pv_unavailable_role_diff", "pv_unavailable_role_sum",
        "pv_offense_unavailable_diff", "pv_offense_unavailable_sum",
        "pv_defense_unavailable_diff", "pv_defense_unavailable_sum",
        "pv_out_role_diff", "pv_out_role_sum",
        "pv_doubtful_role_diff", "pv_doubtful_role_sum",
        "pv_questionable_role_diff", "pv_questionable_role_sum",
        "pv_core_out_count_diff", "pv_core_out_count_sum",
    ]
    position_groups = [
        f"pv_{group}_unavailable_{shape}"
        for group in ("qb", "ol", "skill", "front", "secondary")
        for shape in ("diff", "sum")
    ]
    continuity = [
        f"pv_{name}_{shape}"
        for name in (
            "offense_continuity", "defense_continuity",
            "healthy_offense_continuity", "healthy_defense_continuity",
        )
        for shape in ("diff", "sum")
    ]
    quarterback = [
        "pv_qb_unavailable_diff", "pv_qb_unavailable_sum", "pv_qb_epa_diff", "pv_qb_epa_sum",
        "pv_qb_cpoe_diff", "pv_qb_cpoe_sum", "pv_qb_experience_diff", "pv_qb_experience_sum",
        "pv_qb_sack_rate_diff", "pv_qb_sack_rate_sum", "pv_qb_turnover_rate_diff",
        "pv_qb_turnover_rate_sum", "pv_qb_continuity_diff", "pv_qb_continuity_sum",
    ]
    sets = {
        "availability": availability,
        "availability_by_unit": sorted(set(availability + position_groups)),
        "continuity": continuity,
        "quarterback": quarterback,
        "player_value_full": sorted(set(availability + position_groups + continuity + quarterback)),
    }
    missing = {name: [column for column in columns if column not in frame] for name, columns in sets.items()}
    missing = {name: columns for name, columns in missing.items() if columns}
    if missing:
        raise RuntimeError(f"missing player-value features: {missing}")
    return sets


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    keep = np.isfinite(actual) & np.isfinite(prediction)
    y = actual[keep]
    p = prediction[keep]
    return {
        "rows": int(len(y)),
        "mae": float(mean_absolute_error(y, p)),
        "rmse": float(math.sqrt(mean_squared_error(y, p))),
        "bias": float(np.mean(p - y)),
    }


def probability_metrics(
    outcome: np.ndarray,
    probability: np.ndarray,
    push: np.ndarray | None = None,
) -> dict[str, float | int]:
    p = np.asarray(probability, dtype=float)
    y = np.asarray(outcome, dtype=int)
    keep = np.isfinite(p)
    if push is not None:
        keep &= ~np.asarray(push, dtype=bool)
    p = np.clip(p[keep], 0.001, 0.999)
    y = y[keep]
    bins = np.minimum(9, np.floor(p * 10).astype(int))
    ece = 0.0
    for index in range(10):
        mask = bins == index
        if mask.any():
            ece += float(mask.mean()) * abs(float(p[mask].mean()) - float(y[mask].mean()))
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
        "ece10": ece,
    }


def prepare_frame(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    result["reference_ml_probability"] = no_vig(result["home_moneyline"], result["away_moneyline"])
    result["reference_spread_probability"] = no_vig(result["home_spread_odds"], result["away_spread_odds"])
    result["reference_total_probability"] = no_vig(result["over_odds"], result["under_odds"])
    result["home_win"] = result["actual_margin"].gt(0).astype(int)
    result["home_cover"] = result["actual_margin"].gt(result["market_home_margin"]).astype(int)
    result["spread_push"] = result["actual_margin"].eq(result["market_home_margin"])
    result["over"] = result["actual_total"].gt(result["market_total"]).astype(int)
    result["total_push"] = result["actual_total"].eq(result["market_total"])
    return result


def fit_expanding_predictions(
    frame: pd.DataFrame,
    sets: dict[str, list[str]],
    target_column: str,
    market_column: str,
) -> pd.DataFrame:
    rows: list[pd.DataFrame] = []
    for season in EVALUATION_SEASONS:
        train = frame[(frame["season"] < season) & frame[target_column].notna() & frame[market_column].notna()].copy()
        test = frame[(frame["season"] == season) & frame[target_column].notna() & frame[market_column].notna()].copy()
        if len(train) < 900 or len(test) < 250:
            raise RuntimeError(f"insufficient expanding-window rows for {target_column} {season}")
        residual = train[target_column].to_numpy(float) - train[market_column].to_numpy(float)
        test["probability_slope"] = 1.596 / max(1.0, float(np.std(residual, ddof=1)))
        for set_name, columns in sets.items():
            for alpha in RIDGE_ALPHAS:
                model = make_model(alpha)
                model.fit(train[columns], residual)
                raw = np.asarray(model.predict(test[columns]), dtype=float)
                test[f"correction__{set_name}__{int(alpha)}"] = np.clip(
                    raw, -CORRECTION_CAP_POINTS, CORRECTION_CAP_POINTS
                )
        rows.append(test)
    return pd.concat(rows, ignore_index=True)


def recipe_probability(
    base_probability: np.ndarray,
    correction: np.ndarray,
    slope: np.ndarray,
    weight: float,
) -> np.ndarray:
    base = np.asarray(base_probability, dtype=float)
    result = np.full(base.shape, np.nan, dtype=float)
    keep = np.isfinite(base) & np.isfinite(correction) & np.isfinite(slope)
    result[keep] = expit(logit(np.clip(base[keep], 0.001, 0.999)) + weight * correction[keep] * slope[keep])
    return result


def evaluate_recipe(
    rows: pd.DataFrame,
    target_column: str,
    market_column: str,
    correction_column: str | None,
    weight: float,
    seasons: tuple[int, ...],
) -> dict[str, Any]:
    selected = rows[rows["season"].isin(seasons)].copy()
    actual = selected[target_column].to_numpy(float)
    reference = selected[market_column].to_numpy(float)
    correction = (
        np.zeros(len(selected), dtype=float)
        if correction_column is None
        else selected[correction_column].to_numpy(float)
    )
    candidate = reference + weight * correction
    result: dict[str, Any] = {
        "seasons": list(seasons),
        "reference": point_metrics(actual, reference),
        "candidate": point_metrics(actual, candidate),
        "meanAbsoluteCorrection": float(np.mean(np.abs(weight * correction))),
        "correctionCapHitRate": float(np.mean(np.abs(correction) >= CORRECTION_CAP_POINTS - 1e-9)),
    }
    result["maeImprovement"] = float(result["reference"]["mae"] - result["candidate"]["mae"])
    result["rmseImprovement"] = float(result["reference"]["rmse"] - result["candidate"]["rmse"])

    slope = selected["probability_slope"].to_numpy(float)
    if target_column == "actual_margin":
        candidate_ml = recipe_probability(
            selected["reference_ml_probability"].to_numpy(float), correction, slope, weight
        )
        candidate_spread = recipe_probability(
            selected["reference_spread_probability"].to_numpy(float), correction, slope, weight
        )
        result["moneyline"] = {
            "reference": probability_metrics(selected["home_win"], selected["reference_ml_probability"]),
            "candidate": probability_metrics(selected["home_win"], candidate_ml),
        }
        result["spread"] = {
            "reference": probability_metrics(
                selected["home_cover"], selected["reference_spread_probability"], selected["spread_push"]
            ),
            "candidate": probability_metrics(selected["home_cover"], candidate_spread, selected["spread_push"]),
        }
        result["primaryBrierImprovement"] = float(
            result["spread"]["reference"]["brier"] - result["spread"]["candidate"]["brier"]
        )
    else:
        candidate_over = recipe_probability(
            selected["reference_total_probability"].to_numpy(float), correction, slope, weight
        )
        result["totalProbability"] = {
            "reference": probability_metrics(
                selected["over"], selected["reference_total_probability"], selected["total_push"]
            ),
            "candidate": probability_metrics(selected["over"], candidate_over, selected["total_push"]),
        }
        result["primaryBrierImprovement"] = float(
            result["totalProbability"]["reference"]["brier"]
            - result["totalProbability"]["candidate"]["brier"]
        )
    return result


def recipe_name(set_name: str, alpha: float, weight: float) -> str:
    return f"{set_name}__ridge_{int(alpha)}__weight_{weight:.2f}"


def tournament_target(
    frame: pd.DataFrame,
    sets: dict[str, list[str]],
    target_column: str,
    market_column: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    oos = fit_expanding_predictions(frame, sets, target_column, market_column)
    rankings: list[dict[str, Any]] = []
    for set_name in sorted(sets):
        for alpha in RIDGE_ALPHAS:
            correction_column = f"correction__{set_name}__{int(alpha)}"
            for weight in CORRECTION_WEIGHTS:
                evaluation = evaluate_recipe(
                    oos, target_column, market_column, correction_column, weight, SELECTION_SEASONS
                )
                rankings.append({
                    "recipe": recipe_name(set_name, alpha, weight),
                    "featureSet": set_name,
                    "alpha": alpha,
                    "weight": weight,
                    "mae": evaluation["candidate"]["mae"],
                    "maeImprovement": evaluation["maeImprovement"],
                    "primaryBrierImprovement": evaluation["primaryBrierImprovement"],
                    "meanAbsoluteCorrection": evaluation["meanAbsoluteCorrection"],
                })
    reference_selection = evaluate_recipe(
        oos, target_column, market_column, None, 0.0, SELECTION_SEASONS
    )
    rankings.sort(key=lambda item: (item["mae"], -item["primaryBrierImprovement"], item["meanAbsoluteCorrection"]))
    best_positive = rankings[0]
    selected_is_correction = (
        best_positive["maeImprovement"] > 0
        and best_positive["primaryBrierImprovement"] >= -0.00025
    )
    selected = best_positive if selected_is_correction else {
        "recipe": "market_reference_zero_correction",
        "featureSet": None,
        "alpha": None,
        "weight": 0.0,
    }
    correction_column = (
        None
        if selected["featureSet"] is None
        else f"correction__{selected['featureSet']}__{int(selected['alpha'])}"
    )

    periods = {
        "selection": SELECTION_SEASONS,
        "confirmation": CONFIRMATION_SEASONS,
        "historical2025": (HISTORICAL_FINAL_SEASON,),
        "allEvaluation": EVALUATION_SEASONS,
    }
    evaluations = {
        name: evaluate_recipe(oos, target_column, market_column, correction_column, float(selected["weight"]), seasons)
        for name, seasons in periods.items()
    }
    by_season = {
        str(season): evaluate_recipe(
            oos, target_column, market_column, correction_column, float(selected["weight"]), (season,)
        )
        for season in EVALUATION_SEASONS
    }
    improved_seasons = sum(value["maeImprovement"] > 0 for value in by_season.values())
    material_losing_seasons = sum(value["maeImprovement"] < -0.10 for value in by_season.values())
    historical_gate = bool(
        selected_is_correction
        and evaluations["allEvaluation"]["maeImprovement"] > 0
        and evaluations["allEvaluation"]["primaryBrierImprovement"] >= 0
        and improved_seasons >= 4
        and material_losing_seasons == 0
        and evaluations["confirmation"]["maeImprovement"] > 0
    )

    artifact: dict[str, Any] = {
        "selected": selected,
        "historicalGatePassed": historical_gate,
        "model": None,
        "features": [],
    }
    if selected_is_correction:
        columns = sets[str(selected["featureSet"])]
        train = frame[frame[target_column].notna() & frame[market_column].notna()].copy()
        target = train[target_column].to_numpy(float) - train[market_column].to_numpy(float)
        model = make_model(float(selected["alpha"]))
        model.fit(train[columns], target)
        artifact.update({"model": model, "features": columns})

    report = {
        "target": target_column,
        "marketColumn": market_column,
        "selectionPolicy": {
            "seasons": list(SELECTION_SEASONS),
            "primary": "lowest point MAE",
            "probabilityGuard": "relevant-side Brier may not worsen by more than 0.00025",
            "zeroCorrectionFallback": not selected_is_correction,
        },
        "referenceSelection": reference_selection,
        "selected": selected,
        "bestPositiveCandidate": best_positive,
        "topSelectionCandidates": rankings[:10],
        "periods": evaluations,
        "bySeason": by_season,
        "stability": {
            "improvedSeasons": improved_seasons,
            "requiredImprovedSeasons": 4,
            "materialLosingSeasons": material_losing_seasons,
            "materialLossDefinition": "candidate MAE worse by more than 0.10 points",
        },
        "historicalGatePassed": historical_gate,
    }
    return report, artifact


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r3.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if (
        manifest.get("featureRelease") != FEATURE_RELEASE
        or not feature_path.exists()
        or sha256_file(feature_path) != manifest.get("featureFileSha256")
    ):
        raise RuntimeError("player-value feature release/checksum mismatch")
    frame = prepare_frame(pd.read_parquet(feature_path))
    if frame["game_id"].duplicated().any() or len(frame) != 2639:
        raise RuntimeError("unexpected player-value tournament frame")
    sets = feature_sets(frame)

    margin_report, margin_artifact = tournament_target(
        frame, sets, "actual_margin", "market_home_margin"
    )
    total_report, total_artifact = tournament_target(
        frame, sets, "actual_total", "market_total"
    )
    combined_historical_gate = bool(
        margin_report["historicalGatePassed"] or total_report["historicalGatePassed"]
    )

    artifact_root = root / "football-research/cache/nfl-model"
    artifact_path = artifact_root / f"{MODEL_RELEASE}.joblib"
    artifact = {
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "referenceRelease": REFERENCE_RELEASE,
        "localOnly": True,
        "actionable": False,
        "trainedThrough": "2025-12-31",
        "correctionCapPoints": CORRECTION_CAP_POINTS,
        "margin": margin_artifact,
        "total": total_artifact,
    }
    joblib.dump(artifact, artifact_path, compress=3)

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "referenceRelease": REFERENCE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "productionBehaviorChanged": False,
        "officialTrackingChanged": False,
        "actionableGradesAuthorized": False,
        "preseasonIncluded": False,
        "featureSha256": manifest["featureFileSha256"],
        "modelArtifact": str(artifact_path),
        "modelArtifactSha256": sha256_file(artifact_path),
        "featureSets": {name: columns for name, columns in sets.items()},
        "margin": margin_report,
        "total": total_report,
        "promotionGate": {
            "status": "historical_shadow_candidate" if combined_historical_gate else "historical_gate_failed",
            "atLeastOneTargetPassedHistoricalGate": combined_historical_gate,
            "forwardProofRequired": True,
            "forwardSeason": 2026,
            "sameBookClvRequired": True,
            "lockedPriceValueRequired": True,
            "actionableGradesAuthorized": False,
            "reason": (
                "A historically stable point-and-probability correction exists, but 2026 locked forward evidence is still mandatory."
                if combined_historical_gate
                else "The player-value layer is useful structured context, but its correction did not clear the frozen multi-season promotion gate."
            ),
        },
        "boardImpact": {
            "promotions": 0,
            "demotions": 0,
            "netActionableChange": 0,
            "reason": "shadow research only; no live grade or stake rule changed",
        },
        "limitations": [
            "Historical injury rows represent the final weekly report, not an intraday snapshot aligned to an opening price.",
            "nflverse market columns are terminal consensus prices, not OddSphere same-book locked snapshots.",
            "The 2025 season has already been inspected in prior research and is historical confirmation, not a clean future holdout.",
            "Current scoring requires timestamped depth charts, expected starters, injury reports, and same-book prices.",
            "Public and sharp split history is absent and was not fabricated.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "promotionGate": report["promotionGate"],
        "marginSelected": margin_report["selected"],
        "marginAllEvaluation": margin_report["periods"]["allEvaluation"],
        "totalSelected": total_report["selected"],
        "totalAllEvaluation": total_report["periods"]["allEvaluation"],
        "report": str(report_path),
        "modelArtifactSha256": report["modelArtifactSha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
