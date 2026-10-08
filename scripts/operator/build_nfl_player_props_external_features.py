#!/usr/bin/env python3
"""Build a leakage-safe 2016-2026 NFL props external-feature matrix.

All postgame features are attached strictly as-of a player's/team's prior
completed regular-season game. The output is shadow research only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys
import time
from typing import Any, Iterable

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_BASE_MANIFEST = ROOT / "football-research/cache/nflverse/real-model-r1/manifest.json"
DEFAULT_EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/manifest.json"
DEFAULT_OUTPUT_ROOT = ROOT / "football-research/cache/nfl-player-props-external/features"
RELEASE = "nfl_player_props_external_features_2016_2026_2026_10_08_r3_depth_role"
EWM_ALPHA = 0.35

NGS_METRICS = {
    "ngs_passing": (
        "avg_time_to_throw", "avg_completed_air_yards", "avg_intended_air_yards",
        "aggressiveness", "avg_air_yards_to_sticks", "expected_completion_percentage",
        "completion_percentage_above_expectation",
    ),
    "ngs_receiving": (
        "avg_cushion", "avg_separation", "avg_intended_air_yards",
        "percent_share_of_intended_air_yards", "catch_percentage", "avg_yac",
        "avg_expected_yac", "avg_yac_above_expectation",
    ),
    "ngs_rushing": (
        "efficiency", "percent_attempts_gte_eight_defenders", "avg_time_to_los",
        "expected_rush_yards_per_att", "rush_yards_over_expected_per_att",
        "rush_pct_over_expected",
    ),
}

PFR_METRICS = {
    "pfr_pass": (
        "passing_drop_pct", "passing_bad_throw_pct", "times_blitzed",
        "times_hurried", "times_hit", "times_pressured", "times_pressured_pct",
    ),
    "pfr_rush": (
        "rushing_yards_before_contact_avg", "rushing_yards_after_contact_avg",
        "rushing_broken_tackles", "receiving_broken_tackles",
    ),
    "pfr_rec": (
        "passing_drop_pct", "receiving_drop_pct", "receiving_broken_tackles",
        "receiving_int", "receiving_rat",
    ),
}

FTN_PLAYER_METRICS = {
    "passer_player_id": (
        "is_play_action", "is_screen_pass", "is_rpo", "is_qb_out_of_pocket",
        "is_interception_worthy", "is_throw_away", "is_catchable_ball",
        "n_blitzers", "n_pass_rushers", "is_qb_fault_sack",
    ),
    "receiver_player_id": (
        "is_screen_pass", "is_catchable_ball", "is_contested_ball",
        "is_created_reception", "is_drop", "n_pass_rushers",
    ),
    "rusher_player_id": (
        "n_defense_box", "is_motion", "is_rpo", "is_qb_sneak",
    ),
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


def verified_files(manifest_path: pathlib.Path) -> tuple[dict[tuple[str, int | None], pathlib.Path], str]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("failures"):
        raise RuntimeError(f"source manifest has failures: {manifest_path}")
    result: dict[tuple[str, int | None], pathlib.Path] = {}
    for item in manifest.get("files", []):
        path = pathlib.Path(str(item["filename"]))
        if not path.exists() or sha256_file(path) != item.get("sha256"):
            raise RuntimeError(f"source checksum mismatch: {path}")
        result[(str(item["dataset"]), item.get("season"))] = path
    return result, sha256_file(manifest_path)


def read_columns(paths: Iterable[pathlib.Path], columns: Iterable[str]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    requested = list(columns)
    for path in paths:
        available = set(pq.read_schema(path).names)
        selected = [column for column in requested if column in available]
        frame = pq.read_table(path, columns=selected).to_pandas()
        for column in requested:
            if column not in frame:
                frame[column] = pd.NA
        frames.append(frame)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=requested)


def numeric(frame: pd.DataFrame, columns: Iterable[str]) -> None:
    for column in columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")


def asof_player_features(
    spine: pd.DataFrame,
    source: pd.DataFrame,
    *,
    spine_id: str,
    source_id: str,
    metrics: Iterable[str],
    prefix: str,
) -> tuple[pd.DataFrame, list[str]]:
    result = spine[["season", "week", spine_id]].copy()
    result["_order"] = result["season"].astype(int) * 100 + result["week"].astype(int)
    values = source[source[source_id].notna()].copy()
    values[source_id] = values[source_id].astype(str)
    values["_order"] = values["season"].astype(int) * 100 + values["week"].astype(int)
    feature_names: list[str] = []
    state_columns: list[str] = []
    for metric in metrics:
        values[metric] = pd.to_numeric(values[metric], errors="coerce")
        group = values.groupby(source_id, sort=False, observed=True)[metric]
        last_name = f"{prefix}_{metric}_lag1"
        ewm_name = f"{prefix}_{metric}_ewm"
        values[last_name] = values[metric]
        values[ewm_name] = group.transform(lambda item: item.ewm(alpha=EWM_ALPHA, adjust=False).mean())
        state_columns.extend([last_name, ewm_name])
        feature_names.extend([last_name, ewm_name])
    values = values[[source_id, "_order", *state_columns]].sort_values([source_id, "_order"])
    output = pd.DataFrame(index=spine.index, columns=feature_names, dtype=float)
    for player_id, left_index in result[result[spine_id].notna()].groupby(spine_id, sort=False).groups.items():
        right = values[values[source_id].eq(str(player_id))]
        if right.empty:
            continue
        left_order = result.loc[left_index, "_order"].to_numpy(int)
        right_order = right["_order"].to_numpy(int)
        locations = np.searchsorted(right_order, left_order, side="left") - 1
        usable = locations >= 0
        if usable.any():
            output.loc[np.asarray(left_index)[usable], feature_names] = right.iloc[locations[usable]][feature_names].to_numpy(float)
    return output, feature_names


def shifted_team_features(
    games: pd.DataFrame,
    metrics: Iterable[str],
    prefix: str,
) -> tuple[pd.DataFrame, list[str]]:
    result = games.sort_values(["team", "season", "week", "game_id"]).copy()
    names: list[str] = []
    for metric in metrics:
        result[metric] = pd.to_numeric(result[metric], errors="coerce")
        group = result.groupby("team", sort=False, observed=True)[metric]
        for suffix, transform in (
            ("avg3", lambda item: item.shift(1).rolling(3, min_periods=1).mean()),
            ("ewm", lambda item: item.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean()),
        ):
            name = f"{prefix}_{metric}_{suffix}"
            result[name] = group.transform(transform)
            names.append(name)
    return result[["season", "week", "game_id", "team", *names]], names


def pbp_state_features(paths: list[pathlib.Path]) -> tuple[pd.DataFrame, list[str]]:
    columns = [
        "season", "season_type", "week", "game_id", "play_id", "drive", "posteam", "defteam",
        "qtr", "down", "ydstogo", "yardline_100", "game_seconds_remaining", "score_differential",
        "wp", "qb_dropback", "rush_attempt", "qb_kneel", "qb_spike", "qb_scramble", "pass_attempt",
        "complete_pass", "sack", "qb_hit", "shotgun", "no_huddle", "air_yards", "yards_after_catch",
        "xyac_mean_yardage", "xpass", "pass_oe",
    ]
    plays = read_columns(paths, columns)
    plays = plays[plays["season_type"].fillna("").eq("REG") & plays["posteam"].notna() & plays["defteam"].notna()].copy()
    for column in columns:
        if column not in {"season_type", "game_id", "posteam", "defteam"}:
            plays[column] = pd.to_numeric(plays[column], errors="coerce")
    play = (plays["qb_dropback"].fillna(0).eq(1) | plays["rush_attempt"].fillna(0).eq(1))
    play &= ~plays["qb_kneel"].fillna(0).eq(1) & ~plays["qb_spike"].fillna(0).eq(1)
    plays = plays[play].copy()
    plays["is_dropback"] = plays["qb_dropback"].fillna(0)
    plays["is_rush"] = plays["rush_attempt"].fillna(0)
    neutral = (
        plays["qtr"].fillna(5).le(3)
        & plays["down"].fillna(4).le(3)
        & plays["score_differential"].fillna(0).abs().le(8)
        & plays["wp"].fillna(0.5).between(0.15, 0.85)
    )
    early = plays["down"].fillna(4).le(2)
    for name, values in {
        "neutral_pass": plays["is_dropback"].where(neutral),
        "neutral_xpass": plays["xpass"].where(neutral),
        "neutral_pass_oe": plays["pass_oe"].where(neutral),
        "early_down_pass": plays["is_dropback"].where(early),
        "air_yards_attempt": plays["air_yards"].where(plays["pass_attempt"].fillna(0).eq(1)),
        "xyac_completion": plays["xyac_mean_yardage"].where(plays["complete_pass"].fillna(0).eq(1)),
    }.items():
        plays[name] = values
    plays = plays.sort_values(["game_id", "drive", "posteam", "play_id"])
    elapsed = -plays.groupby(["game_id", "drive", "posteam"], observed=True)["game_seconds_remaining"].diff()
    plays["seconds_per_play"] = elapsed.where(elapsed.between(0, 60))
    keys = ["season", "week", "game_id", "posteam", "defteam"]
    games = plays.groupby(keys, observed=True, as_index=False).agg(
        plays=("play_id", "count"),
        dropback_rate=("is_dropback", "mean"),
        rush_rate=("is_rush", "mean"),
        xpass=("xpass", "mean"),
        pass_oe=("pass_oe", "mean"),
        neutral_pass_rate=("neutral_pass", "mean"),
        neutral_xpass=("neutral_xpass", "mean"),
        neutral_pass_oe=("neutral_pass_oe", "mean"),
        early_down_pass_rate=("early_down_pass", "mean"),
        no_huddle_rate=("no_huddle", "mean"),
        shotgun_rate=("shotgun", "mean"),
        qb_hit_rate=("qb_hit", "mean"),
        sack_rate=("sack", "mean"),
        scramble_rate=("qb_scramble", "mean"),
        air_yards_per_attempt=("air_yards_attempt", "mean"),
        xyac_per_completion=("xyac_completion", "mean"),
        seconds_per_play=("seconds_per_play", "mean"),
    ).rename(columns={"posteam": "team", "defteam": "opponent"})
    metrics = [column for column in games.columns if column not in {"season", "week", "game_id", "team", "opponent"}]
    own, own_names = shifted_team_features(games, metrics, "external_state_team")
    defense = games.rename(columns={"team": "offense", "opponent": "team"})
    allowed, allowed_names = shifted_team_features(defense, metrics, "external_state_opponent_allowed")
    allowed = allowed.rename(columns={"team": "opponent"})
    current = games[["season", "week", "game_id", "team", "opponent"]]
    output = current.merge(own, on=["season", "week", "game_id", "team"], validate="one_to_one")
    output = output.merge(allowed, on=["season", "week", "game_id", "opponent"], validate="one_to_one")
    return output.drop(columns="opponent"), [*own_names, *allowed_names]


def game_environment_features(paths: list[pathlib.Path]) -> tuple[pd.DataFrame, list[str]]:
    games = read_columns(paths, ["season", "week", "season_type", "game_id", "roof", "temp", "wind"])
    games = games[games["season_type"].fillna("").eq("REG")].drop_duplicates("game_id").copy()
    games["external_environment_temperature_f"] = pd.to_numeric(games["temp"], errors="coerce")
    games["external_environment_wind_mph"] = pd.to_numeric(games["wind"], errors="coerce")
    roof = games["roof"].fillna("").astype(str).str.lower()
    games["external_environment_outdoor"] = roof.str.contains("outdoors|outdoor|open").astype(float)
    games["external_environment_fixed_roof"] = roof.str.contains("dome|closed").astype(float)
    names = [
        "external_environment_temperature_f",
        "external_environment_wind_mph",
        "external_environment_outdoor",
        "external_environment_fixed_roof",
    ]
    return games[["season", "week", "game_id", *names]], names


def timestamped_depth_features(depth: pd.DataFrame, games: pd.DataFrame) -> pd.DataFrame:
    values = depth[depth["gsis_id"].notna() & depth["dt"].notna()].copy()
    values["dt"] = pd.to_datetime(values["dt"], utc=True, errors="coerce")
    values["pos_rank"] = pd.to_numeric(values["pos_rank"], errors="coerce")
    values["pos_slot"] = pd.to_numeric(values["pos_slot"], errors="coerce")
    values = values.sort_values(["dt", "team", "pos_slot", "pos_rank", "gsis_id"])
    values["external_depth_slot_rank"] = (
        values.groupby(["dt", "team", "pos_slot"], observed=True).cumcount() + 1
    ).astype(float)
    values["external_depth_overall_rank"] = values["pos_rank"]
    values["external_depth_starter"] = values["external_depth_slot_rank"].eq(1).astype(float)
    values["_dt_ns"] = values["dt"].astype("int64")
    snapshots = np.sort(values["_dt_ns"].unique())
    selected: list[pd.DataFrame] = []
    for row in games.itertuples(index=False):
        location = np.searchsorted(snapshots, row.kickoff.value, side="right") - 1
        if location < 0:
            continue
        snapshot_ns = int(snapshots[location])
        snapshot = pd.Timestamp(snapshot_ns, tz="UTC")
        team = values[values["_dt_ns"].eq(snapshot_ns) & values["team"].eq(row.team)].copy()
        if team.empty:
            continue
        team["season"] = row.season
        team["week"] = row.week
        team["game_id"] = row.game_id
        team["external_depth_snapshot_age_hours"] = (row.kickoff - snapshot).total_seconds() / 3600.0
        selected.append(team)
    if not selected:
        return pd.DataFrame()
    output = pd.concat(selected, ignore_index=True)
    output["external_depth_listed"] = 1.0
    output = output.rename(columns={"gsis_id": "player_id"})
    columns = [
        "season", "week", "game_id", "team", "player_id", "external_depth_listed",
        "external_depth_slot_rank", "external_depth_overall_rank", "external_depth_starter",
        "external_depth_snapshot_age_hours",
    ]
    return output[columns].drop_duplicates(["season", "week", "game_id", "team", "player_id"])


def depth_features(
    frame: pd.DataFrame,
    files: dict[tuple[str, int | None], pathlib.Path],
    pbp_paths: list[pathlib.Path],
    current_season: int,
) -> tuple[pd.DataFrame, list[str]]:
    names = [
        "external_depth_listed", "external_depth_slot_rank", "external_depth_overall_rank",
        "external_depth_starter", "external_depth_snapshot_age_hours",
    ]
    historical: list[pd.DataFrame] = []
    for season in range(2016, min(current_season, 2024) + 1):
        source = read_columns(
            [files[("depth_charts", season)]],
            ["season", "week", "game_type", "club_code", "gsis_id", "formation", "depth_team"],
        )
        source = source[
            source["game_type"].fillna("REG").eq("REG")
            & source["formation"].fillna("").str.lower().eq("offense")
            & source["gsis_id"].notna()
        ].copy()
        source["team"] = source["club_code"].replace({"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"})
        source["player_id"] = source["gsis_id"].astype(str)
        source["external_depth_slot_rank"] = pd.to_numeric(source["depth_team"], errors="coerce")
        source["external_depth_overall_rank"] = source["external_depth_slot_rank"]
        source["external_depth_starter"] = source["external_depth_slot_rank"].eq(1).astype(float)
        source["external_depth_listed"] = 1.0
        source["external_depth_snapshot_age_hours"] = np.nan
        historical.append(
            source[["season", "week", "team", "player_id", *names]]
            .sort_values(["season", "week", "team", "player_id", "external_depth_slot_rank"])
            .drop_duplicates(["season", "week", "team", "player_id"])
        )

    recent_rows: list[pd.DataFrame] = []
    if current_season >= 2025:
        game_source = read_columns(
            pbp_paths,
            ["season", "week", "season_type", "game_id", "start_time", "home_team", "away_team"],
        )
        game_source = game_source[game_source["season_type"].fillna("").eq("REG")].drop_duplicates("game_id")
        start = pd.to_datetime(game_source["start_time"], errors="coerce")
        game_source["kickoff"] = start.dt.tz_localize("America/New_York", ambiguous="NaT", nonexistent="shift_forward").dt.tz_convert("UTC")
        home = game_source[["season", "week", "game_id", "kickoff", "home_team"]].rename(columns={"home_team": "team"})
        away = game_source[["season", "week", "game_id", "kickoff", "away_team"]].rename(columns={"away_team": "team"})
        games = pd.concat([home, away], ignore_index=True)
        games["team"] = games["team"].replace({"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"})
        for season in range(2025, current_season + 1):
            source = read_columns(
                [files[("depth_charts", season)]],
                ["dt", "team", "gsis_id", "pos_grp", "pos_slot", "pos_rank"],
            )
            source = source[source["pos_grp"].fillna("").eq("3WR 1TE")].copy()
            attached = timestamped_depth_features(source, games[games["season"].eq(season)])
            if not attached.empty:
                recent_rows.append(attached)

    old = pd.concat(historical, ignore_index=True)
    old_rows = frame[frame["season"].le(2024)][["season", "week", "game_id", "team", "player_id"]].merge(
        old, on=["season", "week", "team", "player_id"], how="left", validate="many_to_one",
    )
    combined = pd.concat([old_rows, *recent_rows], ignore_index=True)
    keys = ["season", "week", "game_id", "team", "player_id"]
    combined = combined.sort_values(keys).drop_duplicates(keys)
    return frame[keys].merge(combined, on=keys, how="left", validate="one_to_one")[names], names


def ngs_features(spine: pd.DataFrame, files: dict[tuple[str, int | None], pathlib.Path]) -> tuple[pd.DataFrame, list[str]]:
    output = pd.DataFrame(index=spine.index)
    names: list[str] = []
    for dataset, metrics in NGS_METRICS.items():
        source = pq.read_table(files[(dataset, None)]).to_pandas()
        source = source[source["season_type"].fillna("").eq("REG") & source["week"].fillna(0).gt(0)].copy()
        if dataset == "ngs_rushing":
            attempts = pd.to_numeric(source["rush_attempts"], errors="coerce").replace(0, np.nan)
            source["expected_rush_yards_per_att"] = pd.to_numeric(source["expected_rush_yards"], errors="coerce") / attempts
        attached, feature_names = asof_player_features(
            spine, source, spine_id="player_id", source_id="player_gsis_id",
            metrics=metrics, prefix=f"external_{dataset}",
        )
        output = output.join(attached)
        names.extend(feature_names)
    return output, names


def pfr_features(spine: pd.DataFrame, files: dict[tuple[str, int | None], pathlib.Path], current_season: int) -> tuple[pd.DataFrame, list[str]]:
    output = pd.DataFrame(index=spine.index)
    names: list[str] = []
    for dataset, metrics in PFR_METRICS.items():
        paths = [files[(dataset, season)] for season in range(2018, current_season + 1)]
        source = read_columns(paths, ["season", "week", "game_type", "pfr_player_id", *metrics])
        source = source[source["game_type"].fillna("REG").eq("REG")].copy()
        attached, feature_names = asof_player_features(
            spine, source, spine_id="pfr_id", source_id="pfr_player_id",
            metrics=metrics, prefix=f"external_{dataset}",
        )
        output = output.join(attached)
        names.extend(feature_names)
    return output, names


def ftn_player_features(
    spine: pd.DataFrame,
    files: dict[tuple[str, int | None], pathlib.Path],
    pbp_paths: list[pathlib.Path],
    current_season: int,
) -> tuple[pd.DataFrame, list[str]]:
    ftn_paths = [files[("ftn_charting", season)] for season in range(2022, current_season + 1)]
    ftn_columns = [
        "nflverse_game_id", "season", "week", "nflverse_play_id",
        *sorted({metric for metrics in FTN_PLAYER_METRICS.values() for metric in metrics}),
    ]
    ftn = read_columns(ftn_paths, ftn_columns)
    pbp = read_columns(
        pbp_paths,
        ["season", "season_type", "week", "game_id", "play_id", "passer_player_id", "receiver_player_id", "rusher_player_id"],
    )
    pbp = pbp[pbp["season_type"].fillna("").eq("REG")]
    joined = ftn.merge(
        pbp,
        left_on=["season", "week", "nflverse_game_id", "nflverse_play_id"],
        right_on=["season", "week", "game_id", "play_id"],
        how="inner",
        validate="one_to_one",
    )
    output = pd.DataFrame(index=spine.index)
    names: list[str] = []
    for identity, metrics in FTN_PLAYER_METRICS.items():
        values = joined[joined[identity].notna()].copy()
        numeric(values, metrics)
        weekly = values.groupby(["season", "week", identity], observed=True, as_index=False)[list(metrics)].mean()
        attached, feature_names = asof_player_features(
            spine, weekly, spine_id="player_id", source_id=identity,
            metrics=metrics, prefix=f"external_ftn_{identity.removesuffix('_player_id')}",
        )
        output = output.join(attached)
        names.extend(feature_names)
    return output, names


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-manifest", type=pathlib.Path, default=DEFAULT_BASE_MANIFEST)
    parser.add_argument("--external-manifest", type=pathlib.Path, default=DEFAULT_EXTERNAL_MANIFEST)
    parser.add_argument("--output-root", type=pathlib.Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--current-season", type=int, default=2026)
    args = parser.parse_args()

    history = load_module("props_external_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    position = load_module(
        "props_external_position",
        ROOT / "scripts/operator/tournament_nfl_player_props_position_matchup.py",
    )
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsHistoricalContract.json").read_text())
    base_files, base_manifest_sha = verified_files(args.base_manifest)
    external_files, external_manifest_sha = verified_files(args.external_manifest)
    paths: dict[tuple[str, int], pathlib.Path] = {}
    required = ("pbp", "weekly_rosters", "snap_counts", "injuries", "player_stats", "team_stats")
    for dataset in required:
        for season in range(2016, args.current_season):
            paths[(dataset, season)] = base_files[(dataset, season)]
        paths[(dataset, args.current_season)] = external_files[(dataset, args.current_season)]

    inputs = history.load_inputs(paths, 2016, args.current_season)
    frame, diagnostics = history.build_dataset(*inputs, contract)
    team = history.team_outcomes(inputs[-1])
    corrected_team, corrected_names = history.add_opponent_team_prior_features(team)
    opponent_names = [name for name in corrected_names if name.startswith("prior_opponent_")]
    frame = frame.drop(columns=opponent_names).merge(
        corrected_team[["season", "week", "game_id", "team", *opponent_names]],
        on=["season", "week", "game_id", "team"], how="left", validate="many_to_one", sort=False,
    )

    pbp_paths = [paths[("pbp", season)] for season in range(2016, args.current_season + 1)]
    state_rows, state_names = pbp_state_features(pbp_paths)
    frame = frame.merge(state_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one", sort=False)
    position_rows, position_names = position.position_matchup_features(frame)
    frame = position.attach_position_features(frame, position_rows)
    environment_rows, environment_names = game_environment_features(pbp_paths)
    frame = frame.merge(
        environment_rows,
        on=["season", "week", "game_id"],
        how="left",
        validate="many_to_one",
        sort=False,
    )
    ngs, ngs_names = ngs_features(frame, external_files)
    pfr, pfr_names = pfr_features(frame, external_files, args.current_season)
    ftn, ftn_names = ftn_player_features(frame, external_files, pbp_paths, args.current_season)
    depth, depth_names = depth_features(frame, external_files, pbp_paths, args.current_season)
    frame = frame.join(ngs).join(pfr).join(ftn).join(depth)
    # This shadow matrix has materially different semantics from the historical
    # base artifact. Never publish it under the prior dataset/schema identity.
    frame["schema_release"] = RELEASE
    frame["dataset_release"] = RELEASE
    feature_groups = {
        "base": list(diagnostics["modelFeatureColumns"]),
        "state": [*state_names, *position_names, *environment_names],
        "pfr": pfr_names,
        "ftn": ftn_names,
        "ngs": ngs_names,
        "depth": depth_names,
    }
    all_features = [name for group in feature_groups.values() for name in group]
    if len(all_features) != len(set(all_features)):
        raise RuntimeError("external feature names are duplicated")
    forbidden = set(diagnostics["outcomeOnlyColumns"]) | set(diagnostics["unstampedContextColumns"])
    if forbidden.intersection(all_features):
        raise RuntimeError("outcome or unstamped context entered external features")
    keys = ["season", "week", "game_id", "team", "player_id"]
    if frame.duplicated(keys).any() or frame["row_id"].duplicated().any():
        raise RuntimeError("external feature matrix changed row identity")

    args.output_root.mkdir(parents=True, exist_ok=True)
    feature_path = args.output_root / "nfl_player_props_external_features_2016_2026_r3.parquet"
    manifest_path = args.output_root / "nfl_player_props_external_features_2016_2026_r3.manifest.json"
    frame.sort_values(keys).to_parquet(feature_path, index=False)
    coverage = {
        group: {
            "features": len(names),
            "rowCoverage": float(frame[names].notna().any(axis=1).mean()) if names else 0.0,
            "currentSeasonCoverage": float(frame.loc[frame["season"].eq(args.current_season), names].notna().any(axis=1).mean()) if names else 0.0,
        }
        for group, names in feature_groups.items()
    }
    manifest = {
        "release": RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "modelingReady": False,
        "localOnly": True,
        "seasonRange": [2016, args.current_season],
        "rows": int(len(frame)),
        "games": int(frame["game_id"].nunique()),
        "featureFile": str(feature_path.resolve()),
        "featureFileSha256": sha256_file(feature_path),
        "baseSourceManifestSha256": base_manifest_sha,
        "externalSourceManifestSha256": external_manifest_sha,
        "featureGroups": feature_groups,
        "featureCoverage": coverage,
        "outcomeOnlyColumns": diagnostics["outcomeOnlyColumns"],
        "unstampedContextColumns": diagnostics["unstampedContextColumns"],
        "leakagePolicy": "every PBP, NGS, PFR, FTN, player, team, and opponent feature is shifted/as-of prior completed regular-season evidence",
        "marketFeatures": [],
        "attribution": {"ftn": "FTN Data via nflverse", "ngs": "NFL Next Gen Stats via nflverse"},
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(manifest_path), "featureFile": str(feature_path),
        "featureFileSha256": manifest["featureFileSha256"], "rows": manifest["rows"],
        "games": manifest["games"], "featureCoverage": coverage,
        "currentSeasonRows": int(frame["season"].eq(args.current_season).sum()),
        "currentSeasonWeeks": sorted(frame.loc[frame["season"].eq(args.current_season), "week"].dropna().astype(int).unique().tolist()),
    }, indent=2))


if __name__ == "__main__":
    main()
