#!/usr/bin/env python3
"""Strict-calendar retrospective Passing Touchdowns confirmation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_passing_touchdowns as model


RELEASE = "nfl_player_props_passing_td_chronological_2026_10_16_r2"


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
    stats = model.load_years(cli.historical_root, cli.current_root, "player_stats", range(2016, 2027))
    pbp = model.load_years(
        cli.historical_root, cli.current_root, "pbp", range(2016, 2027), columns=model.PBP_COLUMNS
    )
    frame = model.build_frame(features, stats, pbp)
    train = frame[frame["season"].between(2017, 2023)].copy()
    selection = frame[frame["season"].eq(2024)].copy()
    confirmation = frame[frame["season"].eq(2025)].copy()
    external = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    columns = model.model_features(frame)

    selection_predictions = score_set(train, selection, columns)
    selection_metrics = {
        name: model.metrics(selection["passing_tds"].to_numpy(float), prediction)
        for name, prediction in selection_predictions.items()
    }
    selected = min(("poisson_glm", "poisson_hgb"), key=lambda name: (
        selection_metrics[name]["meanPoissonDeviance"],
        selection_metrics[name]["averageThresholdBrier"], selection_metrics[name]["mae"], name,
    ))

    through_2024 = pd.concat([train, selection], ignore_index=True)
    confirmation_model = model.fit_models(through_2024, columns)[selected]
    confirmation_predictions = {
        "foundation": model.foundation_mean(confirmation),
        selected: model.clipped(confirmation_model.predict(confirmation[columns])),
    }
    confirmation_metrics = {
        name: model.metrics(confirmation["passing_tds"].to_numpy(float), prediction)
        for name, prediction in confirmation_predictions.items()
    }
    confirmation_bootstrap = model.paired_game_bootstrap(
        confirmation["passing_tds"].to_numpy(float), confirmation_predictions["foundation"],
        confirmation_predictions[selected], confirmation["game_id"].astype(str).to_numpy(),
    )

    pass_cutpoints = tercile_cutpoints(pass_opportunity(selection))
    redzone_cutpoints = tercile_cutpoints(redzone_opportunity(selection))
    pass_segments = segment_metrics(
        confirmation, confirmation_predictions, selected,
        tercile_masks(pass_opportunity(confirmation), pass_cutpoints),
    )
    redzone_segments = segment_metrics(
        confirmation, confirmation_predictions, selected,
        tercile_masks(redzone_opportunity(confirmation), redzone_cutpoints),
    )
    gates = retrospective_gates(
        confirmation_metrics["foundation"], confirmation_metrics[selected], confirmation_bootstrap,
        pass_segments, redzone_segments, selected,
    )

    through_2025 = pd.concat([through_2024, confirmation], ignore_index=True)
    external_model = model.fit_models(through_2025, columns)[selected]
    external_predictions = {
        "foundation": model.foundation_mean(external),
        selected: model.clipped(external_model.predict(external[columns])),
    }
    external_metrics = {
        name: model.metrics(external["passing_tds"].to_numpy(float), prediction)
        for name, prediction in external_predictions.items()
    }
    external_bootstrap = model.paired_game_bootstrap(
        external["passing_tds"].to_numpy(float), external_predictions["foundation"],
        external_predictions[selected], external["game_id"].astype(str).to_numpy(),
    )

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
            "contaminationReason": "The earlier r1 tournament selected and inspected the candidates on 2025.",
        },
        "data": {
            "trainRows": len(train), "selectionRows": len(selection), "confirmationRows": len(confirmation),
            "externalRows": len(external), "selectionGames": int(selection["game_id"].nunique()),
            "confirmationGames": int(confirmation["game_id"].nunique()), "featureCount": len(columns),
            "selectionFeatureCoverage": coverage(selection, columns),
            "confirmationFeatureCoverage": coverage(confirmation, columns),
        },
        "selection2024": selection_metrics,
        "selection": {"winner": selected, "criterion": "minimum 2024 Poisson deviance; Brier then MAE"},
        "confirmation2025": {
            "metrics": confirmation_metrics,
            "pairedGameBootstrap95": confirmation_bootstrap,
            "passOpportunityCutpointsFrozenOn2024": pass_cutpoints,
            "redzoneOpportunityCutpointsFrozenOn2024": redzone_cutpoints,
            "passOpportunitySegments": pass_segments,
            "redzoneOpportunitySegments": redzone_segments,
            "dispersion": model.dispersion_audit(
                confirmation["passing_tds"].to_numpy(float), confirmation_predictions[selected]
            ),
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
            "nextBlocker": "Prospective post-declaration outcomes plus a release-pure exact Passing TD offer/price ledger.",
        },
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE, "data": result["data"], "selection": result["selection"],
        "confirmation2025": result["confirmation2025"], "external2026Weeks2To5": result["external2026Weeks2To5"],
        "advancement": result["advancement"],
    }, indent=2, allow_nan=False))


def score_set(train: pd.DataFrame, scored: pd.DataFrame, columns: list[str]) -> dict[str, np.ndarray]:
    fitted = model.fit_models(train, columns)
    return {
        "foundation": model.foundation_mean(scored),
        **{name: model.clipped(fitted[name].predict(scored[columns])) for name in ("poisson_glm", "poisson_hgb")},
    }


def pass_opportunity(frame: pd.DataFrame) -> np.ndarray:
    return model.row_mean(frame, [
        "prior_passing_attempts_avg3", "prior_passing_attempts_ewm", "prior_team_pass_attempts_avg3",
        "prior_team_pass_attempts_ewm", "prior_opponent_allowed_pass_attempts_avg3",
        "prior_opponent_allowed_pass_attempts_ewm",
    ], fallback=31.5)


def redzone_opportunity(frame: pd.DataFrame) -> np.ndarray:
    return model.row_mean(frame, [
        "prior_team_rz_pass_attempts_avg3", "prior_team_rz_pass_attempts_avg5",
        "prior_opponent_allowed_rz_pass_attempts_avg3", "prior_opponent_allowed_rz_pass_attempts_avg5",
    ], fallback=3.5)


def tercile_cutpoints(values: np.ndarray) -> dict[str, float]:
    return {"lowMaximum": float(np.quantile(values, 1 / 3)), "mediumMaximum": float(np.quantile(values, 2 / 3))}


def tercile_masks(values: np.ndarray, cutpoints: dict[str, float]) -> dict[str, np.ndarray]:
    low = cutpoints["lowMaximum"]
    medium = cutpoints["mediumMaximum"]
    return {"low": values <= low, "medium": (values > low) & (values <= medium), "high": values > medium}


def segment_metrics(frame: pd.DataFrame, predictions: dict[str, np.ndarray], selected: str, masks: dict[str, np.ndarray]) -> dict:
    actual = frame["passing_tds"].to_numpy(float)
    return {
        name: {
            "rows": int(mask.sum()),
            "foundation": model.metrics(actual[mask], predictions["foundation"][mask]),
            selected: model.metrics(actual[mask], predictions[selected][mask]),
        }
        for name, mask in masks.items()
    }


def retrospective_gates(foundation: dict, candidate: dict, bootstrap: dict, pass_segments: dict, redzone_segments: dict, selected: str) -> dict:
    threshold_wins = sum(
        candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"]
        for line in model.LINES
    )

    def segments(rows: dict) -> dict:
        no_regression = all(
            row[selected][metric] <= row["foundation"][metric] * 1.03
            for row in rows.values() for metric in ("meanPoissonDeviance", "averageThresholdBrier")
        )
        improvements = {
            metric: sum(row[selected][metric] < row["foundation"][metric] for row in rows.values())
            for metric in ("meanPoissonDeviance", "averageThresholdBrier")
        }
        return {"noMaterialRegression": no_regression, "improvementCounts": improvements,
                "pass": no_regression and all(value >= 2 for value in improvements.values())}

    overall = {
        "devianceImproves": candidate["meanPoissonDeviance"] < foundation["meanPoissonDeviance"],
        "maeImproves": candidate["mae"] < foundation["mae"],
        "averageBrierImproves": candidate["averageThresholdBrier"] < foundation["averageThresholdBrier"],
        "thresholdWinsAtLeastThree": threshold_wins >= 3,
        "absoluteMeanBiasBelowPointTwo": abs(candidate["meanProjection"] - candidate["meanActual"]) < 0.20,
        "clusteredDevianceAndBrierIntervalsImprove": (
            bootstrap["poissonDevianceDelta"]["ci"][1] < 0
            and bootstrap["averageThresholdBrierDelta"]["ci"][1] < 0
        ),
    }
    pass_gate = segments(pass_segments)
    redzone_gate = segments(redzone_segments)
    return {"overall": overall, "thresholdBrierWins": threshold_wins, "passOpportunityGate": pass_gate,
            "redzoneOpportunityGate": redzone_gate,
            "allFrozenMetricGatesPass": all(overall.values()) and pass_gate["pass"] and redzone_gate["pass"]}


def coverage(frame: pd.DataFrame, columns: list[str]) -> dict:
    values = frame[columns].notna().mean(axis=1)
    return {"mean": float(values.mean()), "minimum": float(values.min()), "fifthPercentile": float(values.quantile(0.05))}


if __name__ == "__main__":
    main()
