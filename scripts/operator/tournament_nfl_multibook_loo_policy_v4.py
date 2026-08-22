#!/usr/bin/env python3
"""Chronological NFL multi-book leave-one-book-out exact-price tournament.

Shadow research only. A target sportsbook is excluded from every market input
used to estimate its offer. Exact target prices enter only after the forecast
to calculate EV and settle one-unit returns. Bet count is always an output;
this tournament contains no weekly action quota.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import time
import warnings
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import logit
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error

import tournament_nfl_opening_residual_v2 as r2

warnings.simplefilter("ignore", pd.errors.PerformanceWarning)


TOURNAMENT_RELEASE = "nfl_multibook_loo_exact_price_tournament_2026_08_22_r4"
FORECAST_RELEASE = "nfl_multibook_loo_margin_shadow_2026_08_22_r4"
CALIBRATION_RELEASE = "nfl_multibook_loo_probability_shadow_2026_08_22_r4"
DECISION_RELEASE = "nfl_multibook_loo_exact_price_shadow_2026_08_22_r4"
FEATURE_RELEASE = "nfl_player_value_features_2016_2025_2026_08_20_r3"
MARGIN_CANDIDATE = r2.Candidate("residual", "multiscale_player", "hist_l20", 0.25)
ZERO_TOTAL_REASON = "The previously selected total residual failed both 2024 and 2025 confirmation seasons."
OPENING_RELEASES = {
    2021: "bdl_nfl_opening_history_2021_2026_08_20_r1",
    2022: "bdl_nfl_opening_history_2022_2026_08_20_r2",
    2023: "bdl_nfl_opening_history_2023_2026_08_20_r2",
    2024: "bdl_nfl_opening_history_2024_2026_08_20_r2",
    2025: "bdl_nfl_opening_history_2025_2026_08_20_r1",
}
COMPARABLE_BOOKS = {"fanduel", "draftkings", "caesars", "betmgm", "fanatics", "betrivers"}
FORECAST_SEASONS = (2022, 2023, 2024, 2025)
POLICY_SELECTION_SEASONS = (2023,)
CONFIRMATION_SEASONS = (2024, 2025)
PRICE_BANDS = {
    "bounded": (-300.0, 200.0),
    "favorite": (-300.0, -101.0),
    "competitive": (-150.0, 150.0),
    "short_dog": (100.0, 200.0),
}


@dataclass(frozen=True)
class Policy:
    markets: tuple[str, ...]
    price_band: str
    minimum_ev: float
    minimum_edge_pp: float
    minimum_probability: float

    @property
    def name(self) -> str:
        return (
            f"{'_'.join(self.markets)}__{self.price_band}"
            f"__ev{self.minimum_ev:.2f}__edge{self.minimum_edge_pp:.1f}"
            f"__p{self.minimum_probability:.2f}"
        )


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_file(root: pathlib.Path, recorded: str | pathlib.Path) -> pathlib.Path:
    recorded_path = pathlib.Path(recorded)
    if recorded_path.exists():
        return recorded_path
    candidates = list(root.rglob(recorded_path.name))
    if len(candidates) != 1:
        raise RuntimeError(f"cannot resolve checksum-pinned source {recorded_path.name}: {len(candidates)} candidates")
    return candidates[0]


def implied(price: float | np.ndarray | pd.Series) -> np.ndarray:
    values = np.asarray(price, dtype=float)
    result = np.full(values.shape, np.nan, dtype=float)
    positive = values > 0
    negative = values < 0
    result[positive] = 100.0 / (values[positive] + 100.0)
    result[negative] = -values[negative] / (-values[negative] + 100.0)
    return result


def fair(first: float, second: float) -> float:
    values = implied(np.asarray([first, second], dtype=float))
    return float(values[0] / values.sum())


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def load_features(source_root: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    manifest_path = source_root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r3.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    data_path = source_file(source_root, manifest["featureFile"])
    if manifest.get("featureRelease") != FEATURE_RELEASE or sha256_file(data_path) != manifest.get("featureFileSha256"):
        raise RuntimeError("NFL feature release/checksum mismatch")
    frame = pd.read_parquet(data_path).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    frame["homeJoin"] = frame["home_team"].replace({"LA": "LAR", "WAS": "WSH"})
    frame["awayJoin"] = frame["away_team"].replace({"LA": "LAR", "WAS": "WSH"})
    return frame, manifest


def load_multibook_openings(source_root: pathlib.Path, features: pd.DataFrame) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    parts: list[pd.DataFrame] = []
    evidence: list[dict[str, Any]] = []
    for season, release in OPENING_RELEASES.items():
        manifest_path = source_root / "football-research/cache/nfl-market" / f"{release}.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        data_path = source_file(source_root, manifest["dataFile"])
        if manifest.get("cacheRelease") != release or sha256_file(data_path) != manifest.get("dataSha256"):
            raise RuntimeError(f"opening cache release/checksum mismatch: {release}")
        payload = json.loads(data_path.read_text(encoding="utf-8"))
        games = pd.DataFrame(payload["games"])
        odds = pd.DataFrame(payload["openings"])
        odds["vendor"] = odds["vendor"].str.lower()
        odds = odds[odds["vendor"].isin(COMPARABLE_BOOKS)].copy()
        if odds.duplicated(["gameId", "vendor"]).any():
            raise RuntimeError(f"duplicate game/vendor opening rows: {release}")
        provider = games.merge(odds, on="gameId", validate="one_to_many")
        joined = provider.merge(
            features[features["season"].eq(season)],
            left_on=["season", "homeTeam", "awayTeam"],
            right_on=["season", "homeJoin", "awayJoin"],
            validate="many_to_one",
        )
        if "week_x" in joined and "week_y" in joined:
            if not joined["week_x"].astype(int).equals(joined["week_y"].astype(int)):
                raise RuntimeError(f"opening/feature week mismatch: {release}")
            joined["week"] = joined["week_y"].astype(int)
        parts.append(joined)
        evidence.append({
            "season": season,
            "release": release,
            "sha256": manifest["dataSha256"],
            "games": int(games["gameId"].nunique()),
            "offers": int(len(odds)),
            "books": {str(key): int(value) for key, value in odds["vendor"].value_counts().sort_index().items()},
        })
    offers = pd.concat(parts, ignore_index=True)
    required = [
        "moneylineHome", "moneylineAway", "spreadHomeLine", "spreadHomePrice",
        "spreadAwayLine", "spreadAwayPrice", "totalLine", "totalOverPrice", "totalUnderPrice",
    ]
    offers[required] = offers[required].apply(pd.to_numeric, errors="coerce")
    offers = offers.dropna(subset=required).copy()
    return offers, evidence


def build_loo_frames(offers: pd.DataFrame) -> dict[str, pd.DataFrame]:
    frames: dict[str, list[pd.Series]] = {}
    for (_, _), group in offers.groupby(["season", "gameId"], sort=True):
        if group["vendor"].nunique() < 3:
            continue
        for _, target in group.iterrows():
            others = group[group["vendor"].ne(target["vendor"])]
            if others["vendor"].nunique() < 2:
                continue
            record = target.copy()
            record["loo_home_margin"] = float(np.median(-others["spreadHomeLine"].to_numpy(float)))
            record["loo_total"] = float(np.median(others["totalLine"].to_numpy(float)))
            record["loo_home_ml_fair"] = float(np.mean([
                fair(float(row.moneylineHome), float(row.moneylineAway)) for row in others.itertuples()
            ]))
            same_spread = others[np.isclose(others["spreadHomeLine"], float(target["spreadHomeLine"]))]
            same_total = others[np.isclose(others["totalLine"], float(target["totalLine"]))]
            record["loo_home_spread_fair"] = (
                float(np.mean([fair(float(row.spreadHomePrice), float(row.spreadAwayPrice)) for row in same_spread.itertuples()]))
                if same_spread["vendor"].nunique() >= 2 else np.nan
            )
            record["loo_over_fair"] = (
                float(np.mean([fair(float(row.totalOverPrice), float(row.totalUnderPrice)) for row in same_total.itertuples()]))
                if same_total["vendor"].nunique() >= 2 else np.nan
            )
            record["target_home_ml_fair"] = fair(float(target["moneylineHome"]), float(target["moneylineAway"]))
            record["target_home_spread_fair"] = fair(float(target["spreadHomePrice"]), float(target["spreadAwayPrice"]))
            record["target_over_fair"] = fair(float(target["totalOverPrice"]), float(target["totalUnderPrice"]))
            record["terminal_home_ml_fair"] = fair(float(target["home_moneyline"]), float(target["away_moneyline"]))
            record["loo_other_books"] = ",".join(sorted(str(value) for value in others["vendor"].unique()))
            record["loo_other_book_count"] = int(others["vendor"].nunique())
            if str(target["vendor"]) in record["loo_other_books"].split(","):
                raise RuntimeError("target sportsbook leaked into its own leave-one-book-out consensus")
            frames.setdefault(str(target["vendor"]), []).append(record)
    return {
        book: pd.DataFrame(rows).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
        for book, rows in frames.items()
    }


def forecast_book(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    engineered, feature_sets = r2.engineer(frame)
    predictions: list[pd.DataFrame] = []
    by_season: dict[str, Any] = {}
    for season in FORECAST_SEASONS:
        train_mask = frame["season"].lt(season) & frame["actual_margin"].notna() & frame["loo_home_margin"].notna()
        test_mask = frame["season"].eq(season) & frame["actual_margin"].notna() & frame["loo_home_margin"].notna()
        if train_mask.sum() < 250 or test_mask.sum() == 0:
            continue
        prediction, _ = r2.fit_candidate(
            MARGIN_CANDIDATE,
            frame.loc[train_mask],
            engineered.loc[train_mask],
            frame.loc[test_mask],
            engineered.loc[test_mask],
            feature_sets["margin"][MARGIN_CANDIDATE.feature_set],
            "actual_margin",
            "loo_home_margin",
        )
        test = frame.loc[test_mask].copy()
        test["margin_projection"] = prediction
        predictions.append(test)
        by_season[str(season)] = {
            "rows": int(len(test)),
            "candidateMae": float(mean_absolute_error(test["actual_margin"], prediction)),
            "looMarketMae": float(mean_absolute_error(test["actual_margin"], test["loo_home_margin"])),
            "maeImprovement": float(mean_absolute_error(test["actual_margin"], test["loo_home_margin"]) - mean_absolute_error(test["actual_margin"], prediction)),
            "meanAbsoluteCorrection": float(np.mean(np.abs(prediction - test["loo_home_margin"].to_numpy(float)))),
        }
    if not predictions:
        return pd.DataFrame(), {"bySeason": {}}
    return pd.concat(predictions, ignore_index=True), {"bySeason": by_season}


def probability_features(market_probability: np.ndarray, edge: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(market_probability, dtype=float), 0.01, 0.99)
    e = np.asarray(edge, dtype=float)
    return np.column_stack([logit(p), e / 7.0, np.sign(e) * np.sqrt(np.abs(e)) / math.sqrt(7.0)])


def add_probabilities(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    output["moneyline_probability"] = np.nan
    output["spread_probability"] = np.nan
    output["total_probability"] = output["loo_over_fair"]
    for market in ("moneyline", "spread"):
        market_col = "loo_home_ml_fair" if market == "moneyline" else "loo_home_spread_fair"
        edge = output["margin_projection"] if market == "moneyline" else output["margin_projection"] + output["spreadHomeLine"]
        outcome = output["actual_margin"].gt(0) if market == "moneyline" else output["actual_margin"].gt(-output["spreadHomeLine"])
        push = output["actual_margin"].eq(0) if market == "moneyline" else output["actual_margin"].eq(-output["spreadHomeLine"])
        for season in (2023, 2024, 2025):
            train = output["season"].lt(season) & output[market_col].notna() & edge.notna() & ~push
            test = output["season"].eq(season) & output[market_col].notna() & edge.notna()
            if train.sum() < 200 or test.sum() == 0:
                continue
            model = LogisticRegression(C=0.10, solver="lbfgs", max_iter=1000, random_state=r2.RANDOM_STATE)
            model.fit(probability_features(output.loc[train, market_col], edge.loc[train]), outcome.loc[train].astype(int))
            output.loc[test, f"{market}_probability"] = model.predict_proba(
                probability_features(output.loc[test, market_col], edge.loc[test])
            )[:, 1]
    return output


def clv(row: pd.Series, market: str, first: bool) -> float:
    if market == "moneyline":
        movement = float(row["terminal_home_ml_fair"] - row["target_home_ml_fair"])
    elif market == "spread":
        movement = float(row["spreadHomeLine"] + row["market_home_margin"])
    else:
        movement = float(row["market_total"] - row["totalLine"])
    return movement if first else -movement


def offer_decisions(frame: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    definitions = {
        "moneyline": ("moneyline_probability", "target_home_ml_fair", "moneylineHome", "moneylineAway"),
        "spread": ("spread_probability", "target_home_spread_fair", "spreadHomePrice", "spreadAwayPrice"),
        "total": ("total_probability", "target_over_fair", "totalOverPrice", "totalUnderPrice"),
    }
    for _, record in frame.iterrows():
        if int(record["season"]) not in (2023, 2024, 2025):
            continue
        for market, (prob_col, target_fair_col, first_price_col, second_price_col) in definitions.items():
            probability = float(record[prob_col])
            target_fair = float(record[target_fair_col])
            if not math.isfinite(probability) or not math.isfinite(target_fair):
                continue
            first_price = float(record[first_price_col])
            second_price = float(record[second_price_col])
            first_ev = probability * profit_one(first_price) - (1.0 - probability)
            second_ev = (1.0 - probability) * profit_one(second_price) - probability
            first = first_ev >= second_ev
            if market == "moneyline":
                first_won = float(record["actual_margin"]) > 0
                push = float(record["actual_margin"]) == 0
            elif market == "spread":
                first_won = float(record["actual_margin"]) > -float(record["spreadHomeLine"])
                push = float(record["actual_margin"]) == -float(record["spreadHomeLine"])
            else:
                first_won = float(record["actual_total"]) > float(record["totalLine"])
                push = float(record["actual_total"]) == float(record["totalLine"])
            price = first_price if first else second_price
            won = first_won if first else not first_won
            rows.append({
                "gameId": str(record["gameId"]), "season": int(record["season"]), "week": int(record["week"]),
                "book": str(record["vendor"]), "market": market, "first": first,
                "probability": probability if first else 1.0 - probability,
                "targetMarketProbability": target_fair if first else 1.0 - target_fair,
                "price": price, "expectedValue": first_ev if first else second_ev,
                "edgePp": 100.0 * ((probability - target_fair) if first else (target_fair - probability)),
                "won": won, "push": push,
                "units": 0.0 if push else profit_one(price) if won else -1.0,
                "clv": clv(record, market, first),
            })
    offers = pd.DataFrame(rows)
    return (
        offers.sort_values(["season", "gameId", "market", "expectedValue", "price"], ascending=[True, True, True, False, False])
        .groupby(["season", "gameId", "market"], sort=True, as_index=False)
        .head(1)
        .reset_index(drop=True)
    )


def policies() -> list[Policy]:
    market_sets = (
        ("moneyline",), ("spread",), ("total",),
        ("moneyline", "spread"), ("moneyline", "spread", "total"),
    )
    return [
        Policy(markets, band, ev, edge, probability)
        for markets in market_sets
        for band in PRICE_BANDS
        for ev in (0.01, 0.02, 0.03, 0.04, 0.05, 0.06)
        for edge in (0.0, 1.0, 2.0, 3.0)
        for probability in (0.50, 0.52, 0.55, 0.57)
    ]


def summarize(rows: pd.DataFrame, seasons: tuple[int, ...], policy: Policy) -> dict[str, Any]:
    low, high = PRICE_BANDS[policy.price_band]
    selected = rows[
        rows["season"].isin(seasons) & rows["market"].isin(policy.markets)
        & rows["price"].between(low, high, inclusive="both")
        & rows["expectedValue"].ge(policy.minimum_ev)
        & rows["edgePp"].ge(policy.minimum_edge_pp)
        & rows["probability"].ge(policy.minimum_probability)
    ].copy()
    resolved = selected[~selected["push"]]
    units = float(selected["units"].sum())
    largest_win = float(selected.loc[selected["units"].gt(0), "units"].max()) if selected["units"].gt(0).any() else 0.0
    by_season = {str(season): summarize_slice(selected[selected["season"].eq(season)]) for season in seasons}
    return {
        "policy": asdict(policy), "policyName": policy.name, "actions": int(len(selected)),
        "wins": int(resolved["won"].sum()), "losses": int((~resolved["won"]).sum()), "pushes": int(selected["push"].sum()),
        "units": units, "roi": units / len(selected) if len(selected) else None,
        "unitsWithoutLargestWin": units - largest_win,
        "positiveClvRate": float(selected["clv"].gt(0).mean()) if len(selected) else None,
        "meanClv": float(selected["clv"].mean()) if len(selected) else None,
        "weeksWithAction": int(selected[["season", "week"]].drop_duplicates().shape[0]),
        "marketMix": {str(key): int(value) for key, value in selected["market"].value_counts().sort_index().items()},
        "bookMix": {str(key): int(value) for key, value in selected["book"].value_counts().sort_index().items()},
        "bySeason": by_season,
        "selectedRows": selected.to_dict(orient="records"),
    }


def summarize_slice(rows: pd.DataFrame) -> dict[str, Any]:
    resolved = rows[~rows["push"]]
    units = float(rows["units"].sum())
    largest_win = float(rows.loc[rows["units"].gt(0), "units"].max()) if rows["units"].gt(0).any() else 0.0
    return {
        "actions": int(len(rows)), "wins": int(resolved["won"].sum()), "losses": int((~resolved["won"]).sum()),
        "pushes": int(rows["push"].sum()), "units": units, "roi": units / len(rows) if len(rows) else None,
        "unitsWithoutLargestWin": units - largest_win,
        "positiveClvRate": float(rows["clv"].gt(0).mean()) if len(rows) else None,
    }


def selection_eligible(result: dict[str, Any]) -> bool:
    return bool(
        result["actions"] >= 15 and result["weeksWithAction"] >= 8 and result["units"] > 0
        and result["unitsWithoutLargestWin"] > 0
        and result["positiveClvRate"] is not None and result["positiveClvRate"] >= 0.52
        and len(result["bookMix"]) >= 2
    )


def confirmation_gates(result: dict[str, Any]) -> dict[str, bool]:
    seasons = list(result["bySeason"].values())
    return {
        "minimumActions": result["actions"] >= 30,
        "positivePooledUnits": result["units"] > 0,
        "positiveEachSeason": all(row["actions"] >= 10 and row["units"] > 0 for row in seasons),
        "largestWinIndependent": result["unitsWithoutLargestWin"] > 0 and all(row["unitsWithoutLargestWin"] > 0 for row in seasons),
        "positiveClvRate": result["positiveClvRate"] is not None and result["positiveClvRate"] >= 0.55,
        "multiBook": len(result["bookMix"]) >= 2,
    }


def probability_metrics(frame: pd.DataFrame) -> dict[str, Any]:
    report: dict[str, Any] = {}
    for market, probability, baseline, outcome, push in (
        ("moneyline", "moneyline_probability", "target_home_ml_fair", frame["actual_margin"].gt(0), frame["actual_margin"].eq(0)),
        ("spread", "spread_probability", "target_home_spread_fair", frame["actual_margin"].gt(-frame["spreadHomeLine"]), frame["actual_margin"].eq(-frame["spreadHomeLine"])),
        ("total", "total_probability", "target_over_fair", frame["actual_total"].gt(frame["totalLine"]), frame["actual_total"].eq(frame["totalLine"])),
    ):
        report[market] = {}
        for season in CONFIRMATION_SEASONS:
            keep = frame["season"].eq(season) & frame[probability].notna() & frame[baseline].notna() & ~push
            y = outcome.loc[keep].astype(int)
            candidate = np.clip(frame.loc[keep, probability].to_numpy(float), 0.001, 0.999)
            offered = np.clip(frame.loc[keep, baseline].to_numpy(float), 0.001, 0.999)
            report[market][str(season)] = {
                "rows": int(len(y)), "candidateBrier": float(brier_score_loss(y, candidate)),
                "offeredBookBrier": float(brier_score_loss(y, offered)),
                "brierImprovement": float(brier_score_loss(y, offered) - brier_score_loss(y, candidate)),
                "candidateLogLoss": float(log_loss(y, candidate, labels=[0, 1])),
                "offeredBookLogLoss": float(log_loss(y, offered, labels=[0, 1])),
            }
    return report


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get("NFL_RESEARCH_SOURCE_ROOT", str(root))).resolve()
    features, feature_manifest = load_features(source_root)
    offers, opening_evidence = load_multibook_openings(source_root, features)
    loo_frames = build_loo_frames(offers)
    scored: list[pd.DataFrame] = []
    forecast_evidence: dict[str, Any] = {}
    for book, frame in sorted(loo_frames.items()):
        predictions, evidence = forecast_book(frame)
        forecast_evidence[book] = evidence
        if not predictions.empty:
            scored.append(add_probabilities(predictions))
    all_scored = pd.concat(scored, ignore_index=True)
    decisions = offer_decisions(all_scored)
    if decisions.duplicated(["season", "gameId", "market"]).any():
        raise RuntimeError("best-offer reduction emitted duplicate game-market decisions")
    selection_results = [summarize(decisions, POLICY_SELECTION_SEASONS, policy) for policy in policies()]
    eligible = [result for result in selection_results if selection_eligible(result)]
    eligible.sort(key=lambda result: (-result["unitsWithoutLargestWin"], -result["units"], -result["positiveClvRate"], result["actions"], result["policyName"]))
    selected = eligible[0] if eligible else None
    confirmation = None
    gates: dict[str, bool] = {}
    if selected:
        policy = Policy(**{**selected["policy"], "markets": tuple(selected["policy"]["markets"])})
        confirmation = summarize(decisions, CONFIRMATION_SEASONS, policy)
        gates = confirmation_gates(confirmation)
    probabilities = probability_metrics(all_scored[all_scored["season"].isin(CONFIRMATION_SEASONS)])
    probability_gate = all(
        probabilities[market][str(season)]["brierImprovement"] >= 0
        for market in ("moneyline", "spread") for season in CONFIRMATION_SEASONS
    )
    accepted = bool(selected and confirmation and all(gates.values()) and probability_gate)
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE, "forecastRelease": FORECAST_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE, "decisionRelease": DECISION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "shadowOnly": True, "productionBehaviorChanged": False, "gradesChanged": False,
        "stakesChanged": False, "trackingChanged": False,
        "chronology": {"forecastSeasons": list(FORECAST_SEASONS), "policySelection": list(POLICY_SELECTION_SEASONS), "confirmation": list(CONFIRMATION_SEASONS)},
        "data": {"featureSha256": feature_manifest["featureFileSha256"], "openingEvidence": opening_evidence,
                 "books": sorted(loo_frames), "looOfferRows": int(sum(len(frame) for frame in loo_frames.values())),
                 "minimumOtherBooks": int(min(frame["loo_other_book_count"].min() for frame in loo_frames.values()))},
        "contract": {"targetBookExcluded": True, "minimumOtherBooks": 2, "bestExactOfferPerGameMarket": True,
                     "weeklyQuota": False, "totalForecastFallback": ZERO_TOTAL_REASON},
        "forecastEvidence": forecast_evidence, "probabilityEvidence": probabilities,
        "probabilityGatePassed": probability_gate, "candidateCount": len(selection_results),
        "selectionEligibleCount": len(eligible), "selectedPolicy": selected,
        "confirmation": confirmation, "confirmationGates": gates,
        "actionablePolicyAccepted": accepted,
        "boardImpact": {"promotions": 0, "demotions": 0, "netActionable": 0},
        "limitations": [
            "Historical openings contain three conventional books in 2021-2023 and four in 2024-2025; current Week 1 has five comparable books.",
            "2024-2025 have been inspected by earlier NFL research and are historical confirmation, not a pristine future holdout.",
            "Confirmed opening-time starter, depth, injury, public-split, sharp-split, and weather history is unavailable and excluded.",
            "A historical pass would remain shadow-only until the current Week 1 feature/scoring path and timestamp-locked T-60 evidence are complete.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE, "books": sorted(loo_frames),
        "looOfferRows": report["data"]["looOfferRows"], "candidateCount": len(selection_results),
        "selectionEligibleCount": len(eligible),
        "selectedPolicy": None if selected is None else {key: value for key, value in selected.items() if key != "selectedRows"},
        "confirmation": None if confirmation is None else {key: value for key, value in confirmation.items() if key != "selectedRows"},
        "confirmationGates": gates, "probabilityGatePassed": probability_gate,
        "actionablePolicyAccepted": accepted, "report": str(report_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
