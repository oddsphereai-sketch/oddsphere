#!/usr/bin/env python3
"""Test lagged NFL Next Gen Stats as price-blind player-prop features.

The source rows are weekly player summaries.  A game may only receive tracking
state computed through an earlier player-week, so the as-of join is strict and
cannot expose the current game's NGS measurements to its target.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from sklearn.metrics import mean_absolute_error, mean_squared_error


ROOT = pathlib.Path(__file__).resolve().parents[2]
SEASONS = (2023, 2024, 2025)
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
BLEND_WEIGHTS = (0.25, 0.50, 0.75, 1.0)
NGS_METRICS = {
    "passing": (
        "avg_time_to_throw", "avg_completed_air_yards", "avg_intended_air_yards",
        "avg_air_yards_differential", "aggressiveness", "avg_air_yards_to_sticks",
        "passer_rating", "completion_percentage", "expected_completion_percentage",
        "completion_percentage_above_expectation", "avg_air_distance",
    ),
    "receiving": (
        "avg_cushion", "avg_separation", "avg_intended_air_yards",
        "percent_share_of_intended_air_yards", "catch_percentage", "avg_yac",
        "avg_expected_yac", "avg_yac_above_expectation",
    ),
    "rushing": (
        "efficiency", "percent_attempts_gte_eight_defenders", "avg_time_to_los",
        "avg_rush_yards", "rush_yards_over_expected_per_att", "rush_pct_over_expected",
    ),
}
MARKET_DOMAIN = {
    "passing_attempts": "passing", "passing_completions": "passing", "passing_yards": "passing",
    "rushing_attempts": "rushing", "rushing_yards": "rushing",
    "receptions": "receiving", "receiving_yards": "receiving",
}


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def point_metrics(y: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(y)),
        "mae": float(mean_absolute_error(y, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(y, prediction))),
        "bias": float(np.mean(prediction - y)),
    }


def ngs_state(path: pathlib.Path, domain: str) -> tuple[pd.DataFrame, list[str]]:
    metrics = list(NGS_METRICS[domain])
    available = set(pq.read_schema(path).names)
    missing = sorted(set(metrics) - available)
    if missing:
        raise RuntimeError(f"{domain} NGS source missing columns: {missing}")
    rows = pq.read_table(
        path, columns=["season", "season_type", "week", "player_gsis_id", *metrics],
    ).to_pandas()
    rows = rows[
        rows["season_type"].fillna("").eq("REG")
        & pd.to_numeric(rows["week"], errors="coerce").gt(0)
        & rows["player_gsis_id"].notna()
    ].copy()
    rows["season"] = pd.to_numeric(rows["season"], errors="raise").astype(int)
    rows["week"] = pd.to_numeric(rows["week"], errors="raise").astype(int)
    rows["ngs_order"] = rows["season"] * 100 + rows["week"]
    rows = rows.sort_values(["player_gsis_id", "ngs_order"]).drop_duplicates(
        ["player_gsis_id", "ngs_order"], keep="last",
    )
    feature_names: list[str] = []
    for metric in metrics:
        rows[metric] = pd.to_numeric(rows[metric], errors="coerce")
        group = rows.groupby("player_gsis_id", observed=True)[metric]
        last = f"ngs_{domain}_{metric}_last"
        avg3 = f"ngs_{domain}_{metric}_avg3"
        ewm = f"ngs_{domain}_{metric}_ewm"
        rows[last] = rows[metric]
        rows[avg3] = group.transform(lambda values: values.rolling(3, min_periods=1).mean())
        rows[ewm] = group.transform(lambda values: values.ewm(alpha=0.35, adjust=False).mean())
        feature_names.extend((last, avg3, ewm))
    rows[f"ngs_{domain}_available"] = 1.0
    feature_names.append(f"ngs_{domain}_available")
    return rows[["player_gsis_id", "ngs_order", *feature_names]], feature_names


def add_ngs_features(
    frame: pd.DataFrame,
    paths: dict[str, pathlib.Path],
) -> tuple[pd.DataFrame, dict[str, list[str]], dict[str, Any]]:
    result = frame.copy()
    result["ngs_order"] = result["season"].astype(int) * 100 + result["week"].astype(int)
    result["ngs_row_order"] = np.arange(len(result))
    coverage: dict[str, Any] = {}
    names_by_domain: dict[str, list[str]] = {}
    for domain, path in paths.items():
        state, feature_names = ngs_state(path, domain)
        names_by_domain[domain] = feature_names
        left = result[["player_id", "ngs_order", "ngs_row_order"]].rename(
            columns={"player_id": "player_gsis_id"},
        ).sort_values(["ngs_order", "player_gsis_id"])
        right = state.sort_values(["ngs_order", "player_gsis_id"])
        joined = pd.merge_asof(
            left, right, on="ngs_order", by="player_gsis_id", direction="backward",
            allow_exact_matches=False,
        ).sort_values("ngs_row_order")
        if not np.array_equal(joined["ngs_row_order"].to_numpy(), np.arange(len(result))):
            raise RuntimeError(f"{domain} NGS join changed row identity")
        result[feature_names] = joined[feature_names].to_numpy()
        available = result[f"ngs_{domain}_available"].fillna(0.0)
        result[f"ngs_{domain}_available"] = available
        coverage[domain] = {
            "sourceRows": int(len(state)),
            "historyRowsWithPriorState": int(available.sum()),
            "historyCoverage": float(available.mean()),
            "bySeason": {
                str(season): float(available[result["season"].eq(season)].mean())
                for season in SEASONS
            },
            "featureCount": len(feature_names),
        }
    return result.drop(columns=["ngs_order", "ngs_row_order"]), names_by_domain, coverage


def fit_family(
    trainer: Any,
    frame: pd.DataFrame,
    eligible: dict[str, pd.Series],
    season: int,
    base_features: list[str],
    enhanced_features: list[str],
    ngs_features: dict[str, list[str]],
    contract: dict[str, Any],
) -> tuple[dict[str, pd.DataFrame], dict[str, np.ndarray], dict[str, dict[str, np.ndarray]]]:
    rows: dict[str, pd.DataFrame] = {}
    incumbent: dict[str, np.ndarray] = {}
    candidate: dict[str, dict[str, np.ndarray]] = {}
    for market in MARKETS:
        train = frame[eligible[market] & frame["season"].lt(season)]
        test = frame[eligible[market] & frame["season"].eq(season)]
        rows[market] = test
        _, incumbent[market] = trainer.fit_recipe(
            train, test, market, base_features, enhanced_features,
        )
        domain_features = [*enhanced_features, *ngs_features[MARKET_DOMAIN[market]]]
        _, recipe = trainer.fit_recipe(
            train, test, market, base_features, domain_features,
        )
        candidate[market] = {"ngs_recipe": recipe}
        for prefix, features in (("control", enhanced_features), ("ngs", domain_features)):
            regularized = trainer.model_for("regularized").fit(
                train[features], train[market].to_numpy(float),
            )
            candidate[market][f"{prefix}_regularized"] = np.clip(
                np.asarray(regularized.predict(test[features]), dtype=float), 0.0, None,
            )
            if contract["markets"][market]["distribution"] == "count":
                poisson = trainer.model_for("poisson").fit(
                    train[features], train[market].to_numpy(float),
                )
                candidate[market][f"{prefix}_poisson"] = np.clip(
                    np.asarray(poisson.predict(test[features]), dtype=float), 0.0, None,
                )

    qb_train = frame[eligible["passing_attempts"] & frame["season"].lt(season)]
    qb_test = rows["passing_attempts"]
    passing_features = [*enhanced_features, *ngs_features["passing"]]
    _, incumbent_completion_rate = trainer.fit_rate_model(
        qb_train, qb_test, enhanced_features, "passing_completions", "passing_attempts", True,
    )
    _, incumbent_yards_per_attempt = trainer.fit_rate_model(
        qb_train, qb_test, enhanced_features, "passing_yards", "passing_attempts", False,
    )
    _, candidate_completion_rate = trainer.fit_rate_model(
        qb_train, qb_test, passing_features, "passing_completions", "passing_attempts", True,
    )
    _, candidate_yards_per_attempt = trainer.fit_rate_model(
        qb_train, qb_test, passing_features, "passing_yards", "passing_attempts", False,
    )
    incumbent["passing_completions"] = np.minimum(
        incumbent["passing_attempts"],
        0.75 * incumbent["passing_attempts"] * incumbent_completion_rate
        + 0.25 * incumbent["passing_completions"],
    )
    incumbent["passing_yards"] = (
        0.75 * incumbent["passing_attempts"] * incumbent_yards_per_attempt
        + 0.25 * incumbent["passing_yards"]
    )
    candidate["passing_completions"]["ngs_recipe"] = np.minimum(
        candidate["passing_attempts"]["ngs_recipe"],
        0.75 * candidate["passing_attempts"]["ngs_recipe"] * candidate_completion_rate
        + 0.25 * candidate["passing_completions"]["ngs_recipe"],
    )
    candidate["passing_yards"]["ngs_recipe"] = (
        0.75 * candidate["passing_attempts"]["ngs_recipe"] * candidate_yards_per_attempt
        + 0.25 * candidate["passing_yards"]["ngs_recipe"]
    )
    return rows, incumbent, candidate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=pathlib.Path)
    parser.add_argument("--source-manifest", required=True, type=pathlib.Path)
    parser.add_argument("--ngs-passing", required=True, type=pathlib.Path)
    parser.add_argument("--ngs-receiving", required=True, type=pathlib.Path)
    parser.add_argument("--ngs-rushing", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()

    baseline = load_module("ngs_props_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("ngs_props_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("ngs_props_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    matchup.SOURCE_MANIFEST = args.source_manifest
    matchup_rows, matchup_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    frame, ngs_features, coverage = add_ngs_features(frame, {
        "passing": args.ngs_passing,
        "receiving": args.ngs_receiving,
        "rushing": args.ngs_rushing,
    })
    eligible = {market: baseline.market_eligible(frame, contract["markets"][market]) for market in MARKETS}

    rows_by_season: dict[int, dict[str, pd.DataFrame]] = {}
    actual = {market: {} for market in MARKETS}
    incumbent = {market: {} for market in MARKETS}
    candidate = {market: {} for market in MARKETS}
    for season in SEASONS:
        print(f"nextgen-efficiency season {season}...", flush=True)
        rows, incumbent_season, ngs_season = fit_family(
            trainer, frame, eligible, season, base_features, enhanced_features, ngs_features, contract,
        )
        rows_by_season[season] = rows
        for market in MARKETS:
            actual[market][season] = rows[market][market].to_numpy(float)
            incumbent[market][season] = np.clip(incumbent_season[market], 0.0, None)
            for architecture, architecture_prediction in ngs_season[market].items():
                for weight in BLEND_WEIGHTS:
                    name = f"{architecture}_blend_{int(weight * 100)}"
                    candidate[market].setdefault(name, {})[season] = np.clip(
                        (1.0 - weight) * incumbent_season[market] + weight * architecture_prediction,
                        0.0, None,
                    )

    report: dict[str, Any] = {}
    for market in MARKETS:
        selection_reference = point_metrics(actual[market][2023], incumbent[market][2023])
        selection_scores = {
            name: point_metrics(actual[market][2023], predictions[2023])
            for name, predictions in candidate[market].items()
        }
        passing = [name for name, score in selection_scores.items()
                   if float(score["mae"]) < float(selection_reference["mae"])
                   and float(score["rmse"]) < float(selection_reference["rmse"])]
        selected = min(passing, key=lambda name: (
            float(selection_scores[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_scores[name]["rmse"]) / float(selection_reference["rmse"])
        )) if passing else None
        confirmation_reference = point_metrics(actual[market][2024], incumbent[market][2024])
        confirmation_candidate = (
            point_metrics(actual[market][2024], candidate[market][selected][2024]) if selected else None
        )
        confirmed = bool(selected and confirmation_candidate
                         and float(confirmation_candidate["mae"]) < float(confirmation_reference["mae"])
                         and float(confirmation_candidate["rmse"]) < float(confirmation_reference["rmse"]))
        holdout_reference = point_metrics(actual[market][2025], incumbent[market][2025])
        holdout_candidate = (
            point_metrics(actual[market][2025], candidate[market][selected][2025])
            if confirmed and selected else None
        )
        passed_holdout = bool(holdout_candidate
                              and float(holdout_candidate["mae"]) < float(holdout_reference["mae"])
                              and float(holdout_candidate["rmse"]) < float(holdout_reference["rmse"]))
        clustered = (
            baseline.cluster_bootstrap_delta(
                rows_by_season[2025][market],
                np.abs(actual[market][2025] - candidate[market][selected][2025]),
                np.abs(actual[market][2025] - incumbent[market][2025]),
            ) if confirmed and selected else None
        )
        report[market] = {
            "domain": MARKET_DOMAIN[market],
            "selection": {"incumbent": selection_reference, "candidates": selection_scores, "selected": selected},
            "confirmation": {"incumbent": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "holdout": {"incumbent": holdout_reference, "candidate": holdout_candidate, "passed": passed_holdout,
                        "clusteredMaeDelta": clustered},
            "eligibleForPromotion": bool(confirmed and passed_holdout),
        }

    output = {
        "release": "nfl_player_props_nextgen_efficiency_tournament_2026_10_08_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "leakageControls": {
            "targetPricesUsed": False,
            "seasonSummaryRowsUsed": False,
            "currentPlayerWeekUsed": False,
            "join": "strict backward player-id as-of join",
        },
        "incumbentBoundary": "full-family r2 point recipes; active settlement-aligned rushing-attempts r8 requires a second comparison before promotion",
        "coverage": coverage,
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {market: {
            "selected": values["selection"]["selected"],
            "confirmed": values["confirmation"]["confirmed"],
            "holdoutPassed": values["holdout"]["passed"],
            "holdout": values["holdout"],
        } for market, values in report.items()},
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
