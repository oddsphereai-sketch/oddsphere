#!/usr/bin/env python3
"""Independent NFL longest-pass extreme-value tournament."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_longest_rush as extreme
import tournament_nfl_player_props_passing_touchdowns as common


RELEASE = "nfl_player_props_longest_pass_tournament_2026_10_15_r1"
LINES = (29.5, 34.5, 39.5, 44.5, 49.5)
PBP_COLUMNS = [
    "season", "week", "game_id", "posteam", "passer_player_id", "passer_player_name", "passing_yards",
    "pass_attempt", "complete_pass", "qb_spike", "aborted_play",
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
    if len(captured) != 4:
        raise RuntimeError(f"Expected four captured quarterbacks; found {len(captured)}")
    columns = model_features(frame)

    train_foundation = foundation_projection(train)
    validation_predictions = {"foundation": foundation_projection(validation)}
    validation_sigmas = {"foundation": extreme.log_sigma(train["longest_pass"].to_numpy(float), train_foundation)}
    trained = extreme.fit_models(rename_target(train), columns)
    for name, model in trained.items():
        validation_predictions[name] = extreme.predict(model, validation[columns])
        validation_sigmas[name] = extreme.log_sigma(
            train["longest_pass"].to_numpy(float), extreme.predict(model, train[columns])
        )
    validation_metrics = {
        name: extreme.metrics(validation["longest_pass"].to_numpy(float), values, validation_sigmas[name], LINES)
        for name, values in validation_predictions.items()
    }
    selected = sorted(["ridge_log", "hgb_log"], key=lambda name: (
        validation_metrics[name]["mae"], validation_metrics[name]["rmse"],
        validation_metrics[name]["averageThresholdBrier"], name,
    ))[0]

    final_models = extreme.fit_models(rename_target(pd.concat([train, validation], ignore_index=True)), columns)
    current_predictions = {
        "foundation": foundation_projection(current), selected: extreme.predict(final_models[selected], current[columns]),
    }
    captured_predictions = {
        "foundation": foundation_projection(captured), selected: extreme.predict(final_models[selected], captured[columns]),
    }
    final_sigmas = {
        name: extreme.log_sigma(validation["longest_pass"].to_numpy(float), validation_predictions[name])
        for name in ("foundation", selected)
    }
    current_metrics = {
        name: extreme.metrics(current["longest_pass"].to_numpy(float), values, final_sigmas[name], LINES)
        for name, values in current_predictions.items()
    }
    captured_metrics = {
        name: extreme.metrics(captured["longest_pass"].to_numpy(float), values, final_sigmas[name], LINES)
        for name, values in captured_predictions.items()
    }
    gate = extreme.advancement_gate(current_metrics["foundation"], current_metrics[selected], LINES)
    rows = []
    current = current.reset_index(drop=True)
    for index, row in current.iterrows():
        rows.append({
            "season": int(row["season"]), "week": int(row["week"]), "gameId": row["game_id"],
            "playerId": row["player_id"], "playerName": row["player_name"], "team": row["team"],
            "opponent": row["opponent"], "actualLongestPass": float(row["longest_pass"]),
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
        "currentSeasonPairedGameBootstrap95": extreme.paired_bootstrap(
            current["longest_pass"].to_numpy(float), current_predictions["foundation"], current_predictions[selected],
            final_sigmas, current["game_id"].astype(str).to_numpy(), selected, LINES,
        ),
        "capturedWeek5Games": captured_metrics,
        "advancement": {
            **gate,
            "productionAuthorized": False,
            "reason": "No release-pure Longest Pass offers/prices were retained for economic evaluation."
            if gate["accuracyGatePass"] else "The selected model did not clear every current-season accuracy gate.",
        },
        "limitations": [
            "No release-pure Longest Pass offers or prices were retained in the private archive/observer.",
            "Threshold probabilities use a homoscedastic normal residual on log(1 + longest pass).",
            "Receiver-route participation is absent; retained team air-yards/YAC and QB context are used instead.",
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
        pd.to_numeric(pbp["complete_pass"], errors="coerce").fillna(0).eq(1)
        & ~pd.to_numeric(pbp["qb_spike"], errors="coerce").fillna(0).eq(1)
        & ~pd.to_numeric(pbp["aborted_play"], errors="coerce").fillna(0).eq(1)
        & pbp["passer_player_id"].notna()
    ].copy()
    pbp["passing_yards"] = pd.to_numeric(pbp["passing_yards"], errors="coerce").fillna(0)
    outcomes = pbp.groupby(
        ["season", "week", "game_id", "posteam", "passer_player_id"], as_index=False
    ).agg(
        longest_pass=("passing_yards", "max"), completions=("passing_yards", "size"),
        explosive_20=("passing_yards", lambda values: values.ge(20).sum()),
        explosive_40=("passing_yards", lambda values: values.ge(40).sum()),
    ).rename(columns={"posteam": "team", "passer_player_id": "player_id"})
    history = longest_history(outcomes)
    frame = features[(features["position"] == "QB") & features["player_id"].notna()].copy()
    frame = frame.merge(
        outcomes[["season", "week", "game_id", "player_id", "longest_pass", "completions"]],
        on=["season", "week", "game_id", "player_id"], how="left",
    ).merge(history, on=["season", "week", "game_id", "player_id"], how="left")
    frame["longest_pass"] = pd.to_numeric(frame["longest_pass"], errors="coerce").fillna(0).clip(lower=0)
    prior_avg3 = pd.to_numeric(frame["prior_passing_attempts_avg3"], errors="coerce").fillna(0)
    prior_ewm = pd.to_numeric(frame["prior_passing_attempts_ewm"], errors="coerce").fillna(0)
    starter = pd.to_numeric(frame["external_depth_starter"], errors="coerce").fillna(0).eq(1)
    participated = pd.to_numeric(frame["participated"], errors="coerce").fillna(0).eq(1)
    return frame[(starter | prior_avg3.ge(12) | prior_ewm.ge(12)) & participated].sort_values(
        ["season", "week", "game_id", "team", "player_id"]
    ).reset_index(drop=True)


def longest_history(outcomes: pd.DataFrame) -> pd.DataFrame:
    frame = outcomes.sort_values(["player_id", "season", "week", "game_id"]).copy()
    for window in (3, 5):
        for column in ("longest_pass", "completions"):
            frame[f"prior_{column}_avg{window}"] = common.grouped_rolling(
                frame, "player_id", column, window, "mean"
            )
        completions = common.grouped_rolling(frame, "player_id", "completions", window, "sum")
        explosive20 = common.grouped_rolling(frame, "player_id", "explosive_20", window, "sum")
        explosive40 = common.grouped_rolling(frame, "player_id", "explosive_40", window, "sum")
        frame[f"prior_explosive_20_rate{window}"] = common.shrunk_rate(explosive20, completions, 0.07, 40)
        frame[f"prior_explosive_40_rate{window}"] = common.shrunk_rate(explosive40, completions, 0.015, 60)
    frame["prior_longest_pass_ewm"] = frame.groupby("player_id", sort=False)["longest_pass"].transform(
        lambda values: values.shift().ewm(alpha=0.4, adjust=False).mean()
    )
    columns = [column for column in frame if column.startswith("prior_")]
    return frame[["season", "week", "game_id", "player_id", *columns]]


def model_features(frame: pd.DataFrame) -> list[str]:
    requested = [
        "prior_longest_pass_avg3", "prior_longest_pass_avg5", "prior_longest_pass_ewm",
        "prior_completions_avg3", "prior_completions_avg5", "prior_explosive_20_rate3",
        "prior_explosive_20_rate5", "prior_explosive_40_rate3", "prior_explosive_40_rate5",
        "prior_passing_attempts_avg3", "prior_passing_attempts_avg5", "prior_passing_attempts_ewm",
        "prior_passing_completions_avg3", "prior_passing_completions_ewm",
        "prior_passing_yards_avg3", "prior_passing_yards_ewm",
        "prior_team_pass_attempts_avg3", "prior_team_passing_yards_avg3",
        "prior_opponent_allowed_pass_attempts_avg3", "prior_opponent_allowed_passing_yards_avg3",
        "matchup_position_opponent_allowed_passing_yards_avg3",
        "external_state_team_dropback_rate_avg3", "external_state_team_air_yards_per_attempt_avg3",
        "external_state_team_xyac_per_completion_avg3", "external_state_team_pass_oe_avg3",
        "external_state_opponent_allowed_dropback_rate_avg3",
        "external_state_opponent_allowed_air_yards_per_attempt_avg3",
        "external_state_opponent_allowed_xyac_per_completion_avg3",
        "external_state_opponent_allowed_qb_hit_rate_avg3", "external_state_opponent_allowed_sack_rate_avg3",
        "external_ngs_passing_avg_time_to_throw_ewm", "external_ngs_passing_avg_completed_air_yards_ewm",
        "external_ngs_passing_avg_intended_air_yards_ewm", "external_ngs_passing_aggressiveness_ewm",
        "external_ngs_passing_avg_air_yards_to_sticks_ewm",
        "external_ngs_passing_completion_percentage_above_expectation_ewm",
        "external_pfr_pass_passing_bad_throw_pct_ewm", "external_pfr_pass_times_blitzed_ewm",
        "external_pfr_pass_times_pressured_pct_ewm", "external_pfr_pass_times_hit_ewm",
        "external_ftn_passer_is_play_action_ewm", "external_ftn_passer_is_screen_pass_ewm",
        "external_ftn_passer_is_qb_out_of_pocket_ewm", "external_ftn_passer_is_catchable_ball_ewm",
        "prior_offense_snap_pct_avg3", "prior_participated_avg3", "external_depth_starter",
        "external_environment_temperature_f", "external_environment_wind_mph",
        "external_environment_outdoor", "external_environment_fixed_roof", "is_home",
    ]
    return [column for column in requested if column in frame]


def foundation_projection(frame: pd.DataFrame) -> np.ndarray:
    history = common.row_mean(
        frame, ["prior_longest_pass_avg3", "prior_longest_pass_avg5", "prior_longest_pass_ewm"], fallback=32.0
    )
    projected_attempts = common.row_mean(
        frame, ["prior_passing_attempts_avg3", "prior_passing_attempts_ewm", "prior_team_pass_attempts_avg3"],
        fallback=31.5,
    )
    previous_completions = common.row_mean(
        frame, ["prior_completions_avg3", "prior_completions_avg5", "prior_passing_completions_avg3"], fallback=20.0
    )
    opportunity = np.clip(np.sqrt((projected_attempts * 0.65 + 1) / (previous_completions + 1)), 0.80, 1.25)
    return np.clip(history * opportunity, 0.0, 90.0)


def rename_target(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.assign(longest_rush=frame["longest_pass"])


if __name__ == "__main__":
    main()
