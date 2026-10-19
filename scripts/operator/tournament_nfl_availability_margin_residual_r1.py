#!/usr/bin/env python3
"""Tournament a bounded market-free NFL availability margin residual.

Research only. This script never writes production predictions, grades, stakes,
tracking rows, member snapshots, or locked records.
"""

from __future__ import annotations

import json
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import tournament_nfl_independent_score_rebuild_r1 as r1
import tournament_nfl_provider_play_independent_r5 as r5


RELEASE = "nfl_availability_margin_residual_tournament_2026_10_19_r1"
STRICT_METRICS = (
    "explosive_rate", "sack_rate", "turnover_rate", "plays",
    "redzone_td_rate", "no_huddle_rate", "points",
)
DEVELOPMENT_SEASONS = (2017, 2018, 2019, 2020)
SELECTION_SEASON = 2021
CONFIRMATION_SEASON = 2022
STRESS_SEASONS = (2023, 2024, 2025)
RIDGE_ALPHAS = (30.0, 100.0, 300.0)
WEIGHTS = (0.25, 0.50, 0.75, 1.00)
CAPS = (2.0, 4.0, 6.0)


def availability_features(frame: pd.DataFrame) -> pd.DataFrame:
    home_unavailable = frame["home_last_qb_injury_weight"].astype(float).clip(0.0, 1.0)
    away_unavailable = frame["away_last_qb_injury_weight"].astype(float).clip(0.0, 1.0)
    home_qb_epa = frame["home_qb_epa"].astype(float)
    away_qb_epa = frame["away_qb_epa"].astype(float)
    home_qb_cpoe = frame["home_qb_cpoe"].astype(float)
    away_qb_cpoe = frame["away_qb_cpoe"].astype(float)
    home_qb_sack = frame["home_qb_sack_rate"].astype(float)
    away_qb_sack = frame["away_qb_sack_rate"].astype(float)
    home_qb_turnover = frame["home_qb_turnover_rate"].astype(float)
    away_qb_turnover = frame["away_qb_turnover_rate"].astype(float)
    home_qb_volume = frame["home_qb_log_dropbacks"].astype(float)
    away_qb_volume = frame["away_qb_log_dropbacks"].astype(float)
    values: dict[str, Any] = {
        "injury_weight_advantage": frame["away_injury_weight"].astype(float) - frame["home_injury_weight"].astype(float),
        "injury_snap_weight_advantage": frame["away_injury_snap_weight"].astype(float) - frame["home_injury_snap_weight"].astype(float),
        "out_count_advantage": frame["away_out_count"].astype(float) - frame["home_out_count"].astype(float),
        "injury_report_count_advantage": frame["away_injury_reported_count"].astype(float) - frame["home_injury_reported_count"].astype(float),
        "roster_continuity_advantage": frame["home_roster_continuity"].astype(float) - frame["away_roster_continuity"].astype(float),
        "coach_continuity_advantage": frame["home_coach_continuity"].astype(float) - frame["away_coach_continuity"].astype(float),
        "last_qb_unavailability_advantage": away_unavailable - home_unavailable,
        "last_qb_unavailability_total": away_unavailable + home_unavailable,
        "effective_qb_epa_advantage": home_qb_epa * (1.0 - home_unavailable) - away_qb_epa * (1.0 - away_unavailable),
        "effective_qb_cpoe_advantage": home_qb_cpoe * (1.0 - home_unavailable) - away_qb_cpoe * (1.0 - away_unavailable),
        "effective_qb_sack_advantage": away_qb_sack * (1.0 - away_unavailable) - home_qb_sack * (1.0 - home_unavailable),
        "effective_qb_turnover_advantage": away_qb_turnover * (1.0 - away_unavailable) - home_qb_turnover * (1.0 - home_unavailable),
        "effective_qb_volume_advantage": home_qb_volume * (1.0 - home_unavailable) - away_qb_volume * (1.0 - away_unavailable),
        "lost_qb_epa_advantage": away_unavailable * away_qb_epa - home_unavailable * home_qb_epa,
        "lost_qb_cpoe_advantage": away_unavailable * away_qb_cpoe - home_unavailable * home_qb_cpoe,
        "lost_qb_volume_advantage": away_unavailable * away_qb_volume - home_unavailable * home_qb_volume,
    }
    result = pd.DataFrame(values, index=frame.index)
    forbidden = [column for column in result if any(token in column for token in ("market", "odds", "actual", "score"))]
    if forbidden:
        raise RuntimeError(f"availability feature leakage: {forbidden}")
    return result


def baseline_predictions(games: pd.DataFrame) -> pd.DataFrame:
    recipe = r1.Recipe("provider_play", "extra_trees_regularized", ("extra_trees_regularized",))
    rows: list[pd.DataFrame] = []
    original_metrics = r5.METRICS
    r5.METRICS = STRICT_METRICS
    try:
        for season in range(2017, 2027):
            train = games[games["season"].lt(season)].reset_index(drop=True)
            test = games[games["season"].eq(season)].reset_index(drop=True)
            if train.empty or test.empty:
                continue
            scored = test.copy()
            scored["baseline_margin"] = r5.fit_predict(train, test, "actual_margin", recipe)
            scored["baseline_residual"] = scored["actual_margin"].astype(float) - scored["baseline_margin"]
            rows.append(scored)
    finally:
        r5.METRICS = original_metrics
    return pd.concat(rows, ignore_index=True)


def fit_residual(frame: pd.DataFrame, alpha: float) -> Pipeline:
    model = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", Ridge(alpha=alpha)),
    ])
    model.fit(availability_features(frame), frame["baseline_residual"].to_numpy(float))
    return model


def candidate_prediction(model: Pipeline, frame: pd.DataFrame, weight: float, cap: float) -> np.ndarray:
    raw = np.asarray(model.predict(availability_features(frame)), dtype=float)
    return frame["baseline_margin"].to_numpy(float) + np.clip(weight * raw, -cap, cap)


def direction_report(frame: pd.DataFrame, prediction: np.ndarray) -> dict[str, Any]:
    return {
        "moneyline": r1.selected_side_record(prediction, frame["actual_margin"].to_numpy(float), 0.0),
        "spread": r1.selected_side_record(prediction, frame["actual_margin"].to_numpy(float), frame["market_home_margin"].to_numpy(float)),
    }


def report(frame: pd.DataFrame, prediction: np.ndarray) -> dict[str, Any]:
    actual = frame["actual_margin"].to_numpy(float)
    injury = (frame["home_last_qb_injury_weight"].fillna(0).to_numpy(float) + frame["away_last_qb_injury_weight"].fillna(0).to_numpy(float)) > 0
    return {
        "games": int(len(frame)),
        "margin": r1.point_metrics(actual, prediction),
        "direction": direction_report(frame, prediction),
        "lastQbDesignated": {
            "games": int(np.sum(injury)),
            "margin": r1.point_metrics(actual[injury], prediction[injury]) if np.any(injury) else None,
        },
        "maximumAbsoluteAdjustment": float(np.max(np.abs(prediction - frame["baseline_margin"].to_numpy(float)))) if len(frame) else 0.0,
        "finite": bool(np.isfinite(prediction).all()),
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2026_exact_replay_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    games = pd.read_parquet(manifest["featureFile"]).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    scored = baseline_predictions(games)
    development = scored[scored["season"].isin(DEVELOPMENT_SEASONS)].reset_index(drop=True)
    selection = scored[scored["season"].eq(SELECTION_SEASON)].reset_index(drop=True)
    rankings: list[dict[str, Any]] = []
    for alpha in RIDGE_ALPHAS:
        model = fit_residual(development, alpha)
        for weight in WEIGHTS:
            for cap in CAPS:
                prediction = candidate_prediction(model, selection, weight, cap)
                metrics = r1.point_metrics(selection["actual_margin"].to_numpy(float), prediction)
                rankings.append({"alpha": alpha, "weight": weight, "cap": cap, **metrics})
    rankings.sort(key=lambda row: (row["mae"], row["rmse"], row["weight"], row["cap"], -row["alpha"]))
    selected = {key: float(rankings[0][key]) for key in ("alpha", "weight", "cap")}

    windows: dict[str, Any] = {}
    predictions: dict[int, np.ndarray] = {}
    for season in (SELECTION_SEASON, CONFIRMATION_SEASON, *STRESS_SEASONS, 2026):
        fit = scored[scored["season"].lt(season)].reset_index(drop=True)
        test = scored[scored["season"].eq(season)].reset_index(drop=True)
        model = fit_residual(fit, selected["alpha"])
        candidate = candidate_prediction(model, test, selected["weight"], selected["cap"])
        predictions[season] = candidate
        baseline = test["baseline_margin"].to_numpy(float)
        windows[str(season)] = {"baseline": report(test, baseline), "candidate": report(test, candidate)}

    stress = scored[scored["season"].isin(STRESS_SEASONS)].reset_index(drop=True)
    stress_prediction = np.concatenate([predictions[season] for season in STRESS_SEASONS])
    stress_baseline = stress["baseline_margin"].to_numpy(float)
    confirmation = windows[str(CONFIRMATION_SEASON)]
    exact = windows["2026"]
    confirmation_moneyline_delta = (
        confirmation["candidate"]["direction"]["moneyline"]["wins"] - confirmation["candidate"]["direction"]["moneyline"]["losses"]
        - confirmation["baseline"]["direction"]["moneyline"]["wins"] + confirmation["baseline"]["direction"]["moneyline"]["losses"]
    )
    confirmation_spread_delta = (
        confirmation["candidate"]["direction"]["spread"]["wins"] - confirmation["candidate"]["direction"]["spread"]["losses"]
        - confirmation["baseline"]["direction"]["spread"]["wins"] + confirmation["baseline"]["direction"]["spread"]["losses"]
    )
    gates = {
        "confirmationMarginMaeImproves": confirmation["candidate"]["margin"]["mae"] < confirmation["baseline"]["margin"]["mae"],
        "confirmationMarginRmseImproves": confirmation["candidate"]["margin"]["rmse"] < confirmation["baseline"]["margin"]["rmse"],
        "confirmationQbSampleAtLeast12": confirmation["candidate"]["lastQbDesignated"]["games"] >= 12,
        "confirmationQbMaeImproves": confirmation["candidate"]["lastQbDesignated"]["margin"]["mae"] < confirmation["baseline"]["lastQbDesignated"]["margin"]["mae"],
        "confirmationDirectionStable": confirmation_moneyline_delta >= -2 and confirmation_spread_delta >= -2 and (confirmation_moneyline_delta >= 0 or confirmation_spread_delta >= 0),
        "stress2023To2025WithinTolerance": report(stress, stress_prediction)["margin"]["mae"] <= report(stress, stress_baseline)["margin"]["mae"] + 0.05,
        "stress2026WithinTolerance": exact["candidate"]["margin"]["mae"] <= exact["baseline"]["margin"]["mae"] + 0.10,
        "boundedFinite": all(value["candidate"]["finite"] and value["candidate"]["maximumAbsoluteAdjustment"] <= selected["cap"] + 1e-12 for value in windows.values()),
    }
    gates["advanceToCompleteProductReplay"] = bool(all(gates.values()))
    payload = {
        "release": RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "productionDecisionEffect": False,
        "featureRelease": manifest["featureRelease"],
        "featureFileSha256": manifest["featureFileSha256"],
        "chronology": {
            "residualDevelopment": list(DEVELOPMENT_SEASONS),
            "selection": SELECTION_SEASON,
            "confirmation": CONFIRMATION_SEASON,
            "openedStress": [*STRESS_SEASONS, 2026],
            "baselinePolicy": "each season fit only on earlier seasons",
        },
        "features": list(availability_features(development.head(1)).columns),
        "selected": selected,
        "selectionRankings": rankings,
        "windows": windows,
        "stress2023To2025": {"baseline": report(stress, stress_baseline), "candidate": report(stress, stress_prediction)},
        "gates": gates,
        "restrictions": [
            "research-only", "market-free availability residual", "total unchanged",
            "2023-2026 stress cannot select or rescue candidate", "no locked-record writes",
        ],
    }
    output_root = root / "football-research/reports/nfl-availability-margin-residual-r1"
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "tournament.json"
    output_path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"release": RELEASE, "selected": selected, "confirmation": confirmation, "stress2023To2025": payload["stress2023To2025"], "exact2026": exact, "gates": gates, "output": str(output_path)}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
