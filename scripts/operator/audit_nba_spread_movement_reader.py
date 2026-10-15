#!/usr/bin/env python3
"""Research-only NBA open-to-close spread-reader audit.

One all-game reader recipe is selected on the 2024 regular season and then
confirmed on 2025. The candidate grid tests whether spread and no-vig
moneyline movement should confirm, oppose, or leave unchanged the independent
model's side at the closing spread. No candidate may abstain, so improved
accuracy cannot be manufactured by hiding games.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_spread_movement_reader_2026_10_15_r1_all_game"
INCUMBENT = {
    "group": "ratings_schedule",
    "architecture": "margin_total",
    "model": {"family": "ridge", "alpha": 1000.0},
}
TEAM_NAMES = {
    "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets",
    "CHA": "Charlotte Hornets", "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers",
    "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons",
    "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
    "LAC": "Los Angeles Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
    "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves",
    "NOP": "New Orleans Pelicans", "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder",
    "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns",
    "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs",
    "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
}
SPREAD_WEIGHTS = (-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0)
MONEYLINE_WEIGHTS = (-20.0, 0.0, 20.0)
OVERRIDE_THRESHOLDS = (0.5, 1.0, 1.5, 2.0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--selection-market", type=Path, required=True)
    parser.add_argument("--confirmation-market", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def wilson_lower(wins: int, decisions: int, z: float = 1.96) -> float | None:
    if decisions <= 0:
        return None
    rate = wins / decisions
    denominator = 1 + z * z / decisions
    center = rate + z * z / (2 * decisions)
    margin = z * math.sqrt(rate * (1 - rate) / decisions + z * z / (4 * decisions * decisions))
    return float((center - margin) / denominator)


def independent_rows(
    frame: pd.DataFrame,
    groups: dict[str, list[str]],
    season: int,
) -> pd.DataFrame:
    train = frame[frame["season"] < season].copy()
    evaluate = frame[frame["season"] == season].copy()
    home, away, _ = professional.fit_predict(
        train,
        evaluate,
        groups[str(INCUMBENT["group"])],
        dict(INCUMBENT["model"]),
        str(INCUMBENT["architecture"]),
    )
    evaluate["independent_margin"] = home - away
    evaluate["date_et"] = (
        pd.to_datetime(evaluate["feature_cutoff"], utc=True) - pd.to_timedelta(12, unit="h")
    ).dt.strftime("%Y-%m-%d")
    evaluate["market_home_name"] = evaluate["home_team"].map(TEAM_NAMES)
    evaluate["market_away_name"] = evaluate["away_team"].map(TEAM_NAMES)
    return evaluate


def market_rows(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    frame = frame[
        frame["season_type"].astype(str).str.lower().eq("regular")
        & frame["stage"].astype(str).str.lower().eq("regular season")
    ].copy()
    required = [
        "date_et", "home_team", "away_team", "home_score", "away_score",
        "open_home_win_prob", "close_home_win_prob", "open_spread_home", "close_spread_home",
    ]
    frame = frame.dropna(subset=required)
    if frame.duplicated(["date_et", "home_team", "away_team"]).any():
        raise ValueError(f"duplicate market identities in {path}")
    return frame


def joined_season(
    features: pd.DataFrame,
    groups: dict[str, list[str]],
    season: int,
    market_path: Path,
) -> pd.DataFrame:
    left = independent_rows(features, groups, season)
    right = market_rows(market_path)
    merged = left.merge(
        right,
        left_on=["date_et", "market_home_name", "market_away_name"],
        right_on=["date_et", "home_team", "away_team"],
        how="inner",
        suffixes=("", "_market"),
        validate="one_to_one",
    )
    if len(merged) < 1_200:
        raise ValueError(f"season {season} market join is incomplete: {len(merged)}")
    if not np.array_equal(
        merged["target_home_score"].to_numpy(int), merged["home_score"].to_numpy(int)
    ) or not np.array_equal(
        merged["target_away_score"].to_numpy(int), merged["away_score"].to_numpy(int)
    ):
        raise ValueError(f"season {season} score mismatch after market join")
    merged["spread_home_support"] = (
        merged["open_spread_home"].to_numpy(float)
        - merged["close_spread_home"].to_numpy(float)
    )
    merged["moneyline_home_support"] = (
        merged["close_home_win_prob"].to_numpy(float)
        - merged["open_home_win_prob"].to_numpy(float)
    )
    merged["independent_close_edge"] = (
        merged["independent_margin"].to_numpy(float)
        + merged["close_spread_home"].to_numpy(float)
    )
    merged["close_residual"] = (
        merged["target_home_margin"].to_numpy(float)
        + merged["close_spread_home"].to_numpy(float)
    )
    return merged


def prediction_for_recipe(frame: pd.DataFrame, recipe: dict[str, Any]) -> np.ndarray:
    base = frame["independent_close_edge"].to_numpy(float)
    spread_support = frame["spread_home_support"].to_numpy(float)
    moneyline_support = frame["moneyline_home_support"].to_numpy(float)
    family = str(recipe["family"])
    if family == "weighted":
        return (
            base
            + float(recipe["spreadWeight"]) * spread_support
            + float(recipe["moneylineWeight"]) * moneyline_support
        )
    threshold = float(recipe["threshold"])
    movement = spread_support
    active = np.abs(movement) >= threshold
    direction = np.sign(movement)
    if family == "contrarian_override":
        direction *= -1
    return np.where(active, direction, np.sign(base))


def metrics(frame: pd.DataFrame, reader_edge: np.ndarray) -> dict[str, Any]:
    residual = frame["close_residual"].to_numpy(float)
    resolved = ~np.isclose(residual, 0.0)
    selected_home = reader_edge >= 0
    outcome_home = residual > 0
    keep = resolved
    wins = selected_home == outcome_home
    decisions = int(keep.sum())
    win_count = int((wins & keep).sum())

    selected_margin = np.where(
        selected_home,
        frame["target_home_margin"].to_numpy(float),
        -frame["target_home_margin"].to_numpy(float),
    )
    selected_line = np.where(
        selected_home,
        frame["close_spread_home"].to_numpy(float),
        -frame["close_spread_home"].to_numpy(float),
    )
    selected_result = selected_margin + selected_line

    def cushion(points: float) -> dict[str, Any]:
        adjusted = selected_result + points
        usable = ~np.isclose(adjusted, 0.0)
        won = adjusted > 0
        count = int(usable.sum())
        wins_at_line = int((usable & won).sum())
        return {
            "decisions": count,
            "wins": wins_at_line,
            "losses": count - wins_at_line,
            "pushes": int((~usable).sum()),
            "accuracy": float(wins_at_line / count),
        }

    home_favorite = frame["close_spread_home"].to_numpy(float) < 0
    selected_favorite = selected_home == home_favorite
    return {
        "decisions": decisions,
        "wins": win_count,
        "losses": decisions - win_count,
        "pushes": int((~resolved).sum()),
        "accuracy": float(win_count / decisions),
        "wilson95Lower": wilson_lower(win_count, decisions),
        "homeSelections": int((keep & selected_home).sum()),
        "awaySelections": int((keep & ~selected_home).sum()),
        "favoriteSelections": int((keep & selected_favorite).sum()),
        "underdogSelections": int((keep & ~selected_favorite).sum()),
        "favorablePlus3": cushion(3.0),
        "favorablePlus6": cushion(6.0),
    }


def recipes() -> list[dict[str, Any]]:
    output = [
        {"family": "weighted", "spreadWeight": spread, "moneylineWeight": moneyline}
        for spread in SPREAD_WEIGHTS
        for moneyline in MONEYLINE_WEIGHTS
    ]
    for family in ("follow_override", "contrarian_override"):
        output.extend({"family": family, "threshold": value} for value in OVERRIDE_THRESHOLDS)
    return output


def cohort_metrics(frame: pd.DataFrame, edge: np.ndarray) -> dict[str, Any]:
    output = {"all": metrics(frame, edge)}
    selected_home = edge >= 0
    home_favorite = frame["close_spread_home"].to_numpy(float) < 0
    masks = {
        "favorites": selected_home == home_favorite,
        "underdogs": selected_home != home_favorite,
        "home": selected_home,
        "away": ~selected_home,
    }
    for name, mask in masks.items():
        output[name] = metrics(frame.loc[mask].reset_index(drop=True), edge[mask])
    return output


def american_break_even_price(probability: float) -> float:
    return float(-100.0 * probability / (1.0 - probability))


def economic_summary(result: dict[str, Any]) -> dict[str, Any]:
    wins = int(result["wins"])
    losses = int(result["losses"])
    decisions = wins + losses
    flat_units = wins * 100.0 / 110.0 - losses
    output = {
        "flatMinus110Units": float(flat_units),
        "flatMinus110Roi": float(flat_units / decisions),
    }
    for key in ("favorablePlus3", "favorablePlus6"):
        row = result[key]
        probability = float(row["accuracy"])
        lower = wilson_lower(int(row["wins"]), int(row["decisions"]))
        output[key] = {
            "empiricalBreakEvenAmericanPrice": american_break_even_price(probability),
            "wilsonLowerBreakEvenAmericanPrice": (
                american_break_even_price(float(lower)) if lower is not None else None
            ),
        }
    return output


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = joined_season(features, groups, 2024, args.selection_market)
    confirmation = joined_season(features, groups, 2025, args.confirmation_market)

    baseline_recipe = {"family": "weighted", "spreadWeight": 0.0, "moneylineWeight": 0.0}
    baseline_selection = metrics(selection, prediction_for_recipe(selection, baseline_recipe))
    candidate_rows = []
    for recipe in recipes():
        result = metrics(selection, prediction_for_recipe(selection, recipe))
        candidate_rows.append({"recipe": recipe, "selection": result})
    candidate_rows.sort(key=lambda row: (
        -float(row["selection"]["wilson95Lower"]),
        -float(row["selection"]["accuracy"]),
        json.dumps(row["recipe"], sort_keys=True),
    ))
    selected = candidate_rows[0]
    selected_edge = prediction_for_recipe(confirmation, selected["recipe"])
    selected_selection_edge = prediction_for_recipe(selection, selected["recipe"])
    confirmation_result = cohort_metrics(confirmation, selected_edge)
    baseline_confirmation = metrics(
        confirmation,
        prediction_for_recipe(confirmation, baseline_recipe),
    )
    pooled_frame = pd.concat([selection, confirmation], ignore_index=True)
    pooled_edge = np.concatenate([selected_selection_edge, selected_edge])
    pooled_result = metrics(pooled_frame, pooled_edge)
    gate = bool(
        selected["selection"]["accuracy"] >= baseline_selection["accuracy"] + 0.005
        and selected["selection"]["wilson95Lower"] >= 0.50
        and confirmation_result["all"]["accuracy"] >= baseline_confirmation["accuracy"] + 0.005
        and confirmation_result["all"]["wilson95Lower"] >= 0.50
    )
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "marketAuthority": {
            "source": "independent multibook consensus open/close dataset",
            "selectionAuthorized": False,
            "reason": "source manifest permits score-level opening blend selection but not historical movement-rule selection",
        },
        "method": "select_all_game_reader_on_2024_then_confirm_once_on_2025",
        "selectionCoverage": int(len(selection)),
        "confirmationCoverage": int(len(confirmation)),
        "baselineSelection": baseline_selection,
        "selected": selected,
        "confirmation": {
            "candidate": confirmation_result,
            "baseline": baseline_confirmation,
            "gatePassed": gate,
        },
        "pooledOrientationOnly": {
            "result": pooled_result,
            "economics": economic_summary(pooled_result),
            "selectionAuthority": False,
        },
        "promotionEligible": False,
        "promotionBlockers": [
            "Historical movement-rule selection is not authorized by the source manifest.",
            "The consensus dataset does not retain exact closing spread prices, so economic ROI cannot be verified.",
            "Historical public/sharp betting splits are unavailable.",
        ],
        "candidates": candidate_rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "report": str(args.output),
        "baselineSelection": baseline_selection,
        "selected": selected,
        "confirmation": report["confirmation"],
        "promotionEligible": report["promotionEligible"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
