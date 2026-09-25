#!/usr/bin/env python3
"""Rich-matchup NFL spread/total outcome-head development replay."""

from __future__ import annotations

import json
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd

import tournament_nfl_runtime_parity_outcome_heads_r4 as r4
import tournament_nfl_weekly_joint_score_engine_r1 as r1
from tournament_nfl_market_context_residual_r1 import FEATURE_RELEASE, add_market_context, sha256_file


TOURNAMENT_RELEASE = "nfl_rich_matchup_outcome_heads_2026_09_25_r5"


def rich_game_frame(games: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    teams, team_features = r1.oriented_team_frame(games)
    home = teams[teams["side"].eq("home")].sort_values("game_row").reset_index(drop=True)
    away = teams[teams["side"].eq("away")].sort_values("game_row").reset_index(drop=True)
    if len(home) != len(games) or not np.array_equal(home["game_row"], away["game_row"]):
        raise RuntimeError("rich matchup game pairing failed")
    rows: dict[str, Any] = {
        "game_id": games["game_id"].astype(str).to_numpy(),
        "season": games["season"].astype(int).to_numpy(),
        "spread_target": (games["actual_margin"] > games["market_home_margin"]).astype(int).to_numpy(),
        "total_target": (games["actual_total"] > games["market_total"]).astype(int).to_numpy(),
        "spread_resolved": (games["actual_margin"] != games["market_home_margin"]).to_numpy(),
        "total_resolved": (games["actual_total"] != games["market_total"]).to_numpy(),
        "market_home_margin": games["market_home_margin"].to_numpy(float),
        "market_total": games["market_total"].to_numpy(float),
    }
    shared = {"week", "neutral_site", "division_game", "temperature", "wind", "roof_indoor", "surface_grass"}
    for feature in team_features:
        home_values = home[feature].to_numpy(float)
        away_values = away[feature].to_numpy(float)
        if feature in shared or feature == "home_indicator":
            rows[feature] = home_values
        else:
            rows[f"difference_{feature}"] = home_values - away_values
            rows[f"average_{feature}"] = 0.5 * (home_values + away_values)
    frame = pd.DataFrame(rows)
    features = sorted(column for column in frame.columns if column not in {
        "game_id", "season", "spread_target", "total_target", "spread_resolved", "total_resolved",
    })
    return frame, features


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if manifest.get("featureRelease") != FEATURE_RELEASE or sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature artifact mismatch")
    games = add_market_context(pd.read_parquet(feature_path)).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    frame, features = rich_game_frame(games)
    selected, rankings = r4.select(frame, features)
    residual_train = games[games["season"].between(2018, r4.SELECTION_SEASON)].reset_index(drop=True)
    margin_sigma = float(np.std(residual_train["actual_margin"] - residual_train["market_home_margin"], ddof=1))
    total_sigma = float(np.std(residual_train["actual_total"] - residual_train["market_total"], ddof=1))
    replay_games: list[pd.DataFrame] = []
    replay_frames: list[pd.DataFrame] = []
    spread_parts: list[np.ndarray] = []
    total_parts: list[np.ndarray] = []
    score_parts: dict[str, list[np.ndarray]] = {key: [] for key in ("home", "away", "margin", "total")}
    by_season: dict[str, Any] = {}
    for season in r4.DEVELOPMENT_SEASONS:
        test_frame, spread_probability, total_probability = r4.predict_season(frame, features, selected, season)
        test_games = games[games["season"].eq(season)].reset_index(drop=True)
        scores = r4.scores_from_probabilities(test_games, spread_probability, total_probability, margin_sigma, total_sigma)
        replay_games.append(test_games)
        replay_frames.append(test_frame)
        spread_parts.append(spread_probability)
        total_parts.append(total_probability)
        for key in score_parts:
            score_parts[key].append(scores[key])
        by_season[str(season)] = {
            "score": r1.score_metrics(test_games, scores),
            "spread": r4.head_metrics(spread_probability, test_frame["spread_target"].to_numpy(int), test_frame["spread_resolved"].to_numpy(bool)),
            "total": r4.head_metrics(total_probability, test_frame["total_target"].to_numpy(int), test_frame["total_resolved"].to_numpy(bool)),
        }
    replay = pd.concat(replay_games, ignore_index=True)
    replay_frame = pd.concat(replay_frames, ignore_index=True)
    scores = {key: np.concatenate(value) for key, value in score_parts.items()}
    spread = r4.head_metrics(np.concatenate(spread_parts), replay_frame["spread_target"].to_numpy(int), replay_frame["spread_resolved"].to_numpy(bool))
    total = r4.head_metrics(np.concatenate(total_parts), replay_frame["total_target"].to_numpy(int), replay_frame["total_resolved"].to_numpy(bool))
    score = r1.score_metrics(replay, scores)
    gates = {
        "teamScoreMaeImproves": score["teamScore"]["mae"] < score["market"]["teamScore"]["mae"],
        "marginMaeImproves": score["margin"]["mae"] < score["market"]["margin"]["mae"],
        "totalMaeImproves": score["total"]["mae"] < score["market"]["total"]["mae"],
        "moneylineAccuracyNonRegression": score["moneylineDirection"]["accuracy"] >= score["market"]["moneylineDirection"]["accuracy"],
        "spreadDirectionAtLeastHalf": spread["accuracy"] >= 0.5,
        "totalDirectionAtLeastHalf": total["accuracy"] >= 0.5,
        "bothSpreadDirections": spread["positive"] > 0 and spread["negative"] > 0,
        "bothTotalDirections": total["positive"] > 0 and total["negative"] > 0,
        "forwardPromotionEligible": False,
    }
    gates["developmentReplayPassed"] = all(value for key, value in gates.items() if key != "forwardPromotionEligible")
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "productionChanged": False,
        "promotionEligible": False,
        "featureCount": len(features),
        "selected": r4.recipe_json(selected),
        "selectionTopTen": [{"recipe": r4.recipe_json(row["recipe"]), "spread": row["spread"], "total": row["total"]} for row in rankings[:10]],
        "residualScale": {"margin": margin_sigma, "total": total_sigma},
        "developmentReplay": {"score": score, "spread": spread, "total": total, "bySeason": by_season, "gates": gates},
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "selected": report["selected"], "score": score, "spread": spread, "total": total, "bySeason": by_season, "gates": gates}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
