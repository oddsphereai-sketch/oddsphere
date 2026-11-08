#!/usr/bin/env python3
"""Independent NFL longest-rush extreme-value tournament."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import tournament_nfl_player_props_passing_touchdowns as common


RELEASE = "nfl_player_props_longest_rush_tournament_2026_10_15_r1"
LINES = (9.5, 14.5, 19.5, 24.5, 29.5)
PBP_COLUMNS = [
    "season", "week", "game_id", "posteam", "rusher_player_id", "rusher_player_name", "rushing_yards",
    "rush_attempt", "qb_kneel", "qb_spike", "aborted_play",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--historical-root", type=Path, required=True)
    parser.add_argument("--current-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    cli = parse_args()
    features = pd.read_parquet(cli.features)
    pbp = common.load_years(
        cli.historical_root, cli.current_root, "pbp", range(2016, 2027), columns=PBP_COLUMNS
    )
    frame = build_frame(features, pbp)
    train = frame[(frame["season"] >= 2017) & (frame["season"] <= 2024)].copy()
    validation = frame[frame["season"] == 2025].copy()
    current = frame[(frame["season"] == 2026) & frame["week"].between(2, 5)].copy()
    captured = current[current["game_id"].isin(common.CAPTURED_GAMES)].copy()
    columns = model_features(frame)

    train_foundation = foundation_projection(train)
    validation_predictions = {"foundation": foundation_projection(validation)}
    validation_sigmas = {"foundation": log_sigma(train["longest_rush"].to_numpy(float), train_foundation)}
    trained = fit_models(train, columns)
    for name, model in trained.items():
        validation_predictions[name] = predict(model, validation[columns])
        validation_sigmas[name] = log_sigma(train["longest_rush"].to_numpy(float), predict(model, train[columns]))
    validation_metrics = {
        name: metrics(validation["longest_rush"].to_numpy(float), values, validation_sigmas[name])
        for name, values in validation_predictions.items()
    }
    selected = sorted(["ridge_log", "hgb_log"], key=lambda name: (
        validation_metrics[name]["mae"], validation_metrics[name]["rmse"],
        validation_metrics[name]["averageThresholdBrier"], name,
    ))[0]

    final_models = fit_models(pd.concat([train, validation], ignore_index=True), columns)
    current_predictions = {
        "foundation": foundation_projection(current),
        selected: predict(final_models[selected], current[columns]),
    }
    captured_predictions = {
        "foundation": foundation_projection(captured),
        selected: predict(final_models[selected], captured[columns]),
    }
    final_sigmas = {
        name: log_sigma(validation["longest_rush"].to_numpy(float), validation_predictions[name])
        for name in ("foundation", selected)
    }
    current_metrics = {
        name: metrics(current["longest_rush"].to_numpy(float), values, final_sigmas[name])
        for name, values in current_predictions.items()
    }
    captured_metrics = {
        name: metrics(captured["longest_rush"].to_numpy(float), values, final_sigmas[name])
        for name, values in captured_predictions.items()
    }
    gate = advancement_gate(current_metrics["foundation"], current_metrics[selected])
    rows = []
    current = current.reset_index(drop=True)
    for index, row in current.iterrows():
        rows.append({
            "season": int(row["season"]), "week": int(row["week"]), "gameId": row["game_id"],
            "playerId": row["player_id"], "playerName": row["player_name"], "position": row["position"],
            "team": row["team"], "opponent": row["opponent"], "actualLongestRush": float(row["longest_rush"]),
            "capturedGame": bool(row["game_id"] in common.CAPTURED_GAMES),
            "projections": {name: float(values[index]) for name, values in current_predictions.items()},
        })
    result = {
        "release": RELEASE,
        "readOnly": True,
        "productionWrites": 0,
        "marketFeatures": [],
        "marketOfferRows": 0,
        "modelSelectionSeason": 2025,
        "primaryEvaluation": {"season": 2026, "weeks": [2, 3, 4, 5]},
        "capturedGameIds": sorted(common.CAPTURED_GAMES),
        "data": {
            "trainRows": len(train), "validationRows": len(validation), "currentSeasonRows": len(current),
            "capturedGameRows": len(captured), "featureCount": len(columns),
        },
        "features": columns,
        "validation2025": validation_metrics,
        "selection": {"winner": selected, "criterion": "minimum 2025 MAE; RMSE then Brier"},
        "probabilityResidualLogSigma": final_sigmas,
        "currentSeason2026Weeks2To5": current_metrics,
        "currentSeasonPairedGameBootstrap95": paired_bootstrap(
            current["longest_rush"].to_numpy(float), current_predictions["foundation"],
            current_predictions[selected], final_sigmas, current["game_id"].astype(str).to_numpy(), selected,
        ),
        "capturedWeek5Games": captured_metrics,
        "advancement": {
            **gate,
            "productionAuthorized": False,
            "reason": "No release-pure Longest Rush offers/prices were retained for economic evaluation."
            if gate["accuracyGatePass"] else "The selected model did not clear every current-season accuracy gate.",
        },
        "limitations": [
            "No release-pure Longest Rush offers or prices were retained in the private archive/observer.",
            "Threshold probabilities use a homoscedastic normal residual on log(1 + longest rush).",
            "Eligible players are a pregame role proxy, not the exact unavailable sportsbook offer universe.",
        ],
        "capturedRows": [row for row in rows if row["capturedGame"]],
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE, "selection": result["selection"], "validation2025": validation_metrics,
        "currentSeason2026Weeks2To5": current_metrics,
        "bootstrap": result["currentSeasonPairedGameBootstrap95"],
        "capturedWeek5Games": captured_metrics, "advancement": result["advancement"],
        "capturedRows": result["capturedRows"],
    }, indent=2))


def build_frame(features: pd.DataFrame, pbp: pd.DataFrame) -> pd.DataFrame:
    pbp = pbp[
        pd.to_numeric(pbp["rush_attempt"], errors="coerce").fillna(0).eq(1)
        & ~pd.to_numeric(pbp["qb_kneel"], errors="coerce").fillna(0).eq(1)
        & ~pd.to_numeric(pbp["qb_spike"], errors="coerce").fillna(0).eq(1)
        & ~pd.to_numeric(pbp["aborted_play"], errors="coerce").fillna(0).eq(1)
        & pbp["rusher_player_id"].notna()
    ].copy()
    pbp["rushing_yards"] = pd.to_numeric(pbp["rushing_yards"], errors="coerce").fillna(0)
    outcomes = pbp.groupby(
        ["season", "week", "game_id", "posteam", "rusher_player_id"], as_index=False
    ).agg(
        longest_rush=("rushing_yards", "max"), rushes=("rushing_yards", "size"),
        explosive_10=("rushing_yards", lambda values: values.ge(10).sum()),
        explosive_20=("rushing_yards", lambda values: values.ge(20).sum()),
    ).rename(columns={"posteam": "team", "rusher_player_id": "player_id"})
    history = longest_history(outcomes)
    frame = features[
        features["position"].isin(["RB", "QB", "WR"]) & features["player_id"].notna()
    ].copy()
    frame = frame.merge(
        outcomes[["season", "week", "game_id", "player_id", "longest_rush", "rushes"]],
        on=["season", "week", "game_id", "player_id"], how="left",
    ).merge(history, on=["season", "week", "game_id", "player_id"], how="left")
    frame["longest_rush"] = pd.to_numeric(frame["longest_rush"], errors="coerce").fillna(0).clip(lower=0)
    prior_avg3 = pd.to_numeric(frame["prior_rushing_attempts_avg3"], errors="coerce").fillna(0)
    prior_ewm = pd.to_numeric(frame["prior_rushing_attempts_ewm"], errors="coerce").fillna(0)
    role_eligible = prior_avg3.ge(1.5) | prior_ewm.ge(1.5)
    participated = pd.to_numeric(frame["participated"], errors="coerce").fillna(0).eq(1)
    return frame[role_eligible & participated].sort_values(
        ["season", "week", "game_id", "team", "player_id"]
    ).reset_index(drop=True)


def longest_history(outcomes: pd.DataFrame) -> pd.DataFrame:
    frame = outcomes.sort_values(["player_id", "season", "week", "game_id"]).copy()
    for window in (3, 5):
        for column in ("longest_rush", "rushes"):
            frame[f"prior_{column}_avg{window}"] = common.grouped_rolling(
                frame, "player_id", column, window, "mean"
            )
        explosive = common.grouped_rolling(frame, "player_id", "explosive_10", window, "sum")
        rushes = common.grouped_rolling(frame, "player_id", "rushes", window, "sum")
        frame[f"prior_explosive_10_rate{window}"] = common.shrunk_rate(explosive, rushes, 0.10, 15)
        explosive20 = common.grouped_rolling(frame, "player_id", "explosive_20", window, "sum")
        frame[f"prior_explosive_20_rate{window}"] = common.shrunk_rate(explosive20, rushes, 0.035, 20)
    frame["prior_longest_rush_ewm"] = frame.groupby("player_id", sort=False)["longest_rush"].transform(
        lambda values: values.shift().ewm(alpha=0.4, adjust=False).mean()
    )
    columns = [column for column in frame if column.startswith("prior_")]
    return frame[["season", "week", "game_id", "player_id", *columns]]


def model_features(frame: pd.DataFrame) -> list[str]:
    requested = [
        "prior_longest_rush_avg3", "prior_longest_rush_avg5", "prior_longest_rush_ewm",
        "prior_rushes_avg3", "prior_rushes_avg5", "prior_explosive_10_rate3", "prior_explosive_10_rate5",
        "prior_explosive_20_rate3", "prior_explosive_20_rate5",
        "prior_rushing_attempts_avg3", "prior_rushing_attempts_avg5", "prior_rushing_attempts_ewm",
        "prior_rushing_yards_avg3", "prior_rushing_yards_avg5", "prior_rushing_yards_ewm",
        "prior_rush_attempt_share_avg3", "prior_rush_attempt_share_ewm",
        "prior_team_rush_attempts_avg3", "prior_team_rushing_yards_avg3",
        "prior_opponent_allowed_rush_attempts_avg3", "prior_opponent_allowed_rushing_yards_avg3",
        "matchup_position_opponent_allowed_rushing_attempts_avg3",
        "matchup_position_opponent_allowed_rushing_yards_avg3",
        "external_state_team_rush_rate_avg3", "external_state_team_plays_avg3",
        "external_state_opponent_allowed_rush_rate_avg3", "external_state_opponent_allowed_plays_avg3",
        "external_ngs_rushing_efficiency_ewm", "external_ngs_rushing_percent_attempts_gte_eight_defenders_ewm",
        "external_ngs_rushing_avg_time_to_los_ewm", "external_ngs_rushing_expected_rush_yards_per_att_ewm",
        "external_ngs_rushing_rush_yards_over_expected_per_att_ewm",
        "external_ngs_rushing_rush_pct_over_expected_ewm",
        "external_pfr_rush_rushing_yards_before_contact_avg_ewm",
        "external_pfr_rush_rushing_yards_after_contact_avg_ewm",
        "external_pfr_rush_rushing_broken_tackles_ewm",
        "external_ftn_rusher_n_defense_box_ewm", "external_ftn_rusher_is_motion_ewm",
        "external_ftn_rusher_is_rpo_ewm", "external_ftn_rusher_is_qb_sneak_ewm",
        "prior_offense_snap_pct_avg3", "prior_participated_avg3", "external_depth_starter",
        "external_environment_temperature_f", "external_environment_wind_mph",
        "external_environment_outdoor", "external_environment_fixed_roof", "is_home",
    ]
    return [column for column in requested if column in frame]


def foundation_projection(frame: pd.DataFrame) -> np.ndarray:
    fallback = frame["position"].map({"RB": 12.0, "QB": 8.0, "WR": 9.0}).fillna(10.0).to_numpy(float)
    history = frame[[column for column in (
        "prior_longest_rush_avg3", "prior_longest_rush_avg5", "prior_longest_rush_ewm"
    ) if column in frame]].apply(pd.to_numeric, errors="coerce").mean(axis=1).to_numpy(float)
    history = np.where(np.isfinite(history), history, fallback)
    projected_attempts = common.row_mean(
        frame, ["prior_rushing_attempts_avg3", "prior_rushing_attempts_ewm"], fallback=4.0
    )
    previous_attempts = common.row_mean(frame, ["prior_rushes_avg3", "prior_rushes_avg5"], fallback=4.0)
    opportunity = np.clip(np.sqrt((projected_attempts + 1) / (previous_attempts + 1)), 0.75, 1.30)
    return np.clip(history * opportunity, 0.0, 80.0)


def fit_models(frame: pd.DataFrame, columns: list[str]):
    x = frame[columns]
    y = np.log1p(frame["longest_rush"].to_numpy(float))
    ridge = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()), ("model", Ridge(alpha=30.0)),
    ])
    hgb = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", HistGradientBoostingRegressor(
            loss="squared_error", learning_rate=0.035, max_iter=250, max_leaf_nodes=15,
            max_depth=4, min_samples_leaf=60, l2_regularization=15.0, random_state=20261015,
        )),
    ])
    ridge.fit(x, y)
    hgb.fit(x, y)
    return {"ridge_log": ridge, "hgb_log": hgb}


def predict(model, x) -> np.ndarray:
    return np.clip(np.expm1(model.predict(x)), 0.0, 80.0)


def log_sigma(actual, prediction) -> float:
    residual = np.log1p(actual) - np.log1p(np.clip(prediction, 0, None))
    return float(max(np.std(residual, ddof=1), 0.15))


def metrics(actual, prediction, sigma, lines=LINES):
    threshold = {}
    location = np.log1p(np.clip(prediction, 0, None))
    for line in lines:
        probability = norm.sf(np.log1p(line), loc=location, scale=sigma)
        observed = (actual > line).astype(float)
        threshold[str(line)] = {
            "brier": float(np.mean(np.square(probability - observed))),
            "observedRate": float(np.mean(observed)), "meanProbability": float(np.mean(probability)),
        }
    return {
        "rows": len(actual), "meanActual": float(np.mean(actual)), "meanProjection": float(np.mean(prediction)),
        "mae": float(np.mean(np.abs(actual - prediction))),
        "rmse": float(math.sqrt(np.mean(np.square(actual - prediction)))),
        "averageThresholdBrier": float(np.mean([value["brier"] for value in threshold.values()])),
        "thresholds": threshold,
    }


def advancement_gate(foundation, candidate, lines=LINES):
    wins = sum(candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"] for line in lines)
    return {
        "accuracyGatePass": candidate["mae"] < foundation["mae"] and candidate["rmse"] < foundation["rmse"]
        and candidate["averageThresholdBrier"] < foundation["averageThresholdBrier"] and wins >= 4,
        "thresholdBrierWins": wins,
    }


def paired_bootstrap(actual, foundation, candidate, sigmas, clusters, selected, lines=LINES, iterations=2_000):
    unique = np.unique(clusters)
    indices = {cluster: np.flatnonzero(clusters == cluster) for cluster in unique}
    rng = np.random.default_rng(20261015)
    samples = {"maeDelta": [], "rmseDelta": [], "averageThresholdBrierDelta": []}
    for _ in range(iterations):
        chosen = rng.choice(unique, size=len(unique), replace=True)
        take = np.concatenate([indices[cluster] for cluster in chosen])
        base = metrics(actual[take], foundation[take], sigmas["foundation"], lines)
        cand = metrics(actual[take], candidate[take], sigmas[selected], lines)
        samples["maeDelta"].append(cand["mae"] - base["mae"])
        samples["rmseDelta"].append(cand["rmse"] - base["rmse"])
        samples["averageThresholdBrierDelta"].append(cand["averageThresholdBrier"] - base["averageThresholdBrier"])
    return {
        "clusters": len(unique), "iterations": iterations,
        "deltaDefinition": "candidate minus foundation; negative favors candidate",
        **{name: common.interval(values) for name, values in samples.items()},
    }


if __name__ == "__main__":
    main()
