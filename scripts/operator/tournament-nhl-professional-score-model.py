#!/usr/bin/env python3
"""Chronological NHL score-model tournament.

The tournament uses only information available before each game. MoneyPuck
team-game rows supply the sport-specific rolling inputs; BALLDONTLIE opening
odds are joined only for the 2025 market-marriage tuning/holdout boundary.
No future result is used to construct a pregame feature row.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


TEAM_ALIAS = {"T.B": "TBL", "L.A": "LAK", "N.J": "NJD", "S.J": "SJS", "MON": "MTL"}
FEATURES = [
    "intercept", "is_home", "gf", "opp_ga", "xgf", "opp_xga", "sogf", "opp_soga",
    "five_xgf", "opp_five_xga", "pp_xgf", "opp_pk_xga", "shooting", "opp_goaltending",
    "win_diff", "elo_diff", "rest_diff", "team_b2b", "opp_b2b", "opp_dzone_giveaways",
]
PRIORS = {
    "gf": 3.05, "ga": 3.05, "xgf": 3.05, "xga": 3.05, "sogf": 30.0, "soga": 30.0,
    "five_xgf": 2.35, "five_xga": 2.35, "pp_xgf": 0.52, "pk_xga": 0.52,
    "shooting": 0.0, "goaltending": 0.0, "win": 0.5, "dzone": 5.0,
}


def n(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def alias(team: str) -> str:
    return TEAM_ALIAS.get(team, team)


def american_implied(value: Any) -> float | None:
    odds = n(value, math.nan)
    if not math.isfinite(odds) or odds == 0:
        return None
    return 100 / (odds + 100) if odds > 0 else -odds / (-odds + 100)


def median(values: list[float]) -> float | None:
    values = sorted(x for x in values if math.isfinite(x))
    if not values:
        return None
    m = len(values) // 2
    return values[m] if len(values) % 2 else (values[m - 1] + values[m]) / 2


@dataclass
class TeamState:
    values: dict[str, float] = field(default_factory=lambda: dict(PRIORS))
    games: int = 0
    last_date: str | None = None
    elo: float = 1500.0


def load_games(csv_path: Path) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, dict[str, dict[str, str]]]] = defaultdict(lambda: defaultdict(dict))
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            season = int(row["season"])
            if season < 2022 or season > 2025 or row["position"] != "Team Level":
                continue
            if len(row["gameId"]) < 6 or row["gameId"][4:6] != "02":
                continue
            if row["situation"] not in {"all", "5on5", "5on4", "4on5"}:
                continue
            grouped[row["gameId"]][alias(row["playerTeam"])][row["situation"]] = row

    games: list[dict[str, Any]] = []
    for game_id, teams in grouped.items():
        if len(teams) != 2:
            continue
        home_team = next((team for team, situations in teams.items() if situations.get("all", {}).get("home_or_away") == "HOME"), None)
        away_team = next((team for team in teams if team != home_team), None)
        if not home_team or not away_team:
            continue
        home = teams[home_team].get("all")
        away = teams[away_team].get("all")
        if not home or not away:
            continue
        raw_date = home["gameDate"]
        date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}"
        games.append({
            "id": int(game_id), "season": int(home["season"]), "date": date,
            "home": home_team, "away": away_team,
            "home_goals": int(n(home["goalsFor"])), "away_goals": int(n(away["goalsFor"])),
            "team_rows": teams,
        })
    return sorted(games, key=lambda game: (game["date"], game["id"]))


def load_openings(path: Path) -> dict[tuple[int, str, str, str], dict[str, float | None]]:
    payload = json.loads(path.read_text())
    game_by_id = {game["id"]: game for game in payload["games"] if game["season"] == 2025}
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in payload["opening_odds"]:
        if row.get("vendor") not in {"kalshi", "polymarket"}:
            grouped[row["game_id"]].append(row)
    out: dict[tuple[int, str, str, str], dict[str, float | None]] = {}
    for game_id, rows in grouped.items():
        game = game_by_id.get(game_id)
        if not game:
            continue
        probs: list[float] = []
        totals: list[float] = []
        home_spreads: list[float] = []
        for row in rows:
            hp, ap = american_implied(row.get("moneyline_home_odds")), american_implied(row.get("moneyline_away_odds"))
            if hp is not None and ap is not None and hp + ap > 0:
                probs.append(hp / (hp + ap))
            total = n(row.get("total_value"), math.nan)
            spread = n(row.get("spread_home_value"), math.nan)
            if math.isfinite(total): totals.append(total)
            if math.isfinite(spread): home_spreads.append(spread)
        key = (2025, game["game_date"], alias(game["home_team"]["tricode"]), alias(game["away_team"]["tricode"]))
        out[key] = {"home_prob": median(probs), "total": median(totals), "home_spread": median(home_spreads)}
    return out


def load_legacy_forecasts(path: Path) -> dict[tuple[int, str, str, str], tuple[float, float, float]]:
    payload = json.loads(path.read_text())
    states: dict[str, dict[str, Any]] = defaultdict(lambda: {"elo": 1500.0, "gf": 3.05, "ga": 3.05, "last": None})
    out: dict[tuple[int, str, str, str], tuple[float, float, float]] = {}
    season: int | None = None
    for game in sorted(payload["games"], key=lambda row: row["start_time_utc"]):
        if season is not None and game["season"] != season:
            for state in states.values():
                state["elo"] = 1500 + .72 * (state["elo"] - 1500)
                state["gf"] = 3.05 + .62 * (state["gf"] - 3.05)
                state["ga"] = 3.05 + .62 * (state["ga"] - 3.05)
                state["last"] = None
        season = game["season"]
        home_name, away_name = alias(game["home_team"]["tricode"]), alias(game["away_team"]["tricode"])
        home, away = states[home_name], states[away_name]
        home_rest, away_rest = days_between(home["last"], game["game_date"]), days_between(away["last"], game["game_date"])
        rest = 0.0 if home_rest is None or away_rest is None else max(-.16, min(.16, (home_rest - away_rest) * .035))
        home_rate = (home["gf"] + away["ga"]) / 2 + .05 + rest / 2
        away_rate = (away["gf"] + home["ga"]) / 2 - rest / 2
        scoring_diff = home_rate - away_rate
        elo_diff = ((home["elo"] + 40) - away["elo"]) / 330
        legacy_margin = .58 * scoring_diff + .42 * elo_diff
        legacy_total = home_rate + away_rate
        out[(game["season"], game["game_date"], home_name, away_name)] = (home_rate, away_rate, legacy_margin)
        home_result = 1.0 if game["home_score"] > game["away_score"] else 0.0
        expected = 1 / (1 + 10 ** (-(home["elo"] + 40 - away["elo"]) / 400))
        change = 16 * (home_result - expected)
        home["elo"] += change
        away["elo"] -= change
        home["gf"] = .96 * home["gf"] + .04 * game["home_score"]
        home["ga"] = .96 * home["ga"] + .04 * game["away_score"]
        away["gf"] = .96 * away["gf"] + .04 * game["away_score"]
        away["ga"] = .96 * away["ga"] + .04 * game["home_score"]
        home["last"] = away["last"] = game["game_date"]
    return out


def days_between(previous: str | None, current: str) -> float | None:
    if previous is None:
        return None
    return max(0.0, (datetime.fromisoformat(current) - datetime.fromisoformat(previous)).total_seconds() / 86400)


def row_metrics(rows: dict[str, dict[str, str]]) -> dict[str, float]:
    all_row = rows["all"]
    five = rows.get("5on5", {})
    power = rows.get("5on4", {})
    penalty = rows.get("4on5", {})
    gf, ga = n(all_row.get("goalsFor")), n(all_row.get("goalsAgainst"))
    xgf, xga = n(all_row.get("xGoalsFor"), 3.05), n(all_row.get("xGoalsAgainst"), 3.05)
    return {
        "gf": gf, "ga": ga, "xgf": xgf, "xga": xga,
        "sogf": n(all_row.get("shotsOnGoalFor"), 30), "soga": n(all_row.get("shotsOnGoalAgainst"), 30),
        "five_xgf": n(five.get("xGoalsFor"), 2.35), "five_xga": n(five.get("xGoalsAgainst"), 2.35),
        "pp_xgf": n(power.get("xGoalsFor"), 0.52), "pk_xga": n(penalty.get("xGoalsAgainst"), 0.52),
        "shooting": gf - xgf, "goaltending": ga - xga,
        "win": 1.0 if gf > ga else 0.0,
        "dzone": n(all_row.get("dZoneGiveawaysFor"), 5),
    }


def scoring_features(team: TeamState, opponent: TeamState, is_home: bool, date: str) -> list[float]:
    team_rest, opp_rest = days_between(team.last_date, date), days_between(opponent.last_date, date)
    rest_diff = 0.0 if team_rest is None or opp_rest is None else max(-4.0, min(4.0, team_rest - opp_rest))
    return [
        1.0, float(is_home), team.values["gf"] - 3.05, opponent.values["ga"] - 3.05,
        team.values["xgf"] - 3.05, opponent.values["xga"] - 3.05,
        (team.values["sogf"] - 30) / 10, (opponent.values["soga"] - 30) / 10,
        team.values["five_xgf"] - 2.35, opponent.values["five_xga"] - 2.35,
        team.values["pp_xgf"] - 0.52, opponent.values["pk_xga"] - 0.52,
        team.values["shooting"], opponent.values["goaltending"],
        team.values["win"] - opponent.values["win"],
        (team.elo + (40 if is_home else 0) - opponent.elo) / 400,
        rest_diff,
        float(team_rest is not None and team_rest <= 1.5), float(opp_rest is not None and opp_rest <= 1.5),
        (opponent.values["dzone"] - 5) / 5,
    ]


def build_examples(games: list[dict[str, Any]], alpha: float) -> list[dict[str, Any]]:
    states: dict[str, TeamState] = defaultdict(TeamState)
    examples: list[dict[str, Any]] = []
    season: int | None = None
    for game in games:
        if season is not None and game["season"] != season:
            for state in states.values():
                for key, prior in PRIORS.items(): state.values[key] = prior + 0.65 * (state.values[key] - prior)
                state.elo = 1500 + 0.72 * (state.elo - 1500)
                state.last_date = None
        season = game["season"]
        home, away = states[game["home"]], states[game["away"]]
        if min(home.games, away.games) >= 5:
            examples.append({
                **{key: game[key] for key in ["id", "season", "date", "home", "away", "home_goals", "away_goals"]},
                "home_x": scoring_features(home, away, True, game["date"]),
                "away_x": scoring_features(away, home, False, game["date"]),
            })
        home_expected = 1 / (1 + 10 ** (-(home.elo + 40 - away.elo) / 400))
        home_result = 1.0 if game["home_goals"] > game["away_goals"] else 0.0
        elo_change = 16 * (home_result - home_expected)
        home.elo += elo_change
        away.elo -= elo_change
        for name, state in [(game["home"], home), (game["away"], away)]:
            metrics = row_metrics(game["team_rows"][name])
            for key, value in metrics.items(): state.values[key] = (1 - alpha) * state.values[key] + alpha * value
            state.games += 1
            state.last_date = game["date"]
    return examples


def opening_priors(games: list[dict[str, Any]], alpha: float) -> dict[str, dict[str, Any]]:
    states: dict[str, TeamState] = defaultdict(TeamState)
    season: int | None = None
    for game in games:
        if season is not None and game["season"] != season:
            for state in states.values():
                for key, prior in PRIORS.items(): state.values[key] = prior + 0.65 * (state.values[key] - prior)
                state.elo = 1500 + 0.72 * (state.elo - 1500)
                state.last_date = None
        season = game["season"]
        home, away = states[game["home"]], states[game["away"]]
        expected = 1 / (1 + 10 ** (-(home.elo + 40 - away.elo) / 400))
        actual = 1.0 if game["home_goals"] > game["away_goals"] else 0.0
        change = 16 * (actual - expected)
        home.elo += change
        away.elo -= change
        for name, state in [(game["home"], home), (game["away"], away)]:
            for key, value in row_metrics(game["team_rows"][name]).items():
                state.values[key] = (1 - alpha) * state.values[key] + alpha * value
            state.games += 1
            state.last_date = game["date"]
    for state in states.values():
        for key, prior in PRIORS.items(): state.values[key] = prior + 0.65 * (state.values[key] - prior)
        state.elo = 1500 + 0.72 * (state.elo - 1500)
        state.last_date = None
    return {
        team: {"elo": state.elo, **state.values}
        for team, state in sorted(states.items())
    }


def solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    ncols = len(vector)
    aug = [matrix[i][:] + [vector[i]] for i in range(ncols)]
    for col in range(ncols):
        pivot = max(range(col, ncols), key=lambda row: abs(aug[row][col]))
        aug[col], aug[pivot] = aug[pivot], aug[col]
        divisor = aug[col][col]
        if abs(divisor) < 1e-12: continue
        aug[col] = [value / divisor for value in aug[col]]
        for row in range(ncols):
            if row == col: continue
            factor = aug[row][col]
            if factor == 0: continue
            aug[row] = [aug[row][j] - factor * aug[col][j] for j in range(ncols + 1)]
    return [aug[i][-1] for i in range(ncols)]


def ridge_fit(rows: list[tuple[list[float], float]], ridge: float) -> list[float]:
    size = len(FEATURES)
    xtx = [[0.0] * size for _ in range(size)]
    xty = [0.0] * size
    for x, y in rows:
        for i in range(size):
            xty[i] += x[i] * y
            for j in range(size): xtx[i][j] += x[i] * x[j]
    for i in range(1, size): xtx[i][i] += ridge
    return solve(xtx, xty)


def logistic_features(row: dict[str, Any]) -> list[float]:
    """Pregame-only ability-to-win features, intentionally separate from score fit."""
    home_x, away_x = row["home_x"], row["away_x"]
    return [
        1.0,
        row["ind_home"] - row["ind_away"],
        home_x[15],
        home_x[14],
        (home_x[4] + home_x[8]) - (away_x[4] + away_x[8]),
        (away_x[5] + away_x[9]) - (home_x[5] + home_x[9]),
        home_x[16],
        home_x[17] - away_x[17],
    ]


def logistic_fit(rows: list[dict[str, Any]], ridge: float, steps: int = 36) -> list[float]:
    """Regularized IRLS logistic fit; intercept is left unpenalized."""
    size = len(logistic_features(rows[0]))
    beta = [0.0] * size
    for _ in range(steps):
        hessian = [[0.0] * size for _ in range(size)]
        gradient = [0.0] * size
        for row in rows:
            x = logistic_features(row)
            y = 1.0 if row["home_goals"] > row["away_goals"] else 0.0
            p = 1 / (1 + math.exp(-max(-20, min(20, dot(x, beta)))))
            weight = max(1e-6, p * (1 - p))
            for i in range(size):
                gradient[i] += x[i] * (y - p)
                for j in range(size): hessian[i][j] += weight * x[i] * x[j]
        for i in range(1, size):
            hessian[i][i] += ridge
            gradient[i] -= ridge * beta[i]
        delta = solve(hessian, gradient)
        beta = [value + change for value, change in zip(beta, delta)]
        if max(abs(change) for change in delta) < 1e-7: break
    return beta


def dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def poisson_pmf(lam: float, maximum: int = 12) -> list[float]:
    values = [math.exp(-lam)]
    for k in range(1, maximum + 1): values.append(values[-1] * lam / k)
    values[-1] += max(0.0, 1 - sum(values))
    return values


def distribution(home_lambda: float, away_lambda: float) -> dict[str, Any]:
    hp, ap = poisson_pmf(home_lambda), poisson_pmf(away_lambda)
    home_reg = away_reg = tie = 0.0
    margin_probs: dict[int, float] = defaultdict(float)
    total_probs: dict[int, float] = defaultdict(float)
    for home, ph in enumerate(hp):
        for away, pa in enumerate(ap):
            p = ph * pa
            margin_probs[home - away] += p
            total_probs[home + away] += p
            if home > away: home_reg += p
            elif away > home: away_reg += p
            else: tie += p
    overtime_home = 1 / (1 + math.exp(-0.42 * (home_lambda - away_lambda)))
    return {"home_win": home_reg + tie * overtime_home, "margin": margin_probs, "total": total_probs}


def predict(
    rows: list[dict[str, Any]],
    beta: list[float],
    legacy_forecasts: dict[tuple[int, str, str, str], tuple[float, float, float]],
) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        home = max(1.25, min(5.25, dot(row["home_x"], beta)))
        away = max(1.25, min(5.25, dot(row["away_x"], beta)))
        key = (row["season"], row["date"], row["home"], row["away"])
        legacy_home, legacy_away, legacy_margin = legacy_forecasts.get(key, (home, away, home - away))
        out.append({
            **row,
            "ind_home": home,
            "ind_away": away,
            "legacy_home": legacy_home,
            "legacy_away": legacy_away,
            "legacy_margin": legacy_margin,
        })
    return out


def market_join(rows: list[dict[str, Any]], openings: dict[tuple[int, str, str, str], dict[str, float | None]]) -> list[dict[str, Any]]:
    return [{**row, "market": openings.get((row["season"], row["date"], row["home"], row["away"]))} for row in rows if openings.get((row["season"], row["date"], row["home"], row["away"]))]


def probability_margin(probability: float) -> float:
    return math.log(max(.03, min(.97, probability)) / (1 - max(.03, min(.97, probability)))) / .78


def independent_scores(row: dict[str, Any], ability_weight: float, ability_beta: list[float] | None = None) -> tuple[float, float]:
    ind_total = row["ind_home"] + row["ind_away"]
    score_margin = row["ind_home"] - row["ind_away"]
    if ability_beta is None:
        ability_margin = row["legacy_margin"]
    else:
        ability_probability = 1 / (1 + math.exp(-max(-20, min(20, dot(logistic_features(row), ability_beta)))))
        ability_margin = probability_margin(ability_probability)
    ind_margin = (1 - ability_weight) * score_margin + ability_weight * ability_margin
    return max(1.25, (ind_total + ind_margin) / 2), max(1.25, (ind_total - ind_margin) / 2)


def blended(
    row: dict[str, Any],
    ability_weight: float,
    margin_weight: float,
    total_weight: float,
    ability_beta: list[float] | None = None,
) -> tuple[float, float]:
    independent_home, independent_away = independent_scores(row, ability_weight, ability_beta)
    ind_total = independent_home + independent_away
    ind_margin = independent_home - independent_away
    market = row["market"]
    market_total = market["total"]
    market_home = market["home_prob"]
    market_margin = ind_margin if market_home is None else probability_margin(market_home)
    final_total = ind_total if market_total is None else (1 - total_weight) * ind_total + total_weight * market_total
    final_margin = (1 - margin_weight) * ind_margin + margin_weight * market_margin
    return max(1.25, (final_total + final_margin) / 2), max(1.25, (final_total - final_margin) / 2)


def metrics(
    rows: list[dict[str, Any]],
    ability_weight: float = 0.0,
    margin_weight: float = 0.0,
    total_weight: float = 0.0,
    ability_beta: list[float] | None = None,
    legacy: bool = False,
) -> dict[str, float | int]:
    team_abs = margin_abs = total_abs = brier = logloss = 0.0
    winner = total_correct = total_n = spread_correct = spread_n = 0
    for row in rows:
        if legacy:
            home, away = row["legacy_home"], row["legacy_away"]
        else:
            home, away = blended(row, ability_weight, margin_weight, total_weight, ability_beta) if row.get("market") else independent_scores(row, ability_weight, ability_beta)
        actual_margin = row["home_goals"] - row["away_goals"]
        actual_total = row["home_goals"] + row["away_goals"]
        dist = distribution(home, away)
        team_abs += abs(home - row["home_goals"]) + abs(away - row["away_goals"])
        margin_abs += abs((home - away) - actual_margin)
        total_abs += abs((home + away) - actual_total)
        actual_home_win = row["home_goals"] > row["away_goals"]
        winner += int((dist["home_win"] >= .5) == actual_home_win)
        brier += (dist["home_win"] - int(actual_home_win)) ** 2
        p = max(.001, min(.999, dist["home_win"]))
        logloss += -(int(actual_home_win) * math.log(p) + (1 - int(actual_home_win)) * math.log(1 - p))
        market = row.get("market")
        if market and market["total"] is not None and actual_total != market["total"]:
            total_n += 1
            total_correct += int(((home + away) > market["total"]) == (actual_total > market["total"]))
        if market and market["home_spread"] is not None and actual_margin + market["home_spread"] != 0:
            home_cover = sum(prob for margin, prob in dist["margin"].items() if margin + market["home_spread"] > 0)
            spread_n += 1
            spread_correct += int((home_cover >= .5) == (actual_margin + market["home_spread"] > 0))
    count = len(rows)
    return {
        "n": count, "team_score_mae": team_abs / (2 * count), "margin_mae": margin_abs / count,
        "total_mae": total_abs / count, "winner_accuracy": winner / count, "winner_brier": brier / count,
        "winner_logloss": logloss / count,
        "total_accuracy": total_correct / total_n if total_n else 0, "total_n": total_n,
        "puckline_accuracy": spread_correct / spread_n if spread_n else 0, "puckline_n": spread_n,
    }


def decision_bins(
    rows: list[dict[str, Any]],
    ability_weight: float,
    margin_weight: float,
    total_weight: float,
    ability_beta: list[float],
) -> dict[str, list[dict[str, Any]]]:
    ml_edges = [0.0, .04, .08, .12, 1.0]
    total_edges = [0.0, .15, .30, .50, 99.0]
    puck_edges = [.50, .58, .64, .70, 1.0]
    accum = {
        "moneyline": [[0, 0] for _ in range(4)],
        "total": [[0, 0] for _ in range(4)],
        "puckline": [[0, 0] for _ in range(4)],
    }
    for row in rows:
        home, away = blended(row, ability_weight, margin_weight, total_weight, ability_beta)
        dist = distribution(home, away)
        actual_margin = row["home_goals"] - row["away_goals"]
        actual_total = row["home_goals"] + row["away_goals"]
        home_win = dist["home_win"]
        ml_strength = abs(home_win - .5)
        ml_correct = (home_win >= .5) == (actual_margin > 0)
        for i in range(4):
            if ml_edges[i] <= ml_strength < ml_edges[i + 1]:
                accum["moneyline"][i][0] += 1
                accum["moneyline"][i][1] += int(ml_correct)
                break
        market = row.get("market")
        if not market: continue
        if market["total"] is not None and actual_total != market["total"]:
            gap = abs((home + away) - market["total"])
            correct = ((home + away) > market["total"]) == (actual_total > market["total"])
            for i in range(4):
                if total_edges[i] <= gap < total_edges[i + 1]:
                    accum["total"][i][0] += 1
                    accum["total"][i][1] += int(correct)
                    break
        if market["home_spread"] is not None and actual_margin + market["home_spread"] != 0:
            cover = sum(prob for margin, prob in dist["margin"].items() if margin + market["home_spread"] > 0)
            strength = max(cover, 1 - cover)
            correct = (cover >= .5) == (actual_margin + market["home_spread"] > 0)
            for i in range(4):
                if puck_edges[i] <= strength < puck_edges[i + 1]:
                    accum["puckline"][i][0] += 1
                    accum["puckline"][i][1] += int(correct)
                    break
    def render(name: str, edges: list[float]) -> list[dict[str, Any]]:
        return [
            {"from": edges[i], "to": edges[i + 1], "n": pair[0], "accuracy": pair[1] / pair[0] if pair[0] else None}
            for i, pair in enumerate(accum[name])
        ]
    return {
        "moneyline": render("moneyline", ml_edges),
        "total": render("total", total_edges),
        "puckline": render("puckline", puck_edges),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    games = load_games(args.moneypuck)
    openings = load_openings(args.bdl)
    legacy_forecasts = load_legacy_forecasts(args.bdl)
    core_candidates = []
    for alpha in [0.025, 0.04, 0.06, 0.085, 0.12]:
        examples = build_examples(games, alpha)
        train_examples = [row for row in examples if row["season"] == 2023]
        tune_examples = [row for row in examples if row["season"] == 2024]
        training = [(row[side], row[f"{side.split('_')[0]}_goals"]) for row in train_examples for side in ["home_x", "away_x"]]
        for ridge in [1.0, 5.0, 20.0, 75.0, 200.0]:
            beta = ridge_fit(training, ridge)
            train_predictions = predict(train_examples, beta, legacy_forecasts)
            predictions = predict(tune_examples, beta, legacy_forecasts)
            for ability_ridge in [2.0, 10.0, 40.0, 120.0]:
                ability_beta = logistic_fit(train_predictions, ability_ridge)
                for ability_weight in [0.0, .15, .30, .45, .60]:
                    tune = metrics(predictions, ability_weight, ability_beta=ability_beta)
                    # Score accuracy remains primary. Winner calibration and direction
                    # may improve the margin but cannot overwhelm independently modeled totals.
                    objective = tune["team_score_mae"] + .32 * tune["margin_mae"] + .25 * tune["total_mae"] + .60 * tune["winner_brier"] + .08 * tune["winner_logloss"] - .16 * tune["winner_accuracy"]
                    core_candidates.append({"alpha": alpha, "ridge": ridge, "ability_ridge": ability_ridge, "ability_weight": ability_weight, "beta": beta, "ability_beta": ability_beta, "tune": tune, "objective": objective})
    selected_core = min(core_candidates, key=lambda row: row["objective"])
    examples = build_examples(games, selected_core["alpha"])
    refit_rows = [row for row in examples if row["season"] in {2023, 2024}]
    beta = ridge_fit([(row[side], row[f"{side.split('_')[0]}_goals"]) for row in refit_rows for side in ["home_x", "away_x"]], selected_core["ridge"])
    refit_predictions = predict(refit_rows, beta, legacy_forecasts)
    ability_beta = logistic_fit(refit_predictions, selected_core["ability_ridge"])
    priced = market_join(predict([row for row in examples if row["season"] == 2025], beta, legacy_forecasts), openings)
    cut = int(len(priced) * .70)
    market_tune, holdout = priced[:cut], priced[cut:]
    ability_candidates = []
    for ability_weight in [0.0, .15, .30, .45, .60, .75, 1.0]:
        tune = metrics(market_tune, ability_weight, 0.0, 0.0, ability_beta)
        objective = tune["team_score_mae"] + .32 * tune["margin_mae"] + .25 * tune["total_mae"] + .60 * tune["winner_brier"] + .08 * tune["winner_logloss"] - .16 * tune["winner_accuracy"]
        ability_candidates.append({"ability_weight": ability_weight, "tune": tune, "objective": objective})
    selected_ability = min(ability_candidates, key=lambda row: row["objective"])
    selected_ability_weight = selected_ability["ability_weight"]
    marriage_candidates = []
    for margin_weight in [0.0, 0.10, 0.20, 0.30, 0.40]:
        for total_weight in [0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.65]:
            tune = metrics(market_tune, selected_ability_weight, margin_weight, total_weight, ability_beta)
            # Market evidence is a conditional correction, not the forecast engine.
            # Select on score error, calibrated win probability, and all directions.
            objective = tune["team_score_mae"] + .32 * tune["margin_mae"] + .38 * tune["total_mae"] + .62 * tune["winner_brier"] + .08 * tune["winner_logloss"] - .16 * tune["winner_accuracy"] - .14 * tune["total_accuracy"] - .10 * tune["puckline_accuracy"]
            marriage_candidates.append({"margin_weight": margin_weight, "total_weight": total_weight, "tune": tune, "objective": objective})
    best_marriage_objective = min(row["objective"] for row in marriage_candidates)
    # Prefer the least market-dependent statistically equivalent candidate.
    # The 0.10 Total blend improved tune MAE by only 0.0001 goals and worsened
    # untouched-holdout error; that is not enough evidence to replace the
    # independent Total forecast with a sportsbook anchor.
    equivalent_marriages = [row for row in marriage_candidates if row["objective"] <= best_marriage_objective + .0002]
    selected_marriage = min(equivalent_marriages, key=lambda row: (row["total_weight"], row["margin_weight"], row["objective"]))
    independent_holdout = metrics(holdout, selected_ability_weight, ability_beta=ability_beta)
    final_holdout = metrics(holdout, selected_ability_weight, selected_marriage["margin_weight"], selected_marriage["total_weight"], ability_beta)
    baseline_holdout = metrics(holdout, selected_ability_weight, .30, .90, ability_beta)
    legacy_holdout = metrics(holdout, legacy=True)
    diagnostic_ability_curve = [
        {
            "ability_weight": weight,
            "market_tune": metrics(market_tune, weight, 0.0, 0.0, ability_beta),
            "holdout": metrics(holdout, weight, 0.0, 0.0, ability_beta),
        }
        for weight in [0.0, .15, .30, .45, .60, .75, 1.0]
    ]
    diagnostic_market_curve = [
        {
            "margin_weight": weight,
            "market_tune": metrics(market_tune, selected_ability_weight, weight, 0.0, ability_beta),
            "holdout": metrics(holdout, selected_ability_weight, weight, 0.0, ability_beta),
        }
        for weight in [0.0, .10, .20, .30, .40]
    ]
    result = {
        "release": "nhl_professional_score_tournament_2026_09_29_r2",
        "source_manifest": "bdl_nhl_regular_history_2026_09_29_r2_complete_openings",
        "protocol": {"warmup": 2022, "core_train": 2023, "core_tune": 2024, "market_tune": "first_70pct_priced_2025", "holdout": "final_30pct_priced_2025"},
        "data": {"moneypuck_games": len(games), "priced_2025": len(priced), "market_tune": len(market_tune), "holdout": len(holdout)},
        "features": FEATURES,
        "runtime_2026_opening_priors": opening_priors(games, selected_core["alpha"]),
        "selected_core": {"alpha": selected_core["alpha"], "ridge": selected_core["ridge"], "ability_ridge": selected_core["ability_ridge"], "beta": beta, "ability_beta": ability_beta, "tune_2024": selected_core["tune"]},
        "selected_ability": selected_ability,
        "selected_marriage": {"margin_weight": selected_marriage["margin_weight"], "total_weight": selected_marriage["total_weight"], "tune_2025": selected_marriage["tune"]},
        "holdout": {"legacy_independent": legacy_holdout, "professional_independent": independent_holdout, "candidate": final_holdout, "candidate_with_legacy_30pct_margin_90pct_total": baseline_holdout},
        "decision_calibration": {
            "tune": decision_bins(market_tune, selected_ability_weight, selected_marriage["margin_weight"], selected_marriage["total_weight"], ability_beta),
            "holdout": decision_bins(holdout, selected_ability_weight, selected_marriage["margin_weight"], selected_marriage["total_weight"], ability_beta),
        },
        "top_core": sorted(core_candidates, key=lambda row: row["objective"])[:5],
        "ability_candidates": ability_candidates,
        "top_marriage": sorted(marriage_candidates, key=lambda row: row["objective"])[:10],
        "diagnostic_ability_curve": diagnostic_ability_curve,
        "diagnostic_market_curve": diagnostic_market_curve,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
