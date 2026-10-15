#!/usr/bin/env python3
"""Leakage-safe calibration tournament for the fixed independent Anytime TD ensemble."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression


ROOT = pathlib.Path(__file__).resolve().parents[2]
FOUNDATION = ROOT / "scripts/operator/tournament_nfl_player_props_anytime_td_independent_allocation.py"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_calibration_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_anytime_td_calibration_rows_r1.parquet"
METHODS = (
    "global_platt",
    "global_beta",
    "global_isotonic",
    "position_platt",
    "position_beta",
    "position_isotonic",
)
PARAMETRIC_SUPPORT = (1000, 75, 75)
ISOTONIC_SUPPORT = (2000, 150, 150)


def load(path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location("props_anytime_td_calibration_foundation", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def clipped(probability: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(probability, dtype=float), 1e-5, 1 - 1e-5)


def features(kind: str, probability: np.ndarray) -> np.ndarray:
    value = clipped(probability)
    if kind == "platt":
        return np.log(value / (1 - value)).reshape(-1, 1)
    if kind == "beta":
        return np.column_stack((np.log(value), -np.log1p(-value)))
    raise ValueError(kind)


@dataclass
class CalibrationMap:
    kind: str
    model: Any

    def predict(self, probability: np.ndarray) -> np.ndarray:
        value = clipped(probability)
        if self.kind in {"platt", "beta"}:
            result = self.model.predict_proba(features(self.kind, value))[:, 1]
        elif self.kind == "isotonic":
            result = self.model.predict(value)
        else:
            raise ValueError(self.kind)
        return clipped(result)


@dataclass
class FittedCalibration:
    method: str
    global_map: CalibrationMap
    position_maps: dict[str, CalibrationMap]
    support: dict[str, dict[str, int | bool]]

    def predict(self, probability: np.ndarray, position: pd.Series) -> np.ndarray:
        result = self.global_map.predict(probability)
        if not self.method.startswith("position_"):
            return result
        labels = position.astype(str).to_numpy()
        for name, mapping in self.position_maps.items():
            selected = labels == name
            if selected.any():
                result[selected] = mapping.predict(np.asarray(probability)[selected])
        return clipped(result)


def fit_map(kind: str, probability: np.ndarray, actual: np.ndarray) -> CalibrationMap:
    if kind in {"platt", "beta"}:
        model = LogisticRegression(C=1.0, max_iter=500)
        model.fit(features(kind, probability), np.asarray(actual, dtype=int))
    elif kind == "isotonic":
        model = IsotonicRegression(out_of_bounds="clip", y_min=1e-5, y_max=1 - 1e-5)
        model.fit(clipped(probability), np.asarray(actual, dtype=int))
    else:
        raise ValueError(kind)
    return CalibrationMap(kind=kind, model=model)


def support(values: pd.Series) -> dict[str, int]:
    actual = values.to_numpy(int)
    positives = int(actual.sum())
    return {"rows": int(len(values)), "positives": positives, "negatives": int(len(values) - positives)}


def eligible(values: dict[str, int], minimum: tuple[int, int, int]) -> bool:
    return (
        values["rows"] >= minimum[0]
        and values["positives"] >= minimum[1]
        and values["negatives"] >= minimum[2]
    )


def fit_calibration(method: str, rows: pd.DataFrame, probability: np.ndarray) -> FittedCalibration:
    position_aware, kind = method.split("_", 1)
    global_map = fit_map(kind, probability, rows["anytime_td"].to_numpy(int))
    position_maps: dict[str, CalibrationMap] = {}
    diagnostics: dict[str, dict[str, int | bool]] = {}
    minimum = ISOTONIC_SUPPORT if kind == "isotonic" else PARAMETRIC_SUPPORT
    for position in sorted(rows["position"].dropna().astype(str).unique()):
        mask = rows["position"].eq(position).to_numpy()
        values = support(rows.loc[mask, "anytime_td"])
        allowed = position_aware == "position" and eligible(values, minimum)
        diagnostics[position] = {**values, "eligible": allowed}
        if allowed:
            position_maps[position] = fit_map(
                kind, np.asarray(probability)[mask], rows.loc[mask, "anytime_td"].to_numpy(int),
            )
    return FittedCalibration(
        method=method,
        global_map=global_map,
        position_maps=position_maps,
        support=diagnostics,
    )


def fixed_ensemble(
    foundation: Any,
    frame: pd.DataFrame,
    historical_teams: pd.DataFrame,
    player_features: list[str],
    team_features: list[str],
    touchdown: Any,
    released_frame: pd.DataFrame,
    released_features: list[str],
    evaluation_season: int,
) -> tuple[pd.DataFrame, np.ndarray, np.ndarray, dict[str, Any]]:
    incumbent_rows, incumbent = foundation.incumbent_probabilities(
        touchdown, released_frame, released_features, evaluation_season,
    )
    by_row = frame.set_index("row_id", drop=False)
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
    return test, incumbent, ensemble, diagnostics


def position_metrics(foundation: Any, rows: pd.DataFrame, probability: np.ndarray) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for position in sorted(rows["position"].dropna().astype(str).unique()):
        mask = rows["position"].eq(position).to_numpy()
        result[position] = foundation.probability_metrics(
            rows.loc[mask, "anytime_td"].to_numpy(int), np.asarray(probability)[mask],
        )
    return result


def calibration_sides(actual: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    actual = np.asarray(actual, dtype=int)
    probability = clipped(probability)
    return {
        "scorers": int(actual.sum()),
        "nonScorers": int(len(actual) - actual.sum()),
        "meanProbabilityForScorers": float(probability[actual == 1].mean()),
        "meanProbabilityForNonScorers": float(probability[actual == 0].mean()),
        "meanProbability": float(probability.mean()),
        "actualRate": float(actual.mean()),
    }


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
    current_board_path = args.current_board or foundation.CURRENT_BOARD
    current_evidence_path = args.current_evidence or foundation.CURRENT_EVIDENCE

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
    phases: dict[int, dict[str, Any]] = {}
    for season in (2023, 2024, 2025):
        rows, reference, ensemble, diagnostic = fixed_ensemble(
            foundation,
            frame,
            historical_teams,
            player_features,
            team_features,
            touchdown,
            released_frame,
            released_features,
            season,
        )
        phases[season] = {
            "rows": rows,
            "reference": reference,
            "ensemble": ensemble,
            "diagnostic": diagnostic,
        }

    reports: dict[str, Any] = {}
    probabilities: dict[str, dict[int, np.ndarray]] = {"identity": {}}
    for season in (2024, 2025):
        probabilities["identity"][season] = phases[season]["ensemble"]
    for method in METHODS:
        reports[method] = {}
        probabilities[method] = {}
        for evaluation_season in (2024, 2025):
            calibration_season = evaluation_season - 1
            calibrator = fit_calibration(
                method,
                phases[calibration_season]["rows"],
                phases[calibration_season]["ensemble"],
            )
            candidate = calibrator.predict(
                phases[evaluation_season]["ensemble"], phases[evaluation_season]["rows"]["position"],
            )
            probabilities[method][evaluation_season] = candidate
            actual = phases[evaluation_season]["rows"]["anytime_td"].to_numpy(int)
            reports[method][str(evaluation_season)] = {
                "metrics": foundation.probability_metrics(actual, candidate),
                "positionMetrics": position_metrics(
                    foundation, phases[evaluation_season]["rows"], candidate,
                ),
                "calibrationSupport": calibrator.support,
            }

    controls: dict[str, Any] = {}
    for season in (2024, 2025):
        rows = phases[season]["rows"]
        actual = rows["anytime_td"].to_numpy(int)
        controls[str(season)] = {
            "released": foundation.probability_metrics(actual, phases[season]["reference"]),
            "fixedEnsemble": foundation.probability_metrics(actual, phases[season]["ensemble"]),
            "releasedPositionMetrics": position_metrics(
                foundation, rows, phases[season]["reference"],
            ),
            "fixedPositionMetrics": position_metrics(
                foundation, rows, phases[season]["ensemble"],
            ),
        }

    selectable: list[str] = []
    for method in METHODS:
        candidate = reports[method]["2024"]["metrics"]
        fixed = controls["2024"]["fixedEnsemble"]
        released = controls["2024"]["released"]
        if (
            candidate["brier"] < fixed["brier"]
            and candidate["logLoss"] < fixed["logLoss"]
            and candidate["auc"] + 0.0005 >= fixed["auc"]
            and candidate["calibrationGap"] <= fixed["calibrationGap"]
            and candidate["brier"] < released["brier"]
            and candidate["logLoss"] < released["logLoss"]
            and candidate["auc"] >= released["auc"]
        ):
            selectable.append(method)
    order = {method: index for index, method in enumerate(METHODS)}
    selected = min(
        selectable,
        key=lambda method: (
            reports[method]["2024"]["metrics"]["brier"],
            reports[method]["2024"]["metrics"]["logLoss"],
            reports[method]["2024"]["metrics"]["calibrationGap"],
            order[method],
        ),
    ) if selectable else None

    confirmation: dict[str, Any] | None = None
    confirmed = False
    if selected:
        rows = phases[2025]["rows"]
        actual = rows["anytime_td"].to_numpy(int)
        candidate = reports[selected]["2025"]["metrics"]
        fixed = controls["2025"]["fixedEnsemble"]
        released = controls["2025"]["released"]
        stability = foundation.stability(
            rows, actual, phases[2025]["reference"], probabilities[selected][2025],
        )
        regressions = {
            position: (
                reports[selected]["2025"]["positionMetrics"][position]["brier"]
                - controls["2025"]["fixedPositionMetrics"][position]["brier"]
            )
            for position in reports[selected]["2025"]["positionMetrics"]
        }
        confirmed = bool(
            candidate["brier"] < released["brier"]
            and candidate["logLoss"] < released["logLoss"]
            and candidate["auc"] >= released["auc"]
            and candidate["brier"] <= fixed["brier"] + 0.0005
            and candidate["logLoss"] <= fixed["logLoss"] + 0.0005
            and candidate["auc"] + 0.0005 >= fixed["auc"]
            and candidate["calibrationGap"] <= fixed["calibrationGap"]
            and stability["passes"]
            and max(regressions.values(), default=0.0) <= 0.002
        )
        confirmation = {
            "passes": confirmed,
            "stabilityVersusReleased": stability,
            "positionBrierDeltaVersusFixed": regressions,
        }

    current_report: dict[str, Any] | None = None
    current_candidate: np.ndarray | None = None
    current_rows = foundation.current_rows(current_board_path, current_evidence_path, frame)
    current_test = frame.set_index("row_id", drop=False).loc[current_rows["row_id"]].reset_index(drop=True)
    if confirmed and selected:
        calibration = fit_calibration(selected, phases[2025]["rows"], phases[2025]["ensemble"])
        calibration_rows = frame[
            frame["season"].eq(2025)
            & frame["prior_participations"].ge(1)
            & frame["position"].isin(foundation.POSITIONS)
        ].copy()
        all_teams = foundation.team_table(frame, team_features)
        components: dict[str, np.ndarray] = {}
        component_diagnostics: dict[str, Any] = {}
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
            component_calibrator = foundation.fit_platt(
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
            components[mode] = foundation.apply_platt(component_calibrator, raw)
            component_diagnostics[mode] = diagnostic
        fixed_current = 0.5 * components["direct_share"] + 0.5 * components["scorer_hurdle"]
        current_candidate = calibration.predict(fixed_current, current_test["position"])
        actual = current_rows["actual"].to_numpy(float).astype(int) > 0
        reference = current_rows["rawProbability"].to_numpy(float)
        reference_metrics = foundation.probability_metrics(actual, reference)
        fixed_metrics = foundation.probability_metrics(actual, fixed_current)
        candidate_metrics = foundation.probability_metrics(actual, current_candidate)
        passes = bool(
            candidate_metrics["brier"] < reference_metrics["brier"]
            and candidate_metrics["logLoss"] < reference_metrics["logLoss"]
            and candidate_metrics["auc"] + 0.0005 >= reference_metrics["auc"]
            and candidate_metrics["calibrationGap"] <= reference_metrics["calibrationGap"]
        )
        current_report = {
            "reference": reference_metrics,
            "fixedEnsemble": fixed_metrics,
            "candidate": candidate_metrics,
            "passes": passes,
            "referenceCalibrationSides": calibration_sides(actual, reference),
            "fixedCalibrationSides": calibration_sides(actual, fixed_current),
            "candidateCalibrationSides": calibration_sides(actual, current_candidate),
            "positionMetrics": position_metrics(
                foundation,
                current_test.assign(anytime_td=actual.astype(int)),
                current_candidate,
            ),
            "calibrationSupport": calibration.support,
            "componentDiagnostics": component_diagnostics,
            "boardImpactOpened": passes,
        }

    output_rows: list[pd.DataFrame] = []
    for season in (2024, 2025):
        values = phases[season]["rows"][[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", "anytime_td",
        ]].copy().rename(columns={"anytime_td": "actual"})
        values["phase"] = "selection" if season == 2024 else "confirmation"
        values["reference_probability"] = phases[season]["reference"]
        values["fixed_ensemble_probability"] = phases[season]["ensemble"]
        for method in METHODS:
            values[f"{method}_probability"] = probabilities[method][season]
        output_rows.append(values)
    locked = current_rows[["row_id", "gameId", "playerName", "team", "actual"]].copy()
    locked["season"] = 2026
    locked["week"] = 5
    locked["phase"] = "locked_replay"
    locked["reference_probability"] = current_rows["rawProbability"].to_numpy(float)
    if current_candidate is not None:
        locked["selected_probability"] = current_candidate
    output_rows.append(locked)
    result_rows = pd.concat(output_rows, ignore_index=True, sort=False)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)

    payload = {
        "release": "nfl_player_props_anytime_td_calibration_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependentCandidate": True,
        "candidateMarketFeatures": [],
        "methods": list(METHODS),
        "supportThresholds": {
            "parametric": PARAMETRIC_SUPPORT,
            "isotonic": ISOTONIC_SUPPORT,
        },
        "referenceIncludesMarketImpliedTeamTouchdowns": True,
        "referenceMarketContext": market_context_source,
        "controls": controls,
        "reports": reports,
        "selectionEligible": selectable,
        "selected": selected,
        "confirmation": confirmation,
        "confirmed": confirmed,
        "currentSeason": current_report,
        "liveBoardImpact": {
            "productionWrites": 0,
            "promotions": 0,
            "demotions": 0,
            "sideChanges": 0,
            "lockedRowsMutated": 0,
        },
        "injuryEvidence": injury_metadata,
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": foundation.sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "selectionEligible": selectable,
        "selected": selected,
        "confirmed": confirmed,
        "currentSeason": current_report,
    }, indent=2))


if __name__ == "__main__":
    main()
