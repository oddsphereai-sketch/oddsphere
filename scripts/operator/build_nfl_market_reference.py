#!/usr/bin/env python3
"""Build the immutable local NFL market-reference forecasting report.

This is the champion baseline that every OddSphere NFL challenger must beat.
It evaluates both terminal nflverse prices and genuine DraftKings openings.
It never writes predictions, grades, tracking, database state, or production
configuration.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error


REPORT_RELEASE = "nfl_market_reference_foundation_2026_08_20_r1"
MODEL_RELEASE = "nfl_market_reference_core_2026_08_20_r1"
CALIBRATION_RELEASE = "nfl_market_no_vig_calibration_2026_08_20_r1"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
CHALLENGER_RELEASE = "nfl_pregame_real_local_candidate_2026_08_19_r2"
OPENING_RELEASES = {
    2021: "bdl_nfl_opening_history_2021_2026_08_20_r1",
    2022: "bdl_nfl_opening_history_2022_2026_08_20_r2",
    2023: "bdl_nfl_opening_history_2023_2026_08_20_r2",
    2024: "bdl_nfl_opening_history_2024_2026_08_20_r2",
    2025: "bdl_nfl_opening_history_2025_2026_08_20_r1",
}


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implied(price: np.ndarray | pd.Series) -> np.ndarray:
    values = np.asarray(price, dtype=float)
    result = np.full(values.shape, np.nan, dtype=float)
    positive = values > 0
    negative = values < 0
    result[positive] = 100.0 / (values[positive] + 100.0)
    result[negative] = -values[negative] / (-values[negative] + 100.0)
    return result


def no_vig(first: np.ndarray | pd.Series, second: np.ndarray | pd.Series) -> np.ndarray:
    a = implied(first)
    b = implied(second)
    denominator = a + b
    return np.divide(a, denominator, out=np.full(a.shape, np.nan), where=denominator > 0)


def probability_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, Any]:
    p = np.asarray(probability, dtype=float)
    y = np.asarray(outcome, dtype=int)
    keep = np.isfinite(p)
    p = np.clip(p[keep], 0.001, 0.999)
    y = y[keep]
    bins = np.minimum(9, np.floor(p * 10).astype(int))
    ece = 0.0
    reliability: list[dict[str, Any]] = []
    for index in range(10):
        mask = bins == index
        if not mask.any():
            continue
        mean_probability = float(p[mask].mean())
        outcome_rate = float(y[mask].mean())
        ece += float(mask.mean()) * abs(mean_probability - outcome_rate)
        reliability.append({
            "bin": index,
            "rows": int(mask.sum()),
            "meanProbability": mean_probability,
            "outcomeRate": outcome_rate,
        })
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
        "ece10": ece,
        "meanProbability": float(p.mean()),
        "outcomeRate": float(y.mean()),
        "reliability": reliability,
    }


def prior_mean(frame: pd.DataFrame, season: int, column: str) -> float:
    values = frame[(frame["season"] >= 2016) & (frame["season"] < season)][column].dropna()
    if values.empty:
        raise RuntimeError(f"no prior values for {season} {column}")
    return float(values.mean())


def point_metrics(actual: pd.Series, market: pd.Series, naive: float) -> dict[str, Any]:
    keep = actual.notna() & market.notna()
    y = actual[keep].to_numpy(float)
    prediction = market[keep].to_numpy(float)
    return {
        "rows": int(len(y)),
        "marketMae": float(mean_absolute_error(y, prediction)),
        "naivePriorMae": float(mean_absolute_error(y, np.full(len(y), naive))),
        "marketBias": float(np.mean(prediction - y)),
    }


def evaluate_frame(
    frame: pd.DataFrame,
    seasons: list[int],
    source: str,
    prior_frame: pd.DataFrame | None = None,
) -> dict[str, Any]:
    priors = frame if prior_frame is None else prior_frame
    by_season: dict[str, Any] = {}
    for season in seasons:
        rows = frame[frame["season"] == season].copy()
        margin = point_metrics(rows["actual_margin"], rows["reference_margin"], prior_mean(priors, season, "actual_margin"))
        total = point_metrics(rows["actual_total"], rows["reference_total"], prior_mean(priors, season, "actual_total"))
        home_win = rows["actual_margin"].gt(0)
        home_cover = rows["actual_margin"].gt(rows["reference_margin"])
        spread_push = rows["actual_margin"].eq(rows["reference_margin"])
        over = rows["actual_total"].gt(rows["reference_total"])
        total_push = rows["actual_total"].eq(rows["reference_total"])
        ml = probability_metrics(rows["reference_ml_probability"].to_numpy(float), home_win.to_numpy(int))
        spread = probability_metrics(
            rows.loc[~spread_push, "reference_spread_probability"].to_numpy(float),
            home_cover.loc[~spread_push].to_numpy(int),
        )
        total_probability = probability_metrics(
            rows.loc[~total_push, "reference_total_probability"].to_numpy(float),
            over.loc[~total_push].to_numpy(int),
        )
        naive_home = prior_mean(priors, season, "home_win")
        ml["naivePriorBrier"] = float(brier_score_loss(home_win.astype(int), np.full(len(rows), naive_home)))
        spread["coinFlipBrier"] = float(brier_score_loss(home_cover.loc[~spread_push].astype(int), np.full((~spread_push).sum(), 0.5)))
        total_probability["coinFlipBrier"] = float(brier_score_loss(over.loc[~total_push].astype(int), np.full((~total_push).sum(), 0.5)))
        by_season[str(season)] = {
            "rows": int(len(rows)),
            "margin": margin,
            "total": total,
            "moneyline": ml,
            "spread": spread,
            "totalProbability": total_probability,
        }

    def pooled_point(actual_column: str, market_column: str) -> dict[str, Any]:
        rows = frame[frame["season"].isin(seasons)]
        keep = rows[actual_column].notna() & rows[market_column].notna()
        actual = rows.loc[keep, actual_column].to_numpy(float)
        market = rows.loc[keep, market_column].to_numpy(float)
        naive = np.concatenate([
            np.full(int((rows.loc[keep, "season"] == season).sum()), prior_mean(priors, season, actual_column))
            for season in seasons
        ])
        ordered_actual = np.concatenate([
            rows.loc[keep & rows["season"].eq(season), actual_column].to_numpy(float) for season in seasons
        ])
        ordered_market = np.concatenate([
            rows.loc[keep & rows["season"].eq(season), market_column].to_numpy(float) for season in seasons
        ])
        return {
            "rows": int(len(actual)),
            "marketMae": float(mean_absolute_error(ordered_actual, ordered_market)),
            "naivePriorMae": float(mean_absolute_error(ordered_actual, naive)),
        }

    pooled_rows = frame[frame["season"].isin(seasons)].copy()
    spread_push = pooled_rows["actual_margin"].eq(pooled_rows["reference_margin"])
    total_push = pooled_rows["actual_total"].eq(pooled_rows["reference_total"])
    pooled = {
        "margin": pooled_point("actual_margin", "reference_margin"),
        "total": pooled_point("actual_total", "reference_total"),
        "moneyline": probability_metrics(
            pooled_rows["reference_ml_probability"].to_numpy(float), pooled_rows["actual_margin"].gt(0).to_numpy(int)
        ),
        "spread": probability_metrics(
            pooled_rows.loc[~spread_push, "reference_spread_probability"].to_numpy(float),
            pooled_rows.loc[~spread_push, "actual_margin"].gt(pooled_rows.loc[~spread_push, "reference_margin"]).to_numpy(int),
        ),
        "totalProbability": probability_metrics(
            pooled_rows.loc[~total_push, "reference_total_probability"].to_numpy(float),
            pooled_rows.loc[~total_push, "actual_total"].gt(pooled_rows.loc[~total_push, "reference_total"]).to_numpy(int),
        ),
    }
    return {"source": source, "seasons": seasons, "bySeason": by_season, "pooled": pooled}


def load_openings(root: pathlib.Path, features: pd.DataFrame) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    joined: list[pd.DataFrame] = []
    manifests: list[dict[str, Any]] = []
    features = features.copy()
    features["homeJoin"] = features["home_team"].replace({"LA": "LAR", "WAS": "WSH"})
    features["awayJoin"] = features["away_team"].replace({"LA": "LAR", "WAS": "WSH"})
    for season, release in OPENING_RELEASES.items():
        manifest_path = root / "football-research/cache/nfl-market" / f"{release}.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        data_path = pathlib.Path(manifest["dataFile"])
        if manifest.get("cacheRelease") != release or sha256_file(data_path) != manifest.get("dataSha256"):
            raise RuntimeError(f"opening cache release/checksum mismatch: {release}")
        payload = json.loads(data_path.read_text(encoding="utf-8"))
        games = pd.DataFrame(payload["games"])
        odds = pd.DataFrame(payload["openings"])
        odds = odds[odds["vendor"].eq("draftkings")].copy()
        provider = games.merge(odds, on="gameId", validate="one_to_one")
        season_features = features[features["season"] == season]
        frame = provider.merge(
            season_features,
            left_on=["season", "homeTeam", "awayTeam"],
            right_on=["season", "homeJoin", "awayJoin"],
            validate="one_to_one",
        )
        joined.append(frame)
        manifests.append({
            "season": season,
            "release": release,
            "sha256": manifest["dataSha256"],
            "games": int(len(frame)),
            "openingRows": int(len(odds)),
        })
    frame = pd.concat(joined, ignore_index=True)
    frame["reference_margin"] = -pd.to_numeric(frame["spreadHomeLine"], errors="coerce")
    frame["reference_total"] = pd.to_numeric(frame["totalLine"], errors="coerce")
    frame["reference_ml_probability"] = no_vig(frame["moneylineHome"], frame["moneylineAway"])
    frame["reference_spread_probability"] = no_vig(frame["spreadHomePrice"], frame["spreadAwayPrice"])
    frame["reference_total_probability"] = no_vig(frame["totalOverPrice"], frame["totalUnderPrice"])
    frame["home_win"] = frame["actual_margin"].gt(0).astype(float)
    return frame, manifests


def main() -> None:
    root = pathlib.Path.cwd()
    feature_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    feature_manifest = json.loads(feature_manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(feature_manifest["featureFile"])
    if feature_manifest.get("featureRelease") != FEATURE_RELEASE or sha256_file(feature_path) != feature_manifest.get("featureFileSha256"):
        raise RuntimeError("feature release/checksum mismatch")
    features = pd.read_parquet(feature_path)
    features["home_win"] = features["actual_margin"].gt(0).astype(float)
    terminal = features.copy()
    terminal["reference_margin"] = terminal["market_home_margin"]
    terminal["reference_total"] = terminal["market_total"]
    terminal["reference_ml_probability"] = no_vig(terminal["home_moneyline"], terminal["away_moneyline"])
    terminal["reference_spread_probability"] = no_vig(terminal["home_spread_odds"], terminal["away_spread_odds"])
    terminal["reference_total_probability"] = no_vig(terminal["over_odds"], terminal["under_odds"])
    terminal["home_win"] = terminal["actual_margin"].gt(0).astype(float)
    terminal_report = evaluate_frame(terminal, list(range(2019, 2026)), "nflverse terminal consensus")

    openings, opening_manifests = load_openings(root, features)
    opening_report = evaluate_frame(
        openings,
        list(range(2021, 2026)),
        "BALLDONTLIE DraftKings provider-native opening",
        prior_frame=features,
    )

    challenger_path = root / "football-research/reports/nfl_real_pregame_model_tournament_2026_08_19_r1.json"
    challenger = json.loads(challenger_path.read_text(encoding="utf-8"))
    if challenger.get("modelRelease") != CHALLENGER_RELEASE:
        raise RuntimeError("challenger release mismatch")
    challenger_comparison = {
        "release": CHALLENGER_RELEASE,
        "season": 2025,
        "margin": {
            "challengerMae": challenger["margin"]["holdout"]["marketAware"]["mae"],
            "referenceMae": challenger["margin"]["holdout"]["marketOnly"]["mae"],
        },
        "total": {
            "challengerMae": challenger["total"]["holdout"]["marketAware"]["mae"],
            "referenceMae": challenger["total"]["holdout"]["marketOnly"]["mae"],
        },
        "probabilityBrier": {
            "moneyline": challenger["probabilities"]["holdout"]["moneyline"]["brier"],
            "spread": challenger["probabilities"]["holdout"]["spread"]["brier"],
            "total": challenger["probabilities"]["holdout"]["total"]["brier"],
        },
        "status": "rejected_as_reference_replacement",
    }

    terminal_pooled = terminal_report["pooled"]
    opening_pooled = opening_report["pooled"]
    accepted = all([
        terminal_pooled["margin"]["marketMae"] < terminal_pooled["margin"]["naivePriorMae"],
        terminal_pooled["total"]["marketMae"] < terminal_pooled["total"]["naivePriorMae"],
        opening_pooled["margin"]["marketMae"] < opening_pooled["margin"]["naivePriorMae"],
        opening_pooled["total"]["marketMae"] < opening_pooled["total"]["naivePriorMae"],
    ])
    report = {
        "reportRelease": REPORT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "productionBehaviorChanged": False,
        "officialTrackingChanged": False,
        "featureRelease": FEATURE_RELEASE,
        "featureSha256": feature_manifest["featureFileSha256"],
        "definition": {
            "moneylineProbability": "same-snapshot two-sided no-vig market probability",
            "marginProjection": "same-snapshot market home scoring margin",
            "totalProjection": "same-snapshot market game total",
            "projectedHomeScore": "(total + home margin) / 2",
            "projectedAwayScore": "(total - home margin) / 2",
            "spreadProbability": "same-snapshot two-sided no-vig price at the offered line",
            "totalProbability": "same-snapshot two-sided no-vig price at the offered total",
        },
        "terminalEvaluation": terminal_report,
        "openingEvaluation": opening_report,
        "openingCaches": opening_manifests,
        "challengerComparison": challenger_comparison,
        "foundationGate": {
            "status": "accepted_reference_foundation" if accepted else "failed_reference_foundation",
            "marketReferenceAccepted": accepted,
            "statisticalBettingEdgeClaimed": False,
            "actionableGradesAuthorized": False,
            "reason": "The market is the most accurate reproducible current NFL forecast in the available holdouts. It is the champion baseline, not evidence of a bet against itself.",
        },
        "challengerPromotionGate": {
            "chronologicalSelection": "improve pooled proper score and point error across expanding-window historical folds",
            "stability": "improve at least four of six selection seasons without a material losing season",
            "holdout": "improve the locked future season and preserve calibration",
            "decisionValue": "positive same-book CLV and non-negative locked-price value for the weekly portfolio",
            "boardImpact": "report promotions, demotions, net actions and market mix",
            "forwardProof": "freeze before 2026 Week 1; preseason never settles or enters lifetime results",
        },
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{REPORT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "reportRelease": REPORT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "foundationGate": report["foundationGate"],
        "terminalPooled": terminal_pooled,
        "openingPooled": opening_pooled,
        "report": str(report_path),
    }, indent=2))


if __name__ == "__main__":
    main()
