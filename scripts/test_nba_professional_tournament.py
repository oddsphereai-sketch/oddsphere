#!/usr/bin/env python3
"""Synthetic end-to-end contract test for the NBA score tournament."""

from __future__ import annotations

import json
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from scripts.operator import tournament_nba_professional_model as tournament


rng = np.random.default_rng(20261015)
all_missing_train = tournament.pd.DataFrame({"available": [1.0, 2.0], "later_only": [np.nan, np.nan]})
all_missing_evaluate = tournament.pd.DataFrame({"available": [3.0], "later_only": [4.0]})
missing_x_train, missing_x_evaluate, _ = tournament.design_matrices(
    all_missing_train,
    all_missing_evaluate,
    ["available", "later_only"],
    {"family": "ridge", "alpha": 1.0},
)
assert np.isfinite(missing_x_train).all()
assert np.isfinite(missing_x_evaluate).all()
start = datetime(2023, 1, 1, tzinfo=timezone.utc)
rows = []
game_id = 1
for season_index, season in enumerate((2023, 2024, 2025)):
    for game_index in range(48):
        home_off = 109 + season_index + rng.normal(0, 3)
        away_off = 108 + season_index + rng.normal(0, 3)
        home_def = 109 + rng.normal(0, 2)
        away_def = 110 + rng.normal(0, 2)
        pace = 98 + rng.normal(0, 2)
        margin = (home_off + away_def) - (away_off + home_def) + 2.2 + rng.normal(0, 4)
        total = (home_off + away_off) * pace / 100 + rng.normal(0, 6)
        home_score = (total + margin) / 2
        away_score = (total - margin) / 2
        cutoff = start + timedelta(days=season_index * 400 + game_index * 2)
        rows.append({
            "release": tournament.FEATURE_RELEASE,
            "game_id": game_id,
            "season": season,
            "feature_cutoff": cutoff.isoformat(),
            "home_team_id": game_index % 30 + 1,
            "away_team_id": (game_index + 9) % 30 + 1,
            "home_team": f"H{game_index % 30}",
            "away_team": f"A{(game_index + 9) % 30}",
            "league_off_rating": 110 + season_index,
            "league_current_season_team_games": game_index * 2,
            "league_prior_season_team_games": 96,
            "league_current_season_off_rating": 110 + season_index,
            "league_prior_season_off_rating": 109 + season_index,
            "league_current_vs_prior_off_rating_delta": 1.0,
            "league_regime_off_rating": 110 + season_index,
            "league_current_season_pace": pace,
            "league_prior_season_pace": pace - 1,
            "league_current_vs_prior_pace_delta": 1.0,
            "league_regime_pace": pace,
            "elo_home_rating": 1510 + home_off - away_off,
            "elo_away_rating": 1490 + away_off - home_off,
            "elo_rating_delta": 20 + 2 * (home_off - away_off),
            "elo_home_win_probability": 0.55,
            "home_adjusted_offense": home_off,
            "home_adjusted_defense": home_def,
            "away_adjusted_offense": away_off,
            "away_adjusted_defense": away_def,
            "home_offRating_5": home_off + rng.normal(0, 1),
            "away_offRating_5": away_off + rng.normal(0, 1),
            "home_defRating_5": home_def + rng.normal(0, 1),
            "away_defRating_5": away_def + rng.normal(0, 1),
            "home_margin_5": home_off - home_def + rng.normal(0, 1),
            "away_margin_5": away_off - away_def + rng.normal(0, 1),
            "home_pace_15": pace,
            "away_pace_15": pace + rng.normal(0, 1),
            "home_pace_prior": pace - 1,
            "away_pace_prior": pace - 1,
            "home_current_games": game_index,
            "away_current_games": game_index,
            "home_prior_games": 82,
            "away_prior_games": 82,
            "home_rest_days": game_index % 4,
            "away_rest_days": (game_index + 1) % 4,
            "home_back_to_back": int(game_index % 4 == 0),
            "away_back_to_back": int(game_index % 5 == 0),
            "home_games_last_4_days": 2,
            "away_games_last_4_days": 2,
            "home_games_last_7_days": 3,
            "away_games_last_7_days": 3,
            "home_travel_distance_miles": 450,
            "away_travel_distance_miles": 700,
            "home_time_zones_eastward": 0,
            "away_time_zones_eastward": 1,
            "home_consecutive_road_games_before": 0,
            "away_consecutive_road_games_before": 2,
            "home_venue_altitude_feet": 500,
            "away_venue_altitude_feet": 500,
            "home_efg_5": 0.54 + rng.normal(0, 0.02),
            "away_efg_5": 0.53 + rng.normal(0, 0.02),
            "home_turnoverRate_5": 0.13 + rng.normal(0, 0.01),
            "away_turnoverRate_5": 0.13 + rng.normal(0, 0.01),
            "home_offensiveReboundRate_5": 0.27 + rng.normal(0, 0.02),
            "away_offensiveReboundRate_5": 0.27 + rng.normal(0, 0.02),
            "home_freeThrowRate_5": 0.25 + rng.normal(0, 0.02),
            "away_freeThrowRate_5": 0.25 + rng.normal(0, 0.02),
            "home_opponentEfg_5": 0.53 + rng.normal(0, 0.02),
            "away_opponentEfg_5": 0.54 + rng.normal(0, 0.02),
            "home_margin_sd_10": 11,
            "away_margin_sd_10": 11,
            "home_rotationPlayers_5": 10,
            "away_rotationPlayers_5": 10,
            "home_top3MinutesShare_5": 0.47,
            "away_top3MinutesShare_5": 0.47,
            "home_top8MinutesShare_5": 0.91,
            "away_top8MinutesShare_5": 0.91,
            "home_rotationMinutesEntropy_5": 2.2,
            "away_rotationMinutesEntropy_5": 2.2,
            "home_rotation_expected_players_5": 9,
            "away_rotation_expected_players_5": 10,
            "home_rotation_continuity_5": 0.88,
            "away_rotation_continuity_5": 0.82,
            "home_pointsPaintShare_5": 0.42 + rng.normal(0, 0.02),
            "away_pointsPaintShare_5": 0.41 + rng.normal(0, 0.02),
            "home_deflectionsPer100_5": 8.5 + rng.normal(0, 0.5),
            "away_deflectionsPer100_5": 8.2 + rng.normal(0, 0.5),
            "home_usageConcentration_5": 0.055 + rng.normal(0, 0.004),
            "away_usageConcentration_5": 0.052 + rng.normal(0, 0.004),
            "evaluation_opening_market_home_probability": 0.65 if home_off >= away_off else 0.35,
            "evaluation_market_provenance": "synthetic_test_only",
            "evaluation_opening_moneyline_home_price": -130,
            "evaluation_opening_moneyline_home_sportsbook": "syntheticbook",
            "evaluation_opening_moneyline_away_price": 115,
            "evaluation_opening_moneyline_away_sportsbook": "syntheticbook",
            "evaluation_opening_home_spread": -margin + rng.normal(0, 5),
            "evaluation_opening_home_cover_probability": 0.5,
            "evaluation_opening_home_spread_price": -110,
            "evaluation_opening_home_spread_sportsbook": "syntheticbook",
            "evaluation_opening_away_spread_price": -110,
            "evaluation_opening_away_spread_sportsbook": "syntheticbook",
            "evaluation_opening_total": total + rng.normal(0, 8),
            "evaluation_opening_over_probability": 0.5,
            "evaluation_opening_over_price": -110,
            "evaluation_opening_over_sportsbook": "syntheticbook",
            "evaluation_opening_under_price": -110,
            "evaluation_opening_under_sportsbook": "syntheticbook",
            "target_home_score": home_score,
            "target_away_score": away_score,
            "target_home_margin": margin,
            "target_total": total,
            "target_home_win": int(margin > 0),
        })
        game_id += 1

with tempfile.TemporaryDirectory(prefix="nba-tournament-test-") as temporary:
    root = Path(temporary)
    features = root / "features.jsonl"
    features.write_text("".join(json.dumps(row) + "\n" for row in rows))
    output = root / "output"
    previous = sys.argv
    try:
        sys.argv = [
            "tournament_nba_professional_model.py",
            "--features", str(features),
            "--output", str(output),
            "--selection-season", "2024",
            "--confirmation-season", "2025",
            "--minimum-games-per-season", "40",
        ]
        tournament.main()
    finally:
        sys.argv = previous
    report = json.loads((output / "report.json").read_text())
    predictions = (output / "confirmation-predictions.jsonl").read_text().strip().splitlines()
    diagnostics = json.loads((output / "confirmation-diagnostics.json").read_text())
    feature_coverage = json.loads((output / "feature-coverage.json").read_text())
    deployment_candidate = json.loads((output / "deployment-candidate.json").read_text())
    winner_errors = (output / "confirmation-winner-errors.jsonl").read_text().splitlines()
    spread_errors = (output / "confirmation-spread-errors.jsonl").read_text().splitlines()
    total_errors = (output / "confirmation-total-errors.jsonl").read_text().splitlines()
    assert report["chronology"] == {
        "trainingSeasons": [2023],
        "selectionSeason": 2024,
        "confirmationSeason": 2025,
    }
    assert report["sampleBoundary"] == {
        "competition": "NBA",
        "seasonType": "regular_season_only",
        "preseasonEligible": False,
        "postseasonEligible": False,
        "minimumGamesPerSeason": 40,
        "gamesBySeason": {"2023": 48, "2024": 48, "2025": 48},
    }
    assert report["promotionAuthorized"] is False
    assert report["deploymentCandidate"]["release"] == tournament.DEPLOYMENT_CANDIDATE_RELEASE
    assert report["deploymentCandidate"]["promotionAuthorized"] is False
    assert deployment_candidate["promotionAuthorized"] is False
    assert deployment_candidate["featureFileSha256"]
    assert deployment_candidate["design"]["features"]
    assert len(deployment_candidate["design"]["rawFeatureMedians"]) == report["selected"]["featureCount"]
    assert len(deployment_candidate["design"]["designMeans"]) == deployment_candidate["design"]["preSplineDesignColumns"]
    assert deployment_candidate["coefficients"]
    assert deployment_candidate["trainingSeasons"] == [2023, 2024, 2025]
    replay_frame = tournament.pd.DataFrame(rows)
    replay_home, replay_away = tournament.predict_deployment_candidate(
        replay_frame,
        deployment_candidate,
    )
    direct_home, direct_away, _ = tournament.fit_predict(
        replay_frame,
        replay_frame,
        deployment_candidate["design"]["features"],
        deployment_candidate["model"],
        deployment_candidate["architecture"],
    )
    assert np.allclose(replay_home, direct_home, atol=1e-10)
    assert np.allclose(replay_away, direct_away, atol=1e-10)
    expected_coefficients = deployment_candidate["design"]["designColumns"] + 1
    assert all(
        len(coefficients) == expected_coefficients
        for coefficients in deployment_candidate["coefficients"].values()
    )
    assert isinstance(report["selectionGatePassed"], bool)
    assert report["selected"]["featureCount"] > 0
    assert report["featureCoverage"]["features"] == len(feature_coverage["rows"])
    assert report["featureCoverage"]["selectedFeatures"] == report["selected"]["featureCount"]
    assert all("bySeason" in row for row in feature_coverage["rows"])
    assert all(set(row["bySeason"]) == {"2023", "2024", "2025"} for row in feature_coverage["rows"])
    assert report["selectionGate"]["homeWinBrierMaximumRegression"] == 0.0
    assert report["selectionGate"]["homeWinLogLossMaximumRegression"] == 0.005
    assert report["selectionGate"]["ranking"] == "selection_shortlist_then_multiseason_robust_relative_joint_score"
    assert report["selectionGate"]["shortlistSize"] == tournament.MULTI_SEASON_SHORTLIST
    assert report["selectionGate"]["maximumWorstSeasonRelativeJointScore"] == tournament.MAXIMUM_WORST_SEASON_RELATIVE_JOINT_SCORE
    assert abs(sum(report["selectionGate"]["rankingWeights"].values()) - 1.0) < 1e-9
    assert report["selected"]["featureQuality"]["gatePassed"] is True
    assert report["selected"]["featureQuality"]["evaluatedOn"] == "training_partition_only"
    assert report["selectionGate"]["featureQuality"] == {
        "evaluatedOn": "training_partition_only",
        "minimumCoverage": 0.5,
        "minimumUsableFraction": 0.8,
    }
    assert report["selected"]["jointSelectionScore"] > 0
    assert report["selected"]["multiSeasonSelection"]["gatePassed"] is True
    assert report["selected"]["multiSeasonSelection"]["origins"]
    assert "home_margin_5" in tournament.feature_catalog(replay_frame)["ratings"]
    assert "away_margin_5" in tournament.feature_catalog(replay_frame)["ratings"]
    assert report["confirmation"]["games"] == 48
    assert report["independentConfirmation"]["games"] == 48
    assert report["marketOnlyConfirmation"]["games"] == 48
    assert report["finalCombinedConfirmation"] == report["confirmation"]
    assert report["marketMarriage"]["readerValidationStatus"] == "opening_reference_only_not_line_movement_or_splits_validation"
    assert report["marketMarriage"]["selectionMarketProvenance"] == {"synthetic_test_only": 48}
    assert report["marketMarriage"]["timestampedSelectionAuthority"] is False
    assert report["marketMarriage"]["documentedOpeningSelectionAuthority"] is False
    assert report["marketMarriage"]["gatePassed"] is False
    assert report["marketMarriage"]["weightSelectionRows"] > 0
    assert report["marketMarriage"]["thresholdSelectionRows"] > 0
    assert report["marketMarriage"]["weightSelectionRows"] + report["marketMarriage"]["thresholdSelectionRows"] == 48
    assert report["marketMarriage"]["selected"]["marginIndependentWeight"] in {0.0, 0.25, 0.5, 0.75, 1.0}
    assert report["marketMarriage"]["selected"]["totalIndependentWeight"] in {0.0, 0.25, 0.5, 0.75, 1.0}
    assert report["marketMarriage"]["confirmationCoverage"]["bothAvailable"] == 48
    assert report["marketMarriage"]["confirmationCorrectionsVsIndependent"]["corrections"] >= 0
    assert report["marketMarriage"]["confirmationCorrectionsVsIndependent"]["harms"] >= 0
    assert len(report["marketMarriage"]["limitations"]) == 3
    assert report["finalProductGatePassed"] is False
    assert report["finalProductGates"]["historicalMovementReaderValidated"] is False
    assert report["finalProductGates"]["historicalSplitsReaderValidated"] is False
    assert report["finalProductGates"]["documentedOpeningMarketSelectionValidated"] is False
    assert report["finalProductGates"]["timestampedMarketSelectionValidated"] is False
    assert report["confirmationProbabilityCalibration"]["developmentRows"] > 0
    assert report["confirmationProbabilityCalibration"]["calibrationRows"] > 0
    assert report["confirmationProbabilityCalibration"]["method"].startswith("strictly_earlier_fit")
    assert report["selectionBaselineProbabilityCalibration"]["calibrationRows"] > 0
    assert report["selected"]["model"]["family"] in {"ridge", "huber_ridge", "spline_ridge"}
    assert report["confirmationWinnerChangesVsRatingBaseline"]["corrections"] >= 0
    assert report["confirmationWinnerChangesVsRatingBaseline"]["harms"] >= 0
    assert report["confirmationUncertainty"]["samples"] == 2000
    assert set(report["confirmationUncertainty"]["metrics"]) == {
        "teamScoreMae", "marginMae", "totalMae", "winnerAccuracy",
    }
    assert report["rollingOriginStability"]
    assert all(row["evaluationSeason"] <= 2024 for row in report["rollingOriginStability"])
    assert report["publishedR1DirectlyComparable"] is False
    assert report["confirmation"]["upsetEvaluation"]["games"] == 48
    assert report["confirmation"]["openingMarketEvaluation"]["spread"]["games"] == 48
    assert report["confirmation"]["openingMarketEvaluation"]["total"]["games"] == 48
    assert report["confirmation"]["openingMarketEvaluation"]["moneyline"]["exactPrice"]["bets"] == 48
    assert report["confirmation"]["openingMarketEvaluation"]["spread"]["exactPrice"]["bets"] == 48
    assert report["confirmation"]["openingMarketEvaluation"]["total"]["exactPrice"]["bets"] == 48
    for market in ("moneyline", "spread", "total"):
        exact = report["confirmation"]["openingMarketEvaluation"][market]["exactPrice"]
        assert exact["sportsbookCoverage"] == 1.0
        assert exact["sportsbooks"] == {"syntheticbook": 48}
    for market in ("moneyline", "spread", "total"):
        assert report["actionableThresholdSelection"][market]["minimumSelectionBets"] == 20
        threshold = report["actionableThresholdSelection"][market]["selected"]
        confirmation = report["actionableConfirmation"][market]
        assert (threshold is None) == (confirmation is None)
        if threshold is not None:
            assert threshold["exactPriceCoverage"] == 1.0
        if confirmation is not None:
            assert confirmation["bets"] >= 0
            assert confirmation["exactPriceCoverage"] == 1.0
    large_threshold_frame = tournament.pd.DataFrame(index=range(500))
    for column in (
        "target_home_margin", "target_total",
        "evaluation_opening_market_home_probability",
        "evaluation_opening_moneyline_home_price", "evaluation_opening_moneyline_away_price",
        "evaluation_opening_home_spread", "evaluation_opening_home_spread_price",
        "evaluation_opening_away_spread_price", "evaluation_opening_total",
        "evaluation_opening_over_price", "evaluation_opening_under_price",
    ):
        large_threshold_frame[column] = 1.0
    large_thresholds = tournament.select_actionable_thresholds(
        large_threshold_frame,
        np.full(500, 2.0),
        np.full(500, 1.0),
        12.0,
        18.0,
    )
    assert all(details["minimumSelectionBets"] == 100 for details in large_thresholds.values())
    assert all(
        details["selected"] is None or details["selected"]["exactPriceCoverage"] == 1.0
        for details in large_thresholds.values()
    )
    assert report["actionableThresholdSelection"]["moneyline"]["candidates"][0]["selectionRule"] == (
        "minimum_model_probability_edge_vs_no_vig_opening_consensus"
    )
    assert set(report["actionableBenchmarkGates"]) == {
        "winnerDirectionAccuracyMeetsLifetimeMoneylineReference",
        "totalAccuracyMeetsLifetimeReference",
        "spreadExactPricePositive",
        "totalExactPricePositive",
        "moneylineExactPricePositive",
    }
    assert report["actionableExactPriceGate"] == {
        "minimumBets": 100,
        "minimumSignalCoverage": 0.75,
        "requiresCompleteSportsbookProvenance": True,
        "requiresPositiveUnits": True,
    }
    assert report["confirmationSeasonRegimeCohorts"]
    assert sum(row["games"] for row in report["confirmationSeasonRegimeCohorts"]) == 48
    assert all("teamScoreSignedBias" in row for row in report["confirmationSeasonRegimeCohorts"])
    assert "no preserved game ledger" in report["publishedR1ComparisonLimitation"]
    assert len(predictions) == 48
    first_prediction = json.loads(predictions[0])
    assert first_prediction["causeAttribution"]["status"] == "not_attributed"
    assert first_prediction["selectedFeatureState"]
    assert first_prediction["auditFeatureState"]
    assert "marginSigned" in first_prediction["error"]
    assert "spreadDirectionCorrect" in first_prediction["openingMarketEvaluationOnly"]
    assert first_prediction["openingMarketEvaluationOnly"]["provenance"] == "synthetic_test_only"
    assert first_prediction["openingMarketEvaluationOnly"]["moneylineHomeSportsbook"] == "syntheticbook"
    assert first_prediction["openingMarketEvaluationOnly"]["homeSpreadSportsbook"] == "syntheticbook"
    assert first_prediction["openingMarketEvaluationOnly"]["overSportsbook"] == "syntheticbook"
    assert diagnostics["overall"]["games"] == 48
    assert diagnostics["cohorts"]["calendarMonth"]
    assert diagnostics["cohorts"]["predictedMarginBand"]
    assert diagnostics["cohorts"]["predictedWinnerConfidenceBand"]
    assert diagnostics["cohorts"]["restState"]
    assert diagnostics["cohorts"]["team"]
    assert len(diagnostics["worstMisses"]["margin"]) == 25
    assert len(diagnostics["worstMisses"]["total"]) == 25
    assert len(winner_errors) == report["errorLedgers"]["winner"]["rows"]
    assert len(spread_errors) == report["errorLedgers"]["spread"]["rows"]
    assert len(total_errors) == report["errorLedgers"]["total"]["rows"]
    assert report["predictions"]["rows"] == 48
    assert report["diagnostics"]["causeAttributionPolicy"].startswith("never infer luck")
    selected_features = tournament.feature_catalog(tournament.validate(tournament.read_jsonl(features)))["all_declared"]
    assert not any(name.startswith("target_") for name in selected_features)
    assert "evaluation_opening_market_home_probability" not in selected_features
    assert not any(name.startswith("evaluation_") for name in selected_features)
    assert "home_pointsPaintShare_5" in selected_features
    assert "away_usageConcentration_5" in selected_features
    assert "home_rotation_continuity_5" in selected_features
    assert "away_travel_distance_miles" in selected_features
    assert tournament.feature_catalog(tournament.validate(tournament.read_jsonl(features)))["elo_only"]

    previous = sys.argv
    partial_rejected = False
    try:
        sys.argv = [
            "tournament_nba_professional_model.py",
            "--features", str(features),
            "--output", str(root / "partial-output"),
            "--selection-season", "2024",
            "--confirmation-season", "2025",
            "--minimum-games-per-season", "49",
        ]
        try:
            tournament.main()
        except ValueError as error:
            partial_rejected = "refuses partial-season evidence" in str(error)
    finally:
        sys.argv = previous
    assert partial_rejected

print("NBA professional tournament chronological and promotion-boundary tests passed.")
