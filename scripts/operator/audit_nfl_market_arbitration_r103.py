#!/usr/bin/env python3
"""Chronological NFL independent/market arbitration audit (read-only)."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import logit, ndtr, ndtri
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


AUDIT_RELEASE = "nfl_market_arbitration_audit_2026_09_28_r103"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
TRAIN = (2020, 2021)
SELECTION = (2022, 2023)
CONFIRMATION = (2024, 2025)


def sha(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implied(values: pd.Series | np.ndarray) -> np.ndarray:
    price = np.asarray(values, dtype=float)
    return np.where(price > 0, 100.0 / (price + 100.0), -price / (-price + 100.0))


def no_vig(first: pd.Series | np.ndarray, second: pd.Series | np.ndarray) -> np.ndarray:
    a, b = implied(first), implied(second)
    return a / (a + b)


def football_features(frame: pd.DataFrame) -> list[str]:
    context = {
        "week", "neutral_site", "division_game", "home_rest", "away_rest", "rest_diff",
        "temperature", "wind", "roof_indoor", "surface_grass", "home_elo", "away_elo",
        "elo_diff", "home_games_state", "away_games_state", "home_injury_weight",
        "away_injury_weight", "home_qb_injury_weight", "away_qb_injury_weight",
        "home_out_count", "away_out_count", "home_injury_reported_count",
        "away_injury_reported_count", "home_roster_continuity", "away_roster_continuity",
        "home_qb_epa", "away_qb_epa", "home_qb_cpoe", "away_qb_cpoe",
        "home_qb_sack_rate", "away_qb_sack_rate", "home_qb_turnover_rate",
        "away_qb_turnover_rate", "home_qb_log_dropbacks", "away_qb_log_dropbacks",
        "home_qb_same_as_last_start", "away_qb_same_as_last_start",
        "home_coach_continuity", "away_coach_continuity",
    }
    prefixes = (
        "home_matchup_fast_", "away_matchup_fast_", "home_matchup_slow_", "away_matchup_slow_",
        "home_off_adj_", "away_off_adj_", "home_def_adj_", "away_def_adj_",
    )
    return sorted(c for c in frame.columns if c in context or c.startswith(prefixes))


def point_model() -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("model", HistGradientBoostingRegressor(
            learning_rate=0.03, max_iter=240, max_leaf_nodes=15,
            min_samples_leaf=40, l2_regularization=20.0, random_state=28092026,
        )),
    ])


def load(feature_root: pathlib.Path, opening_root: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    manifest_path = feature_root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text())
    feature_path = pathlib.Path(manifest["featureFile"])
    if not feature_path.exists():
        feature_path = manifest_path.parent / feature_path.name
    if manifest.get("featureRelease") != FEATURE_RELEASE or sha(feature_path) != manifest.get("featureFileSha256"):
        raise RuntimeError("feature release/checksum mismatch")
    frame = pd.read_parquet(feature_path)
    frame["homeJoin"] = frame["home_team"].replace({"LA": "LAR", "WAS": "WSH"})
    frame["awayJoin"] = frame["away_team"].replace({"LA": "LAR", "WAS": "WSH"})

    opening_frames = []
    evidence = []
    for season in range(2020, 2026):
        release = f"bdl_nfl_opening_history_{season}_2026_08_20_r2"
        path = opening_root / "football-research/cache/nfl-market" / f"{release}.manifest.json"
        meta = json.loads(path.read_text())
        data_path = pathlib.Path(meta["dataFile"])
        if not data_path.exists():
            data_path = path.parent / data_path.name
        if meta.get("cacheRelease") != release or sha(data_path) != meta.get("dataSha256"):
            raise RuntimeError(f"opening release/checksum mismatch: {season}")
        payload = json.loads(data_path.read_text())
        games = pd.DataFrame(payload["games"])
        odds = pd.DataFrame(payload["openings"])
        odds = odds[odds["vendor"].eq("draftkings")]
        provider = games.merge(odds, on="gameId", validate="one_to_one")
        opening_frames.append(provider)
        evidence.append({"season": season, "release": release, "rows": len(provider), "sha256": meta["dataSha256"]})
    openings = pd.concat(opening_frames, ignore_index=True)
    joined = openings.merge(
        frame[frame["season"].between(2020, 2025)],
        left_on=["season", "homeTeam", "awayTeam"],
        right_on=["season", "homeJoin", "awayJoin"],
        validate="one_to_one",
    )
    if "week_y" in joined:
        joined["week"] = joined["week_y"]
    elif "week_x" in joined:
        joined["week"] = joined["week_x"]
    joined = joined.sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    return joined, {"featureSha256": manifest["featureFileSha256"], "openings": evidence}


def add_independent(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    features = football_features(result)
    for target, output in (("actual_margin", "ind_margin"), ("actual_total", "ind_total")):
        result[output] = np.nan
        for season in range(2020, 2026):
            train = result["season"].lt(season)
            # Pull pre-2020 training rows from the joined feature columns is impossible after the
            # opening join, so the caller supplies the complete feature frame via retained rows.
            if int(train.sum()) < 250:
                continue
            model = point_model().fit(result.loc[train, features], result.loc[train, target])
            test = result["season"].eq(season)
            result.loc[test, output] = model.predict(result.loc[test, features])
    return result


def sequential_independent(full: pd.DataFrame, joined: pd.DataFrame) -> pd.DataFrame:
    features = football_features(full)
    predictions = []
    for season in range(2020, 2026):
        train = full["season"].lt(season)
        test = joined["season"].eq(season)
        item = joined.loc[test, ["game_id"]].copy()
        for target, output in (("actual_margin", "ind_margin"), ("actual_total", "ind_total")):
            model = point_model().fit(full.loc[train, features], full.loc[train, target])
            item[output] = model.predict(joined.loc[test, features])
        predictions.append(item)
    prediction = pd.concat(predictions, ignore_index=True)
    return joined.merge(prediction, on="game_id", validate="one_to_one")


def market_frame(rows: pd.DataFrame, market: str, fit_seasons: tuple[int, ...]) -> tuple[pd.DataFrame, list[str], np.ndarray]:
    result = rows.copy()
    if market == "spread":
        result["line"] = result["market_home_margin"]
        result["opening_line"] = -result["spreadHomeLine"].astype(float)
        result["independent"] = result["ind_margin"]
        result["outcome"] = result["actual_margin"].gt(result["line"])
        result["push"] = result["actual_margin"].eq(result["line"])
        result["market_fair"] = no_vig(result["home_spread_odds"], result["away_spread_odds"])
        result["opening_fair"] = no_vig(result["spreadHomePrice"], result["spreadAwayPrice"])
        target = result["actual_margin"].to_numpy(float)
    else:
        result["line"] = result["market_total"]
        result["opening_line"] = result["totalLine"].astype(float)
        result["independent"] = result["ind_total"]
        result["outcome"] = result["actual_total"].gt(result["line"])
        result["push"] = result["actual_total"].eq(result["line"])
        result["market_fair"] = no_vig(result["over_odds"], result["under_odds"])
        result["opening_fair"] = no_vig(result["totalOverPrice"], result["totalUnderPrice"])
        target = result["actual_total"].to_numpy(float)
    fit = result["season"].isin(fit_seasons)
    independent_error = target[fit] - result.loc[fit, "independent"].to_numpy(float)
    sigma = float(np.std(independent_error, ddof=1))
    result["ind_probability"] = ndtr((result["independent"] - result["line"]) / sigma)
    result["ind_logit"] = logit(np.clip(result["ind_probability"], 0.01, 0.99))
    result["market_logit"] = logit(np.clip(result["market_fair"], 0.01, 0.99))
    result["movement"] = result["line"] - result["opening_line"]
    result["abs_movement"] = result["movement"].abs()
    result["ind_edge"] = result["independent"] - result["line"]
    result["movement_ind_interaction"] = result["movement"] * result["ind_edge"]
    result["price_move"] = result["market_fair"] - result["opening_fair"]
    result["early"] = result["week"].le(4).astype(float)
    result["line_level"] = result["line"].abs() if market == "spread" else result["line"] - 44.0
    features = [
        "ind_logit", "market_logit", "movement", "abs_movement", "ind_edge",
        "movement_ind_interaction", "price_move", "line_level", "week", "early",
    ]
    return result, features, target


def classifier() -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", LogisticRegression(C=0.1, max_iter=2000, random_state=28092026)),
    ])


def metrics(rows: pd.DataFrame, probability: np.ndarray, point: np.ndarray, target: np.ndarray) -> dict[str, Any]:
    keep = ~rows["push"].to_numpy(bool)
    y = rows["outcome"].to_numpy(int)
    p = np.clip(probability, 0.001, 0.999)
    correct = (p[keep] >= 0.5) == y[keep]
    independent_side = rows["ind_probability"].to_numpy(float) >= 0.5
    candidate_side = p >= 0.5
    flips = keep & (independent_side != candidate_side)
    return {
        "rows": int(keep.sum()),
        "accuracy": float(correct.mean()),
        "brier": float(brier_score_loss(y[keep], p[keep])),
        "logLoss": float(log_loss(y[keep], p[keep], labels=[0, 1])),
        "pointMae": float(mean_absolute_error(target, point)),
        "directions": {"first": int((candidate_side & keep).sum()), "second": int((~candidate_side & keep).sum())},
        "flips": int(flips.sum()),
        "flipCorrect": int((flips & (candidate_side == y)).sum()),
        "flipHarm": int((flips & (independent_side == y)).sum()),
    }


def inverse_brier_pool(fit: pd.DataFrame, test: pd.DataFrame) -> tuple[np.ndarray, float]:
    keep = ~fit["push"].to_numpy(bool)
    y = fit["outcome"].to_numpy(int)[keep]
    independent = np.clip(fit["ind_probability"].to_numpy(float)[keep], 0.01, 0.99)
    market = np.clip(fit["market_fair"].to_numpy(float)[keep], 0.01, 0.99)
    independent_precision = 1.0 / brier_score_loss(y, independent)
    market_precision = 1.0 / brier_score_loss(y, market)
    market_weight = market_precision / (independent_precision + market_precision)
    probability = ndtr(
        (1.0 - market_weight) * ndtri(np.clip(test["ind_probability"].to_numpy(float), 0.01, 0.99))
        + market_weight * ndtri(np.clip(test["market_fair"].to_numpy(float), 0.01, 0.99))
    )
    return probability, float(market_weight)


def evaluate_market(rows: pd.DataFrame, market: str) -> dict[str, Any]:
    base_train, features, target = market_frame(rows, market, TRAIN)
    train_mask = base_train["season"].isin(TRAIN) & ~base_train["push"]
    selection_mask = base_train["season"].isin(SELECTION)
    selected_model = classifier().fit(base_train.loc[train_mask, features], base_train.loc[train_mask, "outcome"])
    selection_p = selected_model.predict_proba(base_train.loc[selection_mask, features])[:, 1]
    selection_rows = base_train.loc[selection_mask].reset_index(drop=True)
    selection_target = target[selection_mask]
    selection_scale = float(np.std(target[train_mask] - base_train.loc[train_mask, "line"], ddof=1))
    selection_point = selection_rows["line"].to_numpy(float) + selection_scale * ndtri(np.clip(selection_p, 0.01, 0.99))
    selection_pool_p, selection_pool_weight = inverse_brier_pool(base_train.loc[train_mask], selection_rows)
    selection_pool_point = selection_rows["line"].to_numpy(float) + selection_scale * ndtri(np.clip(selection_pool_p, 0.01, 0.99))

    confirmation_frame, features, target = market_frame(rows, market, TRAIN + SELECTION)
    fit_mask = confirmation_frame["season"].isin(TRAIN + SELECTION) & ~confirmation_frame["push"]
    confirm_mask = confirmation_frame["season"].isin(CONFIRMATION)
    final_model = classifier().fit(confirmation_frame.loc[fit_mask, features], confirmation_frame.loc[fit_mask, "outcome"])
    confirmation_p = final_model.predict_proba(confirmation_frame.loc[confirm_mask, features])[:, 1]
    confirmation_rows = confirmation_frame.loc[confirm_mask].reset_index(drop=True)
    confirmation_target = target[confirm_mask]
    scale = float(np.std(target[fit_mask] - confirmation_frame.loc[fit_mask, "line"], ddof=1))
    confirmation_point = confirmation_rows["line"].to_numpy(float) + scale * ndtri(np.clip(confirmation_p, 0.01, 0.99))
    confirmation_pool_p, confirmation_pool_weight = inverse_brier_pool(
        confirmation_frame.loc[fit_mask], confirmation_rows,
    )
    confirmation_pool_point = confirmation_rows["line"].to_numpy(float) + scale * ndtri(
        np.clip(confirmation_pool_p, 0.01, 0.99)
    )

    def baselines(part: pd.DataFrame, part_target: np.ndarray) -> dict[str, Any]:
        independent = metrics(part, part["ind_probability"].to_numpy(float), part["independent"].to_numpy(float), part_target)
        market = metrics(part, part["market_fair"].to_numpy(float), part["line"].to_numpy(float), part_target)
        return {"independent": independent, "market": market}

    confirmation_metrics = metrics(confirmation_rows, confirmation_p, confirmation_point, confirmation_target)
    by_season = {}
    for season in CONFIRMATION:
        keep = confirmation_rows["season"].eq(season).to_numpy()
        by_season[str(season)] = metrics(
            confirmation_rows.loc[keep].reset_index(drop=True), confirmation_p[keep],
            confirmation_point[keep], confirmation_target[keep],
        )
    base = baselines(confirmation_rows, confirmation_target)
    gates = {
        "pooledAccuracyAboveHalf": confirmation_metrics["accuracy"] > 0.5,
        "eachSeasonAccuracyAtLeastHalf": all(v["accuracy"] >= 0.5 for v in by_season.values()),
        "bothDirectionsEachSeason": all(v["directions"]["first"] and v["directions"]["second"] for v in by_season.values()),
        "brierImprovesIndependent": confirmation_metrics["brier"] < base["independent"]["brier"],
        "logLossImprovesIndependent": confirmation_metrics["logLoss"] < base["independent"]["logLoss"],
        "brierNoWorseMarket": confirmation_metrics["brier"] <= base["market"]["brier"],
        "logLossNoWorseMarket": confirmation_metrics["logLoss"] <= base["market"]["logLoss"],
        "pointMaeImprovesIndependent": confirmation_metrics["pointMae"] < base["independent"]["pointMae"],
        "pointMaeMarketBounded": confirmation_metrics["pointMae"] <= base["market"]["pointMae"] + 0.10,
        "netHelpfulFlips": confirmation_metrics["flipCorrect"] > confirmation_metrics["flipHarm"],
    }
    gates["historicalGatePassed"] = all(gates.values())
    return {
        "selection": {
            "candidate": metrics(selection_rows, selection_p, selection_point, selection_target),
            "inverseBrierExpertPool": {
                **metrics(selection_rows, selection_pool_p, selection_pool_point, selection_target),
                "marketWeight": selection_pool_weight,
            },
            **baselines(selection_rows, selection_target),
        },
        "confirmation": {
            "candidate": confirmation_metrics,
            "inverseBrierExpertPool": {
                **metrics(confirmation_rows, confirmation_pool_p, confirmation_pool_point, confirmation_target),
                "marketWeight": confirmation_pool_weight,
            },
            **base, "bySeason": by_season, "gates": gates,
        },
        "coefficients": dict(zip(features, final_model.named_steps["model"].coef_[0].tolist())),
        "intercept": float(final_model.named_steps["model"].intercept_[0]),
        "residualScale": scale,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--feature-root", type=pathlib.Path, required=True)
    parser.add_argument("--opening-root", type=pathlib.Path, required=True)
    args = parser.parse_args()
    joined, evidence = load(args.feature_root, args.opening_root)
    manifest_path = args.feature_root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text())
    feature_path = pathlib.Path(manifest["featureFile"])
    if not feature_path.exists():
        feature_path = manifest_path.parent / feature_path.name
    full = pd.read_parquet(feature_path)
    rows = sequential_independent(full, joined)
    report = {
        "auditRelease": AUDIT_RELEASE,
        "readOnly": True,
        "productionBehaviorChanged": False,
        "predeclaration": "docs/model-audits/2026-09-28-nfl-market-arbitration-r103-predeclaration.md",
        "chronology": {"training": TRAIN, "selection": SELECTION, "confirmation": CONFIRMATION},
        "evidence": evidence,
        "spread": evaluate_market(rows, "spread"),
        "total": evaluate_market(rows, "total"),
    }
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
