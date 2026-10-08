#!/usr/bin/env python3
"""Chronological tournament for the corrected opponent-defense identity."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-matchup/nfl_player_props_opponent_identity_r1.json"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
SEASONS = (2023, 2024, 2025)
BLEND_WEIGHTS = (0.25, 0.50, 0.75, 1.0)


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def enriched_frame(
    frame: pd.DataFrame,
    matchup_rows: pd.DataFrame,
    environment: pd.DataFrame,
) -> pd.DataFrame:
    output = frame.merge(
        matchup_rows,
        on=["season", "week", "game_id", "team"],
        how="left",
        validate="many_to_one",
        sort=False,
    )
    output = output.merge(
        environment,
        on=["season", "week", "game_id"],
        how="left",
        validate="many_to_one",
        sort=False,
    )
    return output


def historical_team_outcomes(matchup: Any, manifest: dict[str, Any]) -> pd.DataFrame:
    columns = [
        "season", "week", "season_type", "game_id", "team", "opponent_team",
        "attempts", "completions", "passing_yards", "carries", "rushing_yards", "targets",
    ]
    rows = matchup.read_parquets(matchup.source_files(manifest, "team_stats"), columns)
    rows = rows[rows["season_type"].fillna("").eq("REG")].copy()
    aliases = {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}
    rows["team"] = rows["team"].replace(aliases)
    rows["opponent"] = rows["opponent_team"].replace(aliases)
    renamed = {
        "attempts": "team_pass_attempts",
        "completions": "team_completions",
        "passing_yards": "team_passing_yards",
        "carries": "team_rush_attempts",
        "rushing_yards": "team_rushing_yards",
        "targets": "team_targets",
    }
    rows = rows.rename(columns=renamed)
    metrics = list(renamed.values())
    rows[metrics] = rows[metrics].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    rows["team_offensive_plays"] = rows["team_pass_attempts"] + rows["team_rush_attempts"]
    return rows[["season", "week", "game_id", "team", "opponent", *metrics, "team_offensive_plays"]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--candidate-foundation",
        choices=("advanced-only", "full"),
        default="advanced-only",
    )
    args = parser.parse_args()

    baseline = load_module("props_identity_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_identity_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("props_identity_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    conditional = load_module("props_identity_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    accuracy = load_module("props_identity_accuracy", ROOT / "scripts/operator/tournament_nfl_player_props_projection_accuracy.py")
    recalibration = load_module("props_identity_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    history = load_module("props_identity_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    history_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())

    frame, manifest = baseline.load_verified_dataset(args.manifest, history_contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    team_metrics = matchup.team_game_metrics(manifest)
    legacy_matchup, matchup_names = matchup.add_shifted_team_features(team_metrics)
    corrected_matchup, corrected_names = matchup.add_opponent_shifted_team_features(team_metrics)
    if matchup_names != corrected_names:
        raise RuntimeError("legacy and corrected matchup feature contracts differ")
    environment, environment_names = matchup.game_environment(manifest)
    legacy_frame = enriched_frame(frame, legacy_matchup, environment)
    corrected_base = frame
    corrected_base_names: list[str] = []
    if args.candidate_foundation == "full":
        base_team_features, base_team_names = history.add_opponent_team_prior_features(
            historical_team_outcomes(matchup, manifest),
        )
        corrected_base_names = [name for name in base_team_names if name.startswith("prior_opponent_")]
        corrected_base = frame.drop(columns=corrected_base_names).merge(
            base_team_features[["season", "week", "game_id", "team", *corrected_base_names]],
            on=["season", "week", "game_id", "team"],
            how="left",
            validate="many_to_one",
            sort=False,
        )
    corrected_frame = enriched_frame(corrected_base, corrected_matchup, environment)
    identity_columns = ["season", "week", "game_id", "team", "player_id"]
    if not legacy_frame[identity_columns].equals(corrected_frame[identity_columns]):
        raise RuntimeError("legacy and corrected player-row identities differ")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    legacy_eligible = {
        market: baseline.market_eligible(legacy_frame, history_contract["markets"][market])
        for market in MARKETS
    }
    corrected_eligible = {
        market: baseline.market_eligible(corrected_frame, history_contract["markets"][market])
        for market in MARKETS
    }

    rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}
    coherence: dict[int, dict[str, int]] = {}

    for season in SEASONS:
        print(f"opponent-identity season {season}...", flush=True)
        legacy_rows, legacy_prediction = conditional.conditional_predictions(
            trainer, legacy_frame, legacy_eligible, season, base_features, enhanced_features,
        )
        corrected_rows, corrected_prediction = conditional.conditional_predictions(
            trainer, corrected_frame, corrected_eligible, season, base_features, enhanced_features,
        )
        coherence[season] = {
            "legacyCompletionGreaterThanAttemptsRows": int(np.sum(
                legacy_prediction["passing_completions"] > legacy_prediction["passing_attempts"] + 1e-9,
            )),
            "correctedCompletionGreaterThanAttemptsRows": int(np.sum(
                corrected_prediction["passing_completions"] > corrected_prediction["passing_attempts"] + 1e-9,
            )),
            "negativeProjectionRows": int(sum(
                np.sum(values < -1e-9)
                for values in [*legacy_prediction.values(), *corrected_prediction.values()]
            )),
        }
        for market in MARKETS:
            legacy_market_rows = legacy_rows[market]
            corrected_market_rows = corrected_rows[market]
            if not legacy_market_rows[identity_columns].reset_index(drop=True).equals(
                corrected_market_rows[identity_columns].reset_index(drop=True)
            ):
                raise RuntimeError(f"evaluation row identity mismatch for {market} {season}")
            rows[market][season] = legacy_market_rows
            actual[market][season] = legacy_market_rows[market].to_numpy(float)
            reference[market][season] = legacy_prediction[market]
            for weight in BLEND_WEIGHTS:
                name = f"corrected_opponent_blend_{int(weight * 100)}"
                candidates[market].setdefault(name, {})[season] = np.clip(
                    (1.0 - weight) * legacy_prediction[market]
                    + weight * corrected_prediction[market],
                    0.0,
                    None,
                )

    report: dict[str, Any] = {}
    for market in MARKETS:
        selection_reference = accuracy.point_metrics(actual[market][2023], reference[market][2023])
        selection_candidates = {
            name: accuracy.point_metrics(actual[market][2023], values[2023])
            for name, values in candidates[market].items()
        }
        selectable = [name for name, values in selection_candidates.items() if (
            float(values["mae"]) < float(selection_reference["mae"])
            and float(values["rmse"]) < float(selection_reference["rmse"])
        )]
        selected = min(selectable, key=lambda name: (
            float(selection_candidates[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_candidates[name]["rmse"]) / float(selection_reference["rmse"])
        )) if selectable else None
        confirmation_reference = accuracy.point_metrics(actual[market][2024], reference[market][2024])
        confirmation_candidate = (
            accuracy.point_metrics(actual[market][2024], candidates[market][selected][2024])
            if selected else None
        )
        confirmed = bool(
            selected
            and confirmation_candidate
            and float(confirmation_candidate["mae"]) < float(confirmation_reference["mae"])
            and float(confirmation_candidate["rmse"]) < float(confirmation_reference["rmse"])
        )
        chosen = candidates[market][selected] if confirmed and selected else reference[market]
        holdout_y = actual[market][2025]
        holdout_reference = accuracy.point_metrics(holdout_y, reference[market][2025])
        holdout_candidate = accuracy.point_metrics(holdout_y, chosen[2025])
        mae_bootstrap = accuracy.clustered_delta(
            rows[market][2025],
            np.abs(chosen[2025] - holdout_y),
            np.abs(reference[market][2025] - holdout_y),
        )
        bias_bootstrap = accuracy.clustered_delta(
            rows[market][2025],
            chosen[2025] - holdout_y,
            reference[market][2025] - holdout_y,
        )
        segments = accuracy.segment_metrics(
            rows[market][2025], holdout_y, reference[market][2025], chosen[2025],
        )
        reference_distribution = accuracy.distribution_report(
            recalibration, calibration_contract, actual[market], reference[market],
        )
        candidate_distribution = accuracy.distribution_report(
            recalibration, calibration_contract, actual[market], chosen,
        )
        market_mean = float(np.mean(holdout_y))
        point_pass = bool(
            confirmed
            and float(holdout_candidate["mae"]) < float(holdout_reference["mae"])
            and float(holdout_candidate["rmse"]) < float(holdout_reference["rmse"])
            and float(mae_bootstrap["ciHigh"]) < 0.0
            and abs(float(holdout_candidate["bias"])) <= abs(float(holdout_reference["bias"])) + 0.0025 * market_mean
            and float(holdout_candidate["underpredictionRate"]) <= float(holdout_reference["underpredictionRate"]) + 0.0025
            and all(float(segment["maeDelta"]) <= 0.0 for segment in segments)
        )
        reference_dist = reference_distribution["holdout"]
        candidate_dist = candidate_distribution["holdout"]
        distribution_pass = bool(
            float(candidate_dist["crps"]) < float(reference_dist["crps"])
            and float(candidate_dist["nll"]) <= float(reference_dist["nll"]) * 1.005
            and abs(float(candidate_dist["coverage_80"]) - 0.8)
            <= float(calibration_contract["selection"]["maximumAbsoluteCoverage80Error"])
            and abs(float(candidate_dist["coverage_90"]) - 0.9)
            <= float(calibration_contract["selection"]["maximumAbsoluteCoverage90Error"])
        )
        report[market] = {
            "selection": {
                "reference": selection_reference,
                "candidates": selection_candidates,
                "selected": selected,
            },
            "confirmation": {
                "reference": confirmation_reference,
                "candidate": confirmation_candidate,
                "confirmed": confirmed,
            },
            "holdout": {
                "reference": holdout_reference,
                "candidate": holdout_candidate,
                "clusteredMaeDelta": mae_bootstrap,
                "clusteredBiasDelta": bias_bootstrap,
                "chronologicalSegments": segments,
            },
            "distribution": {
                "reference": reference_distribution,
                "candidate": candidate_distribution,
            },
            "passes": {
                "point": point_pass,
                "distribution": distribution_pass,
                "all": bool(point_pass and distribution_pass),
            },
        }

    feature_differences = {}
    audited_opponent_names = [
        *corrected_base_names,
        *(name for name in matchup_names if name.startswith("matchup_opponent_allowed_")),
    ]
    for name in audited_opponent_names:
        left = legacy_frame[name].to_numpy(float)
        right = corrected_frame[name].to_numpy(float)
        comparable = np.isfinite(left) & np.isfinite(right)
        feature_differences[name] = {
            "comparableRows": int(comparable.sum()),
            "differentRows": int(np.sum(comparable & ~np.isclose(left, right, rtol=1e-12, atol=1e-12))),
        }

    output = {
        "release": (
            "nfl_player_props_full_opponent_identity_tournament_2026_10_08_r2"
            if args.candidate_foundation == "full"
            else "nfl_player_props_opponent_matchup_identity_tournament_2026_10_08_r1"
        ),
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "targetPopulation": "prior-role eligible rows with official participated=1; participated is never a model feature",
        "architecture": (
            "released full-family recipes refit twice with legacy-own-defense versus corrected-actual-opponent identity in both base and advanced features"
            if args.candidate_foundation == "full"
            else "released full-family recipes refit twice with legacy-own-defense versus corrected-actual-opponent advanced matchup identity"
        ),
        "blendWeights": list(BLEND_WEIGHTS),
        "lineOrPriceFeatures": [],
        "featureIdentityAudit": feature_differences,
        "coherence": coherence,
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {
            market: {
                "selected": values["selection"]["selected"],
                "confirmed": values["confirmation"]["confirmed"],
                "holdout": values["holdout"],
                "passes": values["passes"],
            }
            for market, values in report.items()
        },
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
