#!/usr/bin/env python3
"""Build the local, checksum-pinned NFL player-week props substrate.

Every model feature is shifted by at least one completed game. Current-week
outcomes and snaps are labels. Weekly roster/injury values lack publication
timestamps, so they remain explicit context and are excluded from features.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import time
from typing import Any, Iterable

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


CONTRACT_PATH = pathlib.Path("lib/services/football/nflPlayerPropsHistoricalContract.json")
SOURCE_MANIFEST_PATH = pathlib.Path("football-research/cache/nflverse/real-model-r1/manifest.json")
OUTPUT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-history")
EWM_ALPHA = 0.35


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_team(value: Any) -> str:
    team = str(value or "").upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def clean_text(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def verified_source_paths(root: pathlib.Path, start: int, end: int, contract: dict[str, Any]) -> tuple[dict[tuple[str, int], pathlib.Path], str]:
    manifest_path = root / SOURCE_MANIFEST_PATH
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("cacheRelease") != contract["sourceCacheRelease"] or manifest.get("failures"):
        raise RuntimeError("NFL props source cache release/failures mismatch")
    paths: dict[tuple[str, int], pathlib.Path] = {}
    required = {"pbp", "weekly_rosters", "snap_counts", "injuries"}
    for item in manifest.get("files", []):
        dataset = str(item.get("dataset"))
        season = int(item.get("season", 0))
        if dataset not in required or not start <= season <= end:
            continue
        path = pathlib.Path(str(item["filename"]))
        if not path.exists() or sha256_file(path) != item.get("sha256"):
            raise RuntimeError(f"NFL props source checksum mismatch: {path}")
        paths[(dataset, season)] = path
    expected = {(dataset, season) for dataset in required for season in range(start, end + 1)}
    if set(paths) != expected:
        raise RuntimeError("NFL props source cache is incomplete for the requested seasons")
    return paths, sha256_file(manifest_path)


def read_columns(path: pathlib.Path, columns: Iterable[str]) -> pd.DataFrame:
    available = set(pq.read_schema(path).names)
    selected = [column for column in columns if column in available]
    result = pq.read_table(path, columns=selected).to_pandas()
    for column in columns:
        if column not in result:
            result[column] = pd.NA
    return result


def load_inputs(paths: dict[tuple[str, int], pathlib.Path], start: int, end: int) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    pbp_frames: list[pd.DataFrame] = []
    roster_frames: list[pd.DataFrame] = []
    snap_frames: list[pd.DataFrame] = []
    injury_frames: list[pd.DataFrame] = []
    for season in range(start, end + 1):
        pbp_frames.append(read_columns(paths[("pbp", season)], [
            "season", "season_type", "week", "game_id", "game_date", "home_team", "away_team",
            "posteam", "defteam", "pass_attempt", "complete_pass", "passing_yards", "rush_attempt",
            "rushing_yards", "passer_player_id", "passer_player_name", "receiver_player_id",
            "receiver_player_name", "rusher_player_id", "rusher_player_name",
        ]))
        roster_frames.append(read_columns(paths[("weekly_rosters", season)], [
            "season", "week", "game_type", "team", "position", "full_name", "gsis_id", "pfr_id",
            "status", "status_description_abbr",
        ]))
        snap_frames.append(read_columns(paths[("snap_counts", season)], [
            "season", "week", "game_type", "game_id", "team", "pfr_player_id", "offense_snaps", "offense_pct",
        ]))
        injury_frames.append(read_columns(paths[("injuries", season)], [
            "season", "week", "season_type", "game_type", "team", "gsis_id", "report_status", "practice_status",
        ]))
    pbp = pd.concat(pbp_frames, ignore_index=True)
    rosters = pd.concat(roster_frames, ignore_index=True)
    snaps = pd.concat(snap_frames, ignore_index=True)
    injuries = pd.concat(injury_frames, ignore_index=True)
    pbp = pbp[pbp["season_type"].fillna("").eq("REG")].copy()
    rosters = rosters[rosters["game_type"].fillna("REG").eq("REG")].copy()
    snaps = snaps[snaps["game_type"].fillna("REG").eq("REG")].copy()
    injuries = injuries[injuries["season_type"].fillna("").eq("REG") | injuries["game_type"].fillna("REG").eq("REG")].copy()
    for frame in (rosters, snaps, injuries):
        frame["team"] = frame["team"].map(normalize_team)
    for column in ("posteam", "defteam", "home_team", "away_team"):
        pbp[column] = pbp[column].map(normalize_team)
    return pbp, rosters, snaps, injuries


def build_game_teams(pbp: pd.DataFrame) -> pd.DataFrame:
    games = pbp[["season", "week", "game_id", "game_date", "home_team", "away_team"]].drop_duplicates("game_id").copy()
    if games["game_id"].isna().any() or games["game_id"].duplicated().any():
        raise RuntimeError("NFL props game identity is incomplete or duplicated")
    home = games.rename(columns={"home_team": "team", "away_team": "opponent"}).assign(is_home=1)
    away = games.rename(columns={"away_team": "team", "home_team": "opponent"}).assign(is_home=0)
    columns = ["season", "week", "game_id", "game_date", "team", "opponent", "is_home"]
    result = pd.concat([home[columns], away[columns]], ignore_index=True)
    if result.duplicated(["season", "week", "team"]).any():
        raise RuntimeError("NFL props team appears in multiple regular-season games in one week")
    return result


def numeric_sum(frame: pd.DataFrame, column: str) -> pd.Series:
    return pd.to_numeric(frame[column], errors="coerce").fillna(0.0)


def player_outcomes(pbp: pd.DataFrame) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "posteam"]
    passes = pbp[pbp["passer_player_id"].notna()].copy()
    passes["passing_attempts"] = numeric_sum(passes, "pass_attempt")
    passes["passing_completions"] = numeric_sum(passes, "complete_pass")
    passes["passing_yards"] = numeric_sum(passes, "passing_yards")
    passing = passes.groupby(keys + ["passer_player_id"], observed=True, as_index=False).agg(
        player_name=("passer_player_name", "last"), passing_attempts=("passing_attempts", "sum"),
        passing_completions=("passing_completions", "sum"), passing_yards=("passing_yards", "sum"),
    ).rename(columns={"passer_player_id": "player_id"})
    rushes = pbp[pbp["rusher_player_id"].notna()].copy()
    rushes["rushing_attempts"] = numeric_sum(rushes, "rush_attempt")
    rushes["rushing_yards"] = numeric_sum(rushes, "rushing_yards")
    rushing = rushes.groupby(keys + ["rusher_player_id"], observed=True, as_index=False).agg(
        rusher_name=("rusher_player_name", "last"), rushing_attempts=("rushing_attempts", "sum"), rushing_yards=("rushing_yards", "sum"),
    ).rename(columns={"rusher_player_id": "player_id"})
    targets = pbp[pbp["receiver_player_id"].notna()].copy()
    targets["targets"] = numeric_sum(targets, "pass_attempt")
    targets["receptions"] = numeric_sum(targets, "complete_pass")
    targets["receiving_yards"] = numeric_sum(targets, "passing_yards")
    receiving = targets.groupby(keys + ["receiver_player_id"], observed=True, as_index=False).agg(
        receiver_name=("receiver_player_name", "last"), targets=("targets", "sum"), receptions=("receptions", "sum"), receiving_yards=("receiving_yards", "sum"),
    ).rename(columns={"receiver_player_id": "player_id"})
    identity = ["season", "week", "game_id", "posteam", "player_id"]
    result = passing.merge(rushing, on=identity, how="outer").merge(receiving, on=identity, how="outer")
    result["player_name"] = result["player_name"].combine_first(result["rusher_name"]).combine_first(result["receiver_name"])
    result = result.drop(columns=["rusher_name", "receiver_name"])
    labels = ["passing_attempts", "passing_completions", "passing_yards", "rushing_attempts", "rushing_yards", "targets", "receptions", "receiving_yards"]
    result[labels] = result[labels].fillna(0.0)
    return result.rename(columns={"posteam": "team"})


def team_outcomes(pbp: pd.DataFrame) -> pd.DataFrame:
    rows = pbp[pbp["posteam"].notna()].copy()
    rows["team_pass_attempts"] = numeric_sum(rows, "pass_attempt")
    rows["team_completions"] = numeric_sum(rows, "complete_pass")
    rows["team_passing_yards"] = numeric_sum(rows, "passing_yards")
    rows["team_rush_attempts"] = numeric_sum(rows, "rush_attempt")
    rows["team_rushing_yards"] = numeric_sum(rows, "rushing_yards")
    rows["team_targets"] = rows["receiver_player_id"].notna().astype(float) * rows["team_pass_attempts"]
    rows["team_offensive_plays"] = rows["team_pass_attempts"] + rows["team_rush_attempts"]
    metrics = ["team_pass_attempts", "team_completions", "team_passing_yards", "team_rush_attempts", "team_rushing_yards", "team_targets", "team_offensive_plays"]
    return rows.groupby(["season", "week", "game_id", "posteam", "defteam"], observed=True, as_index=False)[metrics].sum().rename(columns={"posteam": "team", "defteam": "opponent"})


def roster_candidates(rosters: pd.DataFrame, injuries: pd.DataFrame, games: pd.DataFrame, positions: list[str]) -> pd.DataFrame:
    rows = rosters[rosters["position"].fillna("").isin(positions)].copy()
    rows["player_id"] = rows["gsis_id"].map(clean_text)
    rows = rows[rows["player_id"].notna()].sort_values(["season", "week", "team", "player_id", "full_name"]).drop_duplicates(["season", "week", "team", "player_id"], keep="last")
    rows = rows.rename(columns={"full_name": "player_name", "status": "roster_status", "status_description_abbr": "roster_status_description"})
    rows = rows.merge(games, on=["season", "week", "team"], how="inner", validate="many_to_one")
    injury = injuries[injuries["gsis_id"].notna()].copy()
    injury["player_id"] = injury["gsis_id"].map(clean_text)
    severity = {"out": 4, "doubtful": 3, "questionable": 2, "probable": 1}
    injury["severity"] = injury["report_status"].fillna("").astype(str).str.lower().map(severity).fillna(0)
    injury = injury.sort_values(["season", "week", "team", "player_id", "severity"]).drop_duplicates(["season", "week", "team", "player_id"], keep="last")
    injury = injury.rename(columns={"report_status": "injury_report_status", "practice_status": "injury_practice_status"})
    return rows.merge(injury[["season", "week", "team", "player_id", "injury_report_status", "injury_practice_status"]], on=["season", "week", "team", "player_id"], how="left", validate="one_to_one")


def attach_snap_labels(candidates: pd.DataFrame, snaps: pd.DataFrame) -> pd.DataFrame:
    bridge = candidates[["season", "week", "team", "player_id", "pfr_id"]].dropna(subset=["pfr_id"]).drop_duplicates()
    snap = snaps.merge(bridge, left_on=["season", "week", "team", "pfr_player_id"], right_on=["season", "week", "team", "pfr_id"], how="left")
    snap = snap[snap["player_id"].notna()].copy()
    snap["offense_snap_pct"] = pd.to_numeric(snap["offense_pct"], errors="coerce").fillna(0.0)
    snap["offense_snaps"] = pd.to_numeric(snap["offense_snaps"], errors="coerce").fillna(0.0)
    snap = snap.groupby(["season", "week", "team", "player_id"], observed=True, as_index=False).agg(offense_snaps=("offense_snaps", "sum"), offense_snap_pct=("offense_snap_pct", "max"))
    return candidates.merge(snap, on=["season", "week", "team", "player_id"], how="left", validate="one_to_one")


def shifted_rolling(series: pd.Series, window: int) -> pd.Series:
    return series.shift(1).rolling(window, min_periods=1).mean()


def add_player_prior_features(rows: pd.DataFrame, metrics: list[str]) -> tuple[pd.DataFrame, list[str]]:
    result = rows.sort_values(["player_id", "season", "week", "game_id"]).copy()
    group = result.groupby("player_id", sort=False, observed=True)
    result["prior_roster_game_rows"] = group.cumcount().astype(float)
    result["prior_participations"] = group["participated"].transform(lambda values: values.shift(1).fillna(0).cumsum()).astype(float)
    result["_prior_active_count"] = result["prior_participations"].astype(int)
    result["_prior_season_active_count"] = result.groupby(["player_id", "season"], sort=False, observed=True)["participated"].transform(
        lambda values: values.shift(1).fillna(0).cumsum(),
    ).astype(int)
    active = result[result["participated"].gt(0)].copy()
    active["_active_count_after"] = active.groupby("player_id", sort=False, observed=True).cumcount() + 1
    active["_season_active_count_after"] = active.groupby(["player_id", "season"], sort=False, observed=True).cumcount() + 1
    target_overall_index = pd.MultiIndex.from_frame(result[["player_id", "_prior_active_count"]])
    target_season_index = pd.MultiIndex.from_frame(result[["player_id", "season", "_prior_season_active_count"]])
    feature_columns = ["prior_roster_game_rows", "prior_participations"]
    for metric in metrics:
        if metric == "participated":
            result[f"prior_{metric}_lag1"] = group[metric].shift(1)
            result[f"prior_{metric}_avg3"] = group[metric].transform(lambda values: shifted_rolling(values, 3))
            result[f"prior_{metric}_avg5"] = group[metric].transform(lambda values: shifted_rolling(values, 5))
            result[f"prior_{metric}_ewm"] = group[metric].transform(lambda values: values.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean())
            result[f"prior_{metric}_season_avg"] = result.groupby(["player_id", "season"], sort=False, observed=True)[metric].transform(lambda values: values.shift(1).expanding(min_periods=1).mean())
        else:
            active_group = active.groupby("player_id", sort=False, observed=True)[metric]
            active[f"_{metric}_lag1_state"] = active[metric]
            active[f"_{metric}_avg3_state"] = active_group.transform(lambda values: values.rolling(3, min_periods=1).mean())
            active[f"_{metric}_avg5_state"] = active_group.transform(lambda values: values.rolling(5, min_periods=1).mean())
            active[f"_{metric}_ewm_state"] = active_group.transform(lambda values: values.ewm(alpha=EWM_ALPHA, adjust=False).mean())
            active[f"_{metric}_season_avg_state"] = active.groupby(["player_id", "season"], sort=False, observed=True)[metric].transform(
                lambda values: values.expanding(min_periods=1).mean(),
            )
            overall_state = active.set_index(["player_id", "_active_count_after"])
            season_state = active.set_index(["player_id", "season", "_season_active_count_after"])
            for suffix in ("lag1", "avg3", "avg5", "ewm"):
                result[f"prior_{metric}_{suffix}"] = overall_state[f"_{metric}_{suffix}_state"].reindex(target_overall_index).to_numpy()
            result[f"prior_{metric}_season_avg"] = season_state[f"_{metric}_season_avg_state"].reindex(target_season_index).to_numpy()
        feature_columns.extend([f"prior_{metric}_lag1", f"prior_{metric}_avg3", f"prior_{metric}_avg5", f"prior_{metric}_ewm", f"prior_{metric}_season_avg"])
    return result.drop(columns=["_prior_active_count", "_prior_season_active_count"]), feature_columns


def add_team_prior_features(team: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    result = team.sort_values(["team", "season", "week", "game_id"]).copy()
    metrics = [column for column in result.columns if column.startswith("team_")]
    own_columns: list[str] = []
    for metric in metrics:
        group = result.groupby("team", sort=False, observed=True)[metric]
        for window in (3, 5):
            name = f"prior_{metric}_avg{window}"
            result[name] = group.transform(lambda values, size=window: shifted_rolling(values, size))
            own_columns.append(name)
        name = f"prior_{metric}_ewm"
        result[name] = group.transform(lambda values: values.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean())
        own_columns.append(name)
    own = result[["season", "week", "game_id", "team", *own_columns]]
    allowed = team.rename(columns={"team": "offense", "opponent": "team"}).sort_values(["team", "season", "week", "game_id"]).copy()
    defense_columns: list[str] = []
    for metric in metrics:
        allowed_metric = metric.replace("team_", "allowed_", 1)
        allowed[allowed_metric] = allowed[metric]
        group = allowed.groupby("team", sort=False, observed=True)[allowed_metric]
        for window in (3, 5):
            name = f"prior_opponent_{allowed_metric}_avg{window}"
            allowed[name] = group.transform(lambda values, size=window: shifted_rolling(values, size))
            defense_columns.append(name)
        name = f"prior_opponent_{allowed_metric}_ewm"
        allowed[name] = group.transform(lambda values: values.shift(1).ewm(alpha=EWM_ALPHA, adjust=False).mean())
        defense_columns.append(name)
    return own.merge(allowed[["season", "week", "game_id", "team", *defense_columns]], on=["season", "week", "game_id", "team"], validate="one_to_one"), [*own_columns, *defense_columns]


def build_dataset(pbp: pd.DataFrame, rosters: pd.DataFrame, snaps: pd.DataFrame, injuries: pd.DataFrame, contract: dict[str, Any]) -> tuple[pd.DataFrame, dict[str, Any]]:
    games = build_game_teams(pbp)
    outcomes = player_outcomes(pbp)
    team = team_outcomes(pbp)
    rows = attach_snap_labels(roster_candidates(rosters, injuries, games, list(contract["positions"])), snaps)
    identity = ["season", "week", "game_id", "team", "player_id"]
    rows = rows.merge(outcomes, on=identity, how="left", suffixes=("", "_pbp"), validate="one_to_one")
    rows["player_name"] = rows["player_name"].combine_first(rows["player_name_pbp"])
    rows = rows.drop(columns=["player_name_pbp"])
    phase_labels = list(contract["phaseOneLabels"])
    statistical_labels = [*phase_labels[:5], "targets", *phase_labels[5:]]
    for column in statistical_labels + ["offense_snaps", "offense_snap_pct"]:
        rows[column] = pd.to_numeric(rows[column], errors="coerce").fillna(0.0)
    rows["participated"] = ((rows[statistical_labels].abs().sum(axis=1) > 0) | (rows["offense_snaps"] > 0)).astype(float)
    team_for_shares = team[["season", "week", "game_id", "team", "team_pass_attempts", "team_rush_attempts", "team_targets"]]
    rows = rows.merge(team_for_shares, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    rows["pass_attempt_share"] = np.where(rows["team_pass_attempts"] > 0, rows["passing_attempts"] / rows["team_pass_attempts"], 0.0)
    rows["rush_attempt_share"] = np.where(rows["team_rush_attempts"] > 0, rows["rushing_attempts"] / rows["team_rush_attempts"], 0.0)
    rows["target_share"] = np.where(rows["team_targets"] > 0, rows["targets"] / rows["team_targets"], 0.0)
    rows = rows.drop(columns=["team_pass_attempts", "team_rush_attempts", "team_targets"])
    player_metrics = [*statistical_labels, "offense_snap_pct", "participated", "pass_attempt_share", "rush_attempt_share", "target_share"]
    rows, player_features = add_player_prior_features(rows, player_metrics)
    team_features, team_feature_columns = add_team_prior_features(team)
    rows = rows.merge(team_features, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    rows["schema_release"] = contract["schemaRelease"]
    rows["dataset_release"] = contract["datasetRelease"]
    rows["row_id"] = rows["game_id"].astype(str) + ":" + rows["team"].astype(str) + ":" + rows["player_id"].astype(str)
    if rows["row_id"].duplicated().any():
        raise RuntimeError("NFL props historical row identity is duplicated")
    model_features = [*player_features, *team_feature_columns]
    if any(column in model_features for column in phase_labels):
        raise RuntimeError("NFL props outcome leaked into model feature list")
    outcome_only = [*statistical_labels, "offense_snaps", "offense_snap_pct", "participated", "pass_attempt_share", "rush_attempt_share", "target_share"]
    outcome_players = outcomes[identity].drop_duplicates()
    matched = outcome_players.merge(rows[identity], on=identity, how="left", indicator=True)
    identity_coverage = float(matched["_merge"].eq("both").mean()) if len(matched) else 0.0
    coverage: dict[str, Any] = {}
    for season, season_rows in rows.groupby("season", observed=True):
        coverage[str(int(season))] = {
            "rows": int(len(season_rows)), "games": int(season_rows["game_id"].nunique()),
            "players": int(season_rows["player_id"].nunique()), "participants": int(season_rows["participated"].sum()),
            "participationRate": float(season_rows["participated"].mean()),
            "rosterStatusCoverage": float(season_rows["roster_status"].notna().mean()),
            "injuryReportCoverage": float(season_rows["injury_report_status"].notna().mean()),
            "priorHistoryCoverage": float(season_rows["prior_participations"].gt(0).mean()),
        }
    diagnostics = {
        "games": int(rows["game_id"].nunique()), "players": int(rows["player_id"].nunique()),
        "labelColumns": phase_labels, "modelFeatureColumns": model_features,
        "outcomeOnlyColumns": outcome_only, "unstampedContextColumns": list(contract["unstampedContextColumns"]),
        "outcomePlayerRosterIdentityCoverage": identity_coverage, "coverageBySeason": coverage,
    }
    return rows.sort_values(["season", "week", "game_id", "team", "position", "player_name"]), diagnostics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int)
    parser.add_argument("--end", type=int)
    args = parser.parse_args()
    root = pathlib.Path.cwd()
    contract = json.loads((root / CONTRACT_PATH).read_text(encoding="utf-8"))
    start = args.start or int(contract["minimumSeason"])
    end = args.end or int(contract["maximumSeason"])
    if start < int(contract["minimumSeason"]) or end > int(contract["maximumSeason"]) or start > end:
        raise SystemExit("season range exceeds the completed-season historical contract")
    paths, source_manifest_sha = verified_source_paths(root, start, end, contract)
    dataset, diagnostics = build_dataset(*load_inputs(paths, start, end), contract)
    if not len(dataset) or not diagnostics["games"]:
        raise RuntimeError("NFL props historical builder produced an empty dataset")
    if diagnostics["outcomePlayerRosterIdentityCoverage"] < 0.97:
        raise RuntimeError(f"NFL props outcome/roster identity coverage is too low: {diagnostics['outcomePlayerRosterIdentityCoverage']:.4f}")
    output_root = root / OUTPUT_ROOT
    output_root.mkdir(parents=True, exist_ok=True)
    stem = f"nfl_player_props_{start}_{end}_r1"
    feature_path = output_root / f"{stem}.parquet"
    manifest_path = output_root / f"{stem}.manifest.json"
    dataset.to_parquet(feature_path, index=False)
    health = ["CURRENT_WEEK_ROSTER_AND_INJURY_CONTEXT_LACKS_SOURCE_TIMESTAMPS"]
    manifest = {
        "schemaRelease": contract["schemaRelease"], "datasetRelease": contract["datasetRelease"],
        "sourceCacheRelease": contract["sourceCacheRelease"], "sourceManifestSha256": source_manifest_sha,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "localOnly": True,
        "modelingReady": False, "seasonRange": [start, end], "phase": contract["phase"], "rows": int(len(dataset)),
        "featureFile": str(feature_path), "featureFileSha256": sha256_file(feature_path), "ewmAlpha": EWM_ALPHA,
        "leakagePolicy": {
            "playerFeatures": "shifted by one completed player/team game row before every lag, rolling mean, EWM, and season average",
            "teamFeatures": "shifted by one completed team game before every rolling mean and EWM",
            "opponentFeatures": "opponent allowed history is shifted by one completed defensive team game",
            "sameWeekFreeze": "no current-week outcome, share, or snap column is included in modelFeatureColumns",
            "currentWeekContext": "weekly roster and injury values are retained only as unstamped context and excluded from modelFeatureColumns",
            "market": "no historical prop line or price is present; market calibration and value testing remain blocked",
        },
        "healthFindings": health, **diagnostics,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "datasetRelease": manifest["datasetRelease"], "rows": manifest["rows"], "games": manifest["games"],
        "players": manifest["players"], "modelFeatures": len(manifest["modelFeatureColumns"]),
        "outcomePlayerRosterIdentityCoverage": manifest["outcomePlayerRosterIdentityCoverage"],
        "healthFindings": health, "featureSha256": manifest["featureFileSha256"], "manifest": str(manifest_path),
    }, indent=2))


if __name__ == "__main__":
    main()
