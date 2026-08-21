#!/usr/bin/env python3
"""Score the real current NFL preseason slate with the frozen preseason model."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import time
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy.stats import norm


MODEL_RELEASE = "nfl_preseason_real_local_candidate_2026_08_19_r2"
FEATURE_RELEASE = "nfl_preseason_prior_regular_state_features_2026_08_19_r1"
SNAPSHOT_RELEASE = "nfl_preseason_real_current_snapshot_2026_08_19_r2"
STATE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
OFFSEASON_CARRY = 0.65

PRIORS = {
    "epa": 0.0, "pass_epa": 0.0, "rush_epa": 0.0, "success": 0.43,
    "early_down_pass_epa": 0.0, "explosive_rate": 0.105, "sack_rate": 0.070,
    "turnover_rate": 0.022, "plays": 64.0, "redzone_td_rate": 0.55,
    "no_huddle_rate": 0.10, "pass_oe": 0.0, "points": 22.5,
}


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_team(value: str) -> str:
    team = value.upper()
    return {"LAR": "LA", "WSH": "WAS"}.get(team, team)


def probability(prediction: float, threshold: float, residuals: np.ndarray) -> float:
    return float(np.mean(norm.cdf((prediction + residuals - threshold) / 1.5)))


def american_fair(first: float, second: float) -> float:
    def implied(price: float) -> float:
        return 100.0 / (price + 100.0) if price > 0 else -price / (-price + 100.0)
    first_probability = implied(first)
    second_probability = implied(second)
    return first_probability / (first_probability + second_probability)


def regress(value: float, prior: float) -> float:
    return prior + OFFSEASON_CARRY * (value - prior)


def predict_recipe(target: dict[str, Any], frame: pd.DataFrame) -> np.ndarray:
    result = np.zeros(len(frame))
    for name, weight in target["components"]:
        result += float(weight) * np.asarray(target["models"][name].predict(frame), dtype=float)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--product-week", type=int, default=2)
    args = parser.parse_args()
    root = pathlib.Path.cwd()
    input_manifest_path = root / f"football-research/cache/nfl-model/current/nfl_preseason_2026_product_week_{args.product_week}.latest.json"
    input_manifest = json.loads(input_manifest_path.read_text(encoding="utf-8"))
    input_path = input_manifest_path.parent / input_manifest["filename"]
    if sha256_file(input_path) != input_manifest["sha256"]:
        raise RuntimeError("current preseason provider input checksum mismatch")
    provider = json.loads(input_path.read_text(encoding="utf-8"))["slate"]

    state_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    state_manifest = json.loads(state_manifest_path.read_text(encoding="utf-8"))
    if state_manifest.get("featureRelease") != STATE_RELEASE:
        raise RuntimeError("regular state release mismatch")
    state_path = pathlib.Path(state_manifest["stateFile"])
    if sha256_file(state_path) != state_manifest["stateFileSha256"]:
        raise RuntimeError("regular state checksum mismatch")
    states = json.loads(state_path.read_text(encoding="utf-8"))["teamStates"]

    artifact_path = root / "football-research/cache/nfl-model/nfl_preseason_real_local_candidate_2026_08_19_r2.joblib"
    artifact = joblib.load(artifact_path)
    if artifact.get("modelRelease") != MODEL_RELEASE or artifact.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("preseason model artifact release mismatch")

    teams = sorted({normalize_team(game[side]["abbreviation"]) for game in provider["games"] for side in ["home", "away"]})
    feature_rows: list[dict[str, float]] = []
    identities: list[dict[str, Any]] = []
    for game in provider["games"]:
        home_display = game["home"]["abbreviation"]
        away_display = game["away"]["abbreviation"]
        home = normalize_team(home_display)
        away = normalize_team(away_display)
        home_state = states[home]
        away_state = states[away]
        row: dict[str, float] = {
            "week": float(provider["providerWeek"]),
            "home_elo": 1500.0 + OFFSEASON_CARRY * (float(home_state["elo"]) - 1500.0),
            "away_elo": 1500.0 + OFFSEASON_CARRY * (float(away_state["elo"]) - 1500.0),
        }
        row["elo_diff"] = row["home_elo"] - row["away_elo"]
        bucket_keys = {
            "off_fast": "offFast", "off_slow": "offSlow", "def_fast": "defFast",
            "def_slow": "defSlow", "off_adj": "offAdjusted", "def_adj": "defAdjusted",
        }
        for metric, prior in PRIORS.items():
            for side, state in [("home", home_state), ("away", away_state)]:
                for bucket, state_key in bucket_keys.items():
                    row[f"{side}_{bucket}_{metric}"] = regress(float(state[state_key][metric]), prior)
            row[f"home_matchup_fast_{metric}"] = row[f"home_off_fast_{metric}"] - (row[f"away_def_fast_{metric}"] - prior)
            row[f"away_matchup_fast_{metric}"] = row[f"away_off_fast_{metric}"] - (row[f"home_def_fast_{metric}"] - prior)
            row[f"home_matchup_slow_{metric}"] = row[f"home_off_slow_{metric}"] - (row[f"away_def_slow_{metric}"] - prior)
            row[f"away_matchup_slow_{metric}"] = row[f"away_off_slow_{metric}"] - (row[f"home_def_slow_{metric}"] - prior)
        for team in teams:
            row[f"team_effect_{team}"] = float(home == team) - float(away == team)
        feature_rows.append(row)
        identities.append({
            "providerGameId": game["providerGameId"], "scheduledStart": game["scheduledStart"],
            "home": home_display, "away": away_display,
        })

    feature_frame = pd.DataFrame(feature_rows)
    for feature in artifact["featureNames"]:
        if feature not in feature_frame:
            feature_frame[feature] = 0.0 if feature.startswith("team_effect_") else math.nan
    feature_frame = feature_frame[artifact["featureNames"]]
    margin = predict_recipe(artifact["margin"], feature_frame)
    total = predict_recipe(artifact["total"], feature_frame)
    projections: dict[str, Any] = {}
    for index, identity in enumerate(identities):
        game_id = identity["providerGameId"]
        odds = provider["currentOddsByGame"][game_id]
        home_margin_line = -float(odds["spread"]["homeLine"]) if odds.get("spread") else math.nan
        total_line = float(odds["total"]["line"]) if odds.get("total") else math.nan
        home_win = probability(float(margin[index]), 0.0, artifact["margin"]["residuals"])
        home_cover = probability(float(margin[index]), home_margin_line, artifact["margin"]["residuals"]) if math.isfinite(home_margin_line) else None
        over = probability(float(total[index]), total_line, artifact["total"]["residuals"]) if math.isfinite(total_line) else None
        home_score = (float(total[index]) + float(margin[index])) / 2.0
        away_score = float(total[index]) - home_score
        projections[game_id] = {
            **identity,
            "generatedAt": provider["fetchedAt"],
            "projectedHomeMargin": float(margin[index]),
            "projectedTotal": float(total[index]),
            "projectedHomeScore": home_score,
            "projectedAwayScore": away_score,
            "homeWinProbability": home_win,
            "homeCoverProbability": home_cover,
            "overProbability": over,
            "marginStdDev": float(np.std(artifact["margin"]["residuals"], ddof=1)),
            "totalStdDev": float(np.std(artifact["total"]["residuals"], ddof=1)),
            "market": {
                "sportsbook": odds["sportsbook"],
                "homeMarginLine": home_margin_line if math.isfinite(home_margin_line) else None,
                "totalLine": total_line if math.isfinite(total_line) else None,
                "fairHomeWinProbability": american_fair(float(odds["moneyline"]["homePrice"]), float(odds["moneyline"]["awayPrice"])) if odds.get("moneyline") else None,
            },
            "dataHealthFindings": [
                "preseason_margin_holdout_not_predictive",
                "historical_quarterback_rotation_unavailable",
                "preseason_market_value_not_backtested",
                "preseason_permanently_excluded_from_tracking",
            ],
            "actionable": False,
        }
    output = {
        "snapshotRelease": SNAPSHOT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": provider["fetchedAt"],
        "season": 2026,
        "productWeek": args.product_week,
        "providerWeek": provider["providerWeek"],
        "providerInputSha256": input_manifest["sha256"],
        "modelArtifactSha256": sha256_file(artifact_path),
        "stateArtifactSha256": state_manifest["stateFileSha256"],
        "distribution": {
            "kernelBandwidthPoints": 1.5,
            "marginResiduals": [float(value) for value in artifact["margin"]["residuals"]],
            "totalResiduals": [float(value) for value in artifact["total"]["residuals"]],
        },
        "projectionsByGame": projections,
        "localOnly": True,
        "actionable": False,
        "trackingEligible": False,
    }
    output_path = input_manifest_path.parent / f"nfl_preseason_2026_product_week_{args.product_week}.scored.json"
    output_path.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "snapshotRelease": SNAPSHOT_RELEASE,
        "games": len(projections),
        "modelRelease": MODEL_RELEASE,
        "output": str(output_path),
        "sha256": sha256_file(output_path),
    }, indent=2))


if __name__ == "__main__":
    main()
