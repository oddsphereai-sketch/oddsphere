#!/usr/bin/env python3
"""Research-only hierarchical opportunity tournament for Passing Attempts."""

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
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_hierarchical_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_hierarchical_rows_r1.parquet"
TEAM_PSEUDO_COUNTS = (4.0, 8.0, 16.0)
QB_PSEUDO_COUNTS = (2.0, 4.0, 8.0)
OPPONENT_WEIGHTS = (0.0, 0.25)
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


def cluster_interval(frame: pd.DataFrame, candidate: str, incumbent: str) -> dict[str, float | int]:
    values = frame.copy()
    values["delta"] = np.abs(values[candidate] - values["actual"]) - np.abs(values[incumbent] - values["actual"])
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    random = np.random.default_rng(SEED)
    draws = np.empty(4000)
    for index in range(len(draws)):
        sample = grouped[random.integers(0, len(grouped), len(grouped))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    lower, median, upper = np.quantile(draws, [0.025, 0.5, 0.975])
    return {
        "gameClusters": int(len(grouped)),
        "lower": float(lower),
        "median": float(median),
        "upper": float(upper),
    }


def candidate_name(team_pseudo: float, qb_pseudo: float, opponent_weight: float) -> str:
    return f"team_{int(team_pseudo)}__qb_{int(qb_pseudo)}__opp_{int(opponent_weight * 100)}"


def add_shifted_pooling_state(teams: pd.DataFrame, leaders: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    team_values = teams.sort_values(["team", "season", "week", "game_id"]).copy()
    team_group = team_values.groupby("team", observed=True)["credited_attempts"]
    team_values["team_recent_attempts"] = team_group.transform(
        lambda values: values.shift(1).rolling(8, min_periods=1).mean(),
    )
    team_values["team_recent_count"] = team_values.groupby("team", observed=True).cumcount().clip(upper=8).astype(float)
    defense_values = teams.sort_values(["opponent", "season", "week", "game_id"]).copy()
    defense_group = defense_values.groupby("opponent", observed=True)["credited_attempts"]
    defense_values["opponent_recent_allowed_attempts"] = defense_group.transform(
        lambda values: values.shift(1).rolling(8, min_periods=1).mean(),
    )
    defense_values["opponent_recent_count"] = defense_values.groupby("opponent", observed=True).cumcount().clip(upper=8).astype(float)
    team_values = team_values.merge(
        defense_values[["season", "week", "game_id", "team", "opponent", "opponent_recent_allowed_attempts", "opponent_recent_count"]],
        on=["season", "week", "game_id", "team", "opponent"],
        how="left",
        validate="one_to_one",
    )

    leader_values = leaders.sort_values(["player_id", "season", "week", "game_id"]).copy()
    share_group = leader_values.groupby("player_id", observed=True)["lead_pass_share"]
    leader_values["qb_recent_share"] = share_group.transform(
        lambda values: values.shift(1).rolling(8, min_periods=1).mean(),
    )
    leader_values["qb_recent_count"] = leader_values.groupby("player_id", observed=True).cumcount().clip(upper=8).astype(float)
    return team_values, leader_values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    decomp = load("pa_hierarchical_decomposition", DECOMPOSITION)
    foundation = load("pa_hierarchical_foundation", FOUNDATION)
    availability = load("pa_hierarchical_availability", AVAILABILITY)
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
    frame[list(dict.fromkeys([*player_features, *team_features]))] = frame[
        list(dict.fromkeys([*player_features, *team_features]))
    ].replace([np.inf, -np.inf], np.nan)

    labels = decomp.pbp_team_labels(decomp.verified_pbp_paths())
    team_context = frame.sort_values(
        ["season", "week", "game_id", "team", "player_id"],
    ).drop_duplicates(["season", "week", "game_id", "team"])[
        ["season", "week", "game_id", "team", *team_features]
    ]
    teams = labels.merge(team_context, on=["season", "week", "game_id", "team"], how="inner", validate="one_to_one")
    leaders = foundation.lead_passer_rows(frame)
    attempt_index = teams.set_index(["season", "game_id", "team"])["credited_attempts"]
    leader_keys = pd.MultiIndex.from_frame(leaders[["season", "game_id", "team"]])
    leaders["team_attempts"] = attempt_index.reindex(leader_keys).to_numpy(float)
    leaders = leaders[leaders["team_attempts"].gt(0)].copy()
    leaders["lead_pass_share"] = (leaders["passing_attempts"] / leaders["team_attempts"]).clip(0.50, 1.0)
    teams, leaders = add_shifted_pooling_state(teams, leaders)

    team_lookup = teams.set_index(["season", "game_id", "team"])
    leader_lookup = leaders.set_index(["season", "game_id", "team", "player_id"])

    def components(rows: pd.DataFrame, season: int) -> dict[str, np.ndarray]:
        train_teams = teams[teams["season"].lt(season)]
        common_team_model = foundation.model("poisson").fit(
            train_teams[team_features], train_teams["credited_attempts"].to_numpy(float),
        )
        common_team = np.clip(np.asarray(common_team_model.predict(rows[team_features]), dtype=float), 8.0, 60.0)
        team_keys = pd.MultiIndex.from_frame(rows[["season", "game_id", "team"]])
        team_rows = team_lookup.reindex(team_keys)

        share_train = leaders[leaders["season"].lt(season)]
        common_share_model = foundation.model("squared_error").fit(
            share_train[player_features], share_train["lead_pass_share"].to_numpy(float),
        )
        common_share = np.clip(np.asarray(common_share_model.predict(rows[player_features]), dtype=float), 0.50, 1.0)
        leader_keys_requested = pd.MultiIndex.from_frame(rows[["season", "game_id", "team", "player_id"]])
        leader_rows = leader_lookup.reindex(leader_keys_requested)
        values = {
            "commonTeamAttempts": common_team,
            "teamRecentAttempts": team_rows["team_recent_attempts"].fillna(pd.Series(common_team, index=team_rows.index)).to_numpy(float),
            "teamRecentCount": team_rows["team_recent_count"].fillna(0.0).to_numpy(float),
            "opponentRecentAllowedAttempts": team_rows["opponent_recent_allowed_attempts"].fillna(pd.Series(common_team, index=team_rows.index)).to_numpy(float),
            "opponentRecentCount": team_rows["opponent_recent_count"].fillna(0.0).to_numpy(float),
            "commonQbShare": common_share,
            "qbRecentShare": leader_rows["qb_recent_share"].fillna(pd.Series(common_share, index=leader_rows.index)).to_numpy(float),
            "qbRecentCount": leader_rows["qb_recent_count"].fillna(0.0).to_numpy(float),
        }
        if any(np.isnan(value).any() for value in values.values()):
            raise RuntimeError(f"hierarchical component missing for {season}")
        return values

    def prediction(values: dict[str, np.ndarray], team_pseudo: float, qb_pseudo: float, opponent_weight: float) -> np.ndarray:
        team_count = values["teamRecentCount"]
        offense = (
            team_pseudo * values["commonTeamAttempts"] + team_count * values["teamRecentAttempts"]
        ) / (team_pseudo + team_count)
        opponent_count = values["opponentRecentCount"]
        defense = (
            team_pseudo * values["commonTeamAttempts"] + opponent_count * values["opponentRecentAllowedAttempts"]
        ) / (team_pseudo + opponent_count)
        budget = (1.0 - opponent_weight) * offense + opponent_weight * defense
        qb_count = values["qbRecentCount"]
        share = (
            qb_pseudo * values["commonQbShare"] + qb_count * values["qbRecentShare"]
        ) / (qb_pseudo + qb_count)
        return np.clip(budget * np.clip(share, 0.50, 1.0), 0.0, None)

    grid = [
        (candidate_name(team_pseudo, qb_pseudo, opponent_weight), team_pseudo, qb_pseudo, opponent_weight)
        for team_pseudo in TEAM_PSEUDO_COUNTS
        for qb_pseudo in QB_PSEUDO_COUNTS
        for opponent_weight in OPPONENT_WEIGHTS
    ]
    projections = pd.read_parquet(decomp.FOUNDATION_PROJECTIONS)
    projections = projections[projections["market"].eq("passing_attempts")].copy()
    reports: dict[str, Any] = {}
    phase_rows: list[pd.DataFrame] = []
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        base = projections[projections["phase"].eq(phase)].copy()
        requested = frame.set_index("row_id").loc[base["row_id"]].reset_index(drop=True)
        values = components(requested, season)
        base["incumbent"] = base["candidate_projection"].to_numpy(float)
        for name, team_pseudo, qb_pseudo, opponent_weight in grid:
            base[name] = prediction(values, team_pseudo, qb_pseudo, opponent_weight)
        reports[phase] = {
            "incumbent": metrics(base["actual"].to_numpy(float), base["incumbent"].to_numpy(float)),
            "candidates": {
                name: metrics(base["actual"].to_numpy(float), base[name].to_numpy(float))
                for name, _, _, _ in grid
            },
        }
        phase_rows.append(base)

    selectable = [
        name for name, result in reports["selection"]["candidates"].items()
        if result["mae"] < reports["selection"]["incumbent"]["mae"]
        and result["rmse"] < reports["selection"]["incumbent"]["rmse"]
    ]
    selected = min(selectable, key=lambda name: (
        reports["selection"]["candidates"][name]["mae"] / reports["selection"]["incumbent"]["mae"]
        + reports["selection"]["candidates"][name]["rmse"] / reports["selection"]["incumbent"]["rmse"]
    )) if selectable else None
    confirmation_rows = phase_rows[1]
    selected_interval = cluster_interval(confirmation_rows, selected, "incumbent") if selected else None
    segments = {}
    if selected:
        confirmation_rows["delta"] = (
            np.abs(confirmation_rows[selected] - confirmation_rows["actual"])
            - np.abs(confirmation_rows["incumbent"] - confirmation_rows["actual"])
        )
        for start, end in ((1, 4), (5, 9), (10, 13), (14, 18)):
            segment = confirmation_rows[confirmation_rows["week"].between(start, end)]
            segments[f"weeks_{start}_{end}"] = {"rows": int(len(segment)), "maeDelta": float(segment["delta"].mean())}
    confirmed = bool(
        selected
        and reports["confirmation"]["candidates"][selected]["mae"] <= reports["confirmation"]["incumbent"]["mae"]
        and reports["confirmation"]["candidates"][selected]["rmse"] <= reports["confirmation"]["incumbent"]["rmse"]
        and selected_interval and selected_interval["median"] < 0
        and sum(value["maeDelta"] > 0 for value in segments.values()) <= 1
    )
    frozen = selected if confirmed else None

    current = projections[projections["phase"].eq("locked_replay")].copy()
    requested = frame.set_index("row_id").loc[current["row_id"]].reset_index(drop=True)
    values = components(requested, 2026)
    current["incumbent"] = current["component_projection"].to_numpy(float)
    for name, team_pseudo, qb_pseudo, opponent_weight in grid:
        current[name] = prediction(values, team_pseudo, qb_pseudo, opponent_weight)
    replay = pd.DataFrame(json.loads(decomp.LOCKED_REPLAY.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("passing_attempts")].copy()
    replay["normalized_player"] = replay["playerName"].map(decomp.normalize_player)
    current["normalized_player"] = current["player_name"].map(decomp.normalize_player)
    current = current.merge(
        replay[["week", "team", "normalized_player", "line"]],
        on=["week", "team", "normalized_player"], how="left", validate="one_to_one",
    )
    if current["line"].isna().any():
        raise RuntimeError("exact Passing Attempts line did not match")
    current_report = {
        "incumbent": metrics(current["actual"].to_numpy(float), current["incumbent"].to_numpy(float)),
        "candidate": metrics(current["actual"].to_numpy(float), current[frozen].to_numpy(float)) if frozen else None,
        "incumbentDirection": direction(current["actual"].to_numpy(float), current["incumbent"].to_numpy(float), current["line"].to_numpy(float)),
        "candidateDirection": direction(current["actual"].to_numpy(float), current[frozen].to_numpy(float), current["line"].to_numpy(float)) if frozen else None,
        "clusteredMaeDelta": cluster_interval(current, frozen, "incumbent") if frozen else None,
        "byWeek": {
            str(int(week)): {
                "incumbent": metrics(group["actual"].to_numpy(float), group["incumbent"].to_numpy(float)),
                "candidate": metrics(group["actual"].to_numpy(float), group[frozen].to_numpy(float)) if frozen else None,
            } for week, group in current.groupby("week", observed=True)
        },
    }
    qualifies = bool(
        frozen and current_report["candidate"]
        and current_report["candidate"]["mae"] < current_report["incumbent"]["mae"]
        and current_report["candidate"]["rmse"] < current_report["incumbent"]["rmse"]
        and current_report["candidateDirection"] >= current_report["incumbentDirection"]
    )
    current["phase"] = "locked_replay"
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    pd.concat([*phase_rows, current], ignore_index=True, sort=False).to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_passing_attempts_hierarchical_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "candidate": "partially pooled team tendency, opponent allowance, and lead-QB workload share",
        "gridSize": len(grid),
        "reports": reports,
        "selected": selected,
        "selectionEligible": selectable,
        "confirmationInterval": selected_interval,
        "confirmationSegments": segments,
        "confirmed": confirmed,
        "frozenCandidate": frozen,
        "currentSeason": current_report,
        "qualifies": qualifies,
        "injuryMetadata": injury_metadata,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
