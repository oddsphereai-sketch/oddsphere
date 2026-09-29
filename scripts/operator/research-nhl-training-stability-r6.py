#!/usr/bin/env python3
"""Chronological multi-season NHL training-window tournament."""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_games(path: Path, base: Any, first_season: int = 2016) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, dict[str, dict[str, str]]]] = defaultdict(lambda: defaultdict(dict))
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            season = int(row["season"])
            if season < first_season or season > 2025 or row["position"] != "Team Level":
                continue
            if len(row["gameId"]) < 6 or row["gameId"][4:6] != "02":
                continue
            if row["situation"] not in {"all", "5on5", "5on4", "4on5"}:
                continue
            grouped[row["gameId"]][base.alias(row["playerTeam"])][row["situation"]] = row
    games = []
    for game_id, teams in grouped.items():
        if len(teams) != 2:
            continue
        home = next((team for team, situations in teams.items() if situations.get("all", {}).get("home_or_away") == "HOME"), None)
        away = next((team for team in teams if team != home), None)
        if not home or not away or "all" not in teams[home] or "all" not in teams[away]:
            continue
        raw = teams[home]["all"]
        raw_date = raw["gameDate"]
        games.append({
            "id": int(game_id), "season": int(raw["season"]),
            "date": f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}",
            "home": home, "away": away,
            "home_goals": int(base.n(raw["goalsFor"])),
            "away_goals": int(base.n(teams[away]["all"]["goalsFor"])),
            "team_rows": teams,
        })
    return sorted(games, key=lambda row: (row["date"], row["id"]))


def weighted_ridge(rows: list[tuple[list[float], float, float]], ridge: float, research: Any) -> list[float]:
    size = len(rows[0][0])
    xtx = [[0.0] * size for _ in range(size)]
    xty = [0.0] * size
    for x, y, weight in rows:
        for i in range(size):
            xty[i] += weight * x[i] * y
            for j in range(size):
                xtx[i][j] += weight * x[i] * x[j]
    for i in range(1, size):
        xtx[i][i] += ridge
    return research.solve(xtx, xty)


def weighted_logistic(rows: list[dict[str, Any]], ridge: float, decay: float, latest: int, research: Any, steps: int = 36) -> list[float]:
    size = 8
    beta = [0.0] * size
    for _ in range(steps):
        hessian = [[0.0] * size for _ in range(size)]
        gradient = [0.0] * size
        for row in rows:
            weight = decay ** (latest - row["season"])
            x = research.logistic_features(row)
            y = float(row["home_goals"] > row["away_goals"])
            p = 1 / (1 + __import__("math").exp(-max(-20, min(20, research.dot(x, beta)))))
            variance = max(1e-6, p * (1 - p))
            for i in range(size):
                gradient[i] += weight * x[i] * (y - p)
                for j in range(size):
                    hessian[i][j] += weight * variance * x[i] * x[j]
        for i in range(1, size):
            hessian[i][i] += ridge
            gradient[i] -= ridge * beta[i]
        delta = research.solve(hessian, gradient)
        beta = [value + change for value, change in zip(beta, delta)]
        if max(abs(change) for change in delta) < 1e-7:
            break
    return beta


def score_objective(report: dict[str, float | int]) -> float:
    return float(report["team_score_mae"]) + .34 * float(report["margin_mae"]) + .34 * float(report["total_mae"])


def full_objective(report: dict[str, float | int]) -> float:
    return score_objective(report) + .60 * float(report["winner_brier"]) + .08 * float(report["winner_logloss"]) - .16 * float(report["winner_accuracy"])


def weighted_score_fit(rows: list[dict[str, Any]], start: int, latest: int, decay: float, ridge: float, research: Any) -> list[float]:
    training = []
    for row in rows:
        if row["season"] < start or row["season"] > latest:
            continue
        weight = decay ** (latest - row["season"])
        training += [(row["home_x"], row["home_goals"], weight), (row["away_x"], row["away_goals"], weight)]
    return weighted_ridge(training, ridge, research)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--goalies", required=True, type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--family", choices=["all", "long_history", "long_history_opponent_adjusted", "long_history_goal_adjusted", "long_history_static_adjusted"], default="all")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load("nhl_baseline_stability", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    research = load("nhl_matchup_stability", root / "scripts/operator/research-nhl-matchup-features-r6.py")
    games = load_games(args.moneypuck, base)
    openings = base.load_openings(args.bdl)
    starter, goalie_results = research.read_goalies(args.goalies)
    outputs = []
    families = [
        ("long_history", []),
        ("long_history_opponent_adjusted", ["opponent_adjusted"]),
        ("long_history_goal_adjusted", ["opponent_adjusted_goals"]),
        ("long_history_static_adjusted", ["opponent_adjusted_static"]),
    ]
    if args.family != "all":
        families = [candidate for candidate in families if candidate[0] == args.family]
    for family, parts in families:
        print(f"family={family}", flush=True)
        examples_by_alpha = {
            alpha: research.build_examples(base, games, alpha, parts, starter, goalie_results)
            for alpha in [.025, .04, .06, .085]
        }
        score_candidates = []
        for alpha, examples in examples_by_alpha.items():
            tune = [row for row in examples if row["season"] == 2024]
            for start in [2018, 2020, 2022, 2023]:
                for decay in [.55, .70, .85, 1.0]:
                    if start == 2023 and decay != 1.0:
                        continue
                    for ridge in [20.0, 75.0, 200.0]:
                        beta = weighted_score_fit(examples, start, 2023, decay, ridge, research)
                        predictions = research.predict(tune, beta)
                        report = research.metrics(base, predictions, 0.0, [0.0] * 8)
                        score_candidates.append({"alpha": alpha, "start": start, "decay": decay, "ridge": ridge, "beta": beta, "score_tune": report, "score_objective": score_objective(report)})
        finalists = sorted(score_candidates, key=lambda row: row["score_objective"])[:12]
        finalists_full = []
        for candidate in finalists:
            examples = examples_by_alpha[candidate["alpha"]]
            train = [row for row in examples if candidate["start"] <= row["season"] <= 2023]
            tune_predictions = research.predict([row for row in examples if row["season"] == 2024], candidate["beta"])
            train_predictions = research.predict(train, candidate["beta"])
            for ability_ridge in [2.0, 10.0, 40.0]:
                ability_beta = weighted_logistic(train_predictions, ability_ridge, candidate["decay"], 2023, research)
                for ability_weight in [0.0, .30, .45, .60, .75, 1.0]:
                    report = research.metrics(base, tune_predictions, ability_weight, ability_beta)
                    finalists_full.append({**candidate, "ability_ridge": ability_ridge, "ability_weight": ability_weight, "ability_beta": ability_beta, "tune": report, "objective": full_objective(report)})
        selected = min(finalists_full, key=lambda row: row["objective"])
        examples = examples_by_alpha[selected["alpha"]]
        beta = weighted_score_fit(examples, selected["start"], 2024, selected["decay"], selected["ridge"], research)
        refit = research.predict([row for row in examples if selected["start"] <= row["season"] <= 2024], beta)
        ability_beta = weighted_logistic(refit, selected["ability_ridge"], selected["decay"], 2024, research)
        priced = base.market_join(research.predict([row for row in examples if row["season"] == 2025], beta), openings)
        cut = int(len(priced) * .70)
        market_tune, holdout = priced[:cut], priced[cut:]
        marriage = []
        for ability_weight in [0.0, .30, .45, .60, .75, 1.0]:
            for market_weight in [0.0, .10, .20, .30, .40]:
                report = research.metrics(base, market_tune, ability_weight, ability_beta, market_weight)
                marriage.append({"ability_weight": ability_weight, "market_weight": market_weight, "metrics": report, "objective": full_objective(report) - .10 * float(report["total_accuracy"]) - .08 * float(report["puckline_accuracy"])})
        best_value = min(row["objective"] for row in marriage)
        equivalent = [row for row in marriage if row["objective"] <= best_value + .0002]
        selected_marriage = min(equivalent, key=lambda row: (row["market_weight"], row["ability_weight"], row["objective"]))
        result = {
            "family": family,
            "features": research.feature_names(parts),
            "selected_training": {key: selected[key] for key in ["alpha", "start", "decay", "ridge", "ability_ridge"]},
            "selected_marriage": {key: selected_marriage[key] for key in ["ability_weight", "market_weight"]},
            "beta": beta,
            "ability_beta": ability_beta,
            "tune_2024": selected["tune"],
            "market_tune_2025": selected_marriage["metrics"],
            "holdout_2025": research.metrics(base, holdout, selected_marriage["ability_weight"], ability_beta, selected_marriage["market_weight"]),
            "full_priced_2025": research.metrics(base, priced, selected_marriage["ability_weight"], ability_beta, selected_marriage["market_weight"]),
            "data": {"games": len(games), "examples": len(examples), "priced": len(priced), "holdout": len(holdout)},
        }
        outputs.append(result)
        print(json.dumps({"family": family, "selected": result["selected_training"], "marriage": result["selected_marriage"], "tune": result["tune_2024"], "holdout": result["holdout_2025"], "full": result["full_priced_2025"]}), flush=True)
    payload = {
        "release": "nhl_training_stability_tournament_2026_09_29_r1",
        "protocol": {"candidate_training": "recency_weighted_2018_or_later_through_2023", "tune": 2024, "refit": "through_2024", "market_tune": "first_70pct_priced_2025", "holdout": "final_30pct_priced_2025"},
        "families": outputs,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__":
    main()
