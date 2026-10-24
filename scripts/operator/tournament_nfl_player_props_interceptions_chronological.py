#!/usr/bin/env python3
"""Strict-calendar retrospective quarterback Interceptions confirmation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_interceptions as market
import tournament_nfl_player_props_passing_touchdowns as common


RELEASE = "nfl_player_props_interceptions_chronological_2026_10_16_r2"


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
    stats = common.load_years(cli.historical_root, cli.current_root, "player_stats", range(2016, 2027))
    frame = market.build_frame(features, stats)
    train = frame[frame["season"].between(2017, 2023)].copy()
    selection = frame[frame["season"].eq(2024)].copy()
    confirmation = frame[frame["season"].eq(2025)].copy()
    external = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    columns = market.model_features(frame)

    selection_predictions = score_set(train, selection, columns)
    selection_metrics = metric_set(selection, selection_predictions)
    selected = min(("poisson_glm", "poisson_hgb"), key=lambda name: (
        selection_metrics[name]["meanPoissonDeviance"],
        selection_metrics[name]["averageThresholdBrier"], selection_metrics[name]["mae"], name,
    ))

    through_2024 = pd.concat([train, selection], ignore_index=True)
    confirmation_model = market.fit_models(through_2024, columns)[selected]
    confirmation_predictions = {
        "foundation": market.foundation_mean(confirmation),
        selected: common.clipped(confirmation_model.predict(confirmation[columns])),
    }
    confirmation_metrics = metric_set(confirmation, confirmation_predictions)
    confirmation_bootstrap = common.paired_game_bootstrap(
        confirmation["passing_interceptions"].to_numpy(float), confirmation_predictions["foundation"],
        confirmation_predictions[selected], confirmation["game_id"].astype(str).to_numpy(),
    )
    pass_cutpoints = cutpoints(pass_opportunity(selection))
    pressure_cutpoints = cutpoints(pressure_exposure(selection))
    pass_segments = segment_metrics(
        confirmation, confirmation_predictions, selected,
        masks(pass_opportunity(confirmation), pass_cutpoints),
    )
    pressure_segments = segment_metrics(
        confirmation, confirmation_predictions, selected,
        masks(pressure_exposure(confirmation), pressure_cutpoints),
    )
    gates = gate(
        confirmation_metrics["foundation"], confirmation_metrics[selected], confirmation_bootstrap,
        pass_segments, pressure_segments, selected,
    )

    through_2025 = pd.concat([through_2024, confirmation], ignore_index=True)
    external_model = market.fit_models(through_2025, columns)[selected]
    external_predictions = {
        "foundation": market.foundation_mean(external),
        selected: common.clipped(external_model.predict(external[columns])),
    }
    external_metrics = metric_set(external, external_predictions)
    external_bootstrap = common.paired_game_bootstrap(
        external["passing_interceptions"].to_numpy(float), external_predictions["foundation"],
        external_predictions[selected], external["game_id"].astype(str).to_numpy(),
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
            "confirmationGames": int(confirmation["game_id"].nunique()), "featureCount": len(columns),
        },
        "selection2024": selection_metrics,
        "selection": {"winner": selected, "criterion": "minimum 2024 Poisson deviance; Brier then MAE"},
        "confirmation2025": {
            "metrics": confirmation_metrics, "pairedGameBootstrap95": confirmation_bootstrap,
            "passOpportunityCutpointsFrozenOn2024": pass_cutpoints,
            "pressureExposureCutpointsFrozenOn2024": pressure_cutpoints,
            "passOpportunitySegments": pass_segments, "pressureExposureSegments": pressure_segments,
            "dispersion": common.dispersion_audit(
                confirmation["passing_interceptions"].to_numpy(float), confirmation_predictions[selected]
            ),
            "gates": gates,
        },
        "external2026Weeks2To5": {
            "metrics": external_metrics, "pairedGameBootstrap95": external_bootstrap,
            "alreadyRepeatedlyInspected": True,
        },
        "advancement": {
            "retrospectiveAccuracyGatePass": gates["allFrozenMetricGatesPass"],
            "trueUntouchedConfirmationPass": False, "productionAuthorized": False,
            "nextBlocker": "Prospective post-declaration outcomes plus a release-pure exact Interceptions offer/price ledger.",
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
        "foundation": market.foundation_mean(scored),
        **{name: common.clipped(fitted[name].predict(scored[columns])) for name in ("poisson_glm", "poisson_hgb")},
    }


def metric_set(frame: pd.DataFrame, predictions: dict) -> dict:
    actual = frame["passing_interceptions"].to_numpy(float)
    return {name: common.metrics(actual, prediction) for name, prediction in predictions.items()}


def pass_opportunity(frame: pd.DataFrame) -> np.ndarray:
    return common.row_mean(frame, [
        "prior_passing_attempts_avg3", "prior_passing_attempts_ewm", "prior_team_pass_attempts_avg3",
        "prior_opponent_allowed_pass_attempts_avg3", "external_state_team_plays_avg3",
    ], fallback=31.5)


def pressure_exposure(frame: pd.DataFrame) -> np.ndarray:
    return common.row_mean(frame, [
        "external_state_opponent_allowed_qb_hit_rate_avg3", "external_state_opponent_allowed_sack_rate_avg3",
        "external_pfr_pass_times_pressured_pct_ewm", "external_pfr_pass_times_hit_ewm",
    ], fallback=0.12)


def cutpoints(values: np.ndarray) -> dict[str, float]:
    return {"lowMaximum": float(np.quantile(values, 1 / 3)),
            "mediumMaximum": float(np.quantile(values, 2 / 3))}


def masks(values: np.ndarray, limits: dict[str, float]) -> dict[str, np.ndarray]:
    low, medium = limits["lowMaximum"], limits["mediumMaximum"]
    return {"low": values <= low, "medium": (values > low) & (values <= medium), "high": values > medium}


def segment_metrics(frame: pd.DataFrame, predictions: dict, selected: str, groups: dict) -> dict:
    actual = frame["passing_interceptions"].to_numpy(float)
    return {name: {
        "rows": int(mask.sum()),
        "foundation": common.metrics(actual[mask], predictions["foundation"][mask]),
        selected: common.metrics(actual[mask], predictions[selected][mask]),
    } for name, mask in groups.items()}


def gate(foundation: dict, candidate: dict, bootstrap: dict, passes: dict, pressure: dict, selected: str) -> dict:
    threshold_wins = sum(
        candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"]
        for line in common.LINES
    )

    def segment_gate(rows: dict) -> dict:
        names = ("meanPoissonDeviance", "averageThresholdBrier")
        no_regression = all(
            row[selected][metric] <= row["foundation"][metric] * 1.03
            for row in rows.values() for metric in names
        )
        improvements = {
            metric: sum(row[selected][metric] < row["foundation"][metric] for row in rows.values())
            for metric in names
        }
        return {"noMaterialRegression": no_regression, "improvementCounts": improvements,
                "pass": no_regression and all(value >= 2 for value in improvements.values())}

    overall = {
        "devianceImproves": candidate["meanPoissonDeviance"] < foundation["meanPoissonDeviance"],
        "maeImproves": candidate["mae"] < foundation["mae"],
        "averageBrierImproves": candidate["averageThresholdBrier"] < foundation["averageThresholdBrier"],
        "thresholdWinsAtLeastThree": threshold_wins >= 3,
        "clusteredDevianceAndBrierIntervalsImprove": (
            bootstrap["poissonDevianceDelta"]["ci"][1] < 0
            and bootstrap["averageThresholdBrierDelta"]["ci"][1] < 0
        ),
    }
    pass_gate, pressure_gate = segment_gate(passes), segment_gate(pressure)
    return {"overall": overall, "thresholdBrierWins": threshold_wins,
            "passOpportunityGate": pass_gate, "pressureExposureGate": pressure_gate,
            "allFrozenMetricGatesPass": all(overall.values()) and pass_gate["pass"] and pressure_gate["pass"]}


if __name__ == "__main__":
    main()
