#!/usr/bin/env python3
"""Independent team-touchdown budget and player-allocation tournament."""

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
import pyarrow.parquet as pq
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.manifest.json"
HISTORY_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
INJURY_ROOT = ROOT / "football-research/cache/nfl-player-props-external/injuries"
MARKET_CONTEXT = ROOT / "football-research/cache/nfl-player-props-market-context/nflverse_games_2026_08_25.csv"
CURRENT_BOARD = pathlib.Path("/tmp/nfl-props-private-week5-full-board.json")
CURRENT_EVIDENCE = pathlib.Path("/tmp/nfl-props-loss-ledger-evidence-week5.json")
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_independent_allocation_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_independent_allocation_rows_r1.parquet"
POSITIONS = ("QB", "RB", "FB", "WR", "TE")
MODES = ("direct_share", "scorer_hurdle")
BLOCKS = ((1, 4), (5, 9), (10, 13), (14, 18))
SEED = 20261015


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_player(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


def regression(loss: str) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss=loss,
        max_iter=180,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=35,
        l2_regularization=12.0,
        random_state=SEED,
    )


def classifier() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=160,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=35,
        l2_regularization=12.0,
        random_state=SEED,
    )


def probability_metrics(actual: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    actual = np.asarray(actual, dtype=int)
    probability = np.clip(np.asarray(probability, dtype=float), 1e-5, 1 - 1e-5)
    bins = pd.qcut(probability, q=min(10, len(probability)), duplicates="drop")
    grouped = pd.DataFrame({"p": probability, "y": actual, "bin": bins}).groupby(
        "bin", observed=True,
    ).agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"))
    return {
        "rows": int(len(actual)),
        "positiveRate": float(np.mean(actual)),
        "brier": float(brier_score_loss(actual, probability)),
        "logLoss": float(log_loss(actual, probability)),
        "auc": float(roc_auc_score(actual, probability)),
        "calibrationGap": float(np.average(
            np.abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"],
        )),
    }


def fit_platt(probability: np.ndarray, actual: np.ndarray) -> LogisticRegression:
    clipped = np.clip(np.asarray(probability, dtype=float), 1e-5, 1 - 1e-5)
    logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    return LogisticRegression(C=1.0, max_iter=500).fit(logits, actual)


def apply_platt(model: LogisticRegression, probability: np.ndarray) -> np.ndarray:
    clipped = np.clip(np.asarray(probability, dtype=float), 1e-5, 1 - 1e-5)
    logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    return np.clip(model.predict_proba(logits)[:, 1], 1e-5, 1 - 1e-5)


def stability(
    rows: pd.DataFrame,
    actual: np.ndarray,
    reference: np.ndarray,
    candidate: np.ndarray,
) -> dict[str, Any]:
    values = rows[["game_id", "week"]].copy()
    values["delta"] = (candidate - actual) ** 2 - (reference - actual) ** 2
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    rng = np.random.default_rng(SEED)
    bootstrap: list[float] = []
    for _ in range(20):
        indexes = rng.integers(0, len(grouped), size=(500, len(grouped)))
        sample = grouped[indexes]
        bootstrap.extend((sample[:, :, 0].sum(axis=1) / sample[:, :, 1].sum(axis=1)).tolist())
    segments: dict[str, dict[str, float | int]] = {}
    for lower, upper in BLOCKS:
        segment = values[values["week"].between(lower, upper)]
        segments[f"weeks_{lower}_{upper}"] = {
            "rows": int(len(segment)),
            "brierDelta": float(segment["delta"].mean()),
        }
    interval = [float(np.quantile(bootstrap, 0.025)), float(np.quantile(bootstrap, 0.975))]
    return {
        "games": int(len(grouped)),
        "brierDelta": float(values["delta"].mean()),
        "gameClusterBootstrap95": interval,
        "chronologicalSegments": segments,
        "passes": bool(
            interval[1] < 0
            and all(value["rows"] == 0 or value["brierDelta"] <= 0 for value in segments.values())
        ),
    }


def prepare_candidate_frame(
    external_manifest_path: pathlib.Path,
    history_manifest_path: pathlib.Path,
    injury_root: pathlib.Path,
) -> tuple[pd.DataFrame, list[str], list[str], dict[str, Any], Any, pd.DataFrame]:
    touchdown = load_module(
        "props_independent_td_source", ROOT / "scripts/operator/tournament_nfl_player_props_touchdowns.py",
    )
    external = load_module(
        "props_independent_td_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    availability = load_module(
        "props_independent_td_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py",
    )
    external_manifest = json.loads(external_manifest_path.read_text(encoding="utf-8"))
    external_path = pathlib.Path(external_manifest["featureFile"])
    if sha256(external_path) != external_manifest["featureFileSha256"] or external_manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(external_path), injury_root,
    )
    history_manifest = json.loads(history_manifest_path.read_text(encoding="utf-8"))
    history_path = pathlib.Path(history_manifest["featureFile"])
    if sha256(history_path) != history_manifest["featureFileSha256"]:
        raise RuntimeError("history feature safety contract mismatch")
    history = pd.read_parquet(history_path)
    pbp = touchdown.read_pbp()
    touchdown_history, _ = touchdown.add_touchdown_features(history, pbp)
    labels = touchdown_history[["row_id", "touchdowns", "anytime_td"]].copy()
    frame = frame.merge(labels, on="row_id", how="left", validate="one_to_one")
    historical = frame["season"].le(2025)
    if frame.loc[historical, "anytime_td"].isna().any():
        raise RuntimeError("historical touchdown outcomes did not match external features")
    frame.loc[historical, ["touchdowns", "anytime_td"]] = frame.loc[
        historical, ["touchdowns", "anytime_td"],
    ].fillna(0.0)
    keys = ["season", "week", "game_id", "team"]
    team_touchdowns = frame.groupby(keys, observed=True)["touchdowns"].transform("sum")
    frame["team_touchdowns"] = team_touchdowns
    frame["touchdown_share"] = np.where(
        team_touchdowns.gt(0), frame["touchdowns"] / team_touchdowns, 0.0,
    )
    groups = {name: list(values) for name, values in external_manifest["featureGroups"].items()}
    for position in POSITIONS:
        column = f"position_{position.lower()}"
        frame[column] = frame["position"].eq(position).astype(float)
        groups["base"].append(column)
    if "is_home" not in groups["base"]:
        groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
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
    numeric = list(dict.fromkeys([*player_features, *team_features]))
    frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
    return frame, player_features, team_features, injury_metadata, touchdown, history


def team_table(frame: pd.DataFrame, team_features: list[str]) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team"]
    outcomes = frame.groupby(keys, observed=True, as_index=False).agg(
        team_touchdowns=("touchdowns", "sum"),
    )
    context = frame.sort_values([*keys, "player_id"]).drop_duplicates(keys)[[*keys, *team_features]]
    return outcomes.merge(context, on=keys, validate="one_to_one")


def candidate_raw_probability(
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    training_through: int,
    prediction_season: int,
    player_features: list[str],
    team_features: list[str],
    test: pd.DataFrame,
    mode: str,
) -> tuple[np.ndarray, dict[str, Any]]:
    train_teams = teams[teams["season"].le(training_through)]
    current_teams = teams[teams["season"].eq(prediction_season)].copy()
    budget_model = regression("poisson").fit(
        train_teams[team_features], train_teams["team_touchdowns"].to_numpy(float),
    )
    current_teams["predicted_team_touchdowns"] = np.clip(
        np.asarray(budget_model.predict(current_teams[team_features]), dtype=float), 1e-6, None,
    )
    budget_index = current_teams.set_index(["game_id", "team"])["predicted_team_touchdowns"]
    budget = budget_index.reindex(pd.MultiIndex.from_frame(test[["game_id", "team"]])).to_numpy(float)
    if np.isnan(budget).any():
        raise RuntimeError(f"missing team touchdown budget for {prediction_season}")

    population = frame[
        frame["season"].le(training_through) & frame["position"].isin(POSITIONS)
    ].copy()
    active = population[population["participated"].eq(1)].copy()
    participation_model = classifier().fit(
        population[player_features], population["participated"].to_numpy(int),
    )
    if mode == "direct_share":
        share_model = regression("squared_error").fit(
            active[player_features], active["touchdown_share"].to_numpy(float),
        )
        scorer_model = None
    elif mode == "scorer_hurdle":
        scorer_model = classifier().fit(
            population[player_features], population["anytime_td"].to_numpy(int),
        )
        scorers = active[active["anytime_td"].eq(1)].copy()
        share_model = regression("squared_error").fit(
            scorers[player_features], scorers["touchdown_share"].to_numpy(float),
        )
    else:
        raise ValueError(mode)
    roster = frame[
        frame["season"].eq(prediction_season)
        & frame["position"].isin(POSITIONS)
        & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
    ].copy()
    conditional_share = np.clip(
        np.asarray(share_model.predict(roster[player_features]), dtype=float), 0.0, 1.0,
    )
    if scorer_model is None:
        gate = np.asarray(participation_model.predict_proba(roster[player_features])[:, 1], dtype=float)
    else:
        gate = np.asarray(scorer_model.predict_proba(roster[player_features])[:, 1], dtype=float)
    roster["raw_expected_share"] = gate * conditional_share
    denominator = roster.groupby(["game_id", "team"], observed=True)["raw_expected_share"].transform("sum")
    roster["normalized_expected_share"] = np.where(
        denominator.gt(0), roster["raw_expected_share"] / denominator, 0.0,
    )
    share_index = roster.set_index("row_id")["normalized_expected_share"]
    share = share_index.reindex(test["row_id"]).to_numpy(float)
    missing = np.isnan(share)
    if missing.any():
        fallback_share = np.clip(
            np.asarray(share_model.predict(test.loc[missing, player_features]), dtype=float), 0.0, 1.0,
        )
        if scorer_model is None:
            fallback_gate = np.asarray(
                participation_model.predict_proba(test.loc[missing, player_features])[:, 1], dtype=float,
            )
        else:
            fallback_gate = np.asarray(
                scorer_model.predict_proba(test.loc[missing, player_features])[:, 1], dtype=float,
            )
        share[missing] = fallback_gate * fallback_share
    hazard = np.clip(budget * share, 0.0, None)
    probability = np.clip(1.0 - np.exp(-hazard), 1e-5, 1 - 1e-5)
    return probability, {
        "trainingThrough": training_through,
        "predictionSeason": prediction_season,
        "mode": mode,
        "teamRows": int(len(current_teams)),
        "teamBudget": (
            probability_metrics(
                current_teams["team_touchdowns"].gt(0).to_numpy(int),
                1.0 - np.exp(-current_teams["predicted_team_touchdowns"].to_numpy(float)),
            )
            if current_teams["team_touchdowns"].gt(0).any()
            else None
        ),
        "testRows": int(len(test)),
        "rosterRows": int(len(roster)),
        "missingNormalizedShareRows": int(missing.sum()),
        "meanPredictedTeamTouchdowns": float(np.mean(budget)),
        "meanPredictedShare": float(np.mean(share)),
        "meanHazard": float(np.mean(hazard)),
    }


def reconstructed_market_context(touchdown: Any) -> pd.DataFrame:
    manifest = json.loads(touchdown.SOURCE_MANIFEST.read_text(encoding="utf-8"))
    frames: list[pd.DataFrame] = []
    columns = [
        "season", "week", "game_id", "home_team", "away_team", "spread_line", "total_line",
    ]
    for item in manifest["files"]:
        if item["dataset"] != "pbp" or not 2016 <= int(item["season"]) <= 2025:
            continue
        path = pathlib.Path(item["filename"])
        available = set(pq.read_schema(path).names)
        values = pq.read_table(path, columns=[name for name in columns if name in available]).to_pandas()
        frames.append(values.drop_duplicates("game_id"))
    context = pd.concat(frames, ignore_index=True).drop_duplicates("game_id")
    if context[["spread_line", "total_line"]].isna().any(axis=1).mean() > 0.01:
        raise RuntimeError("reconstructed nflverse market context is incomplete")
    return context


def incumbent_frame(
    touchdown: Any,
    history: pd.DataFrame,
    market_context: pd.DataFrame,
) -> tuple[pd.DataFrame, list[str]]:
    frame, added = touchdown.add_touchdown_features(history, touchdown.read_pbp(), market_context)
    manifest = json.loads(HISTORY_MANIFEST.read_text(encoding="utf-8"))
    features = [*manifest["modelFeatureColumns"], *added, "is_home"]
    for position in POSITIONS:
        column = f"position_{position.lower()}"
        frame[column] = frame["position"].eq(position).astype(float)
        features.append(column)
    return frame, features


def incumbent_probabilities(
    touchdown: Any,
    frame: pd.DataFrame,
    features: list[str],
    evaluation_season: int,
) -> tuple[pd.DataFrame, np.ndarray]:
    eligible = frame["prior_participations"].ge(1) & frame["position"].isin(POSITIONS)
    calibration_season = evaluation_season - 1
    calibration_train = frame[eligible & frame["season"].le(calibration_season - 1)]
    calibration_rows = frame[eligible & frame["season"].eq(calibration_season)].copy()
    calibration_model = touchdown.fresh("hgb_classifier")
    calibration_model.fit(calibration_train[features], calibration_train["anytime_td"])
    calibration_raw = np.clip(
        calibration_model.predict_proba(calibration_rows[features])[:, 1], 0.005, 0.995,
    )
    calibrator = touchdown.platt_fit(calibration_raw, calibration_rows["anytime_td"].to_numpy(int))
    evaluation_train = frame[eligible & frame["season"].le(evaluation_season - 1)]
    evaluation_rows = frame[eligible & frame["season"].eq(evaluation_season)].copy()
    evaluation_model = touchdown.fresh("hgb_classifier")
    evaluation_model.fit(evaluation_train[features], evaluation_train["anytime_td"])
    evaluation_raw = np.clip(
        evaluation_model.predict_proba(evaluation_rows[features])[:, 1], 0.005, 0.995,
    )
    return evaluation_rows, touchdown.platt_predict(calibrator, evaluation_raw)


def current_rows(board_path: pathlib.Path, evidence_path: pathlib.Path, frame: pd.DataFrame) -> pd.DataFrame:
    board = json.loads(board_path.read_text(encoding="utf-8"))
    forecasts = pd.DataFrame(board["forecasts"])
    forecasts = forecasts[
        forecasts["market"].eq("anytime_td") & forecasts["canonicalMainLine"].eq(True)
    ].copy()
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))["privateHistory"]["rows"]
    identities = pd.DataFrame(evidence)
    identities = identities[identities["market"].eq("anytime_td")][[
        "gameId", "playerName", "team",
    ]].drop_duplicates(["gameId", "playerName"])
    forecasts = forecasts.merge(identities, on=["gameId", "playerName"], how="left", validate="one_to_one")
    forecasts["normalized_player"] = forecasts["playerName"].map(normalize_player)
    available = frame[frame["season"].eq(2026) & frame["week"].eq(5)].copy()
    available["normalized_player"] = available["player_name"].map(normalize_player)
    matched = forecasts.merge(
        available[["team", "normalized_player", "row_id"]],
        on=["team", "normalized_player"],
        how="left",
        validate="one_to_one",
    )
    if matched["row_id"].isna().any():
        missing = matched.loc[matched["row_id"].isna(), ["gameId", "playerName", "team"]]
        raise RuntimeError(f"unmatched current Anytime TD identities: {missing.to_dict('records')}")
    return matched


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path, default=EXTERNAL_MANIFEST)
    parser.add_argument("--history-manifest", type=pathlib.Path, default=HISTORY_MANIFEST)
    parser.add_argument("--injury-root", type=pathlib.Path, default=INJURY_ROOT)
    parser.add_argument("--market-context", type=pathlib.Path, default=MARKET_CONTEXT)
    parser.add_argument("--current-board", type=pathlib.Path, default=CURRENT_BOARD)
    parser.add_argument("--current-evidence", type=pathlib.Path, default=CURRENT_EVIDENCE)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    frame, player_features, team_features, injury_metadata, touchdown, history = prepare_candidate_frame(
        args.external_manifest, args.history_manifest, args.injury_root,
    )
    if args.market_context.exists():
        market_context = pd.read_csv(args.market_context, low_memory=False)
        market_context_source = {
            "kind": "cached_checksum_pinned_csv",
            "path": str(args.market_context),
            "sha256": sha256(args.market_context),
        }
    else:
        market_context = reconstructed_market_context(touchdown)
        market_context_source = {
            "kind": "reconstructed_from_checksum_pinned_nflverse_pbp_game_fields",
            "games": int(len(market_context)),
            "missingSpreadOrTotal": int(market_context[["spread_line", "total_line"]].isna().any(axis=1).sum()),
        }
    released_frame, released_features = incumbent_frame(touchdown, history, market_context)
    teams = team_table(frame[frame["season"].le(2025)], team_features)
    by_row = frame.set_index("row_id", drop=False)
    phases: dict[str, pd.DataFrame] = {}
    reference_probabilities: dict[str, np.ndarray] = {}
    candidate_probabilities: dict[str, dict[str, np.ndarray]] = {mode: {} for mode in MODES}
    diagnostics: dict[str, Any] = {}
    for evaluation_season, phase in ((2024, "selection"), (2025, "confirmation")):
        incumbent_rows, incumbent = incumbent_probabilities(
            touchdown, released_frame, released_features, evaluation_season,
        )
        test = by_row.loc[incumbent_rows["row_id"]].reset_index(drop=True)
        incumbent_rows = incumbent_rows.reset_index(drop=True)
        phases[phase] = test
        reference_probabilities[phase] = incumbent
        calibration_season = evaluation_season - 1
        calibration_rows = frame[
            frame["season"].eq(calibration_season)
            & frame["prior_participations"].ge(1)
            & frame["position"].isin(POSITIONS)
        ].copy()
        for mode in MODES:
            calibration_raw, calibration_diagnostic = candidate_raw_probability(
                frame,
                teams,
                calibration_season - 1,
                calibration_season,
                player_features,
                team_features,
                calibration_rows,
                mode,
            )
            calibrator = fit_platt(calibration_raw, calibration_rows["anytime_td"].to_numpy(int))
            evaluation_raw, evaluation_diagnostic = candidate_raw_probability(
                frame,
                teams,
                evaluation_season - 1,
                evaluation_season,
                player_features,
                team_features,
                test,
                mode,
            )
            candidate_probabilities[mode][phase] = apply_platt(calibrator, evaluation_raw)
            diagnostics[f"{phase}:{mode}"] = {
                "calibration": calibration_diagnostic,
                "evaluation": evaluation_diagnostic,
            }

    reference = {
        phase: probability_metrics(phases[phase]["anytime_td"].to_numpy(int), reference_probabilities[phase])
        for phase in ("selection", "confirmation")
    }
    reports: dict[str, dict[str, Any]] = {}
    for mode in MODES:
        reports[mode] = {}
        for phase in ("selection", "confirmation"):
            actual = phases[phase]["anytime_td"].to_numpy(int)
            reports[mode][phase] = probability_metrics(actual, candidate_probabilities[mode][phase])
            if phase == "confirmation":
                reports[mode]["stability"] = stability(
                    phases[phase], actual, reference_probabilities[phase], candidate_probabilities[mode][phase],
                )
    selectable = [
        mode for mode in MODES
        if reports[mode]["selection"]["brier"] < reference["selection"]["brier"]
        and reports[mode]["selection"]["logLoss"] < reference["selection"]["logLoss"]
        and reports[mode]["selection"]["auc"] >= reference["selection"]["auc"]
    ]
    selected = min(selectable, key=lambda mode: (
        reports[mode]["selection"]["brier"], reports[mode]["selection"]["logLoss"],
    )) if selectable else None
    confirmed = bool(
        selected
        and reports[selected]["confirmation"]["brier"] <= reference["confirmation"]["brier"]
        and reports[selected]["confirmation"]["logLoss"] <= reference["confirmation"]["logLoss"]
        and reports[selected]["confirmation"]["auc"] >= reference["confirmation"]["auc"]
        and reports[selected]["stability"]["passes"]
    )

    current_gate: dict[str, Any] | None = None
    current = current_rows(args.current_board, args.current_evidence, frame)
    current_candidate = current["rawProbability"].to_numpy(float)
    if confirmed and selected:
        calibration_rows = frame[
            frame["season"].eq(2025)
            & frame["prior_participations"].ge(1)
            & frame["position"].isin(POSITIONS)
        ].copy()
        calibration_raw, _ = candidate_raw_probability(
            frame, teams, 2024, 2025, player_features, team_features, calibration_rows, selected,
        )
        calibrator = fit_platt(calibration_raw, calibration_rows["anytime_td"].to_numpy(int))
        current_test = by_row.loc[current["row_id"]].reset_index(drop=True)
        current_raw, current_diagnostic = candidate_raw_probability(
            frame,
            team_table(frame, team_features),
            2025,
            2026,
            player_features,
            team_features,
            current_test,
            selected,
        )
        current_candidate = apply_platt(calibrator, current_raw)
        actual = current["actual"].to_numpy(float).astype(int) > 0
        current_reference = current["rawProbability"].to_numpy(float)
        reference_metrics = probability_metrics(actual, current_reference)
        candidate_metrics = probability_metrics(actual, current_candidate)
        current_gate = {
            "reference": reference_metrics,
            "candidate": candidate_metrics,
            "passes": bool(
                candidate_metrics["brier"] < reference_metrics["brier"]
                and candidate_metrics["logLoss"] < reference_metrics["logLoss"]
                and candidate_metrics["auc"] >= reference_metrics["auc"]
                and candidate_metrics["calibrationGap"] <= reference_metrics["calibrationGap"]
            ),
            "diagnostic": current_diagnostic,
        }

    output_rows: list[pd.DataFrame] = []
    for phase in ("selection", "confirmation"):
        values = phases[phase][[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", "anytime_td",
        ]].copy().rename(columns={"anytime_td": "actual"})
        values["phase"] = phase
        values["reference_probability"] = reference_probabilities[phase]
        values["candidate_probability"] = (
            candidate_probabilities[selected][phase] if selected else reference_probabilities[phase]
        )
        output_rows.append(values)
    locked_rows = current[["row_id", "playerName", "team", "actual", "gameId"]].copy()
    locked_rows["season"] = 2026
    locked_rows["week"] = 5
    locked_rows["phase"] = "locked_replay"
    locked_rows["reference_probability"] = current["rawProbability"].to_numpy(float)
    locked_rows["candidate_probability"] = current_candidate
    output_rows.append(locked_rows)
    result_rows = pd.concat(output_rows, ignore_index=True, sort=False)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)

    payload = {
        "release": "nfl_player_props_anytime_td_independent_allocation_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependentCandidate": True,
        "candidateMarketFeatures": [],
        "referenceIncludesMarketImpliedTeamTouchdowns": True,
        "referenceMarketContext": market_context_source,
        "chronology": {
            "selection": 2024,
            "confirmation": 2025,
            "diagnostic": "complete immutable Week 5 2026 canonical Anytime TD board",
        },
        "featureCounts": {"player": len(player_features), "team": len(team_features)},
        "injuryEvidence": injury_metadata,
        "reference": reference,
        "candidates": reports,
        "selectionEligible": selectable,
        "selected": selected,
        "confirmed": confirmed,
        "currentSeason": current_gate,
        "diagnostics": diagnostics,
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "selected": selected,
        "confirmed": confirmed,
        "currentSeason": current_gate,
    }, indent=2))


if __name__ == "__main__":
    main()
