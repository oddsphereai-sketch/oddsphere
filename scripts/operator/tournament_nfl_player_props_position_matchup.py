#!/usr/bin/env python3
"""Chronological position-bucket opponent matchup tournament for NFL props."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-matchup/nfl_player_props_position_matchup_r1.json"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
POSITION_METRICS = (*MARKETS[:5], "targets", *MARKETS[5:])
SEASONS = (2023, 2024, 2025)
BLEND_WEIGHTS = (0.25, 0.50, 0.75, 1.0)
SEED = 20261008


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def position_bucket(values: pd.Series) -> pd.Series:
    return values.replace({"FB": "RB"})


def position_matchup_features(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    outcomes = frame.copy()
    outcomes["position_bucket"] = position_bucket(outcomes["position"])
    outcomes = outcomes[outcomes["position_bucket"].isin(["QB", "RB", "WR", "TE"])].copy()
    aggregates = outcomes.groupby(
        ["season", "week", "game_id", "team", "opponent", "position_bucket"],
        observed=True,
        as_index=False,
    )[list(POSITION_METRICS)].sum()
    allowed = aggregates.rename(columns={"team": "offense", "opponent": "defense"}).sort_values(
        ["defense", "position_bucket", "season", "week", "game_id"],
    )
    features: list[str] = []
    for metric in POSITION_METRICS:
        group = allowed.groupby(["defense", "position_bucket"], observed=True)[metric]
        for window in (3, 5):
            name = f"matchup_position_opponent_allowed_{metric}_avg{window}"
            allowed[name] = group.transform(
                lambda values, size=window: values.shift(1).rolling(size, min_periods=1).mean(),
            )
            features.append(name)
        name = f"matchup_position_opponent_allowed_{metric}_ewm"
        allowed[name] = group.transform(
            lambda values: values.shift(1).ewm(alpha=0.35, adjust=False).mean(),
        )
        features.append(name)
    return allowed[["season", "week", "game_id", "offense", "position_bucket", *features]].rename(
        columns={"offense": "team"},
    ), features


def attach_position_features(
    frame: pd.DataFrame,
    features: pd.DataFrame,
) -> pd.DataFrame:
    output = frame.copy()
    output["position_bucket"] = position_bucket(output["position"])
    return output.merge(
        features,
        on=["season", "week", "game_id", "team", "position_bucket"],
        how="left",
        validate="many_to_one",
        sort=False,
    )


def fit_model(kind: str, train: pd.DataFrame, test: pd.DataFrame, features: list[str], target: str) -> np.ndarray:
    calibrated = kind.endswith("_mean_calibrated")
    base_kind = kind.removesuffix("_mean_calibrated")
    if base_kind == "hgb_squared":
        model: Any = HistGradientBoostingRegressor(
            loss="squared_error", max_iter=180, max_leaf_nodes=7, learning_rate=0.04,
            min_samples_leaf=45, l2_regularization=10.0, random_state=SEED,
        )
    elif base_kind == "hgb_absolute":
        model = HistGradientBoostingRegressor(
            loss="absolute_error", max_iter=180, max_leaf_nodes=7, learning_rate=0.04,
            min_samples_leaf=45, l2_regularization=10.0, random_state=SEED,
        )
    elif base_kind == "extra_trees_stable":
        model = make_pipeline(
            SimpleImputer(strategy="median"),
            ExtraTreesRegressor(
                n_estimators=96, max_depth=12, min_samples_leaf=20,
                max_features=0.65, n_jobs=-1, random_state=SEED,
            ),
        )
    else:
        raise ValueError(kind)
    model.fit(train[features], train[target].to_numpy(float))
    prediction = np.asarray(model.predict(test[features]), dtype=float)
    if calibrated:
        train_prediction = np.asarray(model.predict(train[features]), dtype=float)
        prediction += float(np.mean(train[target].to_numpy(float) - train_prediction))
    return np.clip(prediction, 0.0, None)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("props_position_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_position_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    history = load_module("props_position_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    identity = load_module("props_position_identity", ROOT / "scripts/operator/tournament_nfl_player_props_opponent_matchup_identity.py")
    role = load_module("props_position_role", ROOT / "scripts/operator/tournament_nfl_player_props_role_volume_efficiency.py")
    trainer = load_module("props_position_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    opportunity = load_module("props_position_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    conditional = load_module("props_position_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    accuracy = load_module("props_position_accuracy", ROOT / "scripts/operator/tournament_nfl_player_props_projection_accuracy.py")
    recalibration = load_module("props_position_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    history_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())

    legacy_frame, corrected_frame, base_features, enhanced_features, manifest = role.corrected_frames(
        baseline, matchup, history, identity, args.manifest, history_contract,
    )
    position_rows, position_names = position_matchup_features(corrected_frame)
    candidate_frame = attach_position_features(corrected_frame, position_rows)
    candidate_features = [*enhanced_features, *position_names]
    keys = ["season", "week", "game_id", "team", "player_id"]
    if not legacy_frame[keys].equals(candidate_frame[keys]):
        raise RuntimeError("position feature join changed player identities")
    legacy_eligible = {
        market: baseline.market_eligible(legacy_frame, history_contract["markets"][market])
        for market in MARKETS
    }
    candidate_eligible = {
        market: baseline.market_eligible(candidate_frame, history_contract["markets"][market])
        for market in MARKETS
    }

    rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}

    for season in SEASONS:
        print(f"position-matchup season {season}...", flush=True)
        incumbent_rows, incumbent_prediction, _ = opportunity.incumbent_predictions(
            trainer, legacy_frame, legacy_eligible, season, base_features, enhanced_features,
        )
        active_rows, active_prediction = conditional.conditional_predictions(
            trainer, legacy_frame, legacy_eligible, season, base_features, enhanced_features,
        )
        for market in MARKETS:
            all_rows = incumbent_rows[market]
            participated = all_rows["participated"].eq(1).to_numpy()
            settled_rows = all_rows.loc[participated]
            if not settled_rows[["row_id"]].reset_index(drop=True).equals(
                active_rows[market][["row_id"]].reset_index(drop=True)
            ):
                raise RuntimeError(f"released reference row mismatch for {market} {season}")
            candidate_test = candidate_frame.loc[settled_rows.index]
            if not settled_rows[["row_id"]].reset_index(drop=True).equals(
                candidate_test[["row_id"]].reset_index(drop=True)
            ):
                raise RuntimeError(f"candidate row mismatch for {market} {season}")
            released = incumbent_prediction[market][participated]
            if market == "rushing_attempts":
                released = 0.25 * released + 0.75 * active_prediction[market]
            train = candidate_frame[
                candidate_eligible[market]
                & candidate_frame["participated"].eq(1)
                & candidate_frame["season"].lt(season)
            ]
            rows[market][season] = candidate_test
            actual[market][season] = candidate_test[market].to_numpy(float)
            reference[market][season] = released
            for kind in (
                "hgb_squared", "hgb_absolute", "extra_trees_stable",
                "hgb_squared_mean_calibrated", "hgb_absolute_mean_calibrated",
                "extra_trees_stable_mean_calibrated",
            ):
                model_prediction = fit_model(kind, train, candidate_test, candidate_features, market)
                for weight in BLEND_WEIGHTS:
                    name = f"position_{kind}_blend_{int(weight * 100)}"
                    candidates[market].setdefault(name, {})[season] = np.clip(
                        (1.0 - weight) * released + weight * model_prediction,
                        0.0,
                        None,
                    )

    report: dict[str, Any] = {}
    for market in MARKETS:
        selection_reference = accuracy.point_metrics(actual[market][2023], reference[market][2023])
        selection_candidates = {
            name: accuracy.point_metrics(actual[market][2023], values[2023])
            for name, values in candidates[market].items()
        }
        selection_mean = float(np.mean(actual[market][2023]))
        selectable = [name for name, values in selection_candidates.items() if (
            float(values["mae"]) < float(selection_reference["mae"])
            and float(values["rmse"]) < float(selection_reference["rmse"])
            and abs(float(values["bias"]))
            <= abs(float(selection_reference["bias"])) + 0.0025 * selection_mean
            and float(values["underpredictionRate"])
            <= float(selection_reference["underpredictionRate"]) + 0.0025
        )]
        selected = min(selectable, key=lambda name: (
            float(selection_candidates[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_candidates[name]["rmse"]) / float(selection_reference["rmse"])
        )) if selectable else None
        confirmation_reference = accuracy.point_metrics(actual[market][2024], reference[market][2024])
        confirmation_candidate = (
            accuracy.point_metrics(actual[market][2024], candidates[market][selected][2024])
            if selected else None
        )
        confirmation_mean = float(np.mean(actual[market][2024]))
        confirmed = bool(
            selected and confirmation_candidate
            and float(confirmation_candidate["mae"]) < float(confirmation_reference["mae"])
            and float(confirmation_candidate["rmse"]) < float(confirmation_reference["rmse"])
            and abs(float(confirmation_candidate["bias"]))
            <= abs(float(confirmation_reference["bias"])) + 0.0025 * confirmation_mean
            and float(confirmation_candidate["underpredictionRate"])
            <= float(confirmation_reference["underpredictionRate"]) + 0.0025
        )
        chosen = candidates[market][selected] if confirmed and selected else reference[market]
        holdout_y = actual[market][2025]
        holdout_reference = accuracy.point_metrics(holdout_y, reference[market][2025])
        holdout_candidate = accuracy.point_metrics(holdout_y, chosen[2025])
        mae_bootstrap = accuracy.clustered_delta(
            rows[market][2025], np.abs(chosen[2025] - holdout_y), np.abs(reference[market][2025] - holdout_y),
        )
        bias_bootstrap = accuracy.clustered_delta(
            rows[market][2025], chosen[2025] - holdout_y, reference[market][2025] - holdout_y,
        )
        segments = accuracy.segment_metrics(
            rows[market][2025], holdout_y, reference[market][2025], chosen[2025],
        )
        reference_distribution = accuracy.distribution_report(
            recalibration, calibration_contract, actual[market], reference[market],
        )
        candidate_distribution = accuracy.distribution_report(
            recalibration, calibration_contract, actual[market], chosen,
        )
        market_mean = float(np.mean(holdout_y))
        point_pass = bool(
            confirmed
            and float(holdout_candidate["mae"]) < float(holdout_reference["mae"])
            and float(holdout_candidate["rmse"]) < float(holdout_reference["rmse"])
            and float(mae_bootstrap["ciHigh"]) < 0.0
            and abs(float(holdout_candidate["bias"])) <= abs(float(holdout_reference["bias"])) + 0.0025 * market_mean
            and float(holdout_candidate["underpredictionRate"]) <= float(holdout_reference["underpredictionRate"]) + 0.0025
            and all(float(segment["maeDelta"]) <= 0.0 for segment in segments)
        )
        reference_dist = reference_distribution["holdout"]
        candidate_dist = candidate_distribution["holdout"]
        distribution_pass = bool(
            float(candidate_dist["crps"]) < float(reference_dist["crps"])
            and float(candidate_dist["nll"]) <= float(reference_dist["nll"]) * 1.005
            and abs(float(candidate_dist["coverage_80"]) - 0.8)
            <= float(calibration_contract["selection"]["maximumAbsoluteCoverage80Error"])
            and abs(float(candidate_dist["coverage_90"]) - 0.9)
            <= float(calibration_contract["selection"]["maximumAbsoluteCoverage90Error"])
        )
        report[market] = {
            "selection": {"reference": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"reference": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "holdout": {
                "reference": holdout_reference,
                "candidate": holdout_candidate,
                "clusteredMaeDelta": mae_bootstrap,
                "clusteredBiasDelta": bias_bootstrap,
                "chronologicalSegments": segments,
            },
            "distribution": {"reference": reference_distribution, "candidate": candidate_distribution},
            "passes": {"point": point_pass, "distribution": distribution_pass, "all": bool(point_pass and distribution_pass)},
        }

    output = {
        "release": "nfl_player_props_position_matchup_tournament_2026_10_08_r3_bias_constrained_selection",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "openedRetrospective": 2025},
        "evidenceStatus": "2025 was opened by prior iterations and cannot be called an untouched holdout; 2026 current-season replay is required",
        "targetPopulation": "prior-role eligible rows with official participated=1; participated is never a model feature",
        "reference": "released full-family point heads, including the released 25% legacy / 75% settlement-aligned Rushing Attempts head",
        "architecture": "corrected base/advanced opponent identity plus shifted actual-opponent QB/RB/WR/TE allowed histories and optional training-only mean-residual point calibration",
        "positionFeatures": position_names,
        "blendWeights": list(BLEND_WEIGHTS),
        "lineOrPriceFeatures": [],
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {
            market: {
                "selected": values["selection"]["selected"],
                "confirmed": values["confirmation"]["confirmed"],
                "holdout": values["holdout"],
                "passes": values["passes"],
            }
            for market, values in report.items()
        },
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
