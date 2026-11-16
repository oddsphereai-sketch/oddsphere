#!/usr/bin/env python3
"""Market-independent channel-specific hazard tournament for NFL Anytime TD."""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
FOUNDATION_PATH = ROOT / "scripts/operator/tournament_nfl_player_props_anytime_td_independent_allocation.py"
HIERARCHICAL_PATH = ROOT / "scripts/operator/tournament_nfl_player_props_anytime_td_hierarchical_hazard.py"
SOURCE_MANIFEST = ROOT / "football-research/cache/nflverse/real-model-r1/manifest.json"
REFERENCE_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_fixed_ensemble_rows_r1.parquet"
CURRENT_PBP = ROOT / "football-research/cache/nfl-player-props-external/current/pbp/2026.parquet"
CURRENT_BOARD = pathlib.Path("/tmp/nfl-props-private-week5-full-board.json")
CURRENT_EVIDENCE = pathlib.Path("/tmp/nfl-props-loss-ledger-evidence-week5.json")
TOUCHDOWN_ARTIFACT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeTouchdown.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_channel_hazard_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_channel_hazard_rows_r1.parquet"
EWM_ALPHA = 0.35
PBP_COLUMNS = (
    "season", "week", "game_id", "posteam", "defteam", "yardline_100", "goal_to_go",
    "touchdown", "td_team", "td_player_id", "pass_touchdown", "rush_touchdown",
    "return_touchdown", "pass_attempt", "rush_attempt", "qb_scramble", "qb_kneel",
    "qb_spike", "receiver_player_id", "rusher_player_id",
)
CHANNELS = {
    "pass": {
        "team_label": "team_pass_tds",
        "player_label": "pass_tds",
        "positions": ("RB", "FB", "WR", "TE"),
        "features": (
            "prior_pass_tds_avg5", "prior_pass_tds_ewm",
            "prior_target_redzone_opportunity_avg5", "prior_target_redzone_opportunity_ewm",
            "prior_target_goal_line_opportunity_avg5", "prior_target_goal_line_opportunity_ewm",
            "prior_target_share_avg3", "prior_target_share_ewm",
            "prior_offense_snap_pct_avg3", "prior_offense_snap_pct_ewm",
        ),
    },
    "nonqb_rush": {
        "team_label": "team_nonqb_rush_tds",
        "player_label": "nonqb_rush_tds",
        "positions": ("RB", "FB", "WR", "TE"),
        "features": (
            "prior_nonqb_rush_tds_avg5", "prior_nonqb_rush_tds_ewm",
            "prior_rush_redzone_opportunity_avg5", "prior_rush_redzone_opportunity_ewm",
            "prior_rush_goal_line_opportunity_avg5", "prior_rush_goal_line_opportunity_ewm",
            "prior_rush_attempt_share_avg3", "prior_rush_attempt_share_ewm",
            "prior_offense_snap_pct_avg3", "prior_offense_snap_pct_ewm",
        ),
    },
    "qb_rush": {
        "team_label": "team_qb_rush_tds",
        "player_label": "qb_rush_tds",
        "positions": ("QB",),
        "features": (
            "prior_qb_rush_tds_avg5", "prior_qb_rush_tds_ewm",
            "prior_rush_redzone_opportunity_avg5", "prior_rush_redzone_opportunity_ewm",
            "prior_rush_goal_line_opportunity_avg5", "prior_rush_goal_line_opportunity_ewm",
            "prior_qb_scramble_opportunity_avg5", "prior_qb_scramble_opportunity_ewm",
            "prior_qb_designed_run_proxy_avg5", "prior_qb_designed_run_proxy_ewm",
            "prior_rush_attempt_share_avg3", "prior_rush_attempt_share_ewm",
            "prior_offense_snap_pct_avg3", "prior_offense_snap_pct_ewm",
        ),
    },
}


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def read_historical_pbp(foundation: Any) -> tuple[pd.DataFrame, dict[str, Any]]:
    manifest = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    frames: list[pd.DataFrame] = []
    checksums: dict[str, str] = {}
    for item in manifest["files"]:
        if item["dataset"] != "pbp" or not 2016 <= int(item["season"]) <= 2025:
            continue
        path = pathlib.Path(item["filename"])
        actual = foundation.sha256(path)
        if actual != item["sha256"]:
            raise RuntimeError(f"PBP checksum mismatch: {path}")
        checksums[str(item["season"])] = actual
        frames.append(pd.read_parquet(path, columns=list(PBP_COLUMNS)))
    if len(frames) != 10:
        raise RuntimeError("expected checksum-pinned PBP for 2016-2025")
    return pd.concat(frames, ignore_index=True), checksums


def shifted(values: pd.Series, mode: str) -> pd.Series:
    if mode == "avg5":
        return values.shift(1).rolling(5, min_periods=1).mean()
    return values.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean()


def add_channel_features(frame: pd.DataFrame, pbp: pd.DataFrame) -> pd.DataFrame:
    rows = frame.drop(columns=["touchdowns", "anytime_td"], errors="ignore").copy()
    player_keys = ["season", "week", "game_id", "team", "player_id"]
    pbp = pbp.copy()
    for column in (
        "touchdown", "pass_touchdown", "rush_touchdown", "return_touchdown",
        "pass_attempt", "rush_attempt", "qb_scramble", "qb_kneel", "qb_spike",
    ):
        pbp[column] = pd.to_numeric(pbp[column], errors="coerce").fillna(0.0)

    scoring = pbp[
        pbp["touchdown"].eq(1)
        & pbp["td_player_id"].notna()
        & pbp["td_team"].eq(pbp["posteam"])
    ].copy()
    scoring["touchdowns"] = 1.0
    scoring["pass_tds"] = scoring["pass_touchdown"].eq(1).astype(float)
    scoring["rush_tds"] = scoring["rush_touchdown"].eq(1).astype(float)
    labels = scoring.groupby(
        ["season", "week", "game_id", "posteam", "td_player_id"], observed=True,
        as_index=False,
    )[["touchdowns", "pass_tds", "rush_tds"]].sum().rename(columns={
        "posteam": "team", "td_player_id": "player_id",
    })
    rows = rows.merge(labels, on=player_keys, how="left", validate="one_to_one")
    rows[["touchdowns", "pass_tds", "rush_tds"]] = rows[
        ["touchdowns", "pass_tds", "rush_tds"]
    ].fillna(0.0)
    rows["anytime_td"] = rows["touchdowns"].gt(0).astype(int)
    rows["qb_rush_tds"] = np.where(rows["position"].eq("QB"), rows["rush_tds"], 0.0)
    rows["nonqb_rush_tds"] = np.where(~rows["position"].eq("QB"), rows["rush_tds"], 0.0)

    yardline = pd.to_numeric(pbp["yardline_100"], errors="coerce")
    target = pbp[pbp["receiver_player_id"].notna() & pbp["pass_attempt"].gt(0)].copy()
    target["target_redzone_opportunity"] = yardline.loc[target.index].le(20).astype(float)
    target["target_goal_line_opportunity"] = (
        yardline.loc[target.index].le(10) | target["goal_to_go"].fillna(False).astype(bool)
    ).astype(float)
    target_rows = target.groupby(
        ["season", "week", "game_id", "posteam", "receiver_player_id"], observed=True,
        as_index=False,
    )[["target_redzone_opportunity", "target_goal_line_opportunity"]].sum().rename(columns={
        "posteam": "team", "receiver_player_id": "player_id",
    })

    rush = pbp[pbp["rusher_player_id"].notna() & pbp["rush_attempt"].gt(0)].copy()
    rush["rush_redzone_opportunity"] = yardline.loc[rush.index].le(20).astype(float)
    rush["rush_goal_line_opportunity"] = (
        yardline.loc[rush.index].le(10) | rush["goal_to_go"].fillna(False).astype(bool)
    ).astype(float)
    rush["qb_scramble_opportunity"] = rush["qb_scramble"].gt(0).astype(float)
    rush["qb_designed_run_proxy"] = (
        rush["qb_scramble"].eq(0) & rush["qb_kneel"].eq(0) & rush["qb_spike"].eq(0)
    ).astype(float)
    rush_rows = rush.groupby(
        ["season", "week", "game_id", "posteam", "rusher_player_id"], observed=True,
        as_index=False,
    )[[
        "rush_redzone_opportunity", "rush_goal_line_opportunity",
        "qb_scramble_opportunity", "qb_designed_run_proxy",
    ]].sum().rename(columns={"posteam": "team", "rusher_player_id": "player_id"})

    opportunities = target_rows.merge(
        rush_rows, on=player_keys, how="outer", validate="one_to_one",
    )
    opportunity_columns = [
        "target_redzone_opportunity", "target_goal_line_opportunity",
        "rush_redzone_opportunity", "rush_goal_line_opportunity",
        "qb_scramble_opportunity", "qb_designed_run_proxy",
    ]
    rows = rows.merge(opportunities, on=player_keys, how="left", validate="one_to_one")
    rows[opportunity_columns] = rows[opportunity_columns].fillna(0.0)
    non_qb = ~rows["position"].eq("QB")
    rows.loc[non_qb, ["qb_scramble_opportunity", "qb_designed_run_proxy"]] = 0.0

    rows = rows.sort_values(["player_id", "season", "week", "game_id"])
    player_metrics = [
        "pass_tds", "nonqb_rush_tds", "qb_rush_tds", *opportunity_columns,
    ]
    for metric in player_metrics:
        group = rows.groupby("player_id", observed=True)[metric]
        rows[f"prior_{metric}_avg5"] = group.transform(lambda values: shifted(values, "avg5"))
        rows[f"prior_{metric}_ewm"] = group.transform(lambda values: shifted(values, "ewm"))

    team_keys = ["season", "week", "game_id", "team", "opponent"]
    team_games = rows.groupby(team_keys, observed=True, as_index=False).agg(
        team_pass_tds=("pass_tds", "sum"),
        team_nonqb_rush_tds=("nonqb_rush_tds", "sum"),
        team_qb_rush_tds=("qb_rush_tds", "sum"),
    )
    team_games = team_games.sort_values(["team", "season", "week", "game_id"])
    team_prior_columns: list[str] = []
    opponent_prior_columns: list[str] = []
    for channel, config in CHANNELS.items():
        label = str(config["team_label"])
        group = team_games.groupby("team", observed=True)[label]
        for mode in ("avg5", "ewm"):
            column = f"prior_team_{channel}_td_{mode}"
            team_games[column] = group.transform(lambda values, mode=mode: shifted(values, mode))
            team_prior_columns.append(column)

        allowed = team_games[[*team_keys, label]].rename(
            columns={"team": "offense", "opponent": "team"},
        ).sort_values(["team", "season", "week", "game_id"])
        allowed_group = allowed.groupby("team", observed=True)[label]
        for mode in ("avg5", "ewm"):
            column = f"prior_opponent_{channel}_td_allowed_{mode}"
            allowed[column] = allowed_group.transform(
                lambda values, mode=mode: shifted(values, mode),
            )
            opponent_prior_columns.append(column)
        rows = rows.merge(
            allowed[["season", "week", "game_id", "team", *opponent_prior_columns[-2:]]],
            on=["season", "week", "game_id", "team"], how="left", validate="many_to_one",
        )

    rows = rows.merge(
        team_games[["season", "week", "game_id", "team", *team_prior_columns]],
        on=["season", "week", "game_id", "team"], how="left", validate="many_to_one",
    )
    return rows


def channel_team_table(frame: pd.DataFrame, team_features: list[str]) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team"]
    labels = frame.groupby(keys, observed=True, as_index=False).agg(
        team_pass_tds=("pass_tds", "sum"),
        team_nonqb_rush_tds=("nonqb_rush_tds", "sum"),
        team_qb_rush_tds=("qb_rush_tds", "sum"),
    )
    context = frame.sort_values([*keys, "player_id"]).drop_duplicates(keys)[
        [*keys, *team_features]
    ]
    return labels.merge(context, on=keys, validate="one_to_one")


def channel_raw_probability(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    training_through: int,
    prediction_season: int,
    role_features: list[str],
    channel_player_features: dict[str, list[str]],
    channel_team_features: dict[str, list[str]],
    test: pd.DataFrame,
) -> tuple[np.ndarray, dict[str, Any]]:
    train_teams = teams[teams["season"].le(training_through)]
    current_teams = teams[teams["season"].eq(prediction_season)].copy()
    budget_indexes: dict[str, pd.Series] = {}
    mean_budgets: dict[str, float] = {}
    for channel, config in CHANNELS.items():
        label = str(config["team_label"])
        features = channel_team_features[channel]
        model = foundation.regression("poisson").fit(
            train_teams[features], train_teams[label].to_numpy(float),
        )
        values = np.clip(np.asarray(model.predict(current_teams[features]), dtype=float), 1e-8, None)
        column = f"predicted_{channel}_tds"
        current_teams[column] = values
        budget_indexes[channel] = current_teams.set_index(["game_id", "team"])[column]
        mean_budgets[channel] = float(np.mean(values))

    population = frame[
        frame["season"].le(training_through) & frame["position"].isin(foundation.POSITIONS)
    ].copy()
    active = population[population["participated"].eq(1)].copy()
    participation_model = foundation.classifier().fit(
        population[role_features], population["participated"].to_numpy(int),
    )
    snap_model = foundation.regression("squared_error").fit(
        active[role_features], active["offense_snap_pct"].fillna(0).clip(0, 1),
    )
    intensity_models: dict[str, Any] = {}
    for channel, config in CHANNELS.items():
        channel_train = active[active["position"].isin(config["positions"])]
        intensity_models[channel] = foundation.regression("poisson").fit(
            channel_train[channel_player_features[channel]],
            channel_train[str(config["player_label"])].to_numpy(float),
        )

    roster = frame[
        frame["season"].eq(prediction_season)
        & frame["position"].isin(foundation.POSITIONS)
        & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
    ].copy()
    roster["active_probability"] = participation_model.predict_proba(roster[role_features])[:, 1]
    roster["conditional_snap_share"] = np.clip(
        np.asarray(snap_model.predict(roster[role_features]), dtype=float), 0.0, 1.0,
    )
    roster["role_survival"] = (
        roster["active_probability"] * np.maximum(roster["conditional_snap_share"], 0.02)
    )
    test_keys = pd.MultiIndex.from_frame(test[["game_id", "team"]])
    total_hazard = np.zeros(len(test), dtype=float)
    channel_diagnostics: dict[str, Any] = {}
    for channel, config in CHANNELS.items():
        eligible = roster["position"].isin(config["positions"])
        roster[f"{channel}_weight"] = 0.0
        predicted = np.clip(np.asarray(
            intensity_models[channel].predict(
                roster.loc[eligible, channel_player_features[channel]],
            ), dtype=float,
        ), 1e-10, None)
        roster.loc[eligible, f"{channel}_weight"] = (
            roster.loc[eligible, "role_survival"].to_numpy(float) * predicted
        )
        denominator = roster.groupby(
            ["game_id", "team"], observed=True,
        )[f"{channel}_weight"].transform("sum")
        roster[f"{channel}_share"] = np.where(
            eligible & denominator.gt(0), roster[f"{channel}_weight"] / denominator, 0.0,
        )
        share = roster.set_index("row_id")[f"{channel}_share"].reindex(test["row_id"]).to_numpy(float)
        if np.isnan(share).any():
            raise RuntimeError(f"{channel} allocation did not cover every test row")
        budget = budget_indexes[channel].reindex(test_keys).to_numpy(float)
        if np.isnan(budget).any():
            raise RuntimeError(f"missing {channel} team budget for {prediction_season}")
        hazard = budget * share
        total_hazard += hazard
        channel_diagnostics[channel] = {
            "meanTeamBudget": float(np.mean(budget)),
            "meanPlayerHazard": float(np.mean(hazard)),
            "eligibleRosterRows": int(eligible.sum()),
        }

    probability = np.clip(1.0 - np.exp(-np.clip(total_hazard, 0.0, None)), 1e-5, 1 - 1e-5)
    return probability, {
        "trainingThrough": training_through,
        "predictionSeason": prediction_season,
        "testRows": int(len(test)),
        "rosterRows": int(len(roster)),
        "meanActiveProbability": float(roster["active_probability"].mean()),
        "meanConditionalSnapShare": float(roster["conditional_snap_share"].mean()),
        "meanTotalPlayerHazard": float(np.mean(total_hazard)),
        "meanTeamBudgets": mean_budgets,
        "channels": channel_diagnostics,
    }


def calibrated_candidate(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    role_features: list[str],
    channel_player_features: dict[str, list[str]],
    channel_team_features: dict[str, list[str]],
    evaluation_season: int,
    test: pd.DataFrame,
) -> tuple[np.ndarray, dict[str, Any]]:
    calibration_season = evaluation_season - 1
    calibration_rows = frame[
        frame["season"].eq(calibration_season)
        & frame["prior_participations"].ge(1)
        & frame["position"].isin(foundation.POSITIONS)
    ].copy()
    calibration_raw, calibration_diagnostic = channel_raw_probability(
        foundation, frame, teams, calibration_season - 1, calibration_season,
        role_features, channel_player_features, channel_team_features, calibration_rows,
    )
    calibrator = foundation.fit_platt(
        calibration_raw, calibration_rows["anytime_td"].to_numpy(int),
    )
    raw, evaluation_diagnostic = channel_raw_probability(
        foundation, frame, teams, evaluation_season - 1, evaluation_season,
        role_features, channel_player_features, channel_team_features, test,
    )
    return foundation.apply_platt(calibrator, raw), {
        "calibration": calibration_diagnostic,
        "evaluation": evaluation_diagnostic,
    }


def main() -> None:
    foundation = load("props_td_channel_foundation", FOUNDATION_PATH)
    hierarchical = load("props_td_channel_helpers", HIERARCHICAL_PATH)
    frame, base_player_features, base_team_features, injury_metadata, _, _ = (
        foundation.prepare_candidate_frame(
            foundation.EXTERNAL_MANIFEST, foundation.HISTORY_MANIFEST, foundation.INJURY_ROOT,
        )
    )
    historical_pbp, historical_checksums = read_historical_pbp(foundation)
    current_pbp = pd.read_parquet(CURRENT_PBP, columns=list(PBP_COLUMNS))
    if int(current_pbp["season"].min()) != 2026 or int(current_pbp["week"].max()) < 5:
        raise RuntimeError("current PBP coverage is insufficient for the frozen Week 5 replay")
    pbp = pd.concat([historical_pbp, current_pbp], ignore_index=True)
    frame = add_channel_features(frame, pbp)

    role_features = list(dict.fromkeys(base_player_features))
    channel_player_features = {
        channel: list(dict.fromkeys([*base_player_features, *config["features"]]))
        for channel, config in CHANNELS.items()
    }
    channel_team_features: dict[str, list[str]] = {}
    for channel in CHANNELS:
        channel_team_features[channel] = list(dict.fromkeys([
            *base_team_features,
            f"prior_team_{channel}_td_avg5", f"prior_team_{channel}_td_ewm",
            f"prior_opponent_{channel}_td_allowed_avg5",
            f"prior_opponent_{channel}_td_allowed_ewm",
        ]))
    all_numeric = list(dict.fromkeys([
        *role_features,
        *(name for values in channel_player_features.values() for name in values),
        *(name for values in channel_team_features.values() for name in values),
    ]))
    frame[all_numeric] = frame[all_numeric].replace([np.inf, -np.inf], np.nan)
    all_team_features = list(dict.fromkeys(
        name for values in channel_team_features.values() for name in values
    ))
    teams = channel_team_table(frame, all_team_features)
    by_row = frame.set_index("row_id", drop=False)
    reference_rows = pd.read_parquet(REFERENCE_ROWS)

    phase_reports: dict[str, Any] = {}
    phase_rows: dict[str, pd.DataFrame] = {}
    reference_probabilities: dict[str, np.ndarray] = {}
    candidate_probabilities: dict[str, np.ndarray] = {}
    output_rows: list[pd.DataFrame] = []
    for evaluation_season, phase in ((2024, "selection"), (2025, "confirmation")):
        reference_phase = reference_rows[reference_rows["phase"].eq(phase)].copy()
        test = by_row.loc[reference_phase["row_id"]].reset_index(drop=True)
        reference = reference_phase["candidate_probability"].to_numpy(float)
        candidate, diagnostic = calibrated_candidate(
            foundation, frame, teams, role_features, channel_player_features,
            channel_team_features, evaluation_season, test,
        )
        actual = test["anytime_td"].to_numpy(int)
        phase_rows[phase] = test
        reference_probabilities[phase] = reference
        candidate_probabilities[phase] = candidate
        phase_reports[phase] = {
            "reference": foundation.probability_metrics(actual, reference),
            "candidate": foundation.probability_metrics(actual, candidate),
            "referenceByPosition": hierarchical.safe_position_metrics(
                foundation, test, actual, reference,
            ),
            "candidateByPosition": hierarchical.safe_position_metrics(
                foundation, test, actual, candidate,
            ),
            "diagnostic": diagnostic,
        }
        values = test[[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", "anytime_td",
        ]].copy().rename(columns={"anytime_td": "actual"})
        values["phase"] = phase
        values["reference_probability"] = reference
        values["candidate_probability"] = candidate
        output_rows.append(values)

    selection_passes = bool(
        phase_reports["selection"]["candidate"]["brier"]
        < phase_reports["selection"]["reference"]["brier"]
        and phase_reports["selection"]["candidate"]["logLoss"]
        < phase_reports["selection"]["reference"]["logLoss"]
        and phase_reports["selection"]["candidate"]["auc"]
        >= phase_reports["selection"]["reference"]["auc"]
    )
    confirmation_stability = foundation.stability(
        phase_rows["confirmation"],
        phase_rows["confirmation"]["anytime_td"].to_numpy(int),
        reference_probabilities["confirmation"], candidate_probabilities["confirmation"],
    )
    confirmation_passes = bool(
        selection_passes
        and phase_reports["confirmation"]["candidate"]["brier"]
        < phase_reports["confirmation"]["reference"]["brier"]
        and phase_reports["confirmation"]["candidate"]["logLoss"]
        < phase_reports["confirmation"]["reference"]["logLoss"]
        and phase_reports["confirmation"]["candidate"]["auc"]
        >= phase_reports["confirmation"]["reference"]["auc"]
        and confirmation_stability["passes"]
    )

    current = foundation.current_rows(CURRENT_BOARD, CURRENT_EVIDENCE, frame)
    current_test = by_row.loc[current["row_id"]].reset_index(drop=True)
    reference_locked = reference_rows[
        reference_rows["phase"].eq("locked_replay")
    ].set_index("row_id").reindex(current["row_id"])["candidate_probability"].to_numpy(float)
    candidate_locked, current_diagnostic = calibrated_candidate(
        foundation, frame, teams, role_features, channel_player_features,
        channel_team_features, 2026, current_test,
    )
    current_actual = current["actual"].to_numpy(float).astype(int) > 0
    current_reference_metrics = foundation.probability_metrics(current_actual, reference_locked)
    current_candidate_metrics = foundation.probability_metrics(current_actual, candidate_locked)
    current_passes = bool(
        confirmation_passes
        and current_candidate_metrics["brier"] <= current_reference_metrics["brier"]
        and current_candidate_metrics["logLoss"] <= current_reference_metrics["logLoss"]
        and current_candidate_metrics["auc"] >= current_reference_metrics["auc"]
        and current_candidate_metrics["calibrationGap"]
        <= current_reference_metrics["calibrationGap"]
    )

    board = json.loads(CURRENT_BOARD.read_text(encoding="utf-8"))
    exact = pd.DataFrame(board["exactOfferRows"])
    exact = exact[exact["market"].eq("anytime_td") & exact["canonicalMainLine"].eq(True)].copy()
    exact["normalizedPlayer"] = exact["playerName"].map(foundation.normalize_player)
    current_probabilities = current[["gameId", "playerName", "row_id"]].copy()
    current_probabilities["normalizedPlayer"] = current_probabilities["playerName"].map(
        foundation.normalize_player,
    )
    current_probabilities["referenceIndependentProbability"] = reference_locked
    current_probabilities["candidateIndependentProbability"] = candidate_locked
    exact = exact.merge(
        current_probabilities[[
            "gameId", "normalizedPlayer", "referenceIndependentProbability",
            "candidateIndependentProbability",
        ]],
        on=["gameId", "normalizedPlayer"], how="left", validate="one_to_one",
    )
    if exact["candidateIndependentProbability"].isna().any():
        raise RuntimeError("channel candidate did not join every exact TD price row")
    exact["win"] = exact["actual"].gt(0)
    touchdown_artifact = json.loads(TOUCHDOWN_ARTIFACT.read_text(encoding="utf-8"))
    weight = float(touchdown_artifact["marketResidualWeight"])
    exact["referenceFinalProbability"] = hierarchical.residual_probability(
        exact["referenceIndependentProbability"], exact["marketProbability"], weight,
    )
    exact["candidateFinalProbability"] = hierarchical.residual_probability(
        exact["candidateIndependentProbability"], exact["marketProbability"], weight,
    )
    current_economics = {
        "referenceIndependent": hierarchical.economics(exact, "referenceIndependentProbability"),
        "candidateIndependent": hierarchical.economics(exact, "candidateIndependentProbability"),
        "referenceFinal": hierarchical.economics(exact, "referenceFinalProbability"),
        "candidateFinal": hierarchical.economics(exact, "candidateFinalProbability"),
        "boundary": "exact locked prices and no-vig market probability are downstream diagnostics only",
    }

    locked_rows = current[["row_id", "gameId", "playerName", "team", "actual"]].copy()
    locked_rows["season"] = 2026
    locked_rows["week"] = 5
    locked_rows["phase"] = "locked_replay"
    locked_rows["reference_probability"] = reference_locked
    locked_rows["candidate_probability"] = candidate_locked
    output_rows.append(locked_rows)
    result_rows = pd.concat(output_rows, ignore_index=True, sort=False)
    ROWS.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(ROWS, index=False)

    payload = {
        "release": "nfl_player_props_anytime_td_channel_hazard_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependentCandidate": True,
        "candidateMarketFeatures": [],
        "architecture": {
            "teamChannels": ["pass_td", "nonqb_rush_td", "qb_rush_td"],
            "roleSurvival": "participation probability x conditional offensive snap share",
            "allocation": "channel-eligible Poisson intensity normalized within team/channel",
            "probability": "1-exp(-sum(channel player hazards)), preceding-season global Platt",
            "routeData": "unavailable; snap and target share retain their honest labels",
            "designedQbRun": "QB rush attempt excluding explicit scramble, kneel, and spike",
        },
        "sourceChecksums": {
            "historicalPbp": historical_checksums,
            "currentPbp2026": foundation.sha256(CURRENT_PBP),
            "referenceRows": foundation.sha256(REFERENCE_ROWS),
            "currentBoard": foundation.sha256(CURRENT_BOARD),
            "currentEvidence": foundation.sha256(CURRENT_EVIDENCE),
        },
        "currentPbpCoverage": {
            "minWeek": int(current_pbp["week"].min()),
            "maxWeek": int(current_pbp["week"].max()),
            "games": int(current_pbp["game_id"].nunique()),
            "featureRule": "strict player/team shift; target-week outcomes cannot enter target-week features",
        },
        "phaseReports": phase_reports,
        "selectionPasses": selection_passes,
        "confirmationStability": confirmation_stability,
        "confirmationPasses": confirmation_passes,
        "currentSeason": {
            "reference": current_reference_metrics,
            "candidate": current_candidate_metrics,
            "referenceByPosition": hierarchical.safe_position_metrics(
                foundation, current_test, current_actual.astype(int), reference_locked,
            ),
            "candidateByPosition": hierarchical.safe_position_metrics(
                foundation, current_test, current_actual.astype(int), candidate_locked,
            ),
            "passes": current_passes,
            "diagnostic": current_diagnostic,
            "economics": current_economics,
        },
        "injuryEvidence": injury_metadata,
        "rowsFile": str(ROWS.resolve()),
        "rowsSha256": foundation.sha256(ROWS),
        "decision": "release_candidate" if current_passes else "reject_unchanged",
    }
    OUTPUT.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "phaseReports": phase_reports,
        "selectionPasses": selection_passes,
        "confirmationStability": confirmation_stability,
        "confirmationPasses": confirmation_passes,
        "currentSeason": payload["currentSeason"],
        "decision": payload["decision"],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
