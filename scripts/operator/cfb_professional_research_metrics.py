#!/usr/bin/env python3
"""Shared, research-only metrics for the professional CFB tournaments."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from tournament_cfb_symmetric_matchup_score_r4 import (
    empirical_win_probability,
    finite_column,
    outcome_metrics,
)


def parse_candidate(value: str) -> tuple[str, str, float, str, float]:
    score_part, margin_part, total_part = value.split("::")
    score_family = score_part.split("=", 1)[1]
    margin_family, margin_weight = margin_part.split("=", 1)[1].split("@")
    total_family, total_weight = total_part.split("=", 1)[1].split("@")
    return score_family, margin_family, float(margin_weight), total_family, float(total_weight)


def selected_predictions(
    predictions: dict[str, dict[str, np.ndarray]], candidate: str
) -> tuple[np.ndarray, np.ndarray]:
    score_family, margin_family, margin_weight, total_family, total_weight = parse_candidate(candidate)
    shared = predictions[score_family]
    margin = (
        (1.0 - margin_weight) * shared["sharedMargin"]
        + margin_weight * predictions[margin_family]["directMargin"]
    )
    total = (
        (1.0 - total_weight) * shared["sharedTotal"]
        + total_weight * predictions[total_family]["directTotal"]
    )
    return margin, total


def detailed_metrics(
    frame: pd.DataFrame,
    margin: np.ndarray,
    total: np.ndarray,
    residual_sample: np.ndarray,
) -> dict[str, Any]:
    home = np.clip((total + margin) / 2.0, 0.0, 80.0)
    away = np.clip((total - margin) / 2.0, 0.0, 80.0)
    probability = empirical_win_probability(home, away, residual_sample)
    metrics = outcome_metrics(frame, home, away, probability)
    actual_total = finite_column(frame, "home_score") + finite_column(frame, "away_score")
    metrics["totalBias"] = float(np.mean(total - actual_total))
    metrics["totalDispersionError"] = abs(float(np.std(total)) - float(np.std(actual_total)))
    metrics["predictedTotalMean"] = float(np.mean(total))
    metrics["actualTotalMean"] = float(np.mean(actual_total))
    return metrics


def aggregate_total_metrics(values: list[dict[str, Any]]) -> dict[str, Any]:
    games = sum(int(value["games"]) for value in values)
    decided = sum(int(value["total"]["decided"]) for value in values)
    return {
        "games": games,
        "teamScoreMae": sum(value["teamScoreMae"] * value["games"] for value in values) / games,
        "totalMae": sum(value["totalMae"] * value["games"] for value in values) / games,
        "totalAccuracy": (
            sum(value["total"]["accuracy"] * value["total"]["decided"] for value in values)
            / decided
        ),
        "totalDecided": decided,
    }


def normalize_team(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"\b(university|college|state|the)\b", " ", text)
    return re.sub(r"[^a-z0-9]", "", text)


def market_total_metrics(predictions: list[dict[str, Any]], evidence_path: Path) -> dict[str, Any]:
    evidence = __import__("json").loads(evidence_path.read_text())
    lookup: dict[tuple[str, str, str], float] = {}
    for row in evidence.get("rows", []):
        line = row.get("playbook_line") or {}
        total = line.get("total")
        game = row.get("game") or {}
        if not isinstance(total, (int, float)):
            continue
        start = pd.to_datetime(
            game.get("scheduledStart") or row.get("game_start_at"), utc=True, errors="coerce"
        )
        if pd.isna(start):
            continue
        lookup[(
            normalize_team((game.get("away") or {}).get("name")),
            normalize_team((game.get("home") or {}).get("name")),
            start.strftime("%Y-%m-%d"),
        )] = float(total)

    decided = wins = overs_selected = actual_overs = 0
    predicted_gap: list[float] = []
    actual_gap: list[float] = []
    for row in predictions:
        start = pd.to_datetime(row["gameDate"], utc=True, errors="coerce")
        line = lookup.get((
            normalize_team(row["awayTeam"]),
            normalize_team(row["homeTeam"]),
            start.strftime("%Y-%m-%d"),
        ))
        if line is None:
            continue
        predicted_total = float(row["expectedAway"] + row["expectedHome"])
        actual_total = float(row["actualAway"] + row["actualHome"])
        if actual_total == line:
            continue
        picked_over = predicted_total > line
        was_over = actual_total > line
        decided += 1
        wins += int(picked_over == was_over)
        overs_selected += int(picked_over)
        actual_overs += int(was_over)
        predicted_gap.append(predicted_total - line)
        actual_gap.append(actual_total - line)
    return {
        "decided": decided,
        "accuracy": wins / decided if decided else None,
        "oversSelected": overs_selected,
        "actualOvers": actual_overs,
        "meanPredictedMinusLine": float(np.mean(predicted_gap)) if predicted_gap else None,
        "meanActualMinusLine": float(np.mean(actual_gap)) if actual_gap else None,
    }
