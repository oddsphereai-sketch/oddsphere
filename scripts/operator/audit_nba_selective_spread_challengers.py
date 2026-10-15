#!/usr/bin/env python3
"""Chronology-safe direct NBA cover classifier and selective-play audit.

The audit has three distinct, non-overlapping decisions: 2022 develops the
candidate, 2023 selects one classifier family, 2024 selects one broad play
lane and confidence threshold, and 2025 supplies confirmation with exact
captured-price ROI where available.

This is research only. It never changes projections, grades, stakes, locks, or
production state. Favorable +3/+6 results are always reported for the selected
main-line decisions, but are not used to select the policy.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_selective_spread_challenger_2026_10_15_r2_four_season"
RANDOM_STATE = 20261015
INCUMBENT = {
    "group": "ratings_schedule",
    "architecture": "margin_total",
    "model": {"family": "ridge", "alpha": 1000.0},
}
CONFIDENCE_THRESHOLDS = (0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.575, 0.60)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--reference-sqlite", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def wilson_lower(wins: int, decisions: int, z: float = 1.96) -> float | None:
    if decisions <= 0:
        return None
    rate = wins / decisions
    denominator = 1 + z * z / decisions
    center = rate + z * z / (2 * decisions)
    margin = z * math.sqrt(rate * (1 - rate) / decisions + z * z / (4 * decisions * decisions))
    return float((center - margin) / denominator)


TEAM_NAMES = {
    "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets",
    "CHA": "Charlotte Bobcats", "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers",
    "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons",
    "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
    "LAC": "Los Angeles Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
    "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves",
    "NOP": "New Orleans Pelicans", "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder",
    "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns",
    "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs",
    "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
}


def reference_lines(path: Path) -> dict[tuple[int, str, str, str], float]:
    if not path.exists():
        raise ValueError(f"missing reference SQLite {path}")
    output: dict[tuple[int, str, str, str], float] = {}
    table_by_season = {2022: "odds_2022-23_new", 2023: "2023-24", 2024: "2024-25"}
    with sqlite3.connect(path) as connection:
        for season, table in table_by_season.items():
            rows = connection.execute(
                f'SELECT Date, Home, Away, Spread FROM "{table}"'
            ).fetchall()
            for date, home, away, spread in rows:
                if spread is None:
                    continue
                key = (season, str(date)[:10], str(home), str(away))
                value = -float(spread)
                prior = output.get(key)
                if prior is not None and not math.isclose(prior, value):
                    raise ValueError(f"duplicate conflicting reference spread {key}")
                output[key] = value
    return output


def chronological_independent_rows(
    frame: pd.DataFrame,
    groups: dict[str, list[str]],
    historical_lines: dict[tuple[int, str, str, str], float],
) -> dict[int, pd.DataFrame]:
    output: dict[int, pd.DataFrame] = {}
    for season in (2022, 2023, 2024, 2025):
        train = frame[frame["season"] < season].copy()
        evaluate = frame[frame["season"] == season].copy()
        home, away, _ = professional.fit_predict(
            train,
            evaluate,
            groups[str(INCUMBENT["group"])],
            dict(INCUMBENT["model"]),
            str(INCUMBENT["architecture"]),
        )
        line = evaluate["evaluation_opening_home_spread"].to_numpy(float)
        if season == 2022:
            # The source keys games by US game date while feature_cutoff is UTC;
            # subtracting twelve hours safely maps every NBA start back to its
            # listed local game date without depending on arena time zones.
            dates = (
                pd.to_datetime(evaluate["feature_cutoff"], utc=True)
                - pd.to_timedelta(12, unit="h")
            ).dt.strftime("%Y-%m-%d")
            reference = np.asarray([
                historical_lines.get((
                    season,
                    date,
                    TEAM_NAMES[str(home)],
                    TEAM_NAMES[str(away)],
                ), math.nan)
                for date, home, away in zip(dates, evaluate["home_team"], evaluate["away_team"])
            ], dtype=float)
            line = np.where(np.isfinite(line), line, reference)
            evaluate["evaluation_opening_home_spread"] = line
            evaluate.loc[np.isfinite(reference), "evaluation_market_provenance"] = (
                "public_pregame_reference_timestamp_unknown_external_replication"
            )
        evaluate["independent_market_edge"] = home - away + line
        evaluate["independent_market_edge_abs"] = np.abs(evaluate["independent_market_edge"])
        evaluate["market_line_abs"] = np.abs(line)
        evaluate["market_home_favorite"] = (line < 0).astype(float)
        evaluate["season_progress"] = np.minimum(
            evaluate["home_current_games"].to_numpy(float),
            evaluate["away_current_games"].to_numpy(float),
        )
        evaluate["target_market_residual"] = evaluate["target_home_margin"].to_numpy(float) + line
        evaluate = evaluate[np.isfinite(line)].copy()
        evaluate["cover_outcome"] = (evaluate["target_market_residual"] > 0).astype(int)
        evaluate["is_push"] = np.isclose(evaluate["target_market_residual"], 0.0)
        output[season] = evaluate.sort_values(["feature_cutoff", "game_id"]).reset_index(drop=True)
    return output


def usable_features(train: pd.DataFrame, requested: list[str]) -> list[str]:
    output = []
    for column in requested:
        values = pd.to_numeric(train[column], errors="coerce")
        if float(values.notna().mean()) < 0.50 or int(values.nunique(dropna=True)) < 2:
            continue
        output.append(column)
    if not output:
        raise ValueError("NBA spread classifier has no usable features")
    return output


def estimator_factories() -> dict[str, Callable[[], Pipeline | None]]:
    def logistic(c_value: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", LogisticRegression(C=c_value, max_iter=4000, random_state=RANDOM_STATE)),
        ])

    def hist(minimum_leaf: int, l2: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=False)),
            ("model", HistGradientBoostingClassifier(
                learning_rate=0.03,
                max_iter=220,
                max_leaf_nodes=7,
                min_samples_leaf=minimum_leaf,
                l2_regularization=l2,
                random_state=RANDOM_STATE,
            )),
        ])

    def extra_trees(minimum_leaf: int) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=False)),
            ("model", ExtraTreesClassifier(
                n_estimators=400,
                max_depth=8,
                min_samples_leaf=minimum_leaf,
                max_features=0.60,
                n_jobs=-1,
                random_state=RANDOM_STATE,
            )),
        ])

    return {
        "incumbent_normal": lambda: None,
        "logistic_c0001": lambda: logistic(0.001),
        "logistic_c001": lambda: logistic(0.01),
        "logistic_c01": lambda: logistic(0.1),
        "hist_leaf40": lambda: hist(40, 20.0),
        "hist_leaf80": lambda: hist(80, 30.0),
        "extra_trees_leaf20": lambda: extra_trees(20),
        "extra_trees_leaf40": lambda: extra_trees(40),
    }


def fit_predict_probability(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    requested: list[str],
    estimator_name: str,
) -> tuple[np.ndarray, list[str]]:
    resolved = ~train["is_push"].to_numpy(bool)
    features = usable_features(train.loc[resolved], requested)
    if estimator_name == "incumbent_normal":
        error = (
            train.loc[resolved, "target_market_residual"].to_numpy(float)
            - train.loc[resolved, "independent_market_edge"].to_numpy(float)
        )
        sigma = max(float(np.std(error, ddof=1)), 1e-6)
        z = evaluate["independent_market_edge"].to_numpy(float) / sigma
        probability = professional.normal_cdf(z)
        return np.clip(probability, 0.001, 0.999), ["independent_market_edge"]
    model = estimator_factories()[estimator_name]()
    if model is None:
        raise AssertionError("unexpected empty NBA spread estimator")
    model.fit(train.loc[resolved, features], train.loc[resolved, "cover_outcome"].to_numpy(int))
    probability = np.asarray(model.predict_proba(evaluate[features])[:, 1], dtype=float)
    return np.clip(probability, 0.001, 0.999), features


def probability_metrics(frame: pd.DataFrame, probability: np.ndarray) -> dict[str, Any]:
    resolved = ~frame["is_push"].to_numpy(bool)
    outcome = frame.loc[resolved, "cover_outcome"].to_numpy(int)
    p = probability[resolved]
    selected = p >= 0.50
    return {
        "rows": int(resolved.sum()),
        "brier": float(brier_score_loss(outcome, p)),
        "logLoss": float(log_loss(outcome, p, labels=[0, 1])),
        "directionAccuracy": float((selected == outcome).mean()),
        "homeSelections": int(selected.sum()),
        "awaySelections": int((~selected).sum()),
        "meanConfidence": float(np.maximum(p, 1 - p).mean()),
    }


def lane_masks(frame: pd.DataFrame, probability: np.ndarray) -> dict[str, np.ndarray]:
    selected_home = probability >= 0.50
    home_favorite = frame["market_home_favorite"].to_numpy(bool)
    selected_favorite = selected_home == home_favorite
    line_abs = frame["market_line_abs"].to_numpy(float)
    stage = frame["season_progress"].to_numpy(float)
    return {
        "all": np.ones(len(frame), dtype=bool),
        "favorites": selected_favorite,
        "underdogs": ~selected_favorite,
        "home": selected_home,
        "away": ~selected_home,
        "line_0_to_4": line_abs <= 4.0,
        "line_4_to_8": (line_abs > 4.0) & (line_abs <= 8.0),
        "line_over_8": line_abs > 8.0,
        "team_games_0_to_4": stage < 5,
        "team_games_5_to_14": (stage >= 5) & (stage < 15),
        "team_games_15_to_29": (stage >= 15) & (stage < 30),
        "team_games_30_to_49": (stage >= 30) & (stage < 50),
        "team_games_50_plus": stage >= 50,
        "after_team_game_5": stage >= 5,
        "after_team_game_15": stage >= 15,
    }


def exact_price_return(
    frame: pd.DataFrame,
    probability: np.ndarray,
    keep: np.ndarray,
) -> dict[str, Any] | None:
    selected_home = probability >= 0.50
    home_price = frame["evaluation_opening_home_spread_price"].to_numpy(float)
    away_price = frame["evaluation_opening_away_spread_price"].to_numpy(float)
    price = np.where(selected_home, home_price, away_price)
    priced = keep & np.isfinite(price) & (price != 0)
    if not priced.any():
        return None
    outcome = frame["cover_outcome"].to_numpy(bool)
    wins = selected_home == outcome
    win_profit = np.where(price > 0, price / 100.0, 100.0 / -price)
    units = np.where(wins, win_profit, -1.0)
    return {
        "bets": int(priced.sum()),
        "wins": int((wins & priced).sum()),
        "losses": int(((~wins) & priced).sum()),
        "units": float(units[priced].sum()),
        "roi": float(units[priced].mean()),
        "averagePrice": float(price[priced].mean()),
    }


def action_report(
    frame: pd.DataFrame,
    probability: np.ndarray,
    lane: str,
    threshold: float,
) -> dict[str, Any]:
    selected_home = probability >= 0.50
    confidence = np.maximum(probability, 1 - probability)
    resolved = ~frame["is_push"].to_numpy(bool)
    keep = resolved & lane_masks(frame, probability)[lane] & (confidence >= threshold)
    outcome = frame["cover_outcome"].to_numpy(bool)
    wins = selected_home == outcome
    decisions = int(keep.sum())
    win_count = int((wins & keep).sum())

    line = frame["evaluation_opening_home_spread"].to_numpy(float)
    selected_margin = np.where(selected_home, frame["target_home_margin"].to_numpy(float), -frame["target_home_margin"].to_numpy(float))
    selected_line = np.where(selected_home, line, -line)
    result_margin = selected_margin + selected_line

    def cushion(points: float) -> dict[str, Any]:
        adjusted = result_margin + points
        cushion_keep = keep & ~np.isclose(adjusted, 0.0)
        cushion_wins = adjusted > 0
        count = int(cushion_keep.sum())
        won = int((cushion_wins & cushion_keep).sum())
        return {
            "decisions": count,
            "wins": won,
            "losses": count - won,
            "pushes": int((keep & np.isclose(adjusted, 0.0)).sum()),
            "accuracy": float(won / count) if count else None,
        }

    home_favorite = frame["market_home_favorite"].to_numpy(bool)
    selected_favorite = selected_home == home_favorite
    return {
        "lane": lane,
        "confidenceThreshold": threshold,
        "decisions": decisions,
        "wins": win_count,
        "losses": decisions - win_count,
        "pushes": int((~resolved & lane_masks(frame, probability)[lane] & (confidence >= threshold)).sum()),
        "accuracy": float(win_count / decisions) if decisions else None,
        "wilson95Lower": wilson_lower(win_count, decisions),
        "meanConfidence": float(confidence[keep].mean()) if decisions else None,
        "homeSelections": int((keep & selected_home).sum()),
        "awaySelections": int((keep & ~selected_home).sum()),
        "favoriteSelections": int((keep & selected_favorite).sum()),
        "underdogSelections": int((keep & ~selected_favorite).sum()),
        "exactPrice": exact_price_return(frame, probability, keep),
        "favorablePlus3": cushion(3.0),
        "favorablePlus6": cushion(6.0),
    }


def candidate_rank(metrics: dict[str, Any], partition_rows: list[dict[str, Any]]) -> tuple[Any, ...]:
    unstable = any(float(row["directionAccuracy"]) < 0.49 for row in partition_rows)
    return (
        unstable,
        float(metrics["brier"]),
        float(metrics["logLoss"]),
        -float(metrics["directionAccuracy"]),
    )


def main() -> None:
    args = parse_args()
    frame = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(frame)
    rows = chronological_independent_rows(frame, groups, reference_lines(args.reference_sqlite))
    development = rows[2022]
    model_selection = rows[2023]
    policy_selection = rows[2024]

    group_definitions = {
        "edge_only": ["independent_market_edge"],
        "edge_topology": [
            "independent_market_edge", "independent_market_edge_abs", "market_line_abs",
            "market_home_favorite", "season_progress",
        ],
        "ratings_schedule": [
            "independent_market_edge", "independent_market_edge_abs", "market_line_abs",
            "market_home_favorite", "season_progress", *groups["ratings_schedule"],
        ],
        "four_factors_schedule": [
            "independent_market_edge", "independent_market_edge_abs", "market_line_abs",
            "market_home_favorite", "season_progress", *groups["four_factors_schedule"],
        ],
        "rotation_schedule": [
            "independent_market_edge", "independent_market_edge_abs", "market_line_abs",
            "market_home_favorite", "season_progress", *groups["rotation_schedule"],
        ],
    }
    group_definitions = {
        name: list(dict.fromkeys(features)) for name, features in group_definitions.items()
    }

    candidates: list[dict[str, Any]] = []
    for group_name, features in group_definitions.items():
        for estimator_name in estimator_factories():
            selection_probability, usable = fit_predict_probability(
                development, model_selection, features, estimator_name,
            )
            selection_metrics = probability_metrics(model_selection, selection_probability)
            candidates.append({
                "group": group_name,
                "estimator": estimator_name,
                "usableFeatureCount": len(usable),
                "selection": selection_metrics,
                "selectionGatePassed": bool(
                    selection_metrics["brier"] < 0.25
                    and selection_metrics["directionAccuracy"] > 0.51
                ),
                "rank": candidate_rank(selection_metrics, [selection_metrics]),
            })
    candidates.sort(key=lambda row: tuple(row["rank"]))
    selected_candidate = candidates[0]
    selected_features = group_definitions[str(selected_candidate["group"])]

    policy_training = pd.concat([development, model_selection], ignore_index=True)
    policy_probability, policy_features = fit_predict_probability(
        policy_training,
        policy_selection,
        selected_features,
        str(selected_candidate["estimator"]),
    )
    policy_candidates = []
    for lane in lane_masks(policy_selection, policy_probability):
        for threshold in CONFIDENCE_THRESHOLDS:
            report = action_report(policy_selection, policy_probability, lane, threshold)
            if report["decisions"] < 80:
                continue
            policy_candidates.append(report)

    # The late-2024 policy may only qualify if its direction was also at least
    # break-even in both earlier family-selection partitions. This stops a
    # one-slice subgroup from becoming a play lane.
    stability_probabilities = {
        "2023": fit_predict_probability(
            development, model_selection, selected_features, str(selected_candidate["estimator"])
        )[0],
    }
    stability_frames = {"2023": model_selection}
    for report in policy_candidates:
        stability = {}
        for name, cohort in stability_frames.items():
            stability[name] = action_report(
                cohort,
                stability_probabilities[name],
                str(report["lane"]),
                float(report["confidenceThreshold"]),
            )
        report["stability"] = stability
        report["policyGatePassed"] = bool(
            report["accuracy"] is not None
            and report["accuracy"] >= 0.54
            and report["wilson95Lower"] is not None
            and report["wilson95Lower"] >= 0.50
            and all(
                row["decisions"] >= 35 and row["accuracy"] is not None and row["accuracy"] >= 0.50
                for row in stability.values()
            )
        )
    policy_candidates.sort(key=lambda row: (
        not row["policyGatePassed"],
        -float(row["wilson95Lower"] or -1),
        -int(row["decisions"]),
        str(row["lane"]),
        float(row["confidenceThreshold"]),
    ))
    selected_policy = policy_candidates[0] if policy_candidates else None

    final_training = pd.concat([rows[2022], rows[2023], rows[2024]], ignore_index=True)
    confirmation_probability, final_features = fit_predict_probability(
        final_training,
        rows[2025],
        selected_features,
        str(selected_candidate["estimator"]),
    )
    confirmation_all = probability_metrics(rows[2025], confirmation_probability)
    confirmation_policy = None
    if selected_policy is not None:
        confirmation_policy = action_report(
            rows[2025],
            confirmation_probability,
            str(selected_policy["lane"]),
            float(selected_policy["confidenceThreshold"]),
        )

    confirmation_lanes = {
        lane: action_report(rows[2025], confirmation_probability, lane, 0.50)
        for lane in lane_masks(rows[2025], confirmation_probability)
    }
    confirmation_gate = bool(
        selected_policy is not None
        and selected_policy["policyGatePassed"]
        and confirmation_policy is not None
        and confirmation_policy["decisions"] >= 100
        and confirmation_policy["accuracy"] is not None
        and confirmation_policy["accuracy"] >= 0.525
        and confirmation_policy["wilson95Lower"] is not None
        and confirmation_policy["wilson95Lower"] >= 0.50
        and confirmation_policy["exactPrice"] is not None
        and confirmation_policy["exactPrice"]["bets"] >= 80
        and confirmation_policy["exactPrice"]["units"] > 0
    )

    for row in candidates:
        row.pop("rank", None)
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "method": {
            "classifierSelection": "train 2022; select classifier on 2023",
            "policySelection": "refit 2022-2023; select broad lane and confidence on 2024",
            "confirmation": "refit 2022-2024; evaluate 2025",
        },
        "target": "home_covers_pregame_opening_spread",
        "incumbent": INCUMBENT,
        "selectedCandidate": selected_candidate,
        "selectedUsableFeatures": final_features,
        "policySelection": {
            "selected": selected_policy,
            "candidates": policy_candidates,
        },
        "confirmation": {
            "allDirections": confirmation_all,
            "selectedPolicy": confirmation_policy,
            "diagnosticLanesAtNoConfidenceCut": confirmation_lanes,
            "gatePassed": confirmation_gate,
        },
        "promotionEligible": bool(selected_candidate["selectionGatePassed"] and confirmation_gate),
        "constraints": [
            "+3 and +6 are retained as fixed alternate-line checkpoints and never used for policy selection.",
            "The added 2022 spread is from the same public pregame-reference family as 2023; its observation timestamp and source book are unknown.",
            "2023 and 2024 odds provenance lacks historical exact prices; economic confirmation uses only captured 2025 prices.",
            "Historical split and same-book movement sequences remain unavailable and are not approximated.",
            "A failed policy remains research evidence; this audit never converts weak evidence into a production play.",
        ],
        "candidates": candidates,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "report": str(args.output),
        "selectedCandidate": selected_candidate,
        "selectedPolicy": selected_policy,
        "confirmation": report["confirmation"],
        "promotionEligible": report["promotionEligible"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
