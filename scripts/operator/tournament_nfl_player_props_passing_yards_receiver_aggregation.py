#!/usr/bin/env python3
"""Research-only bottom-up receiver aggregation for Passing Yards."""

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


ROOT = pathlib.Path(__file__).resolve().parents[2]
DECOMPOSITION = ROOT / "scripts/operator/tournament_nfl_player_props_passing_attempts_decomposition.py"
FOUNDATION = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
AVAILABILITY = ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_yards_receiver_aggregation_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_yards_receiver_aggregation_rows_r1.parquet"
WEIGHTS = (0.25, 0.50, 0.75, 1.0)
SEED = 20261015


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = np.asarray(prediction, dtype=float) - np.asarray(actual, dtype=float)
    return {
        "rows": int(len(error)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
    }


def direction(actual: np.ndarray, prediction: np.ndarray, line: np.ndarray) -> float:
    return float(np.mean(np.sign(prediction - line) == np.sign(actual - line)))


def cluster_interval(frame: pd.DataFrame, candidate: str, incumbent: str, resamples: int = 4000) -> dict[str, float | int]:
    values = frame.copy()
    values["delta"] = np.abs(values[candidate] - values["actual"]) - np.abs(values[incumbent] - values["actual"])
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    random = np.random.default_rng(SEED)
    draws = np.empty(resamples)
    for index in range(resamples):
        sample = grouped[random.integers(0, len(grouped), len(grouped))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    lower, median, upper = np.quantile(draws, [0.025, 0.5, 0.975])
    return {"gameClusters": int(len(grouped)), "lower": float(lower), "median": float(median), "upper": float(upper)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()
    decomp = load("py_receiver_decomposition", DECOMPOSITION)
    foundation = load("py_receiver_foundation", FOUNDATION)
    availability = load("py_receiver_availability", AVAILABILITY)
    manifest = decomp.read_manifest(decomp.EXTERNAL_MANIFEST)
    feature_path = pathlib.Path(str(manifest["featureFile"]))
    if decomp.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *groups["base"], *groups["state"], *groups.get("pfr", []),
        *groups.get("ftn", []), *groups.get("ngs", []), *groups.get("depth", []),
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
    teams = foundation.team_table(frame, team_features)
    opportunity_groups = foundation.group_table(frame, team_features)

    room_cache: dict[int, pd.Series] = {}

    def receiver_room(season: int) -> pd.Series:
        if season in room_cache:
            return room_cache[season]
        roster = frame[
            frame["season"].eq(season)
            & frame["expected_role_group"].isin(["BACK", "WR", "TE"])
            & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
        ].copy()
        roster["predicted_receiving_yards"] = 0.0
        for group in ("BACK", "WR", "TE"):
            mask = roster["expected_role_group"].eq(group).to_numpy()
            subset = roster.loc[mask]
            budget = foundation.budget_prediction(
                opportunity_groups, season, team_features, "targets",
                subset[["game_id", "team"]], group,
            )
            share = foundation.normalized_share_prediction(
                frame, season, player_features, "expected_role_target_share", group,
                subset, known_active_row_ids=set(),
            )
            yards_per_target = foundation.rate_prediction(
                frame, season, player_features, "receiving_yards", "targets",
                group, subset, 0.0, 30.0, True,
            )
            roster.loc[mask, "predicted_receiving_yards"] = np.clip(
                budget * share * yards_per_target, 0.0, None,
            )
        result = roster.groupby(["game_id", "team"], observed=True)["predicted_receiving_yards"].sum()
        room_cache[season] = result
        return result

    def prediction(rows: pd.DataFrame, season: int) -> tuple[np.ndarray, dict[str, np.ndarray]]:
        room = receiver_room(season)
        index = pd.MultiIndex.from_frame(rows[["game_id", "team"]])
        team_yards = room.reindex(index).to_numpy(float)
        team_attempts = foundation.budget_prediction(
            teams, season, team_features, "team_pass_attempts", rows[["game_id", "team"]],
        )
        quarterback_attempts = foundation.passing_predictions(
            frame, teams, season, team_features, player_features, rows,
        )["passing_attempts"]
        quarterback_share = np.clip(
            np.divide(quarterback_attempts, team_attempts, out=np.ones(len(rows)), where=team_attempts > 0),
            0.50, 1.0,
        )
        if np.isnan(team_yards).any():
            raise RuntimeError(f"receiver-room total missing for {season}")
        return np.clip(team_yards * quarterback_share, 0.0, None), {
            "receiverRoomYards": team_yards,
            "predictedTeamAttempts": team_attempts,
            "predictedQuarterbackAttempts": quarterback_attempts,
            "predictedQuarterbackShare": quarterback_share,
        }

    projections = pd.read_parquet(decomp.FOUNDATION_PROJECTIONS)
    projections = projections[projections["market"].eq("passing_yards")].copy()
    outputs: list[pd.DataFrame] = []
    reports: dict[str, Any] = {}
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        base = projections[projections["phase"].eq(phase)].copy()
        requested = frame.set_index("row_id").loc[base["row_id"]].reset_index(drop=True)
        challenger, components = prediction(requested, season)
        base["incumbent"] = base["candidate_projection"].to_numpy(float)
        base["challenger"] = challenger
        for name, values in components.items():
            base[name] = values
        for weight in WEIGHTS:
            base[f"blend_{int(weight * 100)}"] = (
                (1.0 - weight) * base["incumbent"] + weight * base["challenger"]
            )
        reports[phase] = {
            "incumbent": metrics(base["actual"].to_numpy(float), base["incumbent"].to_numpy(float)),
            "candidates": {
                f"blend_{int(weight * 100)}": metrics(
                    base["actual"].to_numpy(float), base[f"blend_{int(weight * 100)}"].to_numpy(float),
                ) for weight in WEIGHTS
            },
        }
        outputs.append(base)
    eligible = [
        name for name, result in reports["selection"]["candidates"].items()
        if float(result["mae"]) < float(reports["selection"]["incumbent"]["mae"])
        and float(result["rmse"]) < float(reports["selection"]["incumbent"]["rmse"])
    ]
    selected = min(eligible, key=lambda name: (
        float(reports["selection"]["candidates"][name]["mae"])
        + float(reports["selection"]["candidates"][name]["rmse"])
    )) if eligible else None
    confirmed = bool(
        selected
        and float(reports["confirmation"]["candidates"][selected]["mae"])
        <= float(reports["confirmation"]["incumbent"]["mae"])
        and float(reports["confirmation"]["candidates"][selected]["rmse"])
        <= float(reports["confirmation"]["incumbent"]["rmse"])
    )
    frozen = selected if confirmed else None

    current = projections[projections["phase"].eq("locked_replay")].copy()
    requested = frame.set_index("row_id").loc[current["row_id"]].reset_index(drop=True)
    challenger, components = prediction(requested, 2026)
    current["incumbent"] = current["component_projection"].to_numpy(float)
    current["challenger"] = challenger
    for name, values in components.items():
        current[name] = values
    for weight in WEIGHTS:
        current[f"blend_{int(weight * 100)}"] = (
            (1.0 - weight) * current["incumbent"] + weight * current["challenger"]
        )
    replay = pd.DataFrame(json.loads(decomp.LOCKED_REPLAY.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("passing_yards")].copy()
    replay["normalized_player"] = replay["playerName"].map(decomp.normalize_player)
    current["normalized_player"] = current["player_name"].map(decomp.normalize_player)
    current = current.merge(
        replay[["week", "team", "normalized_player", "line"]],
        on=["week", "team", "normalized_player"], how="left", validate="one_to_many",
    )
    if current["line"].isna().any():
        raise RuntimeError("offered Passing Yards replay line did not match")
    current_report = {
        "incumbent": metrics(current["actual"].to_numpy(float), current["incumbent"].to_numpy(float)),
        "candidate": metrics(current["actual"].to_numpy(float), current[frozen].to_numpy(float)) if frozen else None,
        "incumbentDirection": direction(
            current["actual"].to_numpy(float), current["incumbent"].to_numpy(float), current["line"].to_numpy(float),
        ),
        "candidateDirection": direction(
            current["actual"].to_numpy(float), current[frozen].to_numpy(float), current["line"].to_numpy(float),
        ) if frozen else None,
        "byWeek": {
            str(int(week)): {
                "incumbent": metrics(group["actual"].to_numpy(float), group["incumbent"].to_numpy(float)),
                "candidate": metrics(group["actual"].to_numpy(float), group[frozen].to_numpy(float)) if frozen else None,
            } for week, group in current.groupby("week", observed=True)
        },
        "clusteredMaeDelta": cluster_interval(current, frozen, "incumbent") if frozen else None,
    }
    gate = bool(
        frozen and current_report["candidate"]
        and float(current_report["candidate"]["mae"]) < float(current_report["incumbent"]["mae"])
        and float(current_report["candidate"]["rmse"]) < float(current_report["incumbent"]["rmse"])
        and float(current_report["candidateDirection"]) >= float(current_report["incumbentDirection"])
    )
    current["phase"] = "locked_replay"
    outputs.append(current)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(outputs, ignore_index=True, sort=False).to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_passing_yards_receiver_aggregation_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "candidate": "bottom-up RB/FB/WR/TE receiving-room aggregation allocated by independent QB attempt share",
        "reports": reports,
        "selected": selected,
        "confirmed": confirmed,
        "frozenCandidate": frozen,
        "currentSeasonLockedReplay": current_report,
        "pointGatePassed": gate,
        "productionAuthorized": False,
        "injurySources": injury_metadata,
        "sourceChecksums": {
            "externalManifest": decomp.sha256_file(decomp.EXTERNAL_MANIFEST),
            "foundationProjections": decomp.sha256_file(decomp.FOUNDATION_PROJECTIONS),
            "lockedReplay": decomp.sha256_file(decomp.LOCKED_REPLAY),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
