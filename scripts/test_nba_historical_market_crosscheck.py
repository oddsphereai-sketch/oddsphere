#!/usr/bin/env python3
"""Contract test for the regular-season historical market cross-check."""

from __future__ import annotations

import csv
import json
import sys
import tempfile
from pathlib import Path

from scripts.operator import audit_nba_historical_market_crosscheck as audit


with tempfile.TemporaryDirectory(prefix="nba-market-crosscheck-") as temporary:
    root = Path(temporary)
    games = root / "games.jsonl"
    games.write_text("".join(json.dumps(row) + "\n" for row in [
        {
            "id": 1,
            "date": "2025-10-21",
            "status": "Final",
            "status_state": "final",
            "postseason": False,
            "ist_stage": None,
            "home_team": {"full_name": "Oklahoma City Thunder"},
            "visitor_team": {"full_name": "Houston Rockets"},
        },
        {
            "id": 2,
            "date": "2025-10-21",
            "status": "Final",
            "status_state": "final",
            "postseason": True,
            "ist_stage": None,
            "home_team": {"full_name": "Los Angeles Lakers"},
            "visitor_team": {"full_name": "Golden State Warriors"},
        },
    ]))
    openings = root / "opening.jsonl"
    openings.write_text("".join(json.dumps(row) + "\n" for row in [
        {
            "id": 11,
            "game_id": 1,
            "vendor": "betmgm",
            "spread_home_value": "-6.5",
            "total_value": "225.5",
            "moneyline_home_odds": -250,
            "moneyline_away_odds": 200,
        },
        {
            "id": 12,
            "game_id": 1,
            "vendor": "fanduel",
            "spread_home_value": "-7.5",
            "total_value": "226.5",
            "moneyline_home_odds": -260,
            "moneyline_away_odds": 210,
        },
        {
            "id": 13,
            "game_id": 2,
            "vendor": "betmgm",
            "spread_home_value": "-3.5",
            "total_value": "220.5",
            "moneyline_home_odds": -150,
            "moneyline_away_odds": 130,
        },
    ]))
    consensus = root / "consensus.csv"
    with consensus.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "date_et", "season_type", "stage", "home_team", "away_team",
            "open_home_win_prob", "open_spread_home", "open_total",
        ])
        writer.writeheader()
        writer.writerow({
            "date_et": "2025-10-21",
            "season_type": "regular",
            "stage": "Regular season",
            "home_team": "Oklahoma City Thunder",
            "away_team": "Houston Rockets",
            "open_home_win_prob": "0.70",
            "open_spread_home": "-7.0",
            "open_total": "226.0",
        })
        writer.writerow({
            "date_et": "2025-10-21",
            "season_type": "postseason",
            "stage": "Playoffs",
            "home_team": "Los Angeles Lakers",
            "away_team": "Golden State Warriors",
            "open_home_win_prob": "0.60",
            "open_spread_home": "-3.5",
            "open_total": "220.5",
        })
    output = root / "report.json"
    previous = sys.argv
    try:
        sys.argv = [
            "audit_nba_historical_market_crosscheck.py",
            "--games", str(games),
            "--bdl-opening", str(openings),
            "--consensus-csv", str(consensus),
            "--output", str(output),
            "--minimum-games", "1",
        ]
        audit.main()
    finally:
        sys.argv = previous
    report = json.loads(output.read_text())
    assert report["sampleBoundary"]["preseasonEligible"] is False
    assert report["sampleBoundary"]["postseasonEligible"] is False
    assert report["coverage"] == {
        "eligibleGames": 1,
        "bdlOpeningGames": 1,
        "consensusRegularSeasonGames": 1,
        "matchedGames": 1,
        "matchedPct": 1.0,
    }
    assert report["bdlVendorCoverage"] == {
        "vendorCount": 2,
        "vendors": ["betmgm", "fanduel"],
        "gamesByVendor": {"betmgm": 1, "fanduel": 1},
        "multiVendorGames": 1,
    }
    assert report["rows"][0]["bdlBooks"] == 2
    assert report["rows"][0]["absoluteDifference"]["homeSpread"] == 0.0
    assert report["rows"][0]["absoluteDifference"]["total"] == 0.0
    assert report["authority"]["modelSelectionAuthorized"] is False

print("NBA historical market cross-check contract tests passed.")
