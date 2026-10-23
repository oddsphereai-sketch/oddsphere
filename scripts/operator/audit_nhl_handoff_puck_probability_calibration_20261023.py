#!/usr/bin/env python3
"""Read-only historical calibration for the seven-game NHL handoff puck line."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median
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
RIDGES = (0.0, 2.0, 10.0, 40.0)


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def logistic(value: float) -> float:
    return 1 / (1 + math.exp(-clamp(value, -30, 30)))


def logit(value: float) -> float:
    value = clamp(value, 0.001, 0.999)
    return math.log(value / (1 - value))


def american_implied(value: float | int | None) -> float | None:
    if value is None or value == 0:
        return None
    value = float(value)
    return 100 / (value + 100) if value > 0 else -value / (-value + 100)


def unit(won: bool, odds: float | None) -> float:
    if not won:
        return -1.0
    if odds is None:
        return 0.0
    return odds / 100 if odds > 0 else 100 / -odds


def fit_platt(rows: list[dict[str, Any]], ridge: float) -> tuple[float, float]:
    intercept = 0.0
    slope = 1.0
    for _ in range(60):
        h00 = h01 = h11 = g0 = g1 = 0.0
        for row in rows:
            x = logit(row["raw_probability"])
            y = float(row["won"])
            p = logistic(intercept + slope * x)
            weight = max(1e-7, p * (1 - p))
            g0 += y - p
            g1 += x * (y - p)
            h00 += weight
            h01 += weight * x
            h11 += weight * x * x
        h11 += ridge
        g1 -= ridge * slope
        determinant = h00 * h11 - h01 * h01
        if abs(determinant) < 1e-12:
            break
        delta0 = (g0 * h11 - g1 * h01) / determinant
        delta1 = (g1 * h00 - g0 * h01) / determinant
        intercept += delta0
        slope += delta1
        if max(abs(delta0), abs(delta1)) < 1e-9:
            break
    return intercept, slope


def calibrated(probability: float, coefficients: tuple[float, float]) -> float:
    return logistic(coefficients[0] + coefficients[1] * logit(probability))


def verdict(probability: float, market_probability: float | None, price: float | None) -> str:
    if price is None or market_probability is None or price <= -900:
        return "pass"
    edge = probability - market_probability
    raw = "best_angle" if probability >= 0.70 and edge >= 0.05 else (
        "lean" if (probability >= 0.58 and edge >= 0.015) or edge >= 0.05 else "watchlist"
    )
    if price <= -200 and raw == "best_angle":
        raw = "lean"
    exact_edge = probability - american_implied(price)
    if raw == "watchlist" and probability >= 0.58 and exact_edge is not None and exact_edge >= 0.05:
        raw = "lean"
    return raw


def summarize(rows: list[dict[str, Any]], coefficients: tuple[float, float] | None) -> dict[str, Any]:
    probabilities = [
        row["raw_probability"] if coefficients is None else calibrated(row["raw_probability"], coefficients)
        for row in rows
    ]
    brier = sum((probability - float(row["won"])) ** 2 for row, probability in zip(rows, probabilities)) / len(rows)
    log_loss = sum(
        -(float(row["won"]) * math.log(clamp(probability, .001, .999))
          + (1 - float(row["won"])) * math.log(clamp(1 - probability, .001, .999)))
        for row, probability in zip(rows, probabilities)
    ) / len(rows)
    actionable_rows = [
        (row, probability)
        for row, probability in zip(rows, probabilities)
        if verdict(probability, row["market_probability"], row["price"]) in {"best_angle", "lean"}
    ]
    wins = sum(bool(row["won"]) for row, _ in actionable_rows)
    units = sum(unit(bool(row["won"]), row["price"]) for row, _ in actionable_rows)
    return {
        "rows": len(rows),
        "wins": sum(bool(row["won"]) for row in rows),
        "losses": len(rows) - sum(bool(row["won"]) for row in rows),
        "brier": brier,
        "log_loss": log_loss,
        "mean_probability": sum(probabilities) / len(probabilities),
        "actionable": {
            "rows": len(actionable_rows),
            "wins": wins,
            "losses": len(actionable_rows) - wins,
            "accuracy": wins / len(actionable_rows) if actionable_rows else None,
            "units": units,
            "retained_pct": len(actionable_rows) / len(rows),
        },
    }


def opening_surface(base: Any, path: Path) -> dict[tuple[int, str, str, str], dict[str, Any]]:
    payload = json.loads(path.read_text())
    game_by_id = {int(row["id"]): row for row in payload["games"]}
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in payload["opening_odds"]:
        if row.get("vendor") not in {"kalshi", "polymarket"}:
            grouped[int(row["game_id"])].append(row)
    result: dict[tuple[int, str, str, str], dict[str, Any]] = {}
    for game_id, rows in grouped.items():
        game = game_by_id.get(game_id)
        if game is None:
            continue
        spreads = [float(row["spread_home_value"]) for row in rows if row.get("spread_home_value") is not None]
        if not spreads:
            continue
        home_line = median(spreads)
        matching = [row for row in rows if row.get("spread_home_value") is not None and abs(float(row["spread_home_value"]) - home_line) < .01]
        paired = []
        for row in matching:
            hp = american_implied(row.get("spread_home_odds"))
            ap = american_implied(row.get("spread_away_odds"))
            if hp is not None and ap is not None and hp + ap > 0:
                paired.append((hp / (hp + ap), 1 - hp / (hp + ap)))
        if not paired:
            continue
        key = (
            int(game["season"]), str(game["game_date"]),
            base.alias(game["home_team"]["tricode"]), base.alias(game["away_team"]["tricode"]),
        )
        result[key] = {
            "home_line": home_line,
            "home_market_probability": median([pair[0] for pair in paired]),
            "away_market_probability": median([pair[1] for pair in paired]),
            "home_price": max(float(row["spread_home_odds"]) for row in matching if row.get("spread_home_odds") is not None),
            "away_price": max(float(row["spread_away_odds"]) for row in matching if row.get("spread_away_odds") is not None),
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--teams", required=True, type=Path)
    parser.add_argument("--skaters", required=True, action="append", type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load_module("nhl_puck_calibration_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    roster = load_module("nhl_puck_calibration_roster", root / "scripts/operator/research-nhl-roster-prior-r12.py")
    games = base.apply_settled_scores(base.load_games(args.teams), base.load_settled_scores(args.bdl))
    lineups = roster.load_skater_rows(args.skaters)
    examples = roster.build_examples(base, games, lineups, 0.04, roster.FAMILIES["roster_scoring"])
    predicted = roster.predict(base, examples, ROSTER_SCORE_BETA)
    openings = opening_surface(base, args.bdl)
    evaluated: list[dict[str, Any]] = []
    for row in predicted:
        if row["season"] not in (2023, 2024, 2025):
            continue
        maximum_games = max(row["home_games"], row["away_games"])
        if maximum_games < 7 or maximum_games >= 10:
            continue
        market = openings.get((row["season"], row["date"], row["home"], row["away"]))
        if market is None:
            continue
        distribution = base.distribution(row["ind_home"], row["ind_away"])
        home_line = market["home_line"]
        home_cover = sum(probability for margin, probability in distribution["margin"].items() if margin + home_line > 0)
        actual_axis = row["home_goals"] - row["away_goals"] + home_line
        if abs(actual_axis) < 1e-9:
            continue
        pick_home = home_cover >= .5
        evaluated.append({
            "season": row["season"],
            "date": row["date"],
            "matchup": f'{row["away"]} @ {row["home"]}',
            "raw_probability": home_cover if pick_home else 1 - home_cover,
            "market_probability": market["home_market_probability"] if pick_home else market["away_market_probability"],
            "price": market["home_price"] if pick_home else market["away_price"],
            "won": actual_axis > 0 if pick_home else actual_axis < 0,
        })
    by_season = {season: [row for row in evaluated if row["season"] == season] for season in (2023, 2024, 2025)}
    candidates = []
    for ridge in RIDGES:
        coefficients = fit_platt(by_season[2023], ridge)
        if coefficients[1] <= 0:
            continue
        report = summarize(by_season[2024], coefficients)
        candidates.append({"ridge": ridge, "coefficients": coefficients, "selection_2024": report})
    if not candidates:
        raise RuntimeError("no monotone calibration candidate")
    selected = min(candidates, key=lambda row: (
        row["selection_2024"]["brier"], row["selection_2024"]["log_loss"], -row["ridge"]
    ))
    frozen = tuple(selected["coefficients"])
    output = {
        "release": "nhl_handoff_puck_probability_calibration_audit_2026_10_23_r1",
        "read_only": True,
        "writes": 0,
        "protocol": {
            "fit": 2023,
            "ridge_selection": 2024,
            "untouched_confirmation": 2025,
            "window": "maximum current-season games 7 through 9",
            "direction_changes": 0,
        },
        "coverage": {str(season): len(rows) for season, rows in by_season.items()},
        "selected": selected,
        "frozen_coefficients": {"intercept": frozen[0], "slope": frozen[1]},
        "reports": {
            str(season): {
                "raw": summarize(rows, None),
                "calibrated": summarize(rows, frozen),
            }
            for season, rows in by_season.items()
        },
        "candidate_table": candidates,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
