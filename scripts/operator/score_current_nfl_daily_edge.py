#!/usr/bin/env python3
"""Score a real NFL regular-season board with the accepted market-reference stack.

Moneyline and spread remain the no-vig named-book reference because every tested
independent margin challenger lost its primary point-forecast gate. The total
adds only the historically accepted, capped quarterback/player-value residual
correction. This writer is local and shadow-only; it cannot publish, track, or
settle a bet.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import re
import sys
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy.special import expit, logit

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from build_nfl_player_value_features import (  # noqa: E402
    RoleState,
    add_player_key,
    load_identity_frames,
    load_verified_inputs,
    normalize_name,
    normalize_team,
    team_player_value_features,
    update_role_states,
)


MODEL_RELEASE = "nfl_market_reference_player_value_runtime_2026_08_20_r3"
REFERENCE_RELEASE = "nfl_market_reference_core_2026_08_20_r1"
SOURCE_MODEL_RELEASE = "nfl_market_residual_player_value_shadow_2026_08_20_r2"
CALIBRATION_RELEASE = "nfl_market_logit_player_value_adjustment_2026_08_20_r2"
FEATURE_RELEASE = "nfl_player_value_features_2016_2025_2026_08_20_r3"
INPUT_RELEASE = "nfl_regular_current_provider_inputs_2026_08_19_r1"
SNAPSHOT_RELEASE = "nfl_daily_edge_local_snapshot_2026_08_20_r3"
MARKET_EVIDENCE_RELEASE = "nfl_regular_market_evidence_2026_08_20_r2"
CORRECTION_CAP_POINTS = 4.0


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_schedule_name(value: Any) -> str:
    text = re.sub(r"[^a-z0-9 ]+", " ", str(value or "").lower())
    return " ".join(token for token in text.split() if token not in {"jr", "sr", "ii", "iii", "iv", "v"})


def implied(price: float) -> float:
    if price > 0:
        return 100.0 / (price + 100.0)
    if price < 0:
        return -price / (-price + 100.0)
    raise ValueError("American price cannot be zero")


def no_vig(first: float, second: float) -> float:
    first_raw = implied(first)
    second_raw = implied(second)
    return first_raw / (first_raw + second_raw)


def injury_status(value: Any) -> str:
    status = str(value or "").lower().strip()
    if any(token in status for token in ("ir", "out", "pup", "nfi", "suspend")):
        return "out"
    if "doubtful" in status:
        return "doubtful"
    if "questionable" in status or status == "q":
        return "questionable"
    return ""


def build_roles(root: pathlib.Path) -> tuple[
    dict[str, RoleState], dict[str, str], pd.DataFrame, dict[str, Any]
]:
    historical, paths, _, _ = load_verified_inputs(root)
    feature_manifest = json.loads((
        root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r3.manifest.json"
    ).read_text(encoding="utf-8"))
    _, snaps, _, gsis_to_pfr, name_to_pfr = load_identity_frames(paths)
    snaps = add_player_key(snaps, "pfr_player_id", None, gsis_to_pfr, name_to_pfr)
    roles: dict[str, RoleState] = {}
    for (season, week), rows in snaps.groupby(["season", "week"], sort=True, observed=True):
        update_role_states(int(season), int(week), rows, roles)
    return roles, name_to_pfr, historical, feature_manifest


def current_player_value_by_team(
    inputs: dict[str, Any],
    roles: dict[str, RoleState],
    name_to_pfr: dict[str, str],
    season: int,
    week: int,
) -> dict[str, dict[str, float]]:
    roster_rows: list[dict[str, Any]] = []
    for team, players in inputs.get("rosters", {}).items():
        for player in players:
            roster_rows.append({
                "team": normalize_team(team),
                "full_name": player.get("player_name"),
                "name_norm": normalize_name(player.get("player_name")),
                "position": player.get("position"),
            })
    rosters = pd.DataFrame(roster_rows)
    if rosters.empty:
        raise RuntimeError("current NFL roster input is empty")
    rosters = add_player_key(rosters, None, None, {}, name_to_pfr)

    injury_rows: list[dict[str, Any]] = []
    seen_reports: set[tuple[str, str]] = set()
    for report in inputs.get("availability", {}).values():
        for team_report in report.get("teams", []):
            team = normalize_team(team_report.get("abbreviation"))
            for player in team_report.get("players", []):
                name = str(player.get("name") or "")
                identity = (team, normalize_name(name))
                if not name or identity in seen_reports:
                    continue
                seen_reports.add(identity)
                injury_rows.append({
                    "team": team,
                    "full_name": name,
                    "name_norm": identity[1],
                    "position": player.get("position"),
                    "report_status": injury_status(player.get("status")),
                    "date_modified": player.get("reportedAt"),
                })
    injuries = pd.DataFrame(injury_rows)
    if injuries.empty:
        injuries = pd.DataFrame(columns=[
            "team", "full_name", "name_norm", "position", "report_status", "date_modified"
        ])
    injuries = add_player_key(injuries, None, None, {}, name_to_pfr)

    result: dict[str, dict[str, float]] = {}
    for team in sorted(rosters["team"].dropna().unique()):
        team_roster = rosters[rosters["team"].eq(team)]
        team_injuries = injuries[injuries["team"].eq(team)]
        result[str(team)] = team_player_value_features(
            season, week, str(team), team_roster, team_injuries, roles
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--week", type=int, default=1)
    args = parser.parse_args()
    if args.week < 1 or args.week > 18:
        raise RuntimeError("regular-season week must be 1 through 18")

    root = pathlib.Path.cwd()
    current_root = root / "football-research/cache/nfl-model/current"
    input_manifest_path = current_root / f"nfl_regular_2026_week_{args.week}.latest.json"
    input_manifest = json.loads(input_manifest_path.read_text(encoding="utf-8"))
    if input_manifest.get("inputRelease") != INPUT_RELEASE:
        raise RuntimeError("regular provider input release mismatch")
    input_path = current_root / str(input_manifest["filename"])
    if sha256_file(input_path) != input_manifest.get("sha256"):
        raise RuntimeError("regular provider input checksum mismatch")
    inputs = json.loads(input_path.read_text(encoding="utf-8"))
    provider = inputs["slate"]
    provider_games = provider.get("games", [])
    expected_games = len(provider_games)
    if (
        (args.week == 1 and expected_games != 16)
        or (args.week != 1 and not 13 <= expected_games <= 16)
        or len({str(game.get("providerGameId")) for game in provider_games}) != expected_games
        or len(provider.get("currentOddsByGame", {})) != expected_games
    ):
        raise RuntimeError("verified NFL weekly input has an incomplete or duplicate game/price card")

    evidence_manifest_path = current_root / f"nfl_regular_2026_week_{args.week}.market-evidence.latest.json"
    evidence_manifest = json.loads(evidence_manifest_path.read_text(encoding="utf-8"))
    if evidence_manifest.get("evidenceRelease") != MARKET_EVIDENCE_RELEASE:
        raise RuntimeError("regular market-evidence release mismatch")
    evidence_path = current_root / str(evidence_manifest["filename"])
    if sha256_file(evidence_path) != evidence_manifest.get("sha256"):
        raise RuntimeError("regular market-evidence checksum mismatch")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    provider_game_ids = sorted(str(game["providerGameId"]) for game in provider["games"])
    evidence_game_ids = sorted(str(game["providerGameId"]) for game in evidence.get("games", []))
    if (
        evidence.get("evidenceRelease") != MARKET_EVIDENCE_RELEASE
        or evidence.get("season") != 2026
        or evidence.get("week") != args.week
        or provider_game_ids != evidence_game_ids
        or len(evidence.get("currentOddsByGame", {})) != expected_games
    ):
        raise RuntimeError("regular market-evidence identity/coverage mismatch")
    provider = {
        **provider,
        "fetchedAt": evidence["capturedAt"],
        "currentOddsByGame": evidence["currentOddsByGame"],
        "openingOddsByGame": evidence.get("providerOpeningOddsByGame", {}),
    }

    report_path = root / "football-research/reports/nfl_market_residual_player_value_tournament_2026_08_20_r2.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    artifact_path = pathlib.Path(report["modelArtifact"])
    if (
        report.get("modelRelease") != SOURCE_MODEL_RELEASE
        or report.get("calibrationRelease") != CALIBRATION_RELEASE
        or report.get("featureRelease") != FEATURE_RELEASE
        or report.get("referenceRelease") != REFERENCE_RELEASE
        or sha256_file(artifact_path) != report.get("modelArtifactSha256")
    ):
        raise RuntimeError("accepted player-value model/report checksum mismatch")
    artifact = joblib.load(artifact_path)
    total_head = artifact.get("total", {})
    if not total_head.get("historicalGatePassed") or total_head.get("model") is None:
        raise RuntimeError("accepted total correction is unavailable")
    total_features = list(total_head["features"])
    total_weight = float(total_head["selected"]["weight"])

    roles, name_to_pfr, historical, feature_manifest = build_roles(root)
    if (
        feature_manifest.get("featureRelease") != FEATURE_RELEASE
        or sha256_file(pathlib.Path(feature_manifest["featureFile"])) != feature_manifest.get("featureFileSha256")
    ):
        raise RuntimeError("player-value feature checksum mismatch")
    player_value = current_player_value_by_team(inputs, roles, name_to_pfr, 2026, args.week)
    total_residuals = historical["actual_total"].to_numpy(float) - historical["market_total"].to_numpy(float)
    total_residuals = total_residuals[np.isfinite(total_residuals)]
    total_std = float(np.std(total_residuals, ddof=1))
    total_probability_slope = 1.596 / max(1.0, total_std)

    state_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    state_manifest = json.loads(state_manifest_path.read_text(encoding="utf-8"))
    state_path = pathlib.Path(state_manifest["stateFile"])
    if sha256_file(state_path) != state_manifest.get("stateFileSha256"):
        raise RuntimeError("NFL state artifact checksum mismatch")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    team_states = state["teamStates"]
    qb_states = state["quarterbackStates"]

    schedule_manifest = json.loads((root / "football-research/cache/nflverse/games.latest.json").read_text(encoding="utf-8"))
    schedule_path = root / "football-research/cache/nflverse" / schedule_manifest["filename"]
    if sha256_file(schedule_path) != schedule_manifest.get("sha256"):
        raise RuntimeError("nflverse schedule checksum mismatch")
    schedule = pd.read_csv(schedule_path, low_memory=False)
    qb_id_by_name: dict[str, str] = {}
    for row in schedule[schedule["season"].between(2016, 2025)].itertuples(index=False):
        for side in ("away", "home"):
            name = getattr(row, f"{side}_qb_name")
            qb_id = getattr(row, f"{side}_qb_id")
            if not pd.isna(name) and not pd.isna(qb_id):
                qb_id_by_name[normalize_schedule_name(name)] = str(qb_id)

    projections: dict[str, Any] = {}
    quarterback_matches = 0
    for game in provider["games"]:
        game_id = str(game["providerGameId"])
        home_display = str(game["home"]["abbreviation"])
        away_display = str(game["away"]["abbreviation"])
        home = normalize_team(home_display)
        away = normalize_team(away_display)
        odds = provider["currentOddsByGame"][game_id]
        if not odds.get("moneyline") or not odds.get("spread") or not odds.get("total"):
            raise RuntimeError(f"incomplete paired current odds for {game_id}")

        qb_context: dict[str, dict[str, Any]] = {}
        for side, display, team in (("home", home_display, home), ("away", away_display, away)):
            qb_rows = [
                row for row in inputs["rosters"].get(display, [])
                if str(row.get("position") or "").upper() == "QB"
            ]
            qb_rows.sort(key=lambda row: float(row.get("depth") or 999))
            starter_name = str(qb_rows[0].get("player_name") or "") if qb_rows else ""
            qb_id = qb_id_by_name.get(normalize_schedule_name(starter_name))
            qb = qb_states.get(qb_id or "", {})
            matched = qb_id is not None
            quarterback_matches += int(matched)
            qb_context[side] = {
                "starter": starter_name or None,
                "matched": matched,
                "epa": float(qb.get("epa", 0.0)),
                "cpoe": float(qb.get("cpoe", 0.0)),
                "experience": math.log1p(float(qb.get("dropbacks", 0.0))),
                "sackRate": float(qb.get("sackRate", 0.070)),
                "turnoverRate": float(qb.get("turnoverRate", 0.022)),
                "continuity": float(qb_id is not None and team_states[team].get("lastQbId") == qb_id),
            }

        home_pv = player_value[home]
        away_pv = player_value[away]
        feature_values = {
            "pv_qb_unavailable_diff": home_pv["qb_unavailable"] - away_pv["qb_unavailable"],
            "pv_qb_unavailable_sum": home_pv["qb_unavailable"] + away_pv["qb_unavailable"],
            "pv_qb_epa_diff": qb_context["home"]["epa"] - qb_context["away"]["epa"],
            "pv_qb_epa_sum": qb_context["home"]["epa"] + qb_context["away"]["epa"],
            "pv_qb_cpoe_diff": qb_context["home"]["cpoe"] - qb_context["away"]["cpoe"],
            "pv_qb_cpoe_sum": qb_context["home"]["cpoe"] + qb_context["away"]["cpoe"],
            "pv_qb_experience_diff": qb_context["home"]["experience"] - qb_context["away"]["experience"],
            "pv_qb_experience_sum": qb_context["home"]["experience"] + qb_context["away"]["experience"],
            "pv_qb_sack_rate_diff": qb_context["home"]["sackRate"] - qb_context["away"]["sackRate"],
            "pv_qb_sack_rate_sum": qb_context["home"]["sackRate"] + qb_context["away"]["sackRate"],
            "pv_qb_turnover_rate_diff": qb_context["home"]["turnoverRate"] - qb_context["away"]["turnoverRate"],
            "pv_qb_turnover_rate_sum": qb_context["home"]["turnoverRate"] + qb_context["away"]["turnoverRate"],
            "pv_qb_continuity_diff": qb_context["home"]["continuity"] - qb_context["away"]["continuity"],
            "pv_qb_continuity_sum": qb_context["home"]["continuity"] + qb_context["away"]["continuity"],
        }
        feature_frame = pd.DataFrame([[feature_values[name] for name in total_features]], columns=total_features)
        raw_total_correction = float(total_head["model"].predict(feature_frame)[0])
        raw_total_correction = float(np.clip(raw_total_correction, -CORRECTION_CAP_POINTS, CORRECTION_CAP_POINTS))
        final_total_correction = total_weight * raw_total_correction

        market_home_margin = -float(odds["spread"]["homeLine"])
        market_total = float(odds["total"]["line"])
        projected_home_margin = market_home_margin
        projected_total = market_total + final_total_correction
        fair_home_win = no_vig(float(odds["moneyline"]["homePrice"]), float(odds["moneyline"]["awayPrice"]))
        fair_home_cover = no_vig(float(odds["spread"]["homePrice"]), float(odds["spread"]["awayPrice"]))
        fair_over = no_vig(float(odds["total"]["overPrice"]), float(odds["total"]["underPrice"]))
        over_probability = float(expit(logit(np.clip(fair_over, 0.001, 0.999)) + final_total_correction * total_probability_slope))
        projected_home_score = (projected_total + projected_home_margin) / 2.0
        projected_away_score = projected_total - projected_home_score

        def team_context(team: str, side: str, pv: dict[str, float]) -> dict[str, float]:
            state_row = team_states[team]
            return {
                "opponentAdjustedOffenseEpaPerPlay": float(state_row["offAdjusted"]["epa"]),
                "opponentAdjustedDefenseEpaAllowedPerPlay": float(state_row["defAdjusted"]["epa"]),
                "opponentAdjustedSuccessRate": float(state_row["offAdjusted"]["success"]),
                "opponentAdjustedExplosivePlayRate": float(state_row["offAdjusted"]["explosive_rate"]),
                "estimatedPlays": float(state_row["offAdjusted"]["plays"]),
                "quarterbackEpaPerDropback": float(qb_context[side]["epa"]),
                "injuryBurden": float(pv["unavailable_role"]),
            }

        projections[game_id] = {
            "providerGameId": game_id,
            "scheduledStart": game["scheduledStart"],
            "home": home_display,
            "away": away_display,
            "generatedAt": provider["fetchedAt"],
            "referenceProjectedHomeMargin": market_home_margin,
            "referenceProjectedTotal": market_total,
            "playerValueTotalCorrection": final_total_correction,
            "projectedHomeMargin": projected_home_margin,
            "projectedTotal": projected_total,
            "projectedHomeScore": projected_home_score,
            "projectedAwayScore": projected_away_score,
            "homeWinProbability": fair_home_win,
            "homeCoverProbability": fair_home_cover,
            "overProbability": over_probability,
            "marginStdDev": 0.0,
            "totalStdDev": total_std,
            "homeStartingQuarterback": qb_context["home"]["starter"],
            "awayStartingQuarterback": qb_context["away"]["starter"],
            "homeQuarterbackHistoryMatched": qb_context["home"]["matched"],
            "awayQuarterbackHistoryMatched": qb_context["away"]["matched"],
            "homeTeamContext": team_context(home, "home", home_pv),
            "awayTeamContext": team_context(away, "away", away_pv),
            "market": {
                "sportsbook": odds["sportsbook"],
                "homeMarginLine": market_home_margin,
                "totalLine": market_total,
                "fairHomeWinProbability": fair_home_win,
                "fairHomeCoverProbability": fair_home_cover,
                "fairOverProbability": fair_over,
            },
            "dataHealthFindings": [
                "market_reference_moneyline_and_spread",
                "historically_accepted_player_value_total_correction",
                "2026_forward_lock_evaluation_required",
                "week_1_availability_snapshot_precedes_lock",
            ],
            "actionable": False,
        }

    output = {
        "snapshotRelease": SNAPSHOT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "referenceRelease": REFERENCE_RELEASE,
        "sourceModelRelease": SOURCE_MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": provider["fetchedAt"],
        "season": 2026,
        "week": args.week,
        "seasonPhase": "regular",
        "providerInputSha256": input_manifest["sha256"],
        "marketEvidenceRelease": MARKET_EVIDENCE_RELEASE,
        "marketEvidenceSha256": evidence_manifest["sha256"],
        "modelArtifactSha256": report["modelArtifactSha256"],
        "featureArtifactSha256": feature_manifest["featureFileSha256"],
        "stateArtifactSha256": state_manifest["stateFileSha256"],
        "projectionsByGame": projections,
        "localOnly": True,
        "actionable": False,
        "trackingEligible": False,
        "trackingPolicy": "regular_season_appends_to_existing_nfl_lifetime_only_after_launch_approval_and_locked_prediction",
    }
    output_path = current_root / f"nfl_regular_2026_week_{args.week}.daily-edge.scored.json"
    output_path.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "snapshotRelease": SNAPSHOT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "games": len(projections),
        "predictions": len(projections) * 3,
        "quarterbacksMatched": quarterback_matches,
        "marketEvidenceRelease": MARKET_EVIDENCE_RELEASE,
        "output": str(output_path),
        "sha256": sha256_file(output_path),
    }, indent=2))


if __name__ == "__main__":
    main()
