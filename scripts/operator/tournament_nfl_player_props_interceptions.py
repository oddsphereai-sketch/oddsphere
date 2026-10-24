#!/usr/bin/env python3
"""Independent NFL quarterback-interception count-model tournament."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import PoissonRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import tournament_nfl_player_props_passing_touchdowns as common


RELEASE = "nfl_player_props_interceptions_tournament_2026_10_15_r1"


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
    stats = common.load_years(cli.historical_root, cli.current_root, "player_stats", range(2016, 2027))
    frame = build_frame(features, stats)
    train = frame[(frame["season"] >= 2017) & (frame["season"] <= 2024)].copy()
    validation = frame[frame["season"] == 2025].copy()
    current = frame[(frame["season"] == 2026) & frame["week"].between(2, 5)].copy()
    captured = current[current["game_id"].isin(common.CAPTURED_GAMES)].copy()
    if len(captured) != 4:
        raise RuntimeError(f"Expected four captured-game quarterbacks; found {len(captured)}")
    columns = model_features(frame)

    validation_predictions = {"foundation": foundation_mean(validation)}
    validation_models = fit_models(train, columns)
    for name, model in validation_models.items():
        validation_predictions[name] = common.clipped(model.predict(validation[columns]))
    validation_metrics = {
        name: common.metrics(validation["passing_interceptions"].to_numpy(float), prediction)
        for name, prediction in validation_predictions.items()
    }
    selected = sorted(["poisson_glm", "poisson_hgb"], key=lambda name: (
        validation_metrics[name]["meanPoissonDeviance"],
        validation_metrics[name]["averageThresholdBrier"],
        validation_metrics[name]["mae"],
        name,
    ))[0]

    final_models = fit_models(pd.concat([train, validation], ignore_index=True), columns)
    current_predictions = {"foundation": foundation_mean(current)}
    captured_predictions = {"foundation": foundation_mean(captured)}
    for name, model in final_models.items():
        current_predictions[name] = common.clipped(model.predict(current[columns]))
        captured_predictions[name] = common.clipped(model.predict(captured[columns]))
    current_metrics = {
        name: common.metrics(current["passing_interceptions"].to_numpy(float), prediction)
        for name, prediction in current_predictions.items()
    }
    captured_metrics = {
        name: common.metrics(captured["passing_interceptions"].to_numpy(float), prediction)
        for name, prediction in captured_predictions.items()
    }
    gate = common.advancement_gate(
        current_metrics["foundation"], current_metrics[selected], captured_metrics[selected]
    )
    rows = []
    current = current.reset_index(drop=True)
    for index, row in current.iterrows():
        rows.append({
            "season": int(row["season"]), "week": int(row["week"]), "gameId": row["game_id"],
            "playerId": row["player_id"], "playerName": row["player_name"], "team": row["team"],
            "opponent": row["opponent"], "actualInterceptions": int(row["passing_interceptions"]),
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
        "selection": {"winner": selected, "criterion": "minimum 2025 mean Poisson deviance; Brier then MAE"},
        "currentSeason2026Weeks2To5": current_metrics,
        "currentSeasonPairedGameBootstrap95": common.paired_game_bootstrap(
            current["passing_interceptions"].to_numpy(float), current_predictions["foundation"],
            current_predictions[selected], current["game_id"].astype(str).to_numpy(),
        ),
        "capturedWeek5Games": captured_metrics,
        "dispersion": common.dispersion_audit(
            current["passing_interceptions"].to_numpy(float), current_predictions[selected]
        ),
        "advancement": gate,
        "limitations": [
            "No release-pure interception offers or prices were retained in the Week 5 archive/observer.",
            "The OddSphere archived-game slice contains four quarterbacks.",
            "Weeks 1-4 have official outcomes but no complete private-board economic replay.",
        ],
        "capturedRows": [row for row in rows if row["capturedGame"]],
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE, "selection": result["selection"], "validation2025": validation_metrics,
        "currentSeason2026Weeks2To5": current_metrics, "bootstrap": result["currentSeasonPairedGameBootstrap95"],
        "capturedWeek5Games": captured_metrics, "advancement": gate, "capturedRows": result["capturedRows"],
    }, indent=2))


def build_frame(features: pd.DataFrame, stats: pd.DataFrame) -> pd.DataFrame:
    features = features[(features["position"] == "QB") & features["player_id"].notna()].copy()
    stats = stats[(stats["position"] == "QB") & (pd.to_numeric(stats["attempts"], errors="coerce") > 0)].copy()
    stats = stats[[
        "season", "week", "game_id", "player_id", "team", "opponent_team", "attempts",
        "passing_interceptions",
    ]].drop_duplicates(["season", "week", "game_id", "player_id"])
    history = interception_history(stats)
    frame = features.merge(
        stats[["season", "week", "game_id", "player_id", "passing_interceptions", "attempts"]],
        on=["season", "week", "game_id", "player_id"], how="inner", suffixes=("", "_actual"),
    ).merge(history, on=["season", "week", "game_id", "player_id"], how="left")
    starter = pd.to_numeric(frame.get("external_depth_starter"), errors="coerce").fillna(0).eq(1)
    prior_avg3 = pd.to_numeric(frame["prior_passing_attempts_avg3"], errors="coerce").fillna(0)
    prior_ewm = pd.to_numeric(frame["prior_passing_attempts_ewm"], errors="coerce").fillna(0)
    return frame[starter | prior_avg3.ge(12) | prior_ewm.ge(12)].sort_values(
        ["season", "week", "game_id", "team", "player_id"]
    ).reset_index(drop=True)


def interception_history(stats: pd.DataFrame) -> pd.DataFrame:
    stats = stats.sort_values(["player_id", "season", "week", "game_id"]).copy()
    for window in (3, 5):
        stats[f"prior_qb_interceptions_avg{window}"] = common.grouped_rolling(
            stats, "player_id", "passing_interceptions", window, "mean"
        )
        prior_interceptions = common.grouped_rolling(
            stats, "player_id", "passing_interceptions", window, "sum"
        )
        prior_attempts = common.grouped_rolling(stats, "player_id", "attempts", window, "sum")
        stats[f"prior_qb_interception_rate{window}"] = common.shrunk_rate(
            prior_interceptions, prior_attempts, 0.023, 100
        )
    stats["prior_qb_interceptions_ewm"] = stats.groupby("player_id", sort=False)["passing_interceptions"].transform(
        lambda values: values.shift().ewm(alpha=0.4, adjust=False).mean()
    )
    team = stats.groupby(["season", "week", "game_id", "team", "opponent_team"], as_index=False).agg(
        team_interceptions=("passing_interceptions", "sum"), team_pass_attempts=("attempts", "sum")
    ).sort_values(["season", "team", "week", "game_id"])
    offense = team_rate_history(team, "team", "prior_team")
    defense_base = team.rename(columns={"team": "offense", "opponent_team": "team"})
    defense = team_rate_history(defense_base, "team", "prior_opponent_induced").rename(
        columns={"offense": "opponent_team"}
    )
    keys = ["season", "week", "game_id", "team"]
    result = stats[[
        "season", "week", "game_id", "player_id", "team", "opponent_team",
        "prior_qb_interceptions_avg3", "prior_qb_interceptions_avg5", "prior_qb_interceptions_ewm",
        "prior_qb_interception_rate3", "prior_qb_interception_rate5",
    ]]
    result = result.merge(offense.drop(columns=["opponent_team"]), on=keys, how="left")
    result = result.merge(
        defense.drop(columns=["team"]).rename(columns={"opponent_team": "team"}), on=keys, how="left"
    )
    return result.drop(columns=["team", "opponent_team"])


def team_rate_history(frame: pd.DataFrame, group: str, prefix: str) -> pd.DataFrame:
    frame = frame.sort_values(["season", group, "week", "game_id"]).copy()
    for window in (3, 5):
        interceptions = frame.groupby(["season", group], sort=False)["team_interceptions"].transform(
            lambda values: values.shift().rolling(window, min_periods=1).sum()
        )
        attempts = frame.groupby(["season", group], sort=False)["team_pass_attempts"].transform(
            lambda values: values.shift().rolling(window, min_periods=1).sum()
        )
        frame[f"{prefix}_interceptions_avg{window}"] = frame.groupby(
            ["season", group], sort=False
        )["team_interceptions"].transform(lambda values: values.shift().rolling(window, min_periods=1).mean())
        frame[f"{prefix}_interception_rate{window}"] = common.shrunk_rate(interceptions, attempts, 0.023, 150)
    return frame.drop(columns=["team_interceptions", "team_pass_attempts"])


def model_features(frame: pd.DataFrame) -> list[str]:
    requested = [
        "prior_passing_attempts_avg3", "prior_passing_attempts_avg5", "prior_passing_attempts_ewm",
        "prior_passing_completions_avg3", "prior_passing_completions_ewm",
        "prior_passing_yards_avg3", "prior_passing_yards_ewm",
        "prior_qb_interceptions_avg3", "prior_qb_interceptions_avg5", "prior_qb_interceptions_ewm",
        "prior_qb_interception_rate3", "prior_qb_interception_rate5",
        "prior_team_interceptions_avg3", "prior_team_interceptions_avg5",
        "prior_team_interception_rate3", "prior_team_interception_rate5",
        "prior_opponent_induced_interceptions_avg3", "prior_opponent_induced_interceptions_avg5",
        "prior_opponent_induced_interception_rate3", "prior_opponent_induced_interception_rate5",
        "prior_team_pass_attempts_avg3", "prior_team_pass_attempts_ewm",
        "prior_opponent_allowed_pass_attempts_avg3", "prior_opponent_allowed_pass_attempts_ewm",
        "external_state_team_plays_avg3", "external_state_team_dropback_rate_avg3",
        "external_state_team_pass_oe_avg3", "external_state_team_neutral_pass_rate_avg3",
        "external_state_team_no_huddle_rate_avg3", "external_state_team_shotgun_rate_avg3",
        "external_state_team_scramble_rate_avg3", "external_state_team_sack_rate_avg3",
        "external_state_team_air_yards_per_attempt_avg3",
        "external_state_opponent_allowed_plays_avg3", "external_state_opponent_allowed_dropback_rate_avg3",
        "external_state_opponent_allowed_pass_oe_avg3", "external_state_opponent_allowed_qb_hit_rate_avg3",
        "external_state_opponent_allowed_sack_rate_avg3", "external_state_opponent_allowed_air_yards_per_attempt_avg3",
        "external_ngs_passing_avg_time_to_throw_ewm", "external_ngs_passing_avg_intended_air_yards_ewm",
        "external_ngs_passing_aggressiveness_ewm",
        "external_ngs_passing_completion_percentage_above_expectation_ewm",
        "external_pfr_pass_times_blitzed_ewm", "external_pfr_pass_times_pressured_pct_ewm",
        "external_pfr_pass_passing_bad_throw_pct_ewm", "external_pfr_pass_times_hit_ewm",
        "external_environment_temperature_f", "external_environment_wind_mph", "external_environment_outdoor",
        "is_home", "external_depth_starter",
    ]
    return [column for column in requested if column in frame]


def foundation_mean(frame: pd.DataFrame) -> np.ndarray:
    attempts = common.row_mean(frame, [
        "prior_passing_attempts_avg3", "prior_passing_attempts_ewm", "prior_team_pass_attempts_avg3",
        "prior_team_pass_attempts_ewm", "prior_opponent_allowed_pass_attempts_avg3",
        "prior_opponent_allowed_pass_attempts_ewm",
    ], fallback=31.5)
    quarterback = common.row_mean(
        frame, ["prior_qb_interception_rate3", "prior_qb_interception_rate5"], fallback=0.023
    )
    team = common.row_mean(
        frame, ["prior_team_interception_rate3", "prior_team_interception_rate5"], fallback=0.023
    )
    opponent = common.row_mean(frame, [
        "prior_opponent_induced_interception_rate3", "prior_opponent_induced_interception_rate5",
    ], fallback=0.023)
    return common.clipped(attempts * (0.50 * quarterback + 0.25 * team + 0.25 * opponent))


def fit_models(frame: pd.DataFrame, columns: list[str]):
    x = frame[columns]
    y = frame["passing_interceptions"].to_numpy(float)
    glm = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", PoissonRegressor(alpha=4.0, max_iter=2_000, tol=1e-7)),
    ])
    hgb = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", HistGradientBoostingRegressor(
            loss="poisson", learning_rate=0.035, max_iter=250, max_leaf_nodes=15,
            max_depth=4, min_samples_leaf=60, l2_regularization=12.0, random_state=20261015,
        )),
    ])
    glm.fit(x, y)
    hgb.fit(x, y)
    return {"poisson_glm": glm, "poisson_hgb": hgb}


if __name__ == "__main__":
    main()
