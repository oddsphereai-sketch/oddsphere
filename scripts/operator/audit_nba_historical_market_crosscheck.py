#!/usr/bin/env python3
"""Cross-check regular-season BALLDONTLIE openings against an independent consensus file."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
from pathlib import Path
from typing import Any


RELEASE = "nba_historical_market_crosscheck_2026_10_15_r1_regular_season_only"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", required=True, type=Path)
    parser.add_argument("--bdl-opening", required=True, type=Path)
    parser.add_argument("--consensus-csv", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--minimum-games", type=int, default=1_200)
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError(f"{path}:{number} is not an object")
        rows.append(row)
    return rows


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def text(value: Any) -> str:
    return str(value or "").strip()


def number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def american_probability(value: Any) -> float | None:
    price = number(value)
    if price is None or price == 0:
        return None
    return 100 / (price + 100) if price > 0 else -price / (-price + 100)


def no_vig_home(home: Any, away: Any) -> float | None:
    home_probability = american_probability(home)
    away_probability = american_probability(away)
    if home_probability is None or away_probability is None:
        return None
    total = home_probability + away_probability
    return home_probability / total if total > 0 else None


def team_name(value: Any) -> str:
    return " ".join(text(value).lower().replace("la clippers", "los angeles clippers").split())


def quantiles(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    ordered = sorted(values)

    def pick(fraction: float) -> float:
        return float(ordered[round((len(ordered) - 1) * fraction)])

    return {
        "mean": float(statistics.fmean(values)),
        "median": float(statistics.median(values)),
        "p90": pick(0.90),
        "p95": pick(0.95),
        "max": float(max(values)),
    }


def main() -> None:
    args = parse_args()
    if args.minimum_games < 1:
        raise ValueError("minimum games must be positive")
    games = read_jsonl(args.games)
    eligible_games: dict[int, dict[str, Any]] = {}
    for game in games:
        if game.get("postseason") is True or game.get("ist_stage") == "Championship":
            continue
        if game.get("status_state") != "final" and game.get("status") != "Final":
            continue
        game_id = int(game["id"])
        home = game.get("home_team") if isinstance(game.get("home_team"), dict) else {}
        away = game.get("visitor_team") if isinstance(game.get("visitor_team"), dict) else {}
        eligible_games[game_id] = {
            "date": text(game.get("date")),
            "home": team_name(home.get("full_name")),
            "away": team_name(away.get("full_name")),
        }
    if len(eligible_games) < args.minimum_games:
        raise ValueError(
            f"regular-season game file is partial: {len(eligible_games)} < {args.minimum_games}"
        )

    consensus: dict[tuple[str, str, str], dict[str, float | None]] = {}
    with args.consensus_csv.open(newline="") as handle:
        for row in csv.DictReader(handle):
            if text(row.get("season_type")).lower() != "regular":
                continue
            if text(row.get("stage")).lower() != "regular season":
                continue
            key = (
                text(row.get("date_et")),
                team_name(row.get("home_team")),
                team_name(row.get("away_team")),
            )
            if key in consensus:
                raise ValueError(f"duplicate consensus regular-season game {key}")
            consensus[key] = {
                "homeProbability": number(row.get("open_home_win_prob")),
                "homeSpread": number(row.get("open_spread_home")),
                "total": number(row.get("open_total")),
            }

    books_by_game: dict[int, list[dict[str, Any]]] = {}
    games_by_vendor: dict[str, set[int]] = {}
    for row in read_jsonl(args.bdl_opening):
        game_id = int(row["game_id"])
        if game_id not in eligible_games:
            continue
        books_by_game.setdefault(game_id, []).append(row)
        vendor = text(row.get("vendor")) or "unknown"
        games_by_vendor.setdefault(vendor, set()).add(game_id)

    differences: dict[str, list[float]] = {
        "homeProbability": [],
        "homeSpread": [],
        "total": [],
    }
    matched = 0
    rows: list[dict[str, Any]] = []
    for game_id, identity in sorted(eligible_games.items()):
        reference = consensus.get((identity["date"], identity["home"], identity["away"]))
        book_rows = books_by_game.get(game_id, [])
        if reference is None or not book_rows:
            continue
        spread_values = [value for row in book_rows if (value := number(row.get("spread_home_value"))) is not None]
        total_values = [value for row in book_rows if (value := number(row.get("total_value"))) is not None]
        probability_values = [
            value for row in book_rows
            if (value := no_vig_home(row.get("moneyline_home_odds"), row.get("moneyline_away_odds"))) is not None
        ]
        bdl = {
            "homeProbability": statistics.median(probability_values) if probability_values else None,
            "homeSpread": statistics.median(spread_values) if spread_values else None,
            "total": statistics.median(total_values) if total_values else None,
        }
        delta: dict[str, float | None] = {}
        for field in differences:
            left = bdl[field]
            right = reference[field]
            value = None if left is None or right is None else abs(float(left) - float(right))
            delta[field] = value
            if value is not None:
                differences[field].append(value)
        matched += 1
        rows.append({
            "gameId": game_id,
            **identity,
            "bdlBooks": len({text(row.get("vendor")) for row in book_rows}),
            "bdl": bdl,
            "consensus": reference,
            "absoluteDifference": delta,
        })

    report = {
        "release": RELEASE,
        "sampleBoundary": {
            "seasonType": "regular_season_only",
            "preseasonEligible": False,
            "postseasonEligible": False,
        },
        "inputs": {
            "games": {"path": str(args.games), "sha256": sha256(args.games)},
            "bdlOpening": {"path": str(args.bdl_opening), "sha256": sha256(args.bdl_opening)},
            "consensusCsv": {"path": str(args.consensus_csv), "sha256": sha256(args.consensus_csv)},
        },
        "coverage": {
            "eligibleGames": len(eligible_games),
            "bdlOpeningGames": len(books_by_game),
            "consensusRegularSeasonGames": len(consensus),
            "matchedGames": matched,
            "matchedPct": matched / len(eligible_games),
        },
        "bdlVendorCoverage": {
            "vendorCount": len(games_by_vendor),
            "vendors": sorted(games_by_vendor),
            "gamesByVendor": {
                vendor: len(game_ids) for vendor, game_ids in sorted(games_by_vendor.items())
            },
            "multiVendorGames": sum(
                1 for book_rows in books_by_game.values()
                if len({text(row.get("vendor")) or "unknown" for row in book_rows}) > 1
            ),
        },
        "absoluteDifference": {field: quantiles(values) for field, values in differences.items()},
        "rows": rows,
        "authority": {
            "crossValidationOnly": True,
            "modelSelectionAuthorized": False,
            "readerRuleSelectionAuthorized": False,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "output": str(args.output),
        "coverage": report["coverage"],
        "bdlVendorCoverage": report["bdlVendorCoverage"],
        "absoluteDifference": report["absoluteDifference"],
    }, indent=2))


if __name__ == "__main__":
    main()
