#!/usr/bin/env python3
"""Focused future-outcome leakage checks for the NFL props history builder."""

from __future__ import annotations

import importlib.util
import pathlib

import pandas as pd


script = pathlib.Path(__file__).parent / "operator" / "build_nfl_player_props_history.py"
spec = importlib.util.spec_from_file_location("nfl_props_history", script)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

rows = pd.DataFrame([
    {"player_id": "p1", "season": 2025, "week": 1, "game_id": "g1", "participated": 1.0, "passing_yards": 100.0},
    {"player_id": "p2", "season": 2025, "week": 1, "game_id": "g1", "participated": 1.0, "passing_yards": 50.0},
    {"player_id": "p1", "season": 2025, "week": 2, "game_id": "g2", "participated": 1.0, "passing_yards": 200.0},
    {"player_id": "p2", "season": 2025, "week": 2, "game_id": "g2", "participated": 0.0, "passing_yards": 0.0},
    {"player_id": "p1", "season": 2025, "week": 3, "game_id": "g3", "participated": 1.0, "passing_yards": 300.0},
    {"player_id": "p2", "season": 2025, "week": 3, "game_id": "g3", "participated": 1.0, "passing_yards": 75.0},
])
features, columns = module.add_player_prior_features(rows, ["participated", "passing_yards"])
p1 = features[features["player_id"].eq("p1")].sort_values("week")
assert pd.isna(p1.iloc[0]["prior_passing_yards_lag1"])
assert p1.iloc[1]["prior_passing_yards_lag1"] == 100.0
assert p1.iloc[2]["prior_passing_yards_avg3"] == 150.0
assert features[(features["player_id"].eq("p2")) & (features["week"].eq(3))].iloc[0]["prior_passing_yards_avg5"] == 50.0
assert features[(features["player_id"].eq("p2")) & (features["week"].eq(3))].iloc[0]["prior_participated_avg5"] == 0.5
assert "passing_yards" not in columns

changed = rows.copy()
changed.loc[changed["week"].eq(3), "passing_yards"] = 9999.0
changed_features, _ = module.add_player_prior_features(changed, ["participated", "passing_yards"])
cols = ["player_id", "week", "prior_passing_yards_lag1", "prior_passing_yards_avg3", "prior_participated_avg5"]
before = features[features["week"].le(3)][cols].reset_index(drop=True)
after = changed_features[changed_features["week"].le(3)][cols].reset_index(drop=True)
pd.testing.assert_frame_equal(before, after)

team = pd.DataFrame([
    {
        "season": 2025, "week": 1, "game_id": "2025_01_A_B", "team": "A", "opponent": "B",
        "team_pass_attempts": 10.0, "team_offensive_plays": 50.0,
    },
    {
        "season": 2025, "week": 1, "game_id": "2025_01_A_B", "team": "B", "opponent": "A",
        "team_pass_attempts": 20.0, "team_offensive_plays": 60.0,
    },
    {
        "season": 2025, "week": 2, "game_id": "2025_02_A_B", "team": "A", "opponent": "B",
        "team_pass_attempts": 30.0, "team_offensive_plays": 70.0,
    },
    {
        "season": 2025, "week": 2, "game_id": "2025_02_A_B", "team": "B", "opponent": "A",
        "team_pass_attempts": 40.0, "team_offensive_plays": 80.0,
    },
])
legacy_team, team_columns = module.add_team_prior_features(team)
corrected_team, corrected_team_columns = module.add_opponent_team_prior_features(team)
assert team_columns == corrected_team_columns
feature = "prior_opponent_allowed_pass_attempts_ewm"
assert legacy_team[(legacy_team["team"] == "A") & (legacy_team["week"] == 2)].iloc[0][feature] == 20.0
assert corrected_team[(corrected_team["team"] == "A") & (corrected_team["week"] == 2)].iloc[0][feature] == 10.0
assert pd.isna(corrected_team[(corrected_team["team"] == "A") & (corrected_team["week"] == 1)].iloc[0][feature])

try:
    module.add_team_prior_features(team, opponent_identity="unknown")
except ValueError:
    pass
else:
    raise AssertionError("invalid opponent identity must fail closed")

print("NFL player-props history: shifted features, opponent identity, and leakage checks passed")
