#!/usr/bin/env python3
"""Roster-constrained expected-role NFL player-props tournament."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import re
import sys
import time
import unicodedata
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.manifest.json"
DEFAULT_HISTORY_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_INJURY_ROOT = ROOT / "football-research/cache/nfl-player-props-external/injuries"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_r1.json"
DEFAULT_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
WEIGHTS = (0.50, 0.75, 1.0)
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


def normalize_player(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


def model(loss: str, minimum_leaf: int = 35) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss=loss,
        max_iter=180,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=minimum_leaf,
        l2_regularization=12.0,
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


def group_name(position: pd.Series) -> pd.Series:
    return np.select(
        [position.eq("QB"), position.isin(["RB", "FB"]), position.eq("WR"), position.eq("TE")],
        ["QB", "BACK", "WR", "TE"],
        default="OTHER",
    )


def add_role_shares(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    result["expected_role_group"] = group_name(result["position"])
    keys = ["season", "week", "game_id", "team", "expected_role_group"]
    rush_total = result.groupby(keys, observed=True)["rushing_attempts"].transform("sum")
    target_total = result.groupby(keys, observed=True)["targets"].transform("sum")
    result["expected_role_rush_share"] = np.where(
        rush_total.gt(0), result["rushing_attempts"] / rush_total, 0.0,
    )
    result["expected_role_target_share"] = np.where(
        target_total.gt(0), result["targets"] / target_total, 0.0,
    )
    return result


def team_table(frame: pd.DataFrame, team_features: list[str]) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team"]
    outcomes = frame.groupby(keys, observed=True, as_index=False).agg(
        team_pass_attempts=("passing_attempts", "sum"),
        team_targets=("targets", "sum"),
        team_rush_attempts=("rushing_attempts", "sum"),
    )
    context = frame.sort_values([*keys, "player_id"]).drop_duplicates(keys)[[*keys, *team_features]]
    return outcomes.merge(context, on=keys, validate="one_to_one")


def group_table(frame: pd.DataFrame, team_features: list[str]) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team", "expected_role_group"]
    outcomes = frame.groupby(keys, observed=True, as_index=False).agg(
        rushing_attempts=("rushing_attempts", "sum"),
        targets=("targets", "sum"),
    )
    context = frame.sort_values([*keys, "player_id"]).drop_duplicates(keys)[[*keys, *team_features]]
    return outcomes.merge(context, on=keys, validate="one_to_one")


def budget_prediction(
    table: pd.DataFrame,
    season: int,
    features: list[str],
    target: str,
    test_keys: pd.DataFrame,
    group: str | None = None,
) -> np.ndarray:
    train = table[table["season"].lt(season)]
    current = table[table["season"].eq(season)]
    keys = ["game_id", "team"]
    if group is not None:
        train = train[train["expected_role_group"].eq(group)]
        current = current[current["expected_role_group"].eq(group)]
        keys.append("expected_role_group")
    fitted = model("poisson").fit(train[features], train[target].to_numpy(float))
    prediction = np.clip(np.asarray(fitted.predict(current[features]), dtype=float), 1e-6, None)
    indexed = pd.Series(prediction, index=pd.MultiIndex.from_frame(current[keys]))
    requested = test_keys.copy()
    if group is not None:
        requested["expected_role_group"] = group
    return indexed.reindex(pd.MultiIndex.from_frame(requested[keys])).to_numpy(float)


def normalized_share_prediction(
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    share: str,
    group: str,
    test: pd.DataFrame,
    known_active_row_ids: set[str] | None = None,
) -> np.ndarray:
    population = frame[frame["season"].lt(season) & frame["expected_role_group"].eq(group)].copy()
    active = population[population["participated"].eq(1)].copy()
    fitted = model("squared_error").fit(active[features], active[share].fillna(0.0).to_numpy(float))
    participation = HistGradientBoostingClassifier(
        max_iter=140,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=35,
        l2_regularization=12.0,
        random_state=SEED,
    ).fit(population[features], population["participated"].to_numpy(int))
    roster = frame[
        frame["season"].eq(season)
        & frame["expected_role_group"].eq(group)
        & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
    ].copy()
    active_probability = np.asarray(participation.predict_proba(roster[features])[:, 1], dtype=float)
    # A posted prop is legitimate pregame evidence that the named player is
    # expected to participate.  It does not reveal the line or price.  Keep
    # that evidence separate from the evaluation population: marking every
    # player who later recorded a stat as active would leak the box score and
    # dilute the offered player's roster share.
    active_ids = known_active_row_ids if known_active_row_ids is not None else set(test["row_id"])
    offered = roster["row_id"].isin(active_ids)
    active_probability[offered.to_numpy()] = 1.0
    conditional_share = np.clip(np.asarray(fitted.predict(roster[features]), dtype=float), 0.0, 1.0)
    roster["raw_expected_share"] = active_probability * conditional_share
    denominator = roster.groupby(["game_id", "team"], observed=True)["raw_expected_share"].transform("sum")
    roster["normalized_expected_share"] = np.where(
        denominator.gt(0), roster["raw_expected_share"] / denominator, 0.0,
    )
    by_row = roster.set_index("row_id")["normalized_expected_share"]
    missing = ~test["row_id"].isin(by_row.index)
    values = by_row.reindex(test["row_id"]).to_numpy(float)
    if missing.any():
        fallback = np.clip(np.asarray(fitted.predict(test.loc[missing, features]), dtype=float), 0.0, 1.0)
        values[missing.to_numpy()] = fallback
    return values


def rate_prediction(
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    numerator: str,
    denominator: str,
    group: str,
    test: pd.DataFrame,
    lower: float,
    upper: float,
) -> np.ndarray:
    train = frame[
        frame["season"].lt(season)
        & frame["expected_role_group"].eq(group)
        & frame[denominator].gt(0)
        & frame["participated"].eq(1)
    ].copy()
    rate = (train[numerator] / train[denominator]).clip(lower, upper)
    fitted = model("squared_error").fit(train[features], rate.to_numpy(float))
    return np.clip(np.asarray(fitted.predict(test[features]), dtype=float), lower, upper)


def lead_passer_rows(frame: pd.DataFrame) -> pd.DataFrame:
    qbs = frame[frame["position"].eq("QB")].copy()
    qbs = qbs.sort_values(
        ["season", "week", "game_id", "team", "passing_attempts", "player_id"],
        ascending=[True, True, True, True, False, True],
    )
    return qbs.drop_duplicates(["season", "week", "game_id", "team"], keep="first")


def passing_predictions(
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    team_features: list[str],
    player_features: list[str],
    test: pd.DataFrame,
) -> dict[str, np.ndarray]:
    leaders = lead_passer_rows(frame)
    training = leaders[leaders["season"].lt(season) & leaders["passing_attempts"].gt(0)].copy()
    team_attempts = teams.set_index(["season", "game_id", "team"])["team_pass_attempts"]
    leader_keys = pd.MultiIndex.from_frame(training[["season", "game_id", "team"]])
    training["lead_pass_share"] = (
        training["passing_attempts"].to_numpy(float) / team_attempts.reindex(leader_keys).to_numpy(float)
    )
    share_model = model("squared_error").fit(
        training[player_features], training["lead_pass_share"].clip(0.50, 1.0),
    )
    share = np.clip(np.asarray(share_model.predict(test[player_features]), dtype=float), 0.50, 1.0)
    budget = budget_prediction(teams, season, team_features, "team_pass_attempts", test[["game_id", "team"]])
    attempts = np.clip(budget * share, 0.0, None)

    completion_train = training[training["passing_attempts"].ge(5)].copy()
    completion_rate = (completion_train["passing_completions"] / completion_train["passing_attempts"]).clip(0.30, 0.85)
    completion_model = model("squared_error").fit(completion_train[player_features], completion_rate)
    predicted_completion_rate = np.clip(
        np.asarray(completion_model.predict(test[player_features]), dtype=float), 0.30, 0.85,
    )
    ypa = (completion_train["passing_yards"] / completion_train["passing_attempts"]).clip(2.0, 14.0)
    ypa_model = model("absolute_error").fit(completion_train[player_features], ypa)
    predicted_ypa = np.clip(np.asarray(ypa_model.predict(test[player_features]), dtype=float), 2.0, 14.0)
    return {
        "passing_attempts": attempts,
        "passing_completions": np.minimum(attempts, attempts * predicted_completion_rate),
        "passing_yards": attempts * predicted_ypa,
    }


def role_predictions(
    frame: pd.DataFrame,
    groups: pd.DataFrame,
    season: int,
    team_features: list[str],
    player_features: list[str],
    test_rows: dict[str, pd.DataFrame],
    known_active_row_ids: set[str] | None = None,
) -> dict[str, np.ndarray]:
    outputs: dict[str, np.ndarray] = {}
    for market, budget_target, share_target, numerator, denominator, lower, upper in (
        ("rushing_attempts", "rushing_attempts", "expected_role_rush_share", None, None, 0.0, 0.0),
        ("rushing_yards", "rushing_attempts", "expected_role_rush_share", "rushing_yards", "rushing_attempts", 0.0, 15.0),
        ("receptions", "targets", "expected_role_target_share", "receptions", "targets", 0.0, 1.0),
        ("receiving_yards", "targets", "expected_role_target_share", "receiving_yards", "targets", 0.0, 30.0),
    ):
        test = test_rows[market]
        prediction = np.zeros(len(test), dtype=float)
        for group in sorted(test["expected_role_group"].unique()):
            mask = test["expected_role_group"].eq(group).to_numpy()
            subset = test.loc[mask]
            budget = budget_prediction(
                groups, season, team_features, budget_target,
                subset[["game_id", "team"]], group,
            )
            share = normalized_share_prediction(
                frame, season, player_features, share_target, group, subset, known_active_row_ids,
            )
            opportunity = np.clip(budget * share, 0.0, None)
            if numerator is None or denominator is None:
                value = opportunity
            else:
                rate = rate_prediction(
                    frame, season, player_features, numerator, denominator,
                    group, subset, lower, upper,
                )
                value = opportunity * rate
            prediction[mask] = value
        outputs[market] = prediction
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path, default=DEFAULT_EXTERNAL_MANIFEST)
    parser.add_argument("--history-manifest", type=pathlib.Path, default=DEFAULT_HISTORY_MANIFEST)
    parser.add_argument("--injury-root", type=pathlib.Path, default=DEFAULT_INJURY_ROOT)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--projections", type=pathlib.Path, default=DEFAULT_PROJECTIONS)
    parser.add_argument(
        "--offered-replay",
        type=pathlib.Path,
        help="Optional immutable replay rows; only week/player/team/market presence is consumed.",
    )
    args = parser.parse_args()

    baseline = load_module("props_expected_role_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_expected_role_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    history = load_module("props_expected_role_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    identity = load_module("props_expected_role_identity", ROOT / "scripts/operator/tournament_nfl_player_props_opponent_matchup_identity.py")
    role = load_module("props_expected_role_prior_role", ROOT / "scripts/operator/tournament_nfl_player_props_role_volume_efficiency.py")
    trainer = load_module("props_expected_role_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    prior_opportunity = load_module("props_expected_role_prior_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    conditional = load_module("props_expected_role_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    external = load_module("props_expected_role_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py")
    hierarchy = load_module("props_expected_role_hierarchy", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_efficiency_external.py")
    availability = load_module("props_expected_role_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())

    manifest = json.loads(args.external_manifest.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(pd.read_parquet(feature_path), args.injury_root)
    frame = add_role_shares(frame)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("passing_yards", groups)["full_external"],
        *external.relevant_features("rushing_yards", groups)["full_external"],
        *external.relevant_features("receiving_yards", groups)["full_external"],
        *groups.get("depth", []),
        *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    numeric_features = list(dict.fromkeys([*player_features, *team_features]))
    frame[numeric_features] = frame[numeric_features].replace([np.inf, -np.inf], np.nan)
    teams = team_table(frame, team_features)
    opportunity_groups = group_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)
    legacy, _, base_features, enhanced_features, _ = role.corrected_frames(
        baseline, matchup, history, identity, args.history_manifest, contract,
    )
    legacy_eligible = {market: baseline.market_eligible(legacy, contract["markets"][market]) for market in MARKETS}
    candidate_eligible = {market: baseline.market_eligible(frame, contract["markets"][market]) for market in MARKETS}

    evaluation_rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    components: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}

    for season in (2024, 2025):
        print(f"expected-role season {season}...", flush=True)
        incumbent_rows, incumbent_prediction, _ = prior_opportunity.incumbent_predictions(
            trainer, legacy, legacy_eligible, season, base_features, enhanced_features,
        )
        active_rows, active_prediction = conditional.conditional_predictions(
            trainer, legacy, legacy_eligible, season, base_features, enhanced_features,
        )
        test_rows: dict[str, pd.DataFrame] = {}
        for market in MARKETS:
            participated = incumbent_rows[market]["participated"].eq(1).to_numpy()
            settled = incumbent_rows[market].loc[participated]
            released = incumbent_prediction[market][participated]
            if market == "rushing_attempts":
                released = 0.25 * released + 0.75 * active_prediction[market]
            test = by_row.loc[settled["row_id"]].copy()
            if market.startswith("passing_"):
                starter = test["external_depth_starter"].eq(1).to_numpy()
                if int(starter.sum()) >= 100:
                    test = test.loc[starter]
                    released = released[starter]
            test_rows[market] = test
            evaluation_rows[market][season] = test
            actual[market][season] = test[market].to_numpy(float)
            reference[market][season] = released

        passing = passing_predictions(frame, teams, season, team_features, player_features, test_rows["passing_attempts"])
        for market in ("passing_attempts", "passing_completions", "passing_yards"):
            if not test_rows[market][["row_id"]].reset_index(drop=True).equals(test_rows["passing_attempts"][["row_id"]].reset_index(drop=True)):
                passing[market] = passing_predictions(frame, teams, season, team_features, player_features, test_rows[market])[market]
            components[market][season] = passing[market]
        role_outputs = role_predictions(
            frame, opportunity_groups, season, team_features, player_features,
            {market: test_rows[market] for market in ("rushing_attempts", "rushing_yards", "receptions", "receiving_yards")},
        )
        for market in ("rushing_attempts", "rushing_yards", "receptions", "receiving_yards"):
            components[market][season] = role_outputs[market]
        for market in MARKETS:
            for weight in WEIGHTS:
                name = f"expected_role_blend_{int(weight * 100)}"
                candidates[market].setdefault(name, {})[season] = np.clip(
                    (1.0 - weight) * reference[market][season] + weight * components[market][season], 0.0, None,
                )

    report: dict[str, Any] = {}
    frozen: dict[str, str | None] = {}
    for market in MARKETS:
        selection_reference = point_metrics(actual[market][2024], reference[market][2024])
        selection_candidates = {name: point_metrics(actual[market][2024], values[2024]) for name, values in candidates[market].items()}
        selectable = [
            name for name, metrics in selection_candidates.items()
            if float(metrics["mae"]) < float(selection_reference["mae"])
            and float(metrics["rmse"]) < float(selection_reference["rmse"])
        ]
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
        )
        frozen[market] = selected if confirmed else None
        report[market] = {
            "selection": {"reference": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"reference": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "frozen2026Candidate": frozen[market],
        }

    print("expected-role identities frozen; opening 2026 Weeks 1-4...", flush=True)
    diagnostic_rows = {
        market: frame[
            frame["participated"].eq(1)
            & frame["season"].eq(2026)
            & frame["position"].isin(contract["markets"][market]["positions"])
            & (candidate_eligible[market] | frame["external_depth_listed"].eq(1))
        ].copy()
        for market in MARKETS
    }
    diagnostic_components: dict[str, np.ndarray] = {}
    for market in ("passing_attempts", "passing_completions", "passing_yards"):
        diagnostic_components[market] = passing_predictions(
            frame, teams, 2026, team_features, player_features, diagnostic_rows[market],
        )[market]
    diagnostic_roles = role_predictions(
        frame, opportunity_groups, 2026, team_features, player_features,
        {market: diagnostic_rows[market] for market in ("rushing_attempts", "rushing_yards", "receptions", "receiving_yards")},
    )
    diagnostic_components.update(diagnostic_roles)

    offered_rows: dict[str, pd.DataFrame] | None = None
    offered_components: dict[str, np.ndarray] = {}
    if args.offered_replay:
        replay_payload = json.loads(args.offered_replay.read_text(encoding="utf-8"))
        replay = pd.DataFrame(replay_payload["rows"])[["week", "playerName", "team", "market"]].copy()
        replay = replay[replay["market"].isin(MARKETS)]
        replay["normalized_player"] = replay["playerName"].map(normalize_player)
        replay = replay.drop_duplicates(["week", "team", "market", "normalized_player"])
        offered_frame = frame[frame["season"].eq(2026)].copy()
        offered_frame["normalized_player"] = offered_frame["player_name"].map(normalize_player)
        offered_rows = {}
        for market in MARKETS:
            requested = replay[replay["market"].eq(market)]
            matched_rows = requested.merge(
                offered_frame,
                on=["week", "team", "normalized_player"],
                how="left",
                validate="one_to_one",
            )
            missing = matched_rows["row_id"].isna()
            if missing.any():
                raise RuntimeError(
                    f"unmatched offered {market} rows: "
                    + repr(matched_rows.loc[missing, ["week", "playerName", "team"]].to_dict("records"))
                )
            offered_rows[market] = matched_rows
        known_active_row_ids = {
            str(row_id)
            for market_rows in offered_rows.values()
            for row_id in market_rows["row_id"]
        }
        for market in ("passing_attempts", "passing_completions", "passing_yards"):
            offered_components[market] = passing_predictions(
                frame, teams, 2026, team_features, player_features, offered_rows[market],
            )[market]
        offered_components.update(role_predictions(
            frame, opportunity_groups, 2026, team_features, player_features,
            {market: offered_rows[market] for market in ("rushing_attempts", "rushing_yards", "receptions", "receiving_yards")},
            known_active_row_ids,
        ))

    projection_frames: list[pd.DataFrame] = []
    for market in MARKETS:
        chosen = frozen[market]
        if not chosen:
            report[market]["currentSeason"] = None
            continue
        weight = float(chosen.rsplit("_", 1)[-1]) / 100.0
        for season, phase in ((2024, "selection"), (2025, "confirmation")):
            rows = evaluation_rows[market][season]
            values = rows[[
                "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                "player_name", "position", market,
            ]].copy().rename(columns={market: "actual"})
            values["market"] = market
            values["phase"] = phase
            values["candidate_name"] = chosen
            values["candidate_projection"] = candidates[market][chosen][season]
            values["component_projection"] = np.nan
            values["frozen_blend_weight"] = weight
            values["released_projection"] = reference[market][season]
            projection_frames.append(values)
        test = diagnostic_rows[market]
        values = test[[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", market,
        ]].copy().rename(columns={market: "actual"})
        values["market"] = market
        values["phase"] = "diagnostic"
        values["candidate_name"] = chosen
        values["candidate_projection"] = np.nan
        values["component_projection"] = diagnostic_components[market]
        values["frozen_blend_weight"] = weight
        values["released_projection"] = np.nan
        projection_frames.append(values)
        report[market]["currentSeason"] = {
            "rows": int(len(test)),
            "weeks": sorted(test["week"].astype(int).unique().tolist()),
            "component": point_metrics(test[market].to_numpy(float), diagnostic_components[market]),
        }
        if offered_rows is not None:
            offered = offered_rows[market]
            offered_values = offered[[
                "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                "player_name", "position", market,
            ]].copy().rename(columns={market: "actual"})
            offered_values["market"] = market
            offered_values["phase"] = "locked_replay"
            offered_values["candidate_name"] = chosen
            offered_values["candidate_projection"] = np.nan
            offered_values["component_projection"] = offered_components[market]
            offered_values["frozen_blend_weight"] = weight
            offered_values["released_projection"] = np.nan
            projection_frames.append(offered_values)

    args.projections.parent.mkdir(parents=True, exist_ok=True)
    projections = pd.concat(projection_frames, ignore_index=True)
    projections.to_parquet(args.projections, index=False)
    output = {
        "release": "nfl_player_props_expected_role_system_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025, "diagnostic": "2026 Weeks 1-4 opened"},
        "externalManifestSha256": sha256_file(args.external_manifest),
        "injurySources": injury_metadata,
        "projectionFile": str(args.projections.resolve()),
        "projectionFileSha256": sha256_file(args.projections),
        "frozenCandidates": frozen,
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "frozenCandidates": frozen,
        "confirmation": {market: report[market]["confirmation"] for market in MARKETS},
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
