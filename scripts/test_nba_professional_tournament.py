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
            "home_adjusted_offense": home_off,
            "home_adjusted_defense": home_def,
            "away_adjusted_offense": away_off,
            "away_adjusted_defense": away_def,
            "home_offRating_5": home_off + rng.normal(0, 1),
            "away_offRating_5": away_off + rng.normal(0, 1),
            "home_defRating_5": home_def + rng.normal(0, 1),
            "away_defRating_5": away_def + rng.normal(0, 1),
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
        ]
        tournament.main()
    finally:
        sys.argv = previous
    report = json.loads((output / "report.json").read_text())
    predictions = (output / "confirmation-predictions.jsonl").read_text().strip().splitlines()
    assert report["chronology"] == {
        "trainingSeasons": [2023],
        "selectionSeason": 2024,
        "confirmationSeason": 2025,
    }
    assert report["promotionAuthorized"] is False
    assert isinstance(report["selectionGatePassed"], bool)
    assert report["selected"]["featureCount"] > 0
    assert report["confirmation"]["games"] == 48
    assert report["publishedR1DirectlyComparable"] is False
    assert len(predictions) == 48
    assert not any(name.startswith("target_") for name in tournament.feature_catalog(tournament.validate(tournament.read_jsonl(features)))["all_declared"])

print("NBA professional tournament chronological and promotion-boundary tests passed.")
