#!/usr/bin/env python3
"""Fixed independent Anytime TD allocation ensemble with Week 5 external gate."""

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
FOUNDATION = ROOT / "scripts/operator/tournament_nfl_player_props_anytime_td_independent_allocation.py"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_fixed_ensemble_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_fixed_ensemble_rows_r1.parquet"


def load(path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location("props_anytime_td_fixed_ensemble_foundation", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path)
    parser.add_argument("--history-manifest", type=pathlib.Path)
    parser.add_argument("--injury-root", type=pathlib.Path)
    parser.add_argument("--market-context", type=pathlib.Path)
    parser.add_argument("--current-board", type=pathlib.Path)
    parser.add_argument("--current-evidence", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()
    foundation = load(FOUNDATION)
    external_manifest = args.external_manifest or foundation.EXTERNAL_MANIFEST
    history_manifest = args.history_manifest or foundation.HISTORY_MANIFEST
    injury_root = args.injury_root or foundation.INJURY_ROOT
    market_context_path = args.market_context or foundation.MARKET_CONTEXT
    current_board = args.current_board or foundation.CURRENT_BOARD
    current_evidence = args.current_evidence or foundation.CURRENT_EVIDENCE

    frame, player_features, team_features, injury_metadata, touchdown, history = foundation.prepare_candidate_frame(
        external_manifest, history_manifest, injury_root,
    )
    if market_context_path.exists():
        market_context = pd.read_csv(market_context_path, low_memory=False)
        market_context_source = {
            "kind": "cached_checksum_pinned_csv",
            "path": str(market_context_path),
            "sha256": foundation.sha256(market_context_path),
        }
    else:
        market_context = foundation.reconstructed_market_context(touchdown)
        market_context_source = {
            "kind": "reconstructed_from_checksum_pinned_nflverse_pbp_game_fields",
            "games": int(len(market_context)),
            "missingSpreadOrTotal": int(
                market_context[["spread_line", "total_line"]].isna().any(axis=1).sum()
            ),
        }
    released_frame, released_features = foundation.incumbent_frame(touchdown, history, market_context)
    historical_teams = foundation.team_table(frame[frame["season"].le(2025)], team_features)
    by_row = frame.set_index("row_id", drop=False)
    phase_rows: dict[str, pd.DataFrame] = {}
    references: dict[str, np.ndarray] = {}
    ensembles: dict[str, np.ndarray] = {}
    component_reports: dict[str, Any] = {}
    output_rows: list[pd.DataFrame] = []

    for evaluation_season, phase in ((2024, "selection"), (2025, "confirmation")):
        incumbent_rows, incumbent = foundation.incumbent_probabilities(
            touchdown, released_frame, released_features, evaluation_season,
        )
        test = by_row.loc[incumbent_rows["row_id"]].reset_index(drop=True)
        calibration_season = evaluation_season - 1
        calibration_rows = frame[
            frame["season"].eq(calibration_season)
            & frame["prior_participations"].ge(1)
            & frame["position"].isin(foundation.POSITIONS)
        ].copy()
        probabilities: dict[str, np.ndarray] = {}
        diagnostics: dict[str, Any] = {}
        for mode in foundation.MODES:
            calibration_raw, calibration_diagnostic = foundation.candidate_raw_probability(
                frame,
                historical_teams,
                calibration_season - 1,
                calibration_season,
                player_features,
                team_features,
                calibration_rows,
                mode,
            )
            calibrator = foundation.fit_platt(
                calibration_raw, calibration_rows["anytime_td"].to_numpy(int),
            )
            evaluation_raw, evaluation_diagnostic = foundation.candidate_raw_probability(
                frame,
                historical_teams,
                evaluation_season - 1,
                evaluation_season,
                player_features,
                team_features,
                test,
                mode,
            )
            probabilities[mode] = foundation.apply_platt(calibrator, evaluation_raw)
            diagnostics[mode] = {
                "calibration": calibration_diagnostic,
                "evaluation": evaluation_diagnostic,
            }
        ensemble = 0.5 * probabilities["direct_share"] + 0.5 * probabilities["scorer_hurdle"]
        phase_rows[phase] = test
        references[phase] = incumbent
        ensembles[phase] = ensemble
        actual = test["anytime_td"].to_numpy(int)
        component_reports[phase] = {
            "reference": foundation.probability_metrics(actual, incumbent),
            "directShare": foundation.probability_metrics(actual, probabilities["direct_share"]),
            "scorerHurdle": foundation.probability_metrics(actual, probabilities["scorer_hurdle"]),
            "ensemble": foundation.probability_metrics(actual, ensemble),
            "diagnostics": diagnostics,
        }
        values = test[[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", "anytime_td",
        ]].copy().rename(columns={"anytime_td": "actual"})
        values["phase"] = phase
        values["reference_probability"] = incumbent
        values["candidate_probability"] = ensemble
        output_rows.append(values)

    confirmation_actual = phase_rows["confirmation"]["anytime_td"].to_numpy(int)
    confirmation_stability = foundation.stability(
        phase_rows["confirmation"],
        confirmation_actual,
        references["confirmation"],
        ensembles["confirmation"],
    )
    history_passes = all(
        component_reports[phase]["ensemble"]["brier"] < component_reports[phase]["reference"]["brier"]
        and component_reports[phase]["ensemble"]["logLoss"] < component_reports[phase]["reference"]["logLoss"]
        and component_reports[phase]["ensemble"]["auc"] >= component_reports[phase]["reference"]["auc"]
        for phase in ("selection", "confirmation")
    ) and confirmation_stability["passes"]

    current = foundation.current_rows(current_board, current_evidence, frame)
    current_report: dict[str, Any] | None = None
    current_candidate = current["rawProbability"].to_numpy(float)
    if history_passes:
        calibration_rows = frame[
            frame["season"].eq(2025)
            & frame["prior_participations"].ge(1)
            & frame["position"].isin(foundation.POSITIONS)
        ].copy()
        current_test = by_row.loc[current["row_id"]].reset_index(drop=True)
        all_teams = foundation.team_table(frame, team_features)
        current_components: dict[str, np.ndarray] = {}
        current_diagnostics: dict[str, Any] = {}
        for mode in foundation.MODES:
            calibration_raw, _ = foundation.candidate_raw_probability(
                frame,
                historical_teams,
                2024,
                2025,
                player_features,
                team_features,
                calibration_rows,
                mode,
            )
            calibrator = foundation.fit_platt(
                calibration_raw, calibration_rows["anytime_td"].to_numpy(int),
            )
            raw, diagnostic = foundation.candidate_raw_probability(
                frame,
                all_teams,
                2025,
                2026,
                player_features,
                team_features,
                current_test,
                mode,
            )
            current_components[mode] = foundation.apply_platt(calibrator, raw)
            current_diagnostics[mode] = diagnostic
        current_candidate = (
            0.5 * current_components["direct_share"]
            + 0.5 * current_components["scorer_hurdle"]
        )
        actual = current["actual"].to_numpy(float) > 0
        reference_metrics = foundation.probability_metrics(
            actual, current["rawProbability"].to_numpy(float),
        )
        candidate_metrics = foundation.probability_metrics(actual, current_candidate)
        current_report = {
            "reference": reference_metrics,
            "candidate": candidate_metrics,
            "passes": bool(
                candidate_metrics["brier"] < reference_metrics["brier"]
                and candidate_metrics["logLoss"] < reference_metrics["logLoss"]
                and candidate_metrics["auc"] >= reference_metrics["auc"]
                and candidate_metrics["calibrationGap"] <= reference_metrics["calibrationGap"]
            ),
            "diagnostics": current_diagnostics,
        }
    locked = current[["row_id", "gameId", "playerName", "team", "actual"]].copy()
    locked["season"] = 2026
    locked["week"] = 5
    locked["phase"] = "locked_replay"
    locked["reference_probability"] = current["rawProbability"].to_numpy(float)
    locked["candidate_probability"] = current_candidate
    output_rows.append(locked)
    result_rows = pd.concat(output_rows, ignore_index=True, sort=False)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)

    payload = {
        "release": "nfl_player_props_anytime_td_fixed_ensemble_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependentCandidate": True,
        "candidateMarketFeatures": [],
        "referenceIncludesMarketImpliedTeamTouchdowns": True,
        "referenceMarketContext": market_context_source,
        "candidate": "fixed arithmetic mean of direct-share and scorer-hurdle probabilities",
        "componentReports": component_reports,
        "confirmationStability": confirmation_stability,
        "historyPasses": history_passes,
        "currentSeason": current_report,
        "injuryEvidence": injury_metadata,
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": foundation.sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "historyPasses": history_passes,
        "currentSeason": current_report,
    }, indent=2))


if __name__ == "__main__":
    main()
