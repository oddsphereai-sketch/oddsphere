#!/usr/bin/env python3
"""Frozen chronological tournament for public NFL props features.

Candidate selection uses 2024, confirmation uses 2025, and only then are 2026
Weeks 1-4 projections produced. The candidate is price-blind and research-only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r2.manifest.json"
DEFAULT_HISTORY_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_external_tournament_r1.json"
DEFAULT_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_external_2026_projections_r1.parquet"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
COUNT_MARKETS = {"passing_attempts", "passing_completions", "rushing_attempts", "receptions"}
GROUPS = ("state", "state_pressure", "state_ftn", "state_ngs", "full_external")
WEIGHTS = (0.25, 0.50, 0.75, 1.0)
SEED = 20261008


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = prediction - actual
    return {
        "rows": int(len(actual)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
        "underpredictionRate": float(np.mean(prediction < actual)),
    }


def relevant_features(market: str, groups: dict[str, list[str]]) -> dict[str, list[str]]:
    state = list(groups["state"])
    if market.startswith("passing_"):
        pfr_prefix, ftn_prefix, ngs_prefix = "external_pfr_pass_", "external_ftn_passer_", "external_ngs_passing_"
    elif market.startswith("rushing_"):
        pfr_prefix, ftn_prefix, ngs_prefix = "external_pfr_rush_", "external_ftn_rusher_", "external_ngs_rushing_"
    else:
        pfr_prefix, ftn_prefix, ngs_prefix = "external_pfr_rec_", "external_ftn_receiver_", "external_ngs_receiving_"
    pfr = [name for name in groups["pfr"] if name.startswith(pfr_prefix)]
    ftn = [name for name in groups["ftn"] if name.startswith(ftn_prefix)]
    ngs = [name for name in groups["ngs"] if name.startswith(ngs_prefix)]
    base = list(groups["base"])
    return {
        "state": [*base, *state],
        "state_pressure": [*base, *state, *pfr],
        "state_ftn": [*base, *state, *ftn],
        "state_ngs": [*base, *state, *ngs],
        "full_external": [*base, *state, *pfr, *ftn, *ngs],
    }


def model_kinds(market: str) -> tuple[str, ...]:
    if market in COUNT_MARKETS:
        return ("hgb_poisson", "hgb_squared")
    return ("hgb_squared", "hgb_absolute", "extra_trees_regularized")


def fit_predict(kind: str, train: pd.DataFrame, test: pd.DataFrame, features: list[str], target: str) -> np.ndarray:
    if kind == "hgb_poisson":
        model: Any = HistGradientBoostingRegressor(
            loss="poisson", max_iter=150, max_leaf_nodes=15, learning_rate=0.04,
            min_samples_leaf=35, l2_regularization=8.0, random_state=SEED,
        )
    elif kind == "hgb_squared":
        model = HistGradientBoostingRegressor(
            loss="squared_error", max_iter=150, max_leaf_nodes=15, learning_rate=0.04,
            min_samples_leaf=35, l2_regularization=8.0, random_state=SEED,
        )
    elif kind == "hgb_absolute":
        model = HistGradientBoostingRegressor(
            loss="absolute_error", max_iter=150, max_leaf_nodes=15, learning_rate=0.04,
            min_samples_leaf=35, l2_regularization=8.0, random_state=SEED,
        )
    elif kind == "extra_trees_regularized":
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
    return np.clip(np.asarray(model.predict(test[features]), dtype=float), 0.0, None)


def candidate_passes(reference: dict[str, float | int], candidate: dict[str, float | int], actual_mean: float) -> bool:
    return bool(
        float(candidate["mae"]) < float(reference["mae"])
        and float(candidate["rmse"]) < float(reference["rmse"])
        and abs(float(candidate["bias"])) <= abs(float(reference["bias"])) + 0.0025 * actual_mean
        and float(candidate["underpredictionRate"]) <= float(reference["underpredictionRate"]) + 0.0025
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path, default=DEFAULT_EXTERNAL_MANIFEST)
    parser.add_argument("--history-manifest", type=pathlib.Path, default=DEFAULT_HISTORY_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--projections", type=pathlib.Path, default=DEFAULT_PROJECTIONS)
    args = parser.parse_args()

    baseline = load_module("props_external_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_external_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    history = load_module("props_external_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    identity = load_module("props_external_identity", ROOT / "scripts/operator/tournament_nfl_player_props_opponent_matchup_identity.py")
    role = load_module("props_external_role", ROOT / "scripts/operator/tournament_nfl_player_props_role_volume_efficiency.py")
    trainer = load_module("props_external_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    opportunity = load_module("props_external_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    conditional = load_module("props_external_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())

    external_manifest = json.loads(args.external_manifest.read_text(encoding="utf-8"))
    external_path = pathlib.Path(external_manifest["featureFile"])
    if external_manifest.get("researchOnly") is not True or external_manifest.get("marketFeatures") != []:
        raise RuntimeError("external matrix safety contract mismatch")
    if sha256_file(external_path) != external_manifest.get("featureFileSha256"):
        raise RuntimeError("external matrix checksum mismatch")
    candidate_frame = pd.read_parquet(external_path)
    groups = {name: list(values) for name, values in external_manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        candidate_frame[column] = candidate_frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    all_features = list(dict.fromkeys(name for names in groups.values() for name in names))
    candidate_frame[all_features] = candidate_frame[all_features].replace([np.inf, -np.inf], np.nan)
    candidate_by_row = candidate_frame.set_index("row_id", drop=False)

    legacy_frame, _, base_features, enhanced_features, _ = role.corrected_frames(
        baseline, matchup, history, identity, args.history_manifest, contract,
    )
    legacy_eligible = {
        market: baseline.market_eligible(legacy_frame, contract["markets"][market])
        for market in MARKETS
    }
    candidate_eligible = {
        market: baseline.market_eligible(candidate_frame, contract["markets"][market])
        for market in MARKETS
    }

    evaluation_rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    predictions: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}

    # Candidate identity is frozen using only 2024 selection and 2025 confirmation.
    for season in (2024, 2025):
        print(f"external-feature tournament season {season}...", flush=True)
        incumbent_rows, incumbent_prediction, _ = opportunity.incumbent_predictions(
            trainer, legacy_frame, legacy_eligible, season, base_features, enhanced_features,
        )
        active_rows, active_prediction = conditional.conditional_predictions(
            trainer, legacy_frame, legacy_eligible, season, base_features, enhanced_features,
        )
        for market in MARKETS:
            participated = incumbent_rows[market]["participated"].eq(1).to_numpy()
            settled = incumbent_rows[market].loc[participated]
            if not settled[["row_id"]].reset_index(drop=True).equals(active_rows[market][["row_id"]].reset_index(drop=True)):
                raise RuntimeError(f"released row mismatch: {market} {season}")
            candidate_test = candidate_by_row.loc[settled["row_id"]].copy()
            released = incumbent_prediction[market][participated]
            if market == "rushing_attempts":
                released = 0.25 * released + 0.75 * active_prediction[market]
            evaluation_rows[market][season] = candidate_test
            actual[market][season] = candidate_test[market].to_numpy(float)
            reference[market][season] = released
            train = candidate_frame[
                candidate_eligible[market]
                & candidate_frame["participated"].eq(1)
                & candidate_frame["season"].lt(season)
            ]
            features_by_group = relevant_features(market, groups)
            for group in GROUPS:
                features = features_by_group[group]
                for kind in model_kinds(market):
                    raw = fit_predict(kind, train, candidate_test, features, market)
                    for weight in WEIGHTS:
                        name = f"{group}__{kind}__blend_{int(weight * 100)}"
                        value = (1.0 - weight) * released + weight * raw
                        predictions[market].setdefault(name, {})[season] = np.clip(value, 0.0, None)

    report: dict[str, Any] = {}
    frozen: dict[str, str | None] = {}
    for market in MARKETS:
        selection_reference = point_metrics(actual[market][2024], reference[market][2024])
        selection_candidates = {
            name: point_metrics(actual[market][2024], by_season[2024])
            for name, by_season in predictions[market].items()
        }
        mean_2024 = float(np.mean(actual[market][2024]))
        selectable = [
            name for name, metrics in selection_candidates.items()
            if candidate_passes(selection_reference, metrics, mean_2024)
        ]
        selected = min(
            selectable,
            key=lambda name: (
                float(selection_candidates[name]["mae"]) / float(selection_reference["mae"])
                + float(selection_candidates[name]["rmse"]) / float(selection_reference["rmse"])
            ),
        ) if selectable else None
        confirmation_reference = point_metrics(actual[market][2025], reference[market][2025])
        confirmation_candidate = point_metrics(actual[market][2025], predictions[market][selected][2025]) if selected else None
        confirmed = bool(
            selected
            and confirmation_candidate
            and float(confirmation_candidate["mae"]) <= float(confirmation_reference["mae"])
            and float(confirmation_candidate["rmse"]) <= float(confirmation_reference["rmse"])
            and abs(float(confirmation_candidate["bias"]))
            <= abs(float(confirmation_reference["bias"])) + 0.0025 * float(np.mean(actual[market][2025]))
        )
        frozen[market] = selected if confirmed else None
        report[market] = {
            "selection": {"reference": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"reference": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "frozen2026Candidate": frozen[market],
        }

    print("candidate identities frozen; opening 2026 Weeks 1-4...", flush=True)
    projection_frames: list[pd.DataFrame] = []
    for market in MARKETS:
        chosen = frozen[market]
        test = candidate_frame[
            candidate_eligible[market]
            & candidate_frame["participated"].eq(1)
            & candidate_frame["season"].eq(2026)
        ].copy()
        if chosen:
            group, kind, weight_name = chosen.split("__")
            weight = float(weight_name.removeprefix("blend_")) / 100.0
            train = candidate_frame[
                candidate_eligible[market]
                & candidate_frame["participated"].eq(1)
                & candidate_frame["season"].lt(2026)
            ]
            raw = fit_predict(kind, train, test, relevant_features(market, groups)[group], market)
            # A released-model blend cannot be reconstructed exactly for 2026
            # without reading mutable runtime state. Save its independent raw
            # component; exact locked-ledger blending happens in the replay.
            candidate_prediction = raw
        else:
            group, kind, weight = None, None, None
            candidate_prediction = np.full(len(test), np.nan)
        columns = [
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", market,
        ]
        output_rows = test[columns].copy()
        output_rows["market"] = market
        output_rows["candidate_name"] = chosen
        output_rows["candidate_group"] = group
        output_rows["candidate_kind"] = kind
        output_rows["frozen_blend_weight"] = weight
        output_rows["candidate_raw_projection"] = candidate_prediction
        projection_frames.append(output_rows.rename(columns={market: "actual"}))
        report[market]["currentSeason"] = {
            "rows": int(len(test)),
            "weeks": sorted(test["week"].astype(int).unique().tolist()),
            "rawCandidate": point_metrics(test[market].to_numpy(float), candidate_prediction) if chosen else None,
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.projections.parent.mkdir(parents=True, exist_ok=True)
    projection_frame = pd.concat(projection_frames, ignore_index=True)
    projection_frame.to_parquet(args.projections, index=False)
    output = {
        "release": "nfl_player_props_external_tournament_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025, "holdout": "2026 Weeks 1-4"},
        "externalManifestSha256": sha256_file(args.external_manifest),
        "projectionFile": str(args.projections.resolve()),
        "projectionFileSha256": sha256_file(args.projections),
        "frozenCandidates": frozen,
        "markets": report,
    }
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "projections": str(args.projections),
        "projectionSha256": output["projectionFileSha256"], "frozenCandidates": frozen,
        "currentSeason": {market: report[market]["currentSeason"] for market in MARKETS},
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
