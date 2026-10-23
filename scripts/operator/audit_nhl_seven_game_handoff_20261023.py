#!/usr/bin/env python3
"""Read-only 2025 validation of the fixed seven-game NHL head handoff."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any


ROSTER_SCORE_BETA = [
    2.8627335183356593, 0.18097660433990212, -0.04290122589447318,
    0.17336428120862124, 0.08375237227954732, 0.2904386353953811,
    -0.06622197415700082, 0.2669045558563523, -0.04503468060624234,
    0.23788365112877533, -0.13014779631034876, -0.17124085523932803,
    -0.12665359817437713, -0.11707435418720692, -0.462594552181677,
    0.45923342632413855, 0.07011129359055548, -0.13216188373581528,
    0.057010954106550105, 0.023780899098990116, 0.24853606087984212,
    -0.19194588224494297, 0.1512376901428658, -0.030318817072768782,
    0.6648677791438763, -0.12458888446629911,
]
DIRECT_BETA = [
    0.017101214986255404, 0.3727402738650398, -0.09031399152266086,
    -0.029427277602442094, -0.07031505335749243, 0.1893841254384139,
    0.1284299691183286, 0.08982992785933605, 0.02645657466231951,
    0.016848929486589843, -0.126494024128936, 0.12003986424241182,
    0.02969300875930337,
]
DIRECT_MEANS = [
    0.09979985245958285, -0.0041624764484531635, -0.018270909093070137,
    -0.010244073877451474, -0.008541690589947701, -0.00587361733321948,
    -0.00826402872432632, -0.00802683521561861, 0.1816917084028937,
    0.10531441291040623, 0.20798553144129103, 0.0052080027181369585,
]
DIRECT_SCALES = [
    0.234971852195555, 0.19507574661395208, 1.062495830297579,
    0.7269621288652162, 0.5710740243286797, 0.4802288711201127,
    0.2530875952447813, 0.750286890264646, 1.1287899512971404,
    0.30695811985307586, 0.4058664190991348, 0.34677173251581933,
]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def logistic(value: float) -> float:
    return 1 / (1 + math.exp(-max(-30, min(30, value))))


def direct_probability(direct: Any, row: dict[str, Any]) -> float:
    values = direct.compact(row)[1:]
    scaled = [1.0] + [
        (value - DIRECT_MEANS[index]) / DIRECT_SCALES[index]
        for index, value in enumerate(values)
    ]
    return logistic(sum(left * right for left, right in zip(scaled, DIRECT_BETA)))


def forecast_pair(base: Any, direct: Any, row: dict[str, Any], probability: float) -> tuple[float, float]:
    total = direct.standard_total(row)
    margin = direct.margin_for_probability(base, total, probability)
    return (total + margin) / 2, (total - margin) / 2


def metrics(rows: list[dict[str, Any]], source: str, base: Any) -> dict[str, Any]:
    wins = 0
    puck_wins = puck_losses = total_wins = total_losses = 0
    brier = log_loss = team_error = margin_error = total_error = 0.0
    for row in rows:
        probability = row[f"{source}_probability"]
        home, away = row[f"{source}_home"], row[f"{source}_away"]
        actual_home = row["home_goals"] > row["away_goals"]
        wins += int((probability >= 0.5) == actual_home)
        target = int(actual_home)
        bounded = max(0.001, min(0.999, probability))
        brier += (bounded - target) ** 2
        log_loss += -(target * math.log(bounded) + (1 - target) * math.log(1 - bounded))
        team_error += abs(home - row["home_goals"]) + abs(away - row["away_goals"])
        margin_error += abs((home - away) - (row["home_goals"] - row["away_goals"]))
        total_error += abs((home + away) - (row["home_goals"] + row["away_goals"]))
        actual_margin = row["home_goals"] - row["away_goals"]
        actual_total = row["home_goals"] + row["away_goals"]
        distribution = base.distribution(home, away)
        market = row.get("market")
        if market and market.get("home_spread") is not None:
            line = market["home_spread"]
            actual_axis = actual_margin + line
            if abs(actual_axis) > 1e-9:
                home_cover = sum(mass for margin, mass in distribution["margin"].items() if margin + line > 0)
                predicted_home = home_cover >= .5
                puck_wins += int(predicted_home == (actual_axis > 0))
                puck_losses += int(predicted_home != (actual_axis > 0))
        if market and market.get("total") is not None:
            line = market["total"]
            actual_axis = actual_total - line
            if abs(actual_axis) > 1e-9:
                predicted_over = home + away > line
                total_wins += int(predicted_over == (actual_axis > 0))
                total_losses += int(predicted_over != (actual_axis > 0))
    count = len(rows)
    return {
        "n": count,
        "record": f"{wins}-{count - wins}",
        "accuracy": wins / count if count else None,
        "brier": brier / count if count else None,
        "log_loss": log_loss / count if count else None,
        "team_mae": team_error / (2 * count) if count else None,
        "margin_mae": margin_error / count if count else None,
        "total_mae": total_error / count if count else None,
        "puck_line": f"{puck_wins}-{puck_losses}",
        "puck_line_accuracy": puck_wins / (puck_wins + puck_losses) if puck_wins + puck_losses else None,
        "total_direction": f"{total_wins}-{total_losses}",
        "total_direction_accuracy": total_wins / (total_wins + total_losses) if total_wins + total_losses else None,
    }


def cohort_report(rows: list[dict[str, Any]], base: Any) -> dict[str, Any]:
    return {
        source: metrics(rows, source, base)
        for source in ("fast", "roster", "seven_game_handoff", "specialized_handoff")
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--teams", required=True, type=Path)
    parser.add_argument("--skaters", required=True, action="append", type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load_module("nhl_handoff_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    direct = load_module("nhl_handoff_direct", root / "scripts/operator/research_nhl_direct_probability_architecture_20261015.py")
    roster = load_module("nhl_handoff_roster", root / "scripts/operator/research-nhl-roster-prior-r12.py")

    games = base.apply_settled_scores(base.load_games(args.teams), base.load_settled_scores(args.bdl))
    lineups = roster.load_skater_rows(args.skaters)
    direct_rows = {
        (row["season"], row["date"], row["home"], row["away"]): row
        for row in base.build_examples(games, 0.085)
        if row["season"] == 2025
    }
    roster_examples = [
        row for row in roster.build_examples(base, games, lineups, 0.04, roster.FAMILIES["roster_scoring"])
        if row["season"] == 2025
    ]
    roster_predicted = roster.predict(base, roster_examples, ROSTER_SCORE_BETA)
    priced = base.market_join(roster_predicted, base.load_openings(args.bdl))
    opening = [row for row in priced if max(row["home_games"], row["away_games"]) < 10]
    evaluated: list[dict[str, Any]] = []
    for row in opening:
        key = (row["season"], row["date"], row["home"], row["away"])
        fast_row = direct_rows.get(key)
        if fast_row is None:
            continue
        fast_probability = direct_probability(direct, fast_row)
        fast_home, fast_away = forecast_pair(base, direct, fast_row, fast_probability)
        roster_probability = base.distribution(row["ind_home"], row["ind_away"])["home_win"]
        use_fast = max(row["home_games"], row["away_games"]) < 7
        specialized_home, specialized_away = forecast_pair(base, direct, fast_row, roster_probability)
        evaluated.append({
            **row,
            "maximum_games": max(row["home_games"], row["away_games"]),
            "fast_probability": fast_probability,
            "fast_home": fast_home,
            "fast_away": fast_away,
            "roster_probability": roster_probability,
            "roster_home": row["ind_home"],
            "roster_away": row["ind_away"],
            "seven_game_handoff_probability": fast_probability if use_fast else roster_probability,
            "seven_game_handoff_home": fast_home if use_fast else row["ind_home"],
            "seven_game_handoff_away": fast_away if use_fast else row["ind_away"],
            "specialized_handoff_probability": fast_probability if use_fast else roster_probability,
            "specialized_handoff_home": fast_home if use_fast else specialized_home,
            "specialized_handoff_away": fast_away if use_fast else specialized_away,
        })

    buckets = {
        "max_0_3": [row for row in evaluated if row["maximum_games"] <= 3],
        "max_4_6": [row for row in evaluated if 4 <= row["maximum_games"] <= 6],
        "max_7_9": [row for row in evaluated if 7 <= row["maximum_games"] <= 9],
    }
    print(json.dumps({
        "release": "nhl_seven_game_handoff_historical_audit_2026_10_23_r1",
        "read_only": True,
        "writes": 0,
        "protocol": {
            "season": 2025,
            "window": "both teams fewer than ten prior current-season games",
            "candidate": "fast when both teams have fewer than seven games; otherwise frozen roster head",
            "features": "strictly earlier MoneyPuck team and skater games",
            "settlement": "official BALLDONTLIE scores",
            "priced_cohort": True,
        },
        "coverage": {
            "priced_opening_rows": len(opening),
            "evaluated_rows": len(evaluated),
            "missing_direct_rows": len(opening) - len(evaluated),
        },
        "full_opening_window": cohort_report(evaluated, base),
        "by_maximum_team_games": {
            name: cohort_report(rows, base) for name, rows in buckets.items()
        },
    }, indent=2))


if __name__ == "__main__":
    main()
