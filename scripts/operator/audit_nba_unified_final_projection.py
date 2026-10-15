#!/usr/bin/env python3
"""Chronological audit of one coherent NBA final score and pick tuple.

The independent score model is fitted without market inputs. A bounded market
reader then reconciles its margin and total with the pregame consensus and may
reverse the spread edge when a selected open-to-current movement threshold is
crossed. Home score, away score, winner, spread side, total side, and alternate
spread results are all derived from the same reconciled margin/total pair.

2024-25 selects the fixed recipe. 2025-26 is opened exactly once for
confirmation. This operator is research-only and never writes production data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import audit_nba_spread_movement_reader as movement
from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_unified_final_projection_2026_10_15_r1_coherent_score"
INCUMBENT = movement.INCUMBENT
MARGIN_INDEPENDENT_WEIGHTS = (0.25, 0.50, 0.75)
TOTAL_INDEPENDENT_WEIGHTS = (0.25, 0.50, 0.75)
# Frozen by nba_spread_movement_reader_2026_10_15_r1_all_game before this
# coherent-score audit opens confirmation. The final-score layer may select
# score-blend weights, but it may not reselect the market-reader threshold.
MOVEMENT_THRESHOLDS = (2.0,)
MINIMUM_EDGE_POINTS = 0.25


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--selection-market", type=Path, required=True)
    parser.add_argument("--confirmation-market", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--predictions", type=Path)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def normal_cdf(values: np.ndarray) -> np.ndarray:
    return np.array([0.5 * (1.0 + math.erf(float(value) / math.sqrt(2.0))) for value in values])


def wilson_lower(wins: int, decisions: int, z: float = 1.96) -> float | None:
    if decisions <= 0:
        return None
    rate = wins / decisions
    denominator = 1 + z * z / decisions
    center = rate + z * z / (2 * decisions)
    radius = z * math.sqrt(rate * (1 - rate) / decisions + z * z / (4 * decisions * decisions))
    return float((center - radius) / denominator)


def reconcile(frame: pd.DataFrame, recipe: dict[str, float]) -> dict[str, np.ndarray]:
    independent_margin = frame["independent_margin"].to_numpy(float)
    independent_total = frame["independent_total"].to_numpy(float)
    market_margin = -frame["close_spread_home"].to_numpy(float)
    market_total = frame["close_total"].to_numpy(float)

    margin_weight = float(recipe["marginIndependentWeight"])
    total_weight = float(recipe["totalIndependentWeight"])
    margin = margin_weight * independent_margin + (1 - margin_weight) * market_margin
    total = total_weight * independent_total + (1 - total_weight) * market_total

    # The market reader acts on the model's residual against the exact current
    # spread. A qualifying move may reverse that residual, but it does not add a
    # second independent score: the reconciled margin is rewritten once and the
    # two team scores are reconstructed from the final margin and total.
    spread_support = frame["spread_home_support"].to_numpy(float)
    active = np.abs(spread_support) >= float(recipe["movementThreshold"])
    residual = margin - market_margin
    residual_size = np.maximum(np.abs(residual), MINIMUM_EDGE_POINTS)
    reader_residual = np.where(active, np.sign(spread_support) * residual_size, residual)
    final_margin = market_margin + reader_residual
    final_home = (total + final_margin) / 2
    final_away = (total - final_margin) / 2
    return {
        "home": final_home,
        "away": final_away,
        "margin": final_margin,
        "total": total,
        "marketMargin": market_margin,
        "marketTotal": market_total,
        "spreadResidual": reader_residual,
        "movementActive": active,
    }


def binary_result(prediction: np.ndarray, actual: np.ndarray) -> dict[str, Any]:
    resolved = ~np.isclose(actual, 0.0)
    wins = (prediction[resolved] >= 0) == (actual[resolved] > 0)
    win_count = int(wins.sum())
    decisions = int(resolved.sum())
    return {
        "decisions": decisions,
        "wins": win_count,
        "losses": decisions - win_count,
        "pushes": int((~resolved).sum()),
        "accuracy": float(win_count / decisions) if decisions else None,
        "wilson95Lower": wilson_lower(win_count, decisions),
    }


def spread_result(
    frame: pd.DataFrame,
    final: dict[str, np.ndarray],
    cushion: float = 0.0,
    include_flat_economics: bool = True,
) -> dict[str, Any]:
    actual = frame["target_home_margin"].to_numpy(float) + frame["close_spread_home"].to_numpy(float)
    prediction = final["spreadResidual"]
    selected_home = prediction >= 0
    selected_result = np.where(selected_home, actual, -actual) + cushion
    result = binary_result(np.ones(len(frame)), selected_result)
    if include_flat_economics:
        result["flatMinus110Units"] = float(result["wins"] * 100 / 110 - result["losses"])
        result["flatMinus110Roi"] = (
            float(result["flatMinus110Units"] / result["decisions"])
            if result["decisions"] else None
        )
    return result


def cohort_spreads(frame: pd.DataFrame, final: dict[str, np.ndarray]) -> dict[str, Any]:
    selected_home = final["spreadResidual"] >= 0
    home_favorite = frame["close_spread_home"].to_numpy(float) < 0
    masks = {
        "all": np.ones(len(frame), dtype=bool),
        "favorites": selected_home == home_favorite,
        "underdogs": selected_home != home_favorite,
        "home": selected_home,
        "away": ~selected_home,
        "movementActive": final["movementActive"],
        "movementInactive": ~final["movementActive"],
    }
    output: dict[str, Any] = {}
    for name, mask in masks.items():
        subset = frame.loc[mask].reset_index(drop=True)
        subfinal = {key: value[mask] for key, value in final.items()}
        output[name] = spread_result(subset, subfinal)
    return output


def metrics(frame: pd.DataFrame, final: dict[str, np.ndarray]) -> dict[str, Any]:
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    actual_margin = frame["target_home_margin"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    home_win = actual_margin > 0
    home_probability = np.clip(normal_cdf(final["margin"] / 12.0), 0.001, 0.999)
    winner = (final["margin"] >= 0) == home_win
    total_edge = final["total"] - final["marketTotal"]
    total_result = actual_total - final["marketTotal"]
    total_direction = binary_result(total_edge, total_result)
    main_spread = spread_result(frame, final)
    return {
        "games": int(len(frame)),
        "teamScoreMae": float(np.mean(np.concatenate([
            np.abs(final["home"] - actual_home), np.abs(final["away"] - actual_away),
        ]))),
        "marginMae": float(np.mean(np.abs(final["margin"] - actual_margin))),
        "totalMae": float(np.mean(np.abs(final["total"] - actual_total))),
        "winnerAccuracy": float(winner.mean()),
        "homeWinBrier": float(np.mean(np.square(home_probability - home_win.astype(float)))),
        "spread": main_spread,
        # Alternate-line economics require their exact prices. Accuracy is
        # reported here, but a fictitious -110 return must not be attached.
        "spreadPlus3": spread_result(frame, final, 3.0, include_flat_economics=False),
        "spreadPlus6": spread_result(frame, final, 6.0, include_flat_economics=False),
        "total": total_direction,
        "spreadCohorts": cohort_spreads(frame, final),
    }


def independent_final(frame: pd.DataFrame) -> dict[str, np.ndarray]:
    margin = frame["independent_margin"].to_numpy(float)
    total = frame["independent_total"].to_numpy(float)
    market_margin = -frame["close_spread_home"].to_numpy(float)
    return {
        "home": (total + margin) / 2,
        "away": (total - margin) / 2,
        "margin": margin,
        "total": total,
        "marketMargin": market_margin,
        "marketTotal": frame["close_total"].to_numpy(float),
        "spreadResidual": margin - market_margin,
        "movementActive": np.zeros(len(frame), dtype=bool),
    }


def joined(features: pd.DataFrame, groups: dict[str, list[str]], season: int, market_path: Path) -> pd.DataFrame:
    frame = movement.joined_season(features, groups, season, market_path)
    # joined_season retains only margin from the independent fit; reproduce its
    # coherent total from the same frozen model fit.
    train = features[features["season"] < season].copy()
    evaluate = features[features["season"] == season].copy()
    home, away, _ = professional.fit_predict(
        train,
        evaluate,
        groups[str(INCUMBENT["group"])],
        dict(INCUMBENT["model"]),
        str(INCUMBENT["architecture"]),
    )
    total_by_game = dict(zip(evaluate["game_id"].astype(int), home + away))
    frame["independent_total"] = frame["game_id"].astype(int).map(total_by_game)
    if frame["independent_total"].isna().any():
        raise ValueError(f"season {season} independent total join is incomplete")
    return frame


def candidate_recipes() -> list[dict[str, float]]:
    return [
        {
            "marginIndependentWeight": margin_weight,
            "totalIndependentWeight": total_weight,
            "movementThreshold": threshold,
        }
        for margin_weight in MARGIN_INDEPENDENT_WEIGHTS
        for total_weight in TOTAL_INDEPENDENT_WEIGHTS
        for threshold in MOVEMENT_THRESHOLDS
    ]


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = joined(features, groups, 2024, args.selection_market)
    confirmation = joined(features, groups, 2025, args.confirmation_market)

    independent_selection = metrics(selection, independent_final(selection))
    candidates = []
    for recipe in candidate_recipes():
        result = metrics(selection, reconcile(selection, recipe))
        # A final-product candidate must improve all score dimensions and winner
        # direction before spread lift can rank it. Total direction is unchanged
        # by a positive market blend and is reported rather than optimized twice.
        eligible = bool(
            result["teamScoreMae"] < independent_selection["teamScoreMae"]
            and result["marginMae"] < independent_selection["marginMae"]
            and result["totalMae"] < independent_selection["totalMae"]
            and result["winnerAccuracy"] >= independent_selection["winnerAccuracy"]
            and result["homeWinBrier"] <= independent_selection["homeWinBrier"]
        )
        candidates.append({"recipe": recipe, "selection": result, "eligible": eligible})
    eligible = [candidate for candidate in candidates if candidate["eligible"]]
    if not eligible:
        raise ValueError("no coherent NBA final-product candidate cleared selection gates")
    eligible.sort(key=lambda candidate: (
        -candidate["selection"]["spread"]["accuracy"],
        candidate["selection"]["teamScoreMae"],
        candidate["selection"]["marginMae"],
        json.dumps(candidate["recipe"], sort_keys=True),
    ))
    selected = eligible[0]
    confirmation_final = reconcile(confirmation, selected["recipe"])
    confirmation_metrics = metrics(confirmation, confirmation_final)
    independent_confirmation = metrics(confirmation, independent_final(confirmation))

    gates = {
        "teamScoreMaeImproves": confirmation_metrics["teamScoreMae"] < independent_confirmation["teamScoreMae"],
        "marginMaeImproves": confirmation_metrics["marginMae"] < independent_confirmation["marginMae"],
        "totalMaeImproves": confirmation_metrics["totalMae"] < independent_confirmation["totalMae"],
        "winnerAccuracyImproves": confirmation_metrics["winnerAccuracy"] > independent_confirmation["winnerAccuracy"],
        "homeWinBrierImproves": confirmation_metrics["homeWinBrier"] < independent_confirmation["homeWinBrier"],
        "spreadAccuracyImprovesByHalfPoint": (
            confirmation_metrics["spread"]["accuracy"]
            >= independent_confirmation["spread"]["accuracy"] + 0.005
        ),
        "spreadWilsonLowerAtLeastHalf": confirmation_metrics["spread"]["wilson95Lower"] >= 0.50,
        "totalAccuracyNoRegression": (
            confirmation_metrics["total"]["accuracy"] >= independent_confirmation["total"]["accuracy"]
        ),
        "allGamesReceiveCoherentScores": bool(
            np.isfinite(confirmation_final["home"]).all()
            and np.isfinite(confirmation_final["away"]).all()
        ),
    }
    historical_performance_gate = all(gates.values())
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "chronology": {"selectionSeason": 2024, "confirmationSeason": 2025},
        "inputs": {
            "features": {"path": str(args.features), "sha256": sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": sha256(args.confirmation_market)},
        },
        "independentModel": INCUMBENT,
        "selection": {
            "independent": independent_selection,
            "selected": selected,
            "eligibleCandidates": len(eligible),
            "evaluatedCandidates": len(candidates),
            "topEligibleCandidates": [
                {
                    "recipe": candidate["recipe"],
                    "teamScoreMae": candidate["selection"]["teamScoreMae"],
                    "marginMae": candidate["selection"]["marginMae"],
                    "totalMae": candidate["selection"]["totalMae"],
                    "winnerAccuracy": candidate["selection"]["winnerAccuracy"],
                    "homeWinBrier": candidate["selection"]["homeWinBrier"],
                    "spreadAccuracy": candidate["selection"]["spread"]["accuracy"],
                }
                for candidate in eligible[:15]
            ],
        },
        "confirmation": {
            "independent": independent_confirmation,
            "unifiedFinal": confirmation_metrics,
        },
        "gates": gates,
        "historicalPerformanceGatePassed": historical_performance_gate,
        "productionAuthority": {
            "authorized": False,
            "reason": (
                "Complete public pregame consensus validates the historical recipe, but exact same-book "
                "T-60 movement, target-book exclusion, and exact spread/alternate prices remain unavailable."
            ),
            "requiredNextEvidence": [
                "same-book opening/current/T-60 spread and price sequence",
                "target-book-excluded two-sided no-vig state",
                "exact main, plus-three, and plus-six prices",
                "release-pure current-board promotion/demotion replay",
            ],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")

    if args.predictions is not None:
        args.predictions.parent.mkdir(parents=True, exist_ok=True)
        with args.predictions.open("w") as handle:
            for index, row in confirmation.reset_index(drop=True).iterrows():
                handle.write(json.dumps({
                    "release": RELEASE,
                    "gameId": int(row["game_id"]),
                    "dateEt": str(row["date_et"]),
                    "homeTeam": str(row["home_team"]),
                    "awayTeam": str(row["away_team"]),
                    "independent": {
                        "marginHome": float(row["independent_margin"]),
                        "total": float(row["independent_total"]),
                    },
                    "market": {
                        "openSpreadHome": float(row["open_spread_home"]),
                        "currentSpreadHome": float(row["close_spread_home"]),
                        "currentTotal": float(row["close_total"]),
                    },
                    "final": {
                        "homeScore": float(confirmation_final["home"][index]),
                        "awayScore": float(confirmation_final["away"][index]),
                        "marginHome": float(confirmation_final["margin"][index]),
                        "total": float(confirmation_final["total"][index]),
                        "movementApplied": bool(confirmation_final["movementActive"][index]),
                    },
                    "actual": {
                        "homeScore": float(row["target_home_score"]),
                        "awayScore": float(row["target_away_score"]),
                    },
                }, sort_keys=True) + "\n")

    print(json.dumps({
        "output": str(args.output),
        "selectedRecipe": selected["recipe"],
        "historicalPerformanceGatePassed": historical_performance_gate,
        "independentConfirmation": independent_confirmation,
        "unifiedFinalConfirmation": confirmation_metrics,
        "productionAuthorized": False,
    }, indent=2))


if __name__ == "__main__":
    main()
