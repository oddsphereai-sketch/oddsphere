#!/usr/bin/env python3
"""Replay the frozen rich-state score recipe on 2026 Weeks 1-2."""

from __future__ import annotations

import copy
import json
import math
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd

import build_nfl_pregame_features as build
import tournament_nfl_weekly_joint_score_engine_r1 as r1
from tournament_nfl_market_context_residual_r1 import add_market_context, sha256_file


REPLAY_RELEASE = "nfl_full_state_2026_score_replay_2026_09_25_r1"
PBP_SHA256 = "c4f6d3969cb6d4f58456de60a01087b62acb3c2619cf0299934501a40ee92b49"
RECIPE = r1.Recipe("ridge_100", ("ridge_100",), 0.9)


def aggregate_2026_pbp(path: pathlib.Path) -> pd.DataFrame:
    raw = pd.read_parquet(path, columns=build.PBP_COLUMNS)
    raw = raw[(raw["season_type"] == "REG") & raw["week"].isin([1, 2]) & raw["posteam"].notna() & raw["defteam"].notna()].copy()
    raw["posteam"] = raw["posteam"].map(build.normalize_team)
    raw["defteam"] = raw["defteam"].map(build.normalize_team)
    dropback = raw["qb_dropback"].fillna(0).eq(1)
    rush = raw["rush_attempt"].fillna(0).eq(1) & ~raw["qb_kneel"].fillna(0).eq(1)
    valid = (dropback | rush) & ~raw["qb_spike"].fillna(0).eq(1) & ~raw["aborted_play"].fillna(0).eq(1) & raw["epa"].notna()
    plays = raw[valid].copy()
    plays["is_dropback"] = dropback[valid]
    plays["is_rush"] = rush[valid]
    plays["pass_epa_value"] = plays["epa"].where(plays["is_dropback"])
    plays["rush_epa_value"] = plays["epa"].where(plays["is_rush"])
    plays["early_down_pass_epa_value"] = plays["epa"].where(plays["is_dropback"] & plays["down"].isin([1.0, 2.0]))
    plays["explosive"] = np.where(
        plays["is_dropback"], plays["yards_gained"].fillna(0).ge(20), plays["yards_gained"].fillna(0).ge(10)
    ).astype(float)
    plays["turnover"] = (plays["interception"].fillna(0).eq(1) | plays["fumble_lost"].fillna(0).eq(1)).astype(float)
    plays["sack_value"] = plays["sack"].fillna(0).where(plays["is_dropback"])
    plays["no_huddle_value"] = plays["no_huddle"].fillna(0).astype(float)
    plays["pass_oe_value"] = plays["pass_oe"]
    group_cols = ["week", "game_id", "posteam", "defteam"]
    aggregate = plays.groupby(group_cols, observed=True).agg(
        epa=("epa", "mean"),
        pass_epa=("pass_epa_value", "mean"),
        rush_epa=("rush_epa_value", "mean"),
        success=("success", "mean"),
        early_down_pass_epa=("early_down_pass_epa_value", "mean"),
        explosive_rate=("explosive", "mean"),
        sack_rate=("sack_value", "mean"),
        turnover_rate=("turnover", "mean"),
        plays=("epa", "size"),
        no_huddle_rate=("no_huddle_value", "mean"),
        pass_oe=("pass_oe_value", "mean"),
    ).reset_index()
    redzone = plays[plays["yardline_100"].le(20) & plays["fixed_drive"].notna()].copy()
    rz_drives = redzone.groupby(group_cols + ["fixed_drive"], observed=True).agg(td=("touchdown", "max")).reset_index()
    rz_rate = rz_drives.groupby(group_cols, observed=True)["td"].mean().rename("redzone_td_rate").reset_index()
    return aggregate.merge(rz_rate, on=group_cols, how="left")


def load_states(root: pathlib.Path) -> dict[str, build.TeamState]:
    manifest = json.loads((root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json").read_text())
    path = pathlib.Path(manifest["stateFile"])
    if sha256_file(path) != manifest["stateFileSha256"]:
        raise RuntimeError("post-2025 state checksum mismatch")
    source = json.loads(path.read_text())["teamStates"]
    states: dict[str, build.TeamState] = {}
    for team, row in source.items():
        state = build.TeamState(
            off_fast=dict(row["offFast"]), off_slow=dict(row["offSlow"]),
            def_fast=dict(row["defFast"]), def_slow=dict(row["defSlow"]),
            off_adj=dict(row["offAdjusted"]), def_adj=dict(row["defAdjusted"]),
            elo=float(row["elo"]), games=int(row["games"]),
            last_qb_id=row.get("lastQbId"), last_coach=row.get("lastCoach"),
        )
        state.regress_offseason()
        states[team] = state
    return states


def snapshot(state: build.TeamState) -> build.TeamState:
    return copy.deepcopy(state)


def game_feature_row(game: dict[str, Any], states: dict[str, build.TeamState], columns: list[str]) -> dict[str, Any]:
    home = build.normalize_team(game["homeTeam"])
    away = build.normalize_team(game["awayTeam"])
    home_state = states[home]
    away_state = states[away]
    row: dict[str, Any] = {column: math.nan for column in columns}
    row.update({
        "feature_release": build.FEATURE_RELEASE,
        "game_id": str(game["providerGameId"]), "season": 2026, "week": int(game["week"]),
        "gameday": str(game["scheduledStart"])[:10], "home_team": home, "away_team": away,
        "neutral_site": 0.0, "division_game": 0.0, "home_rest": 7.0, "away_rest": 7.0,
        "rest_diff": 0.0, "temperature": math.nan, "wind": math.nan,
        "roof_indoor": 0.0, "surface_grass": math.nan,
        "home_score": float(game["homeScore"]), "away_score": float(game["awayScore"]),
        "actual_margin": float(game["homeScore"] - game["awayScore"]),
        "actual_total": float(game["homeScore"] + game["awayScore"]),
        "market_home_margin": float(game["marketHomeMargin"]), "market_total": float(game["marketTotal"]),
        "home_moneyline": float(game["homeMoneyline"]), "away_moneyline": float(game["awayMoneyline"]),
        "home_spread_odds": float(game["homeSpreadOdds"]), "away_spread_odds": float(game["awaySpreadOdds"]),
        "over_odds": float(game["overOdds"]), "under_odds": float(game["underOdds"]),
        "published_home": float(game["publishedExpectedHomeScore"]),
        "published_away": float(game["publishedExpectedAwayScore"]),
    })
    build.state_features("home", home_state, row)
    build.state_features("away", away_state, row)
    row["elo_diff"] = home_state.elo - away_state.elo
    for metric, prior in build.METRIC_PRIORS.items():
        row[f"home_matchup_fast_{metric}"] = home_state.off_fast[metric] - (away_state.def_fast[metric] - prior)
        row[f"away_matchup_fast_{metric}"] = away_state.off_fast[metric] - (home_state.def_fast[metric] - prior)
        row[f"home_matchup_slow_{metric}"] = home_state.off_slow[metric] - (away_state.def_slow[metric] - prior)
        row[f"away_matchup_slow_{metric}"] = away_state.off_slow[metric] - (home_state.def_slow[metric] - prior)
    return row


def update_week(
    week_games: list[dict[str, Any]],
    states: dict[str, build.TeamState],
    metrics: dict[tuple[int, str], dict[str, Any]],
) -> None:
    before = {team: snapshot(state) for team, state in states.items()}
    for game in week_games:
        home = build.normalize_team(game["homeTeam"])
        away = build.normalize_team(game["awayTeam"])
        observations = {home: metrics[(int(game["week"]), home)], away: metrics[(int(game["week"]), away)]}
        scores = {home: float(game["homeScore"]), away: float(game["awayScore"])}
        for team, opponent in ((home, away), (away, home)):
            observed = observations[team]
            allowed = observations[opponent]
            state = states[team]
            pre_opponent = before[opponent]
            for metric, prior in build.METRIC_PRIORS.items():
                obs = scores[team] if metric == "points" else build.finite(observed.get(metric))
                opp_obs = scores[opponent] if metric == "points" else build.finite(allowed.get(metric))
                state.off_fast[metric] = build.ewm(state.off_fast[metric], obs, build.FAST_ALPHA)
                state.off_slow[metric] = build.ewm(state.off_slow[metric], obs, build.SLOW_ALPHA)
                state.def_fast[metric] = build.ewm(state.def_fast[metric], opp_obs, build.FAST_ALPHA)
                state.def_slow[metric] = build.ewm(state.def_slow[metric], opp_obs, build.SLOW_ALPHA)
                state.off_adj[metric] = build.ewm(state.off_adj[metric], obs - (pre_opponent.def_slow[metric] - prior), build.SLOW_ALPHA)
                state.def_adj[metric] = build.ewm(state.def_adj[metric], opp_obs - (pre_opponent.off_slow[metric] - prior), build.SLOW_ALPHA)
            state.games += 1
        expected_home = 1.0 / (1.0 + math.pow(10.0, -(before[home].elo - before[away].elo + 45.0) / 400.0))
        margin = scores[home] - scores[away]
        outcome = 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5
        multiplier = math.log1p(abs(margin)) * (2.2 / ((abs(before[home].elo - before[away].elo) * 0.001) + 2.2))
        change = 20.0 * multiplier * (outcome - expected_home)
        states[home].elo += change
        states[away].elo -= change


def main() -> None:
    root = pathlib.Path.cwd()
    input_path = root / "football-research/reports/nfl_2026_score_engine_replay_inputs_2026_09_25_r1.json"
    source = json.loads(input_path.read_text())
    pbp_path = root / "football-research/cache/nflverse/real-model-r1/pbp/2026.parquet"
    if sha256_file(pbp_path) != PBP_SHA256:
        raise RuntimeError("2026 play-by-play checksum mismatch")
    aggregates = aggregate_2026_pbp(pbp_path)
    metrics = {(int(row.week), str(row.posteam)): row._asdict() for row in aggregates.itertuples(index=False)}
    states = load_states(root)
    historical_manifest = json.loads((root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json").read_text())
    historical = pd.read_parquet(historical_manifest["featureFile"])
    columns = list(historical.columns) + ["published_home", "published_away"]
    rows: list[dict[str, Any]] = []
    for week in (1, 2):
        week_games = [game for game in source["games"] if int(game["week"]) == week]
        rows.extend(game_feature_row(game, states, columns) for game in week_games)
        update_week(week_games, states, metrics)
    current = add_market_context(pd.DataFrame(rows).sort_values(["week", "game_id"]).reset_index(drop=True))

    training = historical[historical["season"].between(2018, 2025)].reset_index(drop=True)
    train_teams, features = r1.oriented_team_frame(training)
    current_teams, current_features = r1.oriented_team_frame(current)
    if current_features != features:
        raise RuntimeError("2026 rich-state feature schema drift")
    model = r1.fit_models(train_teams, features, RECIPE.components)["ridge_100"]
    independent_team = np.asarray(model.predict(current_teams[features]), dtype=float)
    independent = r1.pair_games(current, current_teams, independent_team)
    calibrated = r1.pair_games(current, current_teams, r1.apply_recipe(current_teams, independent_team, RECIPE.market_weight))
    published_home = current["published_home"].to_numpy(float)
    published_away = current["published_away"].to_numpy(float)
    published = {"home": published_home, "away": published_away, "margin": published_home - published_away, "total": published_home + published_away}
    historical_report = json.loads((root / "football-research/reports/nfl_weekly_joint_score_engine_tournament_2026_09_25_r1.json").read_text())
    margin_sigma = float(historical_report["residualScale"]["margin"])
    total_sigma = float(historical_report["residualScale"]["total"])
    probability = r1.probability_report(current, calibrated, margin_sigma, total_sigma)
    result = {
        "replayRelease": REPLAY_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "readOnly": True,
        "productionChanged": False,
        "pbpSha256": PBP_SHA256,
        "games": len(current),
        "recipe": {"name": RECIPE.name, "components": list(RECIPE.components), "marketWeight": RECIPE.market_weight},
        "limitations": ["current QB, injury, continuity, rest, venue, and weather fields use frozen training-median imputation"],
        "independent": r1.score_metrics(current, independent),
        "calibrated": r1.score_metrics(current, calibrated),
        "published": r1.score_metrics(current, published),
        "probability": probability,
        "gamePredictions": [
            {
                "gameId": str(current.iloc[index]["game_id"]),
                "week": int(current.iloc[index]["week"]),
                "homeTeam": str(current.iloc[index]["home_team"]),
                "awayTeam": str(current.iloc[index]["away_team"]),
                "candidateHome": float(calibrated["home"][index]),
                "candidateAway": float(calibrated["away"][index]),
            }
            for index in range(len(current))
        ],
        "byWeek": {
            str(week): {
                "candidate": r1.score_metrics(
                    current[current["week"].eq(week)].reset_index(drop=True),
                    {key: value[current["week"].eq(week).to_numpy()] for key, value in calibrated.items()},
                ),
                "published": r1.score_metrics(
                    current[current["week"].eq(week)].reset_index(drop=True),
                    {key: value[current["week"].eq(week).to_numpy()] for key, value in published.items()},
                ),
            }
            for week in (1, 2)
        },
    }
    output_path = root / "football-research/reports" / f"{REPLAY_RELEASE}.json"
    output_path.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"report": str(output_path), **result}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
