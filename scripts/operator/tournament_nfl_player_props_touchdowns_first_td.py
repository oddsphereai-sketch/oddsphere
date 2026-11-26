#!/usr/bin/env python3
"""Independent coherent tournaments for player TD count and first-TD scorer."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_passing_touchdowns as count_model


RELEASE = "nfl_player_props_touchdowns_first_td_tournament_2026_10_15_r1"
PBP_COLUMNS = [
    "season", "week", "game_id", "posteam", "defteam", "play_id", "order_sequence",
    "touchdown", "td_team", "td_player_id", "yardline_100", "goal_to_go",
    "pass_attempt", "rush_attempt", "receiver_player_id", "rusher_player_id",
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
    pbp = count_model.load_years(
        cli.historical_root, cli.current_root, "pbp", range(2016, 2027), columns=PBP_COLUMNS
    )
    frame = build_frame(features, pbp)
    train = frame[frame["season"].between(2017, 2024)].copy()
    validation = frame[frame["season"].eq(2025)].copy()
    current = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    captured = current[current["game_id"].isin(count_model.CAPTURED_GAMES)].copy()
    columns = model_features(frame)

    validation_predictions = {"foundation": foundation_mean(validation)}
    fitted = count_model.fit_models(rename_target(train), columns)
    for name, model in fitted.items():
        validation_predictions[name] = count_model.clipped(model.predict(validation[columns]))
    validation_count = {
        name: count_model.metrics(validation["player_tds"].to_numpy(float), prediction)
        for name, prediction in validation_predictions.items()
    }
    selected = min(
        ("poisson_glm", "poisson_hgb"),
        key=lambda name: (
            validation_count[name]["meanPoissonDeviance"],
            validation_count[name]["averageThresholdBrier"], validation_count[name]["mae"], name,
        ),
    )

    final_models = count_model.fit_models(rename_target(pd.concat([train, validation])), columns)
    current_predictions = {
        "foundation": foundation_mean(current),
        selected: count_model.clipped(final_models[selected].predict(current[columns])),
    }
    captured_predictions = {
        "foundation": foundation_mean(captured),
        selected: count_model.clipped(final_models[selected].predict(captured[columns])),
    }
    current_count = {
        name: count_model.metrics(current["player_tds"].to_numpy(float), prediction)
        for name, prediction in current_predictions.items()
    }
    captured_count = {
        name: count_model.metrics(captured["player_tds"].to_numpy(float), prediction)
        for name, prediction in captured_predictions.items()
    }
    count_wins = sum(
        current_count[selected]["thresholds"][str(line)]["brier"]
        < current_count["foundation"]["thresholds"][str(line)]["brier"]
        for line in count_model.LINES
    )
    count_gate = (
        current_count[selected]["mae"] < current_count["foundation"]["mae"]
        and current_count[selected]["meanPoissonDeviance"] < current_count["foundation"]["meanPoissonDeviance"]
        and current_count[selected]["averageThresholdBrier"] < current_count["foundation"]["averageThresholdBrier"]
        and count_wins >= 3
    )

    validation_first = {
        name: first_td_metrics(validation, coherent_first_probabilities(validation, prediction))
        for name, prediction in validation_predictions.items()
    }
    current_first_probabilities = {
        name: coherent_first_probabilities(current, prediction)
        for name, prediction in current_predictions.items()
    }
    current_first = {
        name: first_td_metrics(current, probability)
        for name, probability in current_first_probabilities.items()
    }
    captured_first = {
        name: first_td_metrics(captured, coherent_first_probabilities(captured, prediction))
        for name, prediction in captured_predictions.items()
    }
    first_gate = (
        current_first[selected]["brier"] < current_first["foundation"]["brier"]
        and current_first[selected]["logLoss"] < current_first["foundation"]["logLoss"]
    )

    result = {
        "release": RELEASE,
        "readOnly": True,
        "productionWrites": 0,
        "marketFeatures": [],
        "modelSelectionSeason": 2025,
        "primaryEvaluation": {"season": 2026, "weeks": [2, 3, 4, 5]},
        "data": {
            "trainRows": len(train), "validationRows": len(validation), "currentSeasonRows": len(current),
            "currentSeasonGames": int(current["game_id"].nunique()), "capturedGameRows": len(captured),
            "featureCount": len(columns),
        },
        "features": columns,
        "selection": {
            "winner": selected,
            "criterion": "minimum 2025 touchdown-count Poisson deviance; Brier then MAE",
        },
        "touchdowns": {
            "validation2025": validation_count,
            "currentSeason2026Weeks2To5": current_count,
            "currentSeasonPairedGameBootstrap95": count_model.paired_game_bootstrap(
                current["player_tds"].to_numpy(float), current_predictions["foundation"],
                current_predictions[selected], current["game_id"].astype(str).to_numpy(),
            ),
            "capturedWeek5Games": captured_count,
            "advancement": {
                "accuracyGatePass": count_gate, "thresholdBrierWins": count_wins,
                "productionAuthorized": False,
                "reason": "No release-pure Player Touchdowns offer/price ledger exists for economic validation.",
            },
        },
        "first_td": {
            "probabilityConstruction": "player lambda / eligible game lambda × (1 - exp(-eligible game lambda))",
            "validation2025": validation_first,
            "currentSeason2026Weeks2To5": current_first,
            "currentSeasonPairedGameBootstrap95": first_td_bootstrap(
                current, current_first_probabilities["foundation"], current_first_probabilities[selected]
            ),
            "capturedWeek5Games": captured_first,
            "advancement": {
                "accuracyGatePass": first_gate,
                "productionAuthorized": False,
                "reason": "No release-pure First Touchdown offer/price ledger or complete historical offer universe exists.",
            },
        },
        "limitations": [
            "Complete route participation, end-zone targets, and alignment data are unavailable.",
            "The eligible frame is a pregame role proxy rather than the unavailable historical book offer universe.",
            "The first-TD normalization assumes exchangeable event ordering conditional on player scoring intensities.",
            "No target market line, price, consensus, or movement enters the independent model.",
        ],
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, allow_nan=False))


def build_frame(features: pd.DataFrame, pbp: pd.DataFrame) -> pd.DataFrame:
    skills = features[
        features["position"].isin(["QB", "RB", "FB", "WR", "TE"]) & features["player_id"].notna()
    ].copy()
    offensive_tds = pbp[
        pd.to_numeric(pbp["touchdown"], errors="coerce").fillna(0).eq(1)
        & pbp["td_player_id"].notna() & pbp["td_team"].eq(pbp["posteam"])
    ].copy()
    counts = offensive_tds.groupby(
        ["season", "week", "game_id", "posteam", "td_player_id"], as_index=False
    ).size().rename(columns={"posteam": "team", "td_player_id": "player_id", "size": "player_tds"})
    skills = skills.merge(
        counts, on=["season", "week", "game_id", "team", "player_id"], how="left"
    )
    skills["player_tds"] = pd.to_numeric(skills["player_tds"], errors="coerce").fillna(0)

    opportunities = []
    yardline = pd.to_numeric(pbp["yardline_100"], errors="coerce")
    for player_column, attempt_column in (
        ("receiver_player_id", "pass_attempt"), ("rusher_player_id", "rush_attempt")
    ):
        subset = pbp[
            pbp[player_column].notna()
            & pd.to_numeric(pbp[attempt_column], errors="coerce").fillna(0).gt(0)
        ].copy()
        subset["redzone_opportunity"] = yardline.loc[subset.index].le(20).astype(float)
        subset["goal_line_opportunity"] = (
            yardline.loc[subset.index].le(10)
            | pd.to_numeric(subset["goal_to_go"], errors="coerce").fillna(0).eq(1)
        ).astype(float)
        opportunities.append(subset.groupby(
            ["season", "week", "game_id", "posteam", player_column], as_index=False
        )[["redzone_opportunity", "goal_line_opportunity"]].sum().rename(
            columns={"posteam": "team", player_column: "player_id"}
        ))
    opportunity = pd.concat(opportunities).groupby(
        ["season", "week", "game_id", "team", "player_id"], as_index=False
    )[["redzone_opportunity", "goal_line_opportunity"]].sum()
    skills = skills.merge(
        opportunity, on=["season", "week", "game_id", "team", "player_id"], how="left"
    )
    skills[["redzone_opportunity", "goal_line_opportunity"]] = skills[[
        "redzone_opportunity", "goal_line_opportunity"
    ]].fillna(0)

    skills = add_history(skills)
    first = first_touchdown_scorers(pbp)
    skills = skills.merge(first, on=["season", "week", "game_id"], how="left")
    skills["first_td"] = skills["player_id"].eq(skills["first_td_player_id"]).astype(int)
    role = count_model.row_mean(
        skills, ["prior_rushing_attempts_avg3", "prior_rushing_attempts_ewm"], fallback=0
    ) + count_model.row_mean(skills, ["prior_targets_avg3", "prior_targets_ewm"], fallback=0)
    qb_starter = skills["position"].eq("QB") & pd.to_numeric(
        skills["external_depth_starter"], errors="coerce"
    ).fillna(0).eq(1)
    participated = pd.to_numeric(skills["participated"], errors="coerce").fillna(0).eq(1)
    return skills[((role >= 1.5) | qb_starter) & participated].sort_values(
        ["season", "week", "game_id", "team", "player_id"]
    ).reset_index(drop=True)


def add_history(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.sort_values(["player_id", "season", "week", "game_id"]).copy()
    for metric in ("player_tds", "redzone_opportunity", "goal_line_opportunity"):
        for window in (3, 5):
            frame[f"prior_{metric}_avg{window}"] = count_model.grouped_rolling(
                frame, "player_id", metric, window, "mean"
            )
        frame[f"prior_{metric}_ewm"] = frame.groupby("player_id", sort=False)[metric].transform(
            lambda values: values.shift().ewm(alpha=0.4, adjust=False).mean()
        )
    team = frame.groupby(
        ["season", "week", "game_id", "team", "opponent"], as_index=False
    ).agg(team_player_tds=("player_tds", "sum"))
    team = team.sort_values(["team", "season", "week", "game_id"])
    for window in (3, 5):
        team[f"prior_team_player_tds_avg{window}"] = team.groupby("team", sort=False)[
            "team_player_tds"
        ].transform(lambda values: values.shift().rolling(window, min_periods=1).mean())
    allowed = team.rename(columns={"team": "offense", "opponent": "team"}).sort_values(
        ["team", "season", "week", "game_id"]
    )
    for window in (3, 5):
        allowed[f"prior_opponent_player_tds_allowed_avg{window}"] = allowed.groupby(
            "team", sort=False
        )["team_player_tds"].transform(lambda values: values.shift().rolling(window, min_periods=1).mean())
    keys = ["season", "week", "game_id", "team"]
    frame = frame.merge(
        team[[*keys, "prior_team_player_tds_avg3", "prior_team_player_tds_avg5"]], on=keys, how="left"
    )
    frame = frame.merge(
        allowed[["season", "week", "game_id", "offense",
                 "prior_opponent_player_tds_allowed_avg3", "prior_opponent_player_tds_allowed_avg5"]]
        .rename(columns={"offense": "team"}), on=keys, how="left"
    )
    return frame


def first_touchdown_scorers(pbp: pd.DataFrame) -> pd.DataFrame:
    events = pbp[pd.to_numeric(pbp["touchdown"], errors="coerce").fillna(0).eq(1)].copy()
    events["event_order"] = pd.to_numeric(events["order_sequence"], errors="coerce")
    events["event_order"] = events["event_order"].fillna(pd.to_numeric(events["play_id"], errors="coerce"))
    events = events.sort_values(["season", "week", "game_id", "event_order", "play_id"])
    first = events.groupby(["season", "week", "game_id"], as_index=False).first()
    return first[["season", "week", "game_id", "td_player_id"]].rename(
        columns={"td_player_id": "first_td_player_id"}
    )


def model_features(frame: pd.DataFrame) -> list[str]:
    requested = [
        "prior_player_tds_avg3", "prior_player_tds_avg5", "prior_player_tds_ewm",
        "prior_redzone_opportunity_avg3", "prior_redzone_opportunity_avg5", "prior_redzone_opportunity_ewm",
        "prior_goal_line_opportunity_avg3", "prior_goal_line_opportunity_avg5", "prior_goal_line_opportunity_ewm",
        "prior_team_player_tds_avg3", "prior_team_player_tds_avg5",
        "prior_opponent_player_tds_allowed_avg3", "prior_opponent_player_tds_allowed_avg5",
        "prior_rushing_attempts_avg3", "prior_rushing_attempts_avg5", "prior_rushing_attempts_ewm",
        "prior_rush_attempt_share_avg3", "prior_rush_attempt_share_ewm",
        "prior_targets_avg3", "prior_targets_avg5", "prior_targets_ewm",
        "prior_target_share_avg3", "prior_target_share_ewm",
        "prior_team_rush_attempts_avg3", "prior_team_targets_avg3",
        "prior_opponent_allowed_rush_attempts_avg3", "prior_opponent_allowed_targets_avg3",
        "matchup_position_opponent_allowed_rushing_attempts_avg3",
        "matchup_position_opponent_allowed_targets_avg3",
        "external_state_team_plays_avg3", "external_state_team_rush_rate_avg3",
        "external_state_team_dropback_rate_avg3", "external_state_team_no_huddle_rate_avg3",
        "external_state_opponent_allowed_plays_avg3", "external_state_opponent_allowed_rush_rate_avg3",
        "external_ngs_rushing_efficiency_ewm", "external_ngs_rushing_percent_attempts_gte_eight_defenders_ewm",
        "external_ngs_receiving_avg_cushion_ewm", "external_ngs_receiving_avg_separation_ewm",
        "external_ngs_receiving_percent_share_of_intended_air_yards_ewm",
        "external_ftn_rusher_n_defense_box_ewm", "external_ftn_rusher_is_motion_ewm",
        "external_ftn_receiver_is_catchable_ball_ewm", "external_ftn_receiver_is_contested_ball_ewm",
        "prior_offense_snap_pct_avg3", "prior_participated_avg3", "external_depth_starter",
        "external_injury_out", "external_injury_doubtful", "external_injury_questionable",
        "external_environment_temperature_f", "external_environment_wind_mph",
        "external_environment_outdoor", "external_environment_fixed_roof", "is_home",
    ]
    return [column for column in requested if column in frame]


def foundation_mean(frame: pd.DataFrame) -> np.ndarray:
    player = count_model.row_mean(
        frame, ["prior_player_tds_avg3", "prior_player_tds_avg5", "prior_player_tds_ewm"], fallback=0.12
    )
    team = count_model.row_mean(
        frame, ["prior_team_player_tds_avg3", "prior_team_player_tds_avg5",
                "prior_opponent_player_tds_allowed_avg3", "prior_opponent_player_tds_allowed_avg5"],
        fallback=2.4,
    )
    target_share = count_model.row_mean(
        frame, ["prior_target_share_avg3", "prior_target_share_ewm"], fallback=0
    )
    rush_share = count_model.row_mean(
        frame, ["prior_rush_attempt_share_avg3", "prior_rush_attempt_share_ewm"], fallback=0
    )
    allocation = np.clip(0.55 * target_share + 0.45 * rush_share, 0, 0.75)
    return count_model.clipped(0.65 * player + 0.35 * team * allocation)


def rename_target(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.assign(passing_tds=frame["player_tds"])


def coherent_first_probabilities(frame: pd.DataFrame, lambdas: np.ndarray) -> np.ndarray:
    scored = frame[["game_id"]].copy()
    scored["lambda"] = count_model.clipped(lambdas)
    total = scored.groupby("game_id")["lambda"].transform("sum").to_numpy(float)
    chance_any = 1.0 - np.exp(-total)
    return np.clip(lambdas / np.maximum(total, 1e-9) * chance_any, 1e-9, 1 - 1e-9)


def first_td_metrics(frame: pd.DataFrame, probability: np.ndarray) -> dict:
    actual = frame["first_td"].to_numpy(float)
    probability = np.clip(probability, 1e-9, 1 - 1e-9)
    return {
        "rows": len(frame), "games": int(frame["game_id"].nunique()), "positiveScorers": int(actual.sum()),
        "observedRate": float(actual.mean()), "meanProbability": float(probability.mean()),
        "meanProbabilityMassPerGame": float(pd.DataFrame({
            "game_id": frame["game_id"].to_numpy(), "probability": probability,
        }).groupby("game_id")["probability"].sum().mean()),
        "brier": float(np.mean(np.square(probability - actual))),
        "logLoss": float(np.mean(-(actual * np.log(probability) + (1 - actual) * np.log(1 - probability)))),
    }


def first_td_bootstrap(
    frame: pd.DataFrame, foundation: np.ndarray, candidate: np.ndarray, iterations: int = 2_000
) -> dict:
    games = frame["game_id"].astype(str).to_numpy()
    unique = np.unique(games)
    indices = {game: np.flatnonzero(games == game) for game in unique}
    actual = frame["first_td"].to_numpy(float)
    rng = np.random.default_rng(20261015)
    deltas = {"brierDelta": [], "logLossDelta": []}
    for _ in range(iterations):
        selected = rng.choice(unique, len(unique), replace=True)
        take = np.concatenate([indices[game] for game in selected])
        y = actual[take]
        base = np.clip(foundation[take], 1e-9, 1 - 1e-9)
        cand = np.clip(candidate[take], 1e-9, 1 - 1e-9)
        deltas["brierDelta"].append(float(np.mean((cand - y) ** 2 - (base - y) ** 2)))
        deltas["logLossDelta"].append(float(np.mean(
            -(y * np.log(cand) + (1 - y) * np.log(1 - cand))
            + (y * np.log(base) + (1 - y) * np.log(1 - base))
        )))
    return {
        "clusters": len(unique), "iterations": iterations,
        "deltaDefinition": "candidate minus foundation; negative favors candidate",
        **{name: count_model.interval(values) for name, values in deltas.items()},
    }


if __name__ == "__main__":
    main()

