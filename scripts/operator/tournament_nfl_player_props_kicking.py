#!/usr/bin/env python3
"""Independent NFL field-goals-made and kicking-points tournament."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import poisson
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import PoissonRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import tournament_nfl_player_props_passing_touchdowns as common


RELEASE = "nfl_player_props_kicking_tournament_2026_10_15_r1"
KICKING_POINT_LINES = (4.5, 5.5, 6.5, 7.5, 8.5, 9.5)
PBP_COLUMNS = [
    "season", "week", "game_id", "posteam", "defteam", "drive", "yardline_100", "play_type",
    "field_goal_attempt", "extra_point_attempt", "touchdown", "field_goal_result", "extra_point_result",
    "aborted_play",
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
    stats = common.load_years(cli.historical_root, cli.current_root, "player_stats", range(2016, 2027))
    pbp = common.load_years(
        cli.historical_root, cli.current_root, "pbp", range(2016, 2027), columns=PBP_COLUMNS
    )
    frame = build_frame(features, stats, pbp)
    train = frame[(frame["season"] >= 2017) & (frame["season"] <= 2024)].copy()
    validation = frame[frame["season"] == 2025].copy()
    current = frame[(frame["season"] == 2026) & frame["week"].between(2, 5)].copy()
    captured = current[current["game_id"].isin(common.CAPTURED_GAMES)].copy()
    if len(captured) != 4:
        raise RuntimeError(f"Expected four captured-game kickers; found {len(captured)}")
    columns = model_features(frame)

    foundations_validation = {
        "fg_made": foundation_fg(validation),
        "pat_made": foundation_pat(validation),
    }
    fitted_validation = fit_component_models(train, columns)
    validation_component_metrics = {}
    selected_components = {}
    for target in ("fg_made", "pat_made"):
        predictions = {"foundation": foundations_validation[target]}
        for architecture, models in fitted_validation.items():
            predictions[architecture] = common.clipped(models[target].predict(validation[columns]))
        validation_component_metrics[target] = {
            name: common.metrics(validation[target].to_numpy(float), values) for name, values in predictions.items()
        }
        selected_components[target] = sorted(["poisson_glm", "poisson_hgb"], key=lambda name: (
            validation_component_metrics[target][name]["meanPoissonDeviance"],
            validation_component_metrics[target][name]["averageThresholdBrier"],
            validation_component_metrics[target][name]["mae"], name,
        ))[0]

    final_models = fit_component_models(pd.concat([train, validation], ignore_index=True), columns)
    current_components = component_predictions(current, columns, final_models, selected_components)
    captured_components = component_predictions(captured, columns, final_models, selected_components)
    current_fg_metrics = {
        name: common.metrics(current["fg_made"].to_numpy(float), values["fg_made"])
        for name, values in current_components.items()
    }
    current_pat_metrics = {
        name: common.metrics(current["pat_made"].to_numpy(float), values["pat_made"])
        for name, values in current_components.items()
    }
    current_points_metrics = {
        name: kicking_points_metrics(
            current["kicking_points"].to_numpy(float), values["fg_made"], values["pat_made"]
        ) for name, values in current_components.items()
    }
    captured_fg_metrics = {
        name: common.metrics(captured["fg_made"].to_numpy(float), values["fg_made"])
        for name, values in captured_components.items()
    }
    captured_points_metrics = {
        name: kicking_points_metrics(
            captured["kicking_points"].to_numpy(float), values["fg_made"], values["pat_made"]
        ) for name, values in captured_components.items()
    }
    fg_gate = field_goal_gate(current_fg_metrics["foundation"], current_fg_metrics["selected_components"])
    points_gate = kicking_points_gate(
        current_points_metrics["foundation"], current_points_metrics["selected_components"]
    )
    rows = []
    current = current.reset_index(drop=True)
    for index, row in current.iterrows():
        rows.append({
            "season": int(row["season"]), "week": int(row["week"]), "gameId": row["game_id"],
            "playerId": row["player_id"], "playerName": row["player_name"], "team": row["team"],
            "opponent": row["opponent"], "actualFgMade": int(row["fg_made"]),
            "actualPatMade": int(row["pat_made"]), "actualKickingPoints": int(row["kicking_points"]),
            "capturedGame": bool(row["game_id"] in common.CAPTURED_GAMES),
            "projections": {
                name: {
                    "fgMade": float(values["fg_made"][index]),
                    "patMade": float(values["pat_made"][index]),
                    "kickingPoints": float(3 * values["fg_made"][index] + values["pat_made"][index]),
                } for name, values in current_components.items()
            },
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
        "validation2025Components": validation_component_metrics,
        "selection": {
            "fgMade": selected_components["fg_made"], "patMade": selected_components["pat_made"],
            "criterion": "minimum 2025 component Poisson deviance; Brier then MAE",
        },
        "currentSeason2026Weeks2To5": {
            "fieldGoalsMade": current_fg_metrics,
            "patMadeComponent": current_pat_metrics,
            "kickingPoints": current_points_metrics,
        },
        "currentSeasonPairedGameBootstrap95": {
            "fieldGoalsMade": common.paired_game_bootstrap(
                current["fg_made"].to_numpy(float), current_components["foundation"]["fg_made"],
                current_components["selected_components"]["fg_made"], current["game_id"].astype(str).to_numpy(),
            ),
            "kickingPoints": kicking_points_bootstrap(
                current["kicking_points"].to_numpy(float), current_components, current["game_id"].astype(str).to_numpy()
            ),
        },
        "capturedWeek5Games": {
            "fieldGoalsMade": captured_fg_metrics,
            "kickingPoints": captured_points_metrics,
        },
        "advancement": {
            "fieldGoalsMadeAccuracyGatePass": fg_gate,
            "kickingPointsAccuracyGatePass": points_gate,
            "productionAuthorized": False,
            "reason": "Exact release-pure kicking offers/prices were not captured; accuracy cannot establish economic actionability.",
        },
        "limitations": [
            "Compound kicking-points probabilities assume independent Poisson FG and PAT components despite shared team scoring opportunity.",
            "No release-pure kicking offers or prices were retained in the private archive/observer.",
            "The OddSphere archived-game slice contains four kickers.",
        ],
        "capturedRows": [row for row in rows if row["capturedGame"]],
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE, "selection": result["selection"],
        "currentSeason2026Weeks2To5": result["currentSeason2026Weeks2To5"],
        "bootstrap": result["currentSeasonPairedGameBootstrap95"],
        "capturedWeek5Games": result["capturedWeek5Games"], "advancement": result["advancement"],
        "capturedRows": result["capturedRows"],
    }, indent=2))


def build_frame(features: pd.DataFrame, stats: pd.DataFrame, pbp: pd.DataFrame) -> pd.DataFrame:
    context_columns = [column for column in features if column.startswith("external_") or column.startswith("prior_team_")
                       or column.startswith("prior_opponent_")]
    context_columns += ["is_home"]
    team_context = features[["season", "week", "game_id", "team", *sorted(set(context_columns))]].groupby(
        ["season", "week", "game_id", "team"], as_index=False
    ).first()
    stats = stats[stats["position"] == "K"].copy()
    numeric = [
        "fg_made", "fg_att", "pat_made", "pat_att", "fg_made_0_19", "fg_made_20_29", "fg_made_30_39",
        "fg_made_40_49", "fg_made_50_59", "fg_made_60_", "fg_missed_0_19", "fg_missed_20_29",
        "fg_missed_30_39", "fg_missed_40_49", "fg_missed_50_59", "fg_missed_60_",
    ]
    for column in numeric:
        stats[column] = pd.to_numeric(stats[column], errors="coerce").fillna(0)
    stats = stats[["season", "week", "game_id", "player_id", "player_display_name",
                   "team", "opponent_team", *numeric]].drop_duplicates(
        ["season", "week", "game_id", "player_id"]
    )
    history = kicking_history(stats)
    drives = drive_history(pbp)
    frame = stats[["season", "week", "game_id", "player_id", "player_display_name", "team", "opponent_team",
                   "fg_made", "fg_att", "pat_made", "pat_att"]].merge(
        history, on=["season", "week", "game_id", "player_id"], how="left"
    )
    frame = frame.merge(drives, on=["season", "week", "game_id", "team"], how="left")
    frame = frame.merge(team_context, on=["season", "week", "game_id", "team"], how="left")
    frame["kicking_points"] = 3 * frame["fg_made"] + frame["pat_made"]
    prior = pd.to_numeric(frame["prior_kicker_scoring_attempts_avg3"], errors="coerce").fillna(0)
    frame["player_name"] = frame["player_display_name"]
    frame["opponent"] = frame["opponent_team"]
    return frame[prior.ge(1)].sort_values(
        ["season", "week", "game_id", "team", "player_id"]
    ).reset_index(drop=True)


def kicking_history(stats: pd.DataFrame) -> pd.DataFrame:
    stats = stats.sort_values(["player_id", "season", "week", "game_id"]).copy()
    stats["scoring_attempts"] = stats["fg_att"] + stats["pat_att"]
    stats["fg_long_made"] = stats["fg_made_40_49"] + stats["fg_made_50_59"] + stats["fg_made_60_"]
    stats["fg_long_att"] = stats["fg_long_made"] + stats["fg_missed_40_49"] + stats["fg_missed_50_59"] + stats["fg_missed_60_"]
    for window in (3, 5):
        for column in ("fg_att", "fg_made", "pat_att", "pat_made", "scoring_attempts"):
            stats[f"prior_kicker_{column}_avg{window}"] = common.grouped_rolling(
                stats, "player_id", column, window, "mean"
            )
        fg_made = common.grouped_rolling(stats, "player_id", "fg_made", window, "sum")
        fg_att = common.grouped_rolling(stats, "player_id", "fg_att", window, "sum")
        pat_made = common.grouped_rolling(stats, "player_id", "pat_made", window, "sum")
        pat_att = common.grouped_rolling(stats, "player_id", "pat_att", window, "sum")
        long_made = common.grouped_rolling(stats, "player_id", "fg_long_made", window, "sum")
        long_att = common.grouped_rolling(stats, "player_id", "fg_long_att", window, "sum")
        stats[f"prior_kicker_fg_rate{window}"] = common.shrunk_rate(fg_made, fg_att, 0.86, 12)
        stats[f"prior_kicker_pat_rate{window}"] = common.shrunk_rate(pat_made, pat_att, 0.94, 12)
        stats[f"prior_kicker_long_fg_rate{window}"] = common.shrunk_rate(long_made, long_att, 0.72, 8)
    team = stats.groupby(["season", "week", "game_id", "team", "opponent_team"], as_index=False).agg(
        team_fg_att=("fg_att", "sum"), team_fg_made=("fg_made", "sum"),
        team_pat_att=("pat_att", "sum"), team_pat_made=("pat_made", "sum"),
    )
    offense = rolling_team_kicking(team, "team", "prior_team")
    defense_base = team.rename(columns={"team": "offense", "opponent_team": "team"})
    defense = rolling_team_kicking(defense_base, "team", "prior_opponent_allowed").rename(
        columns={"offense": "opponent_team"}
    )
    keys = ["season", "week", "game_id", "team"]
    player_columns = [column for column in stats if column.startswith("prior_kicker_")]
    result = stats[["season", "week", "game_id", "player_id", "team", "opponent_team", *player_columns]]
    result = result.merge(offense.drop(columns=["opponent_team"]), on=keys, how="left")
    result = result.merge(
        defense.drop(columns=["team"]).rename(columns={"opponent_team": "team"}), on=keys, how="left"
    )
    return result.drop(columns=["team", "opponent_team"])


def rolling_team_kicking(frame: pd.DataFrame, group: str, prefix: str) -> pd.DataFrame:
    frame = frame.sort_values(["season", group, "week", "game_id"]).copy()
    for window in (3, 5):
        for column in ("team_fg_att", "team_fg_made", "team_pat_att", "team_pat_made"):
            frame[f"{prefix}_{column.removeprefix('team_')}_avg{window}"] = frame.groupby(
                ["season", group], sort=False
            )[column].transform(lambda values: values.shift().rolling(window, min_periods=1).mean())
    return frame.drop(columns=["team_fg_att", "team_fg_made", "team_pat_att", "team_pat_made"])


def drive_history(pbp: pd.DataFrame) -> pd.DataFrame:
    pbp = pbp[pbp["posteam"].notna() & pbp["defteam"].notna()].copy()
    pbp = pbp[~pd.to_numeric(pbp["aborted_play"], errors="coerce").fillna(0).eq(1)]
    group = ["season", "week", "game_id", "posteam", "defteam"]
    game = pbp.groupby(group, as_index=False).agg(
        drives=("drive", "nunique"),
        field_goal_attempts=("field_goal_attempt", lambda values: pd.to_numeric(values, errors="coerce").fillna(0).eq(1).sum()),
        touchdowns=("touchdown", lambda values: pd.to_numeric(values, errors="coerce").fillna(0).eq(1).sum()),
    ).rename(columns={"posteam": "team", "defteam": "opponent"})
    rz = pbp[pd.to_numeric(pbp["yardline_100"], errors="coerce").le(20)].groupby(group)["drive"].nunique()
    opp35 = pbp[pd.to_numeric(pbp["yardline_100"], errors="coerce").le(35)].groupby(group)["drive"].nunique()
    game = game.merge(rz.rename("redzone_drives").reset_index().rename(
        columns={"posteam": "team", "defteam": "opponent"}
    ), on=["season", "week", "game_id", "team", "opponent"], how="left")
    game = game.merge(opp35.rename("opponent35_drives").reset_index().rename(
        columns={"posteam": "team", "defteam": "opponent"}
    ), on=["season", "week", "game_id", "team", "opponent"], how="left").fillna(0)
    offense = rolling_drives(game, "team", "prior_team_drive")
    defense_base = game.rename(columns={"team": "offense", "opponent": "team"})
    defense = rolling_drives(defense_base, "team", "prior_opponent_allowed_drive").rename(
        columns={"offense": "opponent"}
    )
    keys = ["season", "week", "game_id", "team"]
    return offense.drop(columns=["opponent"]).merge(
        defense.drop(columns=["team"]).rename(columns={"opponent": "team"}), on=keys, how="left"
    )


def rolling_drives(frame: pd.DataFrame, group: str, prefix: str) -> pd.DataFrame:
    frame = frame.sort_values(["season", group, "week", "game_id"]).copy()
    other = "opponent" if "opponent" in frame else "offense"
    output = frame[["season", "week", "game_id", group, other]].copy()
    for window in (3, 5):
        for column in ("drives", "field_goal_attempts", "touchdowns", "redzone_drives", "opponent35_drives"):
            output[f"{prefix}_{column}_avg{window}"] = frame.groupby(["season", group], sort=False)[column].transform(
                lambda values: values.shift().rolling(window, min_periods=1).mean()
            )
    return output


def model_features(frame: pd.DataFrame) -> list[str]:
    requested = [column for column in frame if column.startswith((
        "prior_kicker_", "prior_team_fg_", "prior_team_pat_", "prior_opponent_allowed_fg_",
        "prior_opponent_allowed_pat_", "prior_team_drive_", "prior_opponent_allowed_drive_",
    ))]
    requested += [
        "prior_team_offensive_plays_avg3", "prior_team_offensive_plays_ewm",
        "prior_opponent_allowed_offensive_plays_avg3", "prior_opponent_allowed_offensive_plays_ewm",
        "external_state_team_plays_avg3", "external_state_team_pass_oe_avg3",
        "external_state_team_seconds_per_play_avg3", "external_state_opponent_allowed_plays_avg3",
        "external_environment_temperature_f", "external_environment_wind_mph",
        "external_environment_outdoor", "external_environment_fixed_roof", "is_home",
    ]
    return sorted(set(column for column in requested if column in frame))


def foundation_fg(frame: pd.DataFrame) -> np.ndarray:
    attempts = common.row_mean(frame, [
        "prior_team_fg_att_avg3", "prior_team_fg_att_avg5",
        "prior_opponent_allowed_fg_att_avg3", "prior_opponent_allowed_fg_att_avg5",
        "prior_team_drive_field_goal_attempts_avg3",
    ], fallback=1.8)
    rate = common.row_mean(frame, ["prior_kicker_fg_rate3", "prior_kicker_fg_rate5"], fallback=0.86)
    return common.clipped(attempts * rate)


def foundation_pat(frame: pd.DataFrame) -> np.ndarray:
    attempts = common.row_mean(frame, [
        "prior_team_pat_att_avg3", "prior_team_pat_att_avg5",
        "prior_opponent_allowed_pat_att_avg3", "prior_opponent_allowed_pat_att_avg5",
        "prior_team_drive_touchdowns_avg3",
    ], fallback=2.3)
    rate = common.row_mean(frame, ["prior_kicker_pat_rate3", "prior_kicker_pat_rate5"], fallback=0.94)
    return common.clipped(attempts * rate)


def fit_component_models(frame: pd.DataFrame, columns: list[str]):
    result = {"poisson_glm": {}, "poisson_hgb": {}}
    for target in ("fg_made", "pat_made"):
        x = frame[columns]
        y = frame[target].to_numpy(float)
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
        result["poisson_glm"][target] = glm
        result["poisson_hgb"][target] = hgb
    return result


def component_predictions(frame, columns, models, selected):
    foundation = {"fg_made": foundation_fg(frame), "pat_made": foundation_pat(frame)}
    chosen = {
        target: common.clipped(models[selected[target]][target].predict(frame[columns]))
        for target in ("fg_made", "pat_made")
    }
    return {"foundation": foundation, "selected_components": chosen}


def kicking_points_metrics(actual, fg_mean, pat_mean):
    expected = 3 * fg_mean + pat_mean
    threshold = {}
    for line in KICKING_POINT_LINES:
        probability = compound_over_probability(fg_mean, pat_mean, line)
        observed = (actual > line).astype(float)
        threshold[str(line)] = {
            "brier": float(np.mean(np.square(probability - observed))),
            "observedRate": float(np.mean(observed)), "meanProbability": float(np.mean(probability)),
        }
    return {
        "rows": len(actual), "meanActual": float(np.mean(actual)), "meanProjection": float(np.mean(expected)),
        "mae": float(np.mean(np.abs(actual - expected))),
        "rmse": float(math.sqrt(np.mean(np.square(actual - expected)))),
        "averageThresholdBrier": float(np.mean([value["brier"] for value in threshold.values()])),
        "thresholds": threshold,
    }


def compound_over_probability(fg_mean, pat_mean, line):
    probability = np.zeros(len(fg_mean))
    for field_goals in range(0, 9):
        fg_probability = poisson.pmf(field_goals, fg_mean)
        minimum_pat = max(0, math.floor(line - 3 * field_goals) + 1)
        probability += fg_probability * poisson.sf(minimum_pat - 1, pat_mean)
    probability += poisson.sf(8, fg_mean)
    return np.clip(probability, 0, 1)


def field_goal_gate(foundation, candidate):
    wins = sum(
        candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"]
        for line in common.LINES
    )
    return {
        "pass": candidate["meanPoissonDeviance"] < foundation["meanPoissonDeviance"]
        and candidate["mae"] < foundation["mae"]
        and candidate["averageThresholdBrier"] < foundation["averageThresholdBrier"] and wins >= 3,
        "thresholdBrierWins": wins,
    }


def kicking_points_gate(foundation, candidate):
    wins = sum(
        candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"]
        for line in KICKING_POINT_LINES
    )
    return {
        "pass": candidate["mae"] < foundation["mae"] and candidate["rmse"] < foundation["rmse"]
        and candidate["averageThresholdBrier"] < foundation["averageThresholdBrier"] and wins >= 4,
        "thresholdBrierWins": wins,
    }


def kicking_points_bootstrap(actual, components, clusters, iterations=2_000):
    unique = np.unique(clusters)
    indices = {cluster: np.flatnonzero(clusters == cluster) for cluster in unique}
    rng = np.random.default_rng(20261015)
    values = {"maeDelta": [], "rmseDelta": [], "averageThresholdBrierDelta": []}
    for _ in range(iterations):
        chosen = rng.choice(unique, size=len(unique), replace=True)
        take = np.concatenate([indices[cluster] for cluster in chosen])
        metrics = {}
        for name, component in components.items():
            metrics[name] = kicking_points_metrics(
                actual[take], component["fg_made"][take], component["pat_made"][take]
            )
        values["maeDelta"].append(metrics["selected_components"]["mae"] - metrics["foundation"]["mae"])
        values["rmseDelta"].append(metrics["selected_components"]["rmse"] - metrics["foundation"]["rmse"])
        values["averageThresholdBrierDelta"].append(
            metrics["selected_components"]["averageThresholdBrier"] - metrics["foundation"]["averageThresholdBrier"]
        )
    return {
        "clusters": len(unique), "iterations": iterations,
        "deltaDefinition": "selected components minus foundation; negative favors candidate",
        **{name: common.interval(sample) for name, sample in values.items()},
    }


if __name__ == "__main__":
    main()
