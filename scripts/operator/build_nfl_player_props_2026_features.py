#!/usr/bin/env python3
"""Build timestamped 2026 NFL props inference rows from locked history and provider context."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import pathlib
import re
import sys
import unicodedata
from typing import Any

import numpy as np
import pandas as pd


RELEASE = "nfl_player_props_2026_inference_features_2026_08_25_r1"
PHASE_ONE = {"passing_attempts", "passing_completions", "passing_yards", "rushing_attempts", "rushing_yards", "receptions", "receiving_yards"}
TOUCHDOWN_SCRIPT = pathlib.Path("scripts/operator/tournament_nfl_player_props_touchdowns.py")
PLAYER_METRICS = [
    "passing_attempts", "passing_completions", "passing_yards", "rushing_attempts", "rushing_yards",
    "targets", "receptions", "receiving_yards", "offense_snap_pct", "participated",
    "pass_attempt_share", "rush_attempt_share", "target_share",
]
TEAM_METRICS = [
    "team_pass_attempts", "team_completions", "team_passing_yards", "team_rush_attempts",
    "team_rushing_yards", "team_targets", "team_offensive_plays",
]
EWM_ALPHA = 0.35


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", ascii_value)


def normalize_team(value: str) -> str:
    team = value.upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def ewm_last(values: pd.Series) -> float:
    clean = pd.to_numeric(values, errors="coerce").fillna(0.0)
    return float(clean.ewm(alpha=EWM_ALPHA, adjust=False).mean().iloc[-1]) if len(clean) else np.nan


def player_features(rows: pd.DataFrame) -> dict[str, float]:
    rows = rows.sort_values(["season", "week", "game_id"])
    result: dict[str, float] = {
        "prior_roster_game_rows": float(len(rows)),
        "prior_participations": float(pd.to_numeric(rows["participated"], errors="coerce").fillna(0).sum()),
    }
    for metric in PLAYER_METRICS:
        source = rows if metric == "participated" else rows[pd.to_numeric(rows["participated"], errors="coerce").fillna(0).gt(0)]
        values = pd.to_numeric(source[metric], errors="coerce").fillna(0.0)
        result[f"prior_{metric}_lag1"] = float(values.iloc[-1]) if len(values) else np.nan
        result[f"prior_{metric}_avg3"] = float(values.tail(3).mean()) if len(values) else np.nan
        result[f"prior_{metric}_avg5"] = float(values.tail(5).mean()) if len(values) else np.nan
        result[f"prior_{metric}_ewm"] = ewm_last(values)
        result[f"prior_{metric}_season_avg"] = np.nan
    return result


def touchdown_features(rows: pd.DataFrame) -> dict[str, float]:
    rows = rows.sort_values(["season", "week", "game_id"])
    result: dict[str, float] = {}
    for metric in ("anytime_td", "redzone_opportunity", "goal_line_opportunity"):
        values = pd.to_numeric(rows[metric], errors="coerce").fillna(0.0)
        result[f"prior_{metric}_avg5"] = float(values.tail(5).mean()) if len(values) else np.nan
        result[f"prior_{metric}_ewm"] = ewm_last(values)
    for feature in ("prior_team_td_avg5", "prior_opponent_td_allowed_avg5"):
        values = pd.to_numeric(rows[feature], errors="coerce").dropna()
        result[feature] = float(values.iloc[-1]) if len(values) else np.nan
    return result


def load_touchdown_history(history: pd.DataFrame) -> pd.DataFrame:
    spec = importlib.util.spec_from_file_location("nfl_props_2026_td_features", TOUCHDOWN_SCRIPT)
    if not spec or not spec.loader:
        raise RuntimeError("NFL props touchdown feature module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    enriched, _ = module.add_touchdown_features(history, module.read_pbp())
    return enriched


def team_game_outcomes(history: pd.DataFrame) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team", "opponent"]
    grouped = history.groupby(keys, observed=True, as_index=False).agg(
        team_pass_attempts=("passing_attempts", "sum"),
        team_completions=("passing_completions", "sum"),
        team_passing_yards=("passing_yards", "sum"),
        team_rush_attempts=("rushing_attempts", "sum"),
        team_rushing_yards=("rushing_yards", "sum"),
        team_targets=("targets", "sum"),
    )
    grouped["team_offensive_plays"] = grouped["team_pass_attempts"] + grouped["team_rush_attempts"]
    return grouped.sort_values(["season", "week", "game_id"])


def rolling_team_features(team_games: pd.DataFrame, team: str, opponent: str) -> dict[str, float]:
    result: dict[str, float] = {}
    own = team_games[team_games["team"].eq(team)]
    allowed = team_games[team_games["opponent"].eq(opponent)]
    for metric in TEAM_METRICS:
        own_values = pd.to_numeric(own[metric], errors="coerce").fillna(0.0)
        for window in (3, 5):
            result[f"prior_{metric}_avg{window}"] = float(own_values.tail(window).mean()) if len(own_values) else np.nan
        result[f"prior_{metric}_ewm"] = ewm_last(own_values)
        allowed_metric = metric.replace("team_", "allowed_", 1)
        allowed_values = pd.to_numeric(allowed[metric], errors="coerce").fillna(0.0)
        for window in (3, 5):
            result[f"prior_opponent_{allowed_metric}_avg{window}"] = float(allowed_values.tail(window).mean()) if len(allowed_values) else np.nan
        result[f"prior_opponent_{allowed_metric}_ewm"] = ewm_last(allowed_values)
    return result


def roster_index(context: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for game in context["games"]:
        for side in ("away", "home"):
            depth = game[f"{side}Depth"]
            for player in depth["roster"]:
                key = (game["canonicalGameId"], normalized_name(player["name"]))
                index[key] = {**player, "team": depth["team"], "capturedAt": depth["capturedAt"]}
    return index


def injury_index(context: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for game in context["games"]:
        report_time = game["injuries"].get("reportUpdatedAt")
        for team in game["injuries"]["teams"]:
            for player in team["players"]:
                index[(game["canonicalGameId"], normalized_name(player["name"]))] = {**player, "reportUpdatedAt": report_time}
    return index


def role_fingerprint(value: dict[str, Any]) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def implied_team_points(game_context: dict[str, Any], team: str) -> float | None:
    books = [book for book in game_context.get("mainMarket", {}).get("currentBooks", []) if book.get("total") and book.get("spread")]
    if not books:
        return None
    total = float(np.median([book["total"]["line"] for book in books]))
    home_spread = float(np.median([book["spread"]["homeLine"] for book in books]))
    home_points = total / 2.0 - home_spread / 2.0
    return home_points if team == normalize_team(game_context["homeTeam"]) else total - home_points


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history-manifest", type=pathlib.Path, required=True)
    parser.add_argument("--observation-snapshot", type=pathlib.Path, required=True)
    parser.add_argument("--inference-context", type=pathlib.Path, required=True)
    parser.add_argument("--output-root", type=pathlib.Path, default=pathlib.Path("football-research/cache/nfl-player-props-features"))
    args = parser.parse_args()
    history_manifest = json.loads(args.history_manifest.read_text(encoding="utf-8"))
    history_path = pathlib.Path(history_manifest["featureFile"])
    if sha256_file(history_path) != history_manifest["featureFileSha256"]:
        raise RuntimeError("NFL props history checksum mismatch")
    history = pd.read_parquet(history_path)
    history = load_touchdown_history(history)
    observation = json.loads(args.observation_snapshot.read_text(encoding="utf-8"))
    context = json.loads(args.inference_context.read_text(encoding="utf-8"))
    if context["providerSnapshotGeneratedAt"] != observation["generatedAt"] or context["season"] != observation["season"] or context["week"] != observation["week"]:
        raise RuntimeError("NFL props observation/context identity mismatch")
    captured_at = pd.Timestamp(context["capturedAt"])
    if any(captured_at >= pd.Timestamp(game["scheduledStart"]) for game in context["games"]):
        raise RuntimeError("NFL props inference context is not pregame")

    games = {game["providerGameId"]: game for game in observation["games"]}
    current = [row for row in observation["observations"] if not row["isOpening"] and row.get("playerName") and (
        (row["market"] in PHASE_ONE and row["offerType"] == "over_under")
        or (row["market"] == "anytime_td" and row["offerType"] == "milestone" and float(row["line"]) == 0.5)
    )]
    candidates: dict[tuple[str, str], dict[str, Any]] = {}
    for row in current:
        candidates[(row["canonicalGameId"], normalized_name(row["playerName"]))] = row
    rosters = roster_index(context)
    injuries = injury_index(context)
    historical_names: dict[str, pd.DataFrame] = {name: group for name, group in history.assign(_name=history["player_name"].astype(str).map(normalized_name)).groupby("_name", observed=True)}
    team_games = team_game_outcomes(history)
    feature_columns = list(history_manifest["modelFeatureColumns"])
    rows: list[dict[str, Any]] = []
    for key, offer in sorted(candidates.items()):
        game_id, name_key = key
        game = games[game_id]
        roster = rosters.get(key)
        player_history = historical_names.get(name_key)
        identity_matches = 0 if player_history is None else int(player_history["player_id"].nunique())
        team = normalize_team(str(roster["team"] if roster else offer.get("playerTeam") or ""))
        away = normalize_team(game["awayTeam"])
        home = normalize_team(game["homeTeam"])
        opponent = home if team == away else away if team == home else ""
        injury = injuries.get(key)
        context_game = next(value for value in context["games"] if value["canonicalGameId"] == game_id)
        team_points = implied_team_points(context_game, team)
        holds = [
            "roster_identity_unmatched" if roster is None else None,
            "historical_identity_unmatched" if identity_matches == 0 else None,
            "historical_identity_ambiguous" if identity_matches > 1 else None,
            "team_game_identity_unmatched" if not opponent else None,
            "injury_report_timestamp_missing" if injury and not injury.get("reportUpdatedAt") else None,
            "player_listed_out" if injury and str(injury.get("status", "")).lower() in {"out", "inactive", "injured reserve", "ir"} else None,
        ]
        holds = [value for value in holds if value]
        row: dict[str, Any] = {
            "row_id": f"{game_id}:{offer.get('providerPlayerId') or name_key}",
            "game_id": game_id,
            "player_id": None if player_history is None else str(player_history.sort_values(["season", "week"]).iloc[-1]["player_id"]),
            "provider_player_id": offer.get("providerPlayerId"),
            "player_name": offer["playerName"],
            "team": team,
            "opponent": opponent,
            "position": roster.get("position") if roster else None,
            "season": int(observation["season"]),
            "week": int(observation["week"]),
            "is_home": float(team == home),
            "feature_as_of": context["capturedAt"],
            "roster_captured_at": roster.get("capturedAt") if roster else None,
            "injury_reported_at": injury.get("reportUpdatedAt") if injury else context["capturedAt"],
            "injury_status": injury.get("status") if injury else None,
            "depth": roster.get("depth") if roster else None,
            "depth_rank": roster.get("depthRank") if roster else None,
            "role_fingerprint": role_fingerprint({"roster": roster, "injury": injury}),
            "team_implied_points": team_points,
            "team_implied_touchdowns": None if team_points is None else team_points / 7.0,
            "health_holds": holds,
            "score_eligible": not holds,
            "inference_feature_release": RELEASE,
        }
        if player_history is not None and identity_matches == 1:
            row.update(player_features(player_history))
            row.update(touchdown_features(player_history))
        row.update(rolling_team_features(team_games, team, opponent))
        for position in ("QB", "RB", "FB", "WR", "TE"):
            row[f"position_{position.lower()}"] = float(row["position"] == position)
        for column in feature_columns:
            row.setdefault(column, np.nan)
        rows.append(row)
    result = pd.DataFrame(rows)
    expected_features = [*feature_columns, "is_home", "position_qb", "position_rb", "position_fb", "position_wr", "position_te"]
    if len(result) and result[result["score_eligible"]][expected_features].replace([np.inf, -np.inf], np.nan).isna().all(axis=1).any():
        raise RuntimeError("NFL props eligible inference row has no usable model features")
    args.output_root.mkdir(parents=True, exist_ok=True)
    feature_path = args.output_root / "nfl_player_props_2026_week_1_r1.parquet"
    manifest_path = args.output_root / "nfl_player_props_2026_week_1_r1.manifest.json"
    result.to_parquet(feature_path, index=False)
    manifest = {
        "release": RELEASE,
        "season": observation["season"],
        "week": observation["week"],
        "capturedAt": context["capturedAt"],
        "observationSnapshotSha256": sha256_file(args.observation_snapshot),
        "inferenceContextSha256": sha256_file(args.inference_context),
        "historicalFeatureSha256": history_manifest["featureFileSha256"],
        "featureFile": str(feature_path),
        "featureFileSha256": sha256_file(feature_path),
        "rows": int(len(result)),
        "scoreEligibleRows": int(result["score_eligible"].sum()) if len(result) else 0,
        "healthHolds": result.explode("health_holds")["health_holds"].dropna().value_counts().to_dict() if len(result) else {},
        "modelFeatureColumns": expected_features,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({**manifest, "featureFile": str(feature_path), "manifest": str(manifest_path)}, indent=2))


if __name__ == "__main__":
    main()
