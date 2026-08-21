#!/usr/bin/env python3
"""Build leakage-aware NFL player availability and continuity features.

The source injury report for a game week is combined with player role estimates
that were frozen before that week. Role estimates come from prior offensive and
defensive snap shares; the current week's snaps are applied only after every
game feature for that week has been materialized.

This is a local shadow builder. It never writes predictions, grades, tracking,
database state, or production configuration.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import re
import time
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import pandas as pd
import pyarrow.parquet as pq


FEATURE_RELEASE = "nfl_player_value_features_2016_2025_2026_08_20_r3"
BASE_FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
SOURCE_RELEASE = "nfl_real_model_source_cache_2016_2025_2026_08_19_r1"

ROLE_ALPHA = 0.45
ROLE_WEEK_DECAY = 0.965
ROLE_OFFSEASON_CARRY = 0.70
ROLE_MAX_AGE_WEEKS = 24
CORE_ROLE_FLOOR = 0.20

STATUS_SEVERITY = {
    "out": 1.00,
    "doubtful": 0.65,
    "questionable": 0.25,
}

GROUPS = ("qb", "ol", "skill", "front", "secondary", "other")


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_team(value: Any) -> str:
    team = str(value or "").upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def normalize_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]", "", text.lower())


def clean_id(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def position_group(value: Any) -> str:
    position = str(value or "").upper().strip()
    if position == "QB":
        return "qb"
    if position in {"T", "OT", "G", "OG", "C", "OL"}:
        return "ol"
    if position in {"WR", "RB", "FB", "TE"}:
        return "skill"
    if position in {"DE", "DT", "DL", "NT", "LB", "ILB", "OLB", "EDGE"}:
        return "front"
    if position in {"CB", "S", "DB", "FS", "SS"}:
        return "secondary"
    return "other"


@dataclass
class RoleState:
    offense: float = 0.0
    defense: float = 0.0
    last_team: str = ""
    last_season: int = 0
    last_week: int = 0
    position: str = ""


def adjusted_role(state: RoleState | None, season: int, week: int) -> tuple[float, float, bool]:
    if state is None or state.last_season <= 0:
        return 0.0, 0.0, False
    if season == state.last_season:
        age = max(0, week - state.last_week)
        factor = ROLE_WEEK_DECAY ** min(age, ROLE_MAX_AGE_WEEKS)
    else:
        gap = max(1, season - state.last_season)
        factor = ROLE_OFFSEASON_CARRY ** gap
    return state.offense * factor, state.defense * factor, True


def load_verified_inputs(
    root: pathlib.Path,
) -> tuple[pd.DataFrame, dict[tuple[str, int], pathlib.Path], dict[str, Any], dict[str, Any]]:
    base_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    base_manifest = json.loads(base_manifest_path.read_text(encoding="utf-8"))
    base_path = pathlib.Path(base_manifest["featureFile"])
    if (
        base_manifest.get("featureRelease") != BASE_FEATURE_RELEASE
        or not base_path.exists()
        or sha256_file(base_path) != base_manifest.get("featureFileSha256")
    ):
        raise RuntimeError("base NFL feature release/checksum mismatch")

    source_manifest_path = root / "football-research/cache/nflverse/real-model-r1/manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    if source_manifest.get("cacheRelease") != SOURCE_RELEASE or source_manifest.get("failures"):
        raise RuntimeError("NFL source cache release/failures mismatch")
    paths: dict[tuple[str, int], pathlib.Path] = {}
    for item in source_manifest["files"]:
        if item["dataset"] not in {"injuries", "snap_counts", "weekly_rosters"}:
            continue
        path = pathlib.Path(item["filename"])
        if not path.exists() or sha256_file(path) != item["sha256"]:
            raise RuntimeError(f"source checksum mismatch: {path}")
        paths[(str(item["dataset"]), int(item["season"]))] = path
    expected = {(dataset, season) for dataset in ("injuries", "snap_counts", "weekly_rosters") for season in range(2016, 2026)}
    if set(paths) != expected:
        raise RuntimeError("NFL player-value source cache is incomplete")
    return pd.read_parquet(base_path), paths, base_manifest, source_manifest


def load_identity_frames(
    paths: dict[tuple[str, int], pathlib.Path],
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, str], dict[str, str]]:
    roster_frames: list[pd.DataFrame] = []
    snap_frames: list[pd.DataFrame] = []
    injury_frames: list[pd.DataFrame] = []
    for season in range(2016, 2026):
        roster = pq.read_table(
            paths[("weekly_rosters", season)],
            columns=["season", "week", "team", "game_type", "position", "full_name", "gsis_id", "pfr_id"],
        ).to_pandas()
        roster = roster[roster["game_type"].fillna("REG").eq("REG")].copy()
        roster_frames.append(roster)

        snaps = pq.read_table(
            paths[("snap_counts", season)],
            columns=[
                "season", "week", "game_type", "team", "player", "pfr_player_id", "position",
                "offense_pct", "defense_pct",
            ],
        ).to_pandas()
        snaps = snaps[snaps["game_type"].fillna("REG").eq("REG")].copy()
        snap_frames.append(snaps)

        injury_path = paths[("injuries", season)]
        available_columns = set(pq.read_schema(injury_path).names)
        requested_columns = [
            "season", "season_type", "game_type", "week", "team", "gsis_id", "position",
            "full_name", "report_status", "date_modified",
        ]
        injuries = pq.read_table(
            injury_path,
            columns=[column for column in requested_columns if column in available_columns],
        ).to_pandas()
        if "season_type" not in injuries:
            injuries["season_type"] = ""
        if "date_modified" not in injuries:
            injuries["date_modified"] = pd.NaT
        season_type = injuries["season_type"].fillna("").eq("REG")
        game_type = injuries["game_type"].fillna("REG").eq("REG")
        injury_frames.append(injuries[season_type | game_type].copy())

    rosters = pd.concat(roster_frames, ignore_index=True)
    snaps = pd.concat(snap_frames, ignore_index=True)
    injuries = pd.concat(injury_frames, ignore_index=True)
    for frame in (rosters, snaps, injuries):
        frame["team"] = frame["team"].map(normalize_team)

    rosters["name_norm"] = rosters["full_name"].map(normalize_name)
    snaps["name_norm"] = snaps["player"].map(normalize_name)
    injuries["name_norm"] = injuries["full_name"].map(normalize_name)

    identity = rosters[["gsis_id", "pfr_id", "name_norm"]].copy()
    identity["gsis_id"] = identity["gsis_id"].map(clean_id)
    identity["pfr_id"] = identity["pfr_id"].map(clean_id)

    gsis_pairs = identity.dropna(subset=["gsis_id", "pfr_id"])
    gsis_unique = gsis_pairs.groupby("gsis_id", observed=True)["pfr_id"].nunique()
    valid_gsis = set(gsis_unique[gsis_unique.eq(1)].index)
    gsis_to_pfr = (
        gsis_pairs[gsis_pairs["gsis_id"].isin(valid_gsis)]
        .drop_duplicates("gsis_id")
        .set_index("gsis_id")["pfr_id"]
        .to_dict()
    )

    name_pairs = pd.concat([
        identity[["name_norm", "pfr_id"]],
        snaps.rename(columns={"pfr_player_id": "pfr_id"})[["name_norm", "pfr_id"]],
    ], ignore_index=True).dropna(subset=["name_norm", "pfr_id"])
    name_pairs["pfr_id"] = name_pairs["pfr_id"].map(clean_id)
    name_pairs = name_pairs[name_pairs["name_norm"].ne("") & name_pairs["pfr_id"].notna()]
    name_unique = name_pairs.groupby("name_norm", observed=True)["pfr_id"].nunique()
    valid_names = set(name_unique[name_unique.eq(1)].index)
    name_to_pfr = (
        name_pairs[name_pairs["name_norm"].isin(valid_names)]
        .drop_duplicates("name_norm")
        .set_index("name_norm")["pfr_id"]
        .to_dict()
    )
    return rosters, snaps, injuries, gsis_to_pfr, name_to_pfr


def add_player_key(
    frame: pd.DataFrame,
    pfr_column: str | None,
    gsis_column: str | None,
    gsis_to_pfr: dict[str, str],
    name_to_pfr: dict[str, str],
) -> pd.DataFrame:
    result = frame.copy()

    def resolve(row: pd.Series) -> str:
        pfr = clean_id(row.get(pfr_column)) if pfr_column else None
        gsis = clean_id(row.get(gsis_column)) if gsis_column else None
        name = str(row.get("name_norm") or "")
        resolved = pfr or (gsis_to_pfr.get(gsis) if gsis else None) or name_to_pfr.get(name)
        if resolved:
            return f"pfr:{resolved}"
        if gsis:
            return f"gsis:{gsis}"
        return f"name:{name}"

    result["player_key"] = result.apply(resolve, axis=1)
    return result


def status_rows_for_week(frame: pd.DataFrame) -> pd.DataFrame:
    rows = frame.copy()
    rows["status_norm"] = rows["report_status"].fillna("").astype(str).str.lower().str.strip()
    rows["severity"] = rows["status_norm"].map(STATUS_SEVERITY).fillna(0.0)
    rows["position_group"] = rows["position"].map(position_group)
    rows["date_modified"] = pd.to_datetime(rows["date_modified"], errors="coerce", utc=True)
    rows["has_timestamp"] = rows["date_modified"].notna().astype(int)
    rows = rows.sort_values(["has_timestamp", "date_modified", "severity"], ascending=True)
    return rows.drop_duplicates(["team", "player_key"], keep="last")


def team_player_value_features(
    season: int,
    week: int,
    team: str,
    roster: pd.DataFrame,
    injuries: pd.DataFrame,
    roles: dict[str, RoleState],
) -> dict[str, float]:
    current_roster = set(roster["player_key"].astype(str))
    current_injuries = status_rows_for_week(injuries)
    severity_by_player = dict(zip(current_injuries["player_key"], current_injuries["severity"], strict=False))
    reported = current_injuries[current_injuries["severity"].gt(0)].copy()

    values: dict[str, float] = {
        "report_present": float(not current_injuries.empty),
        "listed_players": float(len(current_injuries)),
        "unavailable_players": float(len(reported)),
        "role_matched_players": 0.0,
        "role_match_rate": math.nan,
        "unavailable_role": 0.0,
        "offense_unavailable": 0.0,
        "defense_unavailable": 0.0,
        "out_role": 0.0,
        "doubtful_role": 0.0,
        "questionable_role": 0.0,
        "core_out_count": 0.0,
    }
    for group in GROUPS:
        values[f"{group}_unavailable"] = 0.0

    for player in reported.itertuples(index=False):
        state = roles.get(str(player.player_key))
        offense, defense, matched = adjusted_role(state, season, week)
        role = max(offense, defense)
        if matched:
            values["role_matched_players"] += 1.0
        else:
            # An unmatched listed player remains visible as uncertain depth, not
            # as a fabricated starter. The explicit match-rate feature lets the
            # model distinguish evidence from this small reserve-level floor.
            role = 0.05
            if str(player.position_group) == "qb":
                offense = 0.05
            elif str(player.position_group) in {"front", "secondary"}:
                defense = 0.05
            else:
                offense = 0.05
        severity = float(player.severity)
        group = str(player.position_group)
        values["unavailable_role"] += severity * role
        values["offense_unavailable"] += severity * offense
        values["defense_unavailable"] += severity * defense
        values[f"{group}_unavailable"] += severity * role
        values[f"{player.status_norm}_role"] += role
        if player.status_norm == "out" and role >= 0.50:
            values["core_out_count"] += 1.0

    if len(reported):
        values["role_match_rate"] = values["role_matched_players"] / len(reported)

    prior_team_roles: list[tuple[str, float, float]] = []
    for player_key, state in roles.items():
        if state.last_team != team:
            continue
        offense, defense, _ = adjusted_role(state, season, week)
        if max(offense, defense) >= CORE_ROLE_FLOOR:
            prior_team_roles.append((player_key, offense, defense))

    offense_denominator = sum(offense for _, offense, _ in prior_team_roles)
    defense_denominator = sum(defense for _, _, defense in prior_team_roles)
    offense_overlap = sum(offense for key, offense, _ in prior_team_roles if key in current_roster)
    defense_overlap = sum(defense for key, _, defense in prior_team_roles if key in current_roster)
    healthy_offense = sum(
        offense * (1.0 - severity_by_player.get(key, 0.0))
        for key, offense, _ in prior_team_roles
        if key in current_roster
    )
    healthy_defense = sum(
        defense * (1.0 - severity_by_player.get(key, 0.0))
        for key, _, defense in prior_team_roles
        if key in current_roster
    )
    values["offense_continuity"] = (
        offense_overlap / offense_denominator if offense_denominator > 0 else math.nan
    )
    values["defense_continuity"] = (
        defense_overlap / defense_denominator if defense_denominator > 0 else math.nan
    )
    values["healthy_offense_continuity"] = (
        healthy_offense / offense_denominator if offense_denominator > 0 else math.nan
    )
    values["healthy_defense_continuity"] = (
        healthy_defense / defense_denominator if defense_denominator > 0 else math.nan
    )
    values["prior_core_players"] = float(len(prior_team_roles))
    values["roster_identity_coverage"] = (
        float(roster["player_key"].str.startswith("pfr:").mean()) if len(roster) else math.nan
    )
    return values


def update_role_states(
    season: int,
    week: int,
    snaps: pd.DataFrame,
    roles: dict[str, RoleState],
) -> None:
    for player in snaps.itertuples(index=False):
        key = str(player.player_key)
        state = roles.get(key)
        prior_offense, prior_defense, matched = adjusted_role(state, season, week)
        if not matched:
            state = RoleState()
        offense = float(player.offense_pct) if pd.notna(player.offense_pct) else 0.0
        defense = float(player.defense_pct) if pd.notna(player.defense_pct) else 0.0
        state.offense = ROLE_ALPHA * offense + (1.0 - ROLE_ALPHA) * prior_offense
        state.defense = ROLE_ALPHA * defense + (1.0 - ROLE_ALPHA) * prior_defense
        state.last_team = normalize_team(player.team)
        state.last_season = season
        state.last_week = week
        state.position = str(player.position or "")
        roles[key] = state


def build_features(
    base: pd.DataFrame,
    rosters: pd.DataFrame,
    snaps: pd.DataFrame,
    injuries: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    roster_groups = {key: group for key, group in rosters.groupby(["season", "week", "team"], observed=True)}
    snap_groups = {key: group for key, group in snaps.groupby(["season", "week"], observed=True)}
    injury_groups = {key: group for key, group in injuries.groupby(["season", "week", "team"], observed=True)}
    roles: dict[str, RoleState] = {}
    feature_rows: list[dict[str, Any]] = []

    for (season_value, week_value), games in base.groupby(["season", "week"], sort=True, observed=True):
        season = int(season_value)
        week = int(week_value)
        teams = sorted(set(games["home_team"]) | set(games["away_team"]))
        by_team: dict[str, dict[str, float]] = {}
        for team in teams:
            roster = roster_groups.get((season, week, team), rosters.iloc[0:0])
            injury = injury_groups.get((season, week, team), injuries.iloc[0:0])
            by_team[team] = team_player_value_features(season, week, team, roster, injury, roles)

        for game in games.itertuples(index=False):
            row: dict[str, Any] = {"game_id": str(game.game_id)}
            for side, team in (("home", str(game.home_team)), ("away", str(game.away_team))):
                for name, value in by_team[team].items():
                    row[f"{side}_pv_{name}"] = value

            paired = [
                "unavailable_role", "offense_unavailable", "defense_unavailable", "qb_unavailable",
                "ol_unavailable", "skill_unavailable", "front_unavailable", "secondary_unavailable",
                "out_role", "doubtful_role", "questionable_role", "core_out_count",
                "offense_continuity", "defense_continuity", "healthy_offense_continuity",
                "healthy_defense_continuity",
            ]
            for name in paired:
                home_value = row[f"home_pv_{name}"]
                away_value = row[f"away_pv_{name}"]
                row[f"pv_{name}_diff"] = home_value - away_value
                row[f"pv_{name}_sum"] = home_value + away_value
            row["pv_qb_epa_diff"] = float(game.home_qb_epa) - float(game.away_qb_epa)
            row["pv_qb_epa_sum"] = float(game.home_qb_epa) + float(game.away_qb_epa)
            row["pv_qb_cpoe_diff"] = float(game.home_qb_cpoe) - float(game.away_qb_cpoe)
            row["pv_qb_cpoe_sum"] = float(game.home_qb_cpoe) + float(game.away_qb_cpoe)
            row["pv_qb_experience_diff"] = float(game.home_qb_log_dropbacks) - float(game.away_qb_log_dropbacks)
            row["pv_qb_experience_sum"] = float(game.home_qb_log_dropbacks) + float(game.away_qb_log_dropbacks)
            row["pv_qb_sack_rate_diff"] = float(game.home_qb_sack_rate) - float(game.away_qb_sack_rate)
            row["pv_qb_sack_rate_sum"] = float(game.home_qb_sack_rate) + float(game.away_qb_sack_rate)
            row["pv_qb_turnover_rate_diff"] = float(game.home_qb_turnover_rate) - float(game.away_qb_turnover_rate)
            row["pv_qb_turnover_rate_sum"] = float(game.home_qb_turnover_rate) + float(game.away_qb_turnover_rate)
            row["pv_qb_continuity_diff"] = float(game.home_qb_same_as_last_start) - float(game.away_qb_same_as_last_start)
            row["pv_qb_continuity_sum"] = float(game.home_qb_same_as_last_start) + float(game.away_qb_same_as_last_start)
            feature_rows.append(row)

        # Current-week snaps are outcomes of participation and are applied only
        # after every game in the week has been frozen.
        update_role_states(season, week, snap_groups.get((season, week), snaps.iloc[0:0]), roles)

    additions = pd.DataFrame(feature_rows)
    if additions["game_id"].duplicated().any() or len(additions) != len(base):
        raise RuntimeError("player-value feature identity mismatch")
    result = base.merge(additions, on="game_id", validate="one_to_one")
    result["feature_release"] = FEATURE_RELEASE

    team_rows: list[dict[str, Any]] = []
    for side in ("home", "away"):
        current = result[["season", f"{side}_pv_report_present", f"{side}_pv_role_match_rate", f"{side}_pv_roster_identity_coverage"]].copy()
        current.columns = ["season", "report_present", "role_match_rate", "roster_identity_coverage"]
        team_rows.extend(current.to_dict("records"))
    team_frame = pd.DataFrame(team_rows)
    coverage: dict[str, Any] = {}
    for season, group in team_frame.groupby("season", observed=True):
        coverage[str(int(season))] = {
            "teamGames": int(len(group)),
            "reportPresentTeamGames": int(group["report_present"].sum()),
            "reportCoverage": float(group["report_present"].mean()),
            "meanRoleMatchRateWhenListed": float(group["role_match_rate"].dropna().mean()) if group["role_match_rate"].notna().any() else None,
            "meanRosterIdentityCoverage": float(group["roster_identity_coverage"].dropna().mean()) if group["roster_identity_coverage"].notna().any() else None,
        }
    diagnostics = {
        "coverageBySeason": coverage,
        "addedColumns": [column for column in result.columns if column not in base.columns or column == "feature_release"],
    }
    return result, diagnostics


def main() -> None:
    root = pathlib.Path.cwd()
    base, paths, base_manifest, source_manifest = load_verified_inputs(root)
    rosters, snaps, injuries, gsis_to_pfr, name_to_pfr = load_identity_frames(paths)
    rosters = add_player_key(rosters, "pfr_id", "gsis_id", gsis_to_pfr, name_to_pfr)
    snaps = add_player_key(snaps, "pfr_player_id", None, gsis_to_pfr, name_to_pfr)
    injuries = add_player_key(injuries, None, "gsis_id", gsis_to_pfr, name_to_pfr)
    features, diagnostics = build_features(base, rosters, snaps, injuries)

    if len(features) != 2639 or features["game_id"].nunique() != len(features):
        raise RuntimeError(f"unexpected player-value feature shape: {len(features)}")
    added = [column for column in features.columns if "_pv_" in column or column.startswith("pv_")]
    if len(added) < 50:
        raise RuntimeError(f"unexpected player-value feature count: {len(added)}")

    output_root = root / "football-research/cache/nfl-model"
    output_root.mkdir(parents=True, exist_ok=True)
    feature_path = output_root / "nfl_pregame_features_2016_2025_r3.parquet"
    manifest_path = output_root / "nfl_pregame_features_2016_2025_r3.manifest.json"
    features.to_parquet(feature_path, index=False)
    manifest = {
        "featureRelease": FEATURE_RELEASE,
        "baseFeatureRelease": BASE_FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "preseasonIncluded": False,
        "sourceCacheRelease": SOURCE_RELEASE,
        "sourceManifestSha256": sha256_file(root / "football-research/cache/nflverse/real-model-r1/manifest.json"),
        "baseFeatureSha256": base_manifest["featureFileSha256"],
        "featureFile": str(feature_path),
        "featureFileSha256": sha256_file(feature_path),
        "rows": int(len(features)),
        "columns": list(features.columns),
        "playerValueColumns": added,
        "rolePolicy": {
            "snapEwmAlpha": ROLE_ALPHA,
            "weeklyDecay": ROLE_WEEK_DECAY,
            "offseasonCarry": ROLE_OFFSEASON_CARRY,
            "coreRoleFloor": CORE_ROLE_FLOOR,
            "unmatchedListedPlayerRoleFloor": 0.05,
            "statusSeverity": STATUS_SEVERITY,
        },
        "asOfPolicy": {
            "role": "prior offensive/defensive snap share only; complete game week updates after all weekly features are frozen",
            "injury": "final weekly REG injury designation; safe for near-kick historical research, not aligned to provider opening timestamps",
            "identity": "GSIS/PFR/name bridges use identity only and never outcomes or current-week snaps",
            "currentRuntime": "requires timestamped current roster, depth chart, injury report and expected starter inputs before scoring",
        },
        **diagnostics,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "featureRelease": FEATURE_RELEASE,
        "rows": len(features),
        "playerValueColumns": len(added),
        "featureSha256": manifest["featureFileSha256"],
        "coverageBySeason": diagnostics["coverageBySeason"],
        "manifest": str(manifest_path),
    }, indent=2))


if __name__ == "__main__":
    main()
