#!/usr/bin/env python3
"""Focused identity and chronology checks for NFL player-prop matchup features."""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import numpy as np
import pandas as pd


path = pathlib.Path(__file__).parent / "operator" / "tournament_nfl_player_props_matchup_features.py"
spec = importlib.util.spec_from_file_location("nfl_props_matchup_features", path)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

rows = pd.DataFrame({
    "season": [2025, 2025, 2025, 2025],
    "week": [1, 1, 2, 2],
    "game_id": ["2025_01_A_B", "2025_01_A_B", "2025_02_A_B", "2025_02_A_B"],
    "team": ["A", "B", "A", "B"],
    "opponent": ["B", "A", "B", "A"],
    "pass_yards_per_attempt": [10.0, 20.0, 30.0, 40.0],
})

legacy, names = module.add_shifted_team_features(rows)
corrected, corrected_names = module.add_opponent_shifted_team_features(rows)
assert names == corrected_names

feature = "matchup_opponent_allowed_pass_yards_per_attempt_ewm"
legacy_a_week_2 = legacy[(legacy["team"] == "A") & (legacy["week"] == 2)].iloc[0]
corrected_a_week_2 = corrected[(corrected["team"] == "A") & (corrected["week"] == 2)].iloc[0]

# The legacy path attaches A's own defense: B produced 20.0 against A in Week 1.
assert legacy_a_week_2[feature] == 20.0
# The corrected path attaches opponent B's defense: A produced 10.0 against B.
assert corrected_a_week_2[feature] == 10.0

# Both paths are strictly shifted and cannot inspect the current game.
assert np.isnan(corrected[(corrected["team"] == "A") & (corrected["week"] == 1)].iloc[0][feature])
assert corrected_a_week_2["matchup_team_pass_yards_per_attempt_ewm"] == 10.0

try:
    module.add_shifted_team_features(rows, opponent_identity="unknown")
except ValueError:
    pass
else:
    raise AssertionError("invalid opponent identity must fail closed")

position_path = pathlib.Path(__file__).parent / "operator" / "tournament_nfl_player_props_position_matchup.py"
position_spec = importlib.util.spec_from_file_location("nfl_props_position_matchup", position_path)
assert position_spec and position_spec.loader
position_module = importlib.util.module_from_spec(position_spec)
sys.modules[position_spec.name] = position_module
position_spec.loader.exec_module(position_module)

position_rows = []
for week, a_yards, b_yards in ((1, 100.0, 200.0), (2, 300.0, 400.0)):
    for team, opponent, yards in (("A", "B", a_yards), ("B", "A", b_yards)):
        position_rows.append({
            "season": 2025,
            "week": week,
            "game_id": f"2025_0{week}_A_B",
            "team": team,
            "opponent": opponent,
            "position": "WR",
            "passing_attempts": 0.0,
            "passing_completions": 0.0,
            "passing_yards": 0.0,
            "rushing_attempts": 0.0,
            "rushing_yards": 0.0,
            "targets": 10.0,
            "receptions": 5.0,
            "receiving_yards": yards,
        })
position_frame = pd.DataFrame(position_rows)
position_features, _ = position_module.position_matchup_features(position_frame)
position_frame = position_module.attach_position_features(position_frame, position_features)
position_feature = "matchup_position_opponent_allowed_receiving_yards_ewm"
assert position_frame[(position_frame["team"] == "A") & (position_frame["week"] == 2)].iloc[0][position_feature] == 100.0
assert position_frame[(position_frame["team"] == "B") & (position_frame["week"] == 2)].iloc[0][position_feature] == 200.0
assert np.isnan(position_frame[position_frame["week"] == 1].iloc[0][position_feature])

print("NFL player-props matchup features: team/position opponent identity and chronology checks passed")
