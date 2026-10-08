#!/usr/bin/env python3
"""Frozen team-budget × player-share × efficiency NFL props tournament."""

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
from sklearn.ensemble import HistGradientBoostingRegressor


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r2.manifest.json"
DEFAULT_HISTORY_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_opportunity_efficiency_external_r1.json"
DEFAULT_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_opportunity_efficiency_2026_projections_r1.parquet"
MARKETS = ("rushing_attempts", "rushing_yards", "receptions", "receiving_yards")
RELEASE_MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
WEIGHTS = (0.25, 0.50, 0.75, 1.0)
SEED = 20261008
OPPORTUNITIES = {
    "rushing": {
        "budget": "rushing_attempts",
        "share": "rush_attempt_share",
        "positions": ("QB", "RB", "FB", "WR", "TE"),
    },
    "receiving": {
        "budget": "targets",
        "share": "target_share",
        "positions": ("RB", "FB", "WR", "TE"),
    },
}


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


def model(loss: str) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss=loss,
        max_iter=170,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=35,
        l2_regularization=10.0,
        random_state=SEED,
    )


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = prediction - actual
    return {
        "rows": int(len(actual)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
        "underpredictionRate": float(np.mean(prediction < actual)),
    }


def team_games(frame: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team"]
    outcomes = frame.groupby(keys, observed=True, as_index=False).agg(
        rushing_attempts=("rushing_attempts", "sum"),
        targets=("targets", "sum"),
    )
    context = frame.sort_values([*keys, "player_id"]).drop_duplicates(keys)[[*keys, *features]]
    return outcomes.merge(context, on=keys, validate="one_to_one")


def budget_predictions(teams: pd.DataFrame, season: int, features: list[str], target: str) -> tuple[pd.Series, dict[str, float | int]]:
    train = teams[teams["season"].lt(season)]
    test = teams[teams["season"].eq(season)]
    fitted = model("poisson").fit(train[features], train[target].to_numpy(float))
    prediction = np.clip(np.asarray(fitted.predict(test[features]), dtype=float), 1e-6, None)
    index = pd.MultiIndex.from_frame(test[["game_id", "team"]])
    return pd.Series(prediction, index=index), point_metrics(test[target].to_numpy(float), prediction)


def share_predictions(
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    share: str,
    positions: tuple[str, ...],
    test: pd.DataFrame,
) -> np.ndarray:
    train = frame[
        frame["season"].lt(season)
        & frame["participated"].eq(1)
        & frame["position"].isin(positions)
        & frame["prior_roster_game_rows"].ge(1)
    ]
    fitted = model("squared_error").fit(train[features], train[share].to_numpy(float))
    return np.clip(np.asarray(fitted.predict(test[features]), dtype=float), 0.0, 1.0)


def rate_predictions(
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    numerator: str,
    denominator: str,
    test: pd.DataFrame,
    lower: float,
    upper: float,
) -> np.ndarray:
    usable = frame[denominator].gt(0) & frame["participated"].eq(1) & frame["season"].lt(season)
    train = frame[usable].copy()
    rate = (train[numerator] / train[denominator]).clip(lower, upper)
    fitted = model("squared_error").fit(train[features], rate.to_numpy(float))
    return np.clip(np.asarray(fitted.predict(test[features]), dtype=float), lower, upper)


def hierarchy_predictions(
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    team_features: list[str],
    player_features: dict[str, list[str]],
    test_rows: dict[str, pd.DataFrame],
) -> tuple[dict[str, np.ndarray], dict[str, dict[str, float | int]]]:
    budgets: dict[str, pd.Series] = {}
    diagnostics: dict[str, dict[str, float | int]] = {}
    for name, config in OPPORTUNITIES.items():
        budgets[name], diagnostics[name] = budget_predictions(teams, season, team_features, str(config["budget"]))

    rush_rows = test_rows["rushing_attempts"]
    rush_share = share_predictions(
        frame, season, player_features["rushing"], "rush_attempt_share",
        OPPORTUNITIES["rushing"]["positions"], rush_rows,
    )
    rush_budget = budgets["rushing"].reindex(pd.MultiIndex.from_frame(rush_rows[["game_id", "team"]])).to_numpy(float)
    rush_attempts = np.clip(rush_budget * rush_share, 0.0, None)
    yards_per_carry = rate_predictions(
        frame, season, player_features["rushing"], "rushing_yards", "rushing_attempts",
        rush_rows, 0.0, 15.0,
    )

    receiving_rows = test_rows["receptions"]
    target_share = share_predictions(
        frame, season, player_features["receiving"], "target_share",
        OPPORTUNITIES["receiving"]["positions"], receiving_rows,
    )
    target_budget = budgets["receiving"].reindex(pd.MultiIndex.from_frame(receiving_rows[["game_id", "team"]])).to_numpy(float)
    targets = np.clip(target_budget * target_share, 0.0, None)
    catch_rate = rate_predictions(
        frame, season, player_features["receiving"], "receptions", "targets",
        receiving_rows, 0.0, 1.0,
    )
    yards_per_target = rate_predictions(
        frame, season, player_features["receiving"], "receiving_yards", "targets",
        receiving_rows, 0.0, 30.0,
    )
    return {
        "rushing_attempts": rush_attempts,
        "rushing_yards": rush_attempts * yards_per_carry,
        "receptions": targets * catch_rate,
        "receiving_yards": targets * yards_per_target,
    }, diagnostics


def relevant_external_features(market: str, groups: dict[str, list[str]]) -> list[str]:
    base = list(groups["base"])
    state = list(groups["state"])
    if market == "rushing":
        external = [
            name for name in [*groups["pfr"], *groups["ftn"], *groups["ngs"]]
            if name.startswith(("external_pfr_rush_", "external_ftn_rusher_", "external_ngs_rushing_"))
        ]
    else:
        external = [
            name for name in [*groups["pfr"], *groups["ftn"], *groups["ngs"]]
            if name.startswith(("external_pfr_rec_", "external_ftn_receiver_", "external_ngs_receiving_"))
        ]
    return list(dict.fromkeys([*base, *state, *external]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path, default=DEFAULT_EXTERNAL_MANIFEST)
    parser.add_argument("--history-manifest", type=pathlib.Path, default=DEFAULT_HISTORY_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--projections", type=pathlib.Path, default=DEFAULT_PROJECTIONS)
    args = parser.parse_args()

    baseline = load_module("props_hierarchy_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_hierarchy_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    history = load_module("props_hierarchy_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    identity = load_module("props_hierarchy_identity", ROOT / "scripts/operator/tournament_nfl_player_props_opponent_matchup_identity.py")
    role = load_module("props_hierarchy_role", ROOT / "scripts/operator/tournament_nfl_player_props_role_volume_efficiency.py")
    trainer = load_module("props_hierarchy_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    opportunity = load_module("props_hierarchy_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    conditional = load_module("props_hierarchy_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())

    manifest = json.loads(args.external_manifest.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame = pd.read_parquet(feature_path)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = {
        "rushing": relevant_external_features("rushing", groups),
        "receiving": relevant_external_features("receiving", groups),
    }
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home"
        or name.startswith(("prior_team_", "prior_opponent_", "external_state_team_", "external_state_opponent_", "external_environment_"))
    ]
    all_features = list(dict.fromkeys([*team_features, *player_features["rushing"], *player_features["receiving"]]))
    frame[all_features] = frame[all_features].replace([np.inf, -np.inf], np.nan)
    teams = team_games(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)
    candidate_eligible = {
        market: baseline.market_eligible(frame, contract["markets"][market])
        for market in MARKETS
    }

    legacy, _, base_features, enhanced_features, _ = role.corrected_frames(
        baseline, matchup, history, identity, args.history_manifest, contract,
    )
    legacy_eligible = {
        market: baseline.market_eligible(legacy, contract["markets"][market])
        for market in RELEASE_MARKETS
    }
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}
    evaluation_rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    budget_diagnostics: dict[int, Any] = {}

    for season in (2024, 2025):
        print(f"opportunity-efficiency season {season}...", flush=True)
        incumbent_rows, incumbent_prediction, _ = opportunity.incumbent_predictions(
            trainer, legacy, legacy_eligible, season, base_features, enhanced_features,
        )
        active_rows, active_prediction = conditional.conditional_predictions(
            trainer, legacy, legacy_eligible, season, base_features, enhanced_features,
        )
        candidate_rows: dict[str, pd.DataFrame] = {}
        for market in MARKETS:
            participated = incumbent_rows[market]["participated"].eq(1).to_numpy()
            settled = incumbent_rows[market].loc[participated]
            if not settled[["row_id"]].reset_index(drop=True).equals(active_rows[market][["row_id"]].reset_index(drop=True)):
                raise RuntimeError(f"released row mismatch: {market} {season}")
            candidate_rows[market] = by_row.loc[settled["row_id"]].copy()
            evaluation_rows[market][season] = candidate_rows[market]
            actual[market][season] = candidate_rows[market][market].to_numpy(float)
            released = incumbent_prediction[market][participated]
            if market == "rushing_attempts":
                released = 0.25 * released + 0.75 * active_prediction[market]
            reference[market][season] = released
        architecture, budget_diagnostics[season] = hierarchy_predictions(
            frame, teams, season, team_features, player_features,
            {
                "rushing_attempts": candidate_rows["rushing_attempts"],
                "receptions": candidate_rows["receptions"],
            },
        )
        for market in MARKETS:
            for weight in WEIGHTS:
                name = f"hierarchy_blend_{int(weight * 100)}"
                candidates[market].setdefault(name, {})[season] = np.clip(
                    (1.0 - weight) * reference[market][season] + weight * architecture[market], 0.0, None,
                )

    report: dict[str, Any] = {}
    frozen: dict[str, str | None] = {}
    for market in MARKETS:
        selection_reference = point_metrics(actual[market][2024], reference[market][2024])
        selection_candidates = {
            name: point_metrics(actual[market][2024], values[2024])
            for name, values in candidates[market].items()
        }
        mean_2024 = float(np.mean(actual[market][2024]))
        selectable = [name for name, values in selection_candidates.items() if (
            float(values["mae"]) < float(selection_reference["mae"])
            and float(values["rmse"]) < float(selection_reference["rmse"])
            and abs(float(values["bias"])) <= abs(float(selection_reference["bias"])) + 0.0025 * mean_2024
            and float(values["underpredictionRate"]) <= float(selection_reference["underpredictionRate"]) + 0.0025
        )]
        selected = min(selectable, key=lambda name: (
            float(selection_candidates[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_candidates[name]["rmse"]) / float(selection_reference["rmse"])
        )) if selectable else None
        confirmation_reference = point_metrics(actual[market][2025], reference[market][2025])
        confirmation_candidate = point_metrics(actual[market][2025], candidates[market][selected][2025]) if selected else None
        confirmed = bool(
            selected and confirmation_candidate
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

    print("hierarchy identities frozen; opening diagnostic 2026 Weeks 1-4...", flush=True)
    diagnostic_rows = {
        market: frame[
            candidate_eligible[market]
            & frame["participated"].eq(1)
            & frame["season"].eq(2026)
        ].copy()
        for market in MARKETS
    }
    architecture_2026, budget_diagnostics[2026] = hierarchy_predictions(
        frame, teams, 2026, team_features, player_features,
        {"rushing_attempts": diagnostic_rows["rushing_attempts"], "receptions": diagnostic_rows["receptions"]},
    )
    for market in MARKETS:
        chosen = frozen[market]
        if chosen:
            weight = float(chosen.removeprefix("hierarchy_blend_")) / 100.0
            # The exact released component is available only in locked records;
            # report pure hierarchy diagnostics here when a blend was frozen.
            raw = architecture_2026[market]
            report[market]["currentSeasonDiagnostic"] = {
                "rows": int(len(diagnostic_rows[market])),
                "weeks": sorted(diagnostic_rows[market]["week"].astype(int).unique().tolist()),
                "frozenBlendWeight": weight,
                "pureHierarchy": point_metrics(diagnostic_rows[market][market].to_numpy(float), raw),
            }
        else:
            report[market]["currentSeasonDiagnostic"] = None

    projection_frames: list[pd.DataFrame] = []
    for market in MARKETS:
        chosen = frozen[market]
        if not chosen:
            continue
        weight = float(chosen.removeprefix("hierarchy_blend_")) / 100.0
        for season, phase in ((2024, "selection"), (2025, "confirmation")):
            rows = evaluation_rows[market][season]
            values = rows[[
                "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                "player_name", "position", market,
            ]].copy().rename(columns={market: "actual"})
            values["market"] = market
            values["phase"] = phase
            values["candidate_name"] = chosen
            values["frozen_blend_weight"] = weight
            values["candidate_projection"] = candidates[market][chosen][season]
            values["component_projection"] = np.nan
            values["released_projection"] = reference[market][season]
            projection_frames.append(values)
        rows = diagnostic_rows[market]
        values = rows[[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", market,
        ]].copy().rename(columns={market: "actual"})
        values["market"] = market
        values["phase"] = "diagnostic"
        values["candidate_name"] = chosen
        values["frozen_blend_weight"] = weight
        values["candidate_projection"] = np.nan
        values["component_projection"] = architecture_2026[market]
        values["released_projection"] = np.nan
        projection_frames.append(values)

    args.projections.parent.mkdir(parents=True, exist_ok=True)
    projections = pd.concat(projection_frames, ignore_index=True)
    projections.to_parquet(args.projections, index=False)

    output = {
        "release": "nfl_player_props_opportunity_efficiency_external_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketFeatures": [],
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025, "diagnostic": "2026 Weeks 1-4 already opened"},
        "externalManifestSha256": sha256_file(args.external_manifest),
        "projectionFile": str(args.projections.resolve()),
        "projectionFileSha256": sha256_file(args.projections),
        "componentContract": {
            "teamBudget": "Poisson HGB",
            "playerShare": "squared-error HGB clipped to [0,1]",
            "executionRate": "bounded squared-error HGB",
            "blendWeights": WEIGHTS,
        },
        "budgetDiagnostics": budget_diagnostics,
        "frozenCandidates": frozen,
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "frozenCandidates": frozen,
        "budgetDiagnostics": budget_diagnostics,
        "markets": report,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
