#!/usr/bin/env python3
"""Strict-calendar retrospective Longest Rush confirmation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_longest_rush as market
import tournament_nfl_player_props_passing_touchdowns as common


RELEASE = "nfl_player_props_longest_rush_chronological_2026_10_16_r2"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--historical-root", type=Path, required=True)
    parser.add_argument("--current-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    cli = parse_args()
    features = pd.read_parquet(cli.features)
    pbp = common.load_years(
        cli.historical_root, cli.current_root, "pbp", range(2016, 2027), columns=market.PBP_COLUMNS
    )
    frame = market.build_frame(features, pbp)
    train = frame[frame["season"].between(2017, 2023)].copy()
    selection = frame[frame["season"].eq(2024)].copy()
    confirmation = frame[frame["season"].eq(2025)].copy()
    external = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    columns = market.model_features(frame)

    train_predictions = score_set(train, train, columns)
    selection_predictions = score_set(train, selection, columns)
    selection_sigmas = {
        name: market.log_sigma(train["longest_rush"].to_numpy(float), prediction)
        for name, prediction in train_predictions.items()
    }
    selection_metrics = metrics_set(selection, selection_predictions, selection_sigmas)
    selected = min(("ridge_log", "hgb_log"), key=lambda name: (
        selection_metrics[name]["mae"], selection_metrics[name]["rmse"],
        selection_metrics[name]["averageThresholdBrier"], name,
    ))

    through_2024 = pd.concat([train, selection], ignore_index=True)
    confirmation_model = market.fit_models(through_2024, columns)[selected]
    confirmation_predictions = {
        "foundation": market.foundation_projection(confirmation),
        selected: market.predict(confirmation_model, confirmation[columns]),
    }
    confirmation_sigmas = {
        "foundation": market.log_sigma(
            selection["longest_rush"].to_numpy(float), selection_predictions["foundation"]
        ),
        selected: market.log_sigma(
            selection["longest_rush"].to_numpy(float), selection_predictions[selected]
        ),
    }
    confirmation_metrics = metrics_set(confirmation, confirmation_predictions, confirmation_sigmas, selected)
    confirmation_bootstrap = market.paired_bootstrap(
        confirmation["longest_rush"].to_numpy(float), confirmation_predictions["foundation"],
        confirmation_predictions[selected], confirmation_sigmas,
        confirmation["game_id"].astype(str).to_numpy(), selected, market.LINES,
    )

    carry_cutpoints = cutpoints(carry_volume(selection))
    explosive_cutpoints = cutpoints(explosive_rate(selection))
    carry_segments = segment_metrics(
        confirmation, confirmation_predictions, confirmation_sigmas, selected,
        masks(carry_volume(confirmation), carry_cutpoints),
    )
    explosive_segments = segment_metrics(
        confirmation, confirmation_predictions, confirmation_sigmas, selected,
        masks(explosive_rate(confirmation), explosive_cutpoints),
    )
    gates = gate(
        confirmation_metrics["foundation"], confirmation_metrics[selected], confirmation_bootstrap,
        carry_segments, explosive_segments, selected,
    )

    through_2025 = pd.concat([through_2024, confirmation], ignore_index=True)
    external_model = market.fit_models(through_2025, columns)[selected]
    external_predictions = {
        "foundation": market.foundation_projection(external),
        selected: market.predict(external_model, external[columns]),
    }
    external_sigmas = {
        "foundation": market.log_sigma(
            confirmation["longest_rush"].to_numpy(float), confirmation_predictions["foundation"]
        ),
        selected: market.log_sigma(
            confirmation["longest_rush"].to_numpy(float), confirmation_predictions[selected]
        ),
    }
    external_metrics = metrics_set(external, external_predictions, external_sigmas, selected)
    external_bootstrap = market.paired_bootstrap(
        external["longest_rush"].to_numpy(float), external_predictions["foundation"],
        external_predictions[selected], external_sigmas,
        external["game_id"].astype(str).to_numpy(), selected, market.LINES,
    )

    result = {
        "release": RELEASE, "readOnly": True, "productionWrites": 0,
        "marketFeatures": [], "marketOfferRows": 0,
        "chronology": {
            "train": "2017-2023", "selection": 2024, "retrospectiveConfirmation": 2025,
            "externalConfirmation": "2026 Weeks 2-5", "calendarOrdered": True,
            "confirmationEpistemicallyUntouched": False,
            "contaminationReason": "The r1 tournament selected and inspected these architectures on 2025.",
        },
        "data": {
            "trainRows": len(train), "selectionRows": len(selection),
            "confirmationRows": len(confirmation), "externalRows": len(external),
            "selectionGames": int(selection["game_id"].nunique()),
            "confirmationGames": int(confirmation["game_id"].nunique()),
            "featureCount": len(columns),
        },
        "selection2024": selection_metrics,
        "selection": {"winner": selected, "criterion": "minimum 2024 MAE; RMSE then Brier"},
        "confirmation2025": {
            "metrics": confirmation_metrics, "pairedGameBootstrap95": confirmation_bootstrap,
            "carryVolumeCutpointsFrozenOn2024": carry_cutpoints,
            "explosiveRateCutpointsFrozenOn2024": explosive_cutpoints,
            "carryVolumeSegments": carry_segments, "explosiveRateSegments": explosive_segments,
            "gates": gates,
        },
        "external2026Weeks2To5": {
            "metrics": external_metrics, "pairedGameBootstrap95": external_bootstrap,
            "alreadyRepeatedlyInspected": True,
        },
        "advancement": {
            "retrospectiveAccuracyGatePass": gates["allFrozenMetricGatesPass"],
            "trueUntouchedConfirmationPass": False, "productionAuthorized": False,
            "nextBlocker": "Prospective post-declaration outcomes plus a release-pure exact Longest Rush offer/price ledger.",
        },
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE, "data": result["data"], "selection": result["selection"],
        "confirmation2025": result["confirmation2025"],
        "external2026Weeks2To5": result["external2026Weeks2To5"],
        "advancement": result["advancement"],
    }, indent=2, allow_nan=False))


def score_set(train: pd.DataFrame, scored: pd.DataFrame, columns: list[str]) -> dict[str, np.ndarray]:
    fitted = market.fit_models(train, columns)
    return {
        "foundation": market.foundation_projection(scored),
        **{name: market.predict(fitted[name], scored[columns]) for name in ("ridge_log", "hgb_log")},
    }


def metrics_set(
    frame: pd.DataFrame, predictions: dict, sigmas: dict, selected: str | None = None
) -> dict:
    names = ("foundation", selected) if selected else ("foundation", "ridge_log", "hgb_log")
    actual = frame["longest_rush"].to_numpy(float)
    return {name: market.metrics(actual, predictions[name], sigmas[name], market.LINES) for name in names}


def carry_volume(frame: pd.DataFrame) -> np.ndarray:
    return common.row_mean(frame, [
        "prior_rushing_attempts_avg3", "prior_rushing_attempts_ewm", "prior_rushes_avg3",
    ], fallback=4.0)


def explosive_rate(frame: pd.DataFrame) -> np.ndarray:
    return common.row_mean(frame, [
        "prior_explosive_10_rate3", "prior_explosive_10_rate5",
        "prior_explosive_20_rate3", "prior_explosive_20_rate5",
    ], fallback=0.07)


def cutpoints(values: np.ndarray) -> dict[str, float]:
    return {
        "lowMaximum": float(np.quantile(values, 1 / 3)),
        "mediumMaximum": float(np.quantile(values, 2 / 3)),
    }


def masks(values: np.ndarray, limits: dict[str, float]) -> dict[str, np.ndarray]:
    low, medium = limits["lowMaximum"], limits["mediumMaximum"]
    return {"low": values <= low, "medium": (values > low) & (values <= medium), "high": values > medium}


def segment_metrics(
    frame: pd.DataFrame, predictions: dict, sigmas: dict, selected: str, groups: dict
) -> dict:
    actual = frame["longest_rush"].to_numpy(float)
    return {name: {
        "rows": int(mask.sum()),
        "foundation": market.metrics(
            actual[mask], predictions["foundation"][mask], sigmas["foundation"], market.LINES
        ),
        selected: market.metrics(
            actual[mask], predictions[selected][mask], sigmas[selected], market.LINES
        ),
    } for name, mask in groups.items()}


def gate(
    foundation: dict, candidate: dict, bootstrap: dict, carry: dict, explosive: dict, selected: str
) -> dict:
    metric_names = ("mae", "rmse", "averageThresholdBrier")
    threshold_wins = sum(
        candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"]
        for line in market.LINES
    )

    def segment_gate(rows: dict) -> dict:
        no_regression = all(
            row[selected][metric] <= row["foundation"][metric] * 1.03
            for row in rows.values() for metric in metric_names
        )
        all_three_improve = sum(
            all(row[selected][metric] < row["foundation"][metric] for metric in metric_names)
            for row in rows.values()
        )
        return {
            "noMaterialRegression": no_regression,
            "segmentsImprovingAllThree": all_three_improve,
            "pass": no_regression and all_three_improve >= 2,
        }

    overall = {
        "allThreeMetricsImprove": all(candidate[metric] < foundation[metric] for metric in metric_names),
        "thresholdWinsAtLeastFour": threshold_wins >= 4,
        "absoluteMeanBiasBelowTwo": abs(candidate["meanProjection"] - candidate["meanActual"]) < 2,
        "allThreeClusteredIntervalsImprove": all(
            bootstrap[key]["ci"][1] < 0
            for key in ("maeDelta", "rmseDelta", "averageThresholdBrierDelta")
        ),
    }
    carry_gate, explosive_gate = segment_gate(carry), segment_gate(explosive)
    return {
        "overall": overall, "thresholdBrierWins": threshold_wins,
        "carryVolumeGate": carry_gate, "explosiveRateGate": explosive_gate,
        "allFrozenMetricGatesPass": all(overall.values()) and carry_gate["pass"] and explosive_gate["pass"],
    }


if __name__ == "__main__":
    main()
