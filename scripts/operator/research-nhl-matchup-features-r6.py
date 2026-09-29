#!/usr/bin/env python3
"""Predeclared NHL matchup-feature tournament.

Research only. Target-game values are created before applying that game's result.
The `starter_goalie` family uses retrospectively known starter identity solely as an
upper-bound diagnostic and is never eligible for production from this artifact.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def load_baseline(path: Path):
    spec = importlib.util.spec_from_file_location("nhl_baseline", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


ARENA = {
    "ANA": (33.8078, -117.8765, -8), "BOS": (42.3662, -71.0621, -5),
    "BUF": (42.8750, -78.8764, -5), "CAR": (35.8033, -78.7218, -5),
    "CBJ": (39.9693, -83.0061, -5), "CGY": (51.0374, -114.0519, -7),
    "CHI": (41.8807, -87.6742, -6), "COL": (39.7487, -105.0077, -7),
    "DAL": (32.7905, -96.8103, -6), "DET": (42.3411, -83.0553, -5),
    "EDM": (53.5469, -113.4979, -7), "FLA": (26.1584, -80.3256, -5),
    "LAK": (34.0430, -118.2673, -8), "MIN": (44.9448, -93.1011, -6),
    "MTL": (45.4961, -73.5693, -5), "NJD": (40.7335, -74.1711, -5),
    "NSH": (36.1592, -86.7785, -6), "NYI": (40.7229, -73.5907, -5),
    "NYR": (40.7505, -73.9934, -5), "OTT": (45.2969, -75.9272, -5),
    "PHI": (39.9012, -75.1720, -5), "PIT": (40.4393, -79.9895, -5),
    "SEA": (47.6221, -122.3540, -8), "SJS": (37.3328, -121.9012, -8),
    "STL": (38.6268, -90.2026, -6), "TBL": (27.9427, -82.4518, -5),
    "TOR": (43.6435, -79.3791, -5), "UTA": (40.7683, -111.9011, -7),
    "VAN": (49.2778, -123.1088, -8), "VGK": (36.1029, -115.1784, -8),
    "WPG": (49.8927, -97.1436, -6), "WSH": (38.8981, -77.0209, -5),
}


BASE_FEATURES = [
    "intercept", "is_home", "gf", "opp_ga", "xgf", "opp_xga", "sogf", "opp_soga",
    "five_xgf", "opp_five_xga", "pp_xgf", "opp_pk_xga", "shooting", "opp_goaltending",
    "win_diff", "elo_diff", "rest_diff", "team_b2b", "opp_b2b",
]
EXTRA_FEATURES = {
    "opponent_adjusted": ["adjusted_attack", "opp_adjusted_defense_weakness"],
    "opponent_adjusted_goals": ["adjusted_attack", "opp_adjusted_defense_weakness"],
    "opponent_adjusted_static": ["adjusted_attack", "opp_adjusted_defense_weakness"],
    "danger": ["high_danger_xgf", "opp_high_danger_xga", "rebound_xgf", "opp_rebound_xga", "shot_credit", "opp_shot_credit_against"],
    "special_teams": ["pp_ice", "opp_pk_ice", "penalties_drawn", "opp_penalties_taken"],
    "travel": ["travel_1000km", "opp_travel_1000km", "timezone_change", "opp_timezone_change", "b2b_travel", "opp_b2b_travel"],
    "starter_goalie": ["opp_starter_gsaa60"],
}
FAMILIES = {
    "runtime_parity": [],
    "opponent_adjusted": ["opponent_adjusted"],
    "danger": ["danger"],
    "special_teams": ["special_teams"],
    "travel": ["travel"],
    "matchup_core": ["opponent_adjusted", "danger", "special_teams", "travel"],
    "starter_goalie_oracle": ["starter_goalie"],
    "all_with_goalie_oracle": ["opponent_adjusted", "danger", "special_teams", "travel", "starter_goalie"],
}


@dataclass
class State:
    values: dict[str, float]
    games: int = 0
    last_date: str | None = None
    last_location: str | None = None
    elo: float = 1500.0
    adjusted_attack: float = 0.0
    adjusted_defense_weakness: float = 0.0


@dataclass
class GoalieState:
    gsaa: float = 0.0
    ice_hours: float = 0.0

    def per60(self) -> float:
        # Ten-game equivalent prior prevents tiny goalie samples from dominating.
        return self.gsaa / (self.ice_hours + 10.0)


def haversine(a: str | None, b: str) -> tuple[float, float]:
    if a is None or a not in ARENA or b not in ARENA:
        return 0.0, 0.0
    lat1, lon1, tz1 = ARENA[a]
    lat2, lon2, tz2 = ARENA[b]
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h)), abs(tz2 - tz1)


def read_goalies(path: Path) -> tuple[dict[tuple[int, str], str], dict[tuple[int, str], tuple[float, float]]]:
    candidates: dict[tuple[int, str], list[tuple[float, str, float, float]]] = defaultdict(list)
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row.get("situation") != "all" or row.get("position") != "G":
                continue
            season = int(row["season"])
            if season < 2022 or season > 2025 or row["gameId"][4:6] != "02":
                continue
            game_id = int(row["gameId"])
            team = row["playerTeam"]
            candidates[(game_id, team)].append((float(row["icetime"]), row["playerId"], float(row["xGoals"]), float(row["goals"])))
    starter: dict[tuple[int, str], str] = {}
    result: dict[tuple[int, str], tuple[float, float]] = {}
    for key, rows in candidates.items():
        ice, goalie, xg, goals = max(rows)
        starter[key] = goalie
        result[key] = (xg - goals, ice / 3600.0)
    return starter, result


def base_metrics(base: Any, rows: dict[str, dict[str, str]]) -> dict[str, float]:
    values = base.row_metrics(rows)
    all_row = rows["all"]
    power = rows.get("5on4", {})
    penalty = rows.get("4on5", {})
    values.update({
        "high_xgf": base.n(all_row.get("highDangerxGoalsFor")),
        "high_xga": base.n(all_row.get("highDangerxGoalsAgainst")),
        "rebound_xgf": base.n(all_row.get("reboundxGoalsFor")),
        "rebound_xga": base.n(all_row.get("reboundxGoalsAgainst")),
        "shot_credit": base.n(all_row.get("scoreAdjustedTotalShotCreditFor")),
        "shot_credit_against": base.n(all_row.get("scoreAdjustedTotalShotCreditAgainst")),
        "pp_ice": base.n(power.get("iceTime")) / 60.0,
        "pk_ice": base.n(penalty.get("iceTime")) / 60.0,
        "penalties_for": base.n(all_row.get("penaltiesFor")),
        "penalties_against": base.n(all_row.get("penaltiesAgainst")),
    })
    return values


def priors(base: Any) -> dict[str, float]:
    return {
        **base.PRIORS,
        "high_xgf": 0.75, "high_xga": 0.75,
        "rebound_xgf": 0.55, "rebound_xga": 0.55,
        "shot_credit": 3.05, "shot_credit_against": 3.05,
        "pp_ice": 5.5, "pk_ice": 5.5,
        "penalties_for": 3.0, "penalties_against": 3.0,
    }


def features_for(
    base: Any,
    team: State,
    opponent: State,
    is_home: bool,
    date: str,
    venue: str,
    family_parts: list[str],
    opponent_goalie: GoalieState | None,
) -> list[float]:
    tr, otr = base.days_between(team.last_date, date), base.days_between(opponent.last_date, date)
    rest_diff = 0.0 if tr is None or otr is None else max(-4.0, min(4.0, tr - otr))
    values = [
        1.0, float(is_home), team.values["gf"] - 3.05, opponent.values["ga"] - 3.05,
        team.values["xgf"] - 3.05, opponent.values["xga"] - 3.05,
        (team.values["sogf"] - 30) / 10, (opponent.values["soga"] - 30) / 10,
        team.values["five_xgf"] - 2.35, opponent.values["five_xga"] - 2.35,
        team.values["pp_xgf"] - 0.52, opponent.values["pk_xga"] - 0.52,
        team.values["shooting"], opponent.values["goaltending"],
        team.values["win"] - opponent.values["win"],
        (team.elo + (40 if is_home else 0) - opponent.elo) / 400,
        rest_diff, float(tr is not None and tr <= 1.5), float(otr is not None and otr <= 1.5),
    ]
    if any(part in family_parts for part in ("opponent_adjusted", "opponent_adjusted_goals", "opponent_adjusted_static")):
        values += [team.adjusted_attack, opponent.adjusted_defense_weakness]
    if "danger" in family_parts:
        values += [
            team.values["high_xgf"] - .75, opponent.values["high_xga"] - .75,
            team.values["rebound_xgf"] - .55, opponent.values["rebound_xga"] - .55,
            team.values["shot_credit"] - 3.05, opponent.values["shot_credit_against"] - 3.05,
        ]
    if "special_teams" in family_parts:
        values += [
            (team.values["pp_ice"] - 5.5) / 5,
            (opponent.values["pk_ice"] - 5.5) / 5,
            (team.values["penalties_against"] - 3) / 3,
            (opponent.values["penalties_for"] - 3) / 3,
        ]
    if "travel" in family_parts:
        travel, timezone = haversine(team.last_location, venue)
        opp_travel, opp_timezone = haversine(opponent.last_location, venue)
        values += [
            travel / 1000, opp_travel / 1000, timezone, opp_timezone,
            travel / 1000 * float(tr is not None and tr <= 1.5),
            opp_travel / 1000 * float(otr is not None and otr <= 1.5),
        ]
    if "starter_goalie" in family_parts:
        values += [0.0 if opponent_goalie is None else opponent_goalie.per60()]
    return values


def build_examples(base: Any, games: list[dict[str, Any]], alpha: float, family_parts: list[str], starter: dict[tuple[int, str], str], goalie_results: dict[tuple[int, str], tuple[float, float]]) -> list[dict[str, Any]]:
    initial = priors(base)
    states: dict[str, State] = defaultdict(lambda: State(dict(initial)))
    goalies: dict[str, GoalieState] = defaultdict(GoalieState)
    season_open_adjusted: dict[str, tuple[float, float]] = {}
    examples: list[dict[str, Any]] = []
    season: int | None = None
    for game in games:
        if season is not None and game["season"] != season:
            for state in states.values():
                for key, prior in initial.items():
                    state.values[key] = prior + .65 * (state.values[key] - prior)
                state.elo = 1500 + .72 * (state.elo - 1500)
                state.adjusted_attack *= .65
                state.adjusted_defense_weakness *= .65
                state.last_date = None
                state.last_location = None
            for state in goalies.values():
                state.gsaa *= .65
                state.ice_hours *= .65
            season_open_adjusted = {
                team: (state.adjusted_attack, state.adjusted_defense_weakness)
                for team, state in states.items()
            }
        season = game["season"]
        home, away = states[game["home"]], states[game["away"]]
        home_goalie_id = starter.get((game["id"], game["home"]))
        away_goalie_id = starter.get((game["id"], game["away"]))
        if min(home.games, away.games) >= 5:
            examples.append({
                **{key: game[key] for key in ["id", "season", "date", "home", "away", "home_goals", "away_goals"]},
                "home_x": features_for(base, home, away, True, game["date"], game["home"], family_parts, goalies.get(away_goalie_id) if away_goalie_id else None),
                "away_x": features_for(base, away, home, False, game["date"], game["home"], family_parts, goalies.get(home_goalie_id) if home_goalie_id else None),
            })
        home_expected = 1 / (1 + 10 ** (-(home.elo + 40 - away.elo) / 400))
        home_result = float(game["home_goals"] > game["away_goals"])
        change = 16 * (home_result - home_expected)
        home.elo += change
        away.elo -= change
        home_metrics = base_metrics(base, game["team_rows"][game["home"]])
        away_metrics = base_metrics(base, game["team_rows"][game["away"]])
        static_opponents = "opponent_adjusted_static" in family_parts
        away_open_defense = season_open_adjusted.get(game["away"], (0.0, 0.0))[1]
        home_open_defense = season_open_adjusted.get(game["home"], (0.0, 0.0))[1]
        expected_home_xg = 3.05 + home.adjusted_attack + (away_open_defense if static_opponents else away.adjusted_defense_weakness)
        expected_away_xg = 3.05 + away.adjusted_attack + (home_open_defense if static_opponents else home.adjusted_defense_weakness)
        adjusted_with_goals = "opponent_adjusted_goals" in family_parts
        home_observed = home_metrics["gf"] if adjusted_with_goals else home_metrics["xgf"]
        away_observed = away_metrics["gf"] if adjusted_with_goals else away_metrics["xgf"]
        home_residual = home_observed - expected_home_xg
        away_residual = away_observed - expected_away_xg
        home.adjusted_attack += alpha * home_residual / 2
        away.adjusted_defense_weakness += alpha * home_residual / 2
        away.adjusted_attack += alpha * away_residual / 2
        home.adjusted_defense_weakness += alpha * away_residual / 2
        for state, metrics in [(home, home_metrics), (away, away_metrics)]:
            for key, value in metrics.items():
                state.values[key] = (1 - alpha) * state.values[key] + alpha * value
            state.games += 1
            state.last_date = game["date"]
            state.last_location = game["home"]
        for goalie_id, team in [(home_goalie_id, game["home"]), (away_goalie_id, game["away"])]:
            if goalie_id is None:
                continue
            result = goalie_results.get((game["id"], team))
            if result:
                goalies[goalie_id].gsaa += result[0]
                goalies[goalie_id].ice_hours += result[1]
    return examples


def solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    size = len(vector)
    aug = [matrix[i][:] + [vector[i]] for i in range(size)]
    for col in range(size):
        pivot = max(range(col, size), key=lambda row: abs(aug[row][col]))
        aug[col], aug[pivot] = aug[pivot], aug[col]
        divisor = aug[col][col]
        if abs(divisor) < 1e-12:
            continue
        aug[col] = [value / divisor for value in aug[col]]
        for row in range(size):
            if row == col:
                continue
            factor = aug[row][col]
            if factor:
                aug[row] = [aug[row][i] - factor * aug[col][i] for i in range(size + 1)]
    return [aug[i][-1] for i in range(size)]


def ridge_fit(rows: list[tuple[list[float], float]], ridge: float) -> list[float]:
    size = len(rows[0][0])
    xtx = [[0.0] * size for _ in range(size)]
    xty = [0.0] * size
    for x, y in rows:
        for i in range(size):
            xty[i] += x[i] * y
            for j in range(size):
                xtx[i][j] += x[i] * x[j]
    for i in range(1, size):
        xtx[i][i] += ridge
    return solve(xtx, xty)


def dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def predict(rows: list[dict[str, Any]], beta: list[float]) -> list[dict[str, Any]]:
    return [{**row, "ind_home": max(1.25, min(5.25, dot(row["home_x"], beta))), "ind_away": max(1.25, min(5.25, dot(row["away_x"], beta)))} for row in rows]


def logistic_features(row: dict[str, Any]) -> list[float]:
    home, away = row["home_x"], row["away_x"]
    return [
        1.0, row["ind_home"] - row["ind_away"], home[15], home[14],
        (home[4] + home[8]) - (away[4] + away[8]),
        (away[5] + away[9]) - (home[5] + home[9]), home[16], home[17] - away[17],
    ]


def logistic_fit(rows: list[dict[str, Any]], ridge: float, steps: int = 36) -> list[float]:
    size = 8
    beta = [0.0] * size
    for _ in range(steps):
        hessian = [[0.0] * size for _ in range(size)]
        gradient = [0.0] * size
        for row in rows:
            x = logistic_features(row)
            y = float(row["home_goals"] > row["away_goals"])
            p = 1 / (1 + math.exp(-max(-20, min(20, dot(x, beta)))))
            weight = max(1e-6, p * (1 - p))
            for i in range(size):
                gradient[i] += x[i] * (y - p)
                for j in range(size):
                    hessian[i][j] += weight * x[i] * x[j]
        for i in range(1, size):
            hessian[i][i] += ridge
            gradient[i] -= ridge * beta[i]
        delta = solve(hessian, gradient)
        beta = [value + change for value, change in zip(beta, delta)]
        if max(abs(change) for change in delta) < 1e-7:
            break
    return beta


def score_pair(row: dict[str, Any], ability_weight: float, ability_beta: list[float], market_weight: float) -> tuple[float, float]:
    total = row["ind_home"] + row["ind_away"]
    score_margin = row["ind_home"] - row["ind_away"]
    p = 1 / (1 + math.exp(-max(-20, min(20, dot(logistic_features(row), ability_beta)))))
    ability_margin = math.log(max(.03, min(.97, p)) / (1 - max(.03, min(.97, p)))) / .78
    margin = (1 - ability_weight) * score_margin + ability_weight * ability_margin
    if row.get("market") and row["market"].get("home_prob") is not None:
        mp = max(.03, min(.97, row["market"]["home_prob"]))
        market_margin = math.log(mp / (1 - mp)) / .78
        margin = (1 - market_weight) * margin + market_weight * market_margin
    return (total + margin) / 2, (total - margin) / 2


def metrics(base: Any, rows: list[dict[str, Any]], ability_weight: float, ability_beta: list[float], market_weight: float = 0.0) -> dict[str, float | int]:
    team_abs = margin_abs = total_abs = brier = logloss = 0.0
    winner = total_correct = total_n = spread_correct = spread_n = 0
    for row in rows:
        home, away = score_pair(row, ability_weight, ability_beta, market_weight)
        actual_margin = row["home_goals"] - row["away_goals"]
        actual_total = row["home_goals"] + row["away_goals"]
        dist = base.distribution(home, away)
        actual_home = actual_margin > 0
        team_abs += abs(home - row["home_goals"]) + abs(away - row["away_goals"])
        margin_abs += abs((home - away) - actual_margin)
        total_abs += abs((home + away) - actual_total)
        winner += int((dist["home_win"] >= .5) == actual_home)
        brier += (dist["home_win"] - int(actual_home)) ** 2
        prob = max(.001, min(.999, dist["home_win"]))
        logloss += -(int(actual_home) * math.log(prob) + (1 - int(actual_home)) * math.log(1 - prob))
        market = row.get("market")
        if market and market["total"] is not None and actual_total != market["total"]:
            total_n += 1
            total_correct += int(((home + away) > market["total"]) == (actual_total > market["total"]))
        if market and market["home_spread"] is not None and actual_margin + market["home_spread"] != 0:
            cover = sum(probability for margin, probability in dist["margin"].items() if margin + market["home_spread"] > 0)
            spread_n += 1
            spread_correct += int((cover >= .5) == (actual_margin + market["home_spread"] > 0))
    count = len(rows)
    return {
        "n": count, "team_score_mae": team_abs / (2 * count), "margin_mae": margin_abs / count,
        "total_mae": total_abs / count, "winner_accuracy": winner / count, "winner_brier": brier / count,
        "winner_logloss": logloss / count, "total_accuracy": total_correct / total_n if total_n else 0,
        "total_n": total_n, "puckline_accuracy": spread_correct / spread_n if spread_n else 0,
        "puckline_n": spread_n,
    }


def objective(m: dict[str, float | int]) -> float:
    return float(m["team_score_mae"]) + .32 * float(m["margin_mae"]) + .25 * float(m["total_mae"]) + .60 * float(m["winner_brier"]) + .08 * float(m["winner_logloss"]) - .16 * float(m["winner_accuracy"])


def feature_names(parts: list[str]) -> list[str]:
    return BASE_FEATURES + [name for part in parts for name in EXTRA_FEATURES[part]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--goalies", required=True, type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load_baseline(root / "scripts/operator/tournament-nhl-professional-score-model.py")
    games = base.load_games(args.moneypuck)
    openings = base.load_openings(args.bdl)
    starter, goalie_results = read_goalies(args.goalies)
    family_results: list[dict[str, Any]] = []
    for family, parts in FAMILIES.items():
        print(f"family={family}", flush=True)
        candidates = []
        for alpha in [.025, .04, .06]:
            examples = build_examples(base, games, alpha, parts, starter, goalie_results)
            train = [row for row in examples if row["season"] == 2023]
            tune = [row for row in examples if row["season"] == 2024]
            for ridge in [20.0, 75.0, 200.0]:
                beta = ridge_fit([(row[side], row[f"{side.split('_')[0]}_goals"]) for row in train for side in ["home_x", "away_x"]], ridge)
                train_predictions = predict(train, beta)
                tune_predictions = predict(tune, beta)
                for ability_ridge in [2.0, 10.0, 40.0]:
                    ability_beta = logistic_fit(train_predictions, ability_ridge)
                    for ability_weight in [.30, .45, .60, .75, 1.0]:
                        report = metrics(base, tune_predictions, ability_weight, ability_beta)
                        candidates.append({"alpha": alpha, "ridge": ridge, "ability_ridge": ability_ridge, "ability_weight": ability_weight, "beta": beta, "ability_beta": ability_beta, "tune": report, "objective": objective(report)})
        selected = min(candidates, key=lambda row: row["objective"])
        examples = build_examples(base, games, selected["alpha"], parts, starter, goalie_results)
        fit_rows = [row for row in examples if row["season"] in {2023, 2024}]
        beta = ridge_fit([(row[side], row[f"{side.split('_')[0]}_goals"]) for row in fit_rows for side in ["home_x", "away_x"]], selected["ridge"])
        ability_beta = logistic_fit(predict(fit_rows, beta), selected["ability_ridge"])
        year_2024 = predict([row for row in examples if row["season"] == 2024], beta)
        priced = base.market_join(predict([row for row in examples if row["season"] == 2025], beta), openings)
        cut = int(len(priced) * .70)
        market_tune, holdout = priced[:cut], priced[cut:]
        market_candidates = []
        for weight in [0.0, .10, .20, .30, .40]:
            report = metrics(base, market_tune, selected["ability_weight"], ability_beta, weight)
            market_candidates.append({"weight": weight, "metrics": report, "objective": objective(report) - .10 * float(report["total_accuracy"]) - .08 * float(report["puckline_accuracy"])})
        market = min(market_candidates, key=lambda row: row["objective"])
        result = {
            "family": family,
            "production_eligible": "starter_goalie" not in parts,
            "features": feature_names(parts),
            "selected": {key: selected[key] for key in ["alpha", "ridge", "ability_ridge", "ability_weight", "objective"]},
            "beta": beta,
            "ability_beta": ability_beta,
            "market_weight": market["weight"],
            "tune_2024_selected_fit": selected["tune"],
            "report_2024_refit_diagnostic": metrics(base, year_2024, selected["ability_weight"], ability_beta),
            "market_tune_2025": market["metrics"],
            "holdout_2025": metrics(base, holdout, selected["ability_weight"], ability_beta, market["weight"]),
            "full_priced_2025": metrics(base, priced, selected["ability_weight"], ability_beta, market["weight"]),
            "data": {"examples": len(examples), "priced": len(priced), "holdout": len(holdout)},
        }
        family_results.append(result)
        print(json.dumps({"family": family, "holdout": result["holdout_2025"], "full": result["full_priced_2025"]}), flush=True)
    payload = {
        "release": "nhl_matchup_feature_tournament_2026_09_29_r1",
        "protocol": {"warmup": 2022, "train": 2023, "tune": 2024, "market_tune": "first_70pct_priced_2025", "holdout": "final_30pct_priced_2025"},
        "families": family_results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__":
    main()
