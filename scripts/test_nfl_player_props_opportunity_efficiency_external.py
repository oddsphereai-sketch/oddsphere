#!/usr/bin/env python3
"""Contract tests for the external opportunity-efficiency hierarchy."""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_efficiency_external.py"
SPEC = importlib.util.spec_from_file_location("props_hierarchy_test_target", PATH)
if not SPEC or not SPEC.loader:
    raise RuntimeError(f"cannot load {PATH}")
TARGET = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = TARGET
SPEC.loader.exec_module(TARGET)


def test_market_relevant_features() -> None:
    groups = {
        "base": ["prior_target_share_ewm"],
        "state": ["external_state_team_plays_ewm"],
        "pfr": ["external_pfr_rush_x", "external_pfr_rec_x"],
        "ftn": ["external_ftn_rusher_x", "external_ftn_receiver_x"],
        "ngs": ["external_ngs_rushing_x", "external_ngs_receiving_x"],
    }
    rushing = TARGET.relevant_external_features("rushing", groups)
    receiving = TARGET.relevant_external_features("receiving", groups)
    assert "external_ngs_rushing_x" in rushing and "external_ngs_receiving_x" not in rushing
    assert "external_ftn_receiver_x" in receiving and "external_ftn_rusher_x" not in receiving


def test_team_budget_aggregation() -> None:
    frame = pd.DataFrame(
        {
            "season": [2026, 2026],
            "week": [1, 1],
            "game_id": ["G1", "G1"],
            "team": ["BUF", "BUF"],
            "player_id": ["P1", "P2"],
            "rushing_attempts": [10.0, 5.0],
            "targets": [2.0, 8.0],
            "feature": [3.0, 3.0],
        }
    )
    teams = TARGET.team_games(frame, ["feature"])
    assert len(teams) == 1
    assert teams.loc[0, "rushing_attempts"] == 15.0
    assert teams.loc[0, "targets"] == 10.0
    assert teams.loc[0, "feature"] == 3.0


if __name__ == "__main__":
    test_market_relevant_features()
    test_team_budget_aggregation()
    print("NFL player props opportunity-efficiency contract tests passed.")
