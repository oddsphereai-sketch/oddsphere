#!/usr/bin/env python3
"""Audit NHL analytics-score rows against official settled game outcomes.

MoneyPuck's team-game goal totals can exclude the synthetic shootout-deciding
goal.  This audit proves whether treating an analytics-score tie as an away win
contaminates winner labels used by chronological model research.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


ALIASES = {"T.B": "TBL", "L.A": "LAK", "N.J": "NJD", "S.J": "SJS", "MON": "MTL"}


def alias(team: str) -> str:
    return ALIASES.get(team, team)


def load_analytics(path: Path) -> dict[tuple[int, str, str, str], dict[str, Any]]:
    grouped: dict[str, dict[str, dict[str, str]]] = defaultdict(dict)
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row.get("position") != "Team Level" or row.get("situation") != "all":
                continue
            if row.get("gameId", "")[4:6] != "02":
                continue
            grouped[row["gameId"]][alias(row["playerTeam"])] = row
    result: dict[tuple[int, str, str, str], dict[str, Any]] = {}
    for game_id, teams in grouped.items():
        if len(teams) != 2:
            continue
        home = next((team for team, row in teams.items() if row.get("home_or_away") == "HOME"), None)
        away = next((team for team in teams if team != home), None)
        if home is None or away is None:
            continue
        row = teams[home]
        raw_date = row["gameDate"]
        key = (int(row["season"]), f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}", home, away)
        result[key] = {
            "game_id": int(game_id),
            "home_goals": int(float(teams[home]["goalsFor"])),
            "away_goals": int(float(teams[away]["goalsFor"])),
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    analytics = load_analytics(args.moneypuck)
    provider = json.loads(args.bdl.read_text())
    joined: list[dict[str, Any]] = []
    for game in provider["games"]:
        key = (
            int(game["season"]),
            str(game["game_date"]),
            alias(game["home_team"]["tricode"]),
            alias(game["away_team"]["tricode"]),
        )
        row = analytics.get(key)
        if row is None:
            continue
        analytics_tie = row["home_goals"] == row["away_goals"]
        analytics_home = row["home_goals"] > row["away_goals"]
        official_home = int(game["home_score"]) > int(game["away_score"])
        joined.append({
            "season": key[0],
            "analytics_tie": analytics_tie,
            "analytics_home": analytics_home,
            "official_home": official_home,
            "winner_mismatch": analytics_home != official_home,
        })

    def report(rows: list[dict[str, Any]]) -> dict[str, Any]:
        ties = [row for row in rows if row["analytics_tie"]]
        mismatches = [row for row in rows if row["winner_mismatch"]]
        tie_home_winners = [row for row in ties if row["official_home"]]
        return {
            "n": len(rows),
            "analytics_ties": len(ties),
            "analytics_tie_rate": len(ties) / len(rows) if rows else None,
            "winner_mismatches": len(mismatches),
            "winner_mismatch_rate": len(mismatches) / len(rows) if rows else None,
            "tied_rows_official_home_winner": len(tie_home_winners),
            "share_of_ties_mislabeled_as_away": len(tie_home_winners) / len(ties) if ties else None,
            "non_tie_mismatches": sum(1 for row in mismatches if not row["analytics_tie"]),
        }

    payload = {
        "release": "nhl_final_outcome_integrity_audit_2026_09_29_r1",
        "all": report(joined),
        "by_season": {
            str(season): report([row for row in joined if row["season"] == season])
            for season in sorted({row["season"] for row in joined})
        },
    }
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
