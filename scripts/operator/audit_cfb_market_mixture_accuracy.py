#!/usr/bin/env python3
"""Chronological CFB spread/total side-accuracy tournament.

The production score pipeline and both production residual samples are replayed
against the archived market lines. Candidate selection uses 2023. The 2024 and
2025 seasons are reported separately as repeated chronological confirmation.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd


RELEASE = "cfb_market_mixture_accuracy_audit_2026_09_19_r2_contained_spread_counter_signal"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
MARKET_WEIGHTS = (0.50, 0.60, 0.70, 0.75, 0.80)
GAP_THRESHOLDS = (7.0, 10.0, 14.0)
SPREAD_LINE_THRESHOLDS = (7.0, 14.0, 21.0, 28.0)
SPREAD_CONFIDENCE_BANDS = ((0.0, 0.005), (0.03, 0.05), (0.035, 0.05), (0.04, 0.05))
FOOTBALL_SCORE_SUPPORT = np.array([
    0, 2, 3, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
    58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76,
    77, 78, 79, 80,
])


@dataclass(frozen=True)
class Candidate:
    name: str
    probability: Callable[[pd.DataFrame], np.ndarray]


def load_tournament_module(path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("cfb_v1_tournament", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def nearest_scores(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, FOOTBALL_SCORE_SUPPORT[0], FOOTBALL_SCORE_SUPPORT[-1])
    right = np.searchsorted(FOOTBALL_SCORE_SUPPORT, clipped, side="left")
    right = np.clip(right, 0, len(FOOTBALL_SCORE_SUPPORT) - 1)
    left = np.maximum(right - 1, 0)
    choose_left = np.abs(clipped - FOOTBALL_SCORE_SUPPORT[left]) <= np.abs(
        clipped - FOOTBALL_SCORE_SUPPORT[right]
    )
    return np.where(choose_left, FOOTBALL_SCORE_SUPPORT[left], FOOTBALL_SCORE_SUPPORT[right])


def pipeline_predict(pipeline: dict[str, Any], frame: pd.DataFrame) -> np.ndarray:
    inputs = pipeline["inputFeatures"]
    values = frame.reindex(columns=inputs).to_numpy(float)
    missing = ~np.isfinite(values)
    statistics = np.asarray(pipeline["imputerStatistics"], dtype=float)
    values = np.where(missing, statistics[None, :], values)
    indicators = missing[:, np.asarray(pipeline["missingIndicatorFeatureIndexes"], dtype=int)].astype(float)
    transformed = np.column_stack([values, indicators])
    coefficients = np.asarray(pipeline["coefficients"], dtype=float)
    means = np.asarray(pipeline["scalerMean"], dtype=float)
    scales = np.asarray(pipeline["scalerScale"], dtype=float)
    standardized = np.divide(
        transformed - means,
        scales,
        out=np.zeros_like(transformed),
        where=scales != 0,
    )
    return float(pipeline["intercept"]) + standardized @ coefficients


def component_probabilities(
    frame: pd.DataFrame,
    score_artifact: dict[str, Any],
    market_artifact: dict[str, Any],
) -> pd.DataFrame:
    raw_home = pipeline_predict(score_artifact["pipeline"]["home"], frame)
    raw_away = pipeline_predict(score_artifact["pipeline"]["away"], frame)
    score_residuals = np.asarray(score_artifact["residualSample"], dtype=float)
    market_residuals = np.asarray(market_artifact["residualSample"], dtype=float)
    rows: list[dict[str, float]] = []
    for index, (_, game) in enumerate(frame.iterrows()):
        independent_home = nearest_scores(raw_home[index] + score_residuals[:, 0])
        independent_away = nearest_scores(raw_away[index] + score_residuals[:, 1])
        independent_margin = independent_home - independent_away
        independent_total = independent_home + independent_away

        market_margin_center = -float(game.home_spread)
        market_total_center = float(game.market_total)
        market_margins = market_margin_center + market_residuals[:, 0]
        market_totals = np.maximum(np.abs(market_margins) + 1, market_total_center + market_residuals[:, 1])
        market_home = nearest_scores((market_totals + market_margins) / 2)
        market_away = nearest_scores((market_totals - market_margins) / 2)
        market_margin = market_home - market_away
        market_total = market_home + market_away

        spread_threshold = -float(game.home_spread)
        total_threshold = float(game.market_total)
        rows.append({
            "independent_home_cover": event_probability(independent_margin, spread_threshold),
            "market_home_cover": event_probability(market_margin, spread_threshold),
            "independent_home_win": event_probability(independent_margin, 0),
            "market_home_win": event_probability(market_margin, 0),
            "independent_spread_push": float(np.mean(independent_margin == spread_threshold)),
            "market_spread_push": float(np.mean(market_margin == spread_threshold)),
            "independent_over": event_probability(independent_total, total_threshold),
            "market_over": event_probability(market_total, total_threshold),
            "independent_margin": float(independent_margin.mean()),
            "independent_total": float(independent_total.mean()),
            "market_margin": float(market_margin.mean()),
            "market_total_projection": float(market_total.mean()),
        })
    return pd.DataFrame(rows, index=frame.index)


def event_probability(values: np.ndarray, threshold: float) -> float:
    return float(np.mean(values > threshold) + 0.5 * np.mean(values == threshold))


def actual_target(frame: pd.DataFrame, market: str) -> tuple[np.ndarray, np.ndarray]:
    margin = frame.home_score.to_numpy(float) - frame.away_score.to_numpy(float)
    total = frame.home_score.to_numpy(float) + frame.away_score.to_numpy(float)
    if market == "spread":
        settled = margin + frame.home_spread.to_numpy(float)
    else:
        settled = total - frame.market_total.to_numpy(float)
    keep = settled != 0
    return (settled[keep] > 0).astype(float), keep


def metrics(frame: pd.DataFrame, probability: np.ndarray, market: str) -> dict[str, Any]:
    target, keep = actual_target(frame, market)
    p = np.clip(probability[keep], 1e-6, 1 - 1e-6)
    selected = p >= 0.5
    wins = int(np.sum(selected == (target > 0.5)))
    losses = int(len(target) - wins)
    return {
        "settled": int(len(target)),
        "pushes": int((~keep).sum()),
        "wins": wins,
        "losses": losses,
        "accuracy": wins / len(target) if len(target) else None,
        "brier": float(np.mean(np.square(target - p))) if len(target) else None,
        "logLoss": float(np.mean(-(target * np.log(p) + (1 - target) * np.log(1 - p)))) if len(target) else None,
        "homeOrOverSelections": int(selected.sum()),
        "awayOrUnderSelections": int((~selected).sum()),
    }


def flip(probability: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return np.where(mask, 1 - probability, probability)


def contained_spread_flip(frame: pd.DataFrame, incumbent: np.ndarray, mask: np.ndarray) -> np.ndarray:
    home_win = 0.25 * frame.independent_home_win.to_numpy(float) + 0.75 * frame.market_home_win.to_numpy(float)
    push = 0.25 * frame.independent_spread_push.to_numpy(float) + 0.75 * frame.market_spread_push.to_numpy(float)
    home_spread = frame.home_spread.to_numpy(float)
    proposed_home_cover = 1 - incumbent
    contained_home_cover = np.where(
        home_spread > 0,
        np.maximum(proposed_home_cover, home_win + 0.5 * push),
        np.where(home_spread < 0, np.minimum(proposed_home_cover, home_win - 0.5 * push), home_win),
    )
    changes_side = np.where(incumbent >= 0.5, contained_home_cover < 0.5, contained_home_cover > 0.5)
    return np.where(mask & changes_side, contained_home_cover, incumbent)


def candidate_grid(frame: pd.DataFrame, market: str) -> list[Candidate]:
    independent = frame[f"independent_{'home_cover' if market == 'spread' else 'over'}"].to_numpy(float)
    market_probability = frame[f"market_{'home_cover' if market == 'spread' else 'over'}"].to_numpy(float)
    candidates: list[Candidate] = []
    for weight in MARKET_WEIGHTS:
        base = (1 - weight) * independent + weight * market_probability
        candidates.append(Candidate(f"market_weight_{weight:.2f}", lambda _frame, value=base: value))
    incumbent = 0.25 * independent + 0.75 * market_probability
    candidates.append(Candidate("diagnostic_flip_all", lambda _frame: 1 - incumbent))
    if market == "spread":
        selected_away = incumbent < 0.5
        away_underdog = selected_away & (frame.home_spread.to_numpy(float) < 0)
        for threshold in SPREAD_LINE_THRESHOLDS:
            mask = away_underdog & (np.abs(frame.home_spread.to_numpy(float)) >= threshold)
            candidates.append(Candidate(
                f"counter_signal_away_dog_line_{threshold:g}_plus",
                lambda _frame, value=flip(incumbent, mask): value,
            ))
        confidence = np.abs(incumbent - 0.5)
        for low, high in SPREAD_CONFIDENCE_BANDS:
            mask = (confidence > low) & (confidence <= high)
            candidates.append(Candidate(
                f"counter_signal_confidence_{100 * low:.1f}_to_{100 * high:.1f}pp",
                lambda _frame, value=contained_spread_flip(frame, incumbent, mask): value,
            ))
        gap = np.abs(frame.independent_margin.to_numpy(float) + frame.home_spread.to_numpy(float))
    else:
        gap = np.abs(frame.independent_total.to_numpy(float) - frame.market_total.to_numpy(float))
    for threshold in GAP_THRESHOLDS:
        mask = gap >= threshold
        candidates.append(Candidate(
            f"counter_signal_model_market_gap_{threshold:g}_plus",
            lambda _frame, value=flip(incumbent, mask): value,
        ))
    return candidates


def choose(selection: list[dict[str, Any]]) -> str:
    eligible = [row for row in selection if row["name"] != "diagnostic_flip_all"]
    return sorted(eligible, key=lambda row: (-row["metrics"]["accuracy"], row["metrics"]["brier"], row["metrics"]["logLoss"], row["name"]))[0]["name"]


def run(args: argparse.Namespace) -> dict[str, Any]:
    tournament = load_tournament_module(Path(args.tournament_script))
    frames, checksums = tournament.read_sources(Path(args.source_dir))
    data = tournament.build_dataset(frames).replace([np.inf, -np.inf], np.nan)
    data = data[
        data.season.isin([SELECTION_SEASON, *CONFIRMATION_SEASONS])
        & data.home_spread.notna()
        & data.market_total.notna()
    ].copy()
    score_artifact = json.loads(Path(args.score_artifact).read_text())
    market_artifact = json.loads(Path(args.market_artifact).read_text())
    components = component_probabilities(data, score_artifact, market_artifact)
    data = pd.concat([data, components], axis=1)

    markets: dict[str, Any] = {}
    for market in ("spread", "total"):
        selection_frame = data[data.season == SELECTION_SEASON]
        selection_candidates = candidate_grid(selection_frame, market)
        selection = [{"name": candidate.name, "metrics": metrics(selection_frame, candidate.probability(selection_frame), market)} for candidate in selection_candidates]
        selected_name = choose(selection)
        incumbent_selection = next(row for row in selection if row["name"] == "market_weight_0.75")
        selected_selection = next(row for row in selection if row["name"] == selected_name)
        confirmation: dict[str, Any] = {}
        for season in CONFIRMATION_SEASONS:
            confirmation_frame = data[data.season == season]
            confirmation_candidates = {candidate.name: candidate for candidate in candidate_grid(confirmation_frame, market)}
            incumbent_confirmation = metrics(
                confirmation_frame,
                confirmation_candidates["market_weight_0.75"].probability(confirmation_frame),
                market,
            )
            selected_confirmation = metrics(
                confirmation_frame,
                confirmation_candidates[selected_name].probability(confirmation_frame),
                market,
            )
            confirmation[str(season)] = {"incumbent": incumbent_confirmation, "candidate": selected_confirmation}
        confirmation_pass = all(
            value["candidate"]["accuracy"] > value["incumbent"]["accuracy"]
            and value["candidate"]["brier"] < value["incumbent"]["brier"]
            and value["candidate"]["logLoss"] < value["incumbent"]["logLoss"]
            for value in confirmation.values()
        )
        markets[market] = {
            "selectedCandidate": selected_name,
            "selectionCandidates": selection,
            "selectionComparison": {"incumbent": incumbent_selection["metrics"], "candidate": selected_selection["metrics"]},
            "confirmationComparison": confirmation,
            "confirmationPass": confirmation_pass,
        }

    return {
        "release": RELEASE,
        "chronology": {"selection": SELECTION_SEASON, "repeatedConfirmation": list(CONFIRMATION_SEASONS)},
        "predeclaredGrid": {
            "marketWeights": list(MARKET_WEIGHTS),
            "modelMarketGapThresholds": list(GAP_THRESHOLDS),
            "spreadAwayDogLineThresholds": list(SPREAD_LINE_THRESHOLDS),
            "spreadCounterSignalConfidenceBands": [list(band) for band in SPREAD_CONFIDENCE_BANDS],
            "selectionObjective": "maximize side accuracy, then minimize Brier, then minimize log loss",
            "confirmationGate": "strict accuracy, Brier, and log-loss improvement versus production 0.75 market weight",
        },
        "rowsBySeason": {str(season): int((data.season == season).sum()) for season in (SELECTION_SEASON, *CONFIRMATION_SEASONS)},
        "sourceChecksums": checksums,
        "artifactReleases": {
            "score": score_artifact["artifactRelease"],
            "marketResidual": market_artifact["artifactRelease"],
        },
        "markets": markets,
        "promotable": all(value["confirmationPass"] for value in markets.values()),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="football-research/cache/cfb-model/source")
    parser.add_argument("--tournament-script", default="scripts/operator/tournament_cfb_v1_model.py")
    parser.add_argument("--score-artifact", default="lib/services/football/modelArtifacts/cfbV1JointScoreArtifact.json")
    parser.add_argument("--market-artifact", default="lib/services/football/modelArtifacts/cfbMarketResidualArtifact.json")
    parser.add_argument(
        "--output",
        default="football-research/reports/cfb_market_mixture_accuracy_audit_2026_09_19_r2_contained_spread_counter_signal.json",
    )
    args = parser.parse_args()
    report = run(args)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "output": str(output),
        "promotable": report["promotable"],
        "markets": {market: {"selected": value["selectedCandidate"], "pass": value["confirmationPass"]} for market, value in report["markets"].items()},
    }, indent=2))


if __name__ == "__main__":
    main()
