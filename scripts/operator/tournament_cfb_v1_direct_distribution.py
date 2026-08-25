#!/usr/bin/env python3
"""Frozen r2 direct margin/total CFB distribution tournament."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet, Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from tournament_cfb_v1_model import (
    CONFIRMATION_SEASONS,
    FIT_SEASONS,
    META_COLUMNS,
    SELECTION_SEASON,
    baseline_predictions,
    build_dataset,
    composite,
    metrics,
    probability_rows,
    read_sources,
)


RELEASE = "cfb_v1_direct_margin_total_tournament_2026_08_25_r2"


def families(seed: int) -> dict[str, Pipeline]:
    linear = lambda estimator: Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", estimator),
    ])
    return {
        "ridge": linear(Ridge(alpha=18.0)),
        "elastic_net": linear(ElasticNet(alpha=0.03, l1_ratio=0.12, max_iter=20000, random_state=seed)),
        "hist_gradient_boosting": Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("model", HistGradientBoostingRegressor(max_iter=320, learning_rate=0.035, max_leaf_nodes=15, min_samples_leaf=30, l2_regularization=5.0, random_state=seed)),
        ]),
        "extra_trees": Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("model", ExtraTreesRegressor(n_estimators=420, min_samples_leaf=10, max_features=0.65, n_jobs=1, random_state=seed)),
        ]),
    }


def frozen_affine(predicted: np.ndarray, actual: np.ndarray) -> tuple[float, float]:
    raw_slope, raw_intercept = np.polyfit(predicted, actual, 1)
    slope = float(np.clip(raw_slope, 0.75, 2.50))
    intercept = float(actual.mean() - slope * predicted.mean())
    return slope, intercept


def apply_affine(predicted: np.ndarray, calibration: tuple[float, float]) -> np.ndarray:
    return predicted * calibration[0] + calibration[1]


def evaluate(frame, margin: np.ndarray, total: np.ndarray, residuals: np.ndarray, seed: int) -> dict[str, float]:
    raw_home = np.clip((total + margin) / 2.0, 0, 80)
    raw_away = np.clip((total - margin) / 2.0, 0, 80)
    prob, home, away, sim_home, sim_away = probability_rows(raw_home, raw_away, residuals, seed)
    value = metrics(frame, home, away, prob, sim_home, sim_away)
    value["composite"] = composite(value)
    return value


def run(args: argparse.Namespace) -> dict[str, Any]:
    frames, checksums = read_sources(Path(args.source_dir))
    data = build_dataset(frames).replace([np.inf, -np.inf], np.nan)
    features = sorted(column for column in data.columns if column not in META_COLUMNS)
    data["actual_margin"] = data.home_score - data.away_score
    data["actual_total"] = data.home_score + data.away_score
    fit = data[data.season.isin(FIT_SEASONS)]
    selection = data[data.season == SELECTION_SEASON]
    Xfit, Xsel = fit[features], selection[features]
    y_margin_fit, y_total_fit = fit.actual_margin, fit.actual_total
    y_margin_sel, y_total_sel = selection.actual_margin.to_numpy(), selection.actual_total.to_numpy()

    margin_models: dict[str, Any] = {}
    total_models: dict[str, Any] = {}
    margin_selection: dict[str, np.ndarray] = {}
    total_selection: dict[str, np.ndarray] = {}
    calibrations: dict[str, dict[str, list[float]]] = {"margin": {}, "total": {}}
    for name, model in families(args.seed).items():
        model.fit(Xfit, y_margin_fit)
        pred = model.predict(Xsel)
        calibration = frozen_affine(pred, y_margin_sel)
        margin_models[name] = model
        margin_selection[name] = apply_affine(pred, calibration)
        calibrations["margin"][name] = list(calibration)
    for name, model in families(args.seed + 11).items():
        model.fit(Xfit, y_total_fit)
        pred = model.predict(Xsel)
        calibration = frozen_affine(pred, y_total_sel)
        total_models[name] = model
        total_selection[name] = apply_affine(pred, calibration)
        calibrations["total"][name] = list(calibration)

    fit_margin_base = margin_models["ridge"].predict(Xfit)
    fit_total_base = total_models["ridge"].predict(Xfit)
    fit_home = (fit_total_base + fit_margin_base) / 2.0
    fit_away = (fit_total_base - fit_margin_base) / 2.0
    residuals = np.column_stack([fit.home_score.to_numpy() - fit_home, fit.away_score.to_numpy() - fit_away])
    candidates: dict[str, dict[str, float]] = {}
    for margin_name, margin_pred in margin_selection.items():
        for total_name, total_pred in total_selection.items():
            key = f"margin={margin_name}::total={total_name}"
            candidates[key] = evaluate(selection, margin_pred, total_pred, residuals, args.seed)
    selected = min(candidates, key=lambda key: candidates[key]["composite"])
    margin_name = selected.split("::")[0].split("=")[1]
    total_name = selected.split("::")[1].split("=")[1]

    all_train = data[data.season <= SELECTION_SEASON]
    Xall = all_train[features]
    margin_model = families(args.seed)[margin_name]
    total_model = families(args.seed + 11)[total_name]
    margin_model.fit(Xall, all_train.actual_margin)
    total_model.fit(Xall, all_train.actual_total)
    margin_cal = tuple(calibrations["margin"][margin_name])
    total_cal = tuple(calibrations["total"][total_name])
    train_margin = apply_affine(margin_model.predict(Xall), margin_cal)
    train_total = apply_affine(total_model.predict(Xall), total_cal)
    train_home = (train_total + train_margin) / 2.0
    train_away = (train_total - train_margin) / 2.0
    residuals = np.column_stack([all_train.home_score.to_numpy() - train_home, all_train.away_score.to_numpy() - train_away])

    confirmation: dict[str, Any] = {}
    baseline: dict[str, Any] = {}
    for season in CONFIRMATION_SEASONS:
        test = data[data.season == season]
        margin = apply_affine(margin_model.predict(test[features]), margin_cal)
        total = apply_affine(total_model.predict(test[features]), total_cal)
        confirmation[str(season)] = evaluate(test, margin, total, residuals, args.seed + season)
        bhome, baway = baseline_predictions(all_train, test)
        baseline[str(season)] = evaluate(test, bhome-baway, bhome+baway, residuals, args.seed + season + 100)

    bhome, baway = baseline_predictions(fit, selection)
    selection_baseline = evaluate(selection, bhome-baway, bhome+baway, residuals, args.seed + 99)
    selection_improvement = (selection_baseline["composite"] - candidates[selected]["composite"]) / selection_baseline["composite"]
    gates = {
        "selection_improvement_2pct": selection_improvement >= 0.02,
        "confirmation_composite_stability": all(confirmation[str(s)]["composite"] <= baseline[str(s)]["composite"] * 1.02 for s in CONFIRMATION_SEASONS),
        "confirmation_component_breadth": all(sum(confirmation[str(s)][k] < baseline[str(s)][k] for k in ("team_score_mae", "margin_mae", "total_mae", "moneyline_brier", "total_interval_miss")) >= 3 for s in CONFIRMATION_SEASONS),
        "confirmation_ece": all(confirmation[str(s)]["moneyline_ece"] <= 0.08 for s in CONFIRMATION_SEASONS),
        "confirmation_bias": all(max(abs(confirmation[str(s)][k]) for k in ("home_bias", "away_bias", "margin_bias", "total_bias")) <= 2.5 for s in CONFIRMATION_SEASONS),
        "confirmation_dispersion": all(min(confirmation[str(s)]["team_score_pred_sd"] / confirmation[str(s)]["team_score_actual_sd"], confirmation[str(s)]["margin_pred_sd"] / confirmation[str(s)]["margin_actual_sd"], confirmation[str(s)]["total_pred_sd"] / confirmation[str(s)]["total_actual_sd"]) >= 0.70 for s in CONFIRMATION_SEASONS),
    }
    return {
        "release": RELEASE, "generatedAt": str(np.datetime64("now")),
        "chronology": {"fit": list(FIT_SEASONS), "selection": SELECTION_SEASON, "confirmation": list(CONFIRMATION_SEASONS), "confirmationStatus": "repeated_after_r1"},
        "sourceChecksums": checksums, "featureCount": len(features), "features": features,
        "selected": selected, "calibrations": {"margin": calibrations["margin"][margin_name], "total": calibrations["total"][total_name]},
        "selectionCandidates": candidates, "selectionBaseline": selection_baseline, "selectionImprovement": selection_improvement,
        "confirmation": confirmation, "confirmationBaseline": baseline, "gates": gates, "promotable": all(gates.values()),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="football-research/cache/cfb-model/source")
    parser.add_argument("--output", default="football-research/reports/cfb_v1_direct_margin_total_2026_08_25_r2.json")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()
    report = run(args)
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"output": str(output), "selected": report["selected"], "calibrations": report["calibrations"], "gates": report["gates"], "promotable": report["promotable"]}, indent=2))


if __name__ == "__main__":
    main()
