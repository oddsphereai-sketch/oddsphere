#!/usr/bin/env python3
"""Chronological NHL roster-prior tournament.

Research only. Player values are updated after each game. The player identities
for the target game are used as a lineup/roster diagnostic, but target-game
performance never enters the forecast features.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import sys
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PLAYER_FIELDS = ("game_score", "ixg", "points", "onice_xg_diff")
PLAYER_PRIORS = {
    "game_score": 1.45,
    "ixg": 0.60,
    "points": 1.45,
    "onice_xg_diff": 0.0,
}
FAMILIES = {
    "runtime_parity": (),
    "roster_game_score": ("game_score",),
    "roster_xg": ("ixg", "onice_xg_diff"),
    "roster_scoring": ("game_score", "ixg", "points"),
    "roster_complete": PLAYER_FIELDS,
}


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("nhl_baseline_r12", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def finite(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


@dataclass
class PlayerState:
    games: int = 0
    ice_hours: float = 0.0
    ice_per_game: float = 12.0
    game_score: float = PLAYER_PRIORS["game_score"]
    ixg: float = PLAYER_PRIORS["ixg"]
    points: float = PLAYER_PRIORS["points"]
    onice_xg_diff: float = PLAYER_PRIORS["onice_xg_diff"]

    def update(self, row: dict[str, Any], alpha: float) -> None:
        ice_hours = finite(row.get("icetime")) / 3600.0
        if ice_hours <= 0:
            return
        minutes = ice_hours * 60
        observations = {
            "game_score": finite(row.get("gameScore")) / ice_hours,
            "ixg": finite(row.get("I_F_xGoals")) / ice_hours,
            "points": finite(row.get("I_F_points")) / ice_hours,
            "onice_xg_diff": (
                finite(row.get("OnIce_F_xGoals")) - finite(row.get("OnIce_A_xGoals"))
            ) / ice_hours,
        }
        effective_alpha = alpha * min(1.0, minutes / 18.0)
        for field, value in observations.items():
            current = getattr(self, field)
            setattr(self, field, (1 - effective_alpha) * current + effective_alpha * value)
        self.ice_per_game = (1 - alpha) * self.ice_per_game + alpha * minutes
        self.games += 1
        self.ice_hours += ice_hours

    def regress(self, retention: float) -> None:
        for field, prior in PLAYER_PRIORS.items():
            setattr(self, field, prior + retention * (getattr(self, field) - prior))
        self.ice_per_game = 12.0 + retention * (self.ice_per_game - 12.0)


def load_skater_rows(paths: list[Path]) -> dict[tuple[int, str], list[dict[str, Any]]]:
    by_game_team: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            csv_name = next(name for name in archive.namelist() if name.endswith(".csv"))
            with archive.open(csv_name) as raw:
                rows = csv.DictReader(line.decode("utf-8") for line in raw)
                for row in rows:
                    if row.get("situation") != "all" or row.get("position") == "G":
                        continue
                    game_id = str(row.get("gameId") or "")
                    if len(game_id) < 6 or game_id[4:6] != "02":
                        continue
                    season = int(row["season"])
                    if season < 2022 or season > 2025:
                        continue
                    by_game_team[(int(game_id), row["playerTeam"])].append(row)
    return by_game_team


def roster_values(
    player_states: dict[str, PlayerState],
    rows: list[dict[str, Any]],
) -> dict[str, float]:
    weighted = {field: 0.0 for field in PLAYER_FIELDS}
    weight_sum = 0.0
    known_weight = 0.0
    for row in rows:
        player_id = str(row.get("playerId") or "")
        state = player_states.get(player_id)
        weight = max(6.0, min(24.0, state.ice_per_game if state else 12.0))
        weight_sum += weight
        if state and state.games:
            known_weight += weight
        for field in PLAYER_FIELDS:
            weighted[field] += weight * (getattr(state, field) if state else PLAYER_PRIORS[field])
    if weight_sum <= 0:
        return {**PLAYER_PRIORS, "coverage": 0.0}
    return {
        **{field: weighted[field] / weight_sum for field in PLAYER_FIELDS},
        "coverage": known_weight / weight_sum,
    }


def roster_features(own: dict[str, float], opponent: dict[str, float], family: tuple[str, ...]) -> list[float]:
    values: list[float] = []
    for field in family:
        prior = PLAYER_PRIORS[field]
        values.extend((own[field] - prior, opponent[field] - prior))
    return values


def build_examples(base: Any, games: list[dict[str, Any]], lineups: dict[tuple[int, str], list[dict[str, Any]]], alpha: float, family: tuple[str, ...]) -> list[dict[str, Any]]:
    team_states: dict[str, Any] = defaultdict(base.TeamState)
    player_states: dict[str, PlayerState] = {}
    examples: list[dict[str, Any]] = []
    season: int | None = None
    for game in games:
        if game["season"] < 2022:
            continue
        if season is not None and game["season"] != season:
            for state in team_states.values():
                for key, prior in base.PRIORS.items():
                    state.values[key] = prior + 0.65 * (state.values[key] - prior)
                state.elo = 1500 + 0.72 * (state.elo - 1500)
                state.last_date = None
            for state in player_states.values():
                state.regress(0.65)
        season = game["season"]
        home, away = team_states[game["home"]], team_states[game["away"]]
        home_rows = lineups.get((game["id"], game["home"]), [])
        away_rows = lineups.get((game["id"], game["away"]), [])
        home_roster = roster_values(player_states, home_rows)
        away_roster = roster_values(player_states, away_rows)
        if min(home.games, away.games) >= 5 and home_rows and away_rows:
            examples.append({
                **{key: game[key] for key in ("id", "season", "date", "home", "away", "home_goals", "away_goals")},
                "home_x": base.scoring_features(home, away, True, game["date"]) + roster_features(home_roster, away_roster, family),
                "away_x": base.scoring_features(away, home, False, game["date"]) + roster_features(away_roster, home_roster, family),
                "home_roster": home_roster,
                "away_roster": away_roster,
            })
        home_expected = 1 / (1 + 10 ** (-(home.elo + 40 - away.elo) / 400))
        change = 16 * (float(game["home_goals"] > game["away_goals"]) - home_expected)
        home.elo += change
        away.elo -= change
        for name, state in ((game["home"], home), (game["away"], away)):
            for key, value in base.row_metrics(game["team_rows"][name]).items():
                state.values[key] = (1 - alpha) * state.values[key] + alpha * value
            state.games += 1
            state.last_date = game["date"]
        for rows in (home_rows, away_rows):
            for row in rows:
                player_id = str(row.get("playerId") or "")
                state = player_states.setdefault(player_id, PlayerState())
                state.update(row, alpha)
    return examples


def solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    size = len(vector)
    aug = [matrix[index][:] + [vector[index]] for index in range(size)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(aug[row][column]))
        aug[column], aug[pivot] = aug[pivot], aug[column]
        divisor = aug[column][column]
        if abs(divisor) < 1e-12:
            continue
        aug[column] = [value / divisor for value in aug[column]]
        for row in range(size):
            if row == column:
                continue
            factor = aug[row][column]
            if factor:
                aug[row] = [aug[row][index] - factor * aug[column][index] for index in range(size + 1)]
    return [aug[index][-1] for index in range(size)]


def ridge_fit(rows: list[tuple[list[float], float]], ridge: float) -> list[float]:
    size = len(rows[0][0])
    xtx = [[0.0] * size for _ in range(size)]
    xty = [0.0] * size
    for values, target in rows:
        for left in range(size):
            xty[left] += values[left] * target
            for right in range(size):
                xtx[left][right] += values[left] * values[right]
    for index in range(1, size):
        xtx[index][index] += ridge
    return solve(xtx, xty)


def predict(base: Any, rows: list[dict[str, Any]], beta: list[float]) -> list[dict[str, Any]]:
    return [{
        **row,
        "ind_home": max(1.25, min(5.25, base.dot(row["home_x"], beta))),
        "ind_away": max(1.25, min(5.25, base.dot(row["away_x"], beta))),
    } for row in rows]


def metrics(base: Any, rows: list[dict[str, Any]]) -> dict[str, float | int]:
    team_abs = margin_abs = total_abs = brier = 0.0
    winners = total_correct = total_n = puck_correct = puck_n = 0
    count = 0
    for row in rows:
        home, away = row["ind_home"], row["ind_away"]
        actual_margin = row["home_goals"] - row["away_goals"]
        actual_total = row["home_goals"] + row["away_goals"]
        distribution = base.distribution(home, away)
        actual_home = actual_margin > 0
        team_abs += abs(home - row["home_goals"]) + abs(away - row["away_goals"])
        margin_abs += abs((home - away) - actual_margin)
        total_abs += abs((home + away) - actual_total)
        winners += int((distribution["home_win"] >= 0.5) == actual_home)
        brier += (distribution["home_win"] - int(actual_home)) ** 2
        market = row.get("market")
        if market and market.get("total") is not None and actual_total != market["total"]:
            total_n += 1
            total_correct += int(((home + away) > market["total"]) == (actual_total > market["total"]))
        if market and market.get("home_spread") is not None and actual_margin + market["home_spread"] != 0:
            home_cover = sum(probability for margin, probability in distribution["margin"].items() if margin + market["home_spread"] > 0)
            puck_n += 1
            puck_correct += int((home_cover >= 0.5) == (actual_margin + market["home_spread"] > 0))
        count += 1
    return {
        "n": count,
        "team_score_mae": team_abs / (2 * count),
        "margin_mae": margin_abs / count,
        "total_mae": total_abs / count,
        "winner_accuracy": winners / count,
        "winner_brier": brier / count,
        "total_accuracy": total_correct / total_n if total_n else None,
        "total_n": total_n,
        "puckline_accuracy": puck_correct / puck_n if puck_n else None,
        "puckline_n": puck_n,
    }


def objective(report: dict[str, float | int]) -> float:
    return (
        float(report["team_score_mae"])
        + 0.32 * float(report["margin_mae"])
        + 0.25 * float(report["total_mae"])
        + 0.60 * float(report["winner_brier"])
        - 0.16 * float(report["winner_accuracy"])
    )


def first_days(rows: list[dict[str, Any]], days: int = 30) -> list[dict[str, Any]]:
    by_season: dict[int, list[str]] = defaultdict(list)
    for row in rows:
        by_season[int(row["season"])].append(row["date"])
    starts = {season: min(dates) for season, dates in by_season.items()}
    from datetime import date
    return [row for row in rows if (date.fromisoformat(row["date"]) - date.fromisoformat(starts[int(row["season"])] )).days < days]


def market_conflicts(base: Any, rows: list[dict[str, Any]], minimum_market_edge: float) -> dict[str, float | int | None]:
    selected = []
    for row in rows:
        market = row.get("market")
        if not market or market.get("home_prob") is None:
            continue
        market_home = float(market["home_prob"])
        independent_home = base.distribution(row["ind_home"], row["ind_away"])["home_win"]
        if abs(market_home - 0.5) < minimum_market_edge or (market_home >= 0.5) == (independent_home >= 0.5):
            continue
        selected.append((row, market_home, independent_home))
    corrected = sum((market >= .5) == (row["home_goals"] > row["away_goals"]) for row, market, _ in selected)
    return {
        "n": len(selected),
        "market_accuracy": corrected / len(selected) if selected else None,
        "independent_accuracy": 1 - corrected / len(selected) if selected else None,
        "net_corrections": 2 * corrected - len(selected),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--teams", required=True, type=Path)
    parser.add_argument("--skaters", required=True, action="append", type=Path)
    parser.add_argument("--bdl", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load_module(root / "scripts/operator/tournament-nhl-professional-score-model.py")
    games = base.load_games(args.teams)
    openings = {}
    if args.bdl:
        games = base.apply_settled_scores(games, base.load_settled_scores(args.bdl))
        openings = base.load_openings(args.bdl)
    lineups = load_skater_rows(args.skaters)
    results: list[dict[str, Any]] = []
    holdout_by_family: dict[str, list[dict[str, Any]]] = {}
    for family_name, family in FAMILIES.items():
        print(f"family={family_name}", flush=True)
        candidates: list[dict[str, Any]] = []
        for alpha in (0.025, 0.04, 0.06):
            examples = build_examples(base, games, lineups, alpha, family)
            train = [row for row in examples if row["season"] == 2023]
            tune = [row for row in examples if row["season"] == 2024]
            for ridge in (20.0, 75.0, 200.0, 500.0):
                beta = ridge_fit([(row[side], row[f"{side.split('_')[0]}_goals"]) for row in train for side in ("home_x", "away_x")], ridge)
                report = metrics(base, predict(base, tune, beta))
                candidates.append({"alpha": alpha, "ridge": ridge, "beta": beta, "tune": report, "objective": objective(report)})
        selected = min(candidates, key=lambda row: row["objective"])
        examples = build_examples(base, games, lineups, selected["alpha"], family)
        fit = [row for row in examples if row["season"] in (2023, 2024)]
        beta = ridge_fit([(row[side], row[f"{side.split('_')[0]}_goals"]) for row in fit for side in ("home_x", "away_x")], selected["ridge"])
        holdout = predict(base, [row for row in examples if row["season"] == 2025], beta)
        if openings:
            holdout = base.market_join(holdout, openings)
        holdout_by_family[family_name] = holdout
        result = {
            "family": family_name,
            "features": list(family),
            "selected": {"alpha": selected["alpha"], "ridge": selected["ridge"], "tune": selected["tune"], "objective": selected["objective"]},
            "beta": beta,
            "holdout_2025": metrics(base, holdout),
            "opening_30_days_2025": metrics(base, first_days(holdout)),
            "mean_roster_coverage_2025": sum((row["home_roster"]["coverage"] + row["away_roster"]["coverage"]) / 2 for row in holdout) / len(holdout),
        }
        results.append(result)
        print(json.dumps({"family": family_name, "holdout": result["holdout_2025"], "opening": result["opening_30_days_2025"]}), flush=True)
    baseline_by_key = {
        (row["season"], row["date"], row["home"], row["away"]): row
        for row in holdout_by_family["runtime_parity"]
    }
    composite: list[dict[str, Any]] = []
    for row in holdout_by_family["roster_scoring"]:
        baseline = baseline_by_key[(row["season"], row["date"], row["home"], row["away"])]
        total = baseline["ind_home"] + baseline["ind_away"]
        margin = row["ind_home"] - row["ind_away"]
        composite.append({
            **row,
            "ind_home": (total + margin) / 2,
            "ind_away": (total - margin) / 2,
        })
    composite_result = {
        "family": "roster_margin_baseline_total",
        "features": ["roster_scoring_margin", "runtime_parity_total"],
        "holdout_2025": metrics(base, composite),
        "opening_30_days_2025": metrics(base, first_days(composite)),
        "opening_market_conflicts": {
            str(threshold): market_conflicts(base, first_days(composite), threshold)
            for threshold in (0.02, 0.04, 0.06)
        },
    }
    results.append(composite_result)
    print(json.dumps({"family": composite_result["family"], "holdout": composite_result["holdout_2025"], "opening": composite_result["opening_30_days_2025"]}), flush=True)
    payload = {
        "release": "nhl_roster_prior_tournament_2026_09_30_r1",
        "protocol": {"warmup": 2022, "train": 2023, "tune": 2024, "holdout": 2025, "market_in_score_fit": False},
        "families": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__":
    main()
