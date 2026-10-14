#!/usr/bin/env python3
"""Build the target-book-excluded CFB final-winner coordinator artifact.

The coordinator is downstream of the released independent score and complete
market reader.  It is allowed to arbitrate winner direction only when the
smooth combined probability naturally crosses 50%; the existing Total stays
unchanged and the score PMF is reconciled by the TypeScript runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from audit_cfb_2026_final_reader_residuals import MONEYLINE_MARKET, logistic
from audit_cfb_2026_independent_model_defects import ENHANCED_MARGIN_CORE, RECENT_MARGIN
from tournament_cfb_v1_model import build_dataset, normalized_name, read_sources


ARTIFACT_RELEASE = "cfb_final_winner_coordinator_artifact_2026_10_14_r2_correct_qb_target_excluded_smooth_net_accuracy"
MODEL_RELEASE = "cfb_final_winner_coordinator_2026_10_14_r2_correct_qb_target_excluded_smooth_net_accuracy"
FEATURES = [
    "reader_margin", "reader_margin_abs", "both_fbs",
    *ENHANCED_MARGIN_CORE, *RECENT_MARGIN, *MONEYLINE_MARKET,
]
ROLLING_KEYS = sorted({
    "margin", "epa_play", "true_success", "early_epa", "early_success",
    "pass_epa", "pass_success", "qb_epa", "qb_success", "rush_epa",
    "rush_success", "line_yards", "stuff_rate", "opportunity_rate",
    "explosive", "red_zone_success", "third_success", "drives",
    "yards_drive", "field_position", "pace",
})
RECENT_KEYS = sorted({
    "margin", "epa_play", "true_success", "pass_epa", "rush_epa",
    "explosive", "early_epa", "red_zone_success", "third_success",
    "line_yards", "stuff_rate", "opportunity_rate", "qb_epa", "qb_success",
})


def finite_or_none(value: object) -> float | None:
    try:
        parsed = float(value)
        return parsed if np.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def model_payload(model: Any) -> dict[str, Any]:
    imputer = model.named_steps["imputer"]
    scaler = model.named_steps["scale"]
    classifier = model.named_steps["model"]
    statistics = [finite_or_none(value) for value in imputer.statistics_]
    if len(statistics) != len(FEATURES) or any(value is None for value in statistics):
        raise RuntimeError("CFB winner coordinator has an unsupported all-missing feature.")
    indicator = [int(value) for value in imputer.indicator_.features_]
    coefficients = [float(value) for value in classifier.coef_[0]]
    if len(coefficients) != len(scaler.mean_) or len(coefficients) != len(scaler.scale_):
        raise RuntimeError("CFB winner coordinator transformed feature shape is invalid.")
    return {
        "kind": "logistic_classifier",
        "inputFeatures": FEATURES,
        "imputerStatistics": statistics,
        "missingIndicatorFeatureIndexes": indicator,
        "scalerMean": [float(value) for value in scaler.mean_],
        "scalerScale": [float(value) for value in scaler.scale_],
        "coefficients": coefficients,
        "intercept": float(classifier.intercept_[0]),
    }


def profile_payload(source_dir: Path, season: int) -> tuple[dict[str, Any], dict[str, str]]:
    frames, checksums = read_sources(source_dir)
    schedules = frames["schedules"].copy()
    schedules["game_date"] = pd.to_datetime(schedules["game_date"], utc=True, format="mixed")
    teams = sorted({
        str(team)
        for column in ("home_team", "away_team")
        for team in schedules[column].dropna().tolist()
        if normalized_name(team)
    }, key=normalized_name)
    future = pd.DataFrame([{
        "game_id": 9_300_000 + index,
        "season": season,
        "week": 1,
        "season_type": 2,
        "game_date": f"{season}-08-25T12:00:00Z",
        "neutral_site": False,
        "conference_competition": False,
        "home_team": team,
        "away_team": team,
        "home_score": np.nan,
        "away_score": np.nan,
        "home_team_spread": np.nan,
        "over_under": np.nan,
        "odds_source": "none",
    } for index, team in enumerate(teams)])
    generated = build_dataset(
        frames,
        future,
        current_season_prior_games=4.0,
        include_opponent_adjusted_matchups=True,
    )
    generated = generated[generated.season.eq(season) & generated.home_score.isna()].copy()
    if len(generated) != len(teams):
        raise RuntimeError(f"CFB winner profile generation produced {len(generated)}/{len(teams)} rows.")
    last_played: dict[str, str] = {}
    for row in schedules.sort_values(["game_date", "game_id"]).to_dict("records"):
        timestamp = pd.Timestamp(row["game_date"]).isoformat().replace("+00:00", "Z")
        last_played[normalized_name(row["home_team"])] = timestamp
        last_played[normalized_name(row["away_team"])] = timestamp
    profiles: dict[str, Any] = {}
    for row in generated.to_dict("records"):
        name = normalized_name(row["home_team"])
        rolling = {key: finite_or_none(row.get(f"home_{key}")) for key in ROLLING_KEYS}
        defense: dict[str, float | None] = {}
        for key in ROLLING_KEYS:
            matchup_sum = finite_or_none(row.get(f"matchup_{key}_sum"))
            attack = rolling[key]
            defense[key] = None if matchup_sum is None or attack is None else matchup_sum / 2.0 - attack
        recent = {key: finite_or_none(row.get(f"recent3_{key}_sum")) for key in RECENT_KEYS}
        personnel: dict[str, float | None] = {}
        for key in ("roster_continuity", "roster_experience", "returning_qb"):
            total = finite_or_none(row.get(f"{key}_sum"))
            personnel[key] = None if total is None else total / 2.0
        elo_sum = finite_or_none(row.get("elo_sum_strength"))
        profiles[name] = {
            "displayName": str(row["home_team"]),
            "elo": 1500.0 + (elo_sum or 0.0) / 2.0,
            "lastPlayedAt": last_played.get(name),
            "priorGames": int(float(row.get("home_prior_games") or 0)),
            "rolling": rolling,
            "defenseRolling": defense,
            "recentRolling": recent,
            "qbEpaVolume": finite_or_none(row.get("qb_epa_volume_sum")) / 2.0
                if finite_or_none(row.get("qb_epa_volume_sum")) is not None else None,
            "personnel": personnel,
        }
    return profiles, {Path(path).name: value for path, value in checksums.items()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True)
    parser.add_argument("--historical-source-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--validation-output")
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()
    cache_path = Path(args.cache)
    frame = pd.read_parquet(cache_path).replace([np.inf, -np.inf], np.nan)
    frame = frame[frame.week.isin([3, 4, 5, 6])].copy()
    for column in [name for name in frame.columns if name.endswith("_side")]:
        frame[column] = frame[column].map({"first": -1.0, "second": 1.0})
    frame["both_fbs"] = frame.lock_both_fbs.fillna(0).astype(float)
    frame["reader_margin"] = frame.current_margin.astype(float)
    frame["reader_margin_abs"] = frame.reader_margin.abs()
    fitted_model = logistic(0.01)
    fitted_model.fit(frame[FEATURES], (frame.actual_margin > 0).astype(int))
    profiles, source_checksums = profile_payload(Path(args.historical_source_dir), args.season)
    artifact = {
        "artifactRelease": ARTIFACT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "generatedAt": "2026-10-14T00:00:00.000Z",
        "season": args.season,
        "training": {
            "games": len(frame),
            "weeks": [3, 4, 5, 6],
            "targetBookExcluded": True,
            "sameGameOutcomeLeakage": False,
            "cacheSha256": sha256(cache_path),
            "historicalChecksums": source_checksums,
        },
        "policy": {
            "maximumAuthority": 0.75,
            "confidenceCenter": 0.15,
            "confidenceWidth": 0.1,
            "readerMarginDecayScale": 5.0,
            "probabilityMarginScale": 7.0,
            "maximumAbsoluteMargin": 14.0,
            "applyOnlyOnWinnerBoundaryCross": True,
        },
        "rollingKeys": ROLLING_KEYS,
        "recentKeys": RECENT_KEYS,
        "model": model_payload(fitted_model),
        "teamProfiles": profiles,
    }
    output = Path(args.output)
    output.write_text(json.dumps(artifact, separators=(",", ":"), sort_keys=True) + "\n")
    validation_path = Path(args.validation_output) if args.validation_output else None
    if validation_path:
        learned = fitted_model.predict_proba(frame[FEATURES])[:, 1]
        baseline = 1.0 / (1.0 + np.exp(-np.clip(frame.reader_margin.to_numpy(float) / 7.0, -35.0, 35.0)))
        confidence = 2.0 * np.abs(learned - 0.5)
        authority = 0.75 * (1.0 / (1.0 + np.exp(-np.clip((confidence - 0.15) / 0.1, -35.0, 35.0)))) * np.exp(-((np.abs(frame.reader_margin.to_numpy(float)) / 5.0) ** 2))
        combined = np.clip(baseline + authority * (learned - baseline), 0.001, 0.999)
        crosses = (combined > 0.5) != (baseline > 0.5)
        rows = []
        for index, (_, row) in enumerate(frame.iterrows()):
            rows.append({
                "gameId": str(row.lock_game_id),
                "readerMargin": float(row.reader_margin),
                "features": {
                    feature: finite_or_none(row.get(feature))
                    for feature in FEATURES
                    if feature not in {"reader_margin", "reader_margin_abs"}
                },
                "expected": {
                    "baseline": float(baseline[index]),
                    "learned": float(learned[index]),
                    "authority": float(authority[index]),
                    "combined": float(combined[index]),
                    "crosses": bool(crosses[index]),
                    "targetMargin": float(np.clip(7.0 * np.log(combined[index] / (1.0 - combined[index])), -14.0, 14.0)) if crosses[index] else None,
                },
            })
        validation_path.write_text(json.dumps({"rows": rows}, separators=(",", ":")) + "\n")
    print(json.dumps({
        "artifactRelease": ARTIFACT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "trainingGames": len(frame),
        "features": len(FEATURES),
        "profiles": len(profiles),
        "bytes": output.stat().st_size,
        "sha256": sha256(output),
        "output": str(output),
        "validationOutput": str(validation_path) if validation_path else None,
    }, indent=2))


if __name__ == "__main__":
    main()
