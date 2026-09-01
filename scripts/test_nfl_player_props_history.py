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

print("NFL player-props history: shifted feature and future-outcome leakage checks passed")
