#!/usr/bin/env python3
"""Read-only, family-separated NFL player-props loss/win root-cause audit."""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
from collections import Counter, defaultdict
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_FEATURES = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.parquet"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards", "rushing_attempts",
    "rushing_yards", "receptions", "receiving_yards", "anytime_td",
)
ACTIONABLE = {"Best Angle", "Lean"}
SEED = 20261015
MATCHUP_COLUMNS = {
    "passing_attempts": ["matchup_position_opponent_allowed_passing_attempts_ewm"],
    "passing_completions": ["matchup_position_opponent_allowed_passing_completions_ewm"],
    "passing_yards": ["matchup_position_opponent_allowed_passing_yards_ewm"],
    "rushing_attempts": ["matchup_position_opponent_allowed_rushing_attempts_ewm"],
    "rushing_yards": ["matchup_position_opponent_allowed_rushing_yards_ewm"],
    "receptions": ["matchup_position_opponent_allowed_receptions_ewm"],
    "receiving_yards": ["matchup_position_opponent_allowed_receiving_yards_ewm"],
    "anytime_td": ["matchup_position_opponent_allowed_rushing_yards_ewm", "matchup_position_opponent_allowed_receiving_yards_ewm"],
}


def normalize(value: str) -> str:
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", value.lower())


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def ratio(numerator: Any, denominator: Any) -> float | None:
    first, second = finite(numerator), finite(denominator)
    return first / second if first is not None and second is not None and abs(second) > 1e-9 else None


def implied(price: Any) -> float | None:
    value = finite(price)
    if value is None or value == 0:
        return None
    return -value / (-value + 100) if value < 0 else 100 / (value + 100)


def median_columns(row: pd.Series, columns: list[str]) -> float | None:
    values = [finite(row.get(column)) for column in columns]
    present = [value for value in values if value is not None]
    return float(np.median(present)) if present else None


def team_actuals(frame: pd.DataFrame) -> pd.DataFrame:
    columns = ["passing_attempts", "passing_completions", "passing_yards", "rushing_attempts", "rushing_yards", "targets"]
    return frame.groupby(["week", "game_id", "team"], observed=True)[columns].sum(min_count=1).add_prefix("actual_team_").reset_index()


def feature_values(row: pd.Series, teams: pd.DataFrame, market: str) -> dict[str, float | None]:
    team = teams[(teams["week"] == row["week"]) & (teams["game_id"] == row["game_id"]) & (teams["team"] == row["team"])]
    team_row = team.iloc[0] if len(team) else pd.Series(dtype=float)
    role = ratio(row.get("offense_snap_pct"), median_columns(row, ["prior_offense_snap_pct_ewm", "prior_offense_snap_pct_avg3", "prior_offense_snap_pct_season_avg"]))
    if market.startswith("passing_"):
        team_ratio = ratio(team_row.get("actual_team_passing_attempts"), median_columns(row, ["prior_team_pass_attempts_ewm", "prior_team_pass_attempts_avg3", "prior_team_pass_attempts_avg5"]))
        share = ratio(row.get("pass_attempt_share"), median_columns(row, ["prior_pass_attempt_share_ewm", "prior_pass_attempt_share_avg3", "prior_pass_attempt_share_season_avg"]))
    elif market.startswith("rushing_"):
        team_ratio = ratio(team_row.get("actual_team_rushing_attempts"), median_columns(row, ["prior_team_rush_attempts_ewm", "prior_team_rush_attempts_avg3", "prior_team_rush_attempts_avg5"]))
        share = ratio(row.get("rush_attempt_share"), median_columns(row, ["prior_rush_attempt_share_ewm", "prior_rush_attempt_share_avg3", "prior_rush_attempt_share_season_avg"]))
    else:
        team_ratio = ratio(team_row.get("actual_team_targets"), median_columns(row, ["prior_team_targets_ewm", "prior_team_targets_avg3", "prior_team_targets_avg5"]))
        share = ratio(row.get("target_share"), median_columns(row, ["prior_target_share_ewm", "prior_target_share_avg3", "prior_target_share_season_avg"]))

    efficiency = None
    if market == "passing_completions":
        efficiency = ratio(ratio(row.get("passing_completions"), row.get("passing_attempts")), ratio(row.get("prior_passing_completions_ewm"), row.get("prior_passing_attempts_ewm")))
    elif market == "passing_yards":
        efficiency = ratio(ratio(row.get("passing_yards"), row.get("passing_attempts")), ratio(row.get("prior_passing_yards_ewm"), row.get("prior_passing_attempts_ewm")))
    elif market == "rushing_yards":
        efficiency = ratio(ratio(row.get("rushing_yards"), row.get("rushing_attempts")), ratio(row.get("prior_rushing_yards_ewm"), row.get("prior_rushing_attempts_ewm")))
    elif market == "receptions":
        efficiency = ratio(ratio(row.get("receptions"), row.get("targets")), ratio(row.get("prior_receptions_ewm"), row.get("prior_targets_ewm")))
    elif market == "receiving_yards":
        efficiency = ratio(ratio(row.get("receiving_yards"), row.get("targets")), ratio(row.get("prior_receiving_yards_ewm"), row.get("prior_targets_ewm")))
    elif market == "anytime_td":
        actual_work = (finite(row.get("rushing_attempts")) or 0) + (finite(row.get("targets")) or 0)
        prior_work = (finite(row.get("prior_rushing_attempts_ewm")) or 0) + (finite(row.get("prior_targets_ewm")) or 0)
        share = ratio(actual_work, prior_work)
        team_ratio = None

    return {
        "roleRatio": role, "teamOpportunityRatio": team_ratio, "shareRatio": share, "efficiencyRatio": efficiency,
        "matchupValue": median_columns(row, MATCHUP_COLUMNS[market]),
        "availabilitySeverity": finite(row.get("availability_severity_combined")),
        "depthStarter": finite(row.get("external_depth_starter")),
        "windMph": finite(row.get("external_environment_wind_mph")),
        "temperatureF": finite(row.get("external_environment_temperature_f")),
    }


def harmful(value: float | None, prediction: str) -> float | None:
    if value is None:
        return None
    return (1 - value) if prediction in ("over", "yes") else (value - 1)


def observer_summary(forecast: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    identity = [row for row in rows if row["gameId"] == forecast["gameId"]
                and normalize(row["playerName"]) == normalize(forecast["playerName"])
                and row["market"] == forecast["market"] and float(row["canonicalLine"]) == float(forecast["line"])]
    by_book: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in identity:
        by_book[normalize(row["sportsbook"])][row["landmark"]] = row
    signals = []
    source_counts = Counter()
    for book, landmarks in by_book.items():
        opening, locked = landmarks.get("provider_opening"), landmarks.get("t60_lock")
        if not opening or not locked:
            continue
        category = "pinnacle" if book == "pinnacle" else "novig" if book == "novig" else "fanduel" if book == "fanduel" else "other"
        source_counts[category] += 1
        side = forecast["prediction"]
        opening_price = opening["yesPrice"] if side == "yes" else opening[f"{side}Price"]
        locked_price = locked["yesPrice"] if side == "yes" else locked[f"{side}Price"]
        line_delta = float(locked["observedLine"]) - float(opening["observedLine"])
        line_support = 0 if side == "yes" or abs(line_delta) < 1e-9 else (1 if (side == "over" and line_delta < 0) or (side == "under" and line_delta > 0) else -1)
        first, second = implied(opening_price), implied(locked_price)
        price_delta = None if first is None or second is None else second - first
        price_support = 0 if price_delta is None or abs(price_delta) < 0.025 else (1 if price_delta > 0 else -1)
        signal = line_support if line_support != 0 else price_support
        signals.append({"book": book, "sourceClass": locked["sourceClass"], "category": category, "signal": signal,
                        "lineDelta": line_delta, "priceDeltaPp": None if price_delta is None else 100 * price_delta})
    support = sum(item["signal"] > 0 for item in signals)
    adverse = sum(item["signal"] < 0 for item in signals)
    sharp_adverse = sum(item["signal"] < 0 and item["sourceClass"] == "sharp" for item in signals)
    qualified_reference = source_counts["pinnacle"] + source_counts["novig"]
    if not signals:
        verdict = "unavailable"
    elif support >= 2 and adverse == 0:
        verdict = "confirm"
    elif adverse >= 2 and support == 0 and forecast["grade"] in ACTIONABLE:
        verdict = "demote"
    elif adverse > support:
        verdict = "caution"
    else:
        verdict = "mixed"
    # A correction requires a target-excluded Pinnacle/NoVig pair. The Week 5
    # archive has neither, so no opposite-side authority is reconstructed.
    return {"verdict": verdict, "supportBooks": support, "adverseBooks": adverse,
            "sharpAdverseBooks": sharp_adverse, "qualifiedReferenceBooks": qualified_reference,
            "sourceCategories": dict(source_counts), "sameBookPairs": signals}


def primary_cause(row: dict[str, Any]) -> str:
    if not row["featureMatched"]:
        return "identity_data_quality"
    scores = {
        "participation_role_survival": row.get("roleHarm"),
        "team_opportunity_game_script": row.get("teamOpportunityHarm"),
        "player_share_workload": row.get("shareHarm"),
        "efficiency": row.get("efficiencyHarm"),
    }
    if (row.get("availabilitySeverity") or 0) >= 0.5 and (row.get("roleHarm") or 0) >= 0.2:
        scores["weather_injury_availability"] = (row.get("roleHarm") or 0) + 0.15
    if (row.get("matchupHarm") or 0) >= 1:
        scores["opponent_matchup"] = (row.get("matchupHarm") or 0) / 2
    present = [(name, value) for name, value in scores.items() if value is not None and value > 0.15]
    return max(present, key=lambda item: item[1])[0] if present else "distribution_tail_calibration"


def bootstrap_interval(values: list[float]) -> list[float] | None:
    if len(values) < 5:
        return None
    rng = np.random.default_rng(SEED)
    array = np.asarray(values, dtype=float)
    draws = [float(np.mean(rng.choice(array, len(array), replace=True))) for _ in range(4000)]
    return [float(np.quantile(draws, 0.025)), float(np.quantile(draws, 0.975))]


def summarize_market(rows: list[dict[str, Any]]) -> dict[str, Any]:
    losses = [row for row in rows if row["result"] == "loss"]
    wins = [row for row in rows if row["result"] == "win"]
    matches = []
    for loss in losses:
        pool = [win for win in wins if win["position"] == loss["position"]] or wins
        if not pool:
            continue
        match = min(pool, key=lambda win: abs((win.get("finalProbability") or 0.5) - (loss.get("finalProbability") or 0.5))
                    + 0.25 * (win["grade"] != loss["grade"]))
        matches.append((loss, match))
    contrasts = {}
    for name in ("roleHarm", "teamOpportunityHarm", "shareHarm", "efficiencyHarm", "matchupHarm"):
        deltas = [float(loss[name]) - float(win[name]) for loss, win in matches if loss.get(name) is not None and win.get(name) is not None]
        interval = bootstrap_interval(deltas)
        contrasts[name] = {"pairs": len(deltas), "meanLossMinusMatchedWin": float(np.mean(deltas)) if deltas else None,
                           "clusterFreeBootstrap95": interval,
                           "repeatable": bool(interval and interval[0] > 0)}
    return {
        "rows": len(rows), "positions": dict(Counter(row["position"] for row in rows)),
        "wins": len(wins), "losses": len(losses), "pushes": sum(row["result"] == "push" for row in rows),
        "actionable": sum(row["grade"] in ACTIONABLE for row in rows),
        "actionableLosses": sum(row["grade"] in ACTIONABLE and row["result"] == "loss" for row in rows),
        "forecastDirectionFailures": len(losses),
        "exactPriceGradeFailures": sum(row["grade"] in ACTIONABLE and row["result"] == "loss" for row in rows),
        "rootCausesLosses": dict(Counter(row["primaryCause"] for row in losses)),
        "rootCausesWinsCounterfactual": dict(Counter(row["primaryCause"] for row in wins)),
        "matchedLossWinContrasts": contrasts,
        "marketReader": {
            "verdicts": dict(Counter(row["marketReader"]["verdict"] for row in rows)),
            "lossVerdicts": dict(Counter(row["marketReader"]["verdict"] for row in losses)),
            "winVerdicts": dict(Counter(row["marketReader"]["verdict"] for row in wins)),
            "demotionsAvoidedLosses": sum(row["marketReader"]["verdict"] == "demote" and row["result"] == "loss" for row in rows),
            "demotionsHarmedWins": sum(row["marketReader"]["verdict"] == "demote" and row["result"] == "win" for row in rows),
            "qualifiedReferenceRows": sum(row["marketReader"]["qualifiedReferenceBooks"] > 0 for row in rows),
        },
        "featureMatched": sum(row["featureMatched"] for row in rows),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracking-report", type=pathlib.Path, required=True)
    parser.add_argument("--evidence", type=pathlib.Path, required=True)
    parser.add_argument("--features", type=pathlib.Path, default=DEFAULT_FEATURES)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    tracking = json.loads(args.tracking_report.read_text(encoding="utf-8"))
    evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
    forecasts = [row for row in tracking["forecasts"] if row["canonicalMainLine"] and row["market"] in MARKETS]
    observer_rows = evidence["marketObserver"]["history"]["rows"]
    raw_rows = evidence["privateHistory"]["rows"]
    features = pd.read_parquet(args.features)
    features = features[(features["season"] == 2026) & (features["week"] == 5)].copy()
    features["normalizedPlayer"] = features["player_name"].map(normalize)
    duplicate_names = set(features.loc[features.duplicated("normalizedPlayer", keep=False), "normalizedPlayer"])
    feature_by_name = {row["normalizedPlayer"]: row for _, row in features.iterrows() if row["normalizedPlayer"] not in duplicate_names}
    teams = team_actuals(features)
    raw_index = defaultdict(list)
    for row in raw_rows:
        raw_index[(row["gameId"], normalize(row["playerName"]), row["market"], float(row["line"]), row["decisionRelease"])].append(row)
    ledger = []
    for forecast in forecasts:
        key = (forecast["gameId"], normalize(forecast["playerName"]), forecast["market"], float(forecast["line"]), forecast["decisionRelease"])
        exact = raw_index.get(key, [])
        feature = feature_by_name.get(normalize(forecast["playerName"]))
        values = feature_values(feature, teams, forecast["market"]) if feature is not None else {}
        position = str(feature["position"]) if feature is not None else (exact[0].get("position") if exact else "unknown")
        projection = finite(forecast.get("independentProjection"))
        point_residual = None if projection is None else projection - float(forecast["actual"])
        side_sign = 1 if forecast["prediction"] in ("over", "yes") else -1
        matchup_value = values.get("matchupValue")
        market_position_values = features.loc[features["position"].eq(position)]
        matchup_columns = MATCHUP_COLUMNS[forecast["market"]]
        matchup_pool = pd.to_numeric(market_position_values[matchup_columns].stack(), errors="coerce") if len(market_position_values) else pd.Series(dtype=float)
        matchup_z = None if matchup_value is None or matchup_pool.std() == 0 else (matchup_value - float(matchup_pool.mean())) / float(matchup_pool.std())
        row = {**forecast, "position": position, "featureMatched": feature is not None,
               "pointResidual": point_residual, "distanceFromLine": None if projection is None else abs(projection - float(forecast["line"])),
               **values, "roleHarm": harmful(values.get("roleRatio"), forecast["prediction"]),
               "teamOpportunityHarm": harmful(values.get("teamOpportunityRatio"), forecast["prediction"]),
               "shareHarm": harmful(values.get("shareRatio"), forecast["prediction"]),
               "efficiencyHarm": harmful(values.get("efficiencyRatio"), forecast["prediction"]),
               "matchupHarm": None if matchup_z is None else -side_sign * matchup_z,
               "marketReader": observer_summary(forecast, observer_rows)}
        row["primaryCause"] = primary_cause(row)
        ledger.append(row)
    unmatched = tracking["coverage"]["unmatchedOutcomes"]
    result = {
        "release": "nfl_player_props_release_pure_loss_ledger_2026_10_15_r1",
        "readOnly": True, "productionWrites": 0, "marketFeaturesInIndependentModel": [],
        "scope": {"season": 2026, "week": 5, "settledCanonicalScopes": len(ledger),
                  "completeBoardCaptureBeginsWeek": 5, "unmatchedExactOffers": unmatched,
                  "marketObserverRows": len(observer_rows), "sourceLimitation": "Week 5 has Circa/retail/unknown observations but no historical Pinnacle or NoVig archive."},
        "allFamilies": summarize_market(ledger),
        "byMarket": {market: summarize_market([row for row in ledger if row["market"] == market]) for market in MARKETS},
        "ledger": ledger,
        "advancement": {"authorized": False, "reason": "One complete-board week diagnoses candidates; historical chronological confirmation remains required before a model or decision release."},
    }
    encoded = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(json.dumps({"release": result["release"], "scope": result["scope"], "byMarket": result["byMarket"]}, indent=2))


if __name__ == "__main__":
    main()
