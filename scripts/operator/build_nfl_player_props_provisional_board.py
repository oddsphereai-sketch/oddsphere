#!/usr/bin/env python3
"""Build the exact-price 2026 NFL props provisional production-candidate board."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys
import time
import unicodedata
from typing import Any

import joblib
import numpy as np
import pandas as pd


RELEASE = "nfl_player_props_provisional_board_2026_08_25_r1"
SCORER_PATH = pathlib.Path("lib/services/football/nfl_player_props_shadow_model.py")
VOLUME_ARTIFACT = pathlib.Path("football-research/cache/nfl-player-props-calibration/nfl_player_props_distribution_shadow_2026_08_25_r2.joblib")
MARKET_RESIDUAL_REPORT = pathlib.Path("football-research/cache/nfl-player-props-market-residual/nfl_player_props_market_residual_r1.json")
TOUCHDOWN_ARTIFACT = pathlib.Path("football-research/cache/nfl-player-props-touchdowns/nfl_player_props_anytime_td_r2.joblib")
TOUCHDOWN_REPORT = pathlib.Path("football-research/cache/nfl-player-props-touchdowns/nfl_player_props_anytime_td_tournament_r2.json")
DECISION_CONTRACT = pathlib.Path("lib/services/football/nflPlayerPropsDecisionContract.json")
OUTPUT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-production-candidate")


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def normalized_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", ascii_value)


def logit(value: float) -> float:
    clipped = float(np.clip(value, 1e-5, 1 - 1e-5))
    return float(np.log(clipped / (1 - clipped)))


def residual_probability(model: float, market: float, weight: float) -> float:
    value = logit(market) + weight * (logit(model) - logit(market))
    return float(1 / (1 + np.exp(-value)))


def implied(price: int) -> float:
    return -price / (-price + 100) if price < 0 else 100 / (price + 100)


def profit(price: int) -> float:
    return 100 / abs(price) if price < 0 else price / 100


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=pathlib.Path, required=True)
    parser.add_argument("--feature-manifest", type=pathlib.Path, required=True)
    parser.add_argument("--exact-board", type=pathlib.Path, required=True)
    parser.add_argument("--output-root", type=pathlib.Path, default=OUTPUT_ROOT)
    args = parser.parse_args()
    started = time.perf_counter()
    decision = json.loads(DECISION_CONTRACT.read_text(encoding="utf-8"))
    feature_manifest = json.loads(args.feature_manifest.read_text(encoding="utf-8"))
    features = pd.read_parquet(args.features)
    exact = json.loads(args.exact_board.read_text(encoding="utf-8"))
    scorer = load_module("nfl_props_provisional_scorer", SCORER_PATH)
    volume_artifact = scorer.load_shadow_artifact(VOLUME_ARTIFACT)
    market_residual = json.loads(MARKET_RESIDUAL_REPORT.read_text(encoding="utf-8"))
    td_artifact = joblib.load(TOUCHDOWN_ARTIFACT)
    td_report = json.loads(TOUCHDOWN_REPORT.read_text(encoding="utf-8"))
    if td_artifact["modelRelease"] != td_report["modelRelease"] or td_artifact["calibrationRelease"] != td_report["calibrationRelease"]:
        raise RuntimeError("NFL props touchdown artifact release mismatch")
    features["_key"] = features["game_id"].astype(str) + "|" + features["player_name"].astype(str).map(normalized_name)
    feature_by_key = {row["_key"]: row for _, row in features.iterrows()}
    scoreable = features[features["score_eligible"]].copy()
    volume_scores = scorer.score_shadow_rows(volume_artifact, scoreable)
    volume_scores["_key"] = scoreable["_key"].to_numpy()
    score_by_key = {row["_key"]: row for _, row in volume_scores.iterrows()}

    td_features = list(td_artifact["features"])
    td_scoreable = scoreable.dropna(subset=[]).copy()
    td_raw = td_artifact["model"].predict_proba(td_scoreable[td_features])[:, 1]
    td_base = np.clip(td_raw, 0.005, 0.995)
    logits = np.log(td_base / (1 - td_base)).reshape(-1, 1)
    td_probability = td_artifact["calibrator"].predict_proba(logits)[:, 1]
    td_probability_by_key = dict(zip(td_scoreable["_key"], td_probability, strict=True))

    offers = [offer for offer in exact["offers"] if offer["gradeEligibleMarket"]]
    group_books: dict[tuple[str, str, str, float], int] = {}
    for offer in offers:
        key = (offer["canonicalGameId"], normalized_name(offer["playerName"]), offer["market"], float(offer["line"]))
        group_books.setdefault(key, set()).add(offer["sportsbook"])
    group_books = {key: len(value) for key, value in group_books.items()}
    rows: list[dict[str, Any]] = []
    evaluated_at = pd.Timestamp(exact["evaluatedAt"])
    for offer in offers:
        player_key = f"{offer['canonicalGameId']}|{normalized_name(offer['playerName'])}"
        feature = feature_by_key.get(player_key)
        score = score_by_key.get(player_key)
        books = group_books[(offer["canonicalGameId"], normalized_name(offer["playerName"]), offer["market"], float(offer["line"]))]
        base = {
            "game_id": offer["canonicalGameId"], "player_name": offer["playerName"], "team": offer["playerTeam"],
            "market": offer["market"], "line": offer["line"], "sportsbook": offer["sportsbook"],
            "provider": offer["provider"], "observed_at": offer["observedAt"], "lock_at": offer["lockAt"],
            "state": offer["state"], "independent_books": books,
        }
        holds = list(offer["healthHolds"])
        if feature is None:
            holds.append("identity_ambiguous")
        elif not bool(feature["score_eligible"]):
            holds.extend(list(feature["health_holds"]))
        if evaluated_at - pd.Timestamp(offer["observedAt"]) > pd.Timedelta(hours=float(decision["maximumQuoteAgeHours"])):
            holds.append("quote_stale")
        participation = None if score is None else float(score["participation_probability"])
        if offer["market"] == "anytime_td":
            price = offer["yesPrice"]
            if price is None:
                holds.append("exact_price_incomplete")
                model_probability = market_probability = final_probability = ev = edge = None
            elif player_key not in td_probability_by_key:
                holds.append("role_ambiguous")
                model_probability = market_probability = final_probability = ev = edge = None
            else:
                model_probability = float(td_probability_by_key[player_key])
                market_probability = implied(int(price))
                final_probability = residual_probability(model_probability, market_probability, float(td_artifact["marketResidualWeight"]))
                edge = final_probability - market_probability
                ev = final_probability * profit(int(price)) - (1 - final_probability)
            if holds:
                grade = "held"
            elif ev is not None and ev >= 0 and edge is not None and edge >= 0:
                # The 2025 TD near-edge band confirmed positive; stronger candidate bands did not.
                grade = "watchlist"
            else:
                grade = "no_play"
            rows.append({**base, "side": "yes", "price": price, "projection": None, "participation_probability": participation,
                "raw_model_probability": model_probability, "market_probability": market_probability, "final_probability": final_probability,
                "probability_edge": edge, "ev": ev, "grade": grade, "provisional": True, "health_holds": sorted(set(holds)),
                "team_implied_points": None if feature is None else feature["team_implied_points"],
                "team_implied_touchdowns": None if feature is None else feature["team_implied_touchdowns"],
                "model_release": td_artifact["modelRelease"], "calibration_release": td_artifact["calibrationRelease"],
                "decision_release": td_report["priceDecisionRelease"]})
            continue
        for side, price_key, market_key in (("over", "overPrice", "overNoVigProbability"), ("under", "underPrice", "underNoVigProbability")):
            side_holds = list(holds)
            price = offer[price_key]
            market_probability = offer[market_key] if side == "over" else (None if offer["underNoVigProbability"] is None else offer["underNoVigProbability"])
            if score is None or price is None or market_probability is None:
                side_holds.append("exact_price_incomplete" if price is None or market_probability is None else "role_ambiguous")
                model_probability = final_probability = edge = ev = projection = None
            else:
                projection = float(score[f"{offer['market']}_projection"])
                model_over = float(scorer.over_probability(np.array([projection]), np.array([float(offer["line"])]), volume_artifact["markets"][offer["market"]]["distribution"])[0])
                model_probability = model_over if side == "over" else 1 - model_over
                market_probability = float(market_probability)
                weight = float(market_residual["selectedWeights"][offer["market"]])
                final_probability = residual_probability(model_probability, market_probability, weight)
                edge = final_probability - market_probability
                ev = final_probability * profit(int(price)) - (1 - final_probability)
            qualified = bool(market_residual["qualifiedMarkets"].get(offer["market"], False))
            thresholds = market_residual["gradeThresholds"]
            if side_holds:
                grade = "held"
            elif not qualified or ev is None or edge is None or ev < 0 or edge < 0:
                grade = "no_play"
            elif ev >= thresholds["bestAngle"]["minimumEv"] and edge >= thresholds["bestAngle"]["minimumProbabilityEdge"] and (participation or 0) >= decision["volumeAndYardage"]["bestAngle"]["minimumParticipationProbability"] and books >= decision["volumeAndYardage"]["bestAngle"]["minimumIndependentBooks"]:
                grade = "best_angle"
            else:
                # The lower r1 Lean band failed exact-price confirmation and remains visible, not actionable.
                grade = "watchlist"
            rows.append({**base, "side": side, "price": price, "projection": projection, "participation_probability": participation,
                "raw_model_probability": model_probability, "market_probability": market_probability, "final_probability": final_probability,
                "probability_edge": edge, "ev": ev, "grade": grade, "provisional": True, "health_holds": sorted(set(side_holds)),
                "market_residual_weight": market_residual["selectedWeights"].get(offer["market"]), "market_residual_qualified": qualified,
                "model_release": volume_artifact["shadowModelRelease"], "calibration_release": volume_artifact["calibrationRelease"],
                "decision_release": market_residual["decisionRelease"]})
    board = pd.DataFrame(rows)
    # Keep the best exact price for each executable outcome; retain Held rows for visible diagnosis.
    board["price_sort"] = pd.to_numeric(board["price"], errors="coerce").fillna(-100000)
    board = board.sort_values("price_sort", ascending=False).drop_duplicates(["game_id", "player_name", "market", "line", "side"], keep="first").drop(columns="price_sort")
    counts = board["grade"].value_counts().to_dict()
    actionable = board[board["grade"].isin(["best_angle", "lean"])]
    runtime_ms = (time.perf_counter() - started) * 1000
    output = {
        "release": RELEASE,
        "generatedAt": pd.Timestamp.now(tz="UTC").isoformat(),
        "evaluatedAt": exact["evaluatedAt"],
        "modelRelease": volume_artifact["shadowModelRelease"],
        "calibrationRelease": volume_artifact["calibrationRelease"],
        "marketResidualRelease": market_residual["marketResidualRelease"],
        "touchdownModelRelease": td_artifact["modelRelease"],
        "provisional": True,
        "publicationEnabled": False,
        "trackingEnabled": False,
        "boardCounts": {"rows": int(len(board)), **{key: int(value) for key, value in counts.items()}, "actionable": int(len(actionable))},
        "boardImpact": {"promotions": int(len(actionable)), "demotions": 0, "netActionableChange": int(len(actionable))},
        "marketCounts": {market: {grade: int(count) for grade, count in group["grade"].value_counts().items()} for market, group in board.groupby("market", observed=True)},
        "loadEvidence": {"featureRows": int(len(features)), "scoreEligibleRows": int(len(scoreable)), "exactOffersRead": int(len(exact["offers"])), "candidateRows": int(len(board)), "runtimeMs": runtime_ms, "memberProviderCalls": 0},
        "featureManifest": feature_manifest,
        "rows": board.replace({np.nan: None}).to_dict(orient="records"),
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    output_path = args.output_root / "nfl_player_props_2026_week_1_provisional_board_r1.json"
    output_path.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({key: output[key] for key in ("release", "boardCounts", "boardImpact", "marketCounts", "loadEvidence")}, indent=2))


if __name__ == "__main__":
    main()
