#!/usr/bin/env python3
"""Freeze the bounded market-led NFL moneyline Lean candidate.

The broader r4 tournament showed that an unrestricted favorite sleeve was not
stable. This r5 shadow candidate uses the predeclared competitive price band
(-200 through +200) and every qualifying exact-price edge from the r4 calibrated
market-plus-football probability. Bet count remains an output: there is no
weekly cap or quota. The candidate remains ineligible for production.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import time
from typing import Any

import joblib
import numpy as np

import tournament_nfl_market_led_baseline_v4 as r4
import tournament_nfl_opening_residual_v2 as r2


TOURNAMENT_RELEASE = "nfl_market_led_lean_tournament_2026_08_22_r5"
MODEL_RELEASE = "nfl_market_led_moneyline_shadow_2026_08_22_r5"
CALIBRATION_RELEASE = "nfl_market_led_price_calibration_shadow_2026_08_22_r5"
DECISION_RELEASE = "nfl_market_led_moneyline_lean_shadow_2026_08_22_r5"
FIXED_POLICY = r4.Policy(
    minimum_ev=0.0,
    minimum_edge_pp=0.0,
    price_band="competitive",
    maximum_actions_per_week=None,
)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probability_gates(evidence: dict[str, Any]) -> dict[str, bool]:
    confirmation = evidence["confirmation"]
    return {
        "pooledBrierImprovement": (
            confirmation["candidate"]["brier"] < confirmation["market"]["brier"]
        ),
        "pooledLogLossImprovement": (
            confirmation["candidate"]["logLoss"] < confirmation["market"]["logLoss"]
        ),
        "boundedSeasonRegression": all(
            values["candidate"]["brier"] - values["market"]["brier"] <= 0.0015
            for values in evidence["confirmationBySeason"].values()
        ),
    }


def decision_gates(result: dict[str, Any]) -> dict[str, bool]:
    seasons = result["bySeason"].values()
    return {
        "minimumActions": result["actions"] >= 36,
        "weeklyCoverage": result["weeklyCoverage"] >= 0.80,
        "positiveLockedValue": result["units"] > 0,
        "positiveEachSeason": all(
            season["actions"] >= 15 and season["units"] > 0
            for season in seasons
        ),
        "largestWinIndependentEachSeason": all(
            season_without_largest_win(result, int(season)) > 0
            for season in result["bySeason"]
        ),
        "positiveMeanClv": result["meanClv"] is not None and result["meanClv"] > 0,
        "boundedPrice": FIXED_POLICY.price_band == "competitive",
    }


def season_without_largest_win(result: dict[str, Any], season: int) -> float:
    rows = [row for row in result["selectedRows"] if int(row["season"]) == season]
    wins = [float(row["units"]) for row in rows if float(row["units"]) > 0]
    return float(sum(float(row["units"]) for row in rows) - max(wins, default=0.0))


def weekly_cluster_uncertainty(result: dict[str, Any]) -> dict[str, Any]:
    rows = result["selectedRows"]
    weekly: dict[tuple[int, int], float] = {}
    for row in rows:
        key = (int(row["season"]), int(row["week"]))
        weekly[key] = weekly.get(key, 0.0) + float(row["units"])
    values = np.asarray(list(weekly.values()), dtype=float)
    if len(values) == 0:
        return {
            "weeklyClusters": 0,
            "unitCi95": None,
            "roiCi95": None,
            "probabilityPositiveUnits": None,
        }
    rng = np.random.default_rng(22082026)
    samples = rng.choice(values, size=(20_000, len(values)), replace=True).sum(axis=1)
    actions_per_week = float(result["actions"]) / len(values)
    roi_samples = samples / (len(values) * actions_per_week)
    return {
        "weeklyClusters": int(len(values)),
        "unitCi95": [float(value) for value in np.quantile(samples, [0.025, 0.975])],
        "roiCi95": [float(value) for value in np.quantile(roi_samples, [0.025, 0.975])],
        "probabilityPositiveUnits": float(np.mean(samples > 0.0)),
    }


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get("NFL_RESEARCH_SOURCE_ROOT", str(root))).resolve()
    features, feature_manifest = r2.load_features(source_root)
    openings, opening_evidence = r2.load_openings(source_root, features)
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
    decisions = r4.build_decisions(openings, probabilities)
    selection = r4.policy_result(decisions, (r4.SELECTION_SEASON,), FIXED_POLICY)
    confirmation = r4.policy_result(decisions, r4.CONFIRMATION_SEASONS, FIXED_POLICY)
    confirmation_uncertainty = weekly_cluster_uncertainty(confirmation)
    confirmation_largest_win_sensitivity = {
        str(season): {
            "units": confirmation["bySeason"][str(season)]["units"],
            "unitsWithoutLargestWin": season_without_largest_win(confirmation, season),
        }
        for season in r4.CONFIRMATION_SEASONS
    }
    gates = {
        **probability_gates(probability_evidence),
        **decision_gates(confirmation),
    }
    historical_candidate_accepted = all(gates.values())

    selected_probability = probability_evidence["selected"]
    final_probability_model = r4.probability_model(float(selected_probability["c"]))
    final_probability_model.fit(
        probabilities[selected_probability["features"]],
        probabilities["outcome"],
    )
    r2_artifact_path = (
        root
        / "football-research/cache/nfl-model"
        / f"{r2.MODEL_RELEASE}.joblib"
    )
    if not r2_artifact_path.exists():
        raise RuntimeError("r2 point-model artifact must be generated before the r5 wrapper")
    artifact = {
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "sourcePointModelRelease": r2.MODEL_RELEASE,
        "sourcePointModelSha256": sha256_file(r2_artifact_path),
        "probabilityFamily": selected_probability["family"],
        "probabilityFeatures": selected_probability["features"],
        "probabilityC": selected_probability["c"],
        "probabilityModel": final_probability_model,
        "policy": FIXED_POLICY,
    }
    artifact_root = root / "football-research/cache/nfl-model"
    artifact_root.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_root / f"{MODEL_RELEASE}.joblib"
    joblib.dump(artifact, artifact_path)

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "shadowOnly": True,
        "productionBehaviorChanged": False,
        "gradesChanged": False,
        "stakesChanged": False,
        "trackingChanged": False,
        "featureRelease": feature_manifest["featureRelease"],
        "featureSha256": feature_manifest["featureFileSha256"],
        "openingEvidence": opening_evidence,
        "marginCandidate": margin_name,
        "probability": probability_evidence,
        "fixedPolicy": {
            "policy": FIXED_POLICY.name,
            "selectionRationale": (
                "market remains the prior; football supplies a regularized correction; "
                "prices below -200 and above +200 are excluded from the starter Lean lane"
            ),
        },
        "selection2023": selection,
        "confirmation2024To2025": confirmation,
        "confirmationUncertainty": confirmation_uncertainty,
        "confirmationLargestWinSensitivity": confirmation_largest_win_sensitivity,
        "gates": gates,
        "historicalLeanCandidateAccepted": historical_candidate_accepted,
        "bestAngleAuthorized": False,
        "productionAuthorized": False,
        "productionBlockers": [
            "the uncapped product-compatible policy is negative in 2025 confirmation",
            "current Week 1 multi-book tuples are shadow audit rows outside the authoritative writer",
            "2026 T-60 forward evidence has not yet evaluated this release",
            "SharpAPI split history is unavailable and splits cannot promote this release",
        ],
        "boardImpact": {
            "historicalMaximumActionsPerWeek": None,
            "betCountPolicy": "every qualifying exact-price edge; no weekly cap or quota",
            "productionPromotions": 0,
            "productionDemotions": 0,
            "productionNetActionable": 0,
        },
        "artifact": {
            "path": str(artifact_path),
            "sha256": sha256_file(artifact_path),
            "sourcePointModelSha256": artifact["sourcePointModelSha256"],
        },
        "limitations": [
            "The competitive price band was retained after the broader r4 family was inspected; 2024-2025 are not an untouched final holdout.",
            "Historical prices are provider-native DraftKings openings, while the current Week 1 audit uses multi-book quotes and leave-one-book-out consensus.",
            "The r2 player-availability overlay is aligned to near-kick information, not early opening time.",
            "The rejected historical policy cannot authorize a member-facing Lean, Best Angle, or live stake.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "selectedProbability": selected_probability,
        "probabilityConfirmation": probability_evidence["confirmation"],
        "selection2023": {key: value for key, value in selection.items() if key != "selectedRows"},
        "confirmation2024To2025": {
            key: value for key, value in confirmation.items() if key != "selectedRows"
        },
        "confirmationUncertainty": confirmation_uncertainty,
        "confirmationLargestWinSensitivity": confirmation_largest_win_sensitivity,
        "gates": gates,
        "historicalLeanCandidateAccepted": historical_candidate_accepted,
        "bestAngleAuthorized": False,
        "productionAuthorized": False,
        "report": str(report_path),
        "artifact": str(artifact_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
