#!/usr/bin/env python3
"""Robust threshold-distribution tournament for independent Passing Completions."""

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
POINT_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_completions_rows_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_completions_distribution_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_completions_distribution_rows_r1.parquet"
MIXTURE_WEIGHTS = (0.0, 0.25, 0.50, 0.75, 1.0)
BLOCKS = ((7, 9), (10, 12), (13, 15), (16, 18))


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--openings", required=True, type=pathlib.Path)
    parser.add_argument("--point-rows", type=pathlib.Path, default=POINT_ROWS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    tournament = load(
        "pc_distribution_shared",
        ROOT / "scripts/operator/tournament_nfl_player_props_independent_distribution_release.py",
    )
    conditioning = load(
        "pc_distribution_conditioning",
        ROOT / "scripts/operator/tournament_nfl_player_props_distribution_conditioning.py",
    )
    baseline = load(
        "pc_distribution_baseline",
        ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py",
    )
    tournament.MARKETS = ("passing_completions",)
    tournament.COUNT_MARKETS.add("passing_completions")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    grid = int(contract["empiricalQuantileGridSize"])
    minimum = int(contract["minimumBucketRows"])

    points = pd.read_parquet(args.point_rows)
    selection = points[points["phase"].eq("selection")].copy()
    confirmation = points[points["phase"].eq("confirmation")].copy()
    selection["market"] = "passing_completions"
    confirmation["market"] = "passing_completions"
    selection["normalized_player"] = selection["player_name"].map(tournament.normalize_player)
    confirmation["normalized_player"] = confirmation["player_name"].map(tournament.normalize_player)
    thresholds, opening_report = tournament.opening_thresholds(args.openings, confirmation)
    history = thresholds.merge(
        confirmation.drop(columns=["line", "side"], errors="ignore"),
        on=["game_id", "normalized_player", "market"],
        how="inner",
        validate="many_to_one",
    )
    history = history[history["actual"].ne(history["line"])].copy()
    history["outcome_over"] = history["actual"].gt(history["line"]).astype(float)
    if len(history) < 500:
        raise RuntimeError(f"Passing Completions threshold join is too small: {len(history)}")

    reference_fit = selection["reference_projection"].to_numpy(float)
    candidate_fit = selection["candidate_projection"].to_numpy(float)
    reference_confirmation = confirmation["reference_projection"].to_numpy(float)
    candidate_confirmation = confirmation["candidate_projection"].to_numpy(float)
    reference_candidates = tournament.fit_foundation_candidates(
        "passing_completions", selection, reference_fit, conditioning, baseline, grid, minimum,
    )
    candidate_distributions = tournament.fit_candidates(
        "passing_completions", selection, candidate_fit, conditioning, baseline, grid, minimum,
    )
    confirmation_index = confirmation.set_index("row_id")
    history["reference_projection"] = confirmation_index.loc[history["row_id"], "reference_projection"].to_numpy(float)
    history["candidate_projection"] = confirmation_index.loc[history["row_id"], "candidate_projection"].to_numpy(float)
    oof = history["week"].ge(7).to_numpy()
    if int(oof.sum()) < 100:
        raise RuntimeError("Passing Completions robust threshold cohort is too small")

    distribution_metrics = {
        name: tournament.distribution_metrics(
            distribution, confirmation, reference_confirmation, conditioning, baseline,
        )
        for name, distribution in reference_candidates.items()
    }
    reference_name = min(
        distribution_metrics,
        key=lambda name: (
            *tournament.calibration_selection_key(distribution_metrics[name], contract),
            distribution_metrics[name]["nll"],
        ),
    )
    reference_probability = tournament.over_probability(
        reference_candidates[reference_name], history,
        history["reference_projection"].to_numpy(float), history["line"].to_numpy(float), conditioning,
    )
    reference_metrics = tournament.probability_metrics(
        history.loc[oof, "outcome_over"].to_numpy(float), reference_probability[oof],
    )
    reference_blocks = {
        f"weeks_{start}_{end}": tournament.probability_metrics(
            history.loc[history["week"].between(start, end), "outcome_over"].to_numpy(float),
            reference_probability[history["week"].between(start, end).to_numpy()],
        )
        for start, end in BLOCKS
    }

    candidates: dict[str, dict[str, Any]] = {}
    for distribution_name, distribution in candidate_distributions.items():
        probability = tournament.over_probability(
            distribution, history, history["candidate_projection"].to_numpy(float),
            history["line"].to_numpy(float), conditioning,
        )
        for weight in MIXTURE_WEIGHTS:
            mixed = (1.0 - weight) * reference_probability + weight * probability
            for calibration_name in ("identity", "logistic"):
                calibrated = np.full(len(history), np.nan)
                block_metrics: dict[str, dict[str, float | int]] = {}
                for start, end in BLOCKS:
                    train = history["week"].lt(start).to_numpy()
                    test = history["week"].between(start, end).to_numpy()
                    calibration = (
                        tournament.fit_logistic(mixed[train], history.loc[train, "outcome_over"].to_numpy(float))
                        if calibration_name == "logistic" else None
                    )
                    calibrated[test] = tournament.apply_logistic(mixed[test], calibration)
                    block_metrics[f"weeks_{start}_{end}"] = tournament.probability_metrics(
                        history.loc[test, "outcome_over"].to_numpy(float), calibrated[test],
                    )
                name = f"{distribution_name}__mix_{int(weight * 100)}__{calibration_name}"
                candidates[name] = {
                    "distribution": distribution_name,
                    "challengerWeight": weight,
                    "calibration": calibration_name,
                    "validation": tournament.probability_metrics(
                        history.loc[oof, "outcome_over"].to_numpy(float), calibrated[oof],
                    ),
                    "blocks": block_metrics,
                }
    eligible: list[str] = []
    for name, value in candidates.items():
        deltas = [
            float(value["blocks"][key]["brier"]) - float(reference_blocks[key]["brier"])
            for key in reference_blocks
        ]
        value["brierBlockDeltas"] = deltas
        value["improvedBrierBlocks"] = int(sum(delta < 0 for delta in deltas))
        value["worstBrierBlockDelta"] = float(max(deltas))
        if (
            float(value["validation"]["brier"]) < float(reference_metrics["brier"])
            and float(value["validation"]["logLoss"]) < float(reference_metrics["logLoss"])
            and float(value["validation"]["directionAccuracy"]) >= float(reference_metrics["directionAccuracy"])
            and int(value["improvedBrierBlocks"]) >= 3
            and float(value["worstBrierBlockDelta"]) <= 0.005
        ):
            eligible.append(name)
    selected_name = min(
        eligible,
        key=lambda name: (
            float(candidates[name]["worstBrierBlockDelta"]),
            float(candidates[name]["validation"]["brier"]),
            float(candidates[name]["validation"]["logLoss"]),
            0 if candidates[name]["calibration"] == "identity" else 1,
            -float(candidates[name]["validation"]["directionAccuracy"]),
        ),
    ) if eligible else None
    selected = candidates[selected_name] if selected_name else None

    combined = pd.concat([selection, confirmation], ignore_index=True)
    reference_final = tournament.fit_foundation_candidates(
        "passing_completions", combined, combined["reference_projection"].to_numpy(float),
        conditioning, baseline, grid, minimum,
    )[reference_name]
    challenger_name = str(selected["distribution"]) if selected else reference_name
    challenger_final = tournament.refit_selected(
        "passing_completions", challenger_name, combined,
        combined["candidate_projection"].to_numpy(float), conditioning, baseline, grid, minimum,
    )
    full_reference = tournament.over_probability(
        reference_final, history, history["reference_projection"].to_numpy(float),
        history["line"].to_numpy(float), conditioning,
    )
    full_candidate = tournament.over_probability(
        challenger_final, history, history["candidate_projection"].to_numpy(float),
        history["line"].to_numpy(float), conditioning,
    )
    selected_weight = float(selected["challengerWeight"]) if selected else 0.0
    mixed = (1.0 - selected_weight) * full_reference + selected_weight * full_candidate
    calibration = (
        tournament.fit_logistic(mixed, history["outcome_over"].to_numpy(float))
        if selected and selected["calibration"] == "logistic" else None
    )
    history["reference_over_probability"] = full_reference
    history["candidate_over_probability"] = tournament.apply_logistic(mixed, calibration)

    locked = points[points["phase"].eq("locked_replay")].copy()
    locked = locked[locked["actual"].ne(locked["line"])].copy()
    locked["outcome_over"] = locked["actual"].gt(locked["line"]).astype(float)
    locked_reference = tournament.over_probability(
        reference_final, locked, locked["reference_projection"].to_numpy(float),
        locked["line"].to_numpy(float), conditioning,
    )
    locked_challenger = tournament.over_probability(
        challenger_final, locked, locked["candidate_projection"].to_numpy(float),
        locked["line"].to_numpy(float), conditioning,
    )
    locked_candidate = tournament.apply_logistic(
        (1.0 - selected_weight) * locked_reference + selected_weight * locked_challenger,
        calibration,
    )
    locked["reference_over_probability"] = locked_reference
    locked["candidate_over_probability"] = locked_candidate
    locked_reference_metrics = tournament.probability_metrics(
        locked["outcome_over"].to_numpy(float), locked_reference,
    )
    locked_candidate_metrics = tournament.probability_metrics(
        locked["outcome_over"].to_numpy(float), locked_candidate,
    )
    replay_passes = bool(
        selected
        and locked_candidate_metrics["brier"] <= locked_reference_metrics["brier"]
        and locked_candidate_metrics["logLoss"] <= locked_reference_metrics["logLoss"]
        and locked_candidate_metrics["directionAccuracy"] >= locked_reference_metrics["directionAccuracy"]
    )
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    pd.concat([history.assign(phase="historical_threshold"), locked], ignore_index=True).to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_passing_completions_distribution_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "openingCoverage": opening_report,
        "referenceDistribution": reference_name,
        "referenceValidation": reference_metrics,
        "referenceBlocks": reference_blocks,
        "selected": selected_name,
        "selectedValidation": selected["validation"] if selected else None,
        "selectedBlocks": selected["blocks"] if selected else None,
        "candidateCount": len(candidates),
        "locked2026": {
            "rows": int(len(locked)),
            "reference": locked_reference_metrics,
            "candidate": locked_candidate_metrics,
            "passes": replay_passes,
        },
        "artifact": {
            "referenceDistributionName": reference_name,
            "referenceDistribution": reference_final,
            "challengerDistributionName": challenger_name,
            "challengerDistribution": challenger_final,
            "challengerWeight": selected_weight,
            "probabilityCalibration": calibration,
            "passes": replay_passes,
        },
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": tournament.sha256(args.rows),
    }
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "openingCoverage": opening_report,
        "selected": selected_name, "referenceValidation": reference_metrics,
        "selectedValidation": output["selectedValidation"], "locked2026": output["locked2026"],
    }, indent=2))


if __name__ == "__main__":
    main()
