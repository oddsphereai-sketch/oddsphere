#!/usr/bin/env python3
"""Focused leakage tests for the NFL props external-feature builder."""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_module():
    path = ROOT / "scripts/operator/build_nfl_player_props_external_features.py"
    spec = importlib.util.spec_from_file_location("props_external_features_test_target", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TARGET = load_module()


class ExternalFeatureLeakageTests(unittest.TestCase):
    def test_player_asof_excludes_same_week(self) -> None:
        spine = pd.DataFrame(
            {
                "season": [2026, 2026, 2026],
                "week": [1, 2, 3],
                "player_id": ["P1", "P1", "P1"],
            }
        )
        source = pd.DataFrame(
            {
                "season": [2026, 2026, 2026],
                "week": [1, 2, 3],
                "source_id": ["P1", "P1", "P1"],
                "metric": [10.0, 20.0, 999.0],
            }
        )

        attached, names = TARGET.asof_player_features(
            spine,
            source,
            spine_id="player_id",
            source_id="source_id",
            metrics=("metric",),
            prefix="external_test",
        )

        self.assertEqual(names, ["external_test_metric_lag1", "external_test_metric_ewm"])
        self.assertTrue(pd.isna(attached.loc[0, "external_test_metric_lag1"]))
        self.assertEqual(attached.loc[1, "external_test_metric_lag1"], 10.0)
        self.assertEqual(attached.loc[2, "external_test_metric_lag1"], 20.0)
        self.assertLess(attached.loc[2, "external_test_metric_ewm"], 20.0)

    def test_team_history_excludes_current_game(self) -> None:
        games = pd.DataFrame(
            {
                "season": [2026, 2026, 2026],
                "week": [1, 2, 3],
                "game_id": ["G1", "G2", "G3"],
                "team": ["BUF", "BUF", "BUF"],
                "metric": [10.0, 20.0, 999.0],
            }
        )

        attached, names = TARGET.shifted_team_features(games, ("metric",), "external_test")

        self.assertEqual(names, ["external_test_metric_avg3", "external_test_metric_ewm"])
        self.assertTrue(pd.isna(attached.loc[0, "external_test_metric_avg3"]))
        self.assertEqual(attached.loc[1, "external_test_metric_avg3"], 10.0)
        self.assertEqual(attached.loc[2, "external_test_metric_avg3"], 15.0)
        self.assertLess(attached.loc[2, "external_test_metric_ewm"], 20.0)

    def test_environment_is_pregame_context(self) -> None:
        # The helper reads one row per game and does not derive any feature from
        # the game's plays or outcomes.
        source = pd.DataFrame(
            {
                "season": [2026],
                "week": [1],
                "season_type": ["REG"],
                "game_id": ["G1"],
                "roof": ["outdoors"],
                "temp": [42],
                "wind": [18],
            }
        )
        original = TARGET.read_columns
        TARGET.read_columns = lambda _paths, _columns: source.copy()
        try:
            attached, names = TARGET.game_environment_features([pathlib.Path("unused")])
        finally:
            TARGET.read_columns = original
        self.assertEqual(attached.loc[0, "external_environment_temperature_f"], 42)
        self.assertEqual(attached.loc[0, "external_environment_wind_mph"], 18)
        self.assertEqual(attached.loc[0, "external_environment_outdoor"], 1.0)
        self.assertIn("external_environment_fixed_roof", names)


if __name__ == "__main__":
    unittest.main()
