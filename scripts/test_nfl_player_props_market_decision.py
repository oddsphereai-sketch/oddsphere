#!/usr/bin/env python3
"""Focused chronology, market-consensus, and touchdown-context invariants."""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import numpy as np
import pandas as pd


def module(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(path))
    assert spec and spec.loader
    value = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = value
    spec.loader.exec_module(value)
    return value


residual = module("nfl_props_market_decision_test_residual", "scripts/operator/calibrate_nfl_player_props_market_residual.py")
lanes = module("nfl_props_actionable_lane_test", "scripts/operator/evaluate_nfl_player_props_actionable_lanes.py")
touchdown = module("nfl_props_market_decision_test_td", "scripts/operator/tournament_nfl_player_props_touchdowns.py")
contract = json.loads(pathlib.Path("lib/services/football/nflPlayerPropsMarketResidualContract.json").read_text())
decision = json.loads(pathlib.Path("lib/services/football/nflPlayerPropsDecisionContract.json").read_text())
td_contract = json.loads(pathlib.Path("lib/services/football/nflPlayerPropsTouchdownContract.json").read_text())

market = np.array([0.50, 0.40])
model = np.array([0.70, 0.20])
blended = residual.residual_probability(model, market, 0.2)
assert market[0] < blended[0] < model[0]
assert model[1] < blended[1] < market[1]
assert pd.Timestamp(contract["selectionEnd"]) < pd.Timestamp(contract["confirmationStart"])
assert min(contract["lambdaCandidates"]) == contract["minimumModelWeight"] > 0
assert contract["marketBenchmark"] == "independent_book_consensus_excluding_target_book_with_qb_passing_cross_line_transport"
assert contract["promotionPolicy"]["receiving_yards"] == {"bestAngle": True, "lean": True, "watchlist": True}
assert contract["promotionPolicy"]["receptions"] == {"bestAngle": True, "lean": True, "watchlist": True}
assert all(policy == {"bestAngle": True, "lean": True, "watchlist": True} for policy in contract["promotionPolicy"].values())
assert contract["ownerApprovedForwardException"] is True
assert lanes.RELEASE == "nfl_player_props_actionable_lane_evidence_2026_08_25_r3_production_release"
assert decision["decisionRelease"] == "nfl_player_props_decision_2026_09_01_r8_market_coherent_projection"
assert decision["modelRelease"] == "nfl_player_props_distribution_model_2026_09_01_r5_market_coherent_projection"
assert decision["calibrationRelease"] == "nfl_player_props_distribution_calibration_2026_09_01_r5_market_coherent_projection"
assert decision["quarterbackPassingProjection"]["marketWeight"] == 0.9
assert decision["quarterbackPassingProjection"]["recentRoleWeight"] == 0.1
assert decision["quarterbackPassingProjection"]["singleBookMayAuthorizeAction"] is False
assert decision["quarterbackRole"]["confirmedStarterParticipationFloor"] == 0.9
assert decision["quarterbackRole"]["projectedStarterParticipationFloor"] == 0.75
assert decision["passingYardsWatchlist"]["maximumGradeWithoutSameLineIndependentActionConfirmation"] == "Watchlist"
assert decision["volumeAndYardage"]["bestAngle"]["minimumIndependentBooks"] == 1
assert decision["maximumRawMarketDivergence"] == 0.48
assert all(lane == {"eligibleSides": ["over", "under"], "bestAngle": True, "lean": True, "watchlist": True} for lane in decision["marketLanes"].values())
assert decision["volumeAndYardage"]["movementSupportedLean"]["minimumEv"] == 0.03
assert decision["volumeAndYardage"]["movementSupportedBestAngle"]["minimumProbabilityEdge"] == 0.03
assert decision["releaseEvidence"]["ownerApprovedForwardException"] is True
assert td_contract["requiredOpportunityFeatures"] == ["participation", "red_zone", "goal_line", "team_implied_touchdowns", "opponent_touchdown_allowance"]

rows = pd.DataFrame([
    {"game_id": "g", "team": "HOME"},
    {"game_id": "g", "team": "AWAY"},
    {"game_id": "missing", "team": "HOME"},
])
games = pd.DataFrame([{"game_id": "g", "home_team": "HOME", "away_team": "AWAY", "spread_line": 7.0, "total_line": 49.0}])
enriched = touchdown.add_team_expectation(rows, games)
assert abs(enriched.loc[0, "team_implied_touchdowns"] - 4.0) < 1e-12
assert abs(enriched.loc[1, "team_implied_touchdowns"] - 3.0) < 1e-12
assert pd.isna(enriched.loc[2, "team_implied_touchdowns"])

print("NFL player-props market chronology, ladder, and team-expectation invariants passed.")
