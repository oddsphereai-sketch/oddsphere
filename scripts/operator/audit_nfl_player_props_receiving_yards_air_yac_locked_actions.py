#!/usr/bin/env python3
"""Read-only same-input decision audit for the Receiving Yards air/YAC challenger.

This intentionally evaluates only immutable locked actions retained in the 2026 ledger. It can
measure retained-action side, probability, price, and demotion behavior, but cannot manufacture
the unlocked rows needed to claim promotion or whole-board impact.
"""

from __future__ import annotations

import json
import math
import pathlib
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_yards_air_yac_rows_r1.parquet"
MARKET = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeMarketReceivingYards.json"
CORE = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntime.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_yards_air_yac_locked_actions_r1.json"


def clamp(value: float, lower: float = 1e-9, upper: float = 1 - 1e-9) -> float:
    return min(upper, max(lower, value))


def logit(value: float) -> float:
    value = clamp(value)
    return math.log(value / (1 - value))


def logistic(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def over_probability(distribution: dict[str, Any], projection: float, line: float) -> float:
    if distribution["family"] == "empirical_residual_mean_bucket":
        selected = next((item for item in distribution["buckets"] if item["lower"] <= projection <= item["upper"]), None)
        residuals = (selected["distribution"] if selected else distribution["fallback"])["residualQuantiles"]
    else:
        residuals = distribution["residualQuantiles"]
    target = line - max(projection, 1e-6)
    return 1 - np.searchsorted(np.asarray(residuals, dtype=float), target, side="right") / len(residuals)


def expected_value(probability: float, price: int) -> float:
    profit = 100 / abs(price) if price < 0 else price / 100
    return probability * profit - (1 - probability)


def thresholds(core: dict[str, Any], movement: str, grade: str) -> dict[str, float]:
    volume = core["decision"]["volumeAndYardage"]
    if movement == "support":
        return volume["movementSupportedBestAngle" if grade == "Best Angle" else "movementSupportedLean"]
    return volume["bestAngle" if grade == "Best Angle" else "lean"]


def grade(core: dict[str, Any], movement: str, probability_edge: float, ev: float, participation: float) -> str:
    if movement != "adverse":
        for name in ("Best Angle", "Lean"):
            values = thresholds(core, movement, name)
            if (ev >= values["minimumEv"] and probability_edge >= values["minimumProbabilityEdge"]
                    and participation >= values["minimumParticipationProbability"]):
                return name
    if ev >= 0 and probability_edge >= 0:
        return "Watchlist"
    return "No Play"


def summarize(rows: pd.DataFrame, prefix: str) -> dict[str, Any]:
    probability = rows[f"{prefix}Final"].to_numpy(float)
    outcome = rows["outcome"].to_numpy(float)
    forecast = rows[f"{prefix}Forecast"].to_numpy(str)
    actual_side = np.where(rows["actual"].to_numpy(float) > rows["line"].to_numpy(float), "over", "under")
    return {
        "rows": int(len(rows)),
        "brier": float(np.mean((probability - outcome) ** 2)),
        "logLoss": float(np.mean(-(outcome * np.log(np.clip(probability, 1e-9, 1 - 1e-9))
                                    + (1 - outcome) * np.log(np.clip(1 - probability, 1e-9, 1 - 1e-9))))),
        "forecastDirectionAccuracy": float(np.mean(forecast == actual_side)),
        "bestAngle": int((rows[f"{prefix}Grade"] == "Best Angle").sum()),
        "lean": int((rows[f"{prefix}Grade"] == "Lean").sum()),
        "watchlist": int((rows[f"{prefix}Grade"] == "Watchlist").sum()),
        "noPlay": int((rows[f"{prefix}Grade"] == "No Play").sum()),
        "actionable": int(rows[f"{prefix}Grade"].isin(["Best Angle", "Lean"]).sum()),
    }


def main() -> None:
    values = pd.read_parquet(ROWS)
    rows = values[values["phase"].eq("locked_replay")].copy()
    if len(rows) != 72:
        raise RuntimeError(f"expected 72 immutable Receiving Yards scopes, received {len(rows)}")
    market = json.loads(MARKET.read_text(encoding="utf-8"))
    core = json.loads(CORE.read_text(encoding="utf-8"))
    weight = float(market["marketResidualWeight"])
    distribution = market["distribution"]

    for prefix, projection_column in (("control", "incumbent"), ("candidate", "candidate")):
        raw_over = np.asarray([
            over_probability(distribution, float(projection), float(line))
            for projection, line in zip(rows[projection_column], rows["line"], strict=True)
        ])
        rows[f"{prefix}Forecast"] = np.where(raw_over >= 0.5, "over", "under")
        raw_side = np.where(rows["side"].eq("over"), raw_over, 1 - raw_over)
        market_side = rows["marketProbability"].to_numpy(float)
        final = np.asarray([logistic(logit(market_probability) + weight * (logit(raw_probability) - logit(market_probability)))
                            for raw_probability, market_probability in zip(raw_side, market_side, strict=True)])
        edge = final - market_side
        ev = np.asarray([expected_value(float(probability), int(price))
                         for probability, price in zip(final, rows["lockedPrice"], strict=True)])
        grades = [grade(core, str(movement), float(probability_edge), float(value), float(participation))
                  for movement, probability_edge, value, participation in zip(
                      rows["movement"], edge, ev, rows["participationProbability"], strict=True)]
        rows[f"{prefix}Raw"] = raw_side
        rows[f"{prefix}Final"] = final
        rows[f"{prefix}Edge"] = edge
        rows[f"{prefix}Ev"] = ev
        rows[f"{prefix}Grade"] = grades

    control_actionable = rows["controlGrade"].isin(["Best Angle", "Lean"])
    candidate_actionable = rows["candidateGrade"].isin(["Best Angle", "Lean"])
    output = {
        "release": "nfl_player_props_receiving_yards_air_yac_locked_actions_2026_10_15_r1",
        "readOnly": True,
        "writes": 0,
        "scope": {
            "lockedReceivingYardsActions": int(len(rows)),
            "games": int(rows["gameId"].nunique()),
            "weeks": sorted(int(value) for value in rows["week"].unique()),
            "sameLinesPricesMarketProbabilitiesAndParticipation": True,
            "currentCalibrationAppliedToBothArms": True,
            "marketResidualWeight": weight,
        },
        "control": summarize(rows, "control"),
        "candidate": summarize(rows, "candidate"),
        "comparison": {
            "projectionChanges": int((np.abs(rows["candidate"] - rows["incumbent"]) > 1e-12).sum()),
            "forecastSideChanges": int((rows["candidateForecast"] != rows["controlForecast"]).sum()),
            "gradeChanges": int((rows["candidateGrade"] != rows["controlGrade"]).sum()),
            "actionablePromotionsWithinLockedActionSet": int((~control_actionable & candidate_actionable).sum()),
            "actionableDemotionsWithinLockedActionSet": int((control_actionable & ~candidate_actionable).sum()),
            "candidateMinusControlBrier": float(summarize(rows, "candidate")["brier"] - summarize(rows, "control")["brier"]),
            "candidateMinusControlLogLoss": float(summarize(rows, "candidate")["logLoss"] - summarize(rows, "control")["logLoss"]),
        },
        "limitations": {
            "wholeBoardImpactAvailable": False,
            "unlockedPromotionMeasurementAvailable": False,
            "reason": "The immutable replay contains retained locked actions, not the complete unlocked candidate board.",
            "productionPromotionAuthorized": False,
        },
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
