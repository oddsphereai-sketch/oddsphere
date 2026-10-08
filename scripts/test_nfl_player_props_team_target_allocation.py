#!/usr/bin/env python3
"""Contract tests for cumulative team-target challenger composition."""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/operator/tournament_nfl_player_props_team_target_allocation.py"
SPEC = importlib.util.spec_from_file_location("props_team_target_test_target", PATH)
if not SPEC or not SPEC.loader:
    raise RuntimeError(f"cannot load {PATH}")
TARGET = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = TARGET
SPEC.loader.exec_module(TARGET)


def test_synthetic_component_reconstructs_cumulative_candidate() -> None:
    independent = np.array([10.0, 20.0, 30.0])
    foundation_component = np.array([14.0, 18.0, 34.0])
    challenger_component = np.array([16.0, 24.0, 28.0])
    foundation_weight = 0.50
    increment_weight = 0.75

    foundation_projection = (
        (1.0 - foundation_weight) * independent
        + foundation_weight * foundation_component
    )
    expected = (
        (1.0 - increment_weight) * foundation_projection
        + increment_weight * challenger_component
    )
    component, total_weight = TARGET.synthetic_component(
        foundation_component,
        challenger_component,
        foundation_weight,
        increment_weight,
    )
    reconstructed = (1.0 - total_weight) * independent + total_weight * component

    np.testing.assert_allclose(reconstructed, expected)
    assert total_weight == 0.875


def test_foundation_weight_is_read_from_frozen_artifact() -> None:
    projections = pd.DataFrame(
        {
            "market": ["receptions", "receptions", "receiving_yards"],
            "frozen_blend_weight": [0.50, 0.50, 0.75],
        }
    )
    assert TARGET.foundation_weight_for_market(projections, "receptions") == 0.50
    assert TARGET.foundation_weight_for_market(projections, "receiving_yards") == 0.75


if __name__ == "__main__":
    test_synthetic_component_reconstructs_cumulative_candidate()
    test_foundation_weight_is_read_from_frozen_artifact()
    print("NFL player props team-target allocation contract tests passed.")
