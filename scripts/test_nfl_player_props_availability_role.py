#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import pathlib
import sys
import tempfile

import pandas as pd


SCRIPT = pathlib.Path(__file__).parent / "operator" / "tournament_nfl_player_props_availability_role.py"
spec = importlib.util.spec_from_file_location("nfl_props_availability_role", SCRIPT)
if not spec or not spec.loader:
    raise RuntimeError("availability role module could not be loaded")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


frame = pd.DataFrame([
    {
        "season": 2026, "week": 1, "game_id": "g1", "team": "AAA", "player_id": "p1",
        "position": "RB", "prior_pass_attempt_share_season_avg": 0.0,
        "prior_rush_attempt_share_season_avg": 0.60, "prior_target_share_season_avg": 0.10,
        "prior_offense_snap_pct_avg5": 0.70,
    },
    {
        "season": 2026, "week": 1, "game_id": "g1", "team": "AAA", "player_id": "p2",
        "position": "RB", "prior_pass_attempt_share_season_avg": 0.0,
        "prior_rush_attempt_share_season_avg": 0.30, "prior_target_share_season_avg": 0.08,
        "prior_offense_snap_pct_avg5": 0.35,
    },
    {
        "season": 2026, "week": 1, "game_id": "g1", "team": "AAA", "player_id": "p3",
        "position": "WR", "prior_pass_attempt_share_season_avg": 0.0,
        "prior_rush_attempt_share_season_avg": 0.02, "prior_target_share_season_avg": 0.25,
        "prior_offense_snap_pct_avg5": 0.80,
    },
])
injuries = pd.DataFrame([
    {
        "season": 2026, "week": 1, "team": "AAA", "gsis_id": "p1",
        "report_status": "Out", "practice_status": "Did Not Participate In Practice",
    },
    {
        "season": 2026, "week": 1, "team": "AAA", "gsis_id": "p3",
        "report_status": "Questionable", "practice_status": "Limited Participation in Practice",
    },
])

with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    injury_path = root / "2026.parquet"
    injuries.to_parquet(injury_path, index=False)
    enriched, metadata, groups = module.injury_features(frame, root)

assert metadata["injuryRows"] == 2
assert set(groups) == {"final", "practice", "combined"}
by_player = enriched.set_index("player_id")
assert by_player.loc["p1", "availability_report_out"] == 1.0
assert by_player.loc["p2", "availability_evidence"] == 0.0
assert by_player.loc["p2", "availability_teammate_vacated_rush_attempt_share_season_avg_final"] == 0.60
assert by_player.loc["p1", "availability_teammate_vacated_rush_attempt_share_season_avg_final"] == 0.0
assert by_player.loc["p3", "availability_teammate_vacated_target_share_season_avg_final"] == 0.0
print("NFL player props availability-role feature tests passed.")
