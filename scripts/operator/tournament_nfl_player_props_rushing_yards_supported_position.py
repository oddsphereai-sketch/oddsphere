#!/usr/bin/env python3
"""Support-gated RB-only Rushing Yards point and probability tournament."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
POINT_MODULE = ROOT / "scripts/operator/tournament_nfl_player_props_rushing_yards_position_hybrid.py"
CALIBRATION_MODULE = ROOT / "scripts/operator/tournament_nfl_player_props_rushing_yards_position_hybrid_calibration.py"
SOURCE = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_team_factorization_rows_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_through_week_5_r2.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_supported_position_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_supported_position_rows_r1.parquet"
SUPPORTED_POSITION = "RB"


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, default=SOURCE)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()
    point = load("props_rushing_yards_supported_point", POINT_MODULE)
    calibration = load("props_rushing_yards_supported_calibration", CALIBRATION_MODULE)

    rows = pd.read_parquet(args.source).copy()
    supported = rows["position"].eq(SUPPORTED_POSITION)
    rows["supported_projection"] = np.where(
        supported,
        rows["candidate_projection"].to_numpy(float),
        rows["reference_projection"].to_numpy(float),
    )
    rows["supported_authority"] = np.where(supported, "factorized_rb", "released_fallback")

    point_phases: dict[str, Any] = {}
    fallback_exact = True
    for phase in ("selection", "confirmation", "locked_replay"):
        values = rows[rows["phase"].eq(phase)].copy()
        rb = values["position"].eq(SUPPORTED_POSITION).to_numpy()
        fallback = ~rb
        offered = phase == "locked_replay"
        def report(mask: np.ndarray) -> dict[str, Any]:
            selected = values.loc[mask]
            result = {
                "reference": point.metrics(
                    selected["actual"].to_numpy(float), selected["reference_projection"].to_numpy(float),
                ),
                "candidate": point.metrics(
                    selected["actual"].to_numpy(float), selected["supported_projection"].to_numpy(float),
                ),
                "changedProjections": int((~np.isclose(
                    selected["reference_projection"], selected["supported_projection"], atol=1e-12,
                )).sum()),
            }
            if offered:
                result["directionReference"] = point.direction(
                    selected["actual"].to_numpy(float),
                    selected["reference_projection"].to_numpy(float),
                    selected["line"].to_numpy(float),
                )
                result["directionCandidate"] = point.direction(
                    selected["actual"].to_numpy(float),
                    selected["supported_projection"].to_numpy(float),
                    selected["line"].to_numpy(float),
                )
            return result
        point_phases[phase] = {
            "all": report(np.ones(len(values), dtype=bool)),
            "rb": report(rb),
            "fallback": report(fallback),
        }
        fallback_exact = fallback_exact and bool(np.allclose(
            values.loc[fallback, "reference_projection"],
            values.loc[fallback, "supported_projection"],
            atol=0,
            rtol=0,
        ))
        if phase == "confirmation":
            stability_values = values.rename(columns={"supported_projection": "hybrid_projection"})
            point_phases[phase]["stability"] = point.stability(stability_values)

    selection = point_phases["selection"]
    confirmation = point_phases["confirmation"]
    current_point = point_phases["locked_replay"]
    point_passes = bool(
        fallback_exact
        and selection["all"]["candidate"]["mae"] < selection["all"]["reference"]["mae"]
        and selection["all"]["candidate"]["rmse"] < selection["all"]["reference"]["rmse"]
        and selection["rb"]["candidate"]["mae"] < selection["rb"]["reference"]["mae"]
        and selection["rb"]["candidate"]["rmse"] < selection["rb"]["reference"]["rmse"]
        and confirmation["all"]["candidate"]["mae"] < confirmation["all"]["reference"]["mae"]
        and confirmation["all"]["candidate"]["rmse"] < confirmation["all"]["reference"]["rmse"]
        and confirmation["rb"]["candidate"]["mae"] < confirmation["rb"]["reference"]["mae"]
        and confirmation["rb"]["candidate"]["rmse"] < confirmation["rb"]["reference"]["rmse"]
        and abs(confirmation["all"]["candidate"]["bias"])
            <= abs(confirmation["all"]["reference"]["bias"]) + 1.0
        and confirmation["stability"]["passes"]
        and current_point["all"]["candidate"]["mae"] < current_point["all"]["reference"]["mae"]
        and current_point["all"]["candidate"]["rmse"] < current_point["all"]["reference"]["rmse"]
        and current_point["all"]["directionCandidate"]["accuracy"]
            >= current_point["all"]["directionReference"]["accuracy"]
    )

    historical = rows[rows["phase"].isin(["selection", "confirmation"])
        & rows["position"].eq(SUPPORTED_POSITION)].copy()
    train = historical[historical["season"].eq(2024)].copy()
    test = historical[historical["season"].eq(2025)].copy()
    support_passes = len(train) >= 100 and len(test) >= 100
    reference_residuals = calibration.residual_quantiles(
        train["actual"].to_numpy(float), train["reference_projection"].to_numpy(float),
    )
    candidate_residuals = calibration.residual_quantiles(
        train["actual"].to_numpy(float), train["supported_projection"].to_numpy(float),
    )
    reference_scores = calibration.crps_rows(
        test["actual"].to_numpy(float), test["reference_projection"].to_numpy(float), reference_residuals,
    )
    candidate_scores = calibration.crps_rows(
        test["actual"].to_numpy(float), test["supported_projection"].to_numpy(float), candidate_residuals,
    )
    reference_distribution = calibration.distribution_metrics(
        test["actual"].to_numpy(float), test["reference_projection"].to_numpy(float), reference_residuals,
    )
    candidate_distribution = calibration.distribution_metrics(
        test["actual"].to_numpy(float), test["supported_projection"].to_numpy(float), candidate_residuals,
    )
    distribution_stability = calibration.bootstrap(test, reference_scores, candidate_scores)
    distribution_passes = bool(
        support_passes
        and candidate_distribution["crps"] < reference_distribution["crps"]
        and candidate_distribution["pitCalibrationError"] < reference_distribution["pitCalibrationError"]
        and candidate_distribution["meanIntervalCoverageError"]
            <= reference_distribution["meanIntervalCoverageError"] + 0.01
        and distribution_stability["passes"]
    )

    current_probability: dict[str, Any] | None = None
    current_rows = pd.DataFrame()
    if point_passes and distribution_passes:
        current_residuals = calibration.residual_quantiles(
            test["actual"].to_numpy(float), test["supported_projection"].to_numpy(float),
        )
        replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
        replay = replay[replay["market"].eq("rushing_yards")].copy()
        replay["normalized_player"] = replay["playerName"].map(calibration.normalize_player)
        current_rows = rows[rows["phase"].eq("locked_replay")
            & rows["position"].eq(SUPPORTED_POSITION)].copy()
        current_rows["normalized_player"] = current_rows["player_name"].map(calibration.normalize_player)
        current_rows = current_rows.merge(
            replay[[
                "week", "team", "normalized_player", "line", "side", "raw", "outcome",
                "lockedPrice", "grade", "marketProbability", "final", "actual",
            ]],
            on=["week", "team", "normalized_player", "line"],
            how="left",
            validate="one_to_one",
            suffixes=("", "_locked"),
        )
        if current_rows["raw"].isna().any():
            raise RuntimeError("unmatched exact RB Rushing Yards probability rows")
        over = calibration.probability_over(
            current_rows["supported_projection"].to_numpy(float),
            current_rows["line"].to_numpy(float),
            current_residuals,
        )
        selected_probability = np.where(current_rows["side"].eq("over"), over, 1 - over)
        actual = current_rows["outcome"].to_numpy(int)
        reference_probability = current_rows["raw"].to_numpy(float)
        candidate_probability = selected_probability
        reference_metrics = calibration.probability_metrics(actual, reference_probability)
        candidate_metrics = calibration.probability_metrics(actual, candidate_probability)
        same_side = candidate_probability >= 0.5
        candidate_won = np.where(same_side, actual == 1, actual == 0)
        side_changes = int((~same_side).sum())
        reference_units = float(sum(
            calibration.unit_profit(float(price), bool(won))
            for price, won in zip(current_rows["lockedPrice"], actual == 1, strict=True)
        ))
        candidate_units = None if side_changes else float(sum(
            calibration.unit_profit(float(price), bool(won))
            for price, won in zip(current_rows["lockedPrice"], candidate_won, strict=True)
        ))
        passes = bool(
            candidate_metrics["brier"] <= reference_metrics["brier"]
            and candidate_metrics["logLoss"] <= reference_metrics["logLoss"]
            and candidate_metrics["calibrationGap"] <= reference_metrics["calibrationGap"]
            and side_changes == 0
            and candidate_units is not None
            and candidate_units >= reference_units
        )
        current_rows["candidate_selected_probability"] = candidate_probability
        current_probability = {
            "reference": reference_metrics,
            "candidate": candidate_metrics,
            "sideChanges": side_changes,
            "directionReference": float(actual.mean()),
            "directionCandidate": float(candidate_won.mean()),
            "referenceExactPriceUnits": reference_units,
            "candidateExactPriceUnits": candidate_units,
            "passes": passes,
            "residualQuantiles": current_residuals.tolist(),
        }

    rows["reference_crps"] = np.nan
    rows["candidate_crps"] = np.nan
    confirmation_index = rows[rows["phase"].eq("confirmation")
        & rows["position"].eq(SUPPORTED_POSITION)].index
    rows.loc[confirmation_index, "reference_crps"] = reference_scores
    rows.loc[confirmation_index, "candidate_crps"] = candidate_scores
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    rows.to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_rushing_yards_supported_position_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "supportRule": {"minimumCalibrationRows": 100, "minimumConfirmationRows": 100},
        "supportedPosition": SUPPORTED_POSITION,
        "point": {
            "phases": point_phases,
            "fallbackExact": fallback_exact,
            "passes": point_passes,
        },
        "probability": {
            "calibrationRows": int(len(train)),
            "confirmationRows": int(len(test)),
            "reference": reference_distribution,
            "candidate": candidate_distribution,
            "stability": distribution_stability,
            "passes": distribution_passes,
        },
        "currentSeason": current_probability,
        "liveBoardImpact": {
            "productionWrites": 0,
            "promotions": 0,
            "demotions": 0,
            "sideChanges": 0,
            "lockedRowsMutated": 0,
        },
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": point.sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "pointPasses": point_passes,
        "distributionPasses": distribution_passes,
        "currentSeason": current_probability,
        "pointSummary": point_phases,
        "probabilitySummary": output["probability"],
    }, indent=2))


if __name__ == "__main__":
    main()
