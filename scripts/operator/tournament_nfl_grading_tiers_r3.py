#!/usr/bin/env python3
"""Frozen NFL moneyline Best Angle / Watchlist grading-tier audit.

The protocol is predeclared in the matching 2026-08-24 audit document. It
retains the existing r6 probability and exact-price lane plus the r10 PMF
winner guard. It selects tier definitions on 2023 and opens 2024-2025 once.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_discrete_drive_joint_r7 as r10
import tournament_nfl_market_led_baseline_v4 as r4
import tournament_nfl_market_led_best_available_v6 as r6
import tournament_nfl_opening_residual_v2 as r2


TOURNAMENT_RELEASE = "nfl_grading_tiers_tournament_2026_08_24_r3"
GRADE_POLICY_RELEASE = "nfl_v1_grade_policy_2026_08_24_r3"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
BEST_ANGLE_EV_THRESHOLDS = (0.02, 0.04, 0.06, 0.08, 0.10)
BEST_ANGLE_EDGE_THRESHOLDS = (1.0, 2.0, 3.0, 4.0, 5.0)
WATCHLIST_WIDTHS = ((-0.01, -1.0), (-0.02, -2.0), (-0.03, -3.0))
RANDOM_STATE = 24082026


@dataclass(frozen=True)
class BestAngleRule:
    minimum_ev: float
    minimum_edge_pp: float

    @property
    def name(self) -> str:
        return f"best_angle__ev{self.minimum_ev:.2f}__edge{self.minimum_edge_pp:.1f}"


def load_r10_law() -> tuple[r10.DriveLaw, dict[str, Any]]:
    report_path = pathlib.Path(os.environ.get(
        "NFL_R10_REPORT_PATH",
        "/private/tmp/oddsphere-nfl-joint-production-20260823/football-research/reports/"
        "nfl_discrete_drive_joint_2026_08_23_r10.json",
    )).resolve()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("tournamentRelease") != r10.TOURNAMENT_RELEASE or report.get("qualified") is not True:
        raise RuntimeError("qualified frozen r10 report is required")
    law = r10.DriveLaw(
        events=tuple(
            (int(row["offense"]), int(row["defense"]), float(row["probability"]))
            for row in report["driveLaw"]["events"]
        ),
        count_pairs=tuple(
            (int(row["home"]), int(row["away"]), float(row["probability"]))
            for row in report["driveLaw"]["countPairs"]
        ),
    )
    return law, {
        "path": str(report_path),
        "tournamentRelease": report["tournamentRelease"],
        "distributionRelease": report["distributionRelease"],
        "artifactRelease": report["artifactRelease"],
    }


def build_historical_rows(root: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    features, feature_manifest = r2.load_features(root)
    openings, opening_evidence = r2.load_openings(root, features)
    engineered, feature_sets = r2.engineer(openings)
    margin_predictions, _ = r2.expanding_predictions(
        openings,
        engineered,
        feature_sets["margin"],
        "actual_margin",
        "opening_home_margin",
    )
    margin_name, _, _ = r2.select_candidate(
        openings,
        margin_predictions,
        "actual_margin",
        "opening_home_margin",
    )
    probabilities, probability_evidence = r4.build_probability_rows(
        openings,
        margin_predictions[margin_name],
    )
    selected = r4.build_decisions(openings, probabilities)
    selected["gameId"] = selected["row"].map(openings["game_id"])

    law, r10_source = load_r10_law()
    point_predictions = r10.historical_predictions()
    point_predictions = point_predictions[
        point_predictions["season"].isin((SELECTION_SEASON, *CONFIRMATION_SEASONS))
    ].copy()
    r10_home_winner: dict[str, bool] = {}
    r10_home_probability: dict[str, float] = {}
    for row in point_predictions.itertuples(index=False):
        pmf = r10.joint_pmf(
            law,
            float(row.projected_home_score),
            float(row.projected_away_score),
            r10.ENVIRONMENT_SIGMA,
            r10.EVENT_CONCENTRATION,
        )
        summary = r10.summarize(pmf)
        home_probability = float(summary["homeWinProbability"])
        away_probability = float(summary["awayWinProbability"])
        r10_home_winner[str(row.game_id)] = home_probability >= away_probability
        r10_home_probability[str(row.game_id)] = home_probability

    selected["r10HomeWinner"] = selected["gameId"].map(r10_home_winner)
    selected["r10HomeWinProbability"] = selected["gameId"].map(r10_home_probability)
    if selected["r10HomeWinner"].isna().any():
        missing = selected.loc[selected["r10HomeWinner"].isna(), "gameId"].tolist()
        raise RuntimeError(f"r10 historical winner coverage incomplete: {missing[:5]}")
    selected["directionCoherent"] = selected["first"].eq(selected["r10HomeWinner"])
    selected["boundedPrice"] = selected["price"].between(-300.0, 300.0, inclusive="both")
    selected["r6Qualifier"] = (
        selected["boundedPrice"]
        & selected["expectedValue"].ge(0.0)
        & selected["edgePp"].ge(0.0)
    )
    selected["baselineLean"] = selected["r6Qualifier"] & selected["directionCoherent"]

    probability_by_row = probabilities.set_index("row")
    public_rows: list[dict[str, Any]] = []
    for choice in selected.itertuples(index=False):
        probability_row = probability_by_row.loc[int(choice.row)]
        home = bool(choice.r10HomeWinner)
        probability = float(probability_row["probability"] if home else 1.0 - probability_row["probability"])
        market_probability = float(
            probability_row["market_probability"] if home else 1.0 - probability_row["market_probability"]
        )
        price = float(openings.loc[int(choice.row), "moneylineHome" if home else "moneylineAway"])
        won = bool(probability_row["outcome"] if home else not probability_row["outcome"])
        public_rows.append({
            "row": int(choice.row),
            "publicFirst": home,
            "publicProbability": probability,
            "publicMarketProbability": market_probability,
            "publicPrice": price,
            "publicExpectedValue": probability * r2.profit_one(price) - (1.0 - probability),
            "publicEdgePp": 100.0 * (probability - market_probability),
            "publicWon": won,
            "publicUnits": r2.profit_one(price) if won else -1.0,
            "publicClv": r2.clv_for_row(openings, int(choice.row), "moneyline", home),
            "publicObservedAt": str(openings.loc[int(choice.row), "openedAt"]),
        })
    public = pd.DataFrame(public_rows)
    rows = selected.merge(public, on="row", how="left", validate="one_to_one")
    rows["selectedSide"] = np.where(rows["first"], "home", "away")
    rows["publicSide"] = np.where(rows["publicFirst"], "home", "away")
    return rows, {
        "featureRelease": feature_manifest["featureRelease"],
        "featureSha256": feature_manifest["featureFileSha256"],
        "openingEvidence": opening_evidence,
        "marginCandidate": margin_name,
        "probabilityRelease": r6.MODEL_RELEASE,
        "probabilityEvidence": probability_evidence,
        "r10": r10_source,
    }


def as_evaluation_rows(rows: pd.DataFrame, public_side: bool) -> pd.DataFrame:
    result = rows.copy()
    if public_side:
        result["won"] = result["publicWon"]
        result["units"] = result["publicUnits"]
        result["clv"] = result["publicClv"]
        result["price"] = result["publicPrice"]
        result["expectedValue"] = result["publicExpectedValue"]
        result["edgePp"] = result["publicEdgePp"]
    return result


def without_largest_win(rows: pd.DataFrame) -> float:
    wins = rows.loc[rows["units"].gt(0), "units"]
    return float(rows["units"].sum() - (wins.max() if len(wins) else 0.0))


def summarize(
    rows: pd.DataFrame,
    seasons: tuple[int, ...],
    universe: pd.DataFrame | None = None,
) -> dict[str, Any]:
    selected = rows[rows["season"].isin(seasons)].copy()
    units = float(selected["units"].sum())
    denominator = rows if universe is None else universe
    all_weeks = denominator[denominator["season"].isin(seasons)][["season", "week"]].drop_duplicates()
    action_weeks = selected[["season", "week"]].drop_duplicates()
    result = {
        "actions": int(len(selected)),
        "wins": int(selected["won"].sum()),
        "losses": int((~selected["won"]).sum()),
        "units": units,
        "roi": units / len(selected) if len(selected) else None,
        "unitsWithoutLargestWin": without_largest_win(selected),
        "positiveClvRate": float(selected["clv"].gt(0).mean()) if len(selected) else None,
        "meanClv": float(selected["clv"].mean()) if len(selected) else None,
        "weeks": int(len(all_weeks)),
        "weeksWithGrade": int(len(action_weeks)),
        "weeklyCoverage": float(len(action_weeks) / len(all_weeks)) if len(all_weeks) else None,
        "bySeason": {},
        "selectedRows": json.loads(selected.to_json(orient="records")),
    }
    for season in seasons:
        season_rows = selected[selected["season"].eq(season)]
        season_units = float(season_rows["units"].sum())
        result["bySeason"][str(season)] = {
            "actions": int(len(season_rows)),
            "wins": int(season_rows["won"].sum()),
            "losses": int((~season_rows["won"]).sum()),
            "units": season_units,
            "roi": season_units / len(season_rows) if len(season_rows) else None,
            "unitsWithoutLargestWin": without_largest_win(season_rows),
            "positiveClvRate": float(season_rows["clv"].gt(0).mean()) if len(season_rows) else None,
            "meanClv": float(season_rows["clv"].mean()) if len(season_rows) else None,
        }
    return result


def weekly_cluster_bootstrap(rows: pd.DataFrame) -> dict[str, Any]:
    weekly = rows.groupby(["season", "week"], as_index=False).agg(
        units=("units", "sum"), actions=("units", "size")
    )
    if len(weekly) == 0:
        return {"weeklyClusters": 0, "unitCi95": None, "roiCi95": None, "probabilityPositiveUnits": None}
    rng = np.random.default_rng(RANDOM_STATE)
    indices = rng.integers(0, len(weekly), size=(20_000, len(weekly)))
    unit_samples = weekly["units"].to_numpy(float)[indices].sum(axis=1)
    action_samples = weekly["actions"].to_numpy(float)[indices].sum(axis=1)
    roi_samples = np.divide(unit_samples, action_samples, out=np.zeros_like(unit_samples), where=action_samples > 0)
    return {
        "weeklyClusters": int(len(weekly)),
        "unitCi95": [float(value) for value in np.quantile(unit_samples, [0.025, 0.975])],
        "roiCi95": [float(value) for value in np.quantile(roi_samples, [0.025, 0.975])],
        "probabilityPositiveUnits": float(np.mean(unit_samples > 0.0)),
    }


def best_angle_selection(rows: pd.DataFrame) -> tuple[BestAngleRule | None, list[dict[str, Any]]]:
    ranking: list[dict[str, Any]] = []
    for minimum_ev in BEST_ANGLE_EV_THRESHOLDS:
        for minimum_edge in BEST_ANGLE_EDGE_THRESHOLDS:
            rule = BestAngleRule(minimum_ev, minimum_edge)
            candidate = as_evaluation_rows(rows[
                rows["baselineLean"]
                & rows["expectedValue"].ge(minimum_ev)
                & rows["edgePp"].ge(minimum_edge)
            ], public_side=False)
            result = summarize(candidate, (SELECTION_SEASON,), universe=rows)
            eligible = bool(
                result["actions"] >= 18
                and result["weeklyCoverage"] is not None
                and result["weeklyCoverage"] >= 0.35
                and result["unitsWithoutLargestWin"] > 0
                and result["meanClv"] is not None
                and result["meanClv"] > 0
            )
            ranking.append({"rule": rule, "eligible": eligible, "result": result})
    eligible = [row for row in ranking if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["result"]["unitsWithoutLargestWin"],
        -row["result"]["meanClv"],
        -row["result"]["roi"],
        -row["result"]["actions"],
        -row["rule"].minimum_ev,
        -row["rule"].minimum_edge_pp,
    ))
    return (eligible[0]["rule"] if eligible else None), ranking


def watchlist_rows(rows: pd.DataFrame, minimum_ev: float, minimum_edge: float) -> pd.DataFrame:
    disagreement = rows["r6Qualifier"] & ~rows["directionCoherent"]
    misses_lean = ~rows["r6Qualifier"]
    near_boundary = (
        rows["boundedPrice"]
        & rows["directionCoherent"]
        & misses_lean
        & rows["expectedValue"].ge(minimum_ev)
        & rows["edgePp"].ge(minimum_edge)
    )
    # The predeclared Watchlist confirmation gate requires every displayed
    # public-side tuple to remain timestamped and inside the same bounded price
    # domain. Enforce that eligibility before counts/outcomes are summarized.
    public_tuple_eligible = (
        rows["publicPrice"].between(-300.0, 300.0, inclusive="both")
        & rows["publicObservedAt"].notna()
        & rows["publicObservedAt"].ne("")
    )
    candidate = rows[(disagreement | near_boundary) & public_tuple_eligible].copy()
    candidate["watchlistReason"] = np.where(
        candidate["r6Qualifier"], "r6_r10_direction_disagreement", "near_exact_price_boundary"
    )
    return as_evaluation_rows(candidate, public_side=True)


def select_watchlist(rows: pd.DataFrame) -> tuple[tuple[float, float] | None, list[dict[str, Any]]]:
    ranking: list[dict[str, Any]] = []
    for minimum_ev, minimum_edge in WATCHLIST_WIDTHS:
        result = summarize(
            watchlist_rows(rows, minimum_ev, minimum_edge),
            (SELECTION_SEASON,),
            universe=rows,
        )
        eligible = bool(
            result["actions"] >= 12
            and result["weeklyCoverage"] is not None
            and result["weeklyCoverage"] >= 0.25
        )
        ranking.append({
            "minimumEv": minimum_ev,
            "minimumEdgePp": minimum_edge,
            "eligible": eligible,
            "result": result,
        })
    selected = next((row for row in ranking if row["eligible"]), None)
    return (
        (float(selected["minimumEv"]), float(selected["minimumEdgePp"])) if selected else None,
        ranking,
    )


def compact_ranking(ranking: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for row in ranking:
        copy = dict(row)
        rule = copy.get("rule")
        if isinstance(rule, BestAngleRule):
            copy["rule"] = {
                "name": rule.name,
                "minimumEv": rule.minimum_ev,
                "minimumEdgePp": rule.minimum_edge_pp,
            }
        result = dict(copy["result"])
        result.pop("selectedRows", None)
        copy["result"] = result
        compact.append(copy)
    return compact


def main() -> None:
    root = pathlib.Path.cwd()
    rows, sources = build_historical_rows(root)
    best_rule, best_ranking = best_angle_selection(rows)
    best_confirmation_rows = (
        as_evaluation_rows(rows[
            rows["baselineLean"]
            & rows["expectedValue"].ge(best_rule.minimum_ev)
            & rows["edgePp"].ge(best_rule.minimum_edge_pp)
        ], public_side=False)
        if best_rule else rows.iloc[0:0].copy()
    )
    best_selection = summarize(best_confirmation_rows, (SELECTION_SEASON,), universe=rows)
    best_confirmation = summarize(best_confirmation_rows, CONFIRMATION_SEASONS, universe=rows)
    best_uncertainty = weekly_cluster_bootstrap(
        best_confirmation_rows[best_confirmation_rows["season"].isin(CONFIRMATION_SEASONS)]
    )
    best_gates = {
        "selectionRuleFound": best_rule is not None,
        "minimumPooledActions": best_confirmation["actions"] >= 24,
        "minimumEachSeason": all(value["actions"] >= 8 for value in best_confirmation["bySeason"].values()),
        "positiveEachSeason": all(value["units"] > 0 for value in best_confirmation["bySeason"].values()),
        "largestWinIndependentEachSeason": all(
            value["unitsWithoutLargestWin"] > 0 for value in best_confirmation["bySeason"].values()
        ),
        "positiveMeanClvEachSeason": all(
            value["meanClv"] is not None and value["meanClv"] > 0
            for value in best_confirmation["bySeason"].values()
        ),
        "pooledClvFrequency": (
            best_confirmation["positiveClvRate"] is not None
            and best_confirmation["positiveClvRate"] >= 0.40
        ),
        "bootstrapPositiveProbability": (
            best_uncertainty["probabilityPositiveUnits"] is not None
            and best_uncertainty["probabilityPositiveUnits"] >= 0.90
        ),
        "bootstrapRoiLowerBoundPositive": (
            best_uncertainty["roiCi95"] is not None
            and best_uncertainty["roiCi95"][0] > 0
        ),
    }
    best_authorized = all(best_gates.values())

    watch_width, watch_ranking = select_watchlist(rows)
    watch_rows = (
        watchlist_rows(rows, *watch_width) if watch_width else rows.iloc[0:0].copy()
    )
    watch_selection = summarize(watch_rows, (SELECTION_SEASON,), universe=rows)
    watch_confirmation = summarize(watch_rows, CONFIRMATION_SEASONS, universe=rows)
    watch_uncertainty = weekly_cluster_bootstrap(
        watch_rows[watch_rows["season"].isin(CONFIRMATION_SEASONS)]
    )
    watch_gates = {
        "selectionWidthFound": watch_width is not None,
        "minimumPooledRows": watch_confirmation["actions"] >= 12,
        "minimumEachSeason": all(value["actions"] >= 5 for value in watch_confirmation["bySeason"].values()),
        "zeroLeanOverlap": not bool(
            set(watch_rows.loc[watch_rows["season"].isin(CONFIRMATION_SEASONS), "row"])
            & set(rows.loc[rows["baselineLean"] & rows["season"].isin(CONFIRMATION_SEASONS), "row"])
        ),
        "boundedCompletePrices": bool(
            len(watch_rows) > 0
            and watch_rows["publicPrice"].notna().all()
            and watch_rows["publicPrice"].between(-300.0, 300.0, inclusive="both").all()
        ),
        "publicSideR10Fidelity": bool(watch_rows["publicFirst"].eq(watch_rows["r10HomeWinner"]).all()),
    }
    watch_authorized = all(watch_gates.values())

    best_live_rows = best_confirmation_rows if best_authorized else rows.iloc[0:0].copy()
    best_live_ids = set(best_live_rows["row"])
    watch_live_rows = watch_rows if watch_authorized else rows.iloc[0:0].copy()
    watch_live_ids = set(watch_live_rows["row"])
    lean_live_rows = as_evaluation_rows(
        rows[rows["baselineLean"] & ~rows["row"].isin(best_live_ids)],
        public_side=False,
    )
    no_play_live_rows = as_evaluation_rows(
        rows[~rows["row"].isin(best_live_ids | watch_live_ids | set(lean_live_rows["row"]))],
        public_side=True,
    )
    baseline_confirmation = summarize(
        as_evaluation_rows(rows[rows["baselineLean"]], public_side=False),
        CONFIRMATION_SEASONS,
        universe=rows,
    )
    live_tier_confirmation = {
        "bestAngle": summarize(best_live_rows, CONFIRMATION_SEASONS, universe=rows),
        "lean": summarize(lean_live_rows, CONFIRMATION_SEASONS, universe=rows),
        "watchlist": summarize(watch_live_rows, CONFIRMATION_SEASONS, universe=rows),
        "noPlay": summarize(no_play_live_rows, CONFIRMATION_SEASONS, universe=rows),
    }
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "gradePolicyRelease": GRADE_POLICY_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "frozenChronology": {
            "selection": [SELECTION_SEASON],
            "confirmation": list(CONFIRMATION_SEASONS),
        },
        "sources": sources,
        "baselineLeanConfirmation": baseline_confirmation,
        "liveTierConfirmation": live_tier_confirmation,
        "bestAngle": {
            "selectedRule": None if best_rule is None else {
                "name": best_rule.name,
                "minimumEv": best_rule.minimum_ev,
                "minimumEdgePp": best_rule.minimum_edge_pp,
            },
            "selection": best_selection,
            "confirmation": best_confirmation,
            "uncertainty": best_uncertainty,
            "gates": best_gates,
            "authorized": best_authorized,
            "selectionRanking": compact_ranking(best_ranking),
        },
        "watchlist": {
            "selectedWidth": None if watch_width is None else {
                "minimumEv": watch_width[0],
                "minimumEdgePp": watch_width[1],
            },
            "selection": watch_selection,
            "confirmation": watch_confirmation,
            "uncertaintyDiagnosticOnly": watch_uncertainty,
            "gates": watch_gates,
            "authorized": watch_authorized,
            "selectionRanking": compact_ranking(watch_ranking),
        },
        "releaseDecision": {
            "bestAngleAuthorized": best_authorized,
            "watchlistAuthorized": watch_authorized,
            "stakeChanged": False,
            "trackingChanged": False,
            "writerChanged": False,
            "probabilityChanged": False,
            "forecastChanged": False,
        },
    }
    output = pathlib.Path("football-research/reports/nfl_grading_tiers_2026_08_24_r3.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(output),
        "bestAngle": {
            "selectedRule": report["bestAngle"]["selectedRule"],
            "selection": {key: value for key, value in best_selection.items() if key != "selectedRows"},
            "confirmation": {key: value for key, value in best_confirmation.items() if key != "selectedRows"},
            "uncertainty": best_uncertainty,
            "gates": best_gates,
            "authorized": best_authorized,
        },
        "watchlist": {
            "selectedWidth": report["watchlist"]["selectedWidth"],
            "selection": {key: value for key, value in watch_selection.items() if key != "selectedRows"},
            "confirmation": {key: value for key, value in watch_confirmation.items() if key != "selectedRows"},
            "uncertaintyDiagnosticOnly": watch_uncertainty,
            "gates": watch_gates,
            "authorized": watch_authorized,
        },
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
