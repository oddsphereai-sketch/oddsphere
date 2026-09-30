#!/usr/bin/env python3
"""Forward NHL independent-model and market marriage on current-era data.

The frozen r7 independent model is combined with opening no-vig market
probability. A learned arbitration can cross 50% and therefore rebuild the
coherent final score on the other side; this is not a capped point nudge.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def logit(value: float) -> float:
    p = min(0.97, max(0.03, value))
    return math.log(p / (1 - p))


def home_probability(coherent: Any, pair: tuple[float, float]) -> float:
    return float(coherent.distribution(pair[0], pair[1])["home_win"])


def features(row: dict[str, Any], family: str) -> list[float]:
    independent = float(row["independent_probability"])
    market = float(row["market"]["home_prob"])
    if family == "independent_calibration":
        return [logit(independent)]
    if family == "model_market":
        return [logit(independent), logit(market)]
    return [
        logit(independent), logit(market), market - independent,
        abs(market - independent), abs(independent - 0.5),
        (market - independent) * abs(independent - 0.5),
    ]


def fit(rows: list[dict[str, Any]], family: str, c_value: float):
    model = make_pipeline(StandardScaler(), LogisticRegression(C=c_value, max_iter=1000, random_state=23))
    model.fit(
        np.asarray([features(row, family) for row in rows]),
        np.asarray([row["actual_home"] for row in rows]),
    )
    return model


def predict(model: Any, rows: list[dict[str, Any]], family: str) -> np.ndarray:
    return model.predict_proba(np.asarray([features(row, family) for row in rows]))[:, 1]


def probability_report(rows: list[dict[str, Any]], probabilities: np.ndarray) -> dict[str, Any]:
    actual = np.asarray([row["actual_home"] for row in rows], dtype=float)
    independent = np.asarray([row["independent_probability"] for row in rows])
    picked = probabilities >= 0.5
    independent_pick = independent >= 0.5
    flips = picked != independent_pick
    corrected = (~(independent_pick == actual.astype(bool))) & (picked == actual.astype(bool)) & flips
    worsened = (independent_pick == actual.astype(bool)) & (~(picked == actual.astype(bool))) & flips
    clipped = np.clip(probabilities, 0.01, 0.99)
    return {
        "n": len(rows),
        "accuracy": float(np.mean(picked == actual.astype(bool))),
        "brier": float(np.mean((probabilities - actual) ** 2)),
        "logloss": float(np.mean(-(actual * np.log(clipped) + (1 - actual) * np.log(1 - clipped)))),
        "flips_vs_independent": int(np.sum(flips)),
        "corrected": int(np.sum(corrected)),
        "worsened": int(np.sum(worsened)),
        "flip_net": int(np.sum(corrected) - np.sum(worsened)),
    }


def score_pairs(coherent: Any, rows: list[dict[str, Any]], probabilities: np.ndarray) -> list[tuple[float, float]]:
    output = []
    for row, probability in zip(rows, probabilities, strict=True):
        total = row["independent_pair"][0] + row["independent_pair"][1]
        margin = coherent.goal_diff_for_home_win(total, float(probability))
        output.append(((total + margin) / 2, (total - margin) / 2))
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--goalies", required=True, type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    coherent = load("nhl_forward_coherent", root / "scripts/operator/research-nhl-coherent-score-r8.py")
    tail = load("nhl_forward_tail", root / "scripts/operator/research-nhl-tail-distribution-r8.py")
    audit = load("nhl_forward_audit", root / "scripts/operator/audit-nhl-r7-predictiveness.py")
    base = load("nhl_forward_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    research = load("nhl_forward_features", root / "scripts/operator/research-nhl-matchup-features-r6.py")
    stability = load("nhl_forward_stability", root / "scripts/operator/research-nhl-training-stability-r6.py")
    games = coherent.apply_settled_scores(
        stability.load_games(args.moneypuck, base),
        coherent.load_settled_scores(args.bdl),
    )
    starter, goalie_results = research.read_goalies(args.goalies)
    openings = tail.load_openings(args.bdl)
    rows = research.build_examples(base, games, 0.085, ["opponent_adjusted"], starter, goalie_results)
    joined = coherent.join_market([row for row in rows if row["season"] in {2023, 2024, 2025}], openings)
    independent_rows = [{**row, "market": {**row["market"], "home_prob": None}} for row in joined]
    independent_pairs = audit.r7_predictions(independent_rows, coherent, research)
    current_pairs = audit.r7_predictions(joined, coherent, research)
    prepared = []
    for row, independent_pair, current_pair in zip(joined, independent_pairs, current_pairs, strict=True):
        if row["market"].get("home_prob") is None:
            continue
        prepared.append({
            **row,
            "independent_pair": independent_pair,
            "current_pair": current_pair,
            "independent_probability": home_probability(coherent, independent_pair),
            "current_probability": home_probability(coherent, current_pair),
            "actual_home": int(row["home_goals"] > row["away_goals"]),
        })
    by_season = {season: [row for row in prepared if row["season"] == season] for season in (2023, 2024, 2025)}

    candidates = []
    for family in ("independent_calibration", "model_market", "market_arbitration"):
        for c_value in (0.01, 0.03, 0.1, 0.3, 1.0):
            model = fit(by_season[2023], family, c_value)
            probabilities = predict(model, by_season[2024], family)
            report = probability_report(by_season[2024], probabilities)
            candidates.append({
                "family": family, "c": c_value,
                "objective": report["brier"] + 0.08 * report["logloss"] - 0.12 * report["accuracy"],
                "tune_2024": report,
            })
    selected = min(candidates, key=lambda candidate: candidate["objective"])
    tune_model = fit(by_season[2023], selected["family"], selected["c"])
    tune_probabilities = predict(tune_model, by_season[2024], selected["family"])
    tune_pairs = score_pairs(coherent, by_season[2024], tune_probabilities)
    tune_puck_rows = [
        tail.raw_row(row, pair)
        for row, pair in zip(by_season[2024], tune_pairs, strict=True)
    ]
    tune_puck_rows = [row for row in tune_puck_rows if row is not None]
    model = fit(by_season[2023] + by_season[2024], selected["family"], selected["c"])
    test = by_season[2025]
    learned = predict(model, test, selected["family"])
    independent = np.asarray([row["independent_probability"] for row in test])
    current = np.asarray([row["current_probability"] for row in test])
    market = np.asarray([row["market"]["home_prob"] for row in test])
    learned_pairs = score_pairs(coherent, test, learned)
    test_puck_rows = [tail.raw_row(row, pair) for row, pair in zip(test, learned_pairs, strict=True)]
    test_puck_rows = [row for row in test_puck_rows if row is not None]
    scaler = model.named_steps["standardscaler"]
    logistic_model = model.named_steps["logisticregression"]
    payload = {
        "release": "nhl_forward_model_market_research_2026_09_29_r1",
        "protocol": {
            "independent_release": "frozen r7 independent path trained through 2024",
            "meta_train": "2023",
            "candidate_selection": "2024",
            "meta_refit": "2023-2024",
            "untouched_confirmation": "2025",
            "score_contract": "learned winner probability is solved back into one coherent score pair at the independent expected total",
        },
        "selected": selected,
        "runtime_parameters": {
            "feature_order": ["independent_logit", "market_logit"],
            "scaler_mean": scaler.mean_.tolist(),
            "scaler_scale": scaler.scale_.tolist(),
            "logistic_coefficients": logistic_model.coef_[0].tolist(),
            "logistic_intercept": float(logistic_model.intercept_[0]),
        },
        "puckline_exact_price_tune_2024": {
            "all": tail.value_selection_report(tune_puck_rows, np.asarray([row["raw_cover"] for row in tune_puck_rows])),
            "edge_1_5pct": tail.value_selection_report(tune_puck_rows, np.asarray([row["raw_cover"] for row in tune_puck_rows]), 0.015),
            "edge_3pct": tail.value_selection_report(tune_puck_rows, np.asarray([row["raw_cover"] for row in tune_puck_rows]), 0.03),
            "edge_5pct": tail.value_selection_report(tune_puck_rows, np.asarray([row["raw_cover"] for row in tune_puck_rows]), 0.05),
        },
        "confirmation_2025": {
            "independent_probability": probability_report(test, independent),
            "current_20pct_market_path": probability_report(test, current),
            "opening_market": probability_report(test, market),
            "learned_marriage": probability_report(test, learned),
            "scores": {
                "independent": coherent.evaluate(test, [row["independent_pair"] for row in test]),
                "current_20pct_market_path": coherent.evaluate(test, [row["current_pair"] for row in test]),
                "learned_marriage": coherent.evaluate(test, learned_pairs),
            },
            "puckline_exact_price": {
                "all": tail.value_selection_report(test_puck_rows, np.asarray([row["raw_cover"] for row in test_puck_rows])),
                "edge_1_5pct": tail.value_selection_report(test_puck_rows, np.asarray([row["raw_cover"] for row in test_puck_rows]), 0.015),
                "edge_3pct": tail.value_selection_report(test_puck_rows, np.asarray([row["raw_cover"] for row in test_puck_rows]), 0.03),
                "edge_5pct": tail.value_selection_report(test_puck_rows, np.asarray([row["raw_cover"] for row in test_puck_rows]), 0.05),
            },
        },
        "top_candidates": sorted(candidates, key=lambda candidate: candidate["objective"])[:10],
        "counts": {str(season): len(rows) for season, rows in by_season.items()},
    }
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
