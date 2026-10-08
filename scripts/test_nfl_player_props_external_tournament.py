#!/usr/bin/env python3
"""Contract tests for the frozen external-feature tournament."""

from __future__ import annotations

import importlib.util
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py"
SPEC = importlib.util.spec_from_file_location("props_external_tournament_test_target", PATH)
if not SPEC or not SPEC.loader:
    raise RuntimeError(f"cannot load {PATH}")
TARGET = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = TARGET
SPEC.loader.exec_module(TARGET)


def test_market_relevance() -> None:
    groups = {
        "base": ["base"],
        "state": ["state"],
        "pfr": ["external_pfr_pass_x", "external_pfr_rush_x", "external_pfr_rec_x"],
        "ftn": ["external_ftn_passer_x", "external_ftn_rusher_x", "external_ftn_receiver_x"],
        "ngs": ["external_ngs_passing_x", "external_ngs_rushing_x", "external_ngs_receiving_x"],
    }
    passing = TARGET.relevant_features("passing_yards", groups)["full_external"]
    rushing = TARGET.relevant_features("rushing_yards", groups)["full_external"]
    receiving = TARGET.relevant_features("receiving_yards", groups)["full_external"]
    assert "external_ngs_passing_x" in passing and "external_ngs_rushing_x" not in passing
    assert "external_ftn_rusher_x" in rushing and "external_ftn_receiver_x" not in rushing
    assert "external_pfr_rec_x" in receiving and "external_pfr_pass_x" not in receiving


def test_selection_gate() -> None:
    reference = {"mae": 10.0, "rmse": 12.0, "bias": -2.0, "underpredictionRate": 0.6}
    improved = {"mae": 9.0, "rmse": 11.0, "bias": -1.0, "underpredictionRate": 0.55}
    worse_rmse = {**improved, "rmse": 12.1}
    assert TARGET.candidate_passes(reference, improved, 20.0)
    assert not TARGET.candidate_passes(reference, worse_rmse, 20.0)


if __name__ == "__main__":
    test_market_relevance()
    test_selection_gate()
    print("NFL player props external tournament contract tests passed.")
