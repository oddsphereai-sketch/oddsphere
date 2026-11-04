#!/usr/bin/env python3
"""Exact locked-price and calibration ledger for Week 5 Anytime TD props."""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import re
import unicodedata
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score


ROOT = pathlib.Path(__file__).resolve().parents[2]
BOARD = pathlib.Path("/tmp/nfl-props-private-week5-full-board.json")
EVIDENCE = pathlib.Path("/tmp/nfl-props-loss-ledger-evidence-week5.json")
CANDIDATE_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_fixed_ensemble_rows_r1.parquet"
TOUCHDOWN_ARTIFACT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeTouchdown.json"
OUTPUT = ROOT / "docs/model-audits/2026-10-15-nfl-player-props-anytime-td-economic-ledger.json"


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_name(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


def implied_probability(price: float) -> float:
    return -price / (-price + 100.0) if price < 0 else 100.0 / (price + 100.0)


def profit_multiple(price: float) -> float:
    return 100.0 / abs(price) if price < 0 else price / 100.0


def residual_probability(model: np.ndarray, market: np.ndarray, weight: float) -> np.ndarray:
    model = np.clip(np.asarray(model, dtype=float), 1e-6, 1.0 - 1e-6)
    market = np.clip(np.asarray(market, dtype=float), 1e-6, 1.0 - 1e-6)
    model_logit = np.log(model / (1.0 - model))
    market_logit = np.log(market / (1.0 - market))
    value = market_logit + weight * (model_logit - market_logit)
    return 1.0 / (1.0 + np.exp(-value))


def probability_metrics(actual: np.ndarray, probability: np.ndarray) -> dict[str, Any]:
    outcome = np.asarray(actual, dtype=float)
    value = np.clip(np.asarray(probability, dtype=float), 1e-6, 1.0 - 1e-6)
    bins = pd.qcut(value, q=min(10, len(value)), duplicates="drop")
    grouped = pd.DataFrame({"p": value, "y": outcome, "bin": bins}).groupby(
        "bin", observed=True,
    ).agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"))
    return {
        "rows": int(len(outcome)),
        "wins": int(outcome.sum()),
        "hitRate": float(outcome.mean()),
        "meanProbability": float(value.mean()),
        "meanCalibrationGap": float(abs(value.mean() - outcome.mean())),
        "decileCalibrationError": float(np.average(
            np.abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"],
        )),
        "brier": float(np.mean((value - outcome) ** 2)),
        "logLoss": float(np.mean(-(outcome * np.log(value) + (1.0 - outcome) * np.log(1.0 - value)))),
        "auc": float(roc_auc_score(outcome, value)),
    }


def economics(rows: pd.DataFrame) -> dict[str, Any]:
    if rows.empty:
        return {
            "rows": 0, "wins": 0, "losses": 0, "hitRate": None,
            "units": 0.0, "roi": None,
        }
    return {
        "rows": int(len(rows)),
        "wins": int(rows["win"].sum()),
        "losses": int((~rows["win"]).sum()),
        "hitRate": float(rows["win"].mean()),
        "averageAmericanPrice": float(rows["americanPrice"].mean()),
        "averageBreakEvenProbability": float(rows["breakEvenProbability"].mean()),
        "averageNoVigMarketProbability": float(rows["marketProbability"].mean()),
        "averageFinalProbability": float(rows["finalProbability"].mean()),
        "averageNoVigEdge": float(rows["noVigEdge"].mean()),
        "averagePriceEdge": float(rows["priceEdge"].mean()),
        "averageExpectedValue": float(rows["expectedValue"].mean()),
        "units": float(rows["units"].sum()),
        "roi": float(rows["units"].mean()),
    }


def rank_report(rows: pd.DataFrame, column: str) -> dict[str, Any]:
    ranked = rows.sort_values(column, ascending=False)
    return {
        f"top{count}": economics(ranked.head(count))
        for count in (5, 10, 20)
    }


def main() -> None:
    board = json.loads(BOARD.read_text(encoding="utf-8"))
    rows = pd.DataFrame(board["exactOfferRows"])
    rows = rows[rows["market"].eq("anytime_td") & rows["canonicalMainLine"].eq(True)].copy()
    if len(rows) != 45 or rows[["gameId", "playerName"]].duplicated().any():
        raise RuntimeError("Anytime TD canonical locked board coverage changed")
    rows["gameId"] = rows["gameId"].astype(str)
    rows["normalizedPlayer"] = rows["playerName"].map(normalized_name)
    rows["win"] = rows["actual"].gt(0)
    rows["profitMultiple"] = rows["americanPrice"].map(profit_multiple)
    rows["breakEvenProbability"] = rows["americanPrice"].map(implied_probability)
    rows["units"] = np.where(rows["win"], rows["profitMultiple"], -1.0)
    rows["noVigEdge"] = rows["finalProbability"] - rows["marketProbability"]
    rows["priceEdge"] = rows["finalProbability"] - rows["breakEvenProbability"]
    rows["expectedValue"] = (
        rows["finalProbability"] * rows["profitMultiple"] - (1.0 - rows["finalProbability"])
    )
    rows["rawNoVigEdge"] = rows["rawModelProbability"] - rows["marketProbability"]

    candidate = pd.read_parquet(CANDIDATE_ROWS)
    candidate = candidate[candidate["phase"].eq("locked_replay")].copy()
    candidate["gameId"] = candidate["gameId"].astype(str)
    candidate["normalizedPlayer"] = candidate["playerName"].map(normalized_name)
    rows = rows.merge(
        candidate[["gameId", "normalizedPlayer", "candidate_probability"]],
        on=["gameId", "normalizedPlayer"], how="left", validate="one_to_one",
    )
    if rows["candidate_probability"].isna().any():
        raise RuntimeError("fixed independent ensemble did not join every locked row")
    touchdown = json.loads(TOUCHDOWN_ARTIFACT.read_text(encoding="utf-8"))
    rows["candidateFinalProbability"] = residual_probability(
        rows["candidate_probability"].to_numpy(float),
        rows["marketProbability"].to_numpy(float),
        float(touchdown["marketResidualWeight"]),
    )
    rows["candidateNoVigEdge"] = rows["candidateFinalProbability"] - rows["marketProbability"]
    rows["candidatePriceEdge"] = rows["candidateFinalProbability"] - rows["breakEvenProbability"]
    rows["candidateExpectedValue"] = (
        rows["candidateFinalProbability"] * rows["profitMultiple"]
        - (1.0 - rows["candidateFinalProbability"])
    )

    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    observer = pd.DataFrame(evidence["marketObserver"]["history"]["rows"])
    observer = observer[
        observer["market"].eq("anytime_td")
        & observer["landmark"].eq("t60_lock")
        & observer["yesPrice"].notna()
    ].copy()
    observer["gameId"] = observer["gameId"].astype(str)
    observer["normalizedPlayer"] = observer["playerName"].map(normalized_name)
    observer["sportsbook"] = observer["sportsbook"].astype(str).str.lower()
    observer = observer.sort_values("capturedAt").drop_duplicates(
        ["gameId", "normalizedPlayer", "sportsbook"], keep="last",
    )
    rows["sportsbook"] = rows["sportsbook"].astype(str).str.lower()
    rows = rows.merge(
        observer[[
            "gameId", "normalizedPlayer", "sportsbook", "yesPrice", "observedAt",
            "capturedAt", "minutesToStartAtCapture",
        ]].rename(columns={
            "yesPrice": "closingAmericanPrice",
            "observedAt": "closingObservedAt",
            "capturedAt": "closingCapturedAt",
        }),
        on=["gameId", "normalizedPlayer", "sportsbook"], how="left", validate="one_to_one",
    )
    rows["closingBreakEvenProbability"] = rows["closingAmericanPrice"].map(
        lambda value: implied_probability(value) if pd.notna(value) else np.nan,
    )
    rows["sameBookClvProbabilityPoints"] = (
        rows["closingBreakEvenProbability"] - rows["breakEvenProbability"]
    )

    actual = rows["win"].to_numpy(float)
    by_grade = {
        str(grade): economics(group) for grade, group in rows.groupby("grade", observed=True)
    }
    candidate_positive = rows[rows["candidateExpectedValue"].gt(0)]
    released_positive = rows[rows["expectedValue"].gt(0)]
    clv = rows[rows["closingAmericanPrice"].notna()].copy()
    classification = {
        "economicallyWeak": bool(rows["units"].sum() < 0 and rows["expectedValue"].mean() > 0),
        "probabilisticallyMiscalibrated": bool(
            probability_metrics(actual, rows["finalProbability"])["brier"]
            > probability_metrics(actual, rows["marketProbability"])["brier"]
            and probability_metrics(actual, rows["finalProbability"])["decileCalibrationError"] > 0.10
        ),
    }
    classification["label"] = (
        "both" if classification["economicallyWeak"] and classification["probabilisticallyMiscalibrated"]
        else "economically_weak" if classification["economicallyWeak"]
        else "probabilistically_miscalibrated" if classification["probabilisticallyMiscalibrated"]
        else "neither"
    )

    record_columns = [
        "gameId", "playerName", "sportsbook", "americanPrice", "breakEvenProbability",
        "win", "units", "rawModelProbability", "marketProbability", "finalProbability",
        "noVigEdge", "priceEdge", "expectedValue", "grade", "marketMovement", "lockedAt",
        "candidate_probability", "candidateFinalProbability", "candidateNoVigEdge",
        "candidatePriceEdge", "candidateExpectedValue", "closingAmericanPrice",
        "closingBreakEvenProbability", "sameBookClvProbabilityPoints", "closingObservedAt",
        "closingCapturedAt", "minutesToStartAtCapture",
    ]
    record_frame = rows[record_columns].astype(object)
    record_frame = record_frame.where(pd.notna(record_frame), None)
    report = {
        "release": "nfl_player_props_anytime_td_economic_ledger_2026_10_15_r1",
        "readOnly": True,
        "sourceChecksums": {
            "privateBoard": sha256(BOARD),
            "lossLedgerEvidence": sha256(EVIDENCE),
            "fixedEnsembleRows": sha256(CANDIDATE_ROWS),
            "touchdownArtifact": sha256(TOUCHDOWN_ARTIFACT),
        },
        "coverage": {
            "rows": int(len(rows)),
            "games": int(rows["gameId"].nunique()),
            "wins": int(rows["win"].sum()),
            "losses": int((~rows["win"]).sum()),
            "hitRate": float(rows["win"].mean()),
            "sameBookT60ClvRows": int(len(clv)),
            "sameBookT60ClvCoverage": float(len(clv) / len(rows)),
        },
        "released": {
            "independentProbability": probability_metrics(actual, rows["rawModelProbability"]),
            "noVigMarketProbability": probability_metrics(actual, rows["marketProbability"]),
            "finalProbability": probability_metrics(actual, rows["finalProbability"]),
            "economicsAllRows": economics(rows),
            "economicsPositiveEv": economics(released_positive),
            "positiveEvRows": int(len(released_positive)),
            "byGrade": by_grade,
            "byExpectedValueRank": rank_report(rows, "expectedValue"),
            "byNoVigEdgeRank": rank_report(rows, "noVigEdge"),
        },
        "fixedIndependentEnsemble": {
            "independentProbability": probability_metrics(actual, rows["candidate_probability"]),
            "finalProbability": probability_metrics(actual, rows["candidateFinalProbability"]),
            "economicsPositiveEv": economics(candidate_positive.assign(
                finalProbability=candidate_positive["candidateFinalProbability"],
                noVigEdge=candidate_positive["candidateNoVigEdge"],
                priceEdge=candidate_positive["candidatePriceEdge"],
                expectedValue=candidate_positive["candidateExpectedValue"],
            )),
            "positiveEvRows": int(len(candidate_positive)),
            "byExpectedValueRank": rank_report(rows.rename(columns={
                "finalProbability": "releasedFinalProbability",
                "noVigEdge": "releasedNoVigEdge",
                "priceEdge": "releasedPriceEdge",
                "expectedValue": "releasedExpectedValue",
                "candidateFinalProbability": "finalProbability",
                "candidateNoVigEdge": "noVigEdge",
                "candidatePriceEdge": "priceEdge",
                "candidateExpectedValue": "expectedValue",
            }), "expectedValue"),
        },
        "sameBookT60Clv": {
            "rows": int(len(clv)),
            "averageProbabilityPointClv": float(clv["sameBookClvProbabilityPoints"].mean()) if len(clv) else None,
            "medianProbabilityPointClv": float(clv["sameBookClvProbabilityPoints"].median()) if len(clv) else None,
            "positiveClvRows": int(clv["sameBookClvProbabilityPoints"].gt(0).sum()),
            "negativeClvRows": int(clv["sameBookClvProbabilityPoints"].lt(0).sum()),
            "flatClvRows": int(clv["sameBookClvProbabilityPoints"].eq(0).sum()),
            "economics": economics(clv),
            "boundary": "same game/player/book t60_lock yes price only; no t24 or cross-book substitution",
        },
        "classification": classification,
        "rows": record_frame.to_dict("records"),
    }
    OUTPUT.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in (
        "coverage", "released", "fixedIndependentEnsemble", "sameBookT60Clv", "classification",
    )}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
