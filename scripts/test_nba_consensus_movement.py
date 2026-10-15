#!/usr/bin/env python3
"""Contract test for the regular-season NBA consensus movement audit."""

from __future__ import annotations

import csv
import json
import sys
import tempfile
from pathlib import Path

from scripts.operator import audit_nba_consensus_movement as audit


FIELDS = [
    "game_id", "season_type", "stage", "home_score", "away_score",
    "open_home_win_prob", "close_home_win_prob", "open_spread_home",
    "close_spread_home", "open_total", "close_total",
]


def write_rows(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def row(game_id: str, home_wins: bool, movement_home: bool, movement_over: bool) -> dict[str, object]:
    home_score, away_score = (120, 100) if home_wins else (100, 120)
    return {
        "game_id": game_id,
        "season_type": "regular",
        "stage": "Regular season",
        "home_score": home_score,
        "away_score": away_score,
        "open_home_win_prob": 0.55,
        "close_home_win_prob": 0.65 if home_wins else 0.35,
        "open_spread_home": -2,
        "close_spread_home": -4 if movement_home else 0,
        "open_total": 215,
        "close_total": 217 if movement_over else 213,
    }


with tempfile.TemporaryDirectory(prefix="nba-consensus-movement-") as temporary:
    root = Path(temporary)
    selection = root / "selection.csv"
    confirmation = root / "confirmation.csv"
    rows = [row(str(index), index % 2 == 0, index % 2 == 0, index % 3 == 0) for index in range(60)]
    rows.append({**row("postseason", True, True, True), "season_type": "postseason", "stage": "Playoffs"})
    write_rows(selection, rows)
    write_rows(confirmation, rows)
    output = root / "report.json"
    previous = sys.argv
    try:
        sys.argv = [
            "audit_nba_consensus_movement.py",
            "--selection-csv", str(selection),
            "--confirmation-csv", str(confirmation),
            "--output", str(output),
            "--minimum-games", "60",
        ]
        audit.main()
    finally:
        sys.argv = previous
    report = json.loads(output.read_text())
    assert report["sampleBoundary"]["selectionGames"] == 60
    assert report["sampleBoundary"]["confirmationGames"] == 60
    assert report["sampleBoundary"]["preseasonEligible"] is False
    assert report["sampleBoundary"]["postseasonEligible"] is False
    assert report["moneylineProbability"]["confirmationCloseImprovesBrier"] is True
    assert report["authority"]["runtimeReaderRuleAuthorized"] is False
    assert report["movementRules"]["spread"]["selection"]["selected"] is not None

print("NBA consensus movement audit contract tests passed.")
