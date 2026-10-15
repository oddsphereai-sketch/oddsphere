#!/usr/bin/env python3
"""Qualify market-free pregame score state for Passing Attempts research."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


ROOT = pathlib.Path(__file__).resolve().parents[2]
DECOMPOSITION = ROOT / "scripts/operator/tournament_nfl_player_props_passing_attempts_decomposition.py"
FOUNDATION = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_game_state_r1.json"
WEIGHTS = (0.25, 0.50, 0.75, 1.0)


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def final_scores(paths: list[pathlib.Path]) -> pd.DataFrame:
    columns = [
        "season", "season_type", "week", "game_id", "play_id", "home_team", "away_team",
        "total_home_score", "total_away_score",
    ]
    frames: list[pd.DataFrame] = []
    for path in paths:
        available = set(pq.read_schema(path).names)
        selected = [column for column in columns if column in available]
        frame = pq.read_table(path, columns=selected).to_pandas()
        for column in columns:
            if column not in frame:
                frame[column] = pd.NA
        frames.append(frame)
    plays = pd.concat(frames, ignore_index=True)
    plays = plays[plays["season_type"].fillna("").eq("REG")].copy()
    plays["play_id"] = pd.to_numeric(plays["play_id"], errors="coerce")
    plays["total_home_score"] = pd.to_numeric(plays["total_home_score"], errors="coerce")
    plays["total_away_score"] = pd.to_numeric(plays["total_away_score"], errors="coerce")
    games = plays.sort_values(["game_id", "play_id"]).groupby("game_id", observed=True).tail(1)
    home = games[["season", "week", "game_id", "home_team", "away_team", "total_home_score", "total_away_score"]].rename(
        columns={"home_team": "team", "away_team": "opponent", "total_home_score": "team_score", "total_away_score": "opponent_score"},
    )
    away = games[["season", "week", "game_id", "home_team", "away_team", "total_home_score", "total_away_score"]].rename(
        columns={"away_team": "team", "home_team": "opponent", "total_away_score": "team_score", "total_home_score": "opponent_score"},
    )
    return pd.concat([home, away], ignore_index=True)


def metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = np.asarray(prediction, dtype=float) - np.asarray(actual, dtype=float)
    return {
        "rows": int(len(error)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    args = parser.parse_args()
    decomp = load("pa_state_decomposition", DECOMPOSITION)
    foundation = load("pa_state_foundation", FOUNDATION)

    manifest = decomp.read_manifest(decomp.EXTERNAL_MANIFEST)
    feature_path = pathlib.Path(str(manifest["featureFile"]))
    if decomp.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame = foundation.add_role_shares(pd.read_parquet(feature_path))
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    player_features = [
        name for name in list(dict.fromkeys([
            *groups["base"], *groups["state"], *groups.get("pfr", []),
            *groups.get("ftn", []), *groups.get("ngs", []), *groups.get("depth", []),
        ])) if name in frame.columns
    ]
    frame[[*dict.fromkeys([*team_features, *player_features])]] = frame[
        [*dict.fromkeys([*team_features, *player_features])]
    ].replace([np.inf, -np.inf], np.nan)

    pbp_paths = decomp.verified_pbp_paths()
    labels = decomp.pbp_team_labels(pbp_paths).merge(
        final_scores(pbp_paths),
        on=["season", "week", "game_id", "team", "opponent"],
        how="inner",
        validate="one_to_one",
    )
    context = frame.sort_values(
        ["season", "week", "game_id", "team", "player_id"],
    ).drop_duplicates(["season", "week", "game_id", "team"])[
        ["season", "week", "game_id", "team", "opponent", *team_features]
    ]
    teams = labels.drop(columns="opponent").merge(
        context,
        on=["season", "week", "game_id", "team"],
        how="inner",
        validate="one_to_one",
    )

    state_frames: list[pd.DataFrame] = []
    for season in range(2019, 2027):
        train = teams[teams["season"].lt(season)]
        test = teams[teams["season"].eq(season)].copy()
        if train.empty or test.empty:
            continue
        score_model = decomp.factor_model("poisson").fit(
            train[team_features], train["team_score"].to_numpy(float),
        )
        test["independent_points"] = np.clip(
            np.asarray(score_model.predict(test[team_features]), dtype=float), 7.0, 45.0,
        )
        opponent = test.set_index(["game_id", "team"])["independent_points"]
        opponent_index = pd.MultiIndex.from_frame(
            test[["game_id", "opponent"]].rename(columns={"opponent": "team"}),
        )
        test["independent_opponent_points"] = opponent.reindex(opponent_index).to_numpy(float)
        test["independent_margin"] = test["independent_points"] - test["independent_opponent_points"]
        test["independent_total"] = test["independent_points"] + test["independent_opponent_points"]
        state_frames.append(test)
    state = pd.concat(state_frames, ignore_index=True)
    state_features = ["independent_points", "independent_opponent_points", "independent_margin", "independent_total"]

    leaders = foundation.lead_passer_rows(frame)
    attempt_index = teams.set_index(["season", "game_id", "team"])["credited_attempts"]
    leader_index = pd.MultiIndex.from_frame(leaders[["season", "game_id", "team"]])
    leaders["lead_pass_share"] = (
        leaders["passing_attempts"].to_numpy(float)
        / np.maximum(attempt_index.reindex(leader_index).to_numpy(float), 1.0)
    ).clip(0.50, 1.0)

    def prediction(rows: pd.DataFrame, season: int) -> np.ndarray:
        train = state[state["season"].lt(season)]
        current = state[state["season"].eq(season)].copy()
        attempt_model = decomp.factor_model("poisson").fit(
            train[[*team_features, *state_features]], train["credited_attempts"].to_numpy(float),
        )
        current["predicted_team_attempts"] = np.clip(
            np.asarray(attempt_model.predict(current[[*team_features, *state_features]]), dtype=float),
            8.0, 60.0,
        )
        team_budget = current.set_index(["game_id", "team"])["predicted_team_attempts"]
        requested = pd.MultiIndex.from_frame(rows[["game_id", "team"]])
        share_train = leaders[leaders["season"].lt(season) & leaders["passing_attempts"].gt(0)]
        share_model = foundation.model("squared_error").fit(
            share_train[player_features], share_train["lead_pass_share"].to_numpy(float),
        )
        share = np.clip(np.asarray(share_model.predict(rows[player_features]), dtype=float), 0.50, 1.0)
        values = team_budget.reindex(requested).to_numpy(float) * share
        if np.isnan(values).any():
            raise RuntimeError(f"missing game-state Passing Attempts prediction for {season}")
        return values

    projections = pd.read_parquet(decomp.FOUNDATION_PROJECTIONS)
    projections = projections[projections["market"].eq("passing_attempts")].copy()
    all_rows: list[pd.DataFrame] = []
    reports: dict[str, Any] = {}
    for season, phase in ((2024, "selection"), (2025, "confirmation"), (2026, "diagnostic"), (2026, "locked_replay")):
        rows = projections[projections["phase"].eq(phase)].copy()
        requested = frame.set_index("row_id").loc[rows["row_id"]].reset_index(drop=True)
        rows["incumbent"] = (
            rows["candidate_projection"].to_numpy(float)
            if phase in {"selection", "confirmation"}
            else rows["component_projection"].to_numpy(float)
        )
        rows["challenger"] = prediction(requested, season)
        for weight in WEIGHTS:
            rows[f"blend_{int(weight * 100)}"] = (
                (1.0 - weight) * rows["incumbent"] + weight * rows["challenger"]
            )
        reports[phase] = {
            "incumbent": metrics(rows["actual"].to_numpy(float), rows["incumbent"].to_numpy(float)),
            "candidates": {
                f"blend_{int(weight * 100)}": metrics(
                    rows["actual"].to_numpy(float), rows[f"blend_{int(weight * 100)}"].to_numpy(float),
                ) for weight in WEIGHTS
            },
        }
        all_rows.append(rows)

    selectable = [
        name for name, result in reports["selection"]["candidates"].items()
        if float(result["mae"]) < float(reports["selection"]["incumbent"]["mae"])
        and float(result["rmse"]) < float(reports["selection"]["incumbent"]["rmse"])
    ]
    selected = min(selectable, key=lambda name: (
        float(reports["selection"]["candidates"][name]["mae"])
        + float(reports["selection"]["candidates"][name]["rmse"])
    )) if selectable else None
    confirmed = bool(
        selected
        and float(reports["confirmation"]["candidates"][selected]["mae"]) <= float(reports["confirmation"]["incumbent"]["mae"])
        and float(reports["confirmation"]["candidates"][selected]["rmse"]) <= float(reports["confirmation"]["incumbent"]["rmse"])
    )
    frozen = selected if confirmed else None
    current = pd.concat(all_rows, ignore_index=True)
    diagnostic = current[current["phase"].eq("diagnostic")].copy()
    diagnostic["team_max"] = diagnostic.groupby(["game_id", "team"], observed=True)["actual"].transform("max")
    leads = diagnostic[diagnostic["actual"].eq(diagnostic["team_max"])]
    lead_report = {
        "incumbent": metrics(leads["actual"].to_numpy(float), leads["incumbent"].to_numpy(float)),
        "candidate": metrics(leads["actual"].to_numpy(float), leads[frozen].to_numpy(float)) if frozen else None,
        "byWeek": {
            str(int(week)): {
                "incumbent": metrics(group["actual"].to_numpy(float), group["incumbent"].to_numpy(float)),
                "candidate": metrics(group["actual"].to_numpy(float), group[frozen].to_numpy(float)) if frozen else None,
            } for week, group in leads.groupby("week", observed=True)
        },
    }
    advance = bool(
        frozen and lead_report["candidate"]
        and float(lead_report["candidate"]["mae"]) < float(lead_report["incumbent"]["mae"])
        and float(lead_report["candidate"]["rmse"]) < float(lead_report["incumbent"]["rmse"])
    )
    output = {
        "release": "nfl_player_props_passing_attempts_game_state_qualification_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "candidate": "direct team attempts with expanding-window independent score state",
        "reports": reports,
        "selected": selected,
        "confirmed": confirmed,
        "frozenCandidate": frozen,
        "currentSeasonLeadPassers": lead_report,
        "stateInputPointGatePassed": advance,
        "simulationAuthorizedForNextStage": advance,
        "productionAuthorized": False,
        "sourceChecksums": {
            "externalManifest": decomp.sha256_file(decomp.EXTERNAL_MANIFEST),
            "foundationProjections": decomp.sha256_file(decomp.FOUNDATION_PROJECTIONS),
            "basePbpManifest": decomp.sha256_file(decomp.BASE_SOURCE_MANIFEST),
            "currentPbpManifest": decomp.sha256_file(decomp.CURRENT_SOURCE_MANIFEST),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
