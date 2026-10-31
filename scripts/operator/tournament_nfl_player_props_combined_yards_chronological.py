#!/usr/bin/env python3
"""Strict-calendar retrospective confirmation for combined NFL player yards."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_combined_yards_joint as joint
import tournament_nfl_player_props_passing_touchdowns as common
import tournament_nfl_player_props_remaining_yards as prior


RELEASE = "nfl_player_props_combined_yards_chronological_2026_10_16_r2"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    cli = parse_args()
    frame = prior.build_combined_yards(pd.read_parquet(cli.features))
    train = frame[frame["season"].between(2017, 2023)].copy()
    selection = frame[frame["season"].eq(2024)].copy()
    confirmation = frame[frame["season"].eq(2025)].copy()
    external = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    columns = prior.model_features(frame, "rushing_receiving_yards")

    selection_components = score_candidate_set(train, selection, columns)
    train_components = score_candidate_set(train, train, columns)
    selection_pools = {
        name: joint.residual_pools(train, components) for name, components in train_components.items()
    }
    selection_probabilities = {
        name: joint.empirical_probabilities(selection, components, selection_pools[name])
        for name, components in selection_components.items()
    }
    selection_metrics = {
        name: joint.metrics(selection, components, selection_probabilities[name])
        for name, components in selection_components.items()
    }
    selected = min(joint.CANDIDATES, key=lambda name: (
        selection_metrics[name]["mae"], selection_metrics[name]["rmse"],
        selection_metrics[name]["averageThresholdBrier"], name,
    ))

    through_2024 = pd.concat([train, selection], ignore_index=True)
    confirmation_model = joint.fit_candidates(through_2024, columns, only=selected)[selected]
    confirmation_components = {
        "foundation": joint.foundation_components(confirmation),
        selected: joint.predict_candidate(confirmation_model, confirmation, columns, selected),
    }
    confirmation_pools = {
        "foundation": joint.residual_pools(selection, selection_components["foundation"]),
        selected: joint.residual_pools(selection, selection_components[selected]),
    }
    confirmation_probabilities = {
        name: joint.empirical_probabilities(confirmation, components, confirmation_pools[name])
        for name, components in confirmation_components.items()
    }
    confirmation_metrics = {
        name: joint.metrics(confirmation, components, confirmation_probabilities[name])
        for name, components in confirmation_components.items()
    }
    confirmation_bootstrap = joint.paired_bootstrap(
        confirmation, confirmation_components["foundation"], confirmation_components[selected],
        confirmation_probabilities["foundation"], confirmation_probabilities[selected],
    )

    workload_selection = workload_score(selection)
    workload_cutpoints = {
        "lowMaximum": float(np.quantile(workload_selection, 1 / 3)),
        "mediumMaximum": float(np.quantile(workload_selection, 2 / 3)),
    }
    position_segments = segment_metrics(
        confirmation, confirmation_components, confirmation_probabilities, selected,
        {position: confirmation["position"].fillna("UNK").astype(str).eq(position).to_numpy()
         for position in ("QB", "RB", "TE", "WR")},
    )
    workload = workload_score(confirmation)
    workload_segments = segment_metrics(
        confirmation, confirmation_components, confirmation_probabilities, selected,
        {
            "low": workload <= workload_cutpoints["lowMaximum"],
            "medium": (workload > workload_cutpoints["lowMaximum"]) & (workload <= workload_cutpoints["mediumMaximum"]),
            "high": workload > workload_cutpoints["mediumMaximum"],
        },
    )
    gates = chronological_gates(
        confirmation_metrics["foundation"], confirmation_metrics[selected], confirmation_bootstrap,
        position_segments, workload_segments, selected,
    )

    through_2025 = pd.concat([through_2024, confirmation], ignore_index=True)
    external_model = joint.fit_candidates(through_2025, columns, only=selected)[selected]
    external_components = {
        "foundation": joint.foundation_components(external),
        selected: joint.predict_candidate(external_model, external, columns, selected),
    }
    external_pools = {
        "foundation": joint.residual_pools(confirmation, confirmation_components["foundation"]),
        selected: joint.residual_pools(confirmation, confirmation_components[selected]),
    }
    external_probabilities = {
        name: joint.empirical_probabilities(external, components, external_pools[name])
        for name, components in external_components.items()
    }
    external_metrics = {
        name: joint.metrics(external, components, external_probabilities[name])
        for name, components in external_components.items()
    }
    external_bootstrap = joint.paired_bootstrap(
        external, external_components["foundation"], external_components[selected],
        external_probabilities["foundation"], external_probabilities[selected],
    )

    coverage = coverage_summary(frame, columns)
    result = {
        "release": RELEASE,
        "readOnly": True,
        "productionWrites": 0,
        "marketFeatures": [],
        "marketOfferRows": 0,
        "chronology": {
            "train": "2017-2023", "selection": 2024, "retrospectiveConfirmation": 2025,
            "externalConfirmation": "2026 Weeks 2-5", "calendarOrdered": True,
            "confirmationEpistemicallyUntouched": False,
            "contaminationReason": "Earlier r1 research selected architectures on and reported 2025 before this r2 declaration.",
        },
        "dataCoverage": coverage,
        "selection2024": selection_metrics,
        "selection": {"winner": selected, "criterion": "minimum 2024 MAE; RMSE then average threshold Brier"},
        "confirmation2025": {
            "metrics": confirmation_metrics,
            "pairedGameBootstrap95": confirmation_bootstrap,
            "workloadCutpointsFrozenOn2024": workload_cutpoints,
            "positionSegments": position_segments,
            "workloadSegments": workload_segments,
            "gates": gates,
        },
        "external2026Weeks2To5": {
            "metrics": external_metrics,
            "pairedGameBootstrap95": external_bootstrap,
            "alreadyRepeatedlyInspected": True,
        },
        "advancement": {
            "retrospectiveAccuracyGatePass": gates["allFrozenMetricGatesPass"],
            "trueUntouchedConfirmationPass": False,
            "productionAuthorized": False,
            "nextBlocker": "Collect future prospective outcomes joined to release-pure exact offers/prices after this declaration; 2025 cannot be made untouched retroactively.",
        },
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE, "coverage": coverage, "selection": result["selection"],
        "confirmation2025": result["confirmation2025"], "external2026Weeks2To5": result["external2026Weeks2To5"],
        "advancement": result["advancement"],
    }, indent=2, allow_nan=False))


def score_candidate_set(train: pd.DataFrame, scored: pd.DataFrame, columns: list[str]) -> dict:
    models = joint.fit_candidates(train, columns)
    return {
        "foundation": joint.foundation_components(scored),
        **{name: joint.predict_candidate(models[name], scored, columns, name) for name in joint.CANDIDATES},
    }


def workload_score(frame: pd.DataFrame) -> np.ndarray:
    attempts = common.row_mean(frame, ["prior_rushing_attempts_avg3", "prior_rushing_attempts_ewm"], fallback=0)
    targets = common.row_mean(frame, ["prior_targets_avg3", "prior_targets_ewm"], fallback=0)
    return np.clip(attempts + targets, 0, None)


def segment_metrics(frame: pd.DataFrame, components: dict, probabilities: dict, selected: str, masks: dict[str, np.ndarray]) -> dict:
    result = {}
    for name, mask in masks.items():
        if int(mask.sum()) < 100:
            result[name] = {"rows": int(mask.sum()), "eligibleForGate": False}
            continue
        subset = frame.loc[mask]
        result[name] = {
            "rows": len(subset), "eligibleForGate": True,
            "foundation": joint.metrics(
                subset, {key: value[mask] for key, value in components["foundation"].items()}, probabilities["foundation"][mask]
            ),
            selected: joint.metrics(
                subset, {key: value[mask] for key, value in components[selected].items()}, probabilities[selected][mask]
            ),
        }
    return result


def chronological_gates(foundation: dict, candidate: dict, bootstrap: dict, positions: dict, workloads: dict, selected: str) -> dict:
    metric_names = ("mae", "rmse", "averageThresholdBrier")
    threshold_wins = sum(candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"] for line in joint.LINES)

    def segment_gate(segments: dict, minimum_improvements: int) -> dict:
        eligible = [row for row in segments.values() if row["eligibleForGate"]]
        no_material_regression = {
            metric: all(row[selected][metric] <= row["foundation"][metric] * 1.02 for row in eligible)
            for metric in metric_names
        }
        improvement_counts = {
            metric: sum(row[selected][metric] < row["foundation"][metric] for row in eligible)
            for metric in metric_names
        }
        return {
            "eligibleSegments": len(eligible), "noMaterialRegression": no_material_regression,
            "improvementCounts": improvement_counts,
            "pass": all(no_material_regression.values()) and all(count >= minimum_improvements for count in improvement_counts.values()),
        }

    position_gate = segment_gate(positions, 3)
    workload_gate = segment_gate(workloads, 2)
    overall = {
        "allThreeMetricsImprove": all(candidate[metric] < foundation[metric] for metric in metric_names),
        "thresholdBrierWinsAtLeastFour": threshold_wins >= 4,
        "absoluteMeanBiasBelowFive": abs(candidate["meanProjection"] - candidate["meanActual"]) < 5,
        "allThreeClusteredIntervalsExcludeZeroImproving": all(
            bootstrap[key]["ci"][1] < 0 for key in ("maeDelta", "rmseDelta", "averageThresholdBrierDelta")
        ),
    }
    return {
        "overall": overall, "thresholdBrierWins": threshold_wins,
        "positionGate": position_gate, "workloadGate": workload_gate,
        "allFrozenMetricGatesPass": all(overall.values()) and position_gate["pass"] and workload_gate["pass"],
    }


def coverage_summary(frame: pd.DataFrame, columns: list[str]) -> dict:
    result = {}
    for season in (2024, 2025):
        rows = frame[frame["season"].eq(season)]
        coverage = rows[columns].notna().mean(axis=1)
        result[str(season)] = {
            "rows": len(rows), "games": int(rows["game_id"].nunique()), "players": int(rows["player_id"].nunique()),
            "positions": {key: int(value) for key, value in rows.groupby("position").size().items()},
            "featureCount": len(columns), "meanFeatureCoverage": float(coverage.mean()),
            "minimumFeatureCoverage": float(coverage.min()), "fifthPercentileFeatureCoverage": float(coverage.quantile(0.05)),
            "nonzeroCarryRows": int((pd.to_numeric(rows["rushing_attempts"], errors="coerce").fillna(0) > 0).sum()),
            "nonzeroTargetRows": int((pd.to_numeric(rows["targets"], errors="coerce").fillna(0) > 0).sum()),
        }
    result["supportsCalendarSplit"] = all(result[str(season)]["games"] == 272 for season in (2024, 2025))
    return result


if __name__ == "__main__":
    main()
