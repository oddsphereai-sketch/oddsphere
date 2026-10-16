#!/usr/bin/env python3
"""Chronological, market-free NHL winner-head architecture tournament.

The candidate predicts a home-win probability from strictly lagged team state.
For product coherence, that probability is converted to the unique goal margin
whose Poisson settlement distribution has the same win probability while the
independent score model's projected total is preserved.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any, Callable


SCORE_BETA = [
    2.9780546116531066, 0.1796256256709038, 0.19790828165857607,
    0.1916787455944218, 0.21571727756307035, 0.31307021298110915,
    0.043241636066699105, 0.3101399816597343, 0.05952024232239039,
    0.213239319922914, -0.011341534853054044, -0.03964933962980568,
    -0.017808995904590084, -0.12139146738681414, 0.05824064025009689,
    0.3687578559301108, 0.07458718668794515, -0.11097641372547018,
    0.04338959014834951, 0.08307004907456006,
]

ABILITY_BETA = [
    -0.17236562564475472, 0.7948403714740907, 0.37042700976601217,
    -0.6233355872095584, -0.03540520777115418, -0.014228820288914758,
    -0.015795062368390175, -0.06228140429571857,
]


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


def solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    size = len(vector)
    augmented = [matrix[index][:] + [vector[index]] for index in range(size)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        if abs(divisor) < 1e-12:
            continue
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            if factor:
                augmented[row] = [
                    augmented[row][index] - factor * augmented[column][index]
                    for index in range(size + 1)
                ]
    return [augmented[index][-1] for index in range(size)]


def standardize(
    rows: list[dict[str, Any]],
    feature: Callable[[dict[str, Any]], list[float]],
) -> tuple[list[float], list[float]]:
    values = [feature(row)[1:] for row in rows]
    size = len(values[0])
    means = [sum(row[index] for row in values) / len(values) for index in range(size)]
    scales = []
    for index in range(size):
        variance = sum((row[index] - means[index]) ** 2 for row in values) / len(values)
        scales.append(max(1e-6, math.sqrt(variance)))
    return means, scales


def scaled(values: list[float], means: list[float], scales: list[float]) -> list[float]:
    return [1.0] + [
        (value - means[index]) / scales[index]
        for index, value in enumerate(values[1:])
    ]


def logistic_fit(
    rows: list[dict[str, Any]],
    feature: Callable[[dict[str, Any]], list[float]],
    ridge: float,
) -> tuple[list[float], list[float], list[float]]:
    means, scales = standardize(rows, feature)
    size = len(means) + 1
    beta = [0.0] * size
    for _ in range(45):
        hessian = [[0.0] * size for _ in range(size)]
        gradient = [0.0] * size
        for row in rows:
            x = scaled(feature(row), means, scales)
            y = float(row["home_goals"] > row["away_goals"])
            probability = logistic(sum(left * right for left, right in zip(x, beta)))
            weight = max(1e-6, probability * (1 - probability))
            for left in range(size):
                gradient[left] += x[left] * (y - probability)
                for right in range(size):
                    hessian[left][right] += weight * x[left] * x[right]
        for index in range(1, size):
            hessian[index][index] += ridge
            gradient[index] -= ridge * beta[index]
        delta = solve(hessian, gradient)
        beta = [value + change for value, change in zip(beta, delta)]
        if max(abs(change) for change in delta) < 1e-8:
            break
    return beta, means, scales


def predict_probability(
    row: dict[str, Any],
    feature: Callable[[dict[str, Any]], list[float]],
    model: tuple[list[float], list[float], list[float]],
) -> float:
    beta, means, scales = model
    x = scaled(feature(row), means, scales)
    return logistic(sum(left * right for left, right in zip(x, beta)))


def matchup(values: list[float], opponent: list[float], own_for: int, opp_against: int) -> float:
    return values[own_for] + values[opp_against]


def compact(row: dict[str, Any]) -> list[float]:
    home, away = row["home_x"], row["away_x"]
    return [
        1.0,
        home[15],
        home[14],
        matchup(home, away, 2, 3) - matchup(away, home, 2, 3),
        matchup(home, away, 4, 5) - matchup(away, home, 4, 5),
        matchup(home, away, 6, 7) - matchup(away, home, 6, 7),
        matchup(home, away, 8, 9) - matchup(away, home, 8, 9),
        matchup(home, away, 10, 11) - matchup(away, home, 10, 11),
        matchup(home, away, 12, 13) - matchup(away, home, 12, 13),
        home[16], home[17], home[18], home[19] - away[19],
    ]


def chance_only(row: dict[str, Any]) -> list[float]:
    values = compact(row)
    return [values[index] for index in (0, 1, 4, 5, 6, 7, 9, 10, 11, 12)]


def rich(row: dict[str, Any]) -> list[float]:
    home, away = row["home_x"], row["away_x"]
    core = compact(row)
    components = [
        home[2] - away[2], home[3] - away[3],
        home[4] - away[4], home[5] - away[5],
        home[6] - away[6], home[7] - away[7],
        home[8] - away[8], home[9] - away[9],
        home[10] - away[10], home[11] - away[11],
        home[12] - away[12], home[13] - away[13],
    ]
    return core + components


FEATURES: dict[str, Callable[[dict[str, Any]], list[float]]] = {
    "chance_only": chance_only,
    "compact_matchup": compact,
    "rich_matchup": rich,
}


def standard_total(row: dict[str, Any]) -> float:
    home = clamp(sum(left * right for left, right in zip(row["home_x"], SCORE_BETA)), 1.25, 5.25)
    away = clamp(sum(left * right for left, right in zip(row["away_x"], SCORE_BETA)), 1.25, 5.25)
    return clamp(home + away, 4.5, 8.0)


def margin_for_probability(base: Any, total: float, target: float) -> float:
    low, high = -min(5.0, total - 2.5), min(5.0, total - 2.5)
    for _ in range(50):
        margin = (low + high) / 2
        home, away = (total + margin) / 2, (total - margin) / 2
        probability = base.distribution(home, away)["home_win"]
        if probability < target:
            low = margin
        else:
            high = margin
    return (low + high) / 2


def score_pair(base: Any, row: dict[str, Any], probability: float) -> tuple[float, float]:
    total = standard_total(row)
    margin = margin_for_probability(base, total, probability)
    return (total + margin) / 2, (total - margin) / 2


def metrics(
    base: Any,
    rows: list[dict[str, Any]],
    probabilities: list[float],
    include_score_metrics: bool = True,
) -> dict[str, Any]:
    wins = 0
    brier = log_loss = team_error = margin_error = total_error = 0.0
    segments: list[dict[str, Any]] = []
    for row, probability in zip(rows, probabilities):
        actual_home = row["home_goals"] > row["away_goals"]
        wins += int((probability >= 0.5) == actual_home)
        y = int(actual_home)
        p = clamp(probability, 0.001, 0.999)
        brier += (p - y) ** 2
        log_loss += -(y * math.log(p) + (1 - y) * math.log(1 - p))
        if include_score_metrics:
            home, away = score_pair(base, row, p)
            actual_margin = row["home_goals"] - row["away_goals"]
            actual_total = row["home_goals"] + row["away_goals"]
            team_error += abs(home - row["home_goals"]) + abs(away - row["away_goals"])
            margin_error += abs((home - away) - actual_margin)
            total_error += abs((home + away) - actual_total)
        segments.append({"date": row["date"], "correct": int((p >= 0.5) == actual_home)})
    n = len(rows)
    chronological = []
    for index in range(4):
        start, end = n * index // 4, n * (index + 1) // 4
        part = segments[start:end]
        chronological.append({
            "n": len(part),
            "from": part[0]["date"] if part else None,
            "to": part[-1]["date"] if part else None,
            "accuracy": sum(item["correct"] for item in part) / len(part) if part else None,
        })
    return {
        "n": n,
        "record": f"{wins}-{n - wins}",
        "accuracy": wins / n,
        "brier": brier / n,
        "log_loss": log_loss / n,
        "team_score_mae": team_error / (2 * n) if include_score_metrics else None,
        "margin_mae": margin_error / n if include_score_metrics else None,
        "total_mae": total_error / n if include_score_metrics else None,
        "chronological_quarters": chronological,
    }


def current_runtime_probability(base: Any, row: dict[str, Any]) -> float:
    home = clamp(sum(left * right for left, right in zip(row["home_x"], SCORE_BETA)), 1.25, 5.25)
    away = clamp(sum(left * right for left, right in zip(row["away_x"], SCORE_BETA)), 1.25, 5.25)
    enriched = {**row, "ind_home": home, "ind_away": away}
    ability = logistic(sum(left * right for left, right in zip(base.logistic_features(enriched), ABILITY_BETA)))
    ability_margin = math.log(clamp(ability, .03, .97) / (1 - clamp(ability, .03, .97))) / .78
    margin = .55 * (home - away) + .45 * ability_margin
    total = home + away
    return base.distribution((total + margin) / 2, (total - margin) / 2)["home_win"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--teams", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load_module("nhl_direct_probability_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    games = base.load_games(args.teams, max_season=2026)
    candidates: list[dict[str, Any]] = []
    for alpha in (0.025, 0.04, 0.06, 0.085):
        examples = base.build_examples(games, alpha)
        train = [row for row in examples if 2019 <= row["season"] <= 2023]
        tune = [row for row in examples if row["season"] == 2024]
        for family, feature in FEATURES.items():
            for ridge in (2.0, 10.0, 40.0, 120.0, 400.0):
                model = logistic_fit(train, feature, ridge)
                probabilities = [predict_probability(row, feature, model) for row in tune]
                report = metrics(base, tune, probabilities, include_score_metrics=False)
                objective = report["log_loss"] + 0.8 * report["brier"] - 0.04 * report["accuracy"]
                candidates.append({
                    "alpha": alpha, "family": family, "ridge": ridge,
                    "objective": objective, "selection_2024": report,
                })
    selected = min(candidates, key=lambda row: row["objective"])
    examples = base.build_examples(games, selected["alpha"])
    feature = FEATURES[selected["family"]]
    fit = [row for row in examples if 2019 <= row["season"] <= 2024]
    model = logistic_fit(fit, feature, selected["ridge"])
    cohorts = {
        "historical_confirmation_2025": [row for row in examples if row["season"] == 2025],
        "opened_current_2026": [row for row in examples if row["season"] == 2026],
    }
    reports = {}
    for name, rows in cohorts.items():
        candidate_probabilities = [predict_probability(row, feature, model) for row in rows]
        runtime_probabilities = [current_runtime_probability(base, row) for row in rows]
        reports[name] = {
            "candidate": metrics(base, rows, candidate_probabilities),
            "current_non_roster_runtime_comparator": metrics(base, rows, runtime_probabilities),
            "paired_side_changes": sum(
                (candidate >= .5) != (runtime >= .5)
                for candidate, runtime in zip(candidate_probabilities, runtime_probabilities)
            ),
            "candidate_corrections": sum(
                (candidate >= .5) == (row["home_goals"] > row["away_goals"])
                and (runtime >= .5) != (row["home_goals"] > row["away_goals"])
                for row, candidate, runtime in zip(rows, candidate_probabilities, runtime_probabilities)
            ),
            "candidate_harms": sum(
                (candidate >= .5) != (row["home_goals"] > row["away_goals"])
                and (runtime >= .5) == (row["home_goals"] > row["away_goals"])
                for row, candidate, runtime in zip(rows, candidate_probabilities, runtime_probabilities)
            ),
        }
    print(json.dumps({
        "protocol": {
            "market_free": True,
            "train": "2019-2023",
            "selection": 2024,
            "historical_confirmation": 2025,
            "opened_current_gate": 2026,
            "coherence": "candidate probability solved to Poisson goal margin; independent projected total preserved",
        },
        "selected": selected,
        "model": {"beta": model[0], "means": model[1], "scales": model[2]},
        "reports": reports,
        "top_selection_candidates": sorted(candidates, key=lambda row: row["objective"])[:10],
    }, indent=2))


if __name__ == "__main__":
    main()
