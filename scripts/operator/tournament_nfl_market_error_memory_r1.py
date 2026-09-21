#!/usr/bin/env python3
"""Frozen NFL pre-week market-error-memory tournament.

Research only. It cannot write predictions, grades, tracking, or production
state. The implementation follows the 2026-09-21 predeclaration.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import expit, logit, ndtri
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


TOURNAMENT_RELEASE = "nfl_market_error_memory_tournament_2026_09_21_r1"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
TRAIN_SEASONS = tuple(range(2016, 2022))
SELECTION_SEASONS = (2022, 2023)
CONFIRMATION_SEASONS = (2024, 2025)
HALF_LIVES = (2, 4, 8, 16)
MODEL_WEIGHT = 0.25
MODEL_C = 0.01
POINT_CAP = 4.0
ACTION_EDGES = {"spread": 0.01, "total": 0.02}

CORE_FEATURES = (
    "market_home_margin", "market_total", "week", "neutral_site", "rest_diff",
    "temperature", "wind", "roof_indoor", "elo_diff", "home_qb_epa",
    "away_qb_epa", "home_qb_cpoe", "away_qb_cpoe", "home_qb_injury_weight",
    "away_qb_injury_weight", "home_roster_continuity", "away_roster_continuity",
)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implied(price: np.ndarray) -> np.ndarray:
    values = np.asarray(price, dtype=float)
    result = np.empty_like(values)
    positive = values > 0
    result[positive] = 100.0 / (values[positive] + 100.0)
    result[~positive] = -values[~positive] / (-values[~positive] + 100.0)
    return result


def no_vig(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    first_implied = implied(first)
    second_implied = implied(second)
    return first_implied / (first_implied + second_implied)


def empty_state() -> dict[str, Any]:
    return {
        "offense": {half: 0.0 for half in HALF_LIVES},
        "defense": {half: 0.0 for half in HALF_LIVES},
        "ats": {half: 0.0 for half in HALF_LIVES},
        "total": {half: 0.0 for half in HALF_LIVES},
        "games": 0,
    }


def add_market_error_state(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    ordered = frame.sort_values(["season", "week", "gameday", "game_id"]).reset_index(drop=True)
    states: dict[str, dict[str, Any]] = {}
    snapshots: list[dict[str, Any]] = []
    alphas = {half: 1.0 - math.pow(2.0, -1.0 / half) for half in HALF_LIVES}

    def state(team: str) -> dict[str, Any]:
        if team not in states:
            states[team] = empty_state()
        return states[team]

    for (_, _), games in ordered.groupby(["season", "week"], sort=True):
        updates: list[tuple[str, dict[str, float]]] = []
        for row_index, game in games.iterrows():
            home = state(str(game["home_team"]))
            away = state(str(game["away_team"]))
            snapshot: dict[str, Any] = {
                "row_index": row_index,
                "home_state_games": home["games"],
                "away_state_games": away["games"],
            }
            for half in HALF_LIVES:
                home_score = (home["offense"][half] + away["defense"][half]) / 2.0
                away_score = (away["offense"][half] + home["defense"][half]) / 2.0
                snapshot[f"home_score_state_{half}"] = home_score
                snapshot[f"away_score_state_{half}"] = away_score
                snapshot[f"margin_state_{half}"] = home_score - away_score
                snapshot[f"total_state_{half}"] = home_score + away_score
                snapshot[f"ats_state_{half}"] = (
                    home["ats"][half] - away["ats"][half]
                ) / 2.0
                snapshot[f"game_total_state_{half}"] = (
                    home["total"][half] + away["total"][half]
                ) / 2.0
            snapshots.append(snapshot)

            market_margin = float(game["market_home_margin"])
            market_total = float(game["market_total"])
            implied_home = (market_total + market_margin) / 2.0
            implied_away = (market_total - market_margin) / 2.0
            margin_residual = float(game["actual_margin"]) - market_margin
            total_residual = float(game["actual_total"]) - market_total
            updates.extend([
                (str(game["home_team"]), {
                    "offense": float(game["home_score"]) - implied_home,
                    "defense": float(game["away_score"]) - implied_away,
                    "ats": margin_residual,
                    "total": total_residual,
                }),
                (str(game["away_team"]), {
                    "offense": float(game["away_score"]) - implied_away,
                    "defense": float(game["home_score"]) - implied_home,
                    "ats": -margin_residual,
                    "total": total_residual,
                }),
            ])

        # Update only after every prediction snapshot in this NFL week exists.
        for team, values in updates:
            team_state = state(team)
            for name, value in values.items():
                for half in HALF_LIVES:
                    alpha = alphas[half]
                    team_state[name][half] = (
                        (1.0 - alpha) * team_state[name][half] + alpha * value
                    )
            team_state["games"] += 1

    state_frame = pd.DataFrame(snapshots).set_index("row_index")
    if len(state_frame) != len(ordered):
        raise RuntimeError("market-error state row mismatch")
    result = ordered.join(state_frame)
    state_features = sorted(
        column for column in result.columns
        if "_state_" in column or column in {"home_state_games", "away_state_games"}
    )
    features = [*state_features, *CORE_FEATURES]
    if len(features) != len(set(features)):
        raise RuntimeError("duplicate feature name")
    return result, features


def classifier() -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", LogisticRegression(C=MODEL_C, max_iter=500)),
    ])


def probability_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    values = np.clip(np.asarray(probability, dtype=float), 0.001, 0.999)
    target = np.asarray(outcome, dtype=int)
    return {
        "rows": int(len(target)),
        "accuracy": float(np.mean((values >= 0.5) == target)),
        "brier": float(brier_score_loss(target, values)),
        "logLoss": float(log_loss(target, values, labels=[0, 1])),
    }


def point_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "bias": float(np.mean(predicted - actual)),
    }


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def action_report(
    frame: pd.DataFrame,
    probability: np.ndarray,
    fair: np.ndarray,
    outcome: np.ndarray,
    first_price: str,
    second_price: str,
    threshold: float,
) -> dict[str, Any]:
    edge = probability - fair
    take_first = edge >= threshold
    take_second = edge <= -threshold
    selected = take_first | take_second
    rows: list[dict[str, Any]] = []
    for index in np.where(selected)[0]:
        first = bool(take_first[index])
        won = bool(outcome[index]) if first else not bool(outcome[index])
        price = float(frame.iloc[index][first_price if first else second_price])
        rows.append({
            "season": int(frame.iloc[index]["season"]),
            "first": first,
            "won": won,
            "units": profit_one(price) if won else -1.0,
        })

    def summarize(subset: list[dict[str, Any]]) -> dict[str, Any]:
        units = float(sum(row["units"] for row in subset))
        return {
            "resolved": len(subset),
            "wins": sum(bool(row["won"]) for row in subset),
            "losses": sum(not bool(row["won"]) for row in subset),
            "units": units,
            "roiPerUnitRisked": units / len(subset) if subset else None,
        }

    return {
        "minimumEdge": threshold,
        "directions": {"first": int(take_first.sum()), "second": int(take_second.sum())},
        "pooled": summarize(rows),
        "bySeason": {
            str(season): summarize([row for row in rows if row["season"] == season])
            for season in CONFIRMATION_SEASONS
        },
    }


def audit_market(
    frame: pd.DataFrame,
    features: list[str],
    market_name: str,
    target_column: str,
    line_column: str,
    first_price: str,
    second_price: str,
) -> dict[str, Any]:
    pushes = frame[target_column].eq(frame[line_column])
    outcome = frame[target_column].gt(frame[line_column]).astype(int)
    fair_all = no_vig(
        frame[first_price].to_numpy(float), frame[second_price].to_numpy(float)
    )
    train_mask = frame["season"].isin(TRAIN_SEASONS) & ~pushes
    selection_mask = frame["season"].isin(SELECTION_SEASONS) & ~pushes

    selection_model = classifier()
    selection_model.fit(frame.loc[train_mask, features], outcome.loc[train_mask])
    selection_raw = selection_model.predict_proba(frame.loc[selection_mask, features])[:, 1]
    selection_fair = fair_all[selection_mask.to_numpy()]
    selection_probability = expit(
        (1.0 - MODEL_WEIGHT) * logit(np.clip(selection_fair, 0.001, 0.999))
        + MODEL_WEIGHT * logit(np.clip(selection_raw, 0.001, 0.999))
    )
    selection_outcome = outcome.loc[selection_mask].to_numpy(int)
    selection_metrics = probability_metrics(selection_probability, selection_outcome)
    selection_by_season = {
        str(season): probability_metrics(
            selection_probability[frame.loc[selection_mask, "season"].eq(season).to_numpy()],
            selection_outcome[frame.loc[selection_mask, "season"].eq(season).to_numpy()],
        )
        for season in SELECTION_SEASONS
    }

    confirmation_train = frame["season"].between(2016, 2023) & ~pushes
    confirmation_mask = frame["season"].isin(CONFIRMATION_SEASONS) & ~pushes
    model = classifier()
    model.fit(frame.loc[confirmation_train, features], outcome.loc[confirmation_train])
    raw = model.predict_proba(frame.loc[confirmation_mask, features])[:, 1]
    fair = fair_all[confirmation_mask.to_numpy()]
    probability = expit(
        (1.0 - MODEL_WEIGHT) * logit(np.clip(fair, 0.001, 0.999))
        + MODEL_WEIGHT * logit(np.clip(raw, 0.001, 0.999))
    )
    observed = outcome.loc[confirmation_mask].to_numpy(int)
    confirmation = frame.loc[confirmation_mask].reset_index(drop=True)

    training_residual = (
        frame.loc[confirmation_train, target_column].to_numpy(float)
        - frame.loc[confirmation_train, line_column].to_numpy(float)
    )
    residual_scale = float(np.std(training_residual, ddof=1))
    point_correction = np.clip(ndtri(np.clip(probability, 0.001, 0.999)) * residual_scale, -POINT_CAP, POINT_CAP)
    market_point = confirmation[line_column].to_numpy(float)
    candidate_point = market_point + point_correction
    actual_point = confirmation[target_column].to_numpy(float)

    candidate_metrics = probability_metrics(probability, observed)
    market_metrics = probability_metrics(fair, observed)
    candidate_point_metrics = point_metrics(actual_point, candidate_point)
    market_point_metrics = point_metrics(actual_point, market_point)
    by_season: dict[str, Any] = {}
    for season in CONFIRMATION_SEASONS:
        keep = confirmation["season"].eq(season).to_numpy()
        by_season[str(season)] = {
            "candidateProbability": probability_metrics(probability[keep], observed[keep]),
            "marketProbability": probability_metrics(fair[keep], observed[keep]),
            "candidatePoint": point_metrics(actual_point[keep], candidate_point[keep]),
            "marketPoint": point_metrics(actual_point[keep], market_point[keep]),
            "directions": {
                "first": int(np.sum(probability[keep] >= 0.5)),
                "second": int(np.sum(probability[keep] < 0.5)),
            },
        }

    actions = action_report(
        confirmation, probability, fair, observed, first_price, second_price,
        ACTION_EDGES[market_name],
    )
    gates = {
        "pooledAccuracyAboveHalf": candidate_metrics["accuracy"] > 0.5,
        "eachSeasonAccuracyAtLeastHalf": all(
            row["candidateProbability"]["accuracy"] >= 0.5 for row in by_season.values()
        ),
        "pooledBrierImproves": candidate_metrics["brier"] < market_metrics["brier"],
        "seasonBrierBounded": all(
            row["candidateProbability"]["brier"]
            <= row["marketProbability"]["brier"] + 0.0025
            for row in by_season.values()
        ),
        "bothDirectionsEachSeason": all(
            row["directions"]["first"] > 0 and row["directions"]["second"] > 0
            for row in by_season.values()
        ),
        "pointMaeBounded": candidate_point_metrics["mae"] <= market_point_metrics["mae"] + 0.10,
        "atLeastThirtyActions": actions["pooled"]["resolved"] >= 30,
        "positiveActionUnits": actions["pooled"]["units"] > 0,
        "seasonActionRoiBounded": all(
            row["roiPerUnitRisked"] is not None and row["roiPerUnitRisked"] >= -0.05
            for row in actions["bySeason"].values()
        ),
        "bothActionDirections": actions["directions"]["first"] > 0 and actions["directions"]["second"] > 0,
    }
    gates["historicalConfirmationPassed"] = all(gates.values())

    return {
        "selection": {
            "metrics": selection_metrics,
            "bySeason": selection_by_season,
            "directions": {
                "first": int(np.sum(selection_probability >= 0.5)),
                "second": int(np.sum(selection_probability < 0.5)),
            },
        },
        "confirmation": {
            "candidateProbability": candidate_metrics,
            "marketProbability": market_metrics,
            "candidatePoint": candidate_point_metrics,
            "marketPoint": market_point_metrics,
            "meanAbsolutePointCorrection": float(np.mean(np.abs(point_correction))),
            "residualScale": residual_scale,
            "bySeason": by_season,
            "actions": actions,
            "gates": gates,
        },
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature artifact checksum mismatch")
    frame, features = add_market_error_state(pd.read_parquet(feature_path))
    if frame["game_id"].duplicated().any():
        raise RuntimeError("duplicate game identity")

    spread = audit_market(
        frame, features, "spread", "actual_margin", "market_home_margin",
        "home_spread_odds", "away_spread_odds",
    )
    total = audit_market(
        frame, features, "total", "actual_total", "market_total",
        "over_odds", "under_odds",
    )
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-09-21-nfl-market-error-memory-predeclaration.md",
        "localOnly": True,
        "productionBehaviorChanged": False,
        "trainingSeasons": TRAIN_SEASONS,
        "selectionSeasons": SELECTION_SEASONS,
        "confirmationSeasons": CONFIRMATION_SEASONS,
        "featureArtifactSha256": manifest["featureFileSha256"],
        "features": features,
        "spread": spread,
        "total": total,
        "launchGate": {
            "status": "historical_confirmation_only",
            "reason": "live replay, release implementation, board impact, verification, and forward evidence remain required",
        },
        "limitations": [
            "historical lines are terminal observations rather than OddSphere T-60 snapshots",
            "2024-2025 is reuse-aware confirmation because other candidate families have used those seasons",
            "locked 2026 predictions remain the genuine forward evidence",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "spread": spread,
        "total": total,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
