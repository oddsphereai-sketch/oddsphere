#!/usr/bin/env python3
"""Chronological NHL dynamic attack/defence Poisson tournament.

The score head is independent of sportsbook lines. Each club carries an
evolving attack rating and defensive-weakness rating, updated only after a
game settles. Expected goals stabilize noisy final scores during learning;
official settled scores remain the evaluation target.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@dataclass
class Rating:
    attack: float = 0.0
    defence: float = 0.0
    last_date: str | None = None


def clipped_exp(value: float) -> float:
    return min(5.75, max(0.75, math.exp(value)))


def predictions(
    games: list[dict[str, Any]], base: Any, *, update: float, goal_weight: float,
    season_shrink: float, league_update: float, home_goals: float, rest_goals: float,
) -> dict[int, tuple[float, float]]:
    ratings: dict[str, Rating] = defaultdict(Rating)
    league_rate = 3.05
    season: int | None = None
    output: dict[int, tuple[float, float]] = {}
    for game_index, game in enumerate(games):
        if season is not None and game["season"] != season:
            for rating in ratings.values():
                rating.attack *= season_shrink
                rating.defence *= season_shrink
                rating.last_date = None
        season = game["season"]
        home, away = ratings[game["home"]], ratings[game["away"]]
        home_rest = base.days_between(home.last_date, game["date"])
        away_rest = base.days_between(away.last_date, game["date"])
        rest_delta = 0.0 if home_rest is None or away_rest is None else max(-3.0, min(3.0, home_rest - away_rest))
        rest = rest_goals * rest_delta
        home_rate = clipped_exp(math.log(league_rate) + home.attack + away.defence + home_goals / league_rate + rest / league_rate)
        away_rate = clipped_exp(math.log(league_rate) + away.attack + home.defence - rest / league_rate)
        output[game["id"]] = (home_rate, away_rate)

        home_metrics = base.row_metrics(game["team_rows"][game["home"]])
        away_metrics = base.row_metrics(game["team_rows"][game["away"]])
        home_target = goal_weight * game["home_goals"] + (1 - goal_weight) * home_metrics["xgf"]
        away_target = goal_weight * game["away_goals"] + (1 - goal_weight) * away_metrics["xgf"]
        home_residual = (home_target - home_rate) / max(1.0, home_rate)
        away_residual = (away_target - away_rate) / max(1.0, away_rate)
        home.attack += update * home_residual
        away.defence += update * home_residual
        away.attack += update * away_residual
        home.defence += update * away_residual
        if game_index % 64 == 0:
            centre_attack = sum(r.attack for r in ratings.values()) / max(1, len(ratings))
            centre_defence = sum(r.defence for r in ratings.values()) / max(1, len(ratings))
            for rating in ratings.values():
                rating.attack -= centre_attack
                rating.defence -= centre_defence
        observed_rate = (home_target + away_target) / 2
        league_rate = min(3.65, max(2.45, (1 - league_update) * league_rate + league_update * observed_rate))
        home.last_date = away.last_date = game["date"]
    return output


def objective(report: dict[str, Any]) -> float:
    return (
        report["team_score_mae"] + 0.35 * report["margin_mae"]
        + 0.35 * report["total_mae"] + 0.60 * report["winner_brier"]
        + 0.08 * report["winner_logloss"] - 0.16 * report["winner_accuracy"]
    )


def score_rows(rows: list[dict[str, Any]], values: dict[int, tuple[float, float]]) -> list[tuple[float, float]]:
    return [values[row["id"]] for row in rows]


def component_ensemble(
    dynamic: list[tuple[float, float]], incumbent: list[tuple[float, float]],
    total_weight: float, margin_weight: float,
) -> list[tuple[float, float]]:
    output = []
    for candidate, old in zip(dynamic, incumbent):
        total = (1 - total_weight) * sum(old) + total_weight * sum(candidate)
        margin = (1 - margin_weight) * (old[0] - old[1]) + margin_weight * (candidate[0] - candidate[1])
        output.append(((total + margin) / 2, (total - margin) / 2))
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", type=Path, required=True)
    parser.add_argument("--goalies", type=Path, required=True)
    parser.add_argument("--bdl", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load("nhl_dynamic_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    coherent = load("nhl_dynamic_coherent", root / "scripts/operator/research-nhl-coherent-score-r8.py")
    features = load("nhl_dynamic_features", root / "scripts/operator/research-nhl-matchup-features-r6.py")
    stability = load("nhl_dynamic_stability", root / "scripts/operator/research-nhl-training-stability-r6.py")
    incumbent_module = load("nhl_dynamic_incumbent", root / "scripts/operator/audit-nhl-r7-predictiveness.py")

    games = coherent.apply_settled_scores(
        stability.load_games(args.moneypuck, base), coherent.load_settled_scores(args.bdl),
    )
    starter, goalie_results = features.read_goalies(args.goalies)
    incumbent_rows = features.build_examples(base, games, 0.085, ["opponent_adjusted"], starter, goalie_results)
    tune = [{**row, "market": {"home_prob": None}} for row in incumbent_rows if row["season"] == 2024]
    holdout = [{**row, "market": {"home_prob": None}} for row in incumbent_rows if row["season"] == 2025]
    incumbent_tune = incumbent_module.r7_predictions(tune, coherent, features)
    incumbent_holdout = incumbent_module.r7_predictions(holdout, coherent, features)

    candidates = []
    fitted: dict[str, dict[int, tuple[float, float]]] = {}
    for update in (0.015, 0.03, 0.05, 0.075, 0.10):
        for goal_weight in (0.20, 0.40, 0.60, 0.80):
            for season_shrink in (0.45, 0.65, 0.80):
                for league_update in (0.005, 0.015, 0.03):
                    for home_goals in (0.10, 0.18, 0.26):
                        key = f"{update}:{goal_weight}:{season_shrink}:{league_update}:{home_goals}"
                        values = predictions(
                            games, base, update=update, goal_weight=goal_weight,
                            season_shrink=season_shrink, league_update=league_update,
                            home_goals=home_goals, rest_goals=0.025,
                        )
                        report = coherent.evaluate(tune, score_rows(tune, values))
                        candidates.append({
                            "key": key, "update": update, "goal_weight": goal_weight,
                            "season_shrink": season_shrink, "league_update": league_update,
                            "home_goals": home_goals, "rest_goals": 0.025,
                            "objective": objective(report), "tune_2024": report,
                        })
                        fitted[key] = values
    selected = min(candidates, key=lambda row: row["objective"])
    selected_values = fitted[selected["key"]]
    tune_scores = score_rows(tune, selected_values)
    holdout_scores = score_rows(holdout, selected_values)
    ensemble_candidates = []
    for total_weight in (0.0, 0.25, 0.50, 0.75, 1.0):
        for margin_weight in (0.0, 0.25, 0.50, 0.75, 1.0):
            scores = component_ensemble(tune_scores, incumbent_tune, total_weight, margin_weight)
            report = coherent.evaluate(tune, scores)
            ensemble_candidates.append({
                "total_weight": total_weight, "margin_weight": margin_weight,
                "objective": objective(report), "tune_2024": report,
            })
    ensemble = min(ensemble_candidates, key=lambda row: row["objective"])
    ensemble_holdout = component_ensemble(
        holdout_scores, incumbent_holdout, ensemble["total_weight"], ensemble["margin_weight"],
    )
    payload = {
        "release": "nhl_dynamic_attack_defence_poisson_research_2026_09_29_r1",
        "protocol": {
            "score_inputs": "pregame dynamic team attack, opponent defensive weakness, home ice, rest, prior official goals and prior xG",
            "market_in_score_head": False,
            "selection": "2024", "untouched_report": "2025",
        },
        "selected": selected,
        "holdout_2025": coherent.evaluate(holdout, holdout_scores),
        "ensemble": ensemble,
        "ensemble_holdout_2025": coherent.evaluate(holdout, ensemble_holdout),
        "incumbent_tune_2024": coherent.evaluate(tune, incumbent_tune),
        "incumbent_holdout_2025": coherent.evaluate(holdout, incumbent_holdout),
        "top_candidates": sorted(candidates, key=lambda row: row["objective"])[:12],
        "top_ensembles": sorted(ensemble_candidates, key=lambda row: row["objective"])[:10],
        "counts": {"tune": len(tune), "holdout": len(holdout), "candidate_grid": len(candidates)},
    }
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
