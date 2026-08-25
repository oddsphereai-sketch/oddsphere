#!/usr/bin/env python3
"""Frozen NFL r10 spread/total exact-price grading tournament.

The matching predeclaration was committed before this operator inspected any
selection or confirmation outcome. 2023 selects each market independently;
2024 and 2025 are then opened once for confirmation.
"""

from __future__ import annotations

import json
import math
import os
import pathlib
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_discrete_drive_joint_r7 as r10
import tournament_nfl_multibook_loo_policy_v4 as multibook


TOURNAMENT_RELEASE = "nfl_spread_total_grading_tournament_2026_08_24_r1"
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
MARKETS = ("spread", "total")
MINIMUM_EVS = (0.01, 0.02, 0.03, 0.04)
MINIMUM_EDGES_PP = (1.0, 2.0, 3.0)
MINIMUM_CUSHIONS = (0.5, 1.0, 1.5)
WATCHLIST_WIDTHS = ((-0.01, -1.0), (-0.02, -2.0), (-0.03, -3.0))
BEST_ANGLE_EVS = (0.04, 0.06, 0.08, 0.10)
BEST_ANGLE_EDGES_PP = (3.0, 4.0, 5.0)
PRICE_MINIMUM = -130.0
PRICE_MAXIMUM = 130.0
KEY_SPREADS = (3.0, 7.0, 10.0, 14.0)
RANDOM_STATE = 24082026


@dataclass(frozen=True)
class LeanRule:
    market: str
    minimum_ev: float
    minimum_edge_pp: float
    minimum_cushion: float

    @property
    def name(self) -> str:
        return (
            f"{self.market}__ev{self.minimum_ev:.2f}"
            f"__edge{self.minimum_edge_pp:.1f}__cushion{self.minimum_cushion:.1f}"
        )


@dataclass(frozen=True)
class BestAngleRule:
    minimum_ev: float
    minimum_edge_pp: float

    @property
    def name(self) -> str:
        return f"ev{self.minimum_ev:.2f}__edge{self.minimum_edge_pp:.1f}"


def load_law() -> tuple[r10.DriveLaw, dict[str, Any]]:
    path = pathlib.Path(os.environ.get(
        "NFL_R10_REPORT_PATH",
        "/private/tmp/oddsphere-nfl-joint-production-20260823/football-research/reports/"
        "nfl_discrete_drive_joint_2026_08_23_r10.json",
    )).resolve()
    report = json.loads(path.read_text(encoding="utf-8"))
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
        "path": str(path),
        "tournamentRelease": report["tournamentRelease"],
        "distributionRelease": report["distributionRelease"],
        "artifactRelease": report["artifactRelease"],
    }


def conditional_probabilities(pmf: np.ndarray, market: str, line: float) -> dict[str, float]:
    home, away = np.indices(pmf.shape)
    adjusted = home + line - away if market == "spread" else home + away - line
    first_win = float(pmf[adjusted > 0].sum())
    push = float(pmf[np.isclose(adjusted, 0.0)].sum())
    second_win = max(0.0, 1.0 - first_win - push)
    resolved = max(first_win + second_win, 1e-12)
    return {
        "firstWin": first_win,
        "secondWin": second_win,
        "push": push,
        "firstConditional": first_win / resolved,
        "secondConditional": second_win / resolved,
    }


def timestamp_valid(row: pd.Series) -> bool:
    opened = pd.to_datetime(row.get("openedAt"), errors="coerce", utc=True)
    scheduled = pd.to_datetime(row.get("scheduledStart"), errors="coerce", utc=True)
    return bool(pd.notna(opened) and pd.notna(scheduled) and opened < scheduled)


def build_offer_rows(
    source_root: pathlib.Path,
    seasons: tuple[int, ...] = (SELECTION_SEASON, *CONFIRMATION_SEASONS),
) -> tuple[pd.DataFrame, dict[str, Any]]:
    features, feature_manifest = multibook.load_features(source_root)
    offers, opening_evidence = multibook.load_multibook_openings(source_root, features)
    loo_frames = multibook.build_loo_frames(offers)
    target_offers = pd.concat(loo_frames.values(), ignore_index=True)
    target_offers = target_offers[target_offers["season"].isin(seasons)].copy()

    predictions = r10.historical_predictions()
    predictions = predictions[predictions["season"].isin(seasons)].copy()
    prediction_by_game = predictions.set_index("game_id")
    law, law_source = load_law()

    rows: list[dict[str, Any]] = []
    pmf_cache: dict[str, tuple[np.ndarray, float, float]] = {}
    for record in target_offers.to_dict(orient="records"):
        game_id = str(record["game_id"])
        if game_id not in prediction_by_game.index:
            continue
        if game_id not in pmf_cache:
            prediction = prediction_by_game.loc[game_id]
            if isinstance(prediction, pd.DataFrame):
                raise RuntimeError(f"duplicate r10 historical prediction: {game_id}")
            pmf = r10.joint_pmf(
                law,
                float(prediction["projected_home_score"]),
                float(prediction["projected_away_score"]),
                r10.ENVIRONMENT_SIGMA,
                r10.EVENT_CONCENTRATION,
            )
            home_index, away_index = np.indices(pmf.shape)
            expected_margin = float(((home_index - away_index) * pmf).sum())
            expected_total = float(((home_index + away_index) * pmf).sum())
            pmf_cache[game_id] = (pmf, expected_margin, expected_total)
        pmf, expected_margin, expected_total = pmf_cache[game_id]

        for market in MARKETS:
            if market == "spread":
                line = float(record["spreadHomeLine"])
                first_price = float(record["spreadHomePrice"])
                second_price = float(record["spreadAwayPrice"])
                target_first_fair = float(record["target_home_spread_fair"])
                loo_first_fair = float(record["loo_home_spread_fair"])
                first_won = float(record["actual_margin"]) > -line
                push = float(record["actual_margin"]) == -line
                key_sensitive = any(abs(abs(line) - key) <= 0.25 for key in KEY_SPREADS)
                zone_sensitive = False
            else:
                line = float(record["totalLine"])
                first_price = float(record["totalOverPrice"])
                second_price = float(record["totalUnderPrice"])
                target_first_fair = float(record["target_over_fair"])
                loo_first_fair = float(record["loo_over_fair"])
                first_won = float(record["actual_total"]) > line
                push = float(record["actual_total"]) == line
                key_sensitive = False
                zone_sensitive = line <= 41.0 or line >= 50.0

            values = conditional_probabilities(pmf, market, line)
            first_ev = values["firstWin"] * multibook.profit_one(first_price) - values["secondWin"]
            second_ev = values["secondWin"] * multibook.profit_one(second_price) - values["firstWin"]
            first = first_ev >= second_ev
            conditional_probability = values["firstConditional"] if first else values["secondConditional"]
            target_fair = target_first_fair if first else 1.0 - target_first_fair
            loo_fair = loo_first_fair if first else 1.0 - loo_first_fair
            price = first_price if first else second_price
            won = first_won if first else not first_won
            if market == "spread":
                signed_cushion = expected_margin + line
                cushion = signed_cushion if first else -signed_cushion
                selected_line = line if first else -line
            else:
                signed_cushion = expected_total - line
                cushion = signed_cushion if first else -signed_cushion
                selected_line = line
            direction_coherent = bool((conditional_probability >= 0.5))
            price_coherent = bool(math.isfinite(loo_fair) and target_fair <= loo_fair + 1e-12)
            bounded_price = PRICE_MINIMUM <= price <= PRICE_MAXIMUM
            base_health = bool(
                timestamp_valid(pd.Series(record))
                and int(record["loo_other_book_count"]) >= 2
                and math.isfinite(conditional_probability)
                and math.isfinite(target_fair)
                and math.isfinite(price)
            )
            rows.append({
                "season": int(record["season"]),
                "week": int(record["week"]),
                "gameId": str(record["gameId"]),
                "featureGameId": game_id,
                "book": str(record["vendor"]),
                "market": market,
                "first": first,
                "side": ("home" if first else "away") if market == "spread" else ("over" if first else "under"),
                "line": selected_line,
                "price": price,
                "probability": conditional_probability,
                "pushProbability": values["push"],
                "targetFairProbability": target_fair,
                "looFairProbability": loo_fair,
                "priceAdvantagePp": 100.0 * (loo_fair - target_fair),
                "expectedValue": first_ev if first else second_ev,
                "edgePp": 100.0 * (conditional_probability - loo_fair),
                "cushion": cushion,
                "keySensitive": key_sensitive,
                "totalZoneSensitive": zone_sensitive,
                "cushionPenalty": 0.5 if key_sensitive or zone_sensitive else 0.0,
                "directionCoherent": direction_coherent,
                "priceCoherent": price_coherent,
                "boundedPrice": bounded_price,
                "baseHealth": base_health,
                "won": won,
                "push": push,
                "units": 0.0 if push else multibook.profit_one(price) if won else -1.0,
                "clv": multibook.clv(pd.Series(record), market, first),
                "openedAt": str(record["openedAt"]),
                "scheduledStart": str(record["scheduledStart"]),
                "looOtherBookCount": int(record["loo_other_book_count"]),
            })
    frame = pd.DataFrame(rows)
    return frame, {
        "featureRelease": feature_manifest["featureRelease"],
        "featureSha256": feature_manifest["featureFileSha256"],
        "openingEvidence": opening_evidence,
        "r10": law_source,
        "rawTargetMarketOffers": int(len(frame)),
        "uniqueGames": int(frame["gameId"].nunique()),
    }


def reduce_best_offer(rows: pd.DataFrame) -> pd.DataFrame:
    if rows.empty:
        return rows.copy()
    return (
        rows.sort_values(
            ["season", "gameId", "market", "expectedValue", "priceAdvantagePp", "price", "book"],
            ascending=[True, True, True, False, False, False, True],
        )
        .groupby(["season", "gameId", "market"], sort=True, as_index=False)
        .head(1)
        .reset_index(drop=True)
    )


def common_eligible(rows: pd.DataFrame, rule: LeanRule) -> pd.Series:
    return (
        rows["market"].eq(rule.market)
        & rows["baseHealth"]
        & rows["directionCoherent"]
        & rows["priceCoherent"]
        & rows["boundedPrice"]
        & rows["cushion"].ge(rule.minimum_cushion + rows["cushionPenalty"])
    )


def select_lean(rows: pd.DataFrame, rule: LeanRule) -> pd.DataFrame:
    return reduce_best_offer(rows[
        common_eligible(rows, rule)
        & rows["expectedValue"].ge(rule.minimum_ev)
        & rows["edgePp"].ge(rule.minimum_edge_pp)
    ].copy())


def without_largest_win(rows: pd.DataFrame) -> float:
    wins = rows.loc[rows["units"].gt(0), "units"]
    return float(rows["units"].sum() - (wins.max() if len(wins) else 0.0))


def summarize(rows: pd.DataFrame, seasons: tuple[int, ...], universe: pd.DataFrame) -> dict[str, Any]:
    selected = rows[rows["season"].isin(seasons)].copy()
    resolved = selected[~selected["push"]]
    weeks = universe[universe["season"].isin(seasons)][["season", "week"]].drop_duplicates()
    action_weeks = selected[["season", "week"]].drop_duplicates()
    result: dict[str, Any] = {
        "actions": int(len(selected)),
        "wins": int(resolved["won"].sum()),
        "losses": int((~resolved["won"]).sum()),
        "pushes": int(selected["push"].sum()),
        "units": float(selected["units"].sum()),
        "roi": float(selected["units"].sum() / len(selected)) if len(selected) else None,
        "unitsWithoutLargestWin": without_largest_win(selected),
        "positiveClvRate": float(selected["clv"].gt(0).mean()) if len(selected) else None,
        "meanClv": float(selected["clv"].mean()) if len(selected) else None,
        "weeks": int(len(weeks)),
        "weeksWithGrade": int(len(action_weeks)),
        "weeklyCoverage": float(len(action_weeks) / len(weeks)) if len(weeks) else None,
        "bookMix": {str(key): int(value) for key, value in selected["book"].value_counts().sort_index().items()},
        "sideMix": {str(key): int(value) for key, value in selected["side"].value_counts().sort_index().items()},
        "keySensitive": int(selected["keySensitive"].sum()),
        "totalZoneSensitive": int(selected["totalZoneSensitive"].sum()),
        "bySeason": {},
        "selectedRows": json.loads(selected.to_json(orient="records")),
    }
    for season in seasons:
        season_rows = selected[selected["season"].eq(season)]
        season_resolved = season_rows[~season_rows["push"]]
        result["bySeason"][str(season)] = {
            "actions": int(len(season_rows)),
            "wins": int(season_resolved["won"].sum()),
            "losses": int((~season_resolved["won"]).sum()),
            "pushes": int(season_rows["push"].sum()),
            "units": float(season_rows["units"].sum()),
            "roi": float(season_rows["units"].sum() / len(season_rows)) if len(season_rows) else None,
            "unitsWithoutLargestWin": without_largest_win(season_rows),
            "positiveClvRate": float(season_rows["clv"].gt(0).mean()) if len(season_rows) else None,
            "meanClv": float(season_rows["clv"].mean()) if len(season_rows) else None,
        }
    return result


def weekly_bootstrap(rows: pd.DataFrame) -> dict[str, Any]:
    weekly = rows.groupby(["season", "week"], as_index=False).agg(units=("units", "sum"), actions=("units", "size"))
    if weekly.empty:
        return {"weeklyClusters": 0, "probabilityPositiveUnits": None, "roiCi95": None, "unitCi95": None}
    rng = np.random.default_rng(RANDOM_STATE)
    indices = rng.integers(0, len(weekly), size=(20_000, len(weekly)))
    unit_samples = weekly["units"].to_numpy(float)[indices].sum(axis=1)
    action_samples = weekly["actions"].to_numpy(float)[indices].sum(axis=1)
    roi_samples = np.divide(unit_samples, action_samples, out=np.zeros_like(unit_samples), where=action_samples > 0)
    return {
        "weeklyClusters": int(len(weekly)),
        "probabilityPositiveUnits": float(np.mean(unit_samples > 0)),
        "unitCi95": [float(value) for value in np.quantile(unit_samples, [0.025, 0.975])],
        "roiCi95": [float(value) for value in np.quantile(roi_samples, [0.025, 0.975])],
    }


def selection_passes(summary: dict[str, Any]) -> bool:
    return bool(
        summary["actions"] >= 18
        and summary["weeksWithGrade"] >= 8
        and summary["units"] > 0
        and summary["unitsWithoutLargestWin"] > 0
        and summary["meanClv"] is not None and summary["meanClv"] > 0
        and summary["positiveClvRate"] is not None and summary["positiveClvRate"] >= 0.50
        and len(summary["bookMix"]) >= 2
    )


def confirmation_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    return {
        "minimumCounts": summary["actions"] >= 40 and all(row["actions"] >= 15 for row in seasons),
        "positivePooledUnits": summary["units"] > 0,
        "positiveEachSeason": all(row["units"] > 0 for row in seasons),
        "largestWinIndependent": summary["unitsWithoutLargestWin"] > 0 and all(row["unitsWithoutLargestWin"] > 0 for row in seasons),
        "positiveMeanClv": summary["meanClv"] is not None and summary["meanClv"] > 0,
        "positiveClvRate": summary["positiveClvRate"] is not None and summary["positiveClvRate"] >= 0.50,
        "bootstrapPositive": bootstrap["probabilityPositiveUnits"] is not None and bootstrap["probabilityPositiveUnits"] >= 0.90,
        "bootstrapRoiFloor": bootstrap["roiCi95"] is not None and bootstrap["roiCi95"][0] > -0.05,
        "multiBook": len(summary["bookMix"]) >= 2,
    }


def select_rule(rows: pd.DataFrame, market: str) -> tuple[LeanRule | None, list[dict[str, Any]]]:
    candidates: list[dict[str, Any]] = []
    for minimum_ev in MINIMUM_EVS:
        for minimum_edge in MINIMUM_EDGES_PP:
            for minimum_cushion in MINIMUM_CUSHIONS:
                rule = LeanRule(market, minimum_ev, minimum_edge, minimum_cushion)
                selected = select_lean(rows, rule)
                result = summarize(selected, (SELECTION_SEASON,), rows[rows["market"].eq(market)])
                result["rule"] = asdict(rule)
                result["ruleName"] = rule.name
                result["eligible"] = selection_passes(result)
                candidates.append(result)
    eligible = [row for row in candidates if row["eligible"]]
    eligible.sort(key=lambda row: (
        -row["unitsWithoutLargestWin"], -row["units"], -row["meanClv"], row["actions"], row["ruleName"]
    ))
    if not eligible:
        return None, candidates
    chosen = eligible[0]["rule"]
    return LeanRule(**chosen), candidates


def watchlist_rows(rows: pd.DataFrame, rule: LeanRule, lean: pd.DataFrame, width: tuple[float, float]) -> pd.DataFrame:
    ev_floor, edge_floor = width
    candidates = rows[
        common_eligible(rows, rule)
        & rows["expectedValue"].ge(ev_floor)
        & rows["edgePp"].ge(edge_floor)
    ].copy()
    selected = reduce_best_offer(candidates)
    lean_keys = set(zip(lean["season"], lean["gameId"], lean["market"], strict=True))
    keep = [
        (season, game_id, market) not in lean_keys
        for season, game_id, market in zip(selected["season"], selected["gameId"], selected["market"], strict=True)
    ]
    return selected[np.asarray(keep, dtype=bool)].copy()


def select_watchlist(rows: pd.DataFrame, rule: LeanRule, lean: pd.DataFrame) -> tuple[tuple[float, float] | None, list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []
    for width in WATCHLIST_WIDTHS:
        candidate = watchlist_rows(rows, rule, lean, width)
        result = summarize(candidate, (SELECTION_SEASON,), rows[rows["market"].eq(rule.market)])
        result["width"] = {"minimumEv": width[0], "minimumEdgePp": width[1]}
        result["semanticEligible"] = result["actions"] >= 18 and result["weeksWithGrade"] >= 8
        results.append(result)
        if result["semanticEligible"]:
            return width, results
    return None, results


def select_best_angle(rows: pd.DataFrame, lean_rule: LeanRule, lean: pd.DataFrame) -> tuple[BestAngleRule | None, list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []
    selection_lean = lean[lean["season"].eq(SELECTION_SEASON)]
    for minimum_ev in BEST_ANGLE_EVS:
        for minimum_edge in BEST_ANGLE_EDGES_PP:
            rule = BestAngleRule(minimum_ev, minimum_edge)
            candidate = selection_lean[
                selection_lean["expectedValue"].ge(max(lean_rule.minimum_ev, minimum_ev))
                & selection_lean["edgePp"].ge(max(lean_rule.minimum_edge_pp, minimum_edge))
            ].copy()
            summary = summarize(candidate, (SELECTION_SEASON,), rows[rows["market"].eq(lean_rule.market)])
            summary["rule"] = asdict(rule)
            summary["ruleName"] = rule.name
            summary["eligible"] = bool(
                summary["actions"] >= 12
                and summary["weeksWithGrade"] >= 6
                and summary["units"] > 0
                and summary["unitsWithoutLargestWin"] > 0
                and summary["meanClv"] is not None and summary["meanClv"] > 0
                and summary["positiveClvRate"] is not None and summary["positiveClvRate"] >= 0.55
                and len(summary["bookMix"]) >= 2
            )
            results.append(summary)
    eligible = [row for row in results if row["eligible"]]
    eligible.sort(key=lambda row: (-row["unitsWithoutLargestWin"], -row["units"], -row["meanClv"], row["actions"], row["ruleName"]))
    if not eligible:
        return None, results
    return BestAngleRule(**eligible[0]["rule"]), results


def best_angle_confirmation_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    seasons = list(summary["bySeason"].values())
    return {
        "minimumCounts": summary["actions"] >= 30 and all(row["actions"] >= 10 for row in seasons),
        "positiveEachSeason": all(row["units"] > 0 for row in seasons),
        "largestWinIndependent": summary["unitsWithoutLargestWin"] > 0 and all(row["unitsWithoutLargestWin"] > 0 for row in seasons),
        "positiveMeanClv": summary["meanClv"] is not None and summary["meanClv"] > 0,
        "positiveClvRate": summary["positiveClvRate"] is not None and summary["positiveClvRate"] >= 0.55,
        "bootstrapPositive": bootstrap["probabilityPositiveUnits"] is not None and bootstrap["probabilityPositiveUnits"] >= 0.95,
        "bootstrapRoiFloor": bootstrap["roiCi95"] is not None and bootstrap["roiCi95"][0] > 0.0,
    }


def compact(summary: dict[str, Any] | None) -> dict[str, Any] | None:
    if summary is None:
        return None
    return {key: value for key, value in summary.items() if key != "selectedRows"}


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get(
        "NFL_RESEARCH_SOURCE_ROOT",
        "/private/tmp/oddsphere-nfl-daily-edge-launch-r1",
    )).resolve()
    rows, evidence = build_offer_rows(source_root)
    market_reports: dict[str, Any] = {}
    for market in MARKETS:
        rule, selection_candidates = select_rule(rows, market)
        report: dict[str, Any] = {
            "selectionCandidateCount": len(selection_candidates),
            "selectionEligibleCount": sum(bool(row["eligible"]) for row in selection_candidates),
            "selectionCandidates": [compact(row) for row in selection_candidates],
            "selectedLeanRule": None if rule is None else asdict(rule),
            "leanSelection": None,
            "leanConfirmation": None,
            "leanConfirmationBootstrap": None,
            "leanConfirmationGates": {},
            "leanAuthorized": False,
            "watchlistWidth": None,
            "watchlistSelection": None,
            "watchlistConfirmation": None,
            "watchlistConfirmationBootstrap": None,
            "watchlistAuthorized": False,
            "watchlistCandidates": [],
            "bestAngleRule": None,
            "bestAngleSelection": None,
            "bestAngleConfirmation": None,
            "bestAngleConfirmationBootstrap": None,
            "bestAngleConfirmationGates": {},
            "bestAngleAuthorized": False,
            "bestAngleCandidates": [],
        }
        if rule is not None:
            all_lean = select_lean(rows, rule)
            selection_lean = summarize(all_lean, (SELECTION_SEASON,), rows[rows["market"].eq(market)])
            confirmation_lean_rows = all_lean[all_lean["season"].isin(CONFIRMATION_SEASONS)]
            confirmation_lean = summarize(all_lean, CONFIRMATION_SEASONS, rows[rows["market"].eq(market)])
            lean_bootstrap = weekly_bootstrap(confirmation_lean_rows)
            lean_gates = confirmation_gates(confirmation_lean, lean_bootstrap)
            lean_authorized = bool(all(lean_gates.values()))
            report.update({
                "leanSelection": selection_lean,
                "leanConfirmation": confirmation_lean,
                "leanConfirmationBootstrap": lean_bootstrap,
                "leanConfirmationGates": lean_gates,
                "leanAuthorized": lean_authorized,
            })

            width, watch_selection_results = select_watchlist(rows, rule, all_lean)
            report["watchlistCandidates"] = [compact(row) for row in watch_selection_results]
            if width is not None:
                all_watch = watchlist_rows(rows, rule, all_lean, width)
                watch_confirmation_rows = all_watch[all_watch["season"].isin(CONFIRMATION_SEASONS)]
                report.update({
                    "watchlistWidth": {"minimumEv": width[0], "minimumEdgePp": width[1]},
                    "watchlistSelection": next(row for row in watch_selection_results if row["semanticEligible"]),
                    "watchlistConfirmation": summarize(all_watch, CONFIRMATION_SEASONS, rows[rows["market"].eq(market)]),
                    "watchlistConfirmationBootstrap": weekly_bootstrap(watch_confirmation_rows),
                    "watchlistAuthorized": True,
                })

            ba_rule, ba_selection_results = select_best_angle(rows, rule, all_lean)
            report["bestAngleCandidates"] = [compact(row) for row in ba_selection_results]
            if ba_rule is not None:
                ba_rows = all_lean[
                    all_lean["expectedValue"].ge(max(rule.minimum_ev, ba_rule.minimum_ev))
                    & all_lean["edgePp"].ge(max(rule.minimum_edge_pp, ba_rule.minimum_edge_pp))
                ].copy()
                ba_confirmation_rows = ba_rows[ba_rows["season"].isin(CONFIRMATION_SEASONS)]
                ba_confirmation = summarize(ba_rows, CONFIRMATION_SEASONS, rows[rows["market"].eq(market)])
                ba_bootstrap = weekly_bootstrap(ba_confirmation_rows)
                ba_gates = best_angle_confirmation_gates(ba_confirmation, ba_bootstrap)
                report.update({
                    "bestAngleRule": asdict(ba_rule),
                    "bestAngleSelection": next(row for row in ba_selection_results if row["rule"] == asdict(ba_rule)),
                    "bestAngleConfirmation": ba_confirmation,
                    "bestAngleConfirmationBootstrap": ba_bootstrap,
                    "bestAngleConfirmationGates": ba_gates,
                    "bestAngleAuthorized": bool(lean_authorized and all(ba_gates.values())),
                })
        market_reports[market] = report

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-spread-total-grading-predeclaration.md",
        "chronology": {"selection": [SELECTION_SEASON], "confirmation": list(CONFIRMATION_SEASONS)},
        "shadowOnly": True,
        "productionBehaviorChanged": False,
        "modelChanged": False,
        "trackingChanged": False,
        "stakesChanged": False,
        "data": evidence,
        "marketReports": market_reports,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
        "limitations": [
            "Historical as-of QB, depth, injury, split, and weather revisions cannot be reconstructed and are excluded.",
            "Closing movement is outcome-free evaluation evidence, never an opening-time policy input.",
            "2024-2025 have been inspected by earlier NFL research and are chronological confirmation, not a pristine future holdout.",
            "A historical pass still requires latest Week 1 exact-tuple replay and the existing forward health boundary before release.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "rawTargetMarketOffers": evidence["rawTargetMarketOffers"],
        "uniqueGames": evidence["uniqueGames"],
        "markets": {
            market: {
                "selectedLeanRule": values["selectedLeanRule"],
                "leanSelection": compact(values["leanSelection"]),
                "leanConfirmation": compact(values["leanConfirmation"]),
                "leanConfirmationBootstrap": values["leanConfirmationBootstrap"],
                "leanConfirmationGates": values["leanConfirmationGates"],
                "leanAuthorized": values["leanAuthorized"],
                "watchlistWidth": values["watchlistWidth"],
                "watchlistSelection": compact(values["watchlistSelection"]),
                "watchlistConfirmation": compact(values["watchlistConfirmation"]),
                "watchlistAuthorized": values["watchlistAuthorized"],
                "bestAngleRule": values["bestAngleRule"],
                "bestAngleConfirmation": compact(values["bestAngleConfirmation"]),
                "bestAngleConfirmationGates": values["bestAngleConfirmationGates"],
                "bestAngleAuthorized": values["bestAngleAuthorized"],
            }
            for market, values in market_reports.items()
        },
        "report": str(report_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
