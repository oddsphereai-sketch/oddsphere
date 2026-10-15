#!/usr/bin/env python3
"""Score frozen r1/r2 NFL challengers on leakage-safe completed 2026 games."""

from __future__ import annotations

import json
import pathlib
import time

import numpy as np
import pandas as pd

import tournament_nfl_dynamic_state_score_rebuild_r2 as r2
import tournament_nfl_independent_score_rebuild_r1 as r1
import tournament_nfl_provider_play_independent_r5 as r5


REPLAY_RELEASE = "nfl_independent_score_exact_2026_replay_2026_10_15_r2_provider_play"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2026_2026_10_15_r3_exact_replay"


def model_recipe(value: dict[str, object]) -> r1.Recipe:
    return r1.Recipe(
        feature_family=str(value["feature_family"]),
        name=str(value["name"]),
        components=tuple(str(component) for component in value["components"]),
    )


def correction_recipe(value: dict[str, object]) -> r2.CorrectionRecipe:
    model = value["modelRecipe"]
    if not isinstance(model, dict):
        raise RuntimeError("invalid residual model recipe")
    return r2.CorrectionRecipe(
        feature_family=str(value["featureFamily"]),
        model_recipe=model_recipe(model),
        weight=float(value["weight"]),
        cap=float(value["cap"]),
    )


def score_payload(frame: pd.DataFrame, margin: np.ndarray, total: np.ndarray) -> list[dict[str, object]]:
    home = (total + margin) / 2.0
    away = (total - margin) / 2.0
    return [
        {
            "gameId": str(game.game_id),
            "date": str(game.gameday),
            "home": str(game.home_team),
            "away": str(game.away_team),
            "expectedHomeScore": float(home[index]),
            "expectedAwayScore": float(away[index]),
        }
        for index, game in enumerate(frame.itertuples(index=False))
    ]


def main() -> None:
    root = pathlib.Path.cwd()
    feature_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2026_exact_replay_r1.manifest.json"
    feature_manifest = json.loads(feature_manifest_path.read_text(encoding="utf-8"))
    if feature_manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("exact replay feature release mismatch")
    feature_path = pathlib.Path(feature_manifest["featureFile"])
    if r1.sha256_file(feature_path) != feature_manifest.get("featureFileSha256"):
        raise RuntimeError("exact replay feature checksum mismatch")
    games = pd.read_parquet(feature_path).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    train = games[games["season"].le(2025)].reset_index(drop=True)
    replay = games[games["season"].eq(2026)].reset_index(drop=True)

    r1_result = json.loads((
        root / "football-research/reports/nfl-independent-score-rebuild-r1/tournament.json"
    ).read_text(encoding="utf-8"))
    r1_margin_recipe = model_recipe(r1_result["selected"]["margin"])
    r1_total_recipe = model_recipe(r1_result["selected"]["total"])
    direct_margin = r1.fit_predict_recipe(train, replay, "actual_margin", r1_margin_recipe)
    direct_total = r1.fit_predict_recipe(train, replay, "actual_total", r1_total_recipe)

    r5_result = json.loads((
        root / "football-research/reports/nfl-provider-play-independent-r5/tournament.json"
    ).read_text(encoding="utf-8"))
    provider_margin_value = r5_result["selected"]["margin"]
    provider_margin_recipe = r1.Recipe(
        feature_family=str(provider_margin_value["feature_family"]),
        name=str(provider_margin_value["name"]),
        components=tuple(str(component) for component in provider_margin_value["components"]),
    )
    provider_margin = r5.fit_predict(train, replay, "actual_margin", provider_margin_recipe)
    r7_result = json.loads((
        root / "football-research/reports/nfl-exact-provider-independent-r7/tournament.json"
    ).read_text(encoding="utf-8"))
    exact_provider_margin_value = r7_result["selected"]["margin"]
    exact_provider_margin_recipe = r1.Recipe(
        feature_family=str(exact_provider_margin_value["feature_family"]),
        name=str(exact_provider_margin_value["name"]),
        components=tuple(str(component) for component in exact_provider_margin_value["components"]),
    )
    original_metrics = r5.METRICS
    try:
        r5.METRICS = (
            "explosive_rate", "sack_rate", "turnover_rate", "plays",
            "redzone_td_rate", "no_huddle_rate", "points",
        )
        exact_provider_margin = r5.fit_predict(
            train, replay, "actual_margin", exact_provider_margin_recipe
        )
    finally:
        r5.METRICS = original_metrics

    r2_result = json.loads((
        root / "football-research/reports/nfl-dynamic-state-score-rebuild-r2/tournament.json"
    ).read_text(encoding="utf-8"))
    selected_state = r2_result["selected"]["state"]
    state_recipe = r2.StateRecipe(
        state_gain=float(selected_state["state_gain"]),
        offseason_carry=float(selected_state["offseason_carry"]),
        home_field_margin=float(selected_state["home_field_margin"]),
        league_gain=float(selected_state["league_gain"]),
    )
    state_scores = r2.dynamic_scores(games, state_recipe)
    train_mask = games["season"].le(2025).to_numpy()
    replay_mask = games["season"].eq(2026).to_numpy()
    train_base = r2.slice_scores(state_scores, train_mask)
    replay_base = r2.slice_scores(state_scores, replay_mask)
    state_margin = r2.apply_correction(
        train, replay, train_base, replay_base, "actual_margin", "margin",
        correction_recipe(r2_result["selected"]["marginCorrection"]),
    )
    state_total = r2.apply_correction(
        train, replay, train_base, replay_base, "actual_total", "total",
        correction_recipe(r2_result["selected"]["totalCorrection"]),
    )
    state_only_total = replay_base["total"]
    r10_result = json.loads((
        root / "football-research/reports/nfl-exact-provider-total-residual-r10/tournament.json"
    ).read_text(encoding="utf-8"))
    r10_total_by_game = {
        str(row["gameId"]): float(row["total"])
        for row in r10_result["exact2026Totals"]
    }
    exact_provider_total = np.asarray([
        r10_total_by_game[str(game.game_id)]
        for game in replay.itertuples(index=False)
    ], dtype=float)

    candidates = {
        "directR1": (direct_margin, direct_total),
        "dynamicStateR2": (state_margin, state_total),
        "hybridR3": (direct_margin, state_total),
        "providerPlayHybridR6": (provider_margin, state_total),
        "exactProviderHybridR8": (exact_provider_margin, state_total),
        "exactProviderStateTotalR9": (exact_provider_margin, state_only_total),
        "exactProviderTotalR10R11": (exact_provider_margin, exact_provider_total),
    }
    payload = {
        "replayRelease": REPLAY_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "featureRelease": FEATURE_RELEASE,
        "featureSha256": feature_manifest["featureFileSha256"],
        "trainingThrough": 2025,
        "games": len(replay),
        "candidates": {
            name: {
                "metricsAllCompleted2026": r1.score_report(replay, margin, total),
                "scores": score_payload(replay, margin, total),
            }
            for name, (margin, total) in candidates.items()
        },
        "restrictions": [
            "read-only research replay",
            "completed games only",
            "no production writer",
            "paid 32-game cohort evaluated separately against immutable locks",
        ],
    }
    output_root = root / "football-research/reports/nfl-independent-score-rebuild-2026-replay"
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "replay.json"
    output_path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "replayRelease": REPLAY_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "games": len(replay),
        "metricsAllCompleted2026": {
            name: candidate["metricsAllCompleted2026"]
            for name, candidate in payload["candidates"].items()
        },
        "output": str(output_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
