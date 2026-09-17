#!/usr/bin/env python3
"""Chronological audit for NFL anytime-touchdown scorer discrimination.

This script is intentionally no-write with respect to production artifacts. It rebuilds the
incumbent and bounded challengers on the checksum-pinned historical substrate, selects model
shape in 2023, calibration and a natural expected-prevalence ranking policy in 2024, and opens
2025 once as the final holdout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from tournament_nfl_player_props_touchdowns import add_touchdown_features, read_pbp


HISTORY_MANIFEST = pathlib.Path(
    "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
)
DEFAULT_MARKET_CONTEXT = pathlib.Path(
    "football-research/cache/nfl-player-props-market-context/nflverse_games_current.csv"
)
RUNTIME_CORE = pathlib.Path("lib/services/football/modelArtifacts/nflPlayerPropsRuntime.json")
RUNTIME_PLAYER_SHARDS = tuple(
    pathlib.Path(f"lib/services/football/modelArtifacts/nflPlayerPropsRuntimePlayers{index}.json")
    for index in range(4)
)
SEED = 20260916
POSITIONS = ("QB", "RB", "FB", "WR", "TE")
SCORER_POLICY_SCOPES = (
    "team",
    "team_largest_remainder",
    "game",
    *(f"week_x{multiplier:.2f}" for multiplier in (0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20, 1.25)),
)


def probability_metrics(y: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    bins = pd.qcut(probability, q=10, duplicates="drop")
    grouped = (
        pd.DataFrame({"p": probability, "y": y, "bin": bins})
        .groupby("bin", observed=True)
        .agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"))
    )
    return {
        "rows": int(len(y)),
        "positiveRate": float(y.mean()),
        "expectedPositives": float(probability.sum()),
        "observedPositives": int(y.sum()),
        "brier": float(brier_score_loss(y, probability)),
        "logLoss": float(log_loss(y, probability)),
        "auc": float(roc_auc_score(y, probability)),
        "calibrationGap": float(
            np.average(np.abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"])
        ),
    }


def scorer_metrics(rows: pd.DataFrame, probability: np.ndarray, scope: str) -> dict[str, float | int]:
    evaluated = rows[["season", "week", "game_id", "team", "player_id", "anytime_td"]].copy()
    evaluated["probability"] = probability
    evaluated["selected"] = False
    prevalence_multiplier = 1.0
    if scope.startswith("week_x"):
        prevalence_multiplier = float(scope.split("_x", 1)[1])
        scope = "week"
    if scope == "team_largest_remainder":
        for _, week_index in evaluated.groupby(["season", "week"], observed=True).groups.items():
            week_rows = evaluated.loc[week_index]
            allocations: list[dict[str, Any]] = []
            for (game_id, team), team_index in week_rows.groupby(
                ["game_id", "team"], observed=True
            ).groups.items():
                expected = float(evaluated.loc[team_index, "probability"].sum())
                base = min(len(team_index), int(np.floor(expected)))
                allocations.append(
                    {
                        "game_id": game_id,
                        "team": team,
                        "index": team_index,
                        "expected": expected,
                        "base": base,
                        "fraction": expected - np.floor(expected),
                    }
                )
            target = int(np.floor(float(week_rows["probability"].sum()) + 0.5))
            remaining = max(0, target - sum(int(item["base"]) for item in allocations))
            for item in sorted(
                allocations,
                key=lambda value: (-float(value["fraction"]), str(value["game_id"]), str(value["team"])),
            ):
                if remaining <= 0:
                    break
                if int(item["base"]) < len(item["index"]):
                    item["base"] = int(item["base"]) + 1
                    remaining -= 1
            for item in allocations:
                count = int(item["base"])
                if not count:
                    continue
                group = evaluated.loc[item["index"]]
                chosen = group.sort_values(
                    ["probability", "player_id"], ascending=[False, True], kind="mergesort"
                ).head(count).index
                evaluated.loc[chosen, "selected"] = True
        group_columns = []
    elif scope == "week":
        group_columns = ["season", "week"]
    elif scope == "game":
        group_columns = ["game_id"]
    elif scope == "team":
        group_columns = ["game_id", "team"]
    else:
        raise ValueError(f"unknown scorer scope: {scope}")
    if group_columns:
        for _, index in evaluated.groupby(group_columns, observed=True).groups.items():
            group = evaluated.loc[index]
            count = max(
                0,
                min(
                    len(group),
                    int(np.floor(float(group["probability"].sum()) * prevalence_multiplier + 0.5)),
                ),
            )
            if count:
                chosen = group.sort_values(
                    ["probability", "player_id"], ascending=[False, True], kind="mergesort"
                ).head(count).index
                evaluated.loc[chosen, "selected"] = True
    selected = evaluated["selected"].to_numpy(bool)
    actual = evaluated["anytime_td"].to_numpy(int).astype(bool)
    true_positive = int(np.sum(selected & actual))
    false_positive = int(np.sum(selected & ~actual))
    false_negative = int(np.sum(~selected & actual))
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    f1 = 2 * precision * recall / max(1e-12, precision + recall)
    selected_teams = evaluated.loc[evaluated["selected"], ["game_id", "team"]].drop_duplicates()
    return {
        "policy": f"{scope}_rounded_expected_prevalence_x{prevalence_multiplier:.2f}",
        "selected": int(selected.sum()),
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "missedScorers": false_negative,
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "games": int(evaluated["game_id"].nunique()),
        "teamsWithSelection": int(len(selected_teams)),
    }


def normalized_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", ascii_value.lower())


def residual_probability(model: float, market: float, weight: float = 0.2) -> float:
    model = float(np.clip(model, 1e-5, 1 - 1e-5))
    market = float(np.clip(market, 1e-5, 1 - 1e-5))
    model_logit = np.log(model / (1 - model))
    market_logit = np.log(market / (1 - market))
    return float(1 / (1 + np.exp(-(market_logit + weight * (model_logit - market_logit)))))


def select_external(rows: pd.DataFrame, probability: np.ndarray, scope: str) -> np.ndarray:
    working = rows[["season", "week", "game_id", "team", "player_id"]].copy()
    working["anytime_td"] = 0
    selected_keys = scorer_selection_keys(working, probability, scope)
    return np.array(
        [f"{row.game_id}|{row.player_id}" in selected_keys for row in working.itertuples()], dtype=bool
    )


def scorer_selection_keys(rows: pd.DataFrame, probability: np.ndarray, scope: str) -> set[str]:
    working = rows.copy()
    working["probability"] = probability
    prevalence_multiplier = 1.0
    if scope.startswith("week_x"):
        prevalence_multiplier = float(scope.split("_x", 1)[1])
        scope = "week"
    if scope == "week":
        group_columns = ["season", "week"]
    elif scope == "game":
        group_columns = ["game_id"]
    elif scope == "team":
        group_columns = ["game_id", "team"]
    else:
        raise ValueError(f"unsupported external scorer scope: {scope}")
    selected: set[str] = set()
    for _, index in working.groupby(group_columns, observed=True).groups.items():
        group = working.loc[index]
        count = max(
            0,
            min(
                len(group),
                int(np.floor(float(group["probability"].sum()) * prevalence_multiplier + 0.5)),
            ),
        )
        ranked = group.sort_values(
            ["probability", "player_id"], ascending=[False, True], kind="mergesort"
        ).head(count)
        selected.update(f"{row.game_id}|{row.player_id}" for row in ranked.itertuples())
    return selected


def external_scorer_metrics(
    rows: pd.DataFrame,
    probability: np.ndarray,
    scope: str,
) -> dict[str, float | int]:
    selected = select_external(rows, probability, scope)
    known = rows["actual_touchdowns"].notna().to_numpy(bool)
    actual = rows["actual_touchdowns"].fillna(0).to_numpy(float) > 0
    evaluated_selected = selected & known
    true_positive = int(np.sum(evaluated_selected & actual))
    false_positive = int(np.sum(evaluated_selected & ~actual))
    false_negative = int(np.sum(~selected & known & actual))
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    return {
        "policy": f"{scope}_rounded_expected_prevalence",
        "knownOutcomeRows": int(known.sum()),
        "selected": int(evaluated_selected.sum()),
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "missedScorers": false_negative,
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(2 * precision * recall / max(1e-12, precision + recall)),
    }


def build_external_features(
    context_path: pathlib.Path,
    market_context: pd.DataFrame,
    base_features: list[str],
) -> pd.DataFrame:
    payload = json.loads(context_path.read_text(encoding="utf-8"))
    core = json.loads(RUNTIME_CORE.read_text(encoding="utf-8"))
    players: dict[str, Any] = {}
    for path in RUNTIME_PLAYER_SHARDS:
        players.update(json.loads(path.read_text(encoding="utf-8")))
    games_2026 = market_context[
        market_context["season"].eq(2026) & market_context["game_type"].eq("REG")
    ]
    records: list[dict[str, Any]] = []
    for candidate in payload["candidates"]:
        player_name = str(candidate["playerName"])
        team = str(candidate["team"])
        opponent = str(candidate["opponent"])
        state = players.get(normalized_name(player_name), {})
        values: dict[str, Any] = {name: np.nan for name in base_features}
        for source in (state, core["teamStates"].get(team, {}), core["opponentStates"].get(opponent, {})):
            for name, value in source.items():
                if name in values and isinstance(value, (int, float)):
                    values[name] = float(value)
        match = games_2026[
            (
                games_2026["home_team"].eq(team)
                & games_2026["away_team"].eq(opponent)
            )
            | (
                games_2026["home_team"].eq(opponent)
                & games_2026["away_team"].eq(team)
            )
        ]
        values["is_home"] = float(len(match) > 0 and str(match.iloc[0]["home_team"]) == team)
        for position in POSITIONS:
            values[f"position_{position.lower()}"] = float(candidate.get("position") == position)
        values["team_implied_touchdowns"] = candidate.get("teamImpliedTouchdowns")
        records.append(
            {
                **values,
                "season": 2026,
                "week": int(payload["week"]),
                "game_id": str(candidate["gameId"]),
                "team": team,
                "player_id": normalized_name(player_name),
                "actual_touchdowns": candidate.get("actualTouchdowns"),
                "market_probability": candidate.get("marketProbability"),
                "independent_market": bool(candidate.get("independentMarket")),
                "incumbent_final_probability": candidate.get("incumbentFinalProbability"),
            }
        )
    return pd.DataFrame(records)


class Calibrator:
    def fit(self, probability: np.ndarray, y: np.ndarray) -> "Calibrator":
        raise NotImplementedError

    def predict(self, probability: np.ndarray) -> np.ndarray:
        raise NotImplementedError


class PlattCalibrator(Calibrator):
    def __init__(self) -> None:
        self.model = LogisticRegression(C=1.0, max_iter=500)

    @staticmethod
    def _logit(probability: np.ndarray) -> np.ndarray:
        clipped = np.clip(probability, 1e-5, 1 - 1e-5)
        return np.log(clipped / (1 - clipped)).reshape(-1, 1)

    def fit(self, probability: np.ndarray, y: np.ndarray) -> "PlattCalibrator":
        self.model.fit(self._logit(probability), y)
        return self

    def predict(self, probability: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(self._logit(probability))[:, 1]


class BetaCalibrator(Calibrator):
    def __init__(self) -> None:
        self.model = LogisticRegression(C=1.0, max_iter=500)

    @staticmethod
    def _features(probability: np.ndarray) -> np.ndarray:
        clipped = np.clip(probability, 1e-5, 1 - 1e-5)
        return np.column_stack([np.log(clipped), -np.log1p(-clipped)])

    def fit(self, probability: np.ndarray, y: np.ndarray) -> "BetaCalibrator":
        self.model.fit(self._features(probability), y)
        return self

    def predict(self, probability: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(self._features(probability))[:, 1]


class IsotonicCalibrator(Calibrator):
    def __init__(self) -> None:
        self.model = IsotonicRegression(out_of_bounds="clip", y_min=0.0025, y_max=0.9975)

    def fit(self, probability: np.ndarray, y: np.ndarray) -> "IsotonicCalibrator":
        self.model.fit(probability, y)
        return self

    def predict(self, probability: np.ndarray) -> np.ndarray:
        return np.asarray(self.model.predict(probability), dtype=float)


CALIBRATORS: dict[str, Callable[[], Calibrator]] = {
    "platt": PlattCalibrator,
    "beta": BetaCalibrator,
    "isotonic": IsotonicCalibrator,
}


def add_relative_role_features(rows: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    enriched = rows.copy()
    groups = enriched.groupby(["season", "week", "game_id", "team"], observed=True)
    source_columns = [
        "prior_anytime_td_ewm",
        "prior_anytime_td_avg5",
        "prior_redzone_opportunity_ewm",
        "prior_redzone_opportunity_avg5",
        "prior_goal_line_opportunity_ewm",
        "prior_goal_line_opportunity_avg5",
        "prior_rush_attempt_share_ewm",
        "prior_rush_attempt_share_avg3",
        "prior_target_share_ewm",
        "prior_target_share_avg3",
        "prior_offense_snap_pct_ewm",
    ]
    added: list[str] = []
    for source in source_columns:
        safe = pd.to_numeric(enriched[source], errors="coerce").clip(lower=0).fillna(0.0)
        denominator = safe.groupby(
            [enriched["season"], enriched["week"], enriched["game_id"], enriched["team"]],
            observed=True,
        ).transform("sum")
        target = f"relative_{source.removeprefix('prior_')}"
        enriched[target] = np.where(denominator.gt(0), safe / denominator, 0.0)
        added.append(target)

    enriched["relative_combined_role_ewm"] = (
        0.40 * enriched["relative_goal_line_opportunity_ewm"]
        + 0.20 * enriched["relative_redzone_opportunity_ewm"]
        + 0.20 * enriched["relative_rush_attempt_share_ewm"]
        + 0.15 * enriched["relative_target_share_ewm"]
        + 0.05 * enriched["relative_offense_snap_pct_ewm"]
    )
    enriched["expected_td_role_ewm"] = (
        enriched["team_implied_touchdowns"].fillna(enriched["prior_team_td_avg5"])
        * enriched["relative_combined_role_ewm"]
    )
    added.extend(["relative_combined_role_ewm", "expected_td_role_ewm"])
    return enriched, added


@dataclass(frozen=True)
class Candidate:
    name: str
    feature_set: str
    factory: Callable[[], Any]


class BlendedHgbClassifier:
    def __init__(self, base_feature_count: int, role_weight: float) -> None:
        self.base_feature_count = base_feature_count
        self.role_weight = role_weight
        self.incumbent = HistGradientBoostingClassifier(
            max_iter=160,
            max_leaf_nodes=15,
            learning_rate=0.05,
            l2_regularization=3.0,
            random_state=20260825,
        )
        self.role = HistGradientBoostingClassifier(
            max_iter=220,
            max_leaf_nodes=15,
            learning_rate=0.04,
            l2_regularization=5.0,
            min_samples_leaf=40,
            random_state=SEED,
        )

    def fit(self, x: pd.DataFrame, y: pd.Series) -> "BlendedHgbClassifier":
        self.incumbent.fit(x.iloc[:, : self.base_feature_count], y)
        self.role.fit(x, y)
        return self

    def predict_proba(self, x: pd.DataFrame) -> np.ndarray:
        incumbent = self.incumbent.predict_proba(x.iloc[:, : self.base_feature_count])[:, 1]
        role = self.role.predict_proba(x)[:, 1]
        probability = (1 - self.role_weight) * incumbent + self.role_weight * role
        return np.column_stack([1 - probability, probability])


def candidate_models() -> list[Candidate]:
    return [
        Candidate(
            "incumbent_hgb",
            "full",
            lambda: HistGradientBoostingClassifier(
                max_iter=160,
                max_leaf_nodes=15,
                learning_rate=0.05,
                l2_regularization=3.0,
                random_state=20260825,
            ),
        ),
        Candidate(
            "relative_role_hgb_leaf7",
            "relative",
            lambda: HistGradientBoostingClassifier(
                max_iter=220,
                max_leaf_nodes=7,
                learning_rate=0.04,
                l2_regularization=5.0,
                min_samples_leaf=40,
                random_state=SEED,
            ),
        ),
        Candidate(
            "relative_role_hgb_leaf15",
            "relative",
            lambda: HistGradientBoostingClassifier(
                max_iter=220,
                max_leaf_nodes=15,
                learning_rate=0.04,
                l2_regularization=5.0,
                min_samples_leaf=40,
                random_state=SEED,
            ),
        ),
        Candidate(
            "relative_role_hgb_leaf31",
            "relative",
            lambda: HistGradientBoostingClassifier(
                max_iter=180,
                max_leaf_nodes=31,
                learning_rate=0.04,
                l2_regularization=8.0,
                min_samples_leaf=60,
                random_state=SEED,
            ),
        ),
        *(
            Candidate(
                f"incumbent_relative_blend_{role_weight:.2f}",
                "relative",
                lambda role_weight=role_weight: BlendedHgbClassifier(124, role_weight),
            )
            for role_weight in (0.25, 0.50, 0.75)
        ),
        Candidate(
            "relative_role_logistic",
            "relative",
            lambda: make_pipeline(
                SimpleImputer(strategy="median"),
                StandardScaler(),
                LogisticRegression(C=0.03, max_iter=800, class_weight=None),
            ),
        ),
    ]


def role_calibration_frame(
    rows: pd.DataFrame,
    raw_probability: np.ndarray,
    relative_features: list[str],
) -> pd.DataFrame:
    clipped = np.clip(raw_probability, 1e-5, 1 - 1e-5)
    result = rows[relative_features].reset_index(drop=True).copy()
    result.insert(0, "raw_logit", np.log(clipped / (1 - clipped)))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--market-context", type=pathlib.Path, default=DEFAULT_MARKET_CONTEXT)
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--external-context", type=pathlib.Path)
    args = parser.parse_args()

    history_manifest = json.loads(HISTORY_MANIFEST.read_text(encoding="utf-8"))
    history = pd.read_parquet(history_manifest["featureFile"])
    complete_market_context = pd.read_csv(args.market_context, low_memory=False)
    market_context = complete_market_context[
        complete_market_context["season"].between(2016, 2025)
        & complete_market_context["game_type"].eq("REG")
    ].copy()
    frame, touchdown_features = add_touchdown_features(history, read_pbp(), market_context)
    for position in POSITIONS:
        frame[f"position_{position.lower()}"] = frame["position"].eq(position).astype(float)
    frame, relative_features = add_relative_role_features(frame)

    base_features = [
        *history_manifest["modelFeatureColumns"],
        *touchdown_features,
        "is_home",
        *(f"position_{position.lower()}" for position in POSITIONS),
    ]
    feature_sets = {
        "full": base_features,
        "relative": [*base_features, *relative_features],
    }
    eligible = frame["prior_participations"].ge(1) & frame["position"].isin(POSITIONS)
    by_season = {season: frame[eligible & frame["season"].eq(season)].copy() for season in (2023, 2024, 2025)}
    train_2022 = frame[eligible & frame["season"].le(2022)].copy()

    selection: dict[str, Any] = {}
    candidates = candidate_models()
    for candidate in candidates:
        features = feature_sets[candidate.feature_set]
        model = candidate.factory()
        model.fit(train_2022[features], train_2022["anytime_td"])
        probability = np.clip(model.predict_proba(by_season[2023][features])[:, 1], 0.0025, 0.9975)
        selection[candidate.name] = probability_metrics(
            by_season[2023]["anytime_td"].to_numpy(int), probability
        )

    champion_name = min(
        selection,
        key=lambda name: (
            selection[name]["brier"], selection[name]["logLoss"], -selection[name]["auc"]
        ),
    )
    champion = next(candidate for candidate in candidates if candidate.name == champion_name)
    champion_features = feature_sets[champion.feature_set]

    train_2023 = frame[eligible & frame["season"].le(2023)].copy()
    calibration_model = champion.factory()
    calibration_model.fit(train_2023[champion_features], train_2023["anytime_td"])
    raw_2024 = np.clip(
        calibration_model.predict_proba(by_season[2024][champion_features])[:, 1], 0.0025, 0.9975
    )
    y_2024 = by_season[2024]["anytime_td"].to_numpy(int)
    calibration_fit_mask = by_season[2024]["week"].le(9).to_numpy(bool)
    calibration_evaluation_mask = ~calibration_fit_mask
    calibration: dict[str, Any] = {}
    selection_calibrators: dict[str, Calibrator] = {}
    for name, factory in CALIBRATORS.items():
        fitted = factory().fit(raw_2024[calibration_fit_mask], y_2024[calibration_fit_mask])
        selection_calibrators[name] = fitted
        calibrated = np.clip(
            fitted.predict(raw_2024[calibration_evaluation_mask]), 0.0025, 0.9975
        )
        calibration[name] = probability_metrics(y_2024[calibration_evaluation_mask], calibrated)
    calibrator_name = min(
        calibration,
        key=lambda name: (
            calibration[name]["brier"], calibration[name]["logLoss"], -calibration[name]["auc"]
        ),
    )
    selection_calibrator = selection_calibrators[calibrator_name]
    calibrated_2024_evaluation = np.clip(
        selection_calibrator.predict(raw_2024[calibration_evaluation_mask]), 0.0025, 0.9975
    )

    policy_selection = {
        scope: scorer_metrics(
            by_season[2024].loc[calibration_evaluation_mask], calibrated_2024_evaluation, scope
        )
        for scope in SCORER_POLICY_SCOPES
    }
    policy = max(
        policy_selection,
        key=lambda scope: (
            policy_selection[scope]["f1"],
            policy_selection[scope]["recall"],
            policy_selection[scope]["precision"],
        ),
    )

    train_2024 = frame[eligible & frame["season"].le(2024)].copy()
    holdout_model = champion.factory()
    holdout_model.fit(train_2024[champion_features], train_2024["anytime_td"])
    raw_2025 = np.clip(
        holdout_model.predict_proba(by_season[2025][champion_features])[:, 1], 0.0025, 0.9975
    )
    fitted_calibrators = {
        name: factory().fit(raw_2024, y_2024) for name, factory in CALIBRATORS.items()
    }
    calibrator = fitted_calibrators[calibrator_name]
    probability_2025 = np.clip(calibrator.predict(raw_2025), 0.0025, 0.9975)
    challenger_holdout_by_calibration = {
        name: probability_metrics(
            by_season[2025]["anytime_td"].to_numpy(int),
            np.clip(fitted.predict(raw_2025), 0.0025, 0.9975),
        )
        for name, fitted in fitted_calibrators.items()
    }
    challenger_holdout = probability_metrics(
        by_season[2025]["anytime_td"].to_numpy(int), probability_2025
    )
    challenger_scorer = scorer_metrics(by_season[2025], probability_2025, policy)
    challenger_scorer_by_policy = {
        scope: scorer_metrics(by_season[2025], probability_2025, scope)
        for scope in SCORER_POLICY_SCOPES
    }

    incumbent_calibration_model = candidate_models()[0].factory()
    incumbent_features = feature_sets["full"]
    incumbent_calibration_model.fit(train_2023[incumbent_features], train_2023["anytime_td"])
    incumbent_raw_2024 = np.clip(
        incumbent_calibration_model.predict_proba(by_season[2024][incumbent_features])[:, 1],
        0.0025,
        0.9975,
    )
    role_meta_2024 = role_calibration_frame(by_season[2024], incumbent_raw_2024, relative_features)
    role_meta_selection: dict[str, Any] = {}
    role_meta_models: dict[str, Any] = {}
    for regularization in (0.003, 0.01, 0.03, 0.1, 0.3):
        name = f"C={regularization}"
        model = make_pipeline(
            SimpleImputer(strategy="median"),
            StandardScaler(),
            LogisticRegression(C=regularization, max_iter=800),
        )
        model.fit(role_meta_2024.loc[calibration_fit_mask], y_2024[calibration_fit_mask])
        probability = model.predict_proba(role_meta_2024.loc[calibration_evaluation_mask])[:, 1]
        role_meta_selection[name] = probability_metrics(
            y_2024[calibration_evaluation_mask], probability
        )
        role_meta_models[name] = model
    role_meta_name = min(
        role_meta_selection,
        key=lambda name: (
            role_meta_selection[name]["brier"],
            role_meta_selection[name]["logLoss"],
            -role_meta_selection[name]["auc"],
        ),
    )
    role_meta_selection_probability = role_meta_models[role_meta_name].predict_proba(
        role_meta_2024.loc[calibration_evaluation_mask]
    )[:, 1]
    role_meta_policy_selection = {
        scope: scorer_metrics(
            by_season[2024].loc[calibration_evaluation_mask],
            role_meta_selection_probability,
            scope,
        )
        for scope in SCORER_POLICY_SCOPES
    }
    role_meta_policy = max(
        role_meta_policy_selection,
        key=lambda scope: (
            role_meta_policy_selection[scope]["f1"],
            role_meta_policy_selection[scope]["recall"],
            role_meta_policy_selection[scope]["precision"],
        ),
    )
    role_meta_final = make_pipeline(
        SimpleImputer(strategy="median"),
        StandardScaler(),
        LogisticRegression(C=float(role_meta_name.split("=")[1]), max_iter=800),
    )
    role_meta_final.fit(role_meta_2024, y_2024)
    incumbent_calibrator = PlattCalibrator().fit(incumbent_raw_2024, y_2024)
    incumbent_probability_2024 = np.clip(
        incumbent_calibrator.predict(incumbent_raw_2024), 0.0025, 0.9975
    )
    incumbent_policy_selection_2024 = {
        scope: scorer_metrics(by_season[2024], incumbent_probability_2024, scope)
        for scope in SCORER_POLICY_SCOPES
    }
    incumbent_holdout_model = candidate_models()[0].factory()
    incumbent_holdout_model.fit(train_2024[incumbent_features], train_2024["anytime_td"])
    incumbent_raw_2025 = np.clip(
        incumbent_holdout_model.predict_proba(by_season[2025][incumbent_features])[:, 1],
        0.0025,
        0.9975,
    )
    role_meta_2025 = role_calibration_frame(by_season[2025], incumbent_raw_2025, relative_features)
    role_meta_probability_2025 = np.clip(
        role_meta_final.predict_proba(role_meta_2025)[:, 1], 0.0025, 0.9975
    )
    role_meta_holdout = probability_metrics(
        by_season[2025]["anytime_td"].to_numpy(int), role_meta_probability_2025
    )
    role_meta_scorer = scorer_metrics(
        by_season[2025], role_meta_probability_2025, role_meta_policy
    )
    incumbent_probability_2025 = np.clip(
        incumbent_calibrator.predict(incumbent_raw_2025), 0.0025, 0.9975
    )
    incumbent_holdout = probability_metrics(
        by_season[2025]["anytime_td"].to_numpy(int), incumbent_probability_2025
    )
    incumbent_scorer = scorer_metrics(by_season[2025], incumbent_probability_2025, "team")
    incumbent_scorer_by_policy = {
        scope: scorer_metrics(by_season[2025], incumbent_probability_2025, scope)
        for scope in SCORER_POLICY_SCOPES
    }

    external_confirmation: dict[str, Any] | None = None
    if args.external_context:
        external = build_external_features(args.external_context, complete_market_context, base_features)
        external, _ = add_relative_role_features(external)
        final_model = champion.factory()
        final_model.fit(
            frame[eligible & frame["season"].le(2025)][champion_features],
            frame[eligible & frame["season"].le(2025)]["anytime_td"],
        )
        external_raw = np.clip(
            final_model.predict_proba(external[champion_features])[:, 1], 0.0025, 0.9975
        )
        external_model_probability = np.clip(calibrator.predict(external_raw), 0.0025, 0.9975)
        external_final_probability = np.array([
            residual_probability(model, float(market))
            if independent and market is not None and np.isfinite(float(market))
            else float(model)
            for model, market, independent in zip(
                external_model_probability,
                external["market_probability"],
                external["independent_market"],
                strict=True,
            )
        ])
        incumbent_final_probability = external["incumbent_final_probability"].to_numpy(float)
        external_confirmation = {
            "rows": int(len(external)),
            "knownOutcomeRows": int(external["actual_touchdowns"].notna().sum()),
            "observedScorers": int(external["actual_touchdowns"].fillna(0).gt(0).sum()),
            "incumbent": external_scorer_metrics(external, incumbent_final_probability, "team"),
            "challenger": external_scorer_metrics(external, external_final_probability, policy),
            "challengerByPolicy": {
                scope: external_scorer_metrics(external, external_final_probability, scope)
                for scope in SCORER_POLICY_SCOPES
                if scope != "team_largest_remainder"
            },
        }

    result = {
        "auditRelease": "nfl_player_props_touchdown_scorer_quality_audit_2026_09_16_r1",
        "historicalFeatureSha256": history_manifest["featureFileSha256"],
        "marketContextSha256": hashlib.sha256(args.market_context.read_bytes()).hexdigest(),
        "chronology": {
            "train": "2016-2022",
            "modelSelection": 2023,
            "calibrationAndPolicySelection": 2024,
            "untouchedHoldout": 2025,
        },
        "eligibleRows": {
            str(season): int(len(rows)) for season, rows in by_season.items()
        },
        "modelSelection": selection,
        "selectedModel": champion_name,
        "selectedFeatureCount": len(champion_features),
        "calibrationSelection": calibration,
        "selectedCalibration": calibrator_name,
        "policySelection": policy_selection,
        "incumbentPolicySelection2024": incumbent_policy_selection_2024,
        "selectedPolicy": policy_selection[policy]["policy"],
        "roleAwareCalibration": {
            "selection": role_meta_selection,
            "selected": role_meta_name,
            "policySelection": role_meta_policy_selection,
            "selectedPolicy": role_meta_policy_selection[role_meta_policy]["policy"],
            "holdoutProbability": role_meta_holdout,
            "holdoutScorer": role_meta_scorer,
        },
        "externalConfirmation": external_confirmation,
        "holdout": {
            "incumbentProbability": incumbent_holdout,
            "challengerProbability": challenger_holdout,
            "challengerProbabilityByCalibration": challenger_holdout_by_calibration,
            "incumbentScorer": incumbent_scorer,
            "incumbentScorerByPolicy": incumbent_scorer_by_policy,
            "challengerScorer": challenger_scorer,
            "challengerScorerByPolicy": challenger_scorer_by_policy,
        },
    }
    encoded = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")


if __name__ == "__main__":
    main()
