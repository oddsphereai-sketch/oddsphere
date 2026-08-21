#!/usr/bin/env python3
"""Apply the frozen 2024-trained NFL model to real 2025 FanDuel openings.

This is a historical diagnostic, not a selectable holdout: 2025 outcomes were
already opened in earlier model work. It establishes whether opening-price
reconstruction changes the decision problem and measures a closing-line-value
proxy against nflverse terminal consensus lines.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import sys
from typing import Any

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from tournament_nfl_real_model import (  # noqa: E402
    MarketRecipe,
    ProbabilityCalibrator,
    Recipe,
    empirical_probability,
    no_vig,
    predict_recipe,
)

_PICKLE_CLASS_BINDINGS = (Recipe, MarketRecipe, ProbabilityCalibrator)

TOURNAMENT_RELEASE = "nfl_opening_price_brain_replay_2026_08_20_r1"
OPENING_CACHE_RELEASE = "bdl_nfl_opening_history_2025_2026_08_20_r1"
SOURCE_MODEL_RELEASE = "nfl_pregame_real_local_candidate_2026_08_19_r2"
KERNEL_BANDWIDTH = 1.5


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implied(price: float) -> float:
    return 100.0 / (price + 100.0) if price > 0 else -price / (-price + 100.0)


def fair(first_price: float, second_price: float) -> float:
    first = implied(first_price)
    second = implied(second_price)
    return first / (first + second)


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def add_candidate(rows: list[dict[str, Any]], args: dict[str, Any]) -> None:
    first_probability = float(args["firstProbability"])
    first_price = float(args["firstPrice"])
    second_price = float(args["secondPrice"])
    second_probability = 1.0 - first_probability
    first_ev = first_probability * profit_one(first_price) - (1.0 - first_probability)
    second_ev = second_probability * profit_one(second_price) - (1.0 - second_probability)
    select_first = first_ev >= second_ev
    selected_probability = first_probability if select_first else second_probability
    selected_price = first_price if select_first else second_price
    selected_ev = first_ev if select_first else second_ev
    selected_side = args["firstSide"] if select_first else args["secondSide"]
    won = bool(args["firstWon"]) if select_first else not bool(args["firstWon"])
    push = bool(args["push"])
    rows.append({
        "week": int(args["week"]),
        "gameId": str(args["gameId"]),
        "market": str(args["market"]),
        "side": selected_side,
        "modelProbability": selected_probability,
        "priceAmerican": selected_price,
        "expectedValue": selected_ev,
        "won": won,
        "push": push,
        "units": 0.0 if push else profit_one(selected_price) if won else -1.0,
        "clv": float(args["firstClv"] if select_first else args["secondClv"]),
    })


def policy_result(rows: pd.DataFrame, minimum_ev: float, maximum_actions: int) -> dict[str, Any]:
    weeks = sorted(int(value) for value in rows["week"].unique())
    eligible = rows[rows["expectedValue"] >= minimum_ev]
    selected = (
        eligible.sort_values(["week", "expectedValue"], ascending=[True, False])
        .groupby("week", as_index=False, sort=True)
        .head(maximum_actions)
    )
    counts = selected.groupby("week").size().to_dict()
    zero_weeks = [week for week in weeks if int(counts.get(week, 0)) == 0]
    resolved = selected[~selected["push"]]
    units = float(selected["units"].sum())
    return {
        "minimumExpectedValue": minimum_ev,
        "maximumActionsPerWeek": maximum_actions,
        "actions": int(len(selected)),
        "wins": int(resolved["won"].sum()),
        "losses": int((~resolved["won"]).sum()),
        "pushes": int(selected["push"].sum()),
        "units": units,
        "roi": units / len(selected) if len(selected) else None,
        "zeroActionWeeks": zero_weeks,
        "weeklyActionCoverage": 1.0 - len(zero_weeks) / len(weeks),
        "positiveClvRate": float((selected["clv"] > 0).mean()) if len(selected) else None,
        "meanClv": float(selected["clv"].mean()) if len(selected) else None,
        "marketMix": {str(key): int(value) for key, value in selected["market"].value_counts().sort_index().items()},
    }


def main() -> None:
    root = pathlib.Path.cwd()
    opening_manifest_path = root / "football-research/cache/nfl-market/bdl_nfl_opening_history_2025_2026_08_20_r1.manifest.json"
    opening_manifest = json.loads(opening_manifest_path.read_text(encoding="utf-8"))
    opening_path = pathlib.Path(opening_manifest["dataFile"])
    if opening_manifest.get("cacheRelease") != OPENING_CACHE_RELEASE or sha256_file(opening_path) != opening_manifest["dataSha256"]:
        raise RuntimeError("opening cache checksum or release mismatch")
    opening = json.loads(opening_path.read_text(encoding="utf-8"))
    games = pd.DataFrame(opening["games"])
    odds = pd.DataFrame(opening["openings"])
    odds = odds[odds["vendor"].eq("fanduel")].copy()
    if len(odds) != 272 or odds["gameId"].duplicated().any():
        raise RuntimeError("FanDuel opening coverage must be exactly one row for every 2025 game")
    provider = games.merge(odds, on="gameId", validate="one_to_one")

    holdout_path = root / "football-research/cache/nfl-model/nfl_2025_holdout_predictions_r2.parquet"
    holdout = pd.read_parquet(holdout_path)
    holdout["homeJoin"] = holdout["home_team"].replace({"LA": "LAR", "WAS": "WSH"})
    holdout["awayJoin"] = holdout["away_team"].replace({"LA": "LAR", "WAS": "WSH"})
    frame = provider.merge(
        holdout,
        left_on=["homeTeam", "awayTeam"],
        right_on=["homeJoin", "awayJoin"],
        validate="one_to_one",
    ).sort_values(["week_x", "game_id"]).reset_index(drop=True)
    if len(frame) != 272:
        raise RuntimeError(f"opening/model join incomplete: {len(frame)}/272")
    frame["week"] = frame["week_x"]

    model_path = root / "football-research/cache/nfl-model/nfl_pregame_real_local_candidate_2026_08_19_r2.joblib"
    artifact = joblib.load(model_path)
    if artifact.get("modelRelease") != SOURCE_MODEL_RELEASE:
        raise RuntimeError("source model release mismatch")
    features = artifact["featureNames"]
    margin_independent = predict_recipe(artifact["margin"]["independentModels"], frame, features, artifact["margin"]["independentRecipe"])
    total_independent = predict_recipe(artifact["total"]["independentModels"], frame, features, artifact["total"]["independentRecipe"])
    opening_margin = -frame["spreadHomeLine"].to_numpy(float)
    opening_total = frame["totalLine"].to_numpy(float)
    margin_weight = float(artifact["margin"]["marketRecipe"].independent_weight)
    total_weight = float(artifact["total"]["marketRecipe"].independent_weight)
    projected_margin = opening_margin + margin_weight * (margin_independent - opening_margin)
    projected_total = opening_total + total_weight * (total_independent - opening_total)
    home_win = artifact["calibrators"]["moneyline"].predict(empirical_probability(projected_margin, 0.0, artifact["marginResiduals"]))
    home_cover = artifact["calibrators"]["spread"].predict(empirical_probability(projected_margin, opening_margin, artifact["marginResiduals"]))
    over = artifact["calibrators"]["total"].predict(empirical_probability(projected_total, opening_total, artifact["totalResiduals"]))

    candidates: list[dict[str, Any]] = []
    for index, row in frame.iterrows():
        terminal_home_fair = fair(float(row["home_moneyline"]), float(row["away_moneyline"]))
        opening_home_fair = fair(float(row["moneylineHome"]), float(row["moneylineAway"]))
        add_candidate(candidates, {
            "week": row["week_x"], "gameId": row["gameId"], "market": "moneyline",
            "firstProbability": home_win[index], "firstPrice": row["moneylineHome"], "secondPrice": row["moneylineAway"],
            "firstSide": "home", "secondSide": "away", "firstWon": row["actual_margin"] > 0, "push": row["actual_margin"] == 0,
            "firstClv": terminal_home_fair - opening_home_fair, "secondClv": opening_home_fair - terminal_home_fair,
        })
        terminal_home_bet_line = -float(row["market_home_margin"])
        opening_home_bet_line = float(row["spreadHomeLine"])
        add_candidate(candidates, {
            "week": row["week_x"], "gameId": row["gameId"], "market": "spread",
            "firstProbability": home_cover[index], "firstPrice": row["spreadHomePrice"], "secondPrice": row["spreadAwayPrice"],
            "firstSide": "home", "secondSide": "away", "firstWon": row["actual_margin"] > opening_margin[index], "push": row["actual_margin"] == opening_margin[index],
            "firstClv": opening_home_bet_line - terminal_home_bet_line, "secondClv": terminal_home_bet_line - opening_home_bet_line,
        })
        terminal_total = float(row["market_total"])
        opening_total_line = float(row["totalLine"])
        add_candidate(candidates, {
            "week": row["week_x"], "gameId": row["gameId"], "market": "total",
            "firstProbability": over[index], "firstPrice": row["totalOverPrice"], "secondPrice": row["totalUnderPrice"],
            "firstSide": "over", "secondSide": "under", "firstWon": row["actual_total"] > opening_total_line, "push": row["actual_total"] == opening_total_line,
            "firstClv": terminal_total - opening_total_line, "secondClv": opening_total_line - terminal_total,
        })
    decision_frame = pd.DataFrame(candidates)
    policies = [
        policy_result(decision_frame, minimum_ev, maximum_actions)
        for minimum_ev in [0.0, 0.01, 0.02, 0.03, 0.05]
        for maximum_actions in [1, 2, 3, 4]
    ]
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "openingCacheRelease": OPENING_CACHE_RELEASE,
        "sourceModelRelease": SOURCE_MODEL_RELEASE,
        "localOnly": True,
        "actionable": False,
        "officialTrackingChanged": False,
        "openingCoverage": {"games": 272, "vendor": "fanduel", "rows": len(odds)},
        "policies": policies,
        "interpretation": "descriptive 2025 opening-price replay; cannot select or promote a rule because 2025 outcomes were previously inspected",
        "limitations": [
            "terminal comparison is nflverse consensus rather than same-book FanDuel close",
            "2025 is not an untouched selection partition",
            "the 2024-selected market blend was applied to openings without a prior opening-price calibration season",
            "public/sharp split and intermediate movement histories are unavailable",
        ],
    }
    report_path = root / "football-research/reports" / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "openingCoverage": report["openingCoverage"],
        "weeklyTopOne": [policy for policy in policies if policy["maximumActionsPerWeek"] == 1],
        "report": str(report_path),
    }, indent=2))


if __name__ == "__main__":
    main()
