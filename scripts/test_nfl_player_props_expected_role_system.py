#!/usr/bin/env python3
"""Contract tests for the roster-constrained expected-role system."""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
SPEC = importlib.util.spec_from_file_location("props_expected_role_test_target", PATH)
if not SPEC or not SPEC.loader:
    raise RuntimeError(f"cannot load {PATH}")
TARGET = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = TARGET
SPEC.loader.exec_module(TARGET)


def test_player_identity_normalization() -> None:
    assert TARGET.normalize_player("Aaron Jones Sr.") == TARGET.normalize_player("Aaron Jones")
    assert TARGET.normalize_player("DeVonta Smith") == "devontasmith"


def test_position_group_shares_are_conserved() -> None:
    frame = pd.DataFrame(
        {
            "season": [2026] * 5,
            "week": [1] * 5,
            "game_id": ["G1"] * 5,
            "team": ["BUF"] * 5,
            "position": ["RB", "FB", "WR", "WR", "TE"],
            "rushing_attempts": [8.0, 2.0, 1.0, 0.0, 0.0],
            "targets": [2.0, 1.0, 6.0, 3.0, 4.0],
        }
    )
    result = TARGET.add_role_shares(frame)
    grouped = result.groupby("expected_role_group", observed=True)
    rush = grouped["expected_role_rush_share"].sum()
    targets = grouped["expected_role_target_share"].sum()
    assert rush["BACK"] == 1.0
    assert rush["WR"] == 1.0
    assert rush["TE"] == 0.0
    assert targets["BACK"] == 1.0
    assert targets["WR"] == 1.0
    assert targets["TE"] == 1.0


if __name__ == "__main__":
    test_player_identity_normalization()
    test_position_group_shares_are_conserved()
    print("NFL player props expected-role contract tests passed.")
