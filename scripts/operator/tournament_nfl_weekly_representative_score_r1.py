#!/usr/bin/env python3
"""Frozen tournament for the NFL weekly representative-score point functional."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
from collections import defaultdict
from typing import Any

import numpy as np
import pandas as pd


TOURNAMENT_RELEASE = "nfl_weekly_representative_score_tournament_2026_09_25_r1"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
CANDIDATE_WEIGHTS = (0.0, 0.05, 0.10, 0.20, 0.40, 0.80, 1.20)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def shifted_distribution(source: dict[str, list[float]], target_mean: float, nonnegative: bool) -> dict[int, float]:
    values = np.asarray(source["values"], dtype=float)
    probabilities = np.asarray(source["probabilities"], dtype=float)
    source_mean = float(np.sum(values * probabilities))
    result: dict[int, float] = defaultdict(float)
    for value, probability in zip(values, probabilities, strict=True):
        shifted = float(value - source_mean + target_mean)
        lower = math.floor(shifted)
        upper = math.ceil(shifted)
        upper_weight = shifted - lower
        if nonnegative:
            lower = max(0, lower)
            upper = max(0, upper)
        if lower == upper:
            result[lower] += float(probability)
        else:
            result[lower] += float(probability) * (1.0 - upper_weight)
            result[upper] += float(probability) * upper_weight
    total = sum(result.values())
    return {value: probability / total for value, probability in sorted(result.items()) if probability > 0.0}


def pooled_shifted_distribution(sources: list[dict[str, list[float]]], target_mean: float, nonnegative: bool) -> dict[int, float]:
    pooled: dict[int, float] = defaultdict(float)
    for source in sources:
        shifted = shifted_distribution(source, target_mean, nonnegative)
        for value, probability in shifted.items():
            pooled[value] += probability / len(sources)
    total = sum(pooled.values())
    return {value: probability / total for value, probability in sorted(pooled.items()) if probability > 0.0}


def distribution_mean(distribution: dict[int, float]) -> float:
    return sum(value * probability for value, probability in distribution.items())


def home_favored(distribution: dict[int, float]) -> bool:
    positive = sum(probability for value, probability in distribution.items() if value > 0)
    negative = sum(probability for value, probability in distribution.items() if value < 0)
    return positive > negative


def incumbent_score(expected_margin: float, expected_total: float, favored_home: bool) -> tuple[int, int]:
    expected_away = max(0.0, (expected_total - expected_margin) / 2.0)
    expected_home = max(0.0, (expected_total + expected_margin) / 2.0)
    best = (math.inf, 0, 1)
    for away in range(71):
        for home in range(71):
            if away == home or ((home > away) != favored_home):
                continue
            distance = abs(away - expected_away) + abs(home - expected_home)
            if distance < best[0]:
                best = (distance, away, home)
    return best[1], best[2]


def candidate_score(
    margin_distribution: dict[int, float],
    total_distribution: dict[int, float],
    weight: float,
) -> tuple[int, int]:
    expected_margin = distribution_mean(margin_distribution)
    expected_total = distribution_mean(total_distribution)
    favored_home = home_favored(margin_distribution)
    ranked: list[tuple[tuple[float, float, float, int, int], tuple[int, int]]] = []
    for margin, margin_probability in margin_distribution.items():
        if margin == 0 or ((margin > 0) != favored_home):
            continue
        for total, total_probability in total_distribution.items():
            if total < abs(margin) or (total + margin) % 2 != 0:
                continue
            home = (total + margin) // 2
            away = (total - margin) // 2
            if away < 0 or home < 0 or away > 70 or home > 70:
                continue
            center_distance = abs(margin - expected_margin) + abs(total - expected_total)
            product = margin_probability * total_probability
            objective = -math.log(max(product, 1e-300)) + weight * center_distance
            ranked.append(((objective, center_distance, -product, away, home), (away, home)))
    if not ranked:
        raise RuntimeError("no valid representative-score candidate")
    return min(ranked, key=lambda row: row[0])[1]


def evaluate(rows: pd.DataFrame, margin_sources: list[dict[str, list[float]]], total_sources: list[dict[str, list[float]]], weight: float | None) -> dict[str, Any]:
    errors: dict[str, list[float]] = defaultdict(list)
    pairs_by_week: dict[int, list[tuple[int, int]]] = defaultdict(list)
    close = {1: 0, 2: 0, 3: 0}
    actual_close = {1: 0, 2: 0, 3: 0}
    exact = winners = valid = 0
    for row in rows.itertuples(index=False):
        margin_distribution = pooled_shifted_distribution(margin_sources, float(row.market_home_margin), False)
        total_distribution = pooled_shifted_distribution(total_sources, float(row.market_total), True)
        expected_margin = distribution_mean(margin_distribution)
        expected_total = distribution_mean(total_distribution)
        favored_home = home_favored(margin_distribution)
        away, home = (
            incumbent_score(expected_margin, expected_total, favored_home)
            if weight is None
            else candidate_score(margin_distribution, total_distribution, weight)
        )
        actual_away = int(row.away_score)
        actual_home = int(row.home_score)
        predicted_margin = home - away
        predicted_total = home + away
        actual_margin = actual_home - actual_away
        actual_total = actual_home + actual_away
        errors["team"].extend((abs(home - actual_home), abs(away - actual_away)))
        errors["margin"].append(abs(predicted_margin - actual_margin))
        errors["total"].append(abs(predicted_total - actual_total))
        errors["marginCenter"].append(abs(predicted_margin - expected_margin))
        errors["totalCenter"].append(abs(predicted_total - expected_total))
        exact += int(home == actual_home and away == actual_away)
        winners += int((home > away) == (actual_home > actual_away))
        margin_supported = margin_distribution.get(predicted_margin, 0.0) > 0.0
        total_supported = total_distribution.get(predicted_total, 0.0) > 0.0
        valid += int(margin_supported and total_supported and home != away and ((home > away) == favored_home))
        pairs_by_week[int(row.week)].append((away, home))
        for threshold in close:
            close[threshold] += int(abs(predicted_margin) <= threshold)
            actual_close[threshold] += int(abs(actual_margin) <= threshold)
    games = len(rows)
    duplicate_rates = [(len(pairs) - len(set(pairs))) / len(pairs) for pairs in pairs_by_week.values()]
    return {
        "games": games,
        "teamScoreMae": float(np.mean(errors["team"])),
        "marginMae": float(np.mean(errors["margin"])),
        "totalMae": float(np.mean(errors["total"])),
        "exactScoreRate": exact / games,
        "winnerAccuracy": winners / games,
        "structuralValidityRate": valid / games,
        "meanWeeklyDuplicatePairRate": float(np.mean(duplicate_rates)),
        "meanMarginCenterDistance": float(np.mean(errors["marginCenter"])),
        "meanTotalCenterDistance": float(np.mean(errors["totalCenter"])),
        "absoluteMarginRates": {str(key): close[key] / games for key in close},
        "actualAbsoluteMarginRates": {str(key): actual_close[key] / games for key in actual_close},
    }


def eligible(candidate: dict[str, Any], incumbent: dict[str, Any]) -> bool:
    return bool(
        candidate["winnerAccuracy"] >= incumbent["winnerAccuracy"]
        and candidate["teamScoreMae"] <= incumbent["teamScoreMae"] + 0.05
        and candidate["marginMae"] <= incumbent["marginMae"] + 0.10
        and candidate["totalMae"] <= incumbent["totalMae"] + 0.10
        and abs(candidate["absoluteMarginRates"]["2"] - candidate["actualAbsoluteMarginRates"]["2"])
        < abs(incumbent["absoluteMarginRates"]["2"] - incumbent["actualAbsoluteMarginRates"]["2"])
        and candidate["structuralValidityRate"] == 1.0
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    artifact_path = pathlib.Path("lib/services/football/modelArtifacts/nflV1WeekOneOutcome.json")
    artifact = json.loads(artifact_path.read_text())
    margin_sources = [game["marginDistribution"] for game in artifact["games"]]
    total_sources = [game["totalDistribution"] for game in artifact["games"]]
    frame = pd.read_parquet(args.features, columns=[
        "season", "week", "home_score", "away_score",
        "market_home_margin", "market_total",
    ])
    frame = frame[
        frame["season"].isin((SELECTION_SEASON, *CONFIRMATION_SEASONS))
        & frame[["home_score", "away_score", "market_home_margin", "market_total"]].notna().all(axis=1)
    ].copy()
    selection_rows = frame[frame["season"].eq(SELECTION_SEASON)]
    selection_incumbent = evaluate(selection_rows, margin_sources, total_sources, None)
    selection_candidates = {
        str(weight): evaluate(selection_rows, margin_sources, total_sources, weight)
        for weight in CANDIDATE_WEIGHTS
    }
    eligible_weights = [
        weight for weight in CANDIDATE_WEIGHTS
        if eligible(selection_candidates[str(weight)], selection_incumbent)
    ]
    eligible_weights.sort(key=lambda weight: (
        selection_candidates[str(weight)]["teamScoreMae"],
        selection_candidates[str(weight)]["marginMae"] + selection_candidates[str(weight)]["totalMae"],
        abs(selection_candidates[str(weight)]["absoluteMarginRates"]["2"] - selection_candidates[str(weight)]["actualAbsoluteMarginRates"]["2"]),
        selection_candidates[str(weight)]["meanMarginCenterDistance"] + selection_candidates[str(weight)]["meanTotalCenterDistance"],
        weight,
    ))
    selected_weight = eligible_weights[0] if eligible_weights else None
    confirmation: dict[str, Any] = {}
    gates: dict[str, Any] = {}
    for season in CONFIRMATION_SEASONS:
        rows = frame[frame["season"].eq(season)]
        incumbent = evaluate(rows, margin_sources, total_sources, None)
        candidate = evaluate(rows, margin_sources, total_sources, selected_weight) if selected_weight is not None else None
        confirmation[str(season)] = {"incumbent": incumbent, "candidate": candidate}
        gates[str(season)] = None if candidate is None else {
            "structuralValidity": candidate["structuralValidityRate"] == 1.0,
            "winnerAccuracyNoWorse": candidate["winnerAccuracy"] >= incumbent["winnerAccuracy"],
            "teamScoreMaeWithinTolerance": candidate["teamScoreMae"] <= incumbent["teamScoreMae"] + 0.15,
            "marginMaeWithinTolerance": candidate["marginMae"] <= incumbent["marginMae"] + 0.20,
            "totalMaeWithinTolerance": candidate["totalMae"] <= incumbent["totalMae"] + 0.20,
        }
    pooled_rows = frame[frame["season"].isin(CONFIRMATION_SEASONS)]
    pooled_incumbent = evaluate(pooled_rows, margin_sources, total_sources, None)
    pooled_candidate = evaluate(pooled_rows, margin_sources, total_sources, selected_weight) if selected_weight is not None else None
    pooled_close_gate = bool(
        pooled_candidate is not None
        and abs(pooled_candidate["absoluteMarginRates"]["2"] - pooled_candidate["actualAbsoluteMarginRates"]["2"])
        < abs(pooled_incumbent["absoluteMarginRates"]["2"] - pooled_incumbent["actualAbsoluteMarginRates"]["2"])
    )
    qualified = bool(
        selected_weight is not None
        and all(all(values.values()) for values in gates.values() if values is not None)
        and pooled_close_gate
    )
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "chronology": {"selection": SELECTION_SEASON, "confirmation": list(CONFIRMATION_SEASONS)},
        "source": {
            "features": str(args.features.resolve()),
            "featuresSha256": sha256_file(args.features),
            "artifact": str(artifact_path.resolve()),
            "artifactSha256": sha256_file(artifact_path),
        },
        "selection": {
            "incumbent": selection_incumbent,
            "candidates": selection_candidates,
            "eligibleWeights": eligible_weights,
            "selectedWeight": selected_weight,
        },
        "confirmation": confirmation,
        "confirmationGates": gates,
        "pooledConfirmation": {"incumbent": pooled_incumbent, "candidate": pooled_candidate},
        "pooledCloseMarginGate": pooled_close_gate,
        "qualified": qualified,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "selectedWeight": selected_weight,
        "qualified": qualified,
        "eligibleWeights": eligible_weights,
        "confirmationGates": gates,
        "pooledCloseMarginGate": pooled_close_gate,
    }, indent=2))


if __name__ == "__main__":
    main()
