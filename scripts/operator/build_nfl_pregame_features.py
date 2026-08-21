#!/usr/bin/env python3
"""Build leakage-safe NFL pregame features from checksum-pinned real data.

Every row is materialized before the corresponding week is applied to team and
quarterback state. Games in the same week therefore cannot train one another.
The generated parquet is local research input, never a production writer.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
SOURCE_RELEASE = "nfl_real_model_source_cache_2016_2025_2026_08_19_r1"
SCHEDULE_RELEASE = "football_nflverse_games_cache_2026_08_19_r1"

METRIC_PRIORS = {
    "epa": 0.0,
    "pass_epa": 0.0,
    "rush_epa": 0.0,
    "success": 0.43,
    "early_down_pass_epa": 0.0,
    "explosive_rate": 0.105,
    "sack_rate": 0.070,
    "turnover_rate": 0.022,
    "plays": 64.0,
    "redzone_td_rate": 0.55,
    "no_huddle_rate": 0.10,
    "pass_oe": 0.0,
    "points": 22.5,
}
FAST_ALPHA = 0.35
SLOW_ALPHA = 0.16
QB_ALPHA = 0.22
TEAM_OFFSEASON_CARRY = 0.65
QB_OFFSEASON_CARRY = 0.75

PBP_COLUMNS = [
    "game_id", "season_type", "week", "posteam", "defteam", "play_type",
    "epa", "success", "down", "yards_gained", "qb_dropback", "qb_kneel",
    "qb_spike", "rush_attempt", "sack", "interception", "fumble_lost",
    "no_huddle", "pass_oe", "yardline_100", "touchdown", "fixed_drive",
    "passer_player_id", "passer_player_name", "cpoe", "aborted_play",
]


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite(value: Any, default: float = math.nan) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def normalize_team(value: Any) -> str:
    team = str(value or "").upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def ewm(previous: float, observed: float, alpha: float) -> float:
    if not math.isfinite(observed):
        return previous
    return alpha * observed + (1.0 - alpha) * previous


@dataclass
class TeamState:
    off_fast: dict[str, float] = field(default_factory=lambda: dict(METRIC_PRIORS))
    off_slow: dict[str, float] = field(default_factory=lambda: dict(METRIC_PRIORS))
    def_fast: dict[str, float] = field(default_factory=lambda: dict(METRIC_PRIORS))
    def_slow: dict[str, float] = field(default_factory=lambda: dict(METRIC_PRIORS))
    off_adj: dict[str, float] = field(default_factory=lambda: dict(METRIC_PRIORS))
    def_adj: dict[str, float] = field(default_factory=lambda: dict(METRIC_PRIORS))
    elo: float = 1500.0
    games: int = 0
    last_qb_id: str | None = None
    last_coach: str | None = None

    def regress_offseason(self) -> None:
        for bucket in [self.off_fast, self.off_slow, self.def_fast, self.def_slow, self.off_adj, self.def_adj]:
            for metric, prior in METRIC_PRIORS.items():
                bucket[metric] = prior + TEAM_OFFSEASON_CARRY * (bucket[metric] - prior)
        self.elo = 1500.0 + TEAM_OFFSEASON_CARRY * (self.elo - 1500.0)


@dataclass
class QbState:
    epa: float = 0.0
    cpoe: float = 0.0
    sack_rate: float = METRIC_PRIORS["sack_rate"]
    turnover_rate: float = METRIC_PRIORS["turnover_rate"]
    dropbacks: float = 0.0

    def regress_offseason(self) -> None:
        self.epa *= QB_OFFSEASON_CARRY
        self.cpoe *= QB_OFFSEASON_CARRY
        self.sack_rate = METRIC_PRIORS["sack_rate"] + QB_OFFSEASON_CARRY * (
            self.sack_rate - METRIC_PRIORS["sack_rate"]
        )
        self.turnover_rate = METRIC_PRIORS["turnover_rate"] + QB_OFFSEASON_CARRY * (
            self.turnover_rate - METRIC_PRIORS["turnover_rate"]
        )
        self.dropbacks *= QB_OFFSEASON_CARRY


def load_verified_manifest(root: pathlib.Path) -> tuple[dict[str, Any], dict[tuple[str, int], pathlib.Path]]:
    manifest_path = root / "football-research/cache/nflverse/real-model-r1/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("cacheRelease") != SOURCE_RELEASE or manifest.get("failures"):
        raise RuntimeError("NFL source manifest release/failures do not match the feature contract")
    paths: dict[tuple[str, int], pathlib.Path] = {}
    for item in manifest["files"]:
        path = pathlib.Path(item["filename"])
        if not path.is_absolute():
            path = root / path
        if not path.exists() or sha256_file(path) != item["sha256"]:
            raise RuntimeError(f"source checksum mismatch: {path}")
        paths[(item["dataset"], int(item["season"]))] = path
    return manifest, paths


def aggregate_pbp(paths: dict[tuple[str, int], pathlib.Path]) -> pd.DataFrame:
    seasons: list[pd.DataFrame] = []
    for season in range(2016, 2026):
        raw = pq.read_table(paths[("pbp", season)], columns=PBP_COLUMNS).to_pandas()
        raw = raw[(raw["season_type"] == "REG") & raw["posteam"].notna() & raw["defteam"].notna()].copy()
        raw["posteam"] = raw["posteam"].map(normalize_team)
        raw["defteam"] = raw["defteam"].map(normalize_team)
        dropback = raw["qb_dropback"].fillna(0).eq(1)
        rush = raw["rush_attempt"].fillna(0).eq(1) & ~raw["qb_kneel"].fillna(0).eq(1)
        valid = (
            (dropback | rush)
            & ~raw["qb_spike"].fillna(0).eq(1)
            & ~raw["aborted_play"].fillna(0).eq(1)
            & raw["epa"].notna()
        )
        plays = raw[valid].copy()
        plays["is_dropback"] = dropback[valid]
        plays["is_rush"] = rush[valid]
        plays["pass_epa_value"] = plays["epa"].where(plays["is_dropback"])
        plays["rush_epa_value"] = plays["epa"].where(plays["is_rush"])
        plays["early_down_pass_epa_value"] = plays["epa"].where(
            plays["is_dropback"] & plays["down"].isin([1.0, 2.0])
        )
        plays["explosive"] = np.where(
            plays["is_dropback"], plays["yards_gained"].fillna(0).ge(20), plays["yards_gained"].fillna(0).ge(10)
        ).astype(float)
        plays["turnover"] = (
            plays["interception"].fillna(0).eq(1) | plays["fumble_lost"].fillna(0).eq(1)
        ).astype(float)
        plays["sack_value"] = plays["sack"].fillna(0).where(plays["is_dropback"])
        plays["no_huddle_value"] = plays["no_huddle"].fillna(0).astype(float)
        plays["pass_oe_value"] = plays["pass_oe"]

        group_cols = ["game_id", "posteam", "defteam"]
        grouped = plays.groupby(group_cols, observed=True)
        aggregate = grouped.agg(
            epa=("epa", "mean"),
            pass_epa=("pass_epa_value", "mean"),
            rush_epa=("rush_epa_value", "mean"),
            success=("success", "mean"),
            early_down_pass_epa=("early_down_pass_epa_value", "mean"),
            explosive_rate=("explosive", "mean"),
            sack_rate=("sack_value", "mean"),
            turnover_rate=("turnover", "mean"),
            plays=("epa", "size"),
            no_huddle_rate=("no_huddle_value", "mean"),
            pass_oe=("pass_oe_value", "mean"),
        ).reset_index()

        redzone = plays[(plays["yardline_100"].le(20)) & plays["fixed_drive"].notna()].copy()
        if not redzone.empty:
            rz_drives = redzone.groupby(group_cols + ["fixed_drive"], observed=True).agg(
                td=("touchdown", "max")
            ).reset_index()
            rz_rate = rz_drives.groupby(group_cols, observed=True)["td"].mean().rename("redzone_td_rate").reset_index()
            aggregate = aggregate.merge(rz_rate, on=group_cols, how="left")
        else:
            aggregate["redzone_td_rate"] = math.nan

        qb_plays = plays[plays["is_dropback"] & plays["passer_player_id"].notna()].copy()
        qb_plays["qb_turnover"] = (
            qb_plays["interception"].fillna(0).eq(1) | qb_plays["fumble_lost"].fillna(0).eq(1)
        ).astype(float)
        if not qb_plays.empty:
            qbs = qb_plays.groupby(["game_id", "posteam", "passer_player_id", "passer_player_name"], observed=True).agg(
                qb_dropbacks=("epa", "size"),
                qb_epa=("epa", "mean"),
                qb_cpoe=("cpoe", "mean"),
                qb_sack_rate=("sack", "mean"),
                qb_turnover_rate=("qb_turnover", "mean"),
            ).reset_index()
            qbs = qbs.sort_values(["game_id", "posteam", "qb_dropbacks"], ascending=[True, True, False])
            primary = qbs.drop_duplicates(["game_id", "posteam"]).rename(columns={
                "passer_player_id": "primary_qb_id", "passer_player_name": "primary_qb_name"
            })
            aggregate = aggregate.merge(primary, on=["game_id", "posteam"], how="left")
        aggregate["season"] = season
        seasons.append(aggregate)
        print(f"aggregated PBP {season}: {len(aggregate)} team-games")
    return pd.concat(seasons, ignore_index=True)


def injury_features(paths: dict[tuple[str, int], pathlib.Path]) -> dict[tuple[int, int, str], dict[str, float]]:
    result: dict[tuple[int, int, str], dict[str, float]] = {}
    position_weight = defaultdict(lambda: 1.0, {
        "QB": 2.5, "T": 1.2, "OT": 1.2, "G": 1.2, "OG": 1.2, "C": 1.2,
        "WR": 1.05, "TE": 1.05, "RB": 0.9, "CB": 1.0, "S": 1.0,
        "DE": 1.0, "DT": 1.0, "LB": 1.0,
    })
    status_weight = {"out": 1.0, "doubtful": 0.75, "questionable": 0.35}
    for season in range(2016, 2026):
        frame = pq.read_table(paths[("injuries", season)]).to_pandas()
        season_type = frame["season_type"].eq("REG") if "season_type" in frame.columns else pd.Series(False, index=frame.index)
        game_type = frame["game_type"].eq("REG") if "game_type" in frame.columns else pd.Series(True, index=frame.index)
        frame = frame[season_type | game_type].copy()
        frame["team"] = frame["team"].map(normalize_team)
        frame["status_norm"] = frame["report_status"].fillna("").astype(str).str.lower().str.strip()
        frame["status_weight"] = frame["status_norm"].map(status_weight).fillna(0.0)
        frame["position_weight"] = frame["position"].fillna("").astype(str).str.upper().map(position_weight)
        frame["weighted"] = frame["status_weight"] * frame["position_weight"]
        frame["qb_weighted"] = frame["weighted"].where(frame["position"].fillna("").astype(str).str.upper().eq("QB"), 0.0)
        frame["out_count"] = frame["status_norm"].eq("out").astype(float)
        for (week, team), group in frame.groupby(["week", "team"], observed=True):
            result[(season, int(week), str(team))] = {
                "injury_weight": float(group["weighted"].sum()),
                "qb_injury_weight": float(group["qb_weighted"].sum()),
                "out_count": float(group["out_count"].sum()),
                "injury_reported_count": float(group["status_weight"].gt(0).sum()),
            }
    return result


def roster_continuity(paths: dict[tuple[str, int], pathlib.Path]) -> dict[tuple[int, int, str], float]:
    records: list[tuple[int, int, str, set[str]]] = []
    for season in range(2016, 2026):
        frame = pq.read_table(paths[("weekly_rosters", season)], columns=["season", "week", "team", "gsis_id"]).to_pandas()
        frame["team"] = frame["team"].map(normalize_team)
        frame = frame[frame["gsis_id"].notna()]
        for (week, team), group in frame.groupby(["week", "team"], observed=True):
            records.append((season, int(week), str(team), set(group["gsis_id"].astype(str))))
    previous: dict[str, set[str]] = {}
    result: dict[tuple[int, int, str], float] = {}
    for season, week, team, roster in sorted(records):
        prior = previous.get(team)
        result[(season, week, team)] = math.nan if not prior else len(roster & prior) / max(1, len(roster | prior))
        previous[team] = roster
    return result


def load_schedule(root: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any], str]:
    manifest_path = root / "football-research/cache/nflverse/games.latest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("cacheRelease") != SCHEDULE_RELEASE:
        raise RuntimeError("schedule manifest release mismatch")
    path = manifest_path.parent / manifest["filename"]
    checksum = sha256_file(path)
    if checksum != manifest["sha256"]:
        raise RuntimeError("schedule checksum mismatch")
    games = pd.read_csv(path, low_memory=False)
    games = games[
        (games["season"].between(2016, 2025))
        & (games["game_type"] == "REG")
        & games["home_score"].notna()
        & games["away_score"].notna()
    ].copy()
    games["home_team"] = games["home_team"].map(normalize_team)
    games["away_team"] = games["away_team"].map(normalize_team)
    games["gameday"] = pd.to_datetime(games["gameday"], errors="raise")
    return games.sort_values(["season", "week", "gameday", "game_id"]), manifest, checksum


def state_features(prefix: str, state: TeamState, row: dict[str, float]) -> None:
    row[f"{prefix}_elo"] = state.elo
    row[f"{prefix}_games_state"] = float(state.games)
    for metric in METRIC_PRIORS:
        row[f"{prefix}_off_fast_{metric}"] = state.off_fast[metric]
        row[f"{prefix}_off_slow_{metric}"] = state.off_slow[metric]
        row[f"{prefix}_def_fast_{metric}"] = state.def_fast[metric]
        row[f"{prefix}_def_slow_{metric}"] = state.def_slow[metric]
        row[f"{prefix}_off_adj_{metric}"] = state.off_adj[metric]
        row[f"{prefix}_def_adj_{metric}"] = state.def_adj[metric]


def build_features(
    schedule: pd.DataFrame,
    game_metrics: pd.DataFrame,
    injuries: dict[tuple[int, int, str], dict[str, float]],
    continuity: dict[tuple[int, int, str], float],
) -> tuple[pd.DataFrame, dict[str, Any]]:
    metrics_by_key = {
        (str(row.game_id), str(row.posteam)): row._asdict()
        for row in game_metrics.itertuples(index=False)
    }
    teams: defaultdict[str, TeamState] = defaultdict(TeamState)
    qbs: defaultdict[str, QbState] = defaultdict(QbState)
    rows: list[dict[str, Any]] = []
    current_season: int | None = None

    for (season_value, week_value), week_games in schedule.groupby(["season", "week"], sort=True, observed=True):
        season = int(season_value)
        week = int(week_value)
        if current_season != season:
            if current_season is not None:
                for state in teams.values():
                    state.regress_offseason()
                for state in qbs.values():
                    state.regress_offseason()
            current_season = season

        pre_team = {team: TeamState(
            off_fast=dict(state.off_fast), off_slow=dict(state.off_slow),
            def_fast=dict(state.def_fast), def_slow=dict(state.def_slow),
            off_adj=dict(state.off_adj), def_adj=dict(state.def_adj), elo=state.elo,
            games=state.games, last_qb_id=state.last_qb_id, last_coach=state.last_coach,
        ) for team, state in teams.items()}

        def snapshot(team: str) -> TeamState:
            return pre_team.get(team, TeamState())

        for game in week_games.itertuples(index=False):
            game_id = str(game.game_id)
            home = str(game.home_team)
            away = str(game.away_team)
            home_metric = metrics_by_key.get((game_id, home))
            away_metric = metrics_by_key.get((game_id, away))
            if home_metric is None or away_metric is None:
                continue
            home_state = snapshot(home)
            away_state = snapshot(away)
            row: dict[str, Any] = {
                "feature_release": FEATURE_RELEASE,
                "game_id": game_id,
                "season": season,
                "week": week,
                "gameday": pd.Timestamp(game.gameday).date().isoformat(),
                "home_team": home,
                "away_team": away,
                "neutral_site": float(str(game.location) == "Neutral"),
                "division_game": finite(game.div_game, 0.0),
                "home_rest": finite(game.home_rest, 7.0),
                "away_rest": finite(game.away_rest, 7.0),
                "rest_diff": finite(game.home_rest, 7.0) - finite(game.away_rest, 7.0),
                "temperature": finite(game.temp),
                "wind": finite(game.wind),
                "roof_indoor": float(str(game.roof).lower() in {"closed", "dome"}),
                "surface_grass": float("grass" in str(game.surface).lower()),
                "home_score": finite(game.home_score),
                "away_score": finite(game.away_score),
                "actual_margin": finite(game.home_score) - finite(game.away_score),
                "actual_total": finite(game.home_score) + finite(game.away_score),
                "market_home_margin": finite(game.spread_line),
                "market_total": finite(game.total_line),
                "home_moneyline": finite(game.home_moneyline),
                "away_moneyline": finite(game.away_moneyline),
                "home_spread_odds": finite(game.home_spread_odds),
                "away_spread_odds": finite(game.away_spread_odds),
                "over_odds": finite(game.over_odds),
                "under_odds": finite(game.under_odds),
            }
            state_features("home", home_state, row)
            state_features("away", away_state, row)
            row["elo_diff"] = home_state.elo - away_state.elo
            for metric, prior in METRIC_PRIORS.items():
                row[f"home_matchup_fast_{metric}"] = home_state.off_fast[metric] - (away_state.def_fast[metric] - prior)
                row[f"away_matchup_fast_{metric}"] = away_state.off_fast[metric] - (home_state.def_fast[metric] - prior)
                row[f"home_matchup_slow_{metric}"] = home_state.off_slow[metric] - (away_state.def_slow[metric] - prior)
                row[f"away_matchup_slow_{metric}"] = away_state.off_slow[metric] - (home_state.def_slow[metric] - prior)

            for side, team, state, metric in [
                ("home", home, home_state, home_metric), ("away", away, away_state, away_metric)
            ]:
                injury = injuries.get((season, week, team), {})
                row[f"{side}_injury_weight"] = injury.get("injury_weight", math.nan)
                row[f"{side}_qb_injury_weight"] = injury.get("qb_injury_weight", math.nan)
                row[f"{side}_out_count"] = injury.get("out_count", math.nan)
                row[f"{side}_injury_reported_count"] = injury.get("injury_reported_count", math.nan)
                row[f"{side}_roster_continuity"] = continuity.get((season, week, team), math.nan)
                qb_id_raw = getattr(game, f"{side}_qb_id")
                qb_id = None if pd.isna(qb_id_raw) else str(qb_id_raw)
                qb_state = qbs[qb_id] if qb_id else QbState()
                row[f"{side}_qb_epa"] = qb_state.epa
                row[f"{side}_qb_cpoe"] = qb_state.cpoe
                row[f"{side}_qb_sack_rate"] = qb_state.sack_rate
                row[f"{side}_qb_turnover_rate"] = qb_state.turnover_rate
                row[f"{side}_qb_log_dropbacks"] = math.log1p(qb_state.dropbacks)
                row[f"{side}_qb_same_as_last_start"] = float(qb_id is not None and state.last_qb_id == qb_id)
                coach = str(getattr(game, f"{side}_coach") or "").strip() or None
                row[f"{side}_coach_continuity"] = float(coach is not None and state.last_coach == coach)
            rows.append(row)

        # Apply all games only after the complete week's feature rows are locked.
        for game in week_games.itertuples(index=False):
            game_id = str(game.game_id)
            home = str(game.home_team)
            away = str(game.away_team)
            home_metric = metrics_by_key.get((game_id, home))
            away_metric = metrics_by_key.get((game_id, away))
            if home_metric is None or away_metric is None:
                continue
            pre_home = snapshot(home)
            pre_away = snapshot(away)
            home_state = teams[home]
            away_state = teams[away]
            score_by_team = {home: finite(game.home_score), away: finite(game.away_score)}
            for team, opponent, observed, allowed, state, pre_opponent in [
                (home, away, home_metric, away_metric, home_state, pre_away),
                (away, home, away_metric, home_metric, away_state, pre_home),
            ]:
                del opponent
                for metric, prior in METRIC_PRIORS.items():
                    obs = score_by_team[team] if metric == "points" else finite(observed.get(metric))
                    opp_obs = score_by_team[away if team == home else home] if metric == "points" else finite(allowed.get(metric))
                    opponent_def = pre_opponent.def_slow[metric]
                    opponent_off = pre_opponent.off_slow[metric]
                    state.off_fast[metric] = ewm(state.off_fast[metric], obs, FAST_ALPHA)
                    state.off_slow[metric] = ewm(state.off_slow[metric], obs, SLOW_ALPHA)
                    state.def_fast[metric] = ewm(state.def_fast[metric], opp_obs, FAST_ALPHA)
                    state.def_slow[metric] = ewm(state.def_slow[metric], opp_obs, SLOW_ALPHA)
                    state.off_adj[metric] = ewm(state.off_adj[metric], obs - (opponent_def - prior), SLOW_ALPHA)
                    state.def_adj[metric] = ewm(state.def_adj[metric], opp_obs - (opponent_off - prior), SLOW_ALPHA)
                qb_id = observed.get("primary_qb_id")
                if qb_id is not None and not pd.isna(qb_id):
                    qb_key = str(qb_id)
                    qb = qbs[qb_key]
                    dropbacks = finite(observed.get("qb_dropbacks"), 0.0)
                    weight = 1.0 - math.pow(1.0 - QB_ALPHA, max(1.0, dropbacks / 30.0))
                    qb.epa = ewm(qb.epa, finite(observed.get("qb_epa")), weight)
                    qb.cpoe = ewm(qb.cpoe, finite(observed.get("qb_cpoe")), weight)
                    qb.sack_rate = ewm(qb.sack_rate, finite(observed.get("qb_sack_rate")), weight)
                    qb.turnover_rate = ewm(qb.turnover_rate, finite(observed.get("qb_turnover_rate")), weight)
                    qb.dropbacks += dropbacks
                    state.last_qb_id = qb_key
                coach = str(getattr(game, "home_coach" if team == home else "away_coach") or "").strip()
                if coach:
                    state.last_coach = coach
                state.games += 1

            expected_home = 1.0 / (1.0 + math.pow(10.0, -(pre_home.elo - pre_away.elo + 45.0) / 400.0))
            margin = finite(game.home_score) - finite(game.away_score)
            outcome = 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5
            multiplier = math.log1p(abs(margin)) * (2.2 / ((abs(pre_home.elo - pre_away.elo) * 0.001) + 2.2))
            change = 20.0 * multiplier * (outcome - expected_home)
            home_state.elo += change
            away_state.elo -= change

    features = pd.DataFrame(rows).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    state_artifact = {
        "featureRelease": FEATURE_RELEASE,
        "trainedThrough": "2025-12-31",
        "teamStates": {
            team: {
                "offFast": state.off_fast, "offSlow": state.off_slow,
                "defFast": state.def_fast, "defSlow": state.def_slow,
                "offAdjusted": state.off_adj, "defAdjusted": state.def_adj,
                "elo": state.elo, "games": state.games, "lastQbId": state.last_qb_id,
                "lastCoach": state.last_coach,
            }
            for team, state in sorted(teams.items())
        },
        "quarterbackStates": {
            qb_id: {
                "epa": state.epa, "cpoe": state.cpoe, "sackRate": state.sack_rate,
                "turnoverRate": state.turnover_rate, "dropbacks": state.dropbacks,
            }
            for qb_id, state in sorted(qbs.items())
        },
    }
    return features, state_artifact


def main() -> None:
    root = pathlib.Path.cwd()
    source_manifest, paths = load_verified_manifest(root)
    schedule, schedule_manifest, schedule_checksum = load_schedule(root)
    aggregates = aggregate_pbp(paths)
    injuries = injury_features(paths)
    continuity = roster_continuity(paths)
    features, states = build_features(schedule, aggregates, injuries, continuity)
    if len(features) < 2_500 or features["game_id"].nunique() != len(features):
        raise RuntimeError(f"unexpected NFL feature row count/identity: {len(features)}")

    output_root = root / "football-research/cache/nfl-model"
    output_root.mkdir(parents=True, exist_ok=True)
    feature_path = output_root / "nfl_pregame_features_2016_2025_r1.parquet"
    state_path = output_root / "nfl_state_after_2025_r1.json"
    features.to_parquet(feature_path, index=False)
    state_path.write_text(json.dumps(states, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    manifest = {
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceCacheRelease": source_manifest["cacheRelease"],
        "sourceManifestSha256": sha256_file(root / "football-research/cache/nflverse/real-model-r1/manifest.json"),
        "scheduleCacheRelease": schedule_manifest["cacheRelease"],
        "scheduleSha256": schedule_checksum,
        "featureFile": str(feature_path),
        "featureFileSha256": sha256_file(feature_path),
        "stateFile": str(state_path),
        "stateFileSha256": sha256_file(state_path),
        "rows": len(features),
        "seasons": sorted(int(value) for value in features["season"].unique()),
        "columns": list(features.columns),
        "asOfPolicy": "features_locked_before_complete_week_update",
        "preseasonIncluded": False,
    }
    manifest_path = output_root / "nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "featureRelease": FEATURE_RELEASE,
        "rows": len(features),
        "columns": len(features.columns),
        "seasonCounts": features.groupby("season")["game_id"].count().to_dict(),
        "featureFile": str(feature_path),
        "featureSha256": manifest["featureFileSha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
