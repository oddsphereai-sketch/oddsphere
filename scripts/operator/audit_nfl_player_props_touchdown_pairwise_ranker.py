#!/usr/bin/env python3
"""Audit a teammate-pairwise NFL anytime-touchdown display ranker."""

from __future__ import annotations

import argparse
import json
import pathlib
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from audit_nfl_player_props_touchdown_scorer_quality import (
    DEFAULT_MARKET_CONTEXT,
    HISTORY_MANIFEST,
    POSITIONS,
    add_relative_role_features,
    build_external_features,
)
from tournament_nfl_player_props_touchdowns import add_touchdown_features, read_pbp


RANK_FEATURES = [
    "prior_anytime_td_avg5",
    "prior_anytime_td_ewm",
    "prior_redzone_opportunity_avg5",
    "prior_redzone_opportunity_ewm",
    "prior_goal_line_opportunity_avg5",
    "prior_goal_line_opportunity_ewm",
    "prior_rush_attempt_share_avg3",
    "prior_rush_attempt_share_ewm",
    "prior_target_share_avg3",
    "prior_target_share_ewm",
    "prior_offense_snap_pct_ewm",
    "relative_anytime_td_avg5",
    "relative_anytime_td_ewm",
    "relative_redzone_opportunity_avg5",
    "relative_redzone_opportunity_ewm",
    "relative_goal_line_opportunity_avg5",
    "relative_goal_line_opportunity_ewm",
    "relative_rush_attempt_share_avg3",
    "relative_rush_attempt_share_ewm",
    "relative_target_share_avg3",
    "relative_target_share_ewm",
    "relative_offense_snap_pct_ewm",
    "relative_combined_role_ewm",
    "expected_td_role_ewm",
    "team_implied_touchdowns",
    "prior_team_td_avg5",
    "prior_opponent_td_allowed_avg5",
    "is_home",
    "position_qb",
    "position_rb",
    "position_fb",
    "position_wr",
    "position_te",
]


def pairwise_rows(frame: pd.DataFrame, medians: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    values = frame[RANK_FEATURES].apply(pd.to_numeric, errors="coerce").fillna(medians)
    pairs: list[np.ndarray] = []
    labels: list[int] = []
    for _, index in frame.groupby(["season", "week", "game_id", "team"], observed=True).groups.items():
        group = frame.loc[index]
        positive_index = group.index[group["anytime_td"].eq(1)]
        negative_index = group.index[group["anytime_td"].eq(0)]
        if not len(positive_index) or not len(negative_index):
            continue
        positive = values.loc[positive_index].to_numpy(float)
        negative = values.loc[negative_index].to_numpy(float)
        for scorer in positive:
            difference = scorer[None, :] - negative
            pairs.extend(difference)
            labels.extend([1] * len(difference))
            pairs.extend(-difference)
            labels.extend([0] * len(difference))
    return np.asarray(pairs, dtype=float), np.asarray(labels, dtype=int)


def baseline_model() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=160,
        max_leaf_nodes=15,
        learning_rate=0.05,
        l2_regularization=3.0,
        random_state=20260825,
    )


def ranker(regularization: float) -> Any:
    return make_pipeline(
        StandardScaler(),
        LogisticRegression(C=regularization, max_iter=800, fit_intercept=False),
    )


def scores(model: Any, rows: pd.DataFrame, medians: pd.Series) -> np.ndarray:
    values = rows[RANK_FEATURES].apply(pd.to_numeric, errors="coerce").fillna(medians)
    return model.decision_function(values.to_numpy(float))


def nonlinear_pairwise_ranker(leaves: int) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=180,
        max_leaf_nodes=leaves,
        learning_rate=0.04,
        l2_regularization=8.0,
        min_samples_leaf=80,
        random_state=20260917,
    )


def nonlinear_pairwise_scores(
    model: HistGradientBoostingClassifier,
    rows: pd.DataFrame,
    medians: pd.Series,
) -> np.ndarray:
    values = rows[RANK_FEATURES].apply(pd.to_numeric, errors="coerce").fillna(medians)
    output = pd.Series(0.0, index=rows.index)
    batches: list[np.ndarray] = []
    groups: list[tuple[pd.Index, int]] = []
    for _, index in rows.groupby(["season", "week", "game_id", "team"], observed=True).groups.items():
        group_values = values.loc[index].to_numpy(float)
        if len(group_values) <= 1:
            continue
        differences = group_values[:, None, :] - group_values[None, :, :]
        batches.append(differences.reshape(-1, differences.shape[-1]))
        groups.append((index, len(group_values)))
    probabilities = model.predict_proba(np.vstack(batches))[:, 1]
    offset = 0
    for index, size in groups:
        count = size * size
        output.loc[index] = probabilities[offset : offset + count].reshape(size, size).sum(axis=1)
        offset += count
    return output.loc[rows.index].to_numpy(float)


def selection_metrics(
    rows: pd.DataFrame,
    count_probability: np.ndarray,
    rank_score: np.ndarray,
    *,
    known_only: bool = False,
) -> dict[str, float | int]:
    evaluated = rows[["season", "week", "game_id", "team", "player_id"]].copy()
    evaluated["count_probability"] = count_probability
    evaluated["rank_score"] = rank_score
    evaluated["selected"] = False
    for _, index in evaluated.groupby(["game_id", "team"], observed=True).groups.items():
        group = evaluated.loc[index]
        count = min(
            len(group),
            max(0, int(np.floor(float(group["count_probability"].sum()) + 0.5))),
        )
        chosen = group.sort_values(
            ["rank_score", "player_id"], ascending=[False, True], kind="mergesort"
        ).head(count).index
        evaluated.loc[chosen, "selected"] = True
    selected = evaluated["selected"].to_numpy(bool)
    if known_only:
        known = rows["actual_touchdowns"].notna().to_numpy(bool)
        actual = rows["actual_touchdowns"].fillna(0).to_numpy(float) > 0
    else:
        known = np.ones(len(rows), dtype=bool)
        actual = rows["anytime_td"].to_numpy(int).astype(bool)
    selected_known = selected & known
    true_positive = int(np.sum(selected_known & actual))
    false_positive = int(np.sum(selected_known & ~actual))
    false_negative = int(np.sum(~selected & known & actual))
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    return {
        "knownRows": int(known.sum()),
        "selected": int(selected_known.sum()),
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "missedScorers": false_negative,
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(2 * precision * recall / max(1e-12, precision + recall)),
    }


def base_probability(
    train: pd.DataFrame,
    evaluation: pd.DataFrame,
    features: list[str],
) -> np.ndarray:
    model = baseline_model()
    model.fit(train[features], train["anytime_td"])
    return np.clip(model.predict_proba(evaluation[features])[:, 1], 0.0025, 0.9975)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--market-context", type=pathlib.Path, default=DEFAULT_MARKET_CONTEXT)
    parser.add_argument("--external-context", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()

    manifest = json.loads(HISTORY_MANIFEST.read_text(encoding="utf-8"))
    history = pd.read_parquet(manifest["featureFile"])
    complete_market_context = pd.read_csv(args.market_context, low_memory=False)
    training_market_context = complete_market_context[
        complete_market_context["season"].between(2016, 2025)
        & complete_market_context["game_type"].eq("REG")
    ].copy()
    frame, touchdown_features = add_touchdown_features(history, read_pbp(), training_market_context)
    for position in POSITIONS:
        frame[f"position_{position.lower()}"] = frame["position"].eq(position).astype(float)
    frame, relative_features = add_relative_role_features(frame)
    base_features = [
        *manifest["modelFeatureColumns"],
        *touchdown_features,
        "is_home",
        *(f"position_{position.lower()}" for position in POSITIONS),
    ]
    eligible = frame["prior_participations"].ge(1) & frame["position"].isin(POSITIONS)
    train = frame[eligible & frame["season"].le(2022)].copy()
    medians = train[RANK_FEATURES].apply(pd.to_numeric, errors="coerce").median().fillna(0.0)
    pair_x, pair_y = pairwise_rows(train, medians)

    validation: dict[str, Any] = {}
    rankers: dict[str, Any] = {}
    season_rows: dict[int, pd.DataFrame] = {
        season: frame[eligible & frame["season"].eq(season)].copy()
        for season in (2023, 2024, 2025)
    }
    probability_2023 = base_probability(train, season_rows[2023], base_features)
    incumbent_2023 = selection_metrics(
        season_rows[2023], probability_2023, probability_2023
    )
    for regularization in (0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0):
        name = f"C={regularization}"
        model = ranker(regularization)
        model.fit(pair_x, pair_y)
        rankers[name] = model
        validation[name] = selection_metrics(
            season_rows[2023], probability_2023, scores(model, season_rows[2023], medians)
        )
    selected_name = max(
        validation,
        key=lambda name: (
            validation[name]["f1"],
            validation[name]["precision"],
            validation[name]["truePositive"],
        ),
    )
    selected_ranker = rankers[selected_name]

    grouped_validation: dict[str, Any] = {}
    grouped_rankers: dict[str, HistGradientBoostingClassifier] = {}
    for leaves in (7, 15, 31):
        name = f"leaves={leaves}"
        model = nonlinear_pairwise_ranker(leaves)
        model.fit(pair_x, pair_y)
        grouped_rankers[name] = model
        grouped_validation[name] = selection_metrics(
            season_rows[2023],
            probability_2023,
            nonlinear_pairwise_scores(model, season_rows[2023], medians),
        )
    selected_grouped_name = max(
        grouped_validation,
        key=lambda name: (
            grouped_validation[name]["f1"],
            grouped_validation[name]["precision"],
            grouped_validation[name]["truePositive"],
        ),
    )
    selected_grouped_ranker = grouped_rankers[selected_grouped_name]

    confirmation: dict[str, Any] = {}
    for season in (2024, 2025):
        training_rows = frame[eligible & frame["season"].lt(season)]
        probability = base_probability(training_rows, season_rows[season], base_features)
        confirmation[str(season)] = {
            "incumbent": selection_metrics(season_rows[season], probability, probability),
            "pairwise": selection_metrics(
                season_rows[season], probability, scores(selected_ranker, season_rows[season], medians)
            ),
            "groupedPairwise": selection_metrics(
                season_rows[season],
                probability,
                nonlinear_pairwise_scores(selected_grouped_ranker, season_rows[season], medians),
            ),
        }

    external: dict[str, Any] | None = None
    if args.external_context:
        external_rows = build_external_features(
            args.external_context, complete_market_context, base_features
        )
        external_rows, _ = add_relative_role_features(external_rows)
        complete_train = frame[eligible & frame["season"].le(2025)].copy()
        complete_medians = (
            complete_train[RANK_FEATURES].apply(pd.to_numeric, errors="coerce").median().fillna(0.0)
        )
        complete_pair_x, complete_pair_y = pairwise_rows(complete_train, complete_medians)
        final_ranker = ranker(float(selected_name.split("=")[1]))
        final_ranker.fit(complete_pair_x, complete_pair_y)
        final_grouped_ranker = nonlinear_pairwise_ranker(
            int(selected_grouped_name.split("=")[1])
        )
        final_grouped_ranker.fit(complete_pair_x, complete_pair_y)
        probability = external_rows["incumbent_final_probability"].to_numpy(float)
        external = {
            "incumbent": selection_metrics(
                external_rows, probability, probability, known_only=True
            ),
            "pairwise": selection_metrics(
                external_rows,
                probability,
                scores(final_ranker, external_rows, complete_medians),
                known_only=True,
            ),
            "groupedPairwise": selection_metrics(
                external_rows,
                probability,
                nonlinear_pairwise_scores(final_grouped_ranker, external_rows, complete_medians),
                known_only=True,
            ),
        }

    result = {
        "auditRelease": "nfl_player_props_touchdown_pairwise_ranker_2026_09_17_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "rankFeatures": RANK_FEATURES,
        "pairwiseTrainingRows": int(len(pair_y)),
        "selection2023": {"incumbent": incumbent_2023, "candidates": validation},
        "selectedRegularization": selected_name,
        "groupedSelection2023": grouped_validation,
        "selectedGroupedLeaves": selected_grouped_name,
        "confirmation": confirmation,
        "externalWeek1": external,
    }
    encoded = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")


if __name__ == "__main__":
    main()
