#!/usr/bin/env python3
"""Score the real 2026 NFL regular-season slate with the frozen r3 refit."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import re
import sys
from collections import defaultdict
from typing import Any

import joblib
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from scipy.stats import norm

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from tournament_nfl_real_model import MarketRecipe, ProbabilityCalibrator, Recipe  # noqa: E402


MODEL_RELEASE = "nfl_pregame_real_local_current_refit_2026_08_19_r3"
SOURCE_MODEL_RELEASE = "nfl_pregame_real_local_candidate_2026_08_19_r2"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
SNAPSHOT_RELEASE = "nfl_regular_real_current_snapshot_2026_08_19_r1"
INPUT_RELEASE = "nfl_regular_current_provider_inputs_2026_08_19_r1"
PRESEASON_INPUT_RELEASE = "nfl_preseason_current_provider_inputs_2026_08_19_r2"
PRESEASON_REHEARSAL_SNAPSHOT_RELEASE = "nfl_regular_pipeline_preseason_rehearsal_snapshot_2026_08_20_r1"
OFFSEASON_CARRY = 0.65

PRIORS = {
    "epa": 0.0, "pass_epa": 0.0, "rush_epa": 0.0, "success": 0.43,
    "early_down_pass_epa": 0.0, "explosive_rate": 0.105, "sack_rate": 0.070,
    "turnover_rate": 0.022, "plays": 64.0, "redzone_td_rate": 0.55,
    "no_huddle_rate": 0.10, "pass_oe": 0.0, "points": 22.5,
}
POSITION_WEIGHT = defaultdict(lambda: 1.0, {
    "QB": 2.5, "OT": 1.2, "T": 1.2, "G": 1.2, "OG": 1.2, "C": 1.2,
    "WR": 1.05, "TE": 1.05, "RB": 0.9,
})


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_team(value: str) -> str:
    team = value.upper()
    return {"LAR": "LA", "WSH": "WAS"}.get(team, team)


def normalize_name(value: Any) -> str:
    name = re.sub(r"[^a-z0-9 ]+", " ", str(value or "").lower())
    tokens = [token for token in name.split() if token not in {"jr", "sr", "ii", "iii", "iv", "v"}]
    return " ".join(tokens)


def regress(value: float, prior: float) -> float:
    return prior + OFFSEASON_CARRY * (value - prior)


def american_fair(first: float, second: float) -> float:
    def implied(price: float) -> float:
        return 100.0 / (price + 100.0) if price > 0 else -price / (-price + 100.0)
    a, b = implied(first), implied(second)
    return a / (a + b)


def empirical_probability(prediction: float, threshold: float, residuals: np.ndarray, bandwidth: float) -> float:
    return float(np.mean(norm.cdf((prediction + residuals - threshold) / bandwidth)))


def predict_recipe(target: dict[str, Any], frame: pd.DataFrame) -> np.ndarray:
    result = np.zeros(len(frame))
    for component in target["independentRecipe"]["components"]:
        result += float(component["weight"]) * np.asarray(target["models"][component["model"]].predict(frame), dtype=float)
    return result


def injury_summary(availability: dict[str, Any], team: str) -> dict[str, float]:
    report = next((item for item in availability.get("teams", []) if item.get("abbreviation") == team), None)
    players = report.get("players", []) if report else []
    weighted = qb_weighted = out_count = reported = 0.0
    for player in players:
        status = str(player.get("status") or "").lower()
        status_weight = 1.0 if any(token in status for token in ["out", "ir", "pup", "nfi"]) else 0.75 if "doubtful" in status else 0.35 if "questionable" in status or status == "q" else 0.0
        position = str(player.get("position") or "").upper()
        value = status_weight * POSITION_WEIGHT[position]
        weighted += value
        qb_weighted += value if position == "QB" else 0.0
        out_count += float(status_weight >= 1.0)
        reported += float(status_weight > 0)
    return {
        "injury_weight": weighted,
        "qb_injury_weight": qb_weighted,
        "out_count": out_count,
        "injury_reported_count": reported,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["regular", "preseason"], default="regular")
    parser.add_argument("--week", type=int, default=1)
    parser.add_argument("--product-week", type=int, default=2)
    parser.add_argument("--roster-week", type=int, default=1)
    args = parser.parse_args()
    root = pathlib.Path.cwd()
    current_root = root / "football-research/cache/nfl-model/current"
    input_manifest_path = current_root / (
        f"nfl_regular_2026_week_{args.week}.latest.json"
        if args.phase == "regular"
        else f"nfl_preseason_2026_product_week_{args.product_week}.latest.json"
    )
    input_manifest = json.loads(input_manifest_path.read_text(encoding="utf-8"))
    expected_input_release = INPUT_RELEASE if args.phase == "regular" else PRESEASON_INPUT_RELEASE
    if input_manifest.get("inputRelease") != expected_input_release:
        raise RuntimeError(f"{args.phase} provider input release mismatch")
    input_path = input_manifest_path.parent / input_manifest["filename"]
    if sha256_file(input_path) != input_manifest["sha256"]:
        raise RuntimeError(f"{args.phase} provider input checksum mismatch")
    inputs = json.loads(input_path.read_text(encoding="utf-8"))
    provider = inputs["slate"]
    roster_input_sha256 = input_manifest["sha256"]
    if args.phase == "preseason":
        roster_manifest_path = current_root / f"nfl_regular_2026_week_{args.roster_week}.latest.json"
        roster_manifest = json.loads(roster_manifest_path.read_text(encoding="utf-8"))
        if roster_manifest.get("inputRelease") != INPUT_RELEASE:
            raise RuntimeError("preseason rehearsal roster source release mismatch")
        roster_input_path = roster_manifest_path.parent / roster_manifest["filename"]
        if sha256_file(roster_input_path) != roster_manifest["sha256"]:
            raise RuntimeError("preseason rehearsal roster source checksum mismatch")
        roster_inputs = json.loads(roster_input_path.read_text(encoding="utf-8"))
        inputs["rosters"] = roster_inputs["rosters"]
        roster_input_sha256 = roster_manifest["sha256"]
        provider_teams = {
            game[side]["abbreviation"] for game in provider["games"] for side in ["away", "home"]
        }
        if provider_teams != set(inputs["rosters"]):
            raise RuntimeError("preseason rehearsal does not have one roster snapshot for all 32 teams")

    state_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    state_manifest = json.loads(state_manifest_path.read_text(encoding="utf-8"))
    state_path = pathlib.Path(state_manifest["stateFile"])
    if state_manifest.get("featureRelease") != FEATURE_RELEASE or sha256_file(state_path) != state_manifest["stateFileSha256"]:
        raise RuntimeError("regular team/QB state artifact mismatch")
    state_artifact = json.loads(state_path.read_text(encoding="utf-8"))
    team_states = state_artifact["teamStates"]
    qb_states = state_artifact["quarterbackStates"]

    model_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_real_local_current_refit_2026_08_19_r3.manifest.json"
    model_manifest = json.loads(model_manifest_path.read_text(encoding="utf-8"))
    model_path = pathlib.Path(model_manifest["modelArtifact"])
    if model_manifest.get("modelRelease") != MODEL_RELEASE or sha256_file(model_path) != model_manifest["modelArtifactSha256"]:
        raise RuntimeError("regular r3 model artifact mismatch")
    artifact = joblib.load(model_path)
    if artifact.get("modelRelease") != MODEL_RELEASE or artifact.get("sourceTournamentModelRelease") != SOURCE_MODEL_RELEASE:
        raise RuntimeError("regular r3 model release stamp mismatch")

    schedule_manifest = json.loads((root / "football-research/cache/nflverse/games.latest.json").read_text(encoding="utf-8"))
    schedule_path = root / "football-research/cache/nflverse" / schedule_manifest["filename"]
    if sha256_file(schedule_path) != schedule_manifest["sha256"]:
        raise RuntimeError("nflverse schedule checksum mismatch")
    schedule = pd.read_csv(schedule_path, low_memory=False)
    schedule["home_team_norm"] = schedule["home_team"].fillna("").map(normalize_team)
    schedule["away_team_norm"] = schedule["away_team"].fillna("").map(normalize_team)
    schedule_current = schedule[(schedule["season"] == 2026) & (schedule["game_type"] == "REG") & (schedule["week"] == args.week)] if args.phase == "regular" else schedule.iloc[0:0]
    schedule_by_matchup = {
        (row.away_team_norm, row.home_team_norm): row._asdict() for row in schedule_current.itertuples(index=False)
    }
    qb_id_by_name: dict[str, str] = {}
    for row in schedule[schedule["season"].between(2016, 2025)].itertuples(index=False):
        for side in ["away", "home"]:
            name = getattr(row, f"{side}_qb_name")
            qb_id = getattr(row, f"{side}_qb_id")
            if not pd.isna(name) and not pd.isna(qb_id):
                qb_id_by_name[normalize_name(name)] = str(qb_id)

    roster_paths = sorted((root / "football-research/cache/nflverse/real-model-r1/weekly_rosters").glob("2025.parquet"))
    prior_rosters: dict[str, set[str]] = {}
    if roster_paths:
        roster_2025 = pq.read_table(roster_paths[0], columns=["team", "week", "full_name", "gsis_id"]).to_pandas()
        roster_2025["team"] = roster_2025["team"].map(normalize_team)
        for team, group in roster_2025.groupby("team"):
            latest = group[group["week"] == group["week"].max()]
            prior_rosters[str(team)] = {normalize_name(name) for name in latest["full_name"].dropna()}

    rows: list[dict[str, float]] = []
    identities: list[dict[str, Any]] = []
    context_by_game: dict[str, Any] = {}
    for game in provider["games"]:
        home_display, away_display = game["home"]["abbreviation"], game["away"]["abbreviation"]
        home, away = normalize_team(home_display), normalize_team(away_display)
        home_state, away_state = team_states[home], team_states[away]
        schedule_row = schedule_by_matchup.get((away, home), {})
        row: dict[str, float] = {feature: math.nan for feature in artifact["featureNames"]}
        row.update({
            "week": float(args.week),
            "neutral_site": float(str(schedule_row.get("location", "")) == "Neutral"),
            "division_game": float(schedule_row.get("div_game") or 0.0),
            "home_rest": float(schedule_row.get("home_rest") or 7.0),
            "away_rest": float(schedule_row.get("away_rest") or 7.0),
            "temperature": float(schedule_row["temp"]) if pd.notna(schedule_row.get("temp")) else math.nan,
            "wind": float(schedule_row["wind"]) if pd.notna(schedule_row.get("wind")) else math.nan,
            "roof_indoor": float(str(schedule_row.get("roof", "")).lower() in {"closed", "dome"}),
            "surface_grass": float("grass" in str(schedule_row.get("surface", "")).lower()),
            "home_elo": 1500.0 + OFFSEASON_CARRY * (float(home_state["elo"]) - 1500.0),
            "away_elo": 1500.0 + OFFSEASON_CARRY * (float(away_state["elo"]) - 1500.0),
            "home_games_state": float(home_state["games"]),
            "away_games_state": float(away_state["games"]),
        })
        row["rest_diff"] = row["home_rest"] - row["away_rest"]
        row["elo_diff"] = row["home_elo"] - row["away_elo"]
        bucket_keys = {
            "off_fast": "offFast", "off_slow": "offSlow", "def_fast": "defFast", "def_slow": "defSlow",
            "off_adj": "offAdjusted", "def_adj": "defAdjusted",
        }
        for metric, prior in PRIORS.items():
            for side, state in [("home", home_state), ("away", away_state)]:
                for bucket, state_key in bucket_keys.items():
                    feature = f"{side}_{bucket}_{metric}"
                    row[feature] = regress(float(state[state_key][metric]), prior)
            for pace in ["fast", "slow"]:
                row[f"home_matchup_{pace}_{metric}"] = row[f"home_off_{pace}_{metric}"] - (row[f"away_def_{pace}_{metric}"] - prior)
                row[f"away_matchup_{pace}_{metric}"] = row[f"away_off_{pace}_{metric}"] - (row[f"home_def_{pace}_{metric}"] - prior)

        for side, display, team, state in [("home", home_display, home, home_state), ("away", away_display, away, away_state)]:
            report = injury_summary(inputs["availability"].get(f"nfl-{game['providerGameId']}", {}), display)
            for key, value in report.items():
                row[f"{side}_{key}"] = value
            current_names = {normalize_name(item.get("player_name")) for item in inputs["rosters"].get(display, []) if item.get("player_name")}
            prior_names = prior_rosters.get(team, set())
            row[f"{side}_roster_continuity"] = len(current_names & prior_names) / max(1, len(current_names | prior_names))
            qb_rows = [item for item in inputs["rosters"].get(display, []) if str(item.get("position", "")).upper() == "QB"]
            qb_rows.sort(key=lambda item: float(item.get("depth") or 999))
            starter_name = str(qb_rows[0].get("player_name")) if qb_rows else ""
            qb_id = qb_id_by_name.get(normalize_name(starter_name))
            qb = qb_states.get(qb_id or "", {})
            row[f"{side}_qb_epa"] = float(qb.get("epa", 0.0))
            row[f"{side}_qb_cpoe"] = float(qb.get("cpoe", 0.0))
            row[f"{side}_qb_sack_rate"] = float(qb.get("sackRate", PRIORS["sack_rate"]))
            row[f"{side}_qb_turnover_rate"] = float(qb.get("turnoverRate", PRIORS["turnover_rate"]))
            row[f"{side}_qb_log_dropbacks"] = math.log1p(float(qb.get("dropbacks", 0.0)))
            row[f"{side}_qb_same_as_last_start"] = float(qb_id is not None and state.get("lastQbId") == qb_id)
            coach = str(schedule_row.get(f"{side}_coach") or "").strip()
            row[f"{side}_coach_continuity"] = float(bool(coach) and coach == state.get("lastCoach"))
            context_by_game.setdefault(game["providerGameId"], {})[f"{side}StartingQuarterback"] = starter_name or None
            context_by_game[game["providerGameId"]][f"{side}QuarterbackHistoryMatched"] = qb_id is not None
            context_by_game[game["providerGameId"]][f"{side}RosterContinuity"] = row[f"{side}_roster_continuity"]
            context_by_game[game["providerGameId"]][f"{side}TeamContext"] = {
                "opponentAdjustedOffenseEpaPerPlay": row[f"{side}_off_adj_epa"],
                "opponentAdjustedDefenseEpaAllowedPerPlay": row[f"{side}_def_adj_epa"],
                "opponentAdjustedSuccessRate": row[f"{side}_off_adj_success"],
                "opponentAdjustedExplosivePlayRate": row[f"{side}_off_adj_explosive_rate"],
                "estimatedPlays": row[f"{side}_off_adj_plays"],
                "quarterbackEpaPerDropback": row[f"{side}_qb_epa"],
                "injuryBurden": row[f"{side}_injury_weight"],
            }
        rows.append(row)
        identities.append({
            "providerGameId": game["providerGameId"], "scheduledStart": game["scheduledStart"],
            "home": home_display, "away": away_display,
        })

    feature_frame = pd.DataFrame(rows)[artifact["featureNames"]]
    margin_independent = predict_recipe(artifact["margin"], feature_frame)
    total_independent = predict_recipe(artifact["total"], feature_frame)
    projections: dict[str, Any] = {}
    bandwidth = float(artifact["kernelBandwidthPoints"])
    for index, identity in enumerate(identities):
        game_id = identity["providerGameId"]
        odds = provider["currentOddsByGame"][game_id]
        if not odds.get("moneyline") or not odds.get("spread") or not odds.get("total"):
            raise RuntimeError(f"incomplete paired regular odds for {game_id}")
        market_margin = -float(odds["spread"]["homeLine"])
        market_total = float(odds["total"]["line"])
        margin_weight = float(artifact["margin"]["marketRecipe"]["independentWeight"])
        total_weight = float(artifact["total"]["marketRecipe"]["independentWeight"])
        final_margin = market_margin + margin_weight * (float(margin_independent[index]) - market_margin)
        final_total = market_total + total_weight * (float(total_independent[index]) - market_total)
        raw_home_win = empirical_probability(final_margin, 0.0, np.asarray(artifact["margin"]["residuals"]), bandwidth)
        raw_home_cover = empirical_probability(final_margin, market_margin, np.asarray(artifact["margin"]["residuals"]), bandwidth)
        raw_over = empirical_probability(final_total, market_total, np.asarray(artifact["total"]["residuals"]), bandwidth)
        home_win = float(artifact["calibrators"]["moneyline"].predict(np.array([raw_home_win]))[0])
        home_cover = float(artifact["calibrators"]["spread"].predict(np.array([raw_home_cover]))[0])
        over = float(artifact["calibrators"]["total"].predict(np.array([raw_over]))[0])
        home_score = (final_total + final_margin) / 2.0
        away_score = final_total - home_score
        projections[game_id] = {
            **identity,
            **context_by_game[game_id],
            "generatedAt": provider["fetchedAt"],
            "independentProjectedHomeMargin": float(margin_independent[index]),
            "independentProjectedTotal": float(total_independent[index]),
            "projectedHomeMargin": final_margin,
            "projectedTotal": final_total,
            "projectedHomeScore": home_score,
            "projectedAwayScore": away_score,
            "homeWinProbability": home_win,
            "homeCoverProbability": home_cover,
            "overProbability": over,
            "marginStdDev": float(np.std(artifact["margin"]["residuals"], ddof=1)),
            "totalStdDev": float(np.std(artifact["total"]["residuals"], ddof=1)),
            "market": {
                "sportsbook": odds["sportsbook"], "homeMarginLine": market_margin, "totalLine": market_total,
                "fairHomeWinProbability": american_fair(float(odds["moneyline"]["homePrice"]), float(odds["moneyline"]["awayPrice"])),
            },
            "dataHealthFindings": [
                "2026_forward_validation_required",
                "r2_historical_holdout_did_not_beat_closing_market",
                *(
                    [
                        "regular_pipeline_preseason_rehearsal",
                        "preseason_quarterback_rotations_and_snap_plans_not_modeled",
                        "preseason_permanently_excluded_from_tracking",
                    ]
                    if args.phase == "preseason"
                    else ["injury_and_roster_snapshot_precedes_week_1_lock"]
                ),
            ],
            "actionable": False,
        }
    output = {
        "snapshotRelease": SNAPSHOT_RELEASE if args.phase == "regular" else PRESEASON_REHEARSAL_SNAPSHOT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "sourceTournamentModelRelease": SOURCE_MODEL_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": provider["fetchedAt"],
        "season": 2026,
        "week": args.week,
        "seasonPhase": args.phase,
        "productWeek": args.product_week if args.phase == "preseason" else None,
        "providerInputSha256": input_manifest["sha256"],
        "rosterInputSha256": roster_input_sha256,
        "modelArtifactSha256": model_manifest["modelArtifactSha256"],
        "stateArtifactSha256": state_manifest["stateFileSha256"],
        "projectionsByGame": projections,
        "localOnly": True,
        "actionable": False,
        "trackingEligible": False,
        "trackingPolicy": (
            "preseason_permanently_excluded"
            if args.phase == "preseason"
            else "regular_season_appends_to_existing_nfl_lifetime_only_after_launch_approval_and_locked_prediction"
        ),
    }
    output_path = input_manifest_path.parent / (
        f"nfl_regular_2026_week_{args.week}.scored.json"
        if args.phase == "regular"
        else f"nfl_preseason_2026_product_week_{args.product_week}.regular-rehearsal.scored.json"
    )
    output_path.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "snapshotRelease": output["snapshotRelease"], "modelRelease": MODEL_RELEASE,
        "seasonPhase": args.phase,
        "games": len(projections), "output": str(output_path), "sha256": sha256_file(output_path),
        "quarterbacksMatched": sum(int(row.get("homeQuarterbackHistoryMatched", False)) + int(row.get("awayQuarterbackHistoryMatched", False)) for row in projections.values()),
    }, indent=2))


if __name__ == "__main__":
    main()
