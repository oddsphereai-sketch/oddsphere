#!/usr/bin/env python3
"""Frozen market-independent Anytime TD opportunity repair tournament."""

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
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_opportunity_repair_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_opportunity_repair_rows_r1.parquet"
CURRENT_BOARD = pathlib.Path("/tmp/nfl-props-private-week5-full-board.json")
REFERENCE_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_fixed_ensemble_rows_r1.parquet"

PLAYER_OPPORTUNITY_FEATURES = (
    "prior_anytime_td_avg5",
    "prior_anytime_td_ewm",
    "prior_redzone_opportunity_avg5",
    "prior_redzone_opportunity_ewm",
    "prior_goal_line_opportunity_avg5",
    "prior_goal_line_opportunity_ewm",
)
TEAM_OPPORTUNITY_FEATURES = (
    "prior_team_td_avg5",
    "prior_opponent_td_allowed_avg5",
)


def load(path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location("props_anytime_td_opportunity_foundation", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def ensemble_for_phase(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    player_features: list[str],
    team_features: list[str],
    calibration_season: int,
    evaluation_season: int,
    test: pd.DataFrame,
) -> tuple[np.ndarray, dict[str, Any]]:
    calibration_rows = frame[
        frame["season"].eq(calibration_season)
        & frame["prior_participations"].ge(1)
        & frame["position"].isin(foundation.POSITIONS)
    ].copy()
    components: dict[str, np.ndarray] = {}
    diagnostics: dict[str, Any] = {}
    for mode in foundation.MODES:
        calibration_raw, calibration_diagnostic = foundation.candidate_raw_probability(
            frame,
            teams,
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
            teams,
            evaluation_season - 1,
            evaluation_season,
            player_features,
            team_features,
            test,
            mode,
        )
        components[mode] = foundation.apply_platt(calibrator, evaluation_raw)
        diagnostics[mode] = {
            "calibration": calibration_diagnostic,
            "evaluation": evaluation_diagnostic,
        }
    return (
        0.5 * components["direct_share"] + 0.5 * components["scorer_hurdle"],
        diagnostics,
    )


def profit_multiple(price: float) -> float:
    return 100.0 / abs(price) if price < 0 else price / 100.0


def implied_probability(price: float) -> float:
    return -price / (-price + 100.0) if price < 0 else 100.0 / (price + 100.0)


def economic_summary(rows: pd.DataFrame) -> dict[str, Any]:
    if rows.empty:
        return {"rows": 0, "wins": 0, "units": 0.0, "roi": None}
    return {
        "rows": int(len(rows)),
        "wins": int(rows["win"].sum()),
        "losses": int((~rows["win"]).sum()),
        "hitRate": float(rows["win"].mean()),
        "averageProbability": float(rows["probability"].mean()),
        "averageBreakEvenProbability": float(rows["breakEvenProbability"].mean()),
        "averageNoVigMarketProbability": float(rows["marketProbability"].mean()),
        "averageExpectedValue": float(rows["expectedValue"].mean()),
        "averageNoVigEdge": float(rows["noVigEdge"].mean()),
        "units": float(rows["units"].sum()),
        "roi": float(rows["units"].mean()),
    }


def economic_report(rows: pd.DataFrame, probability_column: str) -> dict[str, Any]:
    values = rows.copy()
    values["probability"] = values[probability_column]
    values["expectedValue"] = (
        values["probability"] * values["profitMultiple"] - (1.0 - values["probability"])
    )
    values["noVigEdge"] = values["probability"] - values["marketProbability"]
    positive = values[values["expectedValue"].gt(0)]
    ranked_ev = values.sort_values("expectedValue", ascending=False)
    ranked_no_vig = values.sort_values("noVigEdge", ascending=False)
    return {
        "allRows": economic_summary(values),
        "positiveEv": economic_summary(positive),
        "byExpectedValueRank": {
            f"top{count}": economic_summary(ranked_ev.head(count)) for count in (5, 10, 20)
        },
        "byNoVigEdgeRank": {
            f"top{count}": economic_summary(ranked_no_vig.head(count)) for count in (5, 10, 20)
        },
    }


def exact_price_rows(
    board_path: pathlib.Path,
    current: pd.DataFrame,
    reference: np.ndarray,
    candidate: np.ndarray,
    foundation: Any,
) -> pd.DataFrame:
    board = json.loads(board_path.read_text(encoding="utf-8"))
    prices = pd.DataFrame(board["exactOfferRows"])
    prices = prices[
        prices["market"].eq("anytime_td") & prices["canonicalMainLine"].eq(True)
    ].copy()
    prices["normalizedPlayer"] = prices["playerName"].map(foundation.normalize_player)
    values = current[["gameId", "playerName"]].copy()
    values["normalizedPlayer"] = values["playerName"].map(foundation.normalize_player)
    values["referenceProbability"] = reference
    values["candidateProbability"] = candidate
    prices = prices.merge(
        values[[
            "gameId", "normalizedPlayer", "referenceProbability",
            "candidateProbability",
        ]],
        on=["gameId", "normalizedPlayer"],
        how="left",
        validate="one_to_one",
    )
    if len(prices) != 45 or prices["candidateProbability"].isna().any():
        raise RuntimeError("exact Anytime TD price rows did not match the frozen board")
    prices["win"] = prices["actual"].gt(0)
    prices["profitMultiple"] = prices["americanPrice"].map(profit_multiple)
    prices["breakEvenProbability"] = prices["americanPrice"].map(implied_probability)
    prices["units"] = np.where(prices["win"], prices["profitMultiple"], -1.0)
    return prices


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path)
    parser.add_argument("--history-manifest", type=pathlib.Path)
    parser.add_argument("--injury-root", type=pathlib.Path)
    parser.add_argument("--current-board", type=pathlib.Path, default=CURRENT_BOARD)
    parser.add_argument("--current-evidence", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    foundation = load(FOUNDATION)
    external_manifest = args.external_manifest or foundation.EXTERNAL_MANIFEST
    history_manifest = args.history_manifest or foundation.HISTORY_MANIFEST
    injury_root = args.injury_root or foundation.INJURY_ROOT
    current_evidence = args.current_evidence or foundation.CURRENT_EVIDENCE

    frame, base_player_features, base_team_features, injury_metadata, touchdown, history = (
        foundation.prepare_candidate_frame(external_manifest, history_manifest, injury_root)
    )
    touchdown_history, touchdown_features = touchdown.add_touchdown_features(
        history, touchdown.read_pbp(),
    )
    frozen_features = [*PLAYER_OPPORTUNITY_FEATURES, *TEAM_OPPORTUNITY_FEATURES]
    if touchdown_features != frozen_features:
        raise RuntimeError(f"touchdown feature contract changed: {touchdown_features}")
    enrichment = touchdown_history[["row_id", *frozen_features]].copy()
    frame = frame.merge(enrichment, on="row_id", how="left", validate="one_to_one")
    player_features = list(dict.fromkeys([*base_player_features, *PLAYER_OPPORTUNITY_FEATURES]))
    team_features = list(dict.fromkeys([*base_team_features, *TEAM_OPPORTUNITY_FEATURES]))
    frame[[*PLAYER_OPPORTUNITY_FEATURES, *TEAM_OPPORTUNITY_FEATURES]] = frame[
        [*PLAYER_OPPORTUNITY_FEATURES, *TEAM_OPPORTUNITY_FEATURES]
    ].replace([np.inf, -np.inf], np.nan)

    candidate_teams = foundation.team_table(frame[frame["season"].le(2025)], team_features)
    reference_rows = pd.read_parquet(REFERENCE_ROWS)
    by_row = frame.set_index("row_id", drop=False)
    phase_reports: dict[str, Any] = {}
    phase_rows: dict[str, pd.DataFrame] = {}
    references: dict[str, np.ndarray] = {}
    candidates: dict[str, np.ndarray] = {}
    output_rows: list[pd.DataFrame] = []

    for evaluation_season, phase in ((2024, "selection"), (2025, "confirmation")):
        test = frame[
            frame["season"].eq(evaluation_season)
            & frame["prior_participations"].ge(1)
            & frame["position"].isin(foundation.POSITIONS)
        ].copy().reset_index(drop=True)
        reference_phase = reference_rows[reference_rows["phase"].eq(phase)].set_index("row_id")
        reference = reference_phase.reindex(test["row_id"])["candidate_probability"].to_numpy(float)
        if np.isnan(reference).any():
            raise RuntimeError(f"cached fixed-ensemble reference is incomplete for {phase}")
        reference_diagnostics = {
            "source": str(REFERENCE_ROWS.resolve()),
            "sha256": foundation.sha256(REFERENCE_ROWS),
        }
        candidate, candidate_diagnostics = ensemble_for_phase(
            foundation,
            frame,
            candidate_teams,
            player_features,
            team_features,
            evaluation_season - 1,
            evaluation_season,
            test,
        )
        actual = test["anytime_td"].to_numpy(int)
        phase_rows[phase] = test
        references[phase] = reference
        candidates[phase] = candidate
        phase_reports[phase] = {
            "referenceFixedIndependentEnsemble": foundation.probability_metrics(actual, reference),
            "candidateOpportunityRepair": foundation.probability_metrics(actual, candidate),
            "referenceDiagnostics": reference_diagnostics,
            "candidateDiagnostics": candidate_diagnostics,
        }
        values = test[[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", "anytime_td",
        ]].copy().rename(columns={"anytime_td": "actual"})
        values["phase"] = phase
        values["reference_probability"] = reference
        values["candidate_probability"] = candidate
        output_rows.append(values)

    selection_passes = all(
        phase_reports["selection"]["candidateOpportunityRepair"][metric]
        < phase_reports["selection"]["referenceFixedIndependentEnsemble"][metric]
        for metric in ("brier", "logLoss")
    ) and (
        phase_reports["selection"]["candidateOpportunityRepair"]["auc"]
        >= phase_reports["selection"]["referenceFixedIndependentEnsemble"]["auc"]
    )
    confirmation_stability = foundation.stability(
        phase_rows["confirmation"],
        phase_rows["confirmation"]["anytime_td"].to_numpy(int),
        references["confirmation"],
        candidates["confirmation"],
    )
    confirmation_passes = bool(
        selection_passes
        and phase_reports["confirmation"]["candidateOpportunityRepair"]["brier"]
        < phase_reports["confirmation"]["referenceFixedIndependentEnsemble"]["brier"]
        and phase_reports["confirmation"]["candidateOpportunityRepair"]["logLoss"]
        < phase_reports["confirmation"]["referenceFixedIndependentEnsemble"]["logLoss"]
        and phase_reports["confirmation"]["candidateOpportunityRepair"]["auc"]
        >= phase_reports["confirmation"]["referenceFixedIndependentEnsemble"]["auc"]
        and confirmation_stability["passes"]
    )

    current = foundation.current_rows(args.current_board, current_evidence, frame)
    current_test = by_row.loc[current["row_id"]].reset_index(drop=True)
    all_candidate_teams = foundation.team_table(frame, team_features)
    current_reference_phase = reference_rows[
        reference_rows["phase"].eq("locked_replay")
    ].set_index("row_id")
    current_reference = current_reference_phase.reindex(current["row_id"])[
        "candidate_probability"
    ].to_numpy(float)
    if np.isnan(current_reference).any():
        raise RuntimeError("cached fixed-ensemble reference is incomplete for locked replay")
    current_reference_diagnostics = {
        "source": str(REFERENCE_ROWS.resolve()),
        "sha256": foundation.sha256(REFERENCE_ROWS),
    }
    current_candidate, current_candidate_diagnostics = ensemble_for_phase(
        foundation,
        frame,
        all_candidate_teams,
        player_features,
        team_features,
        2025,
        2026,
        current_test,
    )
    current_actual = current["actual"].to_numpy(float).astype(int) > 0
    current_reference_metrics = foundation.probability_metrics(current_actual, current_reference)
    current_candidate_metrics = foundation.probability_metrics(current_actual, current_candidate)
    current_passes = bool(
        confirmation_passes
        and current_candidate_metrics["brier"] < current_reference_metrics["brier"]
        and current_candidate_metrics["logLoss"] < current_reference_metrics["logLoss"]
        and current_candidate_metrics["auc"] >= current_reference_metrics["auc"]
        and current_candidate_metrics["calibrationGap"]
        <= current_reference_metrics["calibrationGap"]
    )
    prices = exact_price_rows(
        args.current_board, current, current_reference, current_candidate, foundation,
    )

    locked = current[["row_id", "gameId", "playerName", "team", "actual"]].copy()
    locked["season"] = 2026
    locked["week"] = 5
    locked["phase"] = "locked_replay"
    locked["reference_probability"] = current_reference
    locked["candidate_probability"] = current_candidate
    output_rows.append(locked)
    result_rows = pd.concat(output_rows, ignore_index=True, sort=False)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)

    payload = {
        "release": "nfl_player_props_anytime_td_opportunity_repair_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependentCandidate": True,
        "candidateMarketFeatures": [],
        "frozenAddedPlayerFeatures": list(PLAYER_OPPORTUNITY_FEATURES),
        "frozenAddedTeamFeatures": list(TEAM_OPPORTUNITY_FEATURES),
        "phaseReports": phase_reports,
        "selectionPasses": bool(selection_passes),
        "confirmationStability": confirmation_stability,
        "confirmationPasses": confirmation_passes,
        "currentSeason": {
            "referenceFixedIndependentEnsemble": current_reference_metrics,
            "candidateOpportunityRepair": current_candidate_metrics,
            "passes": current_passes,
            "referenceEconomics": economic_report(prices, "referenceProbability"),
            "candidateEconomics": economic_report(prices, "candidateProbability"),
            "referenceDiagnostics": current_reference_diagnostics,
            "candidateDiagnostics": current_candidate_diagnostics,
        },
        "injuryEvidence": injury_metadata,
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": foundation.sha256(args.rows),
        "decision": "release_candidate" if current_passes else "reject_unchanged",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "selectionPasses": selection_passes,
        "confirmationPasses": confirmation_passes,
        "currentSeason": payload["currentSeason"],
        "decision": payload["decision"],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
