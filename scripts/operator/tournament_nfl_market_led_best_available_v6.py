#!/usr/bin/env python3
"""Freeze the best available uncapped NFL moneyline Lean candidate.

The policy family is selected only on 2023 after the probability model is fit on
2021-2022. Every policy evaluates all qualifying exact-price edges; there is no
weekly cap or minimum bet count. The selected policy is then opened once on the
chronological 2024-2025 confirmation seasons. This remains shadow research and
cannot publish, track, settle, or change a member grade.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import time
from typing import Any

import joblib

import tournament_nfl_market_led_baseline_v4 as r4
import tournament_nfl_market_led_lean_v5 as r5
import tournament_nfl_opening_residual_v2 as r2


TOURNAMENT_RELEASE = "nfl_market_led_best_available_tournament_2026_08_22_r6"
MODEL_RELEASE = "nfl_market_led_moneyline_shadow_2026_08_22_r6"
CALIBRATION_RELEASE = "nfl_market_led_price_calibration_shadow_2026_08_22_r6"
DECISION_RELEASE = "nfl_market_led_moneyline_lean_shadow_2026_08_22_r6"
EXPECTED_POLICY = r4.Policy(
    minimum_ev=0.0,
    minimum_edge_pp=0.0,
    price_band="all_bounded",
    maximum_actions_per_week=None,
)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def candidate_policies() -> list[r4.Policy]:
    return [
        r4.Policy(ev, edge, band, None)
        for ev in (0.0, 0.005, 0.01, 0.02, 0.03, 0.04, 0.05)
        for edge in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0)
        for band in r4.PRICE_BANDS
    ]


def selection_eligible(result: dict[str, Any]) -> bool:
    return bool(
        result["actions"] >= 36
        and result["weeklyCoverage"] >= 0.80
        and result["units"] > 0
        and result["meanClv"] is not None
        and result["meanClv"] > 0
    )


def select_policy(decisions: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    results = [
        r4.policy_result(decisions, (r4.SELECTION_SEASON,), policy)
        for policy in candidate_policies()
    ]
    eligible = [result for result in results if selection_eligible(result)]
    eligible.sort(key=lambda result: (
        -result["units"],
        -result["meanClv"],
        -result["positiveClvRate"],
        -result["weeklyCoverage"],
        result["actions"],
        result["policyName"],
    ))
    if not eligible:
        raise RuntimeError("no uncapped policy cleared the frozen 2023 selection gates")
    selected = eligible[0]
    if r4.Policy(**selected["policy"]) != EXPECTED_POLICY:
        raise RuntimeError(
            f"unexpected 2023 policy winner: {selected['policyName']}"
        )
    return selected, results


def confirmation_gates(
    probability_evidence: dict[str, Any],
    confirmation: dict[str, Any],
    uncertainty: dict[str, Any],
) -> dict[str, bool]:
    seasons = confirmation["bySeason"]
    return {
        **r5.probability_gates(probability_evidence),
        "minimumActions": confirmation["actions"] >= 72,
        "weeklyCoverage": confirmation["weeklyCoverage"] >= 0.80,
        "positiveEachSeason": all(
            values["actions"] >= 36 and values["units"] > 0
            for values in seasons.values()
        ),
        "largestWinIndependentEachSeason": all(
            r5.season_without_largest_win(confirmation, int(season)) > 0
            for season in seasons
        ),
        "positiveMeanClvEachSeason": all(
            values["meanClv"] is not None and values["meanClv"] > 0
            for values in seasons.values()
        ),
        "bootstrapPositiveProbability": (
            uncertainty["probabilityPositiveUnits"] is not None
            and uncertainty["probabilityPositiveUnits"] >= 0.80
        ),
        "boundedExactPrice": EXPECTED_POLICY.price_band == "all_bounded",
        "betCountIsOutput": EXPECTED_POLICY.maximum_actions_per_week is None,
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
    selection, selection_results = select_policy(decisions)
    confirmation = r4.policy_result(
        decisions,
        r4.CONFIRMATION_SEASONS,
        EXPECTED_POLICY,
    )
    uncertainty = r5.weekly_cluster_uncertainty(confirmation)
    largest_win_sensitivity = {
        str(season): {
            "units": confirmation["bySeason"][str(season)]["units"],
            "unitsWithoutLargestWin": r5.season_without_largest_win(
                confirmation,
                season,
            ),
        }
        for season in r4.CONFIRMATION_SEASONS
    }
    gates = confirmation_gates(probability_evidence, confirmation, uncertainty)
    accepted = all(gates.values())

    selected_probability = probability_evidence["selected"]
    final_probability_model = r4.probability_model(float(selected_probability["c"]))
    final_probability_model.fit(
        probabilities[selected_probability["features"]],
        probabilities["outcome"],
    )
    source_artifact_path = (
        root
        / "football-research/cache/nfl-model"
        / f"{r2.MODEL_RELEASE}.joblib"
    )
    if not source_artifact_path.exists():
        raise RuntimeError("r2 point-model artifact must exist before r6 is frozen")
    artifact = {
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "sourcePointModelRelease": r2.MODEL_RELEASE,
        "sourcePointModelSha256": sha256_file(source_artifact_path),
        "probabilityFamily": selected_probability["family"],
        "probabilityFeatures": selected_probability["features"],
        "probabilityC": selected_probability["c"],
        "probabilityModel": final_probability_model,
        "policy": EXPECTED_POLICY,
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
        "selectionPolicyCount": len(selection_results),
        "selectionEligibleCount": sum(selection_eligible(value) for value in selection_results),
        "selection2023": selection,
        "confirmation2024To2025": confirmation,
        "confirmationUncertainty": uncertainty,
        "confirmationLargestWinSensitivity": largest_win_sensitivity,
        "gates": gates,
        "historicalLeanCandidateAccepted": accepted,
        "bestAngleAuthorized": False,
        "productionAuthorized": False,
        "productionBlockers": [
            "the candidate has not been integrated into the single authoritative prediction writer",
            "all 32 current Week 1 quarterback designations are projected rather than confirmed",
            "timestamp-valid 2026 T-60 decisions, CLV, and settlements do not yet exist",
            "SharpAPI split evidence is unavailable and cannot change a grade",
        ],
        "boardImpact": {
            "historicalMaximumActionsPerWeek": None,
            "betCountPolicy": "every qualifying exact-price edge; no weekly cap or forced minimum",
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
            "2024-2025 have been inspected by earlier NFL research and are chronological confirmation, not a pristine untouched final holdout.",
            "The pooled bootstrap interval still crosses zero; this supports Lean-only use, not a profitability guarantee or Best Angle.",
            "Mean CLV is positive in both confirmation seasons, but positive-CLV frequency is only 40.87 percent pooled.",
            "Historical provider-native DraftKings openings and current leave-one-book-out multi-book quotes are different market stages.",
            "Spread, total, and calibrated score-distribution candidates remain separate unresolved releases.",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "selectedPolicy": {
            key: value for key, value in selection.items() if key != "selectedRows"
        },
        "confirmation2024To2025": {
            key: value for key, value in confirmation.items() if key != "selectedRows"
        },
        "confirmationUncertainty": uncertainty,
        "confirmationLargestWinSensitivity": largest_win_sensitivity,
        "gates": gates,
        "historicalLeanCandidateAccepted": accepted,
        "bestAngleAuthorized": False,
        "productionAuthorized": False,
        "report": str(report_path),
        "artifact": str(artifact_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
