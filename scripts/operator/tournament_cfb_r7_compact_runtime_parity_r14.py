#!/usr/bin/env python3
"""Research-only compact runtime parity tournament for the selected CFB r7 model."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from cfb_professional_research_metrics import detailed_metrics
from tournament_cfb_symmetric_matchup_score_r4 import (
    CURRENT_SEASON,
    TEST_SEASONS,
    append_current_sources,
    build_dataset,
    direct_features,
    read_sources,
    team_rows,
)


RELEASE = "cfb_r7_compact_runtime_parity_tournament_2026_10_01_r14"
TREE_COUNTS = (48, 72, 96, 360)
REFERENCE_TREES = 360
DOMAIN_THRESHOLD = 7.0


def linear_score(seed: int) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", ElasticNet(alpha=0.055, l1_ratio=0.12, max_iter=30000, random_state=seed)),
    ])


def forest(seed: int, trees: int) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", ExtraTreesRegressor(
            n_estimators=trees, min_samples_leaf=18, max_features=0.65,
            n_jobs=1, random_state=seed,
        )),
    ])


def hist(seed: int) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", HistGradientBoostingRegressor(
            max_iter=260, learning_rate=0.035, max_leaf_nodes=12,
            min_samples_leaf=45, l2_regularization=9.0, random_state=seed,
        )),
    ])


def predictions(data: Any, season: int, seed: int) -> tuple[Any, dict[int, tuple[np.ndarray, np.ndarray]], list[dict[str, Any]]]:
    train = data[data.season < season].reset_index(drop=True)
    test = data[data.season == season].reset_index(drop=True)
    train_team, train_score, _ = team_rows(train)
    test_team, _, _ = team_rows(test)
    margin_train = direct_features(train, "margin")
    margin_test = direct_features(test, "margin")
    total_train = direct_features(train, "total")
    total_test = direct_features(test, "total")
    actual_margin = train.home_score.to_numpy(float) - train.away_score.to_numpy(float)
    actual_total = train.home_score.to_numpy(float) + train.away_score.to_numpy(float)

    score = linear_score(seed)
    score.fit(train_team, train_score)
    shared = score.predict(test_team)
    n = len(test)
    shared_margin = shared[:n] - shared[n:]
    shared_total = shared[:n] + shared[n:]

    nonlinear_total = hist(seed + 202)
    nonlinear_total.fit(total_train, actual_total)
    hist_total = nonlinear_total.predict(total_test)
    by_count: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    audits: list[dict[str, Any]] = []
    for count in TREE_COUNTS:
        margin_model = forest(seed + 101, count)
        total_model = forest(seed + 202, count)
        margin_model.fit(margin_train, actual_margin)
        total_model.fit(total_train, actual_total)
        margin = 0.75 * shared_margin + 0.25 * margin_model.predict(margin_test)
        robust_total = 0.5 * (hist_total + total_model.predict(total_test))
        total = shared_total.copy()
        week_audit = []
        for week in sorted(set(int(value) for value in test.week.to_numpy())):
            indexes = np.flatnonzero(test.week.to_numpy() == week)
            disagreement = float(np.mean(robust_total[indexes] - shared_total[indexes]))
            applied = disagreement if abs(disagreement) >= DOMAIN_THRESHOLD else 0.0
            total[indexes] += applied
            week_audit.append({"week": week, "games": len(indexes), "disagreement": disagreement, "applied": applied})
        by_count[count] = (margin, total)
        audits.append({"trees": count, "weeks": week_audit})
    return test, by_count, audits


def deltas(candidate: dict[str, Any], reference: dict[str, Any]) -> dict[str, float]:
    def change(first: float | None, second: float | None) -> float | None:
        return None if first is None or second is None else first - second
    return {
        "teamScoreMae": candidate["teamScoreMae"] - reference["teamScoreMae"],
        "marginMae": candidate["marginMae"] - reference["marginMae"],
        "moneylineAccuracy": candidate["moneylineAccuracy"] - reference["moneylineAccuracy"],
        "spreadAccuracy": change(candidate["spread"]["accuracy"], reference["spread"]["accuracy"]),
        "totalAccuracy": change(candidate["total"]["accuracy"], reference["total"]["accuracy"]),
    }


def pooled_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    games = sum(int(row["games"]) for row in rows)
    spread_decided = sum(int(row["spread"]["decided"]) for row in rows)
    total_decided = sum(int(row["total"]["decided"]) for row in rows)
    return {
        "games": games,
        "teamScoreMae": sum(row["teamScoreMae"] * row["games"] for row in rows) / games,
        "marginMae": sum(row["marginMae"] * row["games"] for row in rows) / games,
        "totalMae": sum(row["totalMae"] * row["games"] for row in rows) / games,
        "moneylineAccuracy": sum(row["moneylineAccuracy"] * row["games"] for row in rows) / games,
        "spread": {
            "decided": spread_decided,
            "accuracy": sum(row["spread"]["accuracy"] * row["spread"]["decided"] for row in rows) / spread_decided,
        },
        "total": {
            "decided": total_decided,
            "accuracy": sum(row["total"]["accuracy"] * row["total"]["decided"] for row in rows) / total_decided,
        },
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    frames, checksums = read_sources(Path(args.historical_source_dir))
    residuals = np.asarray(json.loads(Path(args.residual_artifact).read_text())["residualSample"], dtype=float)
    historical = build_dataset(frames, current_season_prior_games=4.0, include_opponent_adjusted_matchups=True).replace([np.inf, -np.inf], np.nan)
    seasons: dict[str, Any] = {}
    metrics_by_count: dict[int, list[dict[str, Any]]] = {count: [] for count in TREE_COUNTS}
    for season in TEST_SEASONS:
        frame, values, audits = predictions(historical, season, args.seed + season)
        season_metrics = {}
        for count, (margin, total) in values.items():
            metric = detailed_metrics(frame, margin, total, residuals)
            metrics_by_count[count].append(metric)
            season_metrics[str(count)] = metric
        seasons[str(season)] = {"metrics": season_metrics, "audits": audits}

    pooled = {str(count): pooled_metrics(metrics_by_count[count]) for count in TREE_COUNTS}
    reference = pooled[str(REFERENCE_TREES)]
    candidates = []
    for count in TREE_COUNTS[:-1]:
        candidate = pooled[str(count)]
        candidate_delta = deltas(candidate, reference)
        activation_same = all(
            [abs(week["disagreement"]) >= DOMAIN_THRESHOLD for audit in seasons[str(season)]["audits"] if audit["trees"] == count for week in audit["weeks"]]
            == [abs(week["disagreement"]) >= DOMAIN_THRESHOLD for audit in seasons[str(season)]["audits"] if audit["trees"] == REFERENCE_TREES for week in audit["weeks"]]
            for season in TEST_SEASONS
        )
        gates = {
            "pooledMarginMae": candidate_delta["marginMae"] <= 0.10,
            "pooledTeamScoreMae": candidate_delta["teamScoreMae"] <= 0.05,
            "pooledMoneyline": candidate_delta["moneylineAccuracy"] >= -0.002,
            "pooledSpread": candidate_delta["spreadAccuracy"] >= -0.002,
            "pooledTotal": candidate_delta["totalAccuracy"] >= -0.002,
            "seasonMarginMae": all(
                seasons[str(season)]["metrics"][str(count)]["marginMae"]
                <= seasons[str(season)]["metrics"][str(REFERENCE_TREES)]["marginMae"] + 0.20
                for season in TEST_SEASONS
            ),
            "domainActivation": activation_same,
        }
        candidates.append({"trees": count, "pooled": candidate, "delta": candidate_delta, "gates": gates, "allGatesPass": all(gates.values())})
    selected = next((row for row in candidates if row["allGatesPass"]), None)

    current = None
    if selected:
        current_frames = append_current_sources(frames, Path(args.current_source_dir))
        current_data = build_dataset(current_frames, current_season_prior_games=4.0, include_opponent_adjusted_matchups=True).replace([np.inf, -np.inf], np.nan)
        frame, values, audits = predictions(current_data, CURRENT_SEASON, args.seed + CURRENT_SEASON)
        count = int(selected["trees"])
        selected_margin, selected_total = values[count]
        selected_home = (selected_total + selected_margin) / 2.0
        selected_away = (selected_total - selected_margin) / 2.0
        current = {
            "selectedTrees": count,
            "selected": detailed_metrics(frame, *values[count], residuals),
            "reference": detailed_metrics(frame, *values[REFERENCE_TREES], residuals),
            "delta": deltas(detailed_metrics(frame, *values[count], residuals), detailed_metrics(frame, *values[REFERENCE_TREES], residuals)),
            "audits": audits,
            "predictions": [
                {
                    "gameId": str(int(row.game_id)),
                    "gameDate": str(row.game_date),
                    "week": int(row.week),
                    "neutralSite": bool(row.neutral),
                    "awayTeam": str(row.away_team),
                    "homeTeam": str(row.home_team),
                    "expectedAway": float(selected_away[index]),
                    "expectedHome": float(selected_home[index]),
                    "actualAway": float(row.away_score),
                    "actualHome": float(row.home_score),
                }
                for index, row in enumerate(frame.itertuples(index=False))
            ],
        }
    return {
        "release": RELEASE,
        "productionDecisionEffect": False,
        "evidenceBoundary": {"historical": "independent_and_line_relative_only", "current2026": "opened_stress_test_not_selection"},
        "referenceTrees": REFERENCE_TREES,
        "pooled": pooled,
        "seasons": seasons,
        "candidates": candidates,
        "selected": selected,
        "current2026": current,
        "sourceChecksums": checksums,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--historical-source-dir", required=True)
    parser.add_argument("--current-source-dir", required=True)
    parser.add_argument("--residual-artifact", default="lib/services/football/modelArtifacts/cfbV1JointScoreArtifact.json")
    parser.add_argument("--output", default="/private/tmp/cfb-r7-compact-runtime-parity-r14.json")
    parser.add_argument("--seed", type=int, default=20260930)
    args = parser.parse_args()
    report = run(args)
    Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    current_summary = None if report["current2026"] is None else {
        key: value for key, value in report["current2026"].items() if key != "predictions"
    }
    print(json.dumps({"release": report["release"], "candidates": report["candidates"], "selected": report["selected"], "current2026": current_summary}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
