#!/usr/bin/env python3
"""Contract tests for the independent Receiving Yards point tournament."""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import numpy as np


ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/operator/tournament_nfl_player_props_receiving_yards.py"
SPEC = importlib.util.spec_from_file_location("props_receiving_yards_test_target", PATH)
if not SPEC or not SPEC.loader:
    raise RuntimeError(f"cannot load {PATH}")
TARGET = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = TARGET
SPEC.loader.exec_module(TARGET)


def test_candidate_identity_is_frozen() -> None:
    assert TARGET.candidate_identity("direct_blend_75") == ("direct", 0.75, False)
    assert TARGET.candidate_identity("wr_direct_blend_50") == ("direct", 0.50, True)


def test_role_gate_changes_only_wide_receivers() -> None:
    reference = np.array([40.0, 30.0, 20.0])
    component = np.array([60.0, 50.0, 10.0])
    positions = np.array(["WR", "TE", "RB"])
    candidate = TARGET.candidate_projection(
        reference, component, positions, "wr_direct_blend_50",
    )
    np.testing.assert_allclose(candidate, np.array([50.0, 30.0, 20.0]))


if __name__ == "__main__":
    test_candidate_identity_is_frozen()
    test_role_gate_changes_only_wide_receivers()
    print("NFL player props Receiving Yards contract tests passed.")
