#!/usr/bin/env python3
"""Export portable pre-2026 CFB team state for the qualified v1 score head.

The artifact contains no market inputs. It derives every profile through the
same leakage-safe build_dataset path used to qualify and refit CFB v1.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from tournament_cfb_v1_model import (
    ROLLING_KEYS,
    build_dataset,
    normalized_name,
    read_sources,
)


ARTIFACT_RELEASE = "cfb_v1_joint_score_artifact_2026_08_25_r3_weekly"
BASE_ARTIFACT_RELEASE = "cfb_v1_joint_score_artifact_2026_08_25_r2"
MODEL_RELEASE = "cfb_v1_independent_score_model_2026_08_25_r1"


def checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def finite_or_none(value: object) -> float | None:
    try:
        parsed = float(value)
        return parsed if np.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="football-research/cache/cfb-model/source")
    parser.add_argument("--base-artifact", default="lib/services/football/modelArtifacts/cfbV1JointScoreArtifact.json")
    parser.add_argument("--output", default="lib/services/football/modelArtifacts/cfbV1WeeklyRuntimeArtifact.json")
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()

    source_dir = Path(args.source_dir)
    base_path = Path(args.base_artifact)
    base = json.loads(base_path.read_text())
    if base.get("artifactRelease") != BASE_ARTIFACT_RELEASE or base.get("modelRelease") != MODEL_RELEASE:
        raise RuntimeError("Weekly runtime requires the qualified CFB v1 r2 base artifact")

    frames, source_checksums = read_sources(source_dir)
    schedules = frames["schedules"].copy()
    schedules["game_date"] = pd.to_datetime(schedules["game_date"], utc=True)
    teams = sorted(
        {
            str(team)
            for column in ("home_team", "away_team")
            for team in schedules[column].dropna().tolist()
            if normalized_name(team)
        },
        key=normalized_name,
    )
    if len(teams) < 180:
        raise RuntimeError(f"Expected broad FBS/FCS team coverage, found only {len(teams)} teams")

    # A no-result self-match exposes each team's frozen pre-season rolling and
    # Elo state without changing it. The same-team construction lets us recover
    # the per-team values from the already-qualified feature builder.
    future = pd.DataFrame(
        [
            {
                "game_id": 9_000_000 + index,
                "season": args.season,
                "week": 1,
                "season_type": 2,
                "game_date": "2026-08-25T12:00:00Z",
                "neutral_site": False,
                "conference_competition": False,
                "home_team": team,
                "away_team": team,
                "home_score": np.nan,
                "away_score": np.nan,
                "home_team_spread": np.nan,
                "over_under": np.nan,
                "odds_source": "none",
            }
            for index, team in enumerate(teams)
        ]
    )
    data = build_dataset(frames, future).replace([np.inf, -np.inf], np.nan)
    generated = data[data["season"].eq(args.season) & data["home_score"].isna()].copy()
    if len(generated) != len(teams):
        raise RuntimeError(f"Portable profile generation produced {len(generated)}/{len(teams)} rows")

    last_played: dict[str, str] = {}
    for row in schedules.sort_values(["game_date", "game_id"]).to_dict("records"):
        date = pd.Timestamp(row["game_date"]).isoformat().replace("+00:00", "Z")
        last_played[normalized_name(row["home_team"])] = date
        last_played[normalized_name(row["away_team"])] = date

    profiles: dict[str, dict] = {}
    for row in generated.to_dict("records"):
        name = normalized_name(row["home_team"])
        rolling = {key: finite_or_none(row.get(f"home_{key}")) for key in ROLLING_KEYS}
        personnel = {
            key: finite_or_none(row.get(f"{key}_sum")) / 2
            if finite_or_none(row.get(f"{key}_sum")) is not None
            else None
            for key in ("roster_continuity", "roster_experience", "returning_qb")
        }
        elo_sum = finite_or_none(row.get("elo_sum_strength"))
        profiles[name] = {
            "displayName": str(row["home_team"]),
            "elo": 1500.0 + (elo_sum or 0.0) / 2.0,
            "lastPlayedAt": last_played.get(name),
            "priorGames": int(float(row.get("home_prior_games") or 0)),
            "rolling": rolling,
            "personnel": personnel,
        }

    payload = {
        "artifactRelease": ARTIFACT_RELEASE,
        "baseArtifactRelease": BASE_ARTIFACT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "season": args.season,
        "generatedAt": "2026-08-25T12:00:00.000Z",
        "featureStateMethod": "qualified_build_dataset_self_match_projection",
        "source": {
            "baseArtifactSha256": checksum(base_path),
            "historicalChecksums": {Path(path).name: value for path, value in source_checksums.items()},
        },
        "globalMeans": {
            **{key: 0.0 for key in ROLLING_KEYS},
            "points_for": 28.0,
            "points_against": 28.0,
            "margin": 0.0,
            "total": 56.0,
            "pace": 68.0,
            "drives": 12.0,
        },
        "teamProfiles": profiles,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n"
    output.write_text(serialized)
    print(json.dumps({
        "output": str(output),
        "sha256": hashlib.sha256(serialized.encode()).hexdigest(),
        "teams": len(profiles),
        "sourceFiles": len(source_checksums),
    }, indent=2))


if __name__ == "__main__":
    main()
