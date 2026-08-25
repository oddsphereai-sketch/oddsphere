#!/usr/bin/env python3
"""Refit the qualified CFB head and score the immutable current provider input."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from tournament_cfb_v1_model import (
    META_COLUMNS,
    build_dataset,
    model_families,
    nearest_football_scores,
    read_sources,
)


ARTIFACT_RELEASE = "cfb_v1_joint_score_artifact_2026_08_25_r2"
MODEL_RELEASE = "cfb_v1_independent_score_model_2026_08_25_r1"
DISTRIBUTION_RELEASE = "cfb_v1_empirical_joint_score_distribution_2026_08_25_r1"
PROBABILITY_RELEASE = "cfb_v1_joint_market_probability_2026_08_25_r1"
REPRESENTATIVE_SCORE_RELEASE = "cfb_v1_central_reachable_score_2026_08_25_r1"


def checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def future_frame(payload: dict) -> pd.DataFrame:
    rows = []
    for game in payload["games"]:
        current = game.get("current") or {}
        current_spread = (current.get("spread") or {}).get("homeLine")
        current_total = (current.get("total") or {}).get("line")
        playbook = game.get("playbookLine") or {}
        lines = playbook.get("lines") or {}
        spread = current_spread if current_spread is not None else (lines.get("spread") or {}).get("home")
        total = current_total if current_total is not None else lines.get("total")
        rows.append({
            "game_id": int(game["providerGameId"]),
            "season": int(game["season"]),
            "week": int(game["providerWeek"]),
            "season_type": 2,
            "game_date": game["scheduledStart"],
            "neutral_site": False,
            "conference_competition": False,
            "home_team": game["home"]["name"],
            "away_team": game["away"]["name"],
            "home_score": np.nan,
            "away_score": np.nan,
            "home_team_spread": spread,
            "over_under": total,
            "odds_source": "current_named_book_or_playbook_context",
        })
    return pd.DataFrame(rows)


def pipeline_artifact(pipeline, input_features: list[str]) -> dict:
    imputer = pipeline.named_steps["imputer"]
    scaler = pipeline.named_steps["scale"]
    model = pipeline.named_steps["model"]
    indicator = list(getattr(imputer.indicator_, "features_", [])) if getattr(imputer, "indicator_", None) is not None else []
    return {
        "inputFeatures": input_features,
        "imputerStatistics": [None if not np.isfinite(value) else float(value) for value in imputer.statistics_],
        "missingIndicatorFeatureIndexes": [int(value) for value in indicator],
        "scalerMean": [float(value) for value in scaler.mean_],
        "scalerScale": [float(value) for value in scaler.scale_],
        "coefficients": [float(value) for value in model.coef_],
        "intercept": float(model.intercept_),
    }


def compact_pmf(home: np.ndarray, away: np.ndarray) -> list[dict]:
    counts = Counter(zip(home.astype(int).tolist(), away.astype(int).tolist()))
    total = sum(counts.values())
    return [
        {"home": home_score, "away": away_score, "probability": count / total}
        for (home_score, away_score), count in sorted(counts.items())
    ]


def score_games(data: pd.DataFrame, future: pd.DataFrame, home_model, away_model, residuals: np.ndarray, features: list[str], seed: int) -> list[dict]:
    rng = np.random.default_rng(seed)
    output = []
    predictions_home = home_model.predict(future[features])
    predictions_away = away_model.predict(future[features])
    for index, (_, game) in enumerate(future.iterrows()):
        picks = rng.integers(0, len(residuals), 30_000)
        home = nearest_football_scores(np.clip(predictions_home[index] + residuals[picks, 0], 0, 90))
        away = nearest_football_scores(np.clip(predictions_away[index] + residuals[picks, 1], 0, 90))
        counts = Counter(zip(home.astype(int).tolist(), away.astype(int).tolist()))
        expected_home = float(home.mean())
        expected_away = float(away.mean())
        home_win_probability = float((home > away).mean() + 0.5 * (home == away).mean())
        expected_margin = float((home - away).mean())
        expected_total = float((home + away).mean())
        if home_win_probability > 0.5:
            candidates = [pair for pair in counts if pair[0] > pair[1]]
        elif home_win_probability < 0.5:
            candidates = [pair for pair in counts if pair[0] < pair[1]]
        else:
            candidates = list(counts)
        representative = min(
            candidates,
            key=lambda pair: (
                (pair[0] - expected_home) ** 2
                + (pair[1] - expected_away) ** 2
                + ((pair[0] - pair[1]) - expected_margin) ** 2
                + ((pair[0] + pair[1]) - expected_total) ** 2,
                -counts[pair],
            ),
        )
        output.append({
            "providerGameId": str(int(game.game_id)),
            "awayTeam": game.away_team,
            "homeTeam": game.home_team,
            "gameStartsAt": game.game_date,
            "expectedAwayPoints": expected_away,
            "expectedHomePoints": expected_home,
            "expectedMarginHome": expected_margin,
            "expectedTotal": expected_total,
            "homeWinProbability": home_win_probability,
            "representativeScore": {"away": int(representative[1]), "home": int(representative[0])},
            "interval80": {
                "away": [float(np.quantile(away, 0.10)), float(np.quantile(away, 0.90))],
                "home": [float(np.quantile(home, 0.10)), float(np.quantile(home, 0.90))],
                "marginHome": [float(np.quantile(home-away, 0.10)), float(np.quantile(home-away, 0.90))],
                "total": [float(np.quantile(home+away, 0.10)), float(np.quantile(home+away, 0.90))],
            },
            "pmf": compact_pmf(home, away),
        })
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="football-research/cache/cfb-model/source")
    parser.add_argument("--current-input", default="football-research/cache/cfb-model/current/cfb_current_inputs.json")
    parser.add_argument("--qualification", default="football-research/reports/cfb_v1_independent_joint_distribution_2026_08_25_r3.json")
    parser.add_argument("--artifact", default="lib/services/football/modelArtifacts/cfbV1JointScoreArtifact.json")
    parser.add_argument("--report", default="football-research/reports/cfb_v1_current_scoring_2026_08_25_r2.json")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()
    current_path = Path(args.current_input)
    qualification_path = Path(args.qualification)
    qualification = json.loads(qualification_path.read_text())
    if not qualification.get("promotable") or qualification.get("selectedFamily") != "elastic_net":
        raise RuntimeError("Current CFB artifact requires the qualified elastic-net r3 report")
    frames, source_checksums = read_sources(Path(args.source_dir))
    current = json.loads(current_path.read_text())
    future_games = future_frame(current)
    data = build_dataset(frames, future_games).replace([np.inf, -np.inf], np.nan)
    historical = data[data.home_score.notna() & data.away_score.notna()]
    future = data[data.season.eq(int(current["season"])) & data.home_score.isna()].copy()
    features = sorted(column for column in historical.columns if column not in META_COLUMNS)
    home_model = model_families(args.seed)["elastic_net"]
    away_model = model_families(args.seed + 1)["elastic_net"]
    home_model.fit(historical[features], historical.home_score)
    away_model.fit(historical[features], historical.away_score)
    residuals = np.column_stack([
        historical.home_score.to_numpy() - home_model.predict(historical[features]),
        historical.away_score.to_numpy() - away_model.predict(historical[features]),
    ])
    forecasts = score_games(data, future, home_model, away_model, residuals, features, args.seed)
    artifact = {
        "artifactRelease": ARTIFACT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "distributionRelease": DISTRIBUTION_RELEASE,
        "probabilityRelease": PROBABILITY_RELEASE,
        "representativeScoreRelease": REPRESENTATIVE_SCORE_RELEASE,
        "generatedAt": current["generatedAt"],
        "source": {
            "qualificationRelease": qualification["release"],
            "qualificationSha256": checksum(qualification_path),
            "currentInputRelease": current["release"],
            "currentInputSha256": checksum(current_path),
            "historicalChecksums": source_checksums,
        },
        "chronology": qualification["chronology"],
        "pipeline": {
            "home": pipeline_artifact(home_model, features),
            "away": pipeline_artifact(away_model, features),
        },
        "residualSample": [[float(a), float(b)] for a, b in residuals[::max(1, len(residuals)//1200)]],
        "forecasts": forecasts,
    }
    artifact_path = Path(args.artifact)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(artifact, separators=(",", ":"), sort_keys=True) + "\n"
    artifact_path.write_text(serialized)
    scores = np.array([[row["expectedAwayPoints"], row["expectedHomePoints"], row["expectedMarginHome"], row["expectedTotal"]] for row in forecasts])
    representative_metrics = []
    for row in forecasts:
        representative_home = row["representativeScore"]["home"]
        representative_away = row["representativeScore"]["away"]
        representative_metrics.append({
            "providerGameId": row["providerGameId"],
            "teamPointMaxDeviation": max(abs(representative_home - row["expectedHomePoints"]), abs(representative_away - row["expectedAwayPoints"])),
            "marginDeviation": abs((representative_home - representative_away) - row["expectedMarginHome"]),
            "totalDeviation": abs((representative_home + representative_away) - row["expectedTotal"]),
            "winnerFidelity": (representative_home > representative_away) == (row["homeWinProbability"] > 0.5) if row["homeWinProbability"] != 0.5 else True,
            "nonTieFidelity": representative_home != representative_away if row["homeWinProbability"] != 0.5 else True,
            "zeroPointViolation": (representative_home == 0 and row["expectedHomePoints"] >= 10) or (representative_away == 0 and row["expectedAwayPoints"] >= 10),
            "positivePmfMass": any(cell["home"] == representative_home and cell["away"] == representative_away and cell["probability"] > 0 for cell in row["pmf"]),
        })
    representative_gates = {
        "winnerFidelity": all(metric["winnerFidelity"] for metric in representative_metrics),
        "nonTieFidelity": all(metric["nonTieFidelity"] for metric in representative_metrics),
        "teamPointMaxDeviation": max(metric["teamPointMaxDeviation"] for metric in representative_metrics) <= 4,
        "marginMaxDeviation": max(metric["marginDeviation"] for metric in representative_metrics) <= 4,
        "totalMaxDeviation": max(metric["totalDeviation"] for metric in representative_metrics) <= 4,
        "zeroPointPlausibility": not any(metric["zeroPointViolation"] for metric in representative_metrics),
        "positivePmfMass": all(metric["positivePmfMass"] for metric in representative_metrics),
    }
    if not all(representative_gates.values()):
        raise RuntimeError(f"Representative score gates failed: {representative_gates}")
    report = {
        "release": "cfb_v1_current_scoring_2026_08_25_r2",
        "artifactRelease": ARTIFACT_RELEASE,
        "artifactSha256": hashlib.sha256(serialized.encode()).hexdigest(),
        "games": len(forecasts),
        "coverage": current["coverage"],
        "distribution": {
            "teamPointsMin": float(scores[:, :2].min()), "teamPointsMax": float(scores[:, :2].max()), "teamPointsSd": float(scores[:, :2].std()),
            "marginMin": float(scores[:, 2].min()), "marginMax": float(scores[:, 2].max()), "marginSd": float(scores[:, 2].std()),
            "totalMin": float(scores[:, 3].min()), "totalMax": float(scores[:, 3].max()), "totalSd": float(scores[:, 3].std()),
            "forecastOversAtCurrentContext": sum(row["expectedTotal"] > float(future_games.loc[future_games.game_id.eq(int(row["providerGameId"])), "over_under"].iloc[0]) for row in forecasts),
        },
        "representativeScore": {
            "release": REPRESENTATIVE_SCORE_RELEASE,
            "gates": representative_gates,
            "metrics": representative_metrics,
            "duplicatePairs": len(forecasts) - len({(row["representativeScore"]["away"], row["representativeScore"]["home"]) for row in forecasts}),
        },
        "forecasts": [{key: value for key, value in row.items() if key != "pmf"} for row in forecasts],
    }
    report_path = Path(args.report); report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"artifact": str(artifact_path), "report": str(report_path), **{key: report[key] for key in ("games", "coverage", "distribution")}}, indent=2))


if __name__ == "__main__":
    main()
