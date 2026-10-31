#!/usr/bin/env python3
"""Structural market-independent hierarchical hazard tournament for Anytime TD."""

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
REFERENCE_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_fixed_ensemble_rows_r1.parquet"
CURRENT_PBP = ROOT / "football-research/cache/nfl-player-props-external/current/pbp/2026.parquet"
CURRENT_BOARD = pathlib.Path("/tmp/nfl-props-private-week5-full-board.json")
CURRENT_EVIDENCE = pathlib.Path("/tmp/nfl-props-loss-ledger-evidence-week5.json")
TOUCHDOWN_ARTIFACT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeTouchdown.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_hierarchical_hazard_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_hierarchical_hazard_rows_r1.parquet"
POSITION_GROUPS = {
    "QB": ("QB",),
    "RB_FB": ("RB", "FB"),
    "WR": ("WR",),
    "TE": ("TE",),
}
OPPORTUNITY_FEATURES = (
    "prior_anytime_td_avg5",
    "prior_anytime_td_ewm",
    "prior_rush_redzone_opportunity_avg5",
    "prior_rush_redzone_opportunity_ewm",
    "prior_rush_goal_line_opportunity_avg5",
    "prior_rush_goal_line_opportunity_ewm",
    "prior_target_redzone_opportunity_avg5",
    "prior_target_redzone_opportunity_ewm",
    "prior_target_goal_line_opportunity_avg5",
    "prior_target_goal_line_opportunity_ewm",
)
TEAM_TD_FEATURES = (
    "prior_team_td_avg5",
    "prior_team_td_ewm",
    "prior_opponent_td_allowed_avg5",
    "prior_opponent_td_allowed_ewm",
)
PBP_COLUMNS = (
    "season", "week", "game_id", "posteam", "defteam", "yardline_100", "goal_to_go",
    "touchdown", "td_team", "td_player_id", "pass_attempt", "rush_attempt",
    "receiver_player_id", "rusher_player_id",
)
EWM_ALPHA = 0.35


def load(path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location("props_td_hierarchical_foundation", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def add_lagged_features(frame: pd.DataFrame, pbp: pd.DataFrame) -> pd.DataFrame:
    rows = frame.drop(columns=["touchdowns", "anytime_td"], errors="ignore").copy()
    keys = ["season", "week", "game_id", "team", "player_id"]
    touchdown = pd.to_numeric(pbp["touchdown"], errors="coerce").fillna(0).eq(1)
    touchdowns = pbp[touchdown & pbp["td_player_id"].notna()].copy()
    touchdowns = touchdowns[touchdowns["td_team"].eq(touchdowns["posteam"])]
    labels = touchdowns.groupby(
        ["season", "week", "game_id", "posteam", "td_player_id"], observed=True,
    ).size().rename("touchdowns").reset_index().rename(columns={
        "posteam": "team", "td_player_id": "player_id",
    })
    rows = rows.merge(labels, on=keys, how="left", validate="one_to_one")
    rows["touchdowns"] = rows["touchdowns"].fillna(0.0)
    rows["anytime_td"] = rows["touchdowns"].gt(0).astype(int)

    yardline = pd.to_numeric(pbp["yardline_100"], errors="coerce")
    opportunity_frames: list[pd.DataFrame] = []
    identities = (
        ("rusher_player_id", "rush_attempt", "rush"),
        ("receiver_player_id", "pass_attempt", "target"),
    )
    for player_column, attempt_column, prefix in identities:
        attempt = pd.to_numeric(pbp[attempt_column], errors="coerce").fillna(0).gt(0)
        subset = pbp[pbp[player_column].notna() & attempt].copy()
        subset[f"{prefix}_redzone_opportunity"] = yardline.loc[subset.index].le(20).astype(float)
        subset[f"{prefix}_goal_line_opportunity"] = (
            yardline.loc[subset.index].le(10)
            | subset["goal_to_go"].fillna(False).astype(bool)
        ).astype(float)
        opportunity_frames.append(subset.groupby(
            ["season", "week", "game_id", "posteam", player_column],
            observed=True,
            as_index=False,
        )[[f"{prefix}_redzone_opportunity", f"{prefix}_goal_line_opportunity"]].sum().rename(
            columns={"posteam": "team", player_column: "player_id"},
        ))
    opportunities = opportunity_frames[0].merge(
        opportunity_frames[1], on=keys, how="outer", validate="one_to_one",
    )
    opportunity_columns = [
        "rush_redzone_opportunity", "rush_goal_line_opportunity",
        "target_redzone_opportunity", "target_goal_line_opportunity",
    ]
    rows = rows.merge(opportunities, on=keys, how="left", validate="one_to_one")
    rows[opportunity_columns] = rows[opportunity_columns].fillna(0.0)

    team_keys = ["season", "week", "game_id", "team", "opponent"]
    team_games = rows[team_keys].drop_duplicates().copy()
    team_labels = touchdowns.groupby(
        ["season", "week", "game_id", "posteam", "defteam"], observed=True,
    ).size().rename("team_touchdowns").reset_index().rename(columns={
        "posteam": "team", "defteam": "opponent",
    })
    team_games = team_games.merge(team_labels, on=team_keys, how="left", validate="one_to_one")
    team_games["team_touchdowns"] = team_games["team_touchdowns"].fillna(0.0)
    team_games = team_games.sort_values(["team", "season", "week", "game_id"])
    team_group = team_games.groupby("team", observed=True)["team_touchdowns"]
    team_games["prior_team_td_avg5"] = team_group.transform(
        lambda values: values.shift(1).rolling(5, min_periods=1).mean(),
    )
    team_games["prior_team_td_ewm"] = team_group.transform(
        lambda values: values.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean(),
    )
    allowed = team_games.rename(columns={"team": "offense", "opponent": "team"}).sort_values(
        ["team", "season", "week", "game_id"],
    )
    allowed_group = allowed.groupby("team", observed=True)["team_touchdowns"]
    allowed["prior_opponent_td_allowed_avg5"] = allowed_group.transform(
        lambda values: values.shift(1).rolling(5, min_periods=1).mean(),
    )
    allowed["prior_opponent_td_allowed_ewm"] = allowed_group.transform(
        lambda values: values.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean(),
    )
    rows = rows.merge(
        team_games[[*team_keys[:-1], "prior_team_td_avg5", "prior_team_td_ewm"]],
        on=team_keys[:-1], how="left", validate="many_to_one",
    )
    rows = rows.merge(
        allowed[[
            "season", "week", "game_id", "team",
            "prior_opponent_td_allowed_avg5", "prior_opponent_td_allowed_ewm",
        ]],
        on=["season", "week", "game_id", "team"], how="left", validate="many_to_one",
    )

    rows = rows.sort_values(["player_id", "season", "week", "game_id"])
    for metric in ("anytime_td", *opportunity_columns):
        group = rows.groupby("player_id", observed=True)[metric]
        rows[f"prior_{metric}_avg5"] = group.transform(
            lambda values: values.shift(1).rolling(5, min_periods=1).mean(),
        )
        rows[f"prior_{metric}_ewm"] = group.transform(
            lambda values: values.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean(),
        )
    return rows


def position_group(position: str) -> str:
    return "RB_FB" if position in {"RB", "FB"} else position


def hierarchical_raw_probability(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    training_through: int,
    prediction_season: int,
    player_features: list[str],
    team_features: list[str],
    test: pd.DataFrame,
) -> tuple[np.ndarray, dict[str, Any]]:
    train_teams = teams[teams["season"].le(training_through)].copy()
    current_teams = teams[teams["season"].eq(prediction_season)].copy()
    team_model = foundation.regression("poisson").fit(
        train_teams[team_features], train_teams["team_touchdowns"].to_numpy(float),
    )
    current_teams["predicted_team_touchdowns"] = np.clip(
        np.asarray(team_model.predict(current_teams[team_features]), dtype=float), 1e-6, None,
    )
    budget_index = current_teams.set_index(["game_id", "team"])["predicted_team_touchdowns"]
    test_keys = pd.MultiIndex.from_frame(test[["game_id", "team"]])
    budget = budget_index.reindex(test_keys).to_numpy(float)
    if np.isnan(budget).any():
        raise RuntimeError(f"missing hierarchical team budget for {prediction_season}")

    population = frame[
        frame["season"].le(training_through) & frame["position"].isin(foundation.POSITIONS)
    ].copy()
    active = population[population["participated"].eq(1)].copy()
    participation_model = foundation.classifier().fit(
        population[player_features], population["participated"].to_numpy(int),
    )
    snap_model = foundation.regression("squared_error").fit(
        active[player_features], active["offense_snap_pct"].fillna(0.0).clip(0.0, 1.0),
    )
    intensity_models: dict[str, Any] = {}
    for group_name, positions in POSITION_GROUPS.items():
        group_rows = active[active["position"].isin(positions)]
        intensity_models[group_name] = foundation.regression("poisson").fit(
            group_rows[player_features], group_rows["touchdowns"].to_numpy(float),
        )

    roster = frame[
        frame["season"].eq(prediction_season)
        & frame["position"].isin(foundation.POSITIONS)
        & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
    ].copy()
    roster["active_probability"] = participation_model.predict_proba(
        roster[player_features],
    )[:, 1]
    roster["conditional_snap_share"] = np.clip(
        np.asarray(snap_model.predict(roster[player_features]), dtype=float), 0.0, 1.0,
    )
    roster["position_group"] = roster["position"].map(position_group)
    roster["scoring_intensity"] = 0.0
    for group_name, model in intensity_models.items():
        mask = roster["position_group"].eq(group_name)
        roster.loc[mask, "scoring_intensity"] = np.clip(
            np.asarray(model.predict(roster.loc[mask, player_features]), dtype=float),
            1e-8,
            None,
        )
    roster["raw_hazard_weight"] = (
        roster["active_probability"]
        * np.maximum(roster["conditional_snap_share"], 0.02)
        * roster["scoring_intensity"]
    )
    denominator = roster.groupby(
        ["game_id", "team"], observed=True,
    )["raw_hazard_weight"].transform("sum")
    roster["normalized_hazard_share"] = np.where(
        denominator.gt(0), roster["raw_hazard_weight"] / denominator, 0.0,
    )
    share_index = roster.set_index("row_id")["normalized_hazard_share"]
    share = share_index.reindex(test["row_id"]).to_numpy(float)
    if np.isnan(share).any():
        raise RuntimeError("hierarchical roster allocation did not cover every test row")
    player_hazard = np.clip(budget * share, 0.0, None)
    probability = np.clip(1.0 - np.exp(-player_hazard), 1e-5, 1.0 - 1e-5)
    return probability, {
        "trainingThrough": training_through,
        "predictionSeason": prediction_season,
        "testRows": int(len(test)),
        "rosterRows": int(len(roster)),
        "meanTeamTouchdownBudget": float(np.mean(budget)),
        "meanActiveProbability": float(roster["active_probability"].mean()),
        "meanConditionalSnapShare": float(roster["conditional_snap_share"].mean()),
        "meanPlayerHazard": float(np.mean(player_hazard)),
        "positionRosterRows": {
            str(position): int(count)
            for position, count in roster["position_group"].value_counts().items()
        },
    }


def calibrated_candidate(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    player_features: list[str],
    team_features: list[str],
    evaluation_season: int,
    test: pd.DataFrame,
) -> tuple[np.ndarray, dict[str, Any]]:
    calibration_season = evaluation_season - 1
    calibration_rows = frame[
        frame["season"].eq(calibration_season)
        & frame["prior_participations"].ge(1)
        & frame["position"].isin(foundation.POSITIONS)
    ].copy()
    calibration_raw, calibration_diagnostic = hierarchical_raw_probability(
        foundation, frame, teams, calibration_season - 1, calibration_season,
        player_features, team_features, calibration_rows,
    )
    calibrator = foundation.fit_platt(
        calibration_raw, calibration_rows["anytime_td"].to_numpy(int),
    )
    raw, evaluation_diagnostic = hierarchical_raw_probability(
        foundation, frame, teams, evaluation_season - 1, evaluation_season,
        player_features, team_features, test,
    )
    return foundation.apply_platt(calibrator, raw), {
        "calibration": calibration_diagnostic,
        "evaluation": evaluation_diagnostic,
    }


def safe_position_metrics(
    foundation: Any, rows: pd.DataFrame, actual: np.ndarray, probability: np.ndarray,
) -> dict[str, Any]:
    reports: dict[str, Any] = {}
    for position, indexes in rows.groupby("position", observed=True).groups.items():
        index = rows.index.get_indexer(indexes)
        outcome = actual[index]
        values = probability[index]
        if len(np.unique(outcome)) < 2:
            reports[str(position)] = {
                "rows": int(len(outcome)),
                "positiveRate": float(np.mean(outcome)),
                "meanProbability": float(np.mean(values)),
                "brier": float(np.mean((values - outcome) ** 2)),
                "auc": None,
            }
        else:
            reports[str(position)] = foundation.probability_metrics(outcome, values)
    return reports


def profit_multiple(price: float) -> float:
    return 100.0 / abs(price) if price < 0 else price / 100.0


def economics(rows: pd.DataFrame, probability_column: str) -> dict[str, Any]:
    values = rows.copy()
    values["probability"] = values[probability_column]
    values["profitMultiple"] = values["americanPrice"].map(profit_multiple)
    values["expectedValue"] = (
        values["probability"] * values["profitMultiple"] - (1.0 - values["probability"])
    )
    values["noVigEdge"] = values["probability"] - values["marketProbability"]
    values["units"] = np.where(values["win"], values["profitMultiple"], -1.0)

    def summary(group: pd.DataFrame) -> dict[str, Any]:
        if group.empty:
            return {"rows": 0, "wins": 0, "units": 0.0, "roi": None}
        return {
            "rows": int(len(group)),
            "wins": int(group["win"].sum()),
            "losses": int((~group["win"]).sum()),
            "units": float(group["units"].sum()),
            "roi": float(group["units"].mean()),
            "averageExpectedValue": float(group["expectedValue"].mean()),
            "averageNoVigEdge": float(group["noVigEdge"].mean()),
        }

    ranked_ev = values.sort_values("expectedValue", ascending=False)
    ranked_edge = values.sort_values("noVigEdge", ascending=False)
    return {
        "positiveEv": summary(values[values["expectedValue"].gt(0)]),
        "byExpectedValueRank": {
            f"top{count}": summary(ranked_ev.head(count)) for count in (5, 10, 20)
        },
        "byNoVigEdgeRank": {
            f"top{count}": summary(ranked_edge.head(count)) for count in (5, 10, 20)
        },
    }


def residual_probability(model: np.ndarray, market: np.ndarray, weight: float) -> np.ndarray:
    model = np.clip(np.asarray(model, dtype=float), 1e-6, 1.0 - 1e-6)
    market = np.clip(np.asarray(market, dtype=float), 1e-6, 1.0 - 1e-6)
    model_logit = np.log(model / (1.0 - model))
    market_logit = np.log(market / (1.0 - market))
    value = market_logit + weight * (model_logit - market_logit)
    return 1.0 / (1.0 + np.exp(-value))


def main() -> None:
    foundation = load(FOUNDATION_PATH)
    frame, base_player_features, base_team_features, injury_metadata, touchdown, _ = (
        foundation.prepare_candidate_frame(
            foundation.EXTERNAL_MANIFEST, foundation.HISTORY_MANIFEST, foundation.INJURY_ROOT,
        )
    )
    historical_pbp = touchdown.read_pbp()
    current_pbp = pd.read_parquet(CURRENT_PBP, columns=list(PBP_COLUMNS))
    if int(current_pbp["season"].min()) != 2026 or int(current_pbp["week"].max()) < 4:
        raise RuntimeError("current 2026 PBP coverage is insufficient for Week 5 shifted features")
    pbp = pd.concat([historical_pbp[list(PBP_COLUMNS)], current_pbp], ignore_index=True)
    frame = add_lagged_features(frame, pbp)
    player_features = list(dict.fromkeys([
        *base_player_features,
        *OPPORTUNITY_FEATURES,
        "prior_rush_attempt_share_avg3",
        "prior_rush_attempt_share_ewm",
        "prior_target_share_avg3",
        "prior_target_share_ewm",
        "prior_offense_snap_pct_avg3",
        "prior_offense_snap_pct_ewm",
    ]))
    team_features = list(dict.fromkeys([*base_team_features, *TEAM_TD_FEATURES]))
    numeric = list(dict.fromkeys([*player_features, *team_features]))
    frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
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
            foundation, frame, teams, player_features, team_features, evaluation_season, test,
        )
        actual = test["anytime_td"].to_numpy(int)
        phase_rows[phase] = test
        reference_probabilities[phase] = reference
        candidate_probabilities[phase] = candidate
        phase_reports[phase] = {
            "reference": foundation.probability_metrics(actual, reference),
            "candidate": foundation.probability_metrics(actual, candidate),
            "referenceByPosition": safe_position_metrics(foundation, test, actual, reference),
            "candidateByPosition": safe_position_metrics(foundation, test, actual, candidate),
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
        reference_probabilities["confirmation"],
        candidate_probabilities["confirmation"],
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
        foundation, frame, teams, player_features, team_features, 2026, current_test,
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
    exact = exact[
        exact["market"].eq("anytime_td") & exact["canonicalMainLine"].eq(True)
    ].copy()
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
        raise RuntimeError("hierarchical candidate did not join every exact TD price row")
    exact["win"] = exact["actual"].gt(0)
    touchdown_artifact = json.loads(TOUCHDOWN_ARTIFACT.read_text(encoding="utf-8"))
    weight = float(touchdown_artifact["marketResidualWeight"])
    exact["referenceFinalProbability"] = residual_probability(
        exact["referenceIndependentProbability"], exact["marketProbability"], weight,
    )
    exact["candidateFinalProbability"] = residual_probability(
        exact["candidateIndependentProbability"], exact["marketProbability"], weight,
    )
    current_economics = {
        "referenceIndependent": economics(exact, "referenceIndependentProbability"),
        "candidateIndependent": economics(exact, "candidateIndependentProbability"),
        "referenceFinal": economics(exact, "referenceFinalProbability"),
        "candidateFinal": economics(exact, "candidateFinalProbability"),
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
        "release": "nfl_player_props_anytime_td_hierarchical_hazard_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependentCandidate": True,
        "candidateMarketFeatures": [],
        "architecture": {
            "teamBudget": "regularized Poisson HGB",
            "roleSurvival": "participation probability x conditional offensive snap share",
            "playerIntensity": "position-specific regularized Poisson HGB",
            "allocation": "complete-roster competing hazard normalized to team TD intensity",
            "probability": "1-exp(-player hazard), preceding-season global Platt",
            "routeProxy": "shifted offensive snap share; no route-run field available",
        },
        "sourceChecksums": {
            "currentPbp2026": foundation.sha256(CURRENT_PBP),
            "referenceRows": foundation.sha256(REFERENCE_ROWS),
            "currentBoard": foundation.sha256(CURRENT_BOARD),
            "currentEvidence": foundation.sha256(CURRENT_EVIDENCE),
        },
        "currentPbpCoverage": {
            "minWeek": int(current_pbp["week"].min()),
            "maxWeek": int(current_pbp["week"].max()),
            "games": int(current_pbp["game_id"].nunique()),
            "featureRule": "only shifted prior rows; target-week outcomes cannot enter target-week features",
        },
        "phaseReports": phase_reports,
        "selectionPasses": selection_passes,
        "confirmationStability": confirmation_stability,
        "confirmationPasses": confirmation_passes,
        "currentSeason": {
            "reference": current_reference_metrics,
            "candidate": current_candidate_metrics,
            "referenceByPosition": safe_position_metrics(
                foundation, current_test, current_actual.astype(int), reference_locked,
            ),
            "candidateByPosition": safe_position_metrics(
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
