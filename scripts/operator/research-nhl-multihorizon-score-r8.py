#!/usr/bin/env python3
"""Release-pure NHL multi-horizon independent score-model tournament.

The candidate score is built only from pregame hockey evidence. Market totals,
moneylines, spreads, prices, splits and movement are intentionally excluded.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, PoissonRegressor
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


def stack_rows(rows_by_alpha: dict[float, list[dict[str, Any]]], alphas: list[float]) -> list[dict[str, Any]]:
    maps = {alpha: {row["id"]: row for row in rows} for alpha, rows in rows_by_alpha.items()}
    ids = sorted(set.intersection(*(set(mapping) for mapping in maps.values())))
    output = []
    for game_id in ids:
        base = maps[alphas[0]][game_id]
        home_x: list[float] = []
        away_x: list[float] = []
        for alpha in alphas:
            row = maps[alpha][game_id]
            # Keep one intercept but preserve every horizon's distinct state.
            home_x.extend(row["home_x"] if not home_x else row["home_x"][1:])
            away_x.extend(row["away_x"] if not away_x else row["away_x"][1:])
        output.append({**base, "home_x": home_x, "away_x": away_x})
    return output


def arrays(rows: list[dict[str, Any]], latest: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x, y, weights = [], [], []
    for row in rows:
        x.extend((row["home_x"], row["away_x"]))
        y.extend((row["home_goals"], row["away_goals"]))
        weight = 0.72 ** (latest - row["season"])
        weights.extend((weight, weight))
    return np.asarray(x), np.asarray(y), np.asarray(weights)


def models(selected_only: bool = False) -> list[tuple[str, Any]]:
    if selected_only:
        return [("poisson_5", make_pipeline(
            StandardScaler(), PoissonRegressor(alpha=5.0, max_iter=1200, tol=1e-8),
        ))]
    result: list[tuple[str, Any]] = []
    for alpha in (0.01, 0.1, 1.0, 5.0, 20.0):
        result.append((f"poisson_{alpha:g}", make_pipeline(
            StandardScaler(), PoissonRegressor(alpha=alpha, max_iter=1200, tol=1e-8),
        )))
    for leaves, leaf_size, l2 in ((7, 80, 10.0), (11, 65, 15.0), (15, 80, 25.0), (19, 110, 35.0)):
        result.append((f"hist_{leaves}_{leaf_size}_{l2:g}", HistGradientBoostingRegressor(
            loss="poisson", learning_rate=0.025, max_iter=260,
            max_leaf_nodes=leaves, min_samples_leaf=leaf_size,
            l2_regularization=l2, random_state=23,
        )))
    result.extend((
        ("extra_240_leaf30", ExtraTreesRegressor(
            n_estimators=240, min_samples_leaf=30, max_features=0.65,
            n_jobs=-1, random_state=23,
        )),
        ("extra_240_leaf55", ExtraTreesRegressor(
            n_estimators=240, min_samples_leaf=55, max_features=0.75,
            n_jobs=-1, random_state=23,
        )),
        ("forest_240_leaf30", RandomForestRegressor(
            n_estimators=240, min_samples_leaf=30, max_features=0.65,
            n_jobs=-1, random_state=23,
        )),
    ))
    return result


def predict_pairs(model: Any, rows: list[dict[str, Any]]) -> list[tuple[float, float]]:
    x = np.asarray([features for row in rows for features in (row["home_x"], row["away_x"])])
    values = np.clip(model.predict(x), 0.75, 6.25)
    return [(float(values[i]), float(values[i + 1])) for i in range(0, len(values), 2)]


def game_arrays(rows: list[dict[str, Any]], latest: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x = np.asarray([
        np.asarray(row["home_x"]) - np.asarray(row["away_x"])
        for row in rows
    ])
    y = np.asarray([float(row["home_goals"] > row["away_goals"]) for row in rows])
    weights = np.asarray([0.72 ** (latest - row["season"]) for row in rows])
    return x, y, weights


def logit(value: float) -> float:
    value = max(0.03, min(0.97, value))
    return float(np.log(value / (1 - value)))


def paired_probability(rows: list[dict[str, Any]], scores: list[tuple[float, float]], classifier: Any, weight: float) -> list[tuple[float, float]]:
    x = np.asarray([np.asarray(row["home_x"]) - np.asarray(row["away_x"]) for row in rows])
    class_probability = classifier.predict_proba(x)[:, 1]
    output = []
    for (home, away), direct in zip(scores, class_probability):
        total = home + away
        score_probability = load_distribution(home, away)
        probability = 1 / (1 + np.exp(-((1 - weight) * logit(score_probability) + weight * logit(float(direct)))))
        margin = goal_diff_solver(total, float(probability))
        output.append(((total + margin) / 2, (total - margin) / 2))
    return output


def market_marriage(rows: list[dict[str, Any]], scores: list[tuple[float, float]], weight: float) -> list[tuple[float, float]]:
    output = []
    for row, score in zip(rows, scores):
        total = sum(score)
        independent = load_distribution(*score)
        market = row["market"].get("home_prob")
        if market is None:
            probability = independent
        else:
            probability = 1 / (1 + np.exp(-((1 - weight) * logit(independent) + weight * logit(float(market)))))
        margin = goal_diff_solver(total, float(probability))
        output.append(((total + margin) / 2, (total - margin) / 2))
    return output


def component_ensemble(
    score_head: list[tuple[float, float]], incumbent: list[tuple[float, float]],
    total_weight: float, margin_weight: float,
) -> list[tuple[float, float]]:
    """Blend total and margin independently so one head cannot hide another's strength."""
    output = []
    for score, old in zip(score_head, incumbent):
        score_total, old_total = sum(score), sum(old)
        score_margin, old_margin = score[0] - score[1], old[0] - old[1]
        total = (1 - total_weight) * old_total + total_weight * score_total
        margin = (1 - margin_weight) * old_margin + margin_weight * score_margin
        output.append(((total + margin) / 2, (total - margin) / 2))
    return output


def conditional_market_marriage(
    rows: list[dict[str, Any]], scores: list[tuple[float, float]],
    market_confidence: float, independent_uncertainty: float, blend: float,
) -> tuple[list[tuple[float, float]], dict[str, int]]:
    output = []
    corrected = worsened = flips = 0
    for row, score in zip(rows, scores):
        total = sum(score)
        independent = load_distribution(*score)
        market = row["market"].get("home_prob")
        probability = independent
        if market is not None:
            disagree = (independent >= 0.5) != (float(market) >= 0.5)
            eligible = disagree and abs(float(market) - 0.5) >= market_confidence and abs(independent - 0.5) <= independent_uncertainty
            if eligible:
                probability = 1 / (1 + np.exp(-((1 - blend) * logit(independent) + blend * logit(float(market)))))
                if (probability >= 0.5) != (independent >= 0.5):
                    flips += 1
                    actual = row["home_goals"] > row["away_goals"]
                    corrected += int((independent >= 0.5) != actual and (probability >= 0.5) == actual)
                    worsened += int((independent >= 0.5) == actual and (probability >= 0.5) != actual)
        margin = goal_diff_solver(total, float(probability))
        output.append(((total + margin) / 2, (total - margin) / 2))
    return output, {"flips": flips, "corrected": corrected, "worsened": worsened, "flip_net": corrected - worsened}


load_distribution: Any
goal_diff_solver: Any


def objective(report: dict[str, Any]) -> float:
    return (
        report["team_score_mae"] + 0.35 * report["margin_mae"]
        + 0.35 * report["total_mae"] + 0.60 * report["winner_brier"]
        + 0.08 * report["winner_logloss"] - 0.16 * report["winner_accuracy"]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--goalies", required=True, type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    parser.add_argument("--skaters", required=True, type=Path, nargs="+")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--selected-only", action="store_true")
    parser.add_argument("--without-players", action="store_true")
    parser.add_argument("--train-start", type=int, default=2022)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    coherent = load("nhl_multi_coherent", root / "scripts/operator/research-nhl-coherent-score-r8.py")
    global load_distribution, goal_diff_solver
    load_distribution = lambda home, away: float(coherent.distribution(home, away)["home_win"])
    goal_diff_solver = coherent.goal_diff_for_home_win
    base = load("nhl_multi_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    features = load("nhl_multi_features", root / "scripts/operator/research-nhl-matchup-features-r6.py")
    stability = load("nhl_multi_stability", root / "scripts/operator/research-nhl-training-stability-r6.py")
    players = load("nhl_multi_players", root / "scripts/operator/research-nhl-player-matchups-r8.py")
    incumbent = load("nhl_multi_incumbent", root / "scripts/operator/audit-nhl-r7-predictiveness.py")

    games = coherent.apply_settled_scores(
        stability.load_games(args.moneypuck, base), coherent.load_settled_scores(args.bdl),
    )
    openings = coherent.load_multiseason_openings(args.bdl)
    starter, goalie_results = features.read_goalies(args.goalies)
    roster = {} if args.without_players else players.roster_feature_map(players.load_skater_games(args.skaters))
    alphas = [0.025, 0.05, 0.085, 0.15, 0.25]
    by_alpha = {}
    for alpha in alphas:
        rows = features.build_examples(
            base, games, alpha, ["opponent_adjusted", "danger", "special_teams", "travel"],
            starter, goalie_results,
        )
        by_alpha[alpha] = players.add_player_features(rows, roster, not args.without_players)
    rows = stack_rows(by_alpha, alphas)
    train = [row for row in rows if args.train_start <= row["season"] <= 2023]
    tune = coherent.join_market([row for row in rows if row["season"] == 2024], openings)
    holdout = coherent.join_market([row for row in rows if row["season"] == 2025], openings)
    x, y, weights = arrays(train, 2023)
    candidates = []
    fitted: dict[str, Any] = {}
    for name, model in models(args.selected_only):
        model.fit(x, y, **({"sample_weight": weights} if not hasattr(model, "steps") else {"poissonregressor__sample_weight": weights}))
        report = coherent.evaluate(tune, predict_pairs(model, tune))
        candidates.append({"name": name, "objective": objective(report), "tune_2024": report})
        fitted[name] = model
        print(json.dumps({"name": name, "objective": objective(report)}), flush=True)
    selected = min(candidates, key=lambda row: row["objective"])
    selected_model = fitted[selected["name"]]
    tune_scores = predict_pairs(selected_model, tune)
    holdout_scores = predict_pairs(selected_model, holdout)
    game_x, game_y, game_weights = game_arrays(train, 2023)
    winner_models = [
        ("logistic_0.03", make_pipeline(StandardScaler(), LogisticRegression(C=0.03, max_iter=1500, random_state=23))),
        ("logistic_0.10", make_pipeline(StandardScaler(), LogisticRegression(C=0.10, max_iter=1500, random_state=23))),
        ("hist_7_100", HistGradientBoostingClassifier(learning_rate=0.025, max_iter=220, max_leaf_nodes=7, min_samples_leaf=100, l2_regularization=15, random_state=23)),
    ]
    paired = []
    paired_fitted: dict[str, Any] = {}
    for winner_name, winner_model in winner_models:
        winner_model.fit(game_x, game_y, **({"logisticregression__sample_weight": game_weights} if hasattr(winner_model, "steps") else {"sample_weight": game_weights}))
        paired_fitted[winner_name] = winner_model
        for winner_weight in (0.25, 0.50, 0.75, 1.0):
            prediction = paired_probability(tune, tune_scores, winner_model, winner_weight)
            report = coherent.evaluate(tune, prediction)
            paired.append({"winner_model": winner_name, "winner_weight": winner_weight, "objective": objective(report), "tune_2024": report})
    paired_selected = min(paired, key=lambda row: row["objective"])
    final_holdout = paired_probability(
        holdout, holdout_scores, paired_fitted[paired_selected["winner_model"]], paired_selected["winner_weight"],
    )
    incumbent_rows = features.build_examples(
        base, games, 0.085, ["opponent_adjusted"], starter, goalie_results,
    )
    base_rows = {row["id"]: row for row in incumbent_rows}
    tune_base = [{**base_rows[row["id"]], "market": {"home_prob": None}} for row in tune]
    holdout_base = [{**base_rows[row["id"]], "market": {"home_prob": None}} for row in holdout]
    incumbent_tune = incumbent.r7_predictions(tune_base, coherent, features)
    incumbent_holdout = incumbent.r7_predictions(holdout_base, coherent, features)
    component_candidates = []
    for total_weight in (0.0, 0.25, 0.50, 0.75, 1.0):
        for margin_weight in (0.0, 0.25, 0.50, 0.75, 1.0):
            prediction = component_ensemble(tune_scores, incumbent_tune, total_weight, margin_weight)
            report = coherent.evaluate(tune, prediction)
            component_candidates.append({
                "total_weight": total_weight, "margin_weight": margin_weight,
                "objective": objective(report), "tune_2024": report,
            })
    component_selected = min(component_candidates, key=lambda row: row["objective"])
    component_holdout = component_ensemble(
        holdout_scores, incumbent_holdout,
        component_selected["total_weight"], component_selected["margin_weight"],
    )
    incumbent_models = []
    for incumbent_weight in (0.25, 0.50, 0.75, 1.0):
        combined = []
        for score, old in zip(tune_scores, incumbent_tune):
            total = sum(score)
            score_p = load_distribution(*score)
            old_p = load_distribution(*old)
            probability = 1 / (1 + np.exp(-((1 - incumbent_weight) * logit(score_p) + incumbent_weight * logit(old_p))))
            margin = goal_diff_solver(total, float(probability))
            combined.append(((total + margin) / 2, (total - margin) / 2))
        report = coherent.evaluate(tune, combined)
        incumbent_models.append({"winner_weight": incumbent_weight, "objective": objective(report), "tune_2024": report})
    incumbent_selected = min(incumbent_models, key=lambda row: row["objective"])
    incumbent_final = []
    incumbent_tune_final = []
    selected_weight = incumbent_selected["winner_weight"]
    for score, old in zip(tune_scores, incumbent_tune):
        total = sum(score)
        probability = 1 / (1 + np.exp(-((1 - selected_weight) * logit(load_distribution(*score)) + selected_weight * logit(load_distribution(*old)))))
        margin = goal_diff_solver(total, float(probability))
        incumbent_tune_final.append(((total + margin) / 2, (total - margin) / 2))
    for score, old in zip(holdout_scores, incumbent_holdout):
        total = sum(score)
        score_p = load_distribution(*score)
        old_p = load_distribution(*old)
        weight = incumbent_selected["winner_weight"]
        probability = 1 / (1 + np.exp(-((1 - weight) * logit(score_p) + weight * logit(old_p))))
        margin = goal_diff_solver(total, float(probability))
        incumbent_final.append(((total + margin) / 2, (total - margin) / 2))
    market_candidates = []
    for market_weight in (0.0, 0.10, 0.20, 0.30, 0.50):
        prediction = market_marriage(tune, incumbent_tune_final, market_weight)
        report = coherent.evaluate(tune, prediction)
        market_candidates.append({"kind": "logit_blend", "market_weight": market_weight, "objective": objective(report), "tune_2024": report})
    for market_confidence in (0.02, 0.04, 0.06, 0.08):
        for independent_uncertainty in (0.03, 0.05, 0.08, 0.12):
            for blend in (0.50, 0.75, 1.0):
                prediction, flip = conditional_market_marriage(
                    tune, incumbent_tune_final, market_confidence, independent_uncertainty, blend,
                )
                report = coherent.evaluate(tune, prediction)
                market_candidates.append({
                    "kind": "conditional", "market_confidence": market_confidence,
                    "independent_uncertainty": independent_uncertainty, "blend": blend,
                    "objective": objective(report), "tune_2024": report, "tune_flips": flip,
                })
    market_selected = min(market_candidates, key=lambda row: row["objective"])
    if market_selected["kind"] == "logit_blend":
        market_holdout = market_marriage(holdout, incumbent_final, market_selected["market_weight"])
        market_holdout_flip = None
    else:
        market_holdout, market_holdout_flip = conditional_market_marriage(
            holdout, incumbent_final, market_selected["market_confidence"],
            market_selected["independent_uncertainty"], market_selected["blend"],
        )
    payload = {
        "release": "nhl_multihorizon_independent_score_research_2026_09_29_r1",
        "protocol": {
            "inputs": "pregame team, opponent, special-teams, danger, rest and travel evidence at five recency horizons" + ("" if args.without_players else ", plus prior-game player rosters"),
            "market_in_score_head": False,
            "train": "2022-2023", "selection": "2024", "untouched_report": "2025",
        },
        "selected": selected,
        "score_only_holdout_2025": coherent.evaluate(holdout, holdout_scores),
        "component_ensemble": component_selected,
        "component_ensemble_holdout_2025": coherent.evaluate(holdout, component_holdout),
        "component_ensemble_top_candidates": sorted(component_candidates, key=lambda row: row["objective"])[:8],
        "paired_winner_head": paired_selected,
        "paired_holdout_2025": coherent.evaluate(holdout, final_holdout),
        "paired_top_candidates": sorted(paired, key=lambda row: row["objective"])[:8],
        "legacy_independent_winner_pair": incumbent_selected,
        "legacy_independent_winner_holdout_2025": coherent.evaluate(holdout, incumbent_final),
        "legacy_independent_winner_candidates": incumbent_models,
        "opening_market_marriage": market_selected,
        "opening_market_marriage_holdout_2025": coherent.evaluate(holdout, market_holdout),
        "opening_market_marriage_holdout_flips": market_holdout_flip,
        "opening_market_marriage_top_candidates": sorted(market_candidates, key=lambda row: row["objective"])[:10],
        "top_candidates": sorted(candidates, key=lambda row: row["objective"])[:8],
        "counts": {"train": len(train), "tune": len(tune), "holdout": len(holdout), "features": len(rows[0]["home_x"])},
    }
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
