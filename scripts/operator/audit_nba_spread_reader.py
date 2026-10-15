#!/usr/bin/env python3
"""Chronological, research-only NBA spread-reader audit.

The reader learns whether the home side covers from an independent score model,
the documented opening spread, and point-in-time basketball context. Historical
reference lines with unknown observation timestamps remain non-authoritative;
the report can qualify a forward candidate but can never authorize production.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from scripts.operator import tournament_nba_professional_model as tournament


RELEASE = "nba_spread_reader_audit_2026_10_15_r1_chronological_logistic"
READER_FEATURES = [
    "model_margin",
    "market_margin",
    "model_market_disagreement",
    "absolute_model_market_disagreement",
    "absolute_market_line",
    "elo_home_win_probability",
    "matchup_rest_days_edge",
    "home_margin_5",
    "away_margin_5",
    "home_margin_15",
    "away_margin_15",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--independent-report", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--selection-season", type=int, required=True)
    parser.add_argument("--confirmation-season", type=int, required=True)
    parser.add_argument("--minimum-decisions", type=int, default=100)
    return parser.parse_args()


def reader_rows(
    all_rows: pd.DataFrame,
    evaluation_season: int,
    features: list[str],
    model: dict[str, Any],
    architecture: str,
) -> pd.DataFrame:
    train = all_rows[all_rows["season"] < evaluation_season].copy()
    evaluate = all_rows[all_rows["season"] == evaluation_season].copy().reset_index(drop=True)
    if train.empty or evaluate.empty:
        raise ValueError(f"NBA spread reader lacks a prior-season partition for {evaluation_season}")
    home, away, _ = tournament.fit_predict(train, evaluate, features, model, architecture)
    model_margin = home - away
    home_spread = evaluate["evaluation_opening_home_spread"].to_numpy(float)
    market_margin = -home_spread
    actual_cover_margin = evaluate["target_home_margin"].to_numpy(float) + home_spread
    resolved = np.isfinite(home_spread) & ~np.isclose(actual_cover_margin, 0.0)
    output = pd.DataFrame({
        "season": evaluation_season,
        "game_id": evaluate["game_id"].to_numpy(int),
        "feature_cutoff": evaluate["feature_cutoff"].astype(str),
        "model_margin": model_margin,
        "market_margin": market_margin,
        "model_market_disagreement": model_margin - market_margin,
        "absolute_model_market_disagreement": np.abs(model_margin - market_margin),
        "absolute_market_line": np.abs(home_spread),
        "elo_home_win_probability": evaluate["elo_home_win_probability"].to_numpy(float),
        "matchup_rest_days_edge": evaluate["matchup_rest_days_edge"].to_numpy(float),
        "home_margin_5": evaluate["home_margin_5"].to_numpy(float),
        "away_margin_5": evaluate["away_margin_5"].to_numpy(float),
        "home_margin_15": evaluate["home_margin_15"].to_numpy(float),
        "away_margin_15": evaluate["away_margin_15"].to_numpy(float),
        "home_cover": (actual_cover_margin > 0).astype(int),
        "home_price": evaluate["evaluation_opening_home_spread_price"].to_numpy(float),
        "away_price": evaluate["evaluation_opening_away_spread_price"].to_numpy(float),
        "home_book": evaluate.get(
            "evaluation_opening_home_spread_sportsbook", pd.Series(None, index=evaluate.index),
        ).to_numpy(object),
        "away_book": evaluate.get(
            "evaluation_opening_away_spread_sportsbook", pd.Series(None, index=evaluate.index),
        ).to_numpy(object),
        "market_provenance": evaluate.get(
            "evaluation_market_provenance", pd.Series("unavailable", index=evaluate.index),
        ).fillna("unavailable").astype(str),
    })
    return output.loc[resolved].reset_index(drop=True)


def pipeline(c: float) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scaler", StandardScaler()),
        ("logistic", LogisticRegression(C=c, max_iter=2_000)),
    ])


def actionable(rows: pd.DataFrame, probabilities: np.ndarray, threshold: float) -> dict[str, Any]:
    home_side = probabilities >= 0.5
    confidence = np.maximum(probabilities, 1 - probabilities)
    eligible = confidence - 0.5 >= threshold
    outcomes = rows["home_cover"].to_numpy(bool)
    wins = home_side[eligible] == outcomes[eligible]
    prices = np.where(
        home_side,
        rows["home_price"].to_numpy(float),
        rows["away_price"].to_numpy(float),
    )
    books = np.where(
        home_side,
        rows["home_book"].to_numpy(object),
        rows["away_book"].to_numpy(object),
    )
    priced = eligible & np.isfinite(prices) & (prices != 0)
    return {
        "threshold": threshold,
        "bets": int(eligible.sum()),
        "wins": int(wins.sum()),
        "losses": int(len(wins) - wins.sum()),
        "accuracy": float(wins.mean()) if len(wins) else None,
        "wilson95Lower": tournament.wilson_lower_bound(int(wins.sum()), int(len(wins))),
        "exactPriceCoverage": float(priced.sum() / eligible.sum()) if eligible.sum() else None,
        "exactPrice": tournament.exact_price_return(
            home_side[priced] == outcomes[priced], prices[priced], books[priced],
        ) if priced.any() else None,
    }


def probability_metrics(rows: pd.DataFrame, probabilities: np.ndarray) -> dict[str, Any]:
    outcomes = rows["home_cover"].to_numpy(int)
    sides = probabilities >= 0.5
    return {
        "games": int(len(rows)),
        "sideAccuracy": float((sides == outcomes).mean()),
        "brier": float(brier_score_loss(outcomes, probabilities)),
        "logLoss": float(log_loss(outcomes, probabilities)),
        "meanHomeCoverProbability": float(probabilities.mean()),
        "homeCoverRate": float(outcomes.mean()),
    }


def export_pipeline(model: Pipeline) -> dict[str, Any]:
    imputer: SimpleImputer = model.named_steps["imputer"]
    scaler: StandardScaler = model.named_steps["scaler"]
    logistic: LogisticRegression = model.named_steps["logistic"]
    return {
        "features": READER_FEATURES,
        "imputer": {
            "strategy": "median",
            "statistics": imputer.statistics_.tolist(),
            "indicatorFeatureIndexes": imputer.indicator_.features_.tolist(),
        },
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "logistic": {
            "coefficients": logistic.coef_[0].tolist(),
            "intercept": float(logistic.intercept_[0]),
        },
    }


def main() -> None:
    args = parse_args()
    frame = tournament.validate(tournament.read_jsonl(args.features))
    independent_report = json.loads(args.independent_report.read_text())
    selected = independent_report["selected"]
    catalog = tournament.feature_catalog(frame)
    independent_features = catalog[str(selected["group"])]
    independent_model = dict(selected["model"])
    architecture = str(selected["architecture"])
    development_season = args.selection_season - 1
    development = reader_rows(
        frame, development_season, independent_features, independent_model, architecture,
    )
    selection = reader_rows(
        frame, args.selection_season, independent_features, independent_model, architecture,
    )
    confirmation = reader_rows(
        frame, args.confirmation_season, independent_features, independent_model, architecture,
    )
    candidates: list[dict[str, Any]] = []
    for c in (0.01, 0.1, 1.0, 10.0):
        fitted = pipeline(c)
        fitted.fit(development[READER_FEATURES], development["home_cover"])
        probabilities = fitted.predict_proba(selection[READER_FEATURES])[:, 1]
        for threshold in (0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10):
            report = actionable(selection, probabilities, threshold)
            candidates.append({"C": c, **report})
    eligible = [row for row in candidates if row["bets"] >= args.minimum_decisions]
    eligible.sort(key=lambda row: (
        -(row["wilson95Lower"] if row["wilson95Lower"] is not None else -math.inf),
        -(row["accuracy"] if row["accuracy"] is not None else -math.inf),
        -row["bets"],
    ))
    if not eligible:
        raise ValueError("NBA spread reader has no selection candidate with enough decisions")
    chosen = eligible[0]
    final_fit = pd.concat([development, selection], ignore_index=True)
    fitted = pipeline(float(chosen["C"]))
    fitted.fit(final_fit[READER_FEATURES], final_fit["home_cover"])
    confirmation_probabilities = fitted.predict_proba(confirmation[READER_FEATURES])[:, 1]
    confirmation_actionable = actionable(
        confirmation, confirmation_probabilities, float(chosen["threshold"]),
    )
    selection_provenance = selection["market_provenance"].value_counts().sort_index().to_dict()
    authoritative_selection = bool(
        len(selection_provenance) == 1
        and "balldontlie_timestamped_opening" in selection_provenance
    )
    exact = confirmation_actionable["exactPrice"]
    economic_gate = bool(
        exact is not None
        and exact["bets"] >= args.minimum_decisions
        and confirmation_actionable["exactPriceCoverage"] >= 0.75
        and exact["sportsbookCoverage"] == 1.0
        and exact["units"] > 0
    )
    report = {
        "release": RELEASE,
        "status": "research_only_not_authorized_for_production",
        "featureRelease": tournament.FEATURE_RELEASE,
        "independentTournamentRelease": independent_report["release"],
        "chronology": {
            "developmentSeason": development_season,
            "selectionSeason": args.selection_season,
            "confirmationSeason": args.confirmation_season,
        },
        "readerFeatures": READER_FEATURES,
        "selectionMarketProvenance": selection_provenance,
        "timestampedSelectionAuthority": authoritative_selection,
        "selectionCandidates": candidates,
        "selected": chosen,
        "selectionProbabilityMetrics": probability_metrics(
            selection,
            pipeline(float(chosen["C"])).fit(
                development[READER_FEATURES], development["home_cover"],
            ).predict_proba(selection[READER_FEATURES])[:, 1],
        ),
        "confirmationProbabilityMetrics": probability_metrics(
            confirmation, confirmation_probabilities,
        ),
        "actionableConfirmation": confirmation_actionable,
        "exactPriceGatePassed": economic_gate,
        "historicalMovementValidated": False,
        "historicalSplitsValidated": False,
        "reader": export_pipeline(fitted),
        "promotionAuthorized": bool(
            authoritative_selection and economic_gate
        ),
        "limitations": [
            "Historical selection lines lack authoritative observation timestamps.",
            "Historical movement sequences and verified public/sharp splits are unavailable.",
            "The reader must pass forward timestamped validation before production authority.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "output": str(args.output),
        "selected": chosen,
        "confirmation": confirmation_actionable,
        "exactPriceGatePassed": economic_gate,
        "promotionAuthorized": report["promotionAuthorized"],
    }, indent=2))


if __name__ == "__main__":
    main()
