#!/usr/bin/env python3
"""RB factorized center with pooled non-QB residual calibration."""

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
CALIBRATION_MODULE = ROOT / "scripts/operator/tournament_nfl_player_props_rushing_yards_position_hybrid_calibration.py"
SOURCE = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_team_factorization_rows_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_through_week_5_r2.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_rb_nonqb_residual_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_rb_nonqb_residual_rows_r1.parquet"
CALIBRATION_POSITIONS = ("RB", "WR")


def load(path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location("props_rushing_yards_rb_nonqb_calibration", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, default=SOURCE)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()
    calibration = load(CALIBRATION_MODULE)
    rows = pd.read_parquet(args.source).copy()
    rows["rb_projection"] = np.where(
        rows["position"].eq("RB"),
        rows["candidate_projection"].to_numpy(float),
        rows["reference_projection"].to_numpy(float),
    )
    historical = rows[rows["phase"].isin(["selection", "confirmation"])
        & rows["position"].isin(CALIBRATION_POSITIONS)].copy()
    train = historical[historical["season"].eq(2024)].copy()
    test_pool = historical[historical["season"].eq(2025)].copy()
    test = test_pool[test_pool["position"].eq("RB")].copy()
    reference_residuals = calibration.residual_quantiles(
        train["actual"].to_numpy(float), train["reference_projection"].to_numpy(float),
    )
    candidate_residuals = calibration.residual_quantiles(
        train["actual"].to_numpy(float), train["candidate_projection"].to_numpy(float),
    )
    reference_scores = calibration.crps_rows(
        test["actual"].to_numpy(float), test["reference_projection"].to_numpy(float), reference_residuals,
    )
    candidate_scores = calibration.crps_rows(
        test["actual"].to_numpy(float), test["rb_projection"].to_numpy(float), candidate_residuals,
    )
    reference = calibration.distribution_metrics(
        test["actual"].to_numpy(float), test["reference_projection"].to_numpy(float), reference_residuals,
    )
    candidate = calibration.distribution_metrics(
        test["actual"].to_numpy(float), test["rb_projection"].to_numpy(float), candidate_residuals,
    )
    stability = calibration.bootstrap(test, reference_scores, candidate_scores)
    confirmation_passes = bool(
        candidate["crps"] < reference["crps"]
        and candidate["pitCalibrationError"] < reference["pitCalibrationError"]
        and candidate["meanIntervalCoverageError"] <= reference["meanIntervalCoverageError"] + 0.01
        and stability["passes"]
    )

    current_report: dict[str, Any] | None = None
    current_rows = pd.DataFrame()
    if confirmation_passes:
        current_residuals = calibration.residual_quantiles(
            test_pool["actual"].to_numpy(float), test_pool["candidate_projection"].to_numpy(float),
        )
        replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
        replay = replay[replay["market"].eq("rushing_yards")].copy()
        replay["normalized_player"] = replay["playerName"].map(calibration.normalize_player)
        current_rows = rows[rows["phase"].eq("locked_replay") & rows["position"].eq("RB")].copy()
        current_rows["normalized_player"] = current_rows["player_name"].map(calibration.normalize_player)
        current_rows = current_rows.merge(
            replay[[
                "week", "team", "normalized_player", "line", "side", "raw", "outcome",
                "lockedPrice", "grade", "marketProbability", "final", "actual",
                "participationProbability", "healthHolds", "movement", "sportsbook",
            ]],
            on=["week", "team", "normalized_player", "line"],
            how="left",
            validate="one_to_one",
            suffixes=("", "_locked"),
        )
        if current_rows["raw"].isna().any():
            raise RuntimeError("unmatched exact RB Rushing Yards rows")
        over = calibration.probability_over(
            current_rows["rb_projection"].to_numpy(float),
            current_rows["line"].to_numpy(float),
            current_residuals,
        )
        current_rows["candidate_selected_probability"] = np.where(
            current_rows["side"].eq("over"), over, 1 - over,
        )
        actual = current_rows["outcome"].to_numpy(int)
        reference_probability = current_rows["raw"].to_numpy(float)
        candidate_probability = current_rows["candidate_selected_probability"].to_numpy(float)
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
        current_report = {
            "reference": reference_metrics,
            "candidate": candidate_metrics,
            "sideChanges": side_changes,
            "directionReference": float(actual.mean()),
            "directionCandidate": float(candidate_won.mean()),
            "referenceExactPriceUnits": reference_units,
            "candidateExactPriceUnits": candidate_units,
            "passes": passes,
            "residualQuantiles": current_residuals.tolist(),
            "rows": [{
                "week": int(row.week),
                "team": str(row.team),
                "playerName": str(row.player_name),
                "line": float(row.line),
                "side": str(row.side),
                "referenceSelectedProbability": float(row.raw),
                "candidateSelectedProbability": float(row.candidate_selected_probability),
                "marketSelectedProbability": float(row.marketProbability),
                "lockedPrice": int(row.lockedPrice),
                "participationProbability": float(row.participationProbability),
                "healthHolds": list(row.healthHolds),
                "movement": str(row.movement),
                "sportsbook": str(row.sportsbook),
                "outcome": int(row.outcome),
            } for row in current_rows.itertuples(index=False)],
        }

    output_rows = test[[
        "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
        "player_name", "position", "actual", "reference_projection", "rb_projection",
    ]].copy()
    output_rows["reference_crps"] = reference_scores
    output_rows["candidate_crps"] = candidate_scores
    if not current_rows.empty:
        output_rows = pd.concat([output_rows, current_rows], ignore_index=True, sort=False)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    output_rows.to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_rushing_yards_rb_nonqb_residual_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "candidate": "RB-only factorized center with pooled RB+WR preceding-season residuals",
        "confirmation2025": {
            "calibrationRows": int(len(train)),
            "confirmationRows": int(len(test)),
            "reference": reference,
            "candidate": candidate,
            "stability": stability,
            "passes": confirmation_passes,
        },
        "currentSeason": current_report,
        "liveBoardImpact": {
            "productionWrites": 0,
            "promotions": 0,
            "demotions": 0,
            "sideChanges": 0,
            "lockedRowsMutated": 0,
        },
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": calibration.sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "confirmation2025": output["confirmation2025"],
        "currentSeason": current_report,
    }, indent=2))


if __name__ == "__main__":
    main()
