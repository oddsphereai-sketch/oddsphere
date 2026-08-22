#!/usr/bin/env python3
"""Tournament a leakage-safe NFL football correction to genuine opening prices.

This research writer is intentionally isolated from production. It compares a
small, frozen family of symmetry-aware football models against provider-native
DraftKings openings with chronological season folds. Candidate selection uses
2022-2023 only; 2024-2025 are confirmation seasons and never select a recipe.

The model is designed for the Daily Edge workflow: form an independent point
projection from the opening plus a football correction, then compare that fixed
projection with the live price as the market moves. Historical final weekly
availability is tested only as a near-kick overlay, never as opening-time
knowledge. Game-time weather is excluded because it is not timestamp-safe here.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

import joblib
import numpy as np
import pandas as pd
from scipy.special import logit
from sklearn.base import RegressorMixin
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import HuberRegressor, LogisticRegression, Ridge
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


TOURNAMENT_RELEASE = "nfl_opening_residual_tournament_2026_08_21_r2"
MODEL_RELEASE = "nfl_pregame_market_residual_shadow_2026_08_21_r2"
CALIBRATION_RELEASE = "nfl_pregame_residual_logit_shadow_2026_08_21_r2"
FEATURE_RELEASE = "nfl_player_value_features_2016_2025_2026_08_20_r3"
REFERENCE_RELEASE = "nfl_market_reference_core_2026_08_20_r1"

OPENING_RELEASES = {
    2021: "bdl_nfl_opening_history_2021_2026_08_20_r1",
    2022: "bdl_nfl_opening_history_2022_2026_08_20_r2",
    2023: "bdl_nfl_opening_history_2023_2026_08_20_r2",
    2024: "bdl_nfl_opening_history_2024_2026_08_20_r2",
    2025: "bdl_nfl_opening_history_2025_2026_08_20_r1",
}

TRAIN_START = 2016
OOS_SEASONS = (2022, 2023, 2024, 2025)
SELECTION_SEASONS = (2022, 2023)
CONFIRMATION_SEASONS = (2024, 2025)
PROBABILITY_SEASONS = (2023, 2024, 2025)
RANDOM_STATE = 21082026
CORRECTION_CAP = 6.0
CORRECTION_WEIGHTS = (0.25, 0.50, 0.75, 1.00)

METRICS = (
    "epa",
    "pass_epa",
    "rush_epa",
    "success",
    "early_down_pass_epa",
    "explosive_rate",
    "sack_rate",
    "turnover_rate",
    "plays",
    "redzone_td_rate",
    "no_huddle_rate",
    "pass_oe",
    "points",
)
STABLE_METRICS = (
    "epa",
    "pass_epa",
    "rush_epa",
    "success",
    "early_down_pass_epa",
    "explosive_rate",
    "sack_rate",
    "turnover_rate",
    "plays",
    "redzone_td_rate",
    "points",
)


@dataclass(frozen=True)
class Candidate:
    target_kind: str
    feature_set: str
    estimator: str
    weight: float

    @property
    def name(self) -> str:
        return f"{self.target_kind}__{self.feature_set}__{self.estimator}__w{self.weight:.2f}"


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implied(price: pd.Series | np.ndarray) -> np.ndarray:
    values = np.asarray(price, dtype=float)
    result = np.full(values.shape, np.nan, dtype=float)
    positive = values > 0
    negative = values < 0
    result[positive] = 100.0 / (values[positive] + 100.0)
    result[negative] = -values[negative] / (-values[negative] + 100.0)
    return result


def no_vig(first: pd.Series | np.ndarray, second: pd.Series | np.ndarray) -> np.ndarray:
    a = implied(first)
    b = implied(second)
    denominator = a + b
    return np.divide(a, denominator, out=np.full(a.shape, np.nan), where=denominator > 0)


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def load_features(root: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r3.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if not feature_path.is_absolute():
        feature_path = root / feature_path
    elif not feature_path.exists():
        feature_path = root / "football-research/cache/nfl-model" / feature_path.name
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("NFL feature release mismatch")
    if sha256_file(feature_path) != manifest.get("featureFileSha256"):
        raise RuntimeError("NFL feature checksum mismatch")
    frame = pd.read_parquet(feature_path).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    return frame, manifest


def load_openings(root: pathlib.Path, features: pd.DataFrame) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    base = features.copy()
    base["homeJoin"] = base["home_team"].replace({"LA": "LAR", "WAS": "WSH"})
    base["awayJoin"] = base["away_team"].replace({"LA": "LAR", "WAS": "WSH"})
    joined: list[pd.DataFrame] = []
    evidence: list[dict[str, Any]] = []
    for season, release in OPENING_RELEASES.items():
        manifest_path = root / "football-research/cache/nfl-market" / f"{release}.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        data_path = pathlib.Path(manifest["dataFile"])
        if not data_path.is_absolute():
            data_path = root / data_path
        elif not data_path.exists():
            data_path = root / "football-research/cache/nfl-market" / data_path.name
        if manifest.get("cacheRelease") != release or sha256_file(data_path) != manifest.get("dataSha256"):
            raise RuntimeError(f"opening cache mismatch: {release}")
        payload = json.loads(data_path.read_text(encoding="utf-8"))
        games = pd.DataFrame(payload["games"])
        odds = pd.DataFrame(payload["openings"])
        odds = odds[odds["vendor"].eq("draftkings")].copy()
        provider = games.merge(odds, on="gameId", validate="one_to_one")
        rows = provider.merge(
            base[base["season"].eq(season)],
            left_on=["season", "homeTeam", "awayTeam"],
            right_on=["season", "homeJoin", "awayJoin"],
            validate="one_to_one",
        )
        # Provider and feature rows both carry a week. The joined feature week
        # is authoritative for modeling and must agree with the provider week.
        if "week_x" in rows and "week_y" in rows:
            if not rows["week_x"].astype(int).equals(rows["week_y"].astype(int)):
                raise RuntimeError(f"opening/feature week mismatch: {release}")
            rows["week"] = rows["week_y"].astype(int)
        joined.append(rows)
        evidence.append({
            "season": season,
            "release": release,
            "sha256": manifest["dataSha256"],
            "rows": int(len(rows)),
            "openedAtMin": str(rows["openedAt"].min()),
            "openedAtMax": str(rows["openedAt"].max()),
        })
    result = pd.concat(joined, ignore_index=True).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    result["opening_home_margin"] = -pd.to_numeric(result["spreadHomeLine"], errors="coerce")
    result["opening_total"] = pd.to_numeric(result["totalLine"], errors="coerce")
    result["opening_home_ml_fair"] = no_vig(result["moneylineHome"], result["moneylineAway"])
    result["opening_home_spread_fair"] = no_vig(result["spreadHomePrice"], result["spreadAwayPrice"])
    result["opening_over_fair"] = no_vig(result["totalOverPrice"], result["totalUnderPrice"])
    result["terminal_home_ml_fair"] = no_vig(result["home_moneyline"], result["away_moneyline"])
    return result, evidence


def add_pair_features(frame: pd.DataFrame, output: pd.DataFrame, metric: str) -> None:
    for speed in ("fast", "slow"):
        home_matchup = pd.to_numeric(frame[f"home_matchup_{speed}_{metric}"], errors="coerce")
        away_matchup = pd.to_numeric(frame[f"away_matchup_{speed}_{metric}"], errors="coerce")
        output[f"matchup_{speed}_{metric}_diff"] = home_matchup - away_matchup
        output[f"matchup_{speed}_{metric}_sum"] = home_matchup + away_matchup
    home_off = pd.to_numeric(frame[f"home_off_adj_{metric}"], errors="coerce")
    away_off = pd.to_numeric(frame[f"away_off_adj_{metric}"], errors="coerce")
    home_def = pd.to_numeric(frame[f"home_def_adj_{metric}"], errors="coerce")
    away_def = pd.to_numeric(frame[f"away_def_adj_{metric}"], errors="coerce")
    output[f"off_adj_{metric}_diff"] = home_off - away_off
    output[f"off_adj_{metric}_sum"] = home_off + away_off
    output[f"def_adj_{metric}_home_adv"] = away_def - home_def
    output[f"def_adj_{metric}_sum"] = home_def + away_def


def engineer(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, dict[str, list[str]]]]:
    x = pd.DataFrame(index=frame.index)
    x["week"] = pd.to_numeric(frame["week"], errors="coerce")
    x["week_sin"] = np.sin(2.0 * math.pi * x["week"] / 18.0)
    x["week_cos"] = np.cos(2.0 * math.pi * x["week"] / 18.0)
    for column in ("neutral_site", "division_game", "rest_diff", "elo_diff"):
        x[column] = pd.to_numeric(frame[column], errors="coerce")
    x["home_rest"] = pd.to_numeric(frame["home_rest"], errors="coerce")
    x["away_rest"] = pd.to_numeric(frame["away_rest"], errors="coerce")
    x["home_qb_epa_diff"] = pd.to_numeric(frame["home_qb_epa"], errors="coerce") - pd.to_numeric(frame["away_qb_epa"], errors="coerce")
    x["home_qb_cpoe_diff"] = pd.to_numeric(frame["home_qb_cpoe"], errors="coerce") - pd.to_numeric(frame["away_qb_cpoe"], errors="coerce")
    x["home_qb_sack_adv"] = pd.to_numeric(frame["away_qb_sack_rate"], errors="coerce") - pd.to_numeric(frame["home_qb_sack_rate"], errors="coerce")
    x["home_qb_turnover_adv"] = pd.to_numeric(frame["away_qb_turnover_rate"], errors="coerce") - pd.to_numeric(frame["home_qb_turnover_rate"], errors="coerce")
    x["qb_epa_sum"] = pd.to_numeric(frame["home_qb_epa"], errors="coerce") + pd.to_numeric(frame["away_qb_epa"], errors="coerce")
    x["qb_cpoe_sum"] = pd.to_numeric(frame["home_qb_cpoe"], errors="coerce") + pd.to_numeric(frame["away_qb_cpoe"], errors="coerce")
    x["qb_experience_diff"] = pd.to_numeric(frame["home_qb_log_dropbacks"], errors="coerce") - pd.to_numeric(frame["away_qb_log_dropbacks"], errors="coerce")
    x["qb_experience_sum"] = pd.to_numeric(frame["home_qb_log_dropbacks"], errors="coerce") + pd.to_numeric(frame["away_qb_log_dropbacks"], errors="coerce")
    x["qb_continuity_diff"] = pd.to_numeric(frame["home_qb_same_as_last_start"], errors="coerce") - pd.to_numeric(frame["away_qb_same_as_last_start"], errors="coerce")
    x["qb_continuity_sum"] = pd.to_numeric(frame["home_qb_same_as_last_start"], errors="coerce") + pd.to_numeric(frame["away_qb_same_as_last_start"], errors="coerce")
    x["coach_continuity_diff"] = pd.to_numeric(frame["home_coach_continuity"], errors="coerce") - pd.to_numeric(frame["away_coach_continuity"], errors="coerce")
    x["coach_continuity_sum"] = pd.to_numeric(frame["home_coach_continuity"], errors="coerce") + pd.to_numeric(frame["away_coach_continuity"], errors="coerce")
    x["roster_continuity_diff"] = pd.to_numeric(frame["home_roster_continuity"], errors="coerce") - pd.to_numeric(frame["away_roster_continuity"], errors="coerce")
    x["roster_continuity_sum"] = pd.to_numeric(frame["home_roster_continuity"], errors="coerce") + pd.to_numeric(frame["away_roster_continuity"], errors="coerce")

    for metric in METRICS:
        add_pair_features(frame, x, metric)

    for column in frame.columns:
        if column.startswith("pv_") and (column.endswith("_diff") or column.endswith("_sum")):
            x[column] = pd.to_numeric(frame[column], errors="coerce")

    margin_context = [
        "week_sin", "week_cos", "neutral_site", "division_game", "rest_diff", "elo_diff",
        "home_qb_epa_diff", "home_qb_cpoe_diff", "home_qb_sack_adv", "home_qb_turnover_adv",
        "qb_experience_diff", "qb_continuity_diff", "coach_continuity_diff", "roster_continuity_diff",
    ]
    total_context = [
        "week_sin", "week_cos", "neutral_site", "division_game", "home_rest", "away_rest",
        "qb_epa_sum", "qb_cpoe_sum", "qb_experience_sum", "qb_continuity_sum",
        "coach_continuity_sum", "roster_continuity_sum",
    ]
    stable_margin = margin_context + [
        name
        for metric in STABLE_METRICS
        for name in (
            f"matchup_slow_{metric}_diff",
            f"off_adj_{metric}_diff",
            f"def_adj_{metric}_home_adv",
        )
    ]
    stable_total = total_context + [
        name
        for metric in STABLE_METRICS
        for name in (
            f"matchup_slow_{metric}_sum",
            f"off_adj_{metric}_sum",
            f"def_adj_{metric}_sum",
        )
    ]
    multiscale_margin = margin_context + [
        name
        for metric in METRICS
        for name in (
            f"matchup_fast_{metric}_diff",
            f"matchup_slow_{metric}_diff",
            f"off_adj_{metric}_diff",
            f"def_adj_{metric}_home_adv",
        )
    ]
    multiscale_total = total_context + [
        name
        for metric in METRICS
        for name in (
            f"matchup_fast_{metric}_sum",
            f"matchup_slow_{metric}_sum",
            f"off_adj_{metric}_sum",
            f"def_adj_{metric}_sum",
        )
    ]
    pv_margin = [column for column in x if column.startswith("pv_") and column.endswith("_diff")]
    pv_total = [column for column in x if column.startswith("pv_") and column.endswith("_sum")]
    sets = {
        "margin": {
            "stable": sorted(set(stable_margin)),
            "multiscale": sorted(set(multiscale_margin)),
            "multiscale_player": sorted(set(multiscale_margin + pv_margin)),
        },
        "total": {
            "stable": sorted(set(stable_total)),
            "multiscale": sorted(set(multiscale_total)),
            "multiscale_player": sorted(set(multiscale_total + pv_total)),
        },
    }
    return x, sets


def estimator_factories() -> dict[str, Callable[[], RegressorMixin]]:
    def ridge(alpha: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", Ridge(alpha=alpha)),
        ])

    def huber(alpha: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", HuberRegressor(epsilon=1.35, alpha=alpha, max_iter=1000)),
        ])

    def hist(l2: float, leaf: int) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=False)),
            ("model", HistGradientBoostingRegressor(
                loss="absolute_error",
                learning_rate=0.035,
                max_iter=220,
                max_leaf_nodes=7,
                min_samples_leaf=leaf,
                l2_regularization=l2,
                random_state=RANDOM_STATE,
            )),
        ])

    return {
        "ridge_100": lambda: ridge(100.0),
        "ridge_300": lambda: ridge(300.0),
        "ridge_1000": lambda: ridge(1000.0),
        "huber_1": lambda: huber(1.0),
        "huber_10": lambda: huber(10.0),
        "hist_l20": lambda: hist(20.0, 30),
        "hist_l50": lambda: hist(50.0, 50),
    }


def fit_candidate(
    candidate: Candidate,
    train: pd.DataFrame,
    train_x: pd.DataFrame,
    test: pd.DataFrame,
    test_x: pd.DataFrame,
    features: list[str],
    target_column: str,
    baseline_column: str,
) -> tuple[np.ndarray, RegressorMixin]:
    model = estimator_factories()[candidate.estimator]()
    actual = train[target_column].to_numpy(float)
    baseline = train[baseline_column].to_numpy(float)
    target = actual - baseline if candidate.target_kind == "residual" else actual
    model.fit(train_x[features], target)
    raw = np.asarray(model.predict(test_x[features]), dtype=float)
    if candidate.target_kind == "residual":
        correction = np.clip(raw, -CORRECTION_CAP, CORRECTION_CAP)
    else:
        correction = np.clip(raw - test[baseline_column].to_numpy(float), -CORRECTION_CAP, CORRECTION_CAP)
    prediction = test[baseline_column].to_numpy(float) + candidate.weight * correction
    return prediction, model


def point_metrics(actual: np.ndarray, prediction: np.ndarray, baseline: np.ndarray) -> dict[str, Any]:
    y = np.asarray(actual, dtype=float)
    p = np.asarray(prediction, dtype=float)
    b = np.asarray(baseline, dtype=float)
    return {
        "rows": int(len(y)),
        "candidateMae": float(mean_absolute_error(y, p)),
        "baselineMae": float(mean_absolute_error(y, b)),
        "maeImprovement": float(mean_absolute_error(y, b) - mean_absolute_error(y, p)),
        "candidateRmse": float(math.sqrt(mean_squared_error(y, p))),
        "baselineRmse": float(math.sqrt(mean_squared_error(y, b))),
        "meanAbsoluteCorrection": float(np.mean(np.abs(p - b))),
        "bias": float(np.mean(p - y)),
    }


def candidate_grid(sets: dict[str, list[str]]) -> list[Candidate]:
    candidates = [Candidate("residual", "zero", "zero", 0.0)]
    for feature_set in sets:
        for estimator in estimator_factories():
            for weight in CORRECTION_WEIGHTS:
                candidates.append(Candidate("residual", feature_set, estimator, weight))
        for estimator in ("ridge_100", "ridge_300", "ridge_1000", "huber_10"):
            for weight in (0.25, 0.50):
                candidates.append(Candidate("independent", feature_set, estimator, weight))
    return candidates


def expanding_predictions(
    openings: pd.DataFrame,
    x: pd.DataFrame,
    sets: dict[str, list[str]],
    target_column: str,
    baseline_column: str,
) -> tuple[dict[str, pd.DataFrame], dict[str, dict[int, RegressorMixin]]]:
    predictions: dict[str, list[pd.DataFrame]] = {candidate.name: [] for candidate in candidate_grid(sets)}
    fitted: dict[str, dict[int, RegressorMixin]] = {candidate.name: {} for candidate in candidate_grid(sets)}
    valid = openings[target_column].notna() & openings[baseline_column].notna()
    for season in OOS_SEASONS:
        train_mask = openings["season"].lt(season) & valid
        test_mask = openings["season"].eq(season) & valid
        train = openings.loc[train_mask]
        test = openings.loc[test_mask]
        if len(train) < 250 or test.empty:
            raise RuntimeError(f"insufficient opening chronology for {season}: train={len(train)} test={len(test)}")
        for candidate in candidate_grid(sets):
            if candidate.feature_set == "zero":
                prediction = test[baseline_column].to_numpy(float)
            else:
                prediction, model = fit_candidate(
                    candidate,
                    train,
                    x.loc[train_mask],
                    test,
                    x.loc[test_mask],
                    sets[candidate.feature_set],
                    target_column,
                    baseline_column,
                )
                fitted[candidate.name][season] = model
            predictions[candidate.name].append(pd.DataFrame({
                "row": test.index.to_numpy(int),
                "season": season,
                "prediction": prediction,
            }))
    return {name: pd.concat(parts, ignore_index=True) for name, parts in predictions.items()}, fitted


def select_candidate(
    openings: pd.DataFrame,
    predictions: dict[str, pd.DataFrame],
    target_column: str,
    baseline_column: str,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    ranking: list[dict[str, Any]] = []
    for name, values in predictions.items():
        joined = values.join(openings[[target_column, baseline_column]], on="row")
        selection = joined[joined["season"].isin(SELECTION_SEASONS)]
        pooled = point_metrics(
            selection[target_column].to_numpy(float),
            selection["prediction"].to_numpy(float),
            selection[baseline_column].to_numpy(float),
        )
        by_season = {
            str(season): point_metrics(
                season_rows[target_column].to_numpy(float),
                season_rows["prediction"].to_numpy(float),
                season_rows[baseline_column].to_numpy(float),
            )
            for season in SELECTION_SEASONS
            for season_rows in [selection[selection["season"].eq(season)]]
        }
        worst_delta = max(-values["maeImprovement"] for values in by_season.values())
        stability_penalty = max(0.0, worst_delta) * 1.5
        ranking.append({"candidate": name, "score": pooled["candidateMae"] + stability_penalty, "pooled": pooled, "bySeason": by_season})
    ranking.sort(key=lambda item: (item["score"], item["pooled"]["candidateRmse"], item["candidate"]))
    best = ranking[0]
    selected_name = best["candidate"] if best["pooled"]["maeImprovement"] > 0 else "residual__zero__zero__w0.00"
    selected = next(item for item in ranking if item["candidate"] == selected_name)
    return selected_name, ranking[:20], selected


def evaluate_period(
    openings: pd.DataFrame,
    values: pd.DataFrame,
    target_column: str,
    baseline_column: str,
    seasons: tuple[int, ...],
) -> dict[str, Any]:
    joined = values.join(openings[[target_column, baseline_column]], on="row")
    rows = joined[joined["season"].isin(seasons)]
    return {
        "pooled": point_metrics(
            rows[target_column].to_numpy(float), rows["prediction"].to_numpy(float), rows[baseline_column].to_numpy(float)
        ),
        "bySeason": {
            str(season): point_metrics(
                season_rows[target_column].to_numpy(float),
                season_rows["prediction"].to_numpy(float),
                season_rows[baseline_column].to_numpy(float),
            )
            for season in seasons
            for season_rows in [rows[rows["season"].eq(season)]]
        },
    }


def probability_metrics(outcome: np.ndarray, probability: np.ndarray, push: np.ndarray | None = None) -> dict[str, Any]:
    y = np.asarray(outcome, dtype=int)
    p = np.asarray(probability, dtype=float)
    keep = np.isfinite(p)
    if push is not None:
        keep &= ~np.asarray(push, dtype=bool)
    y = y[keep]
    p = np.clip(p[keep], 0.001, 0.999)
    bins = np.minimum(9, np.floor(p * 10).astype(int))
    ece = 0.0
    for index in range(10):
        mask = bins == index
        if mask.any():
            ece += float(mask.mean()) * abs(float(p[mask].mean()) - float(y[mask].mean()))
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
        "ece10": ece,
        "meanProbability": float(p.mean()),
        "outcomeRate": float(y.mean()),
    }


def market_definition(
    frame: pd.DataFrame,
    market: str,
    projection: np.ndarray,
    price_stage: str,
) -> dict[str, np.ndarray]:
    if price_stage not in {"opening", "terminal"}:
        raise ValueError(f"unsupported price stage {price_stage}")
    if market == "moneyline":
        return {
            "market": frame[
                "opening_home_ml_fair" if price_stage == "opening" else "terminal_home_ml_fair"
            ].to_numpy(float),
            "edge": projection,
            "outcome": frame["actual_margin"].gt(0).to_numpy(int),
            "push": frame["actual_margin"].eq(0).to_numpy(bool),
            "firstPrice": frame[
                "moneylineHome" if price_stage == "opening" else "home_moneyline"
            ].to_numpy(float),
            "secondPrice": frame[
                "moneylineAway" if price_stage == "opening" else "away_moneyline"
            ].to_numpy(float),
        }
    if market == "spread":
        line = frame[
            "opening_home_margin" if price_stage == "opening" else "market_home_margin"
        ].to_numpy(float)
        return {
            "market": (
                frame["opening_home_spread_fair"].to_numpy(float)
                if price_stage == "opening"
                else no_vig(frame["home_spread_odds"], frame["away_spread_odds"])
            ),
            "edge": projection - line,
            "outcome": frame["actual_margin"].to_numpy(float) > line,
            "push": frame["actual_margin"].to_numpy(float) == line,
            "firstPrice": frame[
                "spreadHomePrice" if price_stage == "opening" else "home_spread_odds"
            ].to_numpy(float),
            "secondPrice": frame[
                "spreadAwayPrice" if price_stage == "opening" else "away_spread_odds"
            ].to_numpy(float),
        }
    line = frame["opening_total" if price_stage == "opening" else "market_total"].to_numpy(float)
    return {
        "market": (
            frame["opening_over_fair"].to_numpy(float)
            if price_stage == "opening"
            else no_vig(frame["over_odds"], frame["under_odds"])
        ),
        "edge": projection - line,
        "outcome": frame["actual_total"].to_numpy(float) > line,
        "push": frame["actual_total"].to_numpy(float) == line,
        "firstPrice": frame[
            "totalOverPrice" if price_stage == "opening" else "over_odds"
        ].to_numpy(float),
        "secondPrice": frame[
            "totalUnderPrice" if price_stage == "opening" else "under_odds"
        ].to_numpy(float),
    }


def probability_features(definition: dict[str, np.ndarray], positions: np.ndarray) -> np.ndarray:
    market = np.clip(definition["market"][positions], 0.01, 0.99)
    edge = definition["edge"][positions]
    return np.column_stack([logit(market), edge / 7.0, np.sign(edge) * np.sqrt(np.abs(edge)) / math.sqrt(7.0)])


def chronological_probabilities(
    openings: pd.DataFrame,
    margin_values: pd.DataFrame,
    total_values: pd.DataFrame,
    *,
    price_stage: str,
    identity_markets: set[str] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    identity_markets = identity_markets or set()
    margin_map = margin_values.set_index("row")["prediction"]
    total_map = total_values.set_index("row")["prediction"]
    eligible = openings[openings["season"].isin(OOS_SEASONS)].copy()
    eligible["row"] = eligible.index
    eligible["margin_projection"] = eligible["row"].map(margin_map)
    eligible["total_projection"] = eligible["row"].map(total_map)
    eligible = eligible.dropna(subset=["margin_projection", "total_projection"]).copy()
    output = eligible[["row", "season", "week"]].copy()
    reports: dict[str, Any] = {}
    for market, projection_column in (
        ("moneyline", "margin_projection"),
        ("spread", "margin_projection"),
        ("total", "total_projection"),
    ):
        definition = market_definition(
            eligible,
            market,
            eligible[projection_column].to_numpy(float),
            price_stage,
        )
        if market in identity_markets:
            probabilities = definition["market"].copy()
        else:
            probabilities = np.full(len(eligible), np.nan, dtype=float)
            for season in PROBABILITY_SEASONS:
                train_positions = np.where(eligible["season"].lt(season).to_numpy(bool) & ~definition["push"])[0]
                test_positions = np.where(eligible["season"].eq(season).to_numpy(bool))[0]
                if len(train_positions) < 200:
                    raise RuntimeError(f"insufficient probability calibration rows for {market} {season}")
                model = LogisticRegression(C=0.10, solver="lbfgs", max_iter=1000, random_state=RANDOM_STATE)
                model.fit(probability_features(definition, train_positions), definition["outcome"][train_positions].astype(int))
                probabilities[test_positions] = model.predict_proba(probability_features(definition, test_positions))[:, 1]
        output[f"{market}_probability"] = probabilities
        output[f"{market}_market"] = definition["market"]
        output[f"{market}_outcome"] = definition["outcome"].astype(int)
        output[f"{market}_push"] = definition["push"].astype(bool)
        output[f"{market}_first_price"] = definition["firstPrice"]
        output[f"{market}_second_price"] = definition["secondPrice"]
        market_reports: dict[str, Any] = {}
        for season_group, seasons in (("selection", (2023,)), ("confirmation", CONFIRMATION_SEASONS)):
            mask = output["season"].isin(seasons).to_numpy(bool)
            market_reports[season_group] = {
                "candidate": probability_metrics(definition["outcome"][mask], probabilities[mask], definition["push"][mask]),
                "market": probability_metrics(definition["outcome"][mask], definition["market"][mask], definition["push"][mask]),
            }
        market_reports["confirmationBySeason"] = {
            str(season): {
                "candidate": probability_metrics(
                    definition["outcome"][mask], probabilities[mask], definition["push"][mask]
                ),
                "market": probability_metrics(
                    definition["outcome"][mask], definition["market"][mask], definition["push"][mask]
                ),
            }
            for season in CONFIRMATION_SEASONS
            for mask in [output["season"].eq(season).to_numpy(bool)]
        }
        reports[market] = market_reports
    return output, reports


def clv_for_row(openings: pd.DataFrame, row_index: int, market: str, first: bool) -> float:
    row = openings.loc[row_index]
    if market == "moneyline":
        movement = float(row["terminal_home_ml_fair"] - row["opening_home_ml_fair"])
    elif market == "spread":
        terminal_home_line = -float(row["market_home_margin"])
        movement = float(row["spreadHomeLine"] - terminal_home_line)
    else:
        movement = float(row["market_total"] - row["opening_total"])
    return movement if first else -movement


def decision_rows(openings: pd.DataFrame, probabilities: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for record in probabilities.itertuples(index=False):
        if int(record.season) not in PROBABILITY_SEASONS:
            continue
        for market in ("moneyline", "spread", "total"):
            probability = float(getattr(record, f"{market}_probability"))
            if not math.isfinite(probability):
                continue
            first_price = float(getattr(record, f"{market}_first_price"))
            second_price = float(getattr(record, f"{market}_second_price"))
            first_ev = probability * profit_one(first_price) - (1.0 - probability)
            second_ev = (1.0 - probability) * profit_one(second_price) - probability
            first = first_ev >= second_ev
            push = bool(getattr(record, f"{market}_push"))
            first_won = bool(getattr(record, f"{market}_outcome"))
            price = first_price if first else second_price
            won = first_won if first else not first_won
            rows.append({
                "row": int(record.row),
                "season": int(record.season),
                "week": int(record.week),
                "market": market,
                "first": first,
                "probability": probability if first else 1.0 - probability,
                "marketProbability": float(getattr(record, f"{market}_market")) if first else 1.0 - float(getattr(record, f"{market}_market")),
                "price": price,
                "expectedValue": first_ev if first else second_ev,
                "edgePp": 100.0 * ((probability - float(getattr(record, f"{market}_market"))) if first else (float(getattr(record, f"{market}_market")) - probability)),
                "won": won,
                "push": push,
                "units": 0.0 if push else profit_one(price) if won else -1.0,
                "clv": clv_for_row(openings, int(record.row), market, first),
            })
    return pd.DataFrame(rows)


def policy_result(
    rows: pd.DataFrame,
    seasons: tuple[int, ...],
    minimum_ev: float,
    max_actions: int,
    allowed_markets: tuple[str, ...],
) -> dict[str, Any]:
    period = rows[rows["season"].isin(seasons) & rows["market"].isin(allowed_markets)].copy()
    eligible = period[period["expectedValue"].ge(minimum_ev)]
    selected = (
        eligible.sort_values(["season", "week", "expectedValue"], ascending=[True, True, False])
        .groupby(["season", "week"], sort=True, as_index=False)
        .head(max_actions)
    )
    scheduled_weeks = period[["season", "week"]].drop_duplicates()
    selected_weeks = selected[["season", "week"]].drop_duplicates()
    resolved = selected[~selected["push"]]
    units = float(selected["units"].sum())
    return {
        "seasons": list(seasons),
        "minimumExpectedValue": minimum_ev,
        "maximumActionsPerWeek": max_actions,
        "allowedMarkets": list(allowed_markets),
        "actions": int(len(selected)),
        "wins": int(resolved["won"].sum()),
        "losses": int((~resolved["won"]).sum()),
        "pushes": int(selected["push"].sum()),
        "units": units,
        "roi": units / len(selected) if len(selected) else None,
        "meanClv": float(selected["clv"].mean()) if len(selected) else None,
        "positiveClvRate": float(selected["clv"].gt(0).mean()) if len(selected) else None,
        "weeks": int(len(scheduled_weeks)),
        "weeksWithAction": int(len(selected_weeks)),
        "weeklyCoverage": float(len(selected_weeks) / len(scheduled_weeks)) if len(scheduled_weeks) else None,
        "marketMix": {str(key): int(value) for key, value in selected["market"].value_counts().sort_index().items()},
    }


def select_policy(
    rows: pd.DataFrame,
    allowed_markets: tuple[str, ...],
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], dict[str, Any] | None]:
    candidates: list[dict[str, Any]] = []
    for minimum_ev in (0.01, 0.02, 0.03, 0.04, 0.05):
        for max_actions in (1, 2, 3):
            result = policy_result(rows, (2023,), minimum_ev, max_actions, allowed_markets)
            candidates.append(result)
    eligible = [
        result for result in candidates
        if result["actions"] >= 12
        and result["units"] > 0
        and result["meanClv"] is not None
        and result["meanClv"] > 0
    ]
    if not eligible:
        return None, candidates, None
    eligible.sort(key=lambda item: (-item["units"], -item["meanClv"], item["actions"]))
    selected = eligible[0]
    confirmation = policy_result(
        rows,
        CONFIRMATION_SEASONS,
        float(selected["minimumExpectedValue"]),
        int(selected["maximumActionsPerWeek"]),
        allowed_markets,
    )
    return selected, candidates, confirmation


def final_fit(
    openings: pd.DataFrame,
    x: pd.DataFrame,
    sets: dict[str, list[str]],
    selected_name: str,
    target_column: str,
    baseline_column: str,
) -> dict[str, Any]:
    candidate = next(item for item in candidate_grid(sets) if item.name == selected_name)
    if candidate.feature_set == "zero":
        return {"candidate": asdict(candidate), "featureNames": [], "model": None}
    valid = openings[target_column].notna() & openings[baseline_column].notna()
    train = openings.loc[valid]
    train_x = x.loc[valid]
    prediction, model = fit_candidate(
        candidate,
        train,
        train_x,
        train,
        train_x,
        sets[candidate.feature_set],
        target_column,
        baseline_column,
    )
    return {
        "candidate": asdict(candidate),
        "featureNames": sets[candidate.feature_set],
        "model": model,
        "trainingRows": int(len(train)),
        "meanAbsoluteCorrection": float(np.mean(np.abs(prediction - train[baseline_column].to_numpy(float)))),
    }


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get("NFL_RESEARCH_SOURCE_ROOT", str(root))).resolve()
    features, feature_manifest = load_features(source_root)
    openings, opening_evidence = load_openings(source_root, features)
    x, feature_sets = engineer(openings)

    margin_predictions, _ = expanding_predictions(
        openings, x, feature_sets["margin"], "actual_margin", "opening_home_margin"
    )
    total_predictions, _ = expanding_predictions(
        openings, x, feature_sets["total"], "actual_total", "opening_total"
    )
    margin_name, margin_ranking, margin_selection = select_candidate(
        openings, margin_predictions, "actual_margin", "opening_home_margin"
    )
    total_name, total_ranking, total_selection = select_candidate(
        openings, total_predictions, "actual_total", "opening_total"
    )
    margin_evaluation = {
        "selection": evaluate_period(openings, margin_predictions[margin_name], "actual_margin", "opening_home_margin", SELECTION_SEASONS),
        "confirmation": evaluate_period(openings, margin_predictions[margin_name], "actual_margin", "opening_home_margin", CONFIRMATION_SEASONS),
    }
    total_evaluation = {
        "selection": evaluate_period(openings, total_predictions[total_name], "actual_total", "opening_total", SELECTION_SEASONS),
        "confirmation": evaluate_period(openings, total_predictions[total_name], "actual_total", "opening_total", CONFIRMATION_SEASONS),
    }

    margin_target_gate = bool(
        margin_evaluation["confirmation"]["pooled"]["maeImprovement"] > 0
        and all(
            values["maeImprovement"] >= 0
            for values in margin_evaluation["confirmation"]["bySeason"].values()
        )
    )
    total_target_gate = bool(
        total_evaluation["confirmation"]["pooled"]["maeImprovement"] > 0
        and all(
            values["maeImprovement"] >= 0
            for values in total_evaluation["confirmation"]["bySeason"].values()
        )
    )
    zero_candidate = "residual__zero__zero__w0.00"
    effective_margin_name = margin_name if margin_target_gate else zero_candidate
    effective_total_name = total_name if total_target_gate else zero_candidate

    opening_probabilities, opening_probability_report = chronological_probabilities(
        openings,
        margin_predictions[effective_margin_name],
        total_predictions[effective_total_name],
        price_stage="opening",
        identity_markets={"total"} if not total_target_gate else set(),
    )
    terminal_probabilities, terminal_probability_report = chronological_probabilities(
        openings,
        margin_predictions[effective_margin_name],
        total_predictions[effective_total_name],
        price_stage="terminal",
        identity_markets={"total"} if not total_target_gate else set(),
    )
    opening_decisions = decision_rows(openings, opening_probabilities)
    terminal_decisions = decision_rows(openings, terminal_probabilities)
    opening_policy, opening_policy_candidates, opening_policy_confirmation = select_policy(
        opening_decisions, ("moneyline", "spread")
    )
    terminal_policy, terminal_policy_candidates, terminal_policy_confirmation = select_policy(
        terminal_decisions, ("moneyline", "spread")
    )

    point_gate = margin_target_gate or total_target_gate
    probability_gate = all(
        values["confirmation"]["candidate"]["brier"] <= values["confirmation"]["market"]["brier"]
        for report in (opening_probability_report, terminal_probability_report)
        for values in report.values()
    )
    policy_gate = bool(
        terminal_policy
        and terminal_policy_confirmation
        and terminal_policy_confirmation["units"] > 0
        and terminal_policy_confirmation["meanClv"] is not None
        and terminal_policy_confirmation["meanClv"] > 0
        and terminal_policy_confirmation["weeklyCoverage"] >= 0.5
    )

    artifact = {
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "referenceRelease": REFERENCE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "margin": final_fit(
            openings, x, feature_sets["margin"], effective_margin_name, "actual_margin", "opening_home_margin"
        ),
        "total": final_fit(
            openings, x, feature_sets["total"], effective_total_name, "actual_total", "opening_total"
        ),
    }
    artifact_root = root / "football-research/cache/nfl-model"
    artifact_root.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_root / f"{MODEL_RELEASE}.joblib"
    joblib.dump(artifact, artifact_path)

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "referenceRelease": REFERENCE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "productionBehaviorChanged": False,
        "officialTrackingChanged": False,
        "actionableGradesAuthorized": False,
        "preseasonIncluded": False,
        "chronology": {
            "trainingStarts": TRAIN_START,
            "oosSeasons": list(OOS_SEASONS),
            "selectionSeasons": list(SELECTION_SEASONS),
            "confirmationSeasons": list(CONFIRMATION_SEASONS),
            "warning": "2025 has been inspected by earlier NFL work and is historical confirmation, not a pristine future holdout.",
        },
        "data": {
            "featureSha256": feature_manifest["featureFileSha256"],
            "openingEvidence": opening_evidence,
            "rows": int(len(openings)),
            "vendor": "draftkings",
            "finalWeeklyPlayerAvailabilityIncluded": True,
            "playerAvailabilityUse": "near-kick overlay only",
            "gameTimeWeatherExcluded": True,
        },
        "margin": {
            "selectedCandidate": margin_name,
            "effectiveCandidate": effective_margin_name,
            "targetGate": margin_target_gate,
            "selectionDecision": margin_selection,
            "topSelectionCandidates": margin_ranking,
            "evaluation": margin_evaluation,
        },
        "total": {
            "selectedCandidate": total_name,
            "effectiveCandidate": effective_total_name,
            "targetGate": total_target_gate,
            "fallbackReason": None if total_target_gate else "confirmation MAE failed; zero correction retained",
            "selectionDecision": total_selection,
            "topSelectionCandidates": total_ranking,
            "evaluation": total_evaluation,
        },
        "probabilities": {
            "openingPrice": opening_probability_report,
            "terminalPrice": terminal_probability_report,
        },
        "policy": {
            "openingPrice": {
                "selectedOn2023": opening_policy,
                "selectionCandidates": opening_policy_candidates,
                "confirmation2024To2025": opening_policy_confirmation,
            },
            "terminalPrice": {
                "selectedOn2023": terminal_policy,
                "selectionCandidates": terminal_policy_candidates,
                "confirmation2024To2025": terminal_policy_confirmation,
                "movementFieldMeaning": "opening-to-terminal market movement supporting the selected side; not post-wager CLV",
            },
        },
        "gates": {
            "pointForecastGate": point_gate,
            "marginTargetGate": margin_target_gate,
            "totalTargetGate": total_target_gate,
            "probabilityGate": probability_gate,
            "weeklyPortfolioGate": policy_gate,
            "shadowModelAccepted": point_gate,
            "actionablePolicyAccepted": point_gate and probability_gate and policy_gate,
            "forward2026Required": True,
        },
        "artifact": {
            "path": str(artifact_path),
            "sha256": sha256_file(artifact_path),
        },
        "limitations": [
            "The opening model is evaluated on provider-native DraftKings openings and nflverse outcomes; it is not a same-book closing-price backtest.",
            "Player-availability features use the final weekly report and are valid only for a near-kick availability overlay, never as opening-time knowledge.",
            "Game-time weather is excluded because its opening-time availability is not timestamp-safe.",
            "Public and sharp split history is unavailable and was not fabricated.",
            "No historical result authorizes a live grade before locked 2026 forward evidence exists.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "marginCandidate": margin_name,
        "totalCandidate": total_name,
        "marginConfirmation": margin_evaluation["confirmation"],
        "totalConfirmation": total_evaluation["confirmation"],
        "probabilityConfirmation": {
            stage: {market: values["confirmation"] for market, values in stage_report.items()}
            for stage, stage_report in (
                ("opening", opening_probability_report),
                ("terminal", terminal_probability_report),
            )
        },
        "openingPolicySelection": opening_policy,
        "openingPolicyConfirmation": opening_policy_confirmation,
        "terminalPolicySelection": terminal_policy,
        "terminalPolicyConfirmation": terminal_policy_confirmation,
        "gates": report["gates"],
        "report": str(report_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
