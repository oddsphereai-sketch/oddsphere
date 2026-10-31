#!/usr/bin/env python3
"""Build a read-only, clearly labeled outcome-evidence supplement.

The private and current-season BALLDONTLIE payloads remain immutable. This
script uses retained nflverse player stats, snap counts, rosters, and PBP to
classify box-score omissions as either participated-with-zero or confirmed
nonparticipation. It never writes to production and never overwrites a stored
outcome.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

import pandas as pd


RELEASE = "nfl_player_props_outcome_evidence_supplement_2026_10_15_r1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char)).lower()
    text = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def main() -> None:
    args = parse_args()
    audit = json.loads(args.audit.read_text(encoding="utf-8"))
    season = int(audit["season"])
    week = int(audit["week"])
    current = args.cache_root / "current"
    player_stats = pd.read_parquet(current / "player_stats" / f"{season}.parquet")
    snaps = pd.read_parquet(current / "snap_counts" / f"{season}.parquet")
    rosters = pd.read_parquet(current / "weekly_rosters" / f"{season}.parquet")
    pbp = pd.read_parquet(current / "pbp" / f"{season}.parquet")
    player_stats = player_stats[(player_stats["week"] == week) & (player_stats["season"] == season)].copy()
    snaps = snaps[(snaps["week"] == week) & (snaps["season"] == season)].copy()
    rosters = rosters[(rosters["week"] == week) & (rosters["season"] == season)].copy()
    pbp = pbp[(pbp["week"] == week) & (pbp["season"] == season)].copy()
    player_stats["normalized_name"] = player_stats["player_display_name"].map(normalized)
    snaps["normalized_name"] = snaps["player"].map(normalized)
    rosters["normalized_name"] = rosters["full_name"].map(normalized)

    rows = []
    for scope in audit["scopes"]:
        game = scope["game"]
        teams = {game["homeTeam"], game["awayTeam"]}
        game_ids = set(
            pbp.loc[
                pbp["home_team"].isin(teams) & pbp["away_team"].isin(teams), "game_id"
            ].dropna().astype(str)
        )
        if len(game_ids) != 1:
            raise RuntimeError(f"Could not resolve one nflverse game for provider game {scope['gameId']}: {sorted(game_ids)}")
        game_id = next(iter(game_ids))
        name = normalized(scope["playerName"])
        stats_match = player_stats[(player_stats["game_id"] == game_id) & (player_stats["normalized_name"] == name)]
        snap_match = snaps[(snaps["game_id"] == game_id) & (snaps["normalized_name"] == name)]
        roster_match = rosters[rosters["normalized_name"] == name]
        game_pbp = pbp[pbp["game_id"] == game_id]
        pbp_mentions = player_pbp_mentions(game_pbp, name)
        snap_count = float(pd.to_numeric(snap_match["offense_snaps"], errors="coerce").fillna(0).sum())
        roster_statuses = sorted(set(roster_match["status"].dropna().astype(str)))
        participated = bool(len(stats_match) or snap_count > 0 or pbp_mentions > 0)

        if participated:
            actual = official_actual(scope["market"], stats_match, game_pbp, name)
            if actual != 0:
                raise RuntimeError(
                    f"Unmatched scope unexpectedly has a nonzero retained outcome: {scope['playerName']} {scope['market']}={actual}"
                )
            classification = "official_participated_zero"
            ledger_treatment = "supplement_settled_actual_zero"
        elif roster_statuses and set(roster_statuses).issubset({"INA", "CUT"}):
            actual = None
            classification = "official_nonparticipant"
            ledger_treatment = "exclude_from_settled_accuracy"
        else:
            actual = None
            classification = "unresolved"
            ledger_treatment = "remain_unmatched"

        rows.append({
            "providerGameId": scope["gameId"],
            "nflverseGameId": game_id,
            "providerPlayerId": scope["providerPlayerId"],
            "playerName": scope["playerName"],
            "normalizedPlayerName": name,
            "team": scope["team"],
            "market": scope["market"],
            "exactOfferCount": scope["exactOfferCount"],
            "classification": classification,
            "ledgerTreatment": ledger_treatment,
            "actual": actual,
            "evidence": {
                "playerStatRows": int(len(stats_match)),
                "offenseSnaps": snap_count,
                "pbpMentions": pbp_mentions,
                "rosterStatuses": roster_statuses,
            },
        })

    classifications = {}
    treatments = {}
    for row in rows:
        classifications.setdefault(row["classification"], {"scopes": 0, "exactOffers": 0})
        classifications[row["classification"]]["scopes"] += 1
        classifications[row["classification"]]["exactOffers"] += row["exactOfferCount"]
        treatments.setdefault(row["ledgerTreatment"], {"scopes": 0, "exactOffers": 0})
        treatments[row["ledgerTreatment"]]["scopes"] += 1
        treatments[row["ledgerTreatment"]]["exactOffers"] += row["exactOfferCount"]

    result = {
        "release": RELEASE,
        "readOnly": True,
        "productionWrites": 0,
        "lockedRecordMutations": 0,
        "season": season,
        "week": week,
        "inputExactOffers": int(audit["exactOfferRows"]),
        "inputScopes": len(audit["scopes"]),
        "classifications": classifications,
        "ledgerTreatments": treatments,
        "unresolvedExactOffers": sum(row["exactOfferCount"] for row in rows if row["classification"] == "unresolved"),
        "method": {
            "identity": "normalized player name (suffix-insensitive) within the exact team matchup/week",
            "participation": "retained official player-stat row, offensive snap, or play-by-play mention",
            "zero": "retained official player stats/PBP contain no event for the audited market after participation is independently confirmed",
            "nonparticipant": "no stat row, snap, or PBP mention and retained weekly roster status is INA or CUT",
            "precedence": "supplement applies only when no stored BALLDONTLIE actual exists; it never overwrites a stored or locked field",
        },
        "sources": {
            "playerStats": str(current / "player_stats" / f"{season}.parquet"),
            "snapCounts": str(current / "snap_counts" / f"{season}.parquet"),
            "weeklyRosters": str(current / "weekly_rosters" / f"{season}.parquet"),
            "playByPlay": str(current / "pbp" / f"{season}.parquet"),
        },
        "rows": rows,
    }
    args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


def player_pbp_mentions(game_pbp: pd.DataFrame, name: str) -> int:
    columns = [
        "passer_player_name", "receiver_player_name", "rusher_player_name", "td_player_name",
        "punt_returner_player_name", "kickoff_returner_player_name", "fumbled_1_player_name",
        "fumble_recovery_1_player_name",
    ]
    mask = pd.Series(False, index=game_pbp.index)
    for column in columns:
        if column in game_pbp:
            mask |= game_pbp[column].map(normalized).eq(name)
    return int(mask.sum())


def official_actual(market: str, stats: pd.DataFrame, game_pbp: pd.DataFrame, name: str) -> float:
    if market == "anytime_td":
        td_mask = game_pbp["td_player_name"].map(normalized).eq(name) & pd.to_numeric(
            game_pbp["touchdown"], errors="coerce"
        ).fillna(0).eq(1)
        return float(td_mask.sum())
    column = {
        "receiving_yards": "receiving_yards",
        "receptions": "receptions",
        "rushing_yards": "rushing_yards",
    }.get(market)
    if column is None:
        raise RuntimeError(f"Unsupported market in outcome supplement: {market}")
    if stats.empty:
        return 0.0
    return float(pd.to_numeric(stats[column], errors="coerce").fillna(0).sum())


if __name__ == "__main__":
    main()
