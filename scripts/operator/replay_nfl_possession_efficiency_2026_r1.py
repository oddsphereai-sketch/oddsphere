#!/usr/bin/env python3
"""Replay the frozen r3 possession-efficiency recipe on 2026 Weeks 1-2."""

from __future__ import annotations

import copy
import json
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd

import tournament_nfl_possession_efficiency_engine_r3 as r3
import tournament_nfl_weekly_joint_score_engine_r1 as r1
from tournament_nfl_market_context_residual_r1 import add_market_context, sha256_file


REPLAY_RELEASE = "nfl_possession_efficiency_2026_forward_replay_2026_09_25_r1"
STATE_ALPHA = 0.16
OFFSEASON_CARRY = 0.65
PRIORS = {
    "points": 22.5,
    "plays": 64.0,
    "sack_rate": 0.070,
    "turnover_rate": 0.022,
    "redzone_td_rate": 0.55,
}
RECIPE = r3.Recipe(
    state_style="slow",
    offense_weight=0.75,
    pace_strength=1.0,
    efficiency_strength=0.5,
    home_field_points=2.0,
    margin_market_weight=0.9,
    total_market_weight=0.9,
)


def ewm(previous: float, observed: float) -> float:
    return STATE_ALPHA * observed + (1.0 - STATE_ALPHA) * previous


def normalize_team(value: str) -> str:
    return {"LAR": "LA", "WSH": "WAS"}.get(value.upper(), value.upper())


def load_state(root: pathlib.Path) -> dict[str, Any]:
    manifest = json.loads((root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json").read_text())
    path = pathlib.Path(manifest["stateFile"])
    if sha256_file(path) != manifest["stateFileSha256"]:
        raise RuntimeError("post-2025 state checksum mismatch")
    artifact = json.loads(path.read_text())
    state = copy.deepcopy(artifact["teamStates"])
    for team in state.values():
        for bucket in ("offSlow", "defSlow"):
            for metric, prior in PRIORS.items():
                team[bucket][metric] = prior + OFFSEASON_CARRY * (float(team[bucket][metric]) - prior)
    return state


def row_for_game(game: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    home = normalize_team(game["homeTeam"])
    away = normalize_team(game["awayTeam"])
    if home not in state or away not in state:
        raise RuntimeError(f"missing post-2025 state for {away}@{home}")
    row = {
        "game_id": str(game["providerGameId"]),
        "season": 2026,
        "week": int(game["week"]),
        "home_team": home,
        "away_team": away,
        "home_score": float(game["homeScore"]),
        "away_score": float(game["awayScore"]),
        "actual_margin": float(game["homeScore"] - game["awayScore"]),
        "actual_total": float(game["homeScore"] + game["awayScore"]),
        "market_home_margin": float(game["marketHomeMargin"]),
        "market_total": float(game["marketTotal"]),
        "home_moneyline": float(game["homeMoneyline"]),
        "away_moneyline": float(game["awayMoneyline"]),
        "home_spread_odds": float(game["homeSpreadOdds"]),
        "away_spread_odds": float(game["awaySpreadOdds"]),
        "over_odds": float(game["overOdds"]),
        "under_odds": float(game["underOdds"]),
        "roof_indoor": 0.0,
        "wind": 0.0,
        "published_home": float(game["publishedExpectedHomeScore"]),
        "published_away": float(game["publishedExpectedAwayScore"]),
    }
    for side, team in (("home", home), ("away", away)):
        for unit in ("off", "def"):
            bucket = state[team]["offSlow" if unit == "off" else "defSlow"]
            for metric in PRIORS:
                row[f"{side}_{unit}_slow_{metric}"] = float(bucket[metric])
    return row


def update_state(state: dict[str, Any], team_stats: list[dict[str, Any]]) -> None:
    observations: dict[str, dict[str, float]] = {}
    for raw in team_stats:
        team = normalize_team(raw["team"])
        plays = max(1.0, float(raw["totalOffensivePlays"]))
        dropbacks = max(1.0, float(raw["passingAttempts"] + raw["sacksAllowed"]))
        redzone_attempts = float(raw["redZoneAttempts"])
        observations[team] = {
            "points": float(raw["pointsFor"]),
            "plays": plays,
            "sack_rate": float(raw["sacksAllowed"]) / dropbacks,
            "turnover_rate": float(raw["turnovers"]) / plays,
            "redzone_td_rate": (
                float(raw["redZoneScores"]) / redzone_attempts
                if redzone_attempts > 0 else PRIORS["redzone_td_rate"]
            ),
            "opponent": normalize_team(raw["opponent"]),
        }
    for team, observed in observations.items():
        opponent = observed.pop("opponent")
        opponent_observed = observations.get(opponent)
        if opponent_observed is None:
            raise RuntimeError(f"missing opponent team stat for {team}-{opponent}")
        for metric in PRIORS:
            state[team]["offSlow"][metric] = ewm(float(state[team]["offSlow"][metric]), observed[metric])
            state[team]["defSlow"][metric] = ewm(float(state[team]["defSlow"][metric]), opponent_observed[metric])


def published_scores(frame: pd.DataFrame) -> dict[str, np.ndarray]:
    home = frame["published_home"].to_numpy(float)
    away = frame["published_away"].to_numpy(float)
    return {"home": home, "away": away, "margin": home - away, "total": home + away}


def main() -> None:
    root = pathlib.Path.cwd()
    input_path = root / "football-research/reports/nfl_2026_score_engine_replay_inputs_2026_09_25_r1.json"
    source = json.loads(input_path.read_text())
    state = load_state(root)
    team_stats = source["state"]["teamStats"]
    game_rows: list[dict[str, Any]] = []
    for week in (1, 2):
        week_games = [game for game in source["games"] if int(game["week"]) == week]
        if len(week_games) != 16:
            raise RuntimeError(f"expected 16 games for Week {week}, received {len(week_games)}")
        game_rows.extend(row_for_game(game, state) for game in week_games)
        week_stats = [row for row in team_stats if int(row["week"]) == week]
        if len(week_stats) != 32:
            raise RuntimeError(f"expected 32 team stats for Week {week}, received {len(week_stats)}")
        update_state(state, week_stats)
    frame = add_market_context(pd.DataFrame(game_rows).sort_values(["week", "game_id"]).reset_index(drop=True))
    independent = r3.independent_scores(frame, RECIPE)
    candidate = r3.calibrated_scores(frame, independent, RECIPE)
    published = published_scores(frame)
    historical_report = json.loads((root / "football-research/reports/nfl_possession_efficiency_score_engine_tournament_2026_09_25_r3.json").read_text())
    margin_sigma = float(historical_report["residualScale"]["margin"])
    total_sigma = float(historical_report["residualScale"]["total"])
    candidate_probability = r1.probability_report(frame, candidate, margin_sigma, total_sigma)
    result = {
        "replayRelease": REPLAY_RELEASE,
        "sourceRelease": source["release"],
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "readOnly": True,
        "productionChanged": False,
        "recipe": r3.asdict(RECIPE),
        "games": len(frame),
        "candidateIndependent": r1.score_metrics(frame, independent),
        "candidateCalibrated": r1.score_metrics(frame, candidate),
        "published": r1.score_metrics(frame, published),
        "candidateProbability": candidate_probability,
        "gamePredictions": [
            {
                "gameId": str(frame.iloc[index]["game_id"]),
                "candidateHome": float(candidate["home"][index]),
                "candidateAway": float(candidate["away"][index]),
            }
            for index in range(len(frame))
        ],
        "byWeek": {
            str(week): {
                "candidate": r1.score_metrics(
                    frame[frame["week"].eq(week)].reset_index(drop=True),
                    {key: value[frame["week"].eq(week).to_numpy()] for key, value in candidate.items()},
                ),
                "published": r1.score_metrics(
                    frame[frame["week"].eq(week)].reset_index(drop=True),
                    {key: value[frame["week"].eq(week).to_numpy()] for key, value in published.items()},
                ),
            }
            for week in (1, 2)
        },
    }
    output_path = root / "football-research/reports" / f"{REPLAY_RELEASE}.json"
    output_path.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"report": str(output_path), **result}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
