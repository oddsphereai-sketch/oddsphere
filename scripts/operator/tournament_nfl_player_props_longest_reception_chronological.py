#!/usr/bin/env python3
"""Strict-calendar retrospective Longest Reception confirmation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_longest_rush as extreme
import tournament_nfl_player_props_passing_touchdowns as common
import tournament_nfl_player_props_remaining_yards as remaining


RELEASE = "nfl_player_props_longest_reception_chronological_2026_10_16_r2"
MARKET = "longest_reception"
LINES = remaining.MARKETS[MARKET]


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
        cli.historical_root, cli.current_root, "pbp", range(2016, 2027), columns=remaining.PBP_COLUMNS
    )
    frame = remaining.build_longest_reception(features, pbp)
    train = frame[frame["season"].between(2017, 2023)].copy()
    selection = frame[frame["season"].eq(2024)].copy()
    confirmation = frame[frame["season"].eq(2025)].copy()
    external = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    columns = remaining.model_features(frame, MARKET)

    train_predictions = score_set(train, train, columns)
    selection_predictions = score_set(train, selection, columns)
    selection_sigmas = {name: extreme.log_sigma(train[MARKET].to_numpy(float), value)
                        for name, value in train_predictions.items()}
    selection_metrics = metrics_set(selection, selection_predictions, selection_sigmas, ("foundation", "ridge_log", "hgb_log"))
    selected = min(("ridge_log", "hgb_log"), key=lambda name: (
        selection_metrics[name]["mae"], selection_metrics[name]["rmse"],
        selection_metrics[name]["averageThresholdBrier"], name,
    ))

    through_2024 = pd.concat([train, selection], ignore_index=True)
    fitted = extreme.fit_models(remaining.rename_target(through_2024, MARKET), columns)[selected]
    confirmation_predictions = {
        "foundation": remaining.foundation_projection(confirmation, MARKET),
        selected: extreme.predict(fitted, confirmation[columns]),
    }
    confirmation_sigmas = {
        "foundation": extreme.log_sigma(selection[MARKET].to_numpy(float), selection_predictions["foundation"]),
        selected: extreme.log_sigma(selection[MARKET].to_numpy(float), selection_predictions[selected]),
    }
    confirmation_metrics = metrics_set(confirmation, confirmation_predictions, confirmation_sigmas, ("foundation", selected))
    bootstrap = extreme.paired_bootstrap(
        confirmation[MARKET].to_numpy(float), confirmation_predictions["foundation"], confirmation_predictions[selected],
        confirmation_sigmas, confirmation["game_id"].astype(str).to_numpy(), selected, LINES,
    )
    target_limits = cutpoints(target_volume(selection))
    explosive_limits = cutpoints(explosive_rate(selection))
    target_segments = segments(confirmation, confirmation_predictions, confirmation_sigmas, selected,
                               masks(target_volume(confirmation), target_limits))
    explosive_segments = segments(confirmation, confirmation_predictions, confirmation_sigmas, selected,
                                  masks(explosive_rate(confirmation), explosive_limits))
    gates = gate(confirmation_metrics["foundation"], confirmation_metrics[selected], bootstrap,
                 target_segments, explosive_segments, selected)

    through_2025 = pd.concat([through_2024, confirmation], ignore_index=True)
    external_model = extreme.fit_models(remaining.rename_target(through_2025, MARKET), columns)[selected]
    external_predictions = {
        "foundation": remaining.foundation_projection(external, MARKET),
        selected: extreme.predict(external_model, external[columns]),
    }
    external_sigmas = {
        "foundation": extreme.log_sigma(confirmation[MARKET].to_numpy(float), confirmation_predictions["foundation"]),
        selected: extreme.log_sigma(confirmation[MARKET].to_numpy(float), confirmation_predictions[selected]),
    }
    external_metrics = metrics_set(external, external_predictions, external_sigmas, ("foundation", selected))
    external_bootstrap = extreme.paired_bootstrap(
        external[MARKET].to_numpy(float), external_predictions["foundation"], external_predictions[selected],
        external_sigmas, external["game_id"].astype(str).to_numpy(), selected, LINES,
    )
    result = {
        "release": RELEASE, "readOnly": True, "productionWrites": 0, "marketFeatures": [], "marketOfferRows": 0,
        "chronology": {"train": "2017-2023", "selection": 2024, "retrospectiveConfirmation": 2025,
                       "externalConfirmation": "2026 Weeks 2-5", "calendarOrdered": True,
                       "confirmationEpistemicallyUntouched": False,
                       "contaminationReason": "The r1 tournament selected and inspected these architectures on 2025."},
        "data": {"trainRows": len(train), "selectionRows": len(selection), "confirmationRows": len(confirmation),
                 "externalRows": len(external), "selectionGames": int(selection["game_id"].nunique()),
                 "confirmationGames": int(confirmation["game_id"].nunique()), "featureCount": len(columns)},
        "selection2024": selection_metrics,
        "selection": {"winner": selected, "criterion": "minimum 2024 MAE; RMSE then Brier"},
        "confirmation2025": {"metrics": confirmation_metrics, "pairedGameBootstrap95": bootstrap,
                             "targetVolumeCutpointsFrozenOn2024": target_limits,
                             "explosiveRateCutpointsFrozenOn2024": explosive_limits,
                             "targetVolumeSegments": target_segments, "explosiveRateSegments": explosive_segments,
                             "gates": gates},
        "external2026Weeks2To5": {"metrics": external_metrics, "pairedGameBootstrap95": external_bootstrap,
                                         "alreadyRepeatedlyInspected": True},
        "advancement": {"retrospectiveAccuracyGatePass": gates["allFrozenMetricGatesPass"],
                        "trueUntouchedConfirmationPass": False, "productionAuthorized": False,
                        "nextBlocker": "Prospective outcomes plus a release-pure exact Longest Reception offer/price ledger."},
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"release": RELEASE, "data": result["data"], "selection": result["selection"],
                      "confirmation2025": result["confirmation2025"],
                      "external2026Weeks2To5": result["external2026Weeks2To5"],
                      "advancement": result["advancement"]}, indent=2, allow_nan=False))


def score_set(train: pd.DataFrame, scored: pd.DataFrame, columns: list[str]) -> dict[str, np.ndarray]:
    fitted = extreme.fit_models(remaining.rename_target(train, MARKET), columns)
    return {"foundation": remaining.foundation_projection(scored, MARKET),
            **{name: extreme.predict(fitted[name], scored[columns]) for name in ("ridge_log", "hgb_log")}}


def metrics_set(frame: pd.DataFrame, predictions: dict, sigmas: dict, names) -> dict:
    actual = frame[MARKET].to_numpy(float)
    return {name: extreme.metrics(actual, predictions[name], sigmas[name], LINES) for name in names}


def target_volume(frame: pd.DataFrame) -> np.ndarray:
    return common.row_mean(frame, ["prior_targets_avg3", "prior_targets_avg5", "prior_targets_ewm"], fallback=4)


def explosive_rate(frame: pd.DataFrame) -> np.ndarray:
    return common.row_mean(frame, ["prior_explosive_20_rate3", "prior_explosive_20_rate5",
                                   "prior_explosive_40_rate3", "prior_explosive_40_rate5"], fallback=0.04)


def cutpoints(values: np.ndarray) -> dict[str, float]:
    return {"lowMaximum": float(np.quantile(values, 1 / 3)), "mediumMaximum": float(np.quantile(values, 2 / 3))}


def masks(values: np.ndarray, limits: dict[str, float]) -> dict[str, np.ndarray]:
    low, medium = limits["lowMaximum"], limits["mediumMaximum"]
    return {"low": values <= low, "medium": (values > low) & (values <= medium), "high": values > medium}


def segments(frame: pd.DataFrame, predictions: dict, sigmas: dict, selected: str, groups: dict) -> dict:
    actual = frame[MARKET].to_numpy(float)
    return {name: {"rows": int(mask.sum()),
                   "foundation": extreme.metrics(actual[mask], predictions["foundation"][mask], sigmas["foundation"], LINES),
                   selected: extreme.metrics(actual[mask], predictions[selected][mask], sigmas[selected], LINES)}
            for name, mask in groups.items()}


def gate(foundation: dict, candidate: dict, bootstrap: dict, first: dict, second: dict, selected: str) -> dict:
    metrics = ("mae", "rmse", "averageThresholdBrier")
    wins = sum(candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"] for line in LINES)

    def segment_gate(rows: dict) -> dict:
        no_regression = all(row[selected][metric] <= row["foundation"][metric] * 1.03 for row in rows.values() for metric in metrics)
        improved = sum(all(row[selected][metric] < row["foundation"][metric] for metric in metrics) for row in rows.values())
        return {"noMaterialRegression": no_regression, "segmentsImprovingAllThree": improved,
                "pass": no_regression and improved >= 2}

    overall = {"allThreeMetricsImprove": all(candidate[metric] < foundation[metric] for metric in metrics),
               "thresholdWinsAtLeastFour": wins >= 4,
               "absoluteMeanBiasBelowTwo": abs(candidate["meanProjection"] - candidate["meanActual"]) < 2,
               "allThreeClusteredIntervalsImprove": all(bootstrap[key]["ci"][1] < 0 for key in (
                   "maeDelta", "rmseDelta", "averageThresholdBrierDelta"))}
    first_gate, second_gate = segment_gate(first), segment_gate(second)
    return {"overall": overall, "thresholdBrierWins": wins, "targetVolumeGate": first_gate,
            "explosiveRateGate": second_gate,
            "allFrozenMetricGatesPass": all(overall.values()) and first_gate["pass"] and second_gate["pass"]}


if __name__ == "__main__":
    main()
