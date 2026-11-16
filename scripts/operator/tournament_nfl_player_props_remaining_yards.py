#!/usr/bin/env python3
"""Independent tournaments for Longest Reception and Rushing + Receiving Yards."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_longest_rush as extreme
import tournament_nfl_player_props_passing_touchdowns as common


RELEASE = "nfl_player_props_remaining_yards_tournament_2026_10_15_r1"
MARKETS = {
    "longest_reception": (14.5, 19.5, 24.5, 29.5, 34.5),
    "rushing_receiving_yards": (39.5, 49.5, 59.5, 69.5, 79.5),
}
PBP_COLUMNS = [
    "season", "week", "game_id", "posteam", "receiver_player_id", "receiving_yards",
    "complete_pass", "qb_spike", "aborted_play",
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
    frames = {
        "longest_reception": build_longest_reception(features, pbp),
        "rushing_receiving_yards": build_combined_yards(features),
    }
    results = {}
    for market, frame in frames.items():
        results[market] = run_market(market, frame, MARKETS[market])
    payload = {
        "release": RELEASE,
        "readOnly": True,
        "productionWrites": 0,
        "marketFeatures": [],
        "modelSelectionSeason": 2025,
        "primaryEvaluation": {"season": 2026, "weeks": [2, 3, 4, 5]},
        "markets": results,
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, allow_nan=False))


def run_market(market: str, frame: pd.DataFrame, lines: tuple[float, ...]) -> dict:
    train = frame[frame["season"].between(2017, 2024)].copy()
    validation = frame[frame["season"].eq(2025)].copy()
    current = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    captured = current[current["game_id"].isin(common.CAPTURED_GAMES)].copy()
    columns = model_features(frame, market)

    validation_predictions = {"foundation": foundation_projection(validation, market)}
    trained = extreme.fit_models(rename_target(train, market), columns)
    validation_sigmas = {
        "foundation": extreme.log_sigma(
            validation[market].to_numpy(float), validation_predictions["foundation"]
        )
    }
    for name, model in trained.items():
        validation_predictions[name] = extreme.predict(model, validation[columns])
        validation_sigmas[name] = extreme.log_sigma(
            train[market].to_numpy(float), extreme.predict(model, train[columns])
        )
    validation_metrics = {
        name: extreme.metrics(validation[market].to_numpy(float), values, validation_sigmas[name], lines)
        for name, values in validation_predictions.items()
    }
    selected = min(
        ("ridge_log", "hgb_log"),
        key=lambda name: (
            validation_metrics[name]["mae"], validation_metrics[name]["rmse"],
            validation_metrics[name]["averageThresholdBrier"], name,
        ),
    )

    final_models = extreme.fit_models(rename_target(pd.concat([train, validation]), market), columns)
    current_predictions = {
        "foundation": foundation_projection(current, market),
        selected: extreme.predict(final_models[selected], current[columns]),
    }
    captured_predictions = {
        "foundation": foundation_projection(captured, market),
        selected: extreme.predict(final_models[selected], captured[columns]),
    }
    sigmas = {
        name: extreme.log_sigma(validation[market].to_numpy(float), validation_predictions[name])
        for name in ("foundation", selected)
    }
    current_metrics = {
        name: extreme.metrics(current[market].to_numpy(float), values, sigmas[name], lines)
        for name, values in current_predictions.items()
    }
    captured_metrics = {
        name: extreme.metrics(captured[market].to_numpy(float), values, sigmas[name], lines)
        for name, values in captured_predictions.items()
    }
    gate = extreme.advancement_gate(current_metrics["foundation"], current_metrics[selected], lines)
    return {
        "data": {
            "trainRows": len(train), "validationRows": len(validation), "currentSeasonRows": len(current),
            "capturedGameRows": len(captured), "featureCount": len(columns),
        },
        "features": columns,
        "lines": lines,
        "validation2025": validation_metrics,
        "selection": {"winner": selected, "criterion": "minimum 2025 MAE; RMSE then Brier"},
        "probabilityResidualLogSigma": sigmas,
        "currentSeason2026Weeks2To5": current_metrics,
        "currentSeasonPairedGameBootstrap95": extreme.paired_bootstrap(
            current[market].to_numpy(float), current_predictions["foundation"], current_predictions[selected],
            sigmas, current["game_id"].astype(str).to_numpy(), selected, lines,
        ),
        "capturedWeek5Games": captured_metrics,
        "advancement": {
            **gate,
            "productionAuthorized": False,
            "reason": f"No release-pure {market} offers/prices were retained for economic evaluation.",
        },
        "limitations": [
            "The eligible-player frame is a pregame role proxy, not the unavailable exact historical offer universe.",
            "Threshold probabilities use a homoscedastic normal residual on log(1 + outcome).",
            "Complete routes-run, route-participation, and alignment data are unavailable.",
        ],
    }


def build_longest_reception(features: pd.DataFrame, pbp: pd.DataFrame) -> pd.DataFrame:
    plays = pbp[
        pd.to_numeric(pbp["complete_pass"], errors="coerce").fillna(0).eq(1)
        & ~pd.to_numeric(pbp["qb_spike"], errors="coerce").fillna(0).eq(1)
        & ~pd.to_numeric(pbp["aborted_play"], errors="coerce").fillna(0).eq(1)
        & pbp["receiver_player_id"].notna()
    ].copy()
    plays["receiving_yards"] = pd.to_numeric(plays["receiving_yards"], errors="coerce").fillna(0)
    outcomes = plays.groupby(
        ["season", "week", "game_id", "posteam", "receiver_player_id"], as_index=False
    ).agg(
        longest_reception=("receiving_yards", "max"), receptions_on_plays=("receiving_yards", "size"),
        explosive_20=("receiving_yards", lambda values: values.ge(20).sum()),
        explosive_40=("receiving_yards", lambda values: values.ge(40).sum()),
    ).rename(columns={"posteam": "team", "receiver_player_id": "player_id"})
    history = outcome_history(outcomes, "longest_reception", "receptions_on_plays")
    frame = features[
        features["position"].isin(["WR", "TE", "RB", "FB"]) & features["player_id"].notna()
    ].copy()
    frame = frame.merge(
        outcomes[["season", "week", "game_id", "player_id", "longest_reception"]],
        on=["season", "week", "game_id", "player_id"], how="left",
    ).merge(history, on=["season", "week", "game_id", "player_id"], how="left")
    frame["longest_reception"] = pd.to_numeric(
        frame["longest_reception"], errors="coerce"
    ).fillna(0).clip(lower=0)
    role = common.row_mean(frame, ["prior_targets_avg3", "prior_targets_ewm"], fallback=0)
    participated = pd.to_numeric(frame["participated"], errors="coerce").fillna(0).eq(1)
    return frame[(role >= 1.5) & participated].sort_values(
        ["season", "week", "game_id", "team", "player_id"]
    ).reset_index(drop=True)


def outcome_history(outcomes: pd.DataFrame, target: str, volume: str) -> pd.DataFrame:
    frame = outcomes.sort_values(["player_id", "season", "week", "game_id"]).copy()
    for window in (3, 5):
        frame[f"prior_{target}_avg{window}"] = common.grouped_rolling(
            frame, "player_id", target, window, "mean"
        )
        frame[f"prior_{volume}_avg{window}"] = common.grouped_rolling(
            frame, "player_id", volume, window, "mean"
        )
        volume_sum = common.grouped_rolling(frame, "player_id", volume, window, "sum")
        for yardage in (20, 40):
            events = common.grouped_rolling(frame, "player_id", f"explosive_{yardage}", window, "sum")
            frame[f"prior_explosive_{yardage}_rate{window}"] = common.shrunk_rate(
                events, volume_sum, 0.07 if yardage == 20 else 0.015, 30
            )
    frame[f"prior_{target}_ewm"] = frame.groupby("player_id", sort=False)[target].transform(
        lambda values: values.shift().ewm(alpha=0.4, adjust=False).mean()
    )
    columns = [column for column in frame if column.startswith("prior_")]
    return frame[["season", "week", "game_id", "player_id", *columns]]


def build_combined_yards(features: pd.DataFrame) -> pd.DataFrame:
    frame = features[
        features["position"].isin(["RB", "WR", "TE", "FB", "QB"]) & features["player_id"].notna()
    ].copy()
    rush = pd.to_numeric(frame["rushing_yards"], errors="coerce").fillna(0)
    receive = pd.to_numeric(frame["receiving_yards"], errors="coerce").fillna(0)
    frame["rushing_receiving_yards"] = (rush + receive).clip(lower=0)
    role = common.row_mean(frame, ["prior_rushing_attempts_avg3", "prior_rushing_attempts_ewm"], fallback=0)
    role += common.row_mean(frame, ["prior_targets_avg3", "prior_targets_ewm"], fallback=0)
    participated = pd.to_numeric(frame["participated"], errors="coerce").fillna(0).eq(1)
    return frame[(role >= 2.0) & participated].sort_values(
        ["season", "week", "game_id", "team", "player_id"]
    ).reset_index(drop=True)


def model_features(frame: pd.DataFrame, market: str) -> list[str]:
    common_columns = [
        "prior_rushing_attempts_avg3", "prior_rushing_attempts_avg5", "prior_rushing_attempts_ewm",
        "prior_rushing_yards_avg3", "prior_rushing_yards_avg5", "prior_rushing_yards_ewm",
        "prior_rush_attempt_share_avg3", "prior_rush_attempt_share_ewm",
        "prior_targets_avg3", "prior_targets_avg5", "prior_targets_ewm",
        "prior_receptions_avg3", "prior_receptions_avg5", "prior_receptions_ewm",
        "prior_receiving_yards_avg3", "prior_receiving_yards_avg5", "prior_receiving_yards_ewm",
        "prior_target_share_avg3", "prior_target_share_ewm",
        "prior_team_rush_attempts_avg3", "prior_team_rushing_yards_avg3", "prior_team_targets_avg3",
        "prior_opponent_allowed_rushing_yards_avg3", "prior_opponent_allowed_receiving_yards_avg3",
        "matchup_position_opponent_allowed_rushing_yards_avg3",
        "matchup_position_opponent_allowed_receiving_yards_avg3",
        "matchup_position_opponent_allowed_targets_avg3",
        "external_state_team_plays_avg3", "external_state_team_rush_rate_avg3",
        "external_state_team_air_yards_per_attempt_avg3", "external_state_team_xyac_per_completion_avg3",
        "external_state_opponent_allowed_plays_avg3", "external_state_opponent_allowed_rush_rate_avg3",
        "external_ngs_rushing_efficiency_ewm", "external_ngs_rushing_expected_rush_yards_per_att_ewm",
        "external_ngs_rushing_rush_yards_over_expected_per_att_ewm",
        "external_ngs_receiving_avg_cushion_ewm", "external_ngs_receiving_avg_separation_ewm",
        "external_ngs_receiving_avg_intended_air_yards_ewm",
        "external_ngs_receiving_percent_share_of_intended_air_yards_ewm",
        "external_ngs_receiving_catch_percentage_ewm", "external_ngs_receiving_avg_yac_ewm",
        "external_ngs_receiving_avg_expected_yac_ewm", "external_ngs_receiving_avg_yac_above_expectation_ewm",
        "external_pfr_rush_rushing_yards_before_contact_avg_ewm",
        "external_pfr_rush_rushing_yards_after_contact_avg_ewm",
        "external_pfr_rec_receiving_drop_pct_ewm", "external_pfr_rec_receiving_broken_tackles_ewm",
        "external_ftn_rusher_n_defense_box_ewm", "external_ftn_rusher_is_motion_ewm",
        "external_ftn_rusher_is_rpo_ewm", "external_ftn_receiver_is_screen_pass_ewm",
        "external_ftn_receiver_is_catchable_ball_ewm", "external_ftn_receiver_is_contested_ball_ewm",
        "prior_offense_snap_pct_avg3", "prior_participated_avg3", "external_depth_starter",
        "external_environment_temperature_f", "external_environment_wind_mph",
        "external_environment_outdoor", "external_environment_fixed_roof", "is_home",
    ]
    if market == "longest_reception":
        common_columns = [
            "prior_longest_reception_avg3", "prior_longest_reception_avg5", "prior_longest_reception_ewm",
            "prior_receptions_on_plays_avg3", "prior_receptions_on_plays_avg5",
            "prior_explosive_20_rate3", "prior_explosive_20_rate5",
            "prior_explosive_40_rate3", "prior_explosive_40_rate5", *common_columns,
        ]
    return [column for column in common_columns if column in frame]


def foundation_projection(frame: pd.DataFrame, market: str) -> np.ndarray:
    if market == "longest_reception":
        history = common.row_mean(frame, [
            "prior_longest_reception_avg3", "prior_longest_reception_avg5", "prior_longest_reception_ewm",
        ], fallback=18.0)
        projected_targets = common.row_mean(frame, ["prior_targets_avg3", "prior_targets_ewm"], fallback=4.0)
        prior_receptions = common.row_mean(frame, [
            "prior_receptions_on_plays_avg3", "prior_receptions_on_plays_avg5", "prior_receptions_avg3",
        ], fallback=3.0)
        opportunity = np.clip(np.sqrt((projected_targets * 0.68 + 1) / (prior_receptions + 1)), 0.8, 1.25)
        return np.clip(history * opportunity, 0, 90)
    rushing = common.row_mean(frame, [
        "prior_rushing_yards_avg3", "prior_rushing_yards_avg5", "prior_rushing_yards_ewm",
    ], fallback=0)
    receiving = common.row_mean(frame, [
        "prior_receiving_yards_avg3", "prior_receiving_yards_avg5", "prior_receiving_yards_ewm",
    ], fallback=0)
    return np.clip(rushing + receiving, 0, 250)


def rename_target(frame: pd.DataFrame, market: str) -> pd.DataFrame:
    return frame.assign(longest_rush=frame[market])


if __name__ == "__main__":
    main()

