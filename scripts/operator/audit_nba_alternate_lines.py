#!/usr/bin/env python3
"""Audit favorable NBA alternate-line cushions on a frozen prediction ledger.

This is an evaluation-only tool. It never treats a synthetically shifted line
as an offered wager: historical ROI remains unavailable unless the exact
alternate line, price, book, and timestamp were captured before the game.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path
from typing import Any, Callable


RELEASE = "nba_alternate_line_audit_2026_10_15_r1_frozen_confirmation"
PRIMARY_CUSHIONS = (3.0, 6.0)
SENSITIVITY_CUSHIONS = (0.0, 2.5, 3.0, 5.0, 6.0, 7.5, 10.0)


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def wilson_interval(wins: int, decisions: int, z: float = 1.96) -> tuple[float | None, float | None]:
    if decisions <= 0:
        return None, None
    rate = wins / decisions
    denominator = 1 + z * z / decisions
    center = rate + z * z / (2 * decisions)
    margin = z * math.sqrt(rate * (1 - rate) / decisions + z * z / (4 * decisions * decisions))
    return (center - margin) / denominator, (center + margin) / denominator


def fair_american(probability: float | None) -> float | None:
    if probability is None or probability <= 0 or probability >= 1:
        return None
    if probability >= 0.5:
        return -100 * probability / (1 - probability)
    return 100 * (1 - probability) / probability


def rounded(value: float | None, digits: int = 6) -> float | None:
    return None if value is None else round(value, digits)


def result(value: float) -> str:
    if math.isclose(value, 0.0, abs_tol=1e-9):
        return "push"
    return "win" if value > 0 else "loss"


def curve(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    main_results = [result(float(row["signedMainResult"])) for row in rows]
    main_losses = sum(item == "loss" for item in main_results)
    values: list[dict[str, Any]] = []
    for cushion in SENSITIVITY_CUSHIONS:
        outcomes = [result(float(row["signedMainResult"]) + cushion) for row in rows]
        wins = sum(item == "win" for item in outcomes)
        losses = sum(item == "loss" for item in outcomes)
        pushes = sum(item == "push" for item in outcomes)
        decisions = wins + losses
        win_rate = wins / decisions if decisions else None
        lower, upper = wilson_interval(wins, decisions)
        recovered = sum(
            main == "loss" and shifted != "loss"
            for main, shifted in zip(main_results, outcomes)
        )
        values.append({
            "favorablePoints": cushion,
            "wins": wins,
            "losses": losses,
            "pushes": pushes,
            "decisions": decisions,
            "winRate": rounded(win_rate),
            "wilson95Lower": rounded(lower),
            "wilson95Upper": rounded(upper),
            "empiricalBreakEvenAmericanPrice": rounded(fair_american(win_rate), 2),
            "wilsonLowerBreakEvenAmericanPrice": rounded(fair_american(lower), 2),
            "mainLossesRecoveredOrPushed": recovered,
            "mainLossRecoveryRate": rounded(recovered / main_losses if main_losses else None),
        })
    return values


def primary_breakdowns(
    rows: list[dict[str, Any]],
    definitions: list[tuple[str, Callable[[dict[str, Any]], bool]]],
) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for label, predicate in definitions:
        selected = [row for row in rows if predicate(row)]
        selected_curve = curve(selected)
        output[label] = {
            "rows": len(selected),
            "primary": [
                item for item in selected_curve
                if float(item["favorablePoints"]) in PRIMARY_CUSHIONS
            ],
        }
    return output


def cohort(name: str, rows: list[dict[str, Any]], status: str, breakdowns: dict[str, Any]) -> dict[str, Any]:
    all_curves = curve(rows)
    return {
        "name": name,
        "status": status,
        "rows": len(rows),
        "primary": [item for item in all_curves if float(item["favorablePoints"]) in PRIMARY_CUSHIONS],
        "sensitivity": all_curves,
        "breakdowns": breakdowns,
    }


def error_metrics(values: list[float]) -> dict[str, float]:
    return {
        "mae": rounded(statistics.fmean(abs(value) for value in values)),
        "bias": rounded(statistics.fmean(values)),
        "rmse": rounded(math.sqrt(statistics.fmean(value * value for value in values))),
    }


def correlation(left: list[float], right: list[float]) -> float | None:
    if len(left) < 2 or len(left) != len(right):
        return None
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    denominator = math.sqrt(
        sum((x - left_mean) ** 2 for x in left)
        * sum((y - right_mean) ** 2 for y in right)
    )
    return rounded(numerator / denominator if denominator else None)


def directional_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    outcomes = [result(float(row["signedMainResult"])) for row in rows]
    wins = sum(item == "win" for item in outcomes)
    losses = sum(item == "loss" for item in outcomes)
    pushes = sum(item == "push" for item in outcomes)
    return {
        "rows": len(rows),
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "winRate": rounded(wins / (wins + losses) if wins + losses else None),
        "meanSignedResult": rounded(statistics.fmean(float(row["signedMainResult"]) for row in rows)) if rows else None,
        "meanAbsoluteFinalEdge": rounded(statistics.fmean(float(row["finalEdgeAbs"]) for row in rows)) if rows else None,
    }


def range_bands(
    rows: list[dict[str, Any]],
    field: str,
    definitions: list[tuple[float, float]],
) -> list[dict[str, Any]]:
    return [{
        "lowerInclusive": lower,
        "upperExclusive": None if math.isinf(upper) else upper,
        **directional_summary([
            row for row in rows if lower <= float(row[field]) < upper
        ]),
    } for lower, upper in definitions]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--tournament-report", type=Path, required=True)
    parser.add_argument("--opening-odds", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    tournament = json.loads(args.tournament_report.read_text())
    predictions = [json.loads(line) for line in args.predictions.read_text().splitlines() if line.strip()]
    opening_odds = [json.loads(line) for line in args.opening_odds.read_text().splitlines() if line.strip()]
    opening_keys = [(int(row["game_id"]), str(row["vendor"]).strip().lower()) for row in opening_odds]
    unique_opening_keys = set(opening_keys)
    duplicate_opening_keys = len(opening_keys) - len(unique_opening_keys)
    distribution = tournament["confirmationDistribution"]
    margin_sigma = float(distribution["marginSigma"])
    total_sigma = float(distribution["totalSigma"])
    margin_independent_weight = float(tournament["marketMarriage"]["selected"]["marginIndependentWeight"])
    total_threshold = float(tournament["actionableThresholdSelection"]["total"]["selected"]["threshold"])

    spread_rows: list[dict[str, Any]] = []
    total_rows: list[dict[str, Any]] = []
    for row in predictions:
        market = row["openingMarketEvaluationOnly"]
        prediction = row["prediction"]
        actual = row["actual"]

        home_spread = market.get("homeSpread")
        if isinstance(home_spread, (int, float)) and math.isfinite(float(home_spread)):
            final_margin = float(prediction["homeMargin"])
            market_margin = -float(home_spread)
            independent_margin = (
                (final_margin - (1 - margin_independent_weight) * market_margin)
                / margin_independent_weight
            )
            home_probability = normal_cdf((final_margin + float(home_spread)) / margin_sigma)
            pick_home = home_probability >= 0.5
            selected_line = float(home_spread) if pick_home else -float(home_spread)
            selected_margin = float(actual["homeMargin"]) if pick_home else -float(actual["homeMargin"])
            spread_rows.append({
                "gameId": row["gameId"],
                "side": "home" if pick_home else "away",
                "role": "favorite" if selected_line < 0 else "underdog" if selected_line > 0 else "pickem",
                "line": selected_line,
                "probability": home_probability if pick_home else 1 - home_probability,
                "signedMainResult": selected_margin + selected_line,
                "lineAbs": abs(float(home_spread)),
                "finalEdgeAbs": abs(final_margin - market_margin),
                "marketMargin": market_margin,
                "finalMargin": final_margin,
                "independentMargin": independent_margin,
                "actualMargin": float(actual["homeMargin"]),
            })

        total_line = market.get("total")
        if isinstance(total_line, (int, float)) and math.isfinite(float(total_line)):
            over_probability = normal_cdf((float(prediction["total"]) - float(total_line)) / total_sigma)
            pick_over = over_probability >= 0.5
            probability = over_probability if pick_over else 1 - over_probability
            signed_result = (
                float(actual["total"]) - float(total_line)
                if pick_over
                else float(total_line) - float(actual["total"])
            )
            total_rows.append({
                "gameId": row["gameId"],
                "side": "over" if pick_over else "under",
                "line": float(total_line),
                "probability": probability,
                "signedMainResult": signed_result,
            })

    actionable_totals = [
        row for row in total_rows
        if float(row["probability"]) - 0.5 >= total_threshold - 1e-12
        and result(float(row["signedMainResult"])) != "push"
    ]
    expected_actionable = tournament["actionableConfirmation"]["total"]
    expected_tuple = (
        int(expected_actionable["bets"]),
        int(expected_actionable["wins"]),
        int(expected_actionable["losses"]),
    )
    action_main = curve(actionable_totals)[0]
    observed_tuple = (len(actionable_totals), int(action_main["wins"]), int(action_main["losses"]))
    if observed_tuple != expected_tuple:
        raise ValueError(
            f"Frozen actionable-total cohort mismatch: expected={expected_tuple} observed={observed_tuple}"
        )

    spread_breakdowns = primary_breakdowns(spread_rows, [
        ("favorite", lambda row: row["role"] == "favorite"),
        ("underdog", lambda row: row["role"] == "underdog"),
        ("home", lambda row: row["side"] == "home"),
        ("away", lambda row: row["side"] == "away"),
    ])
    total_breakdowns = primary_breakdowns(total_rows, [
        ("over", lambda row: row["side"] == "over"),
        ("under", lambda row: row["side"] == "under"),
    ])
    actionable_total_breakdowns = primary_breakdowns(actionable_totals, [
        ("over", lambda row: row["side"] == "over"),
        ("under", lambda row: row["side"] == "under"),
    ])
    actual_residual = [float(row["actualMargin"]) - float(row["marketMargin"]) for row in spread_rows]
    independent_residual = [float(row["independentMargin"]) - float(row["marketMargin"]) for row in spread_rows]
    final_residual = [float(row["finalMargin"]) - float(row["marketMargin"]) for row in spread_rows]
    signed_results = [float(row["signedMainResult"]) for row in spread_rows]
    signed_mean = statistics.fmean(signed_results)
    signed_sd = statistics.stdev(signed_results)
    spread_stress = {
        "projectionError": {
            "independentVsActual": error_metrics([
                float(row["independentMargin"]) - float(row["actualMargin"]) for row in spread_rows
            ]),
            "finalVsActual": error_metrics([
                float(row["finalMargin"]) - float(row["actualMargin"]) for row in spread_rows
            ]),
            "openingMarketVsActual": error_metrics([
                float(row["marketMargin"]) - float(row["actualMargin"]) for row in spread_rows
            ]),
        },
        "residualSignal": {
            "independentVsActualPearson": correlation(independent_residual, actual_residual),
            "finalVsActualPearson": correlation(final_residual, actual_residual),
            "actualResidualMean": rounded(statistics.fmean(actual_residual)),
            "actualResidualStandardDeviation": rounded(statistics.stdev(actual_residual)),
            "independentResidualStandardDeviation": rounded(statistics.stdev(independent_residual)),
            "finalResidualStandardDeviation": rounded(statistics.stdev(final_residual)),
        },
        "selectedSideDistribution": {
            "mean": rounded(signed_mean),
            "median": rounded(statistics.median(signed_results)),
            "standardDeviation": rounded(signed_sd),
            "normalExpectedWinRate": {
                str(int(cushion)): rounded(normal_cdf((signed_mean + cushion) / signed_sd))
                for cushion in (0.0, 3.0, 6.0)
            },
        },
        "finalEdgeBands": range_bands(
            spread_rows,
            "finalEdgeAbs",
            [(0, 0.5), (0.5, 1), (1, 2), (2, 3), (3, 5), (5, math.inf)],
        ),
        "absoluteMarketLineBands": range_bands(
            spread_rows,
            "lineAbs",
            [(0, 3.5), (3.5, 6.5), (6.5, 9.5), (9.5, math.inf)],
        ),
        "interpretation": [
            "The +3/+6 accuracy lift closely matches ordinary NBA margin dispersion; it is not evidence of a three- or six-point global bias.",
            "The market blend shrinks the independent residual toward the opening line but cannot change its sign, so it does not change the selected spread side.",
            "Near-zero residual correlation means the current independent model does not reliably predict deviations from the opening spread in this confirmation season.",
            "A production spread requires a chronologically selected residual-to-market model or validated timestamped reader correction, not a global point adjustment.",
        ],
    }

    report = {
        "release": RELEASE,
        "sourceTournamentRelease": tournament["release"],
        "sourcePredictions": str(args.predictions),
        "sourceOpeningOdds": str(args.opening_odds),
        "confirmationSeason": tournament["chronology"]["confirmationSeason"],
        "method": {
            "primaryCushions": list(PRIMARY_CUSHIONS),
            "sensitivityCushions": list(SENSITIVITY_CUSHIONS),
            "lineDirection": "move the frozen selected side's main line in its favor",
            "selection": "frozen final combined prediction and frozen total threshold; no confirmation tuning",
            "pushHandling": "pushes are reported and excluded from win-rate denominators",
        },
        "historicalOfferCoverage": {
            "openingRows": len(opening_odds),
            "games": len({game_id for game_id, _vendor in opening_keys}),
            "sportsbooks": len({vendor for _game_id, vendor in opening_keys}),
            "duplicateGameSportsbookRows": duplicate_opening_keys,
            "alternatePriceRows": 0,
            "roiAvailable": False,
            "reason": "BALLDONTLIE retained one opening snapshot per game and sportsbook, not an alternate-line ladder.",
        },
        "cohorts": {
            "spreadDirectionalDiagnostic": cohort(
                "all final combined spread directions",
                spread_rows,
                "no_play_main_spread_failed_selection_and_exact_price_gates",
                spread_breakdowns,
            ),
            "totalDirectionalDiagnostic": cohort(
                "all final combined total directions",
                total_rows,
                "diagnostic_only",
                total_breakdowns,
            ),
            "totalFrozenActionable": cohort(
                "frozen final combined total threshold cohort",
                actionable_totals,
                "main_line_validated_alt_price_unvalidated",
                actionable_total_breakdowns,
            ),
        },
        "spreadStress": spread_stress,
        "decision": {
            "trackingMenu": {
                "spread": [3, 6],
                "total": [3, 6],
                "purpose": "competitor-comparable favorable-cushion diagnostics on the identical locked cohort",
            },
            "officialAlternateWagers": "no_play_until_exact_offered_price_validation",
            "prospectiveEvidenceRequired": [
                "canonical event and market",
                "selected side",
                "main line and exact main price",
                "alternate line and exact alternate price",
                "sportsbook",
                "provider timestamp and fetch timestamp",
                "model and calibration releases",
                "locked decision timestamp",
            ],
            "warning": "Higher cushion accuracy is purchased with worse price. Do not compare win rates without exact-price ROI.",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
