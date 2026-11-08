#!/usr/bin/env python3
"""Strict-calendar retrospective Field Goals Made and Kicking Points confirmation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

import tournament_nfl_player_props_kicking as market
import tournament_nfl_player_props_passing_touchdowns as common


RELEASE = "nfl_player_props_kicking_chronological_2026_10_16_r2"


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
    pbp = common.load_years(
        cli.historical_root, cli.current_root, "pbp", range(2016, 2027), columns=market.PBP_COLUMNS
    )
    frame = market.build_frame(features, stats, pbp)
    train = frame[frame["season"].between(2017, 2023)].copy()
    selection = frame[frame["season"].eq(2024)].copy()
    confirmation = frame[frame["season"].eq(2025)].copy()
    external = frame[frame["season"].eq(2026) & frame["week"].between(2, 5)].copy()
    columns = market.model_features(frame)

    selection_models = market.fit_component_models(train, columns)
    selection_all = all_component_predictions(selection, columns, selection_models)
    selection_component_metrics = component_metric_set(selection, selection_all)
    selected = {
        target: min(("poisson_glm", "poisson_hgb"), key=lambda name: (
            selection_component_metrics[target][name]["meanPoissonDeviance"],
            selection_component_metrics[target][name]["averageThresholdBrier"],
            selection_component_metrics[target][name]["mae"], name,
        )) for target in ("fg_made", "pat_made")
    }

    through_2024 = pd.concat([train, selection], ignore_index=True)
    confirmation_models = market.fit_component_models(through_2024, columns)
    confirmation_components = market.component_predictions(
        confirmation, columns, confirmation_models, selected
    )
    confirmation_metrics = outcome_metrics(confirmation, confirmation_components)
    confirmation_bootstrap = bootstraps(confirmation, confirmation_components)

    opportunity_cutpoints = cutpoints(scoring_opportunity(selection))
    opportunity_segments = segment_metrics(
        confirmation, confirmation_components,
        masks(scoring_opportunity(confirmation), opportunity_cutpoints),
    )
    weather_segments = segment_metrics(confirmation, confirmation_components, weather_masks(confirmation))
    gates = gate(confirmation_metrics, confirmation_bootstrap, opportunity_segments)

    through_2025 = pd.concat([through_2024, confirmation], ignore_index=True)
    external_models = market.fit_component_models(through_2025, columns)
    external_components = market.component_predictions(external, columns, external_models, selected)
    external_metrics = outcome_metrics(external, external_components)
    external_bootstrap = bootstraps(external, external_components)

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
        "selection2024Components": selection_component_metrics,
        "selection": {
            "fgMade": selected["fg_made"], "patMade": selected["pat_made"],
            "criterion": "minimum 2024 component Poisson deviance; Brier then MAE",
        },
        "confirmation2025": {
            "metrics": confirmation_metrics, "pairedGameBootstrap95": confirmation_bootstrap,
            "scoringOpportunityCutpointsFrozenOn2024": opportunity_cutpoints,
            "scoringOpportunitySegments": opportunity_segments,
            "fixedWeatherDiagnostics": weather_segments, "gates": gates,
        },
        "external2026Weeks2To5": {
            "metrics": external_metrics, "pairedGameBootstrap95": external_bootstrap,
            "alreadyRepeatedlyInspected": True,
        },
        "advancement": {
            "fieldGoalsMadeRetrospectiveGatePass": gates["fieldGoalsMade"]["pass"],
            "kickingPointsRetrospectiveGatePass": gates["kickingPoints"]["pass"],
            "trueUntouchedConfirmationPass": False, "productionAuthorized": False,
            "nextBlocker": "Prospective outcomes plus release-pure exact Field Goals Made and Kicking Points offer/price ledgers.",
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


def all_component_predictions(frame: pd.DataFrame, columns: list[str], models: dict) -> dict:
    result = {
        "foundation": {"fg_made": market.foundation_fg(frame), "pat_made": market.foundation_pat(frame)}
    }
    for architecture in ("poisson_glm", "poisson_hgb"):
        result[architecture] = {
            target: common.clipped(models[architecture][target].predict(frame[columns]))
            for target in ("fg_made", "pat_made")
        }
    return result


def component_metric_set(frame: pd.DataFrame, predictions: dict) -> dict:
    return {
        target: {
            name: common.metrics(frame[target].to_numpy(float), components[target])
            for name, components in predictions.items()
        } for target in ("fg_made", "pat_made")
    }


def outcome_metrics(frame: pd.DataFrame, components: dict) -> dict:
    return {
        "fieldGoalsMade": {
            name: common.metrics(frame["fg_made"].to_numpy(float), values["fg_made"])
            for name, values in components.items()
        },
        "kickingPoints": {
            name: market.kicking_points_metrics(
                frame["kicking_points"].to_numpy(float), values["fg_made"], values["pat_made"]
            ) for name, values in components.items()
        },
    }


def bootstraps(frame: pd.DataFrame, components: dict) -> dict:
    clusters = frame["game_id"].astype(str).to_numpy()
    return {
        "fieldGoalsMade": common.paired_game_bootstrap(
            frame["fg_made"].to_numpy(float), components["foundation"]["fg_made"],
            components["selected_components"]["fg_made"], clusters,
        ),
        "kickingPoints": market.kicking_points_bootstrap(
            frame["kicking_points"].to_numpy(float), components, clusters,
        ),
    }


def scoring_opportunity(frame: pd.DataFrame) -> np.ndarray:
    return common.row_mean(frame, [
        "prior_team_drive_opponent35_drives_avg3", "prior_team_drive_redzone_drives_avg3",
        "prior_team_fg_att_avg3", "prior_team_pat_att_avg3",
        "prior_opponent_allowed_fg_att_avg3", "prior_opponent_allowed_pat_att_avg3",
    ], fallback=2.0)


def cutpoints(values: np.ndarray) -> dict[str, float]:
    return {
        "lowMaximum": float(np.quantile(values, 1 / 3)),
        "mediumMaximum": float(np.quantile(values, 2 / 3)),
    }


def masks(values: np.ndarray, limits: dict[str, float]) -> dict[str, np.ndarray]:
    low, medium = limits["lowMaximum"], limits["mediumMaximum"]
    return {"low": values <= low, "medium": (values > low) & (values <= medium), "high": values > medium}


def weather_masks(frame: pd.DataFrame) -> dict[str, np.ndarray]:
    def values(column: str, fallback: float) -> np.ndarray:
        if column not in frame:
            return np.full(len(frame), fallback)
        return pd.to_numeric(frame[column], errors="coerce").fillna(fallback).to_numpy()

    outdoor = values("external_environment_outdoor", 0) >= 0.5
    fixed = values("external_environment_fixed_roof", 0) >= 0.5
    wind = values("external_environment_wind_mph", 5)
    temperature = values("external_environment_temperature_f", 60)
    controlled = fixed | ~outdoor
    mild = outdoor & ~fixed & (wind < 12) & (temperature >= 35)
    return {"controlled": controlled, "outdoorMild": mild, "outdoorAdverse": ~(controlled | mild)}


def segment_metrics(frame: pd.DataFrame, components: dict, groups: dict) -> dict:
    return {
        name: {"rows": int(mask.sum()), **outcome_metrics(frame.loc[mask], {
            architecture: {target: values[target][mask] for target in ("fg_made", "pat_made")}
            for architecture, values in components.items()
        })} for name, mask in groups.items()
    }


def gate(metrics: dict, bootstrap: dict, opportunity: dict) -> dict:
    fg_base, fg_cand = metrics["fieldGoalsMade"]["foundation"], metrics["fieldGoalsMade"]["selected_components"]
    points_base = metrics["kickingPoints"]["foundation"]
    points_cand = metrics["kickingPoints"]["selected_components"]
    fg_names = ("mae", "meanPoissonDeviance", "averageThresholdBrier")
    point_names = ("mae", "rmse", "averageThresholdBrier")
    fg_wins = sum(
        fg_cand["thresholds"][str(line)]["brier"] < fg_base["thresholds"][str(line)]["brier"]
        for line in common.LINES
    )
    point_wins = sum(
        points_cand["thresholds"][str(line)]["brier"] < points_base["thresholds"][str(line)]["brier"]
        for line in market.KICKING_POINT_LINES
    )

    def segment_gate(outcome: str, names: tuple[str, ...]) -> dict:
        rows = [segment[outcome] for segment in opportunity.values()]
        no_regression = all(
            row["selected_components"][metric] <= row["foundation"][metric] * 1.05
            for row in rows for metric in names
        )
        all_three = sum(
            all(row["selected_components"][metric] < row["foundation"][metric] for metric in names)
            for row in rows
        )
        return {"noMaterialRegression": no_regression, "segmentsImprovingAllThree": all_three,
                "pass": no_regression and all_three >= 2}

    fg_segment = segment_gate("fieldGoalsMade", fg_names)
    point_segment = segment_gate("kickingPoints", point_names)
    fg_checks = {
        "allThreeMetricsImprove": all(fg_cand[name] < fg_base[name] for name in fg_names),
        "thresholdWinsAtLeastThree": fg_wins >= 3,
        "allThreeClusteredIntervalsImprove": all(
            bootstrap["fieldGoalsMade"][key]["ci"][1] < 0
            for key in ("maeDelta", "poissonDevianceDelta", "averageThresholdBrierDelta")
        ),
        "opportunitySegmentsPass": fg_segment["pass"],
    }
    point_checks = {
        "allThreeMetricsImprove": all(points_cand[name] < points_base[name] for name in point_names),
        "thresholdWinsAtLeastFour": point_wins >= 4,
        "allThreeClusteredIntervalsImprove": all(
            bootstrap["kickingPoints"][key]["ci"][1] < 0
            for key in ("maeDelta", "rmseDelta", "averageThresholdBrierDelta")
        ),
        "opportunitySegmentsPass": point_segment["pass"],
    }
    return {
        "fieldGoalsMade": {"checks": fg_checks, "thresholdBrierWins": fg_wins,
                           "opportunityGate": fg_segment, "pass": all(fg_checks.values())},
        "kickingPoints": {"checks": point_checks, "thresholdBrierWins": point_wins,
                          "opportunityGate": point_segment, "pass": all(point_checks.values())},
    }


if __name__ == "__main__":
    main()
