#!/usr/bin/env python3
"""Research-only recent-workload tournament for NFL Receiving Yards."""

from __future__ import annotations

import importlib.util
import json
import math
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
FOUNDATION = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
RECEIVING = ROOT / "scripts/operator/tournament_nfl_player_props_receiving_yards.py"
FOUNDATION_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_through_week_5_r2.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_yards_recent_workload_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_yards_recent_workload_rows_r1.parquet"
WEIGHTS = (0.25, 0.50)
IDENTITIES = ("short", "balanced", "availability")
BLOCKS = ((1, 4), (5, 9), (10, 13), (14, 18))
SEED = 20261015


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = np.asarray(prediction, dtype=float) - np.asarray(actual, dtype=float)
    return {
        "rows": int(len(error)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
    }


def direction(actual: np.ndarray, prediction: np.ndarray, line: np.ndarray) -> float:
    return float(np.mean(np.sign(prediction - line) == np.sign(actual - line)))


def row_mean(frame: pd.DataFrame, columns: list[str], fallback: float) -> np.ndarray:
    values = frame[columns].apply(pd.to_numeric, errors="coerce").to_numpy(float)
    valid = np.isfinite(values)
    count = valid.sum(axis=1)
    total = np.where(valid, values, 0.0).sum(axis=1)
    return np.divide(total, count, out=np.full(len(frame), fallback), where=count > 0)


def workload_components(frame: pd.DataFrame) -> dict[str, pd.Series]:
    receivers = frame[frame["expected_role_group"].isin(["BACK", "WR", "TE"])].copy()
    budgets = {
        "short": np.clip(row_mean(receivers, [
            "prior_team_targets_avg3", "prior_team_targets_ewm",
            "prior_opponent_allowed_targets_avg3", "prior_opponent_allowed_targets_ewm",
        ], 33.0), 15.0, 55.0),
        "balanced": np.clip(row_mean(receivers, [
            "prior_team_targets_avg3", "prior_team_targets_avg5", "prior_team_targets_ewm",
            "prior_opponent_allowed_targets_avg3", "prior_opponent_allowed_targets_avg5",
            "prior_opponent_allowed_targets_ewm",
        ], 33.0), 15.0, 55.0),
    }
    shares = {
        "short": np.clip(row_mean(receivers, [
            "prior_target_share_avg3", "prior_target_share_ewm",
        ], 0.0), 0.0, 1.0),
        "balanced": np.clip(row_mean(receivers, [
            "prior_target_share_avg3", "prior_target_share_avg5",
            "prior_target_share_ewm", "prior_target_share_season_avg",
        ], 0.0), 0.0, 1.0),
    }
    shares["availability"] = shares["balanced"] * np.clip(
        1.0 - pd.to_numeric(receivers["availability_severity_combined"], errors="coerce").fillna(0.0).to_numpy(float),
        0.0, 1.0,
    )
    budgets["availability"] = budgets["balanced"]
    keys = [receivers["season"], receivers["week"], receivers["game_id"], receivers["team"]]
    output: dict[str, pd.Series] = {}
    for identity in IDENTITIES:
        raw = pd.Series(shares[identity], index=receivers.index)
        denominator = raw.groupby(keys, observed=True).transform("sum")
        normalized = np.divide(
            raw.to_numpy(float), denominator.to_numpy(float),
            out=np.zeros(len(raw), dtype=float), where=denominator.to_numpy(float) > 0,
        )
        output[identity] = pd.Series(budgets[identity] * normalized, index=receivers["row_id"].astype(str))
    return output


def stability(rows: pd.DataFrame, actual: np.ndarray, control: np.ndarray, candidate: np.ndarray) -> dict[str, Any]:
    values = rows[["game_id", "week"]].copy()
    values["delta"] = np.abs(candidate - actual) - np.abs(control - actual)
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    random = np.random.default_rng(SEED)
    draws = np.empty(4000)
    for index in range(len(draws)):
        sample = grouped[random.integers(0, len(grouped), len(grouped))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    lower, upper = np.quantile(draws, [0.025, 0.975])
    segments = {}
    for start, end in BLOCKS:
        segment = values[values["week"].between(start, end)]
        segments[f"weeks_{start}_{end}"] = {"rows": int(len(segment)), "maeDelta": float(segment["delta"].mean())}
    return {
        "gameClusters": int(len(grouped)),
        "maeDelta": float(values["delta"].mean()),
        "clustered95": [float(lower), float(upper)],
        "chronologicalSegments": segments,
        "passes": bool(upper < 0 and all(value["maeDelta"] <= 0 for value in segments.values())),
    }


def main() -> None:
    foundation = load("receiving_workload_foundation", FOUNDATION)
    receiving = load("receiving_workload_component", RECEIVING)
    availability = foundation.load_module(
        "receiving_workload_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py",
    )
    external = foundation.load_module(
        "receiving_workload_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    manifest = json.loads(foundation.DEFAULT_EXTERNAL_MANIFEST.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("receiving_yards", groups)["full_external"],
        *groups.get("depth", []), *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [name for name in [*groups["base"], *groups["state"]]
                     if name == "is_home" or name.startswith(("prior_team_", "prior_opponent_", "external_state_team_", "external_state_opponent_", "external_environment_"))]
    frame[list(dict.fromkeys([*player_features, *team_features]))] = frame[
        list(dict.fromkeys([*player_features, *team_features]))
    ].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    workload = workload_components(frame)
    by_row = frame.set_index("row_id", drop=False)

    source = pd.read_parquet(FOUNDATION_PROJECTIONS)
    source = source[source["market"].eq("receiving_yards") & source["phase"].isin(["selection", "confirmation"])].copy()
    reports: dict[str, dict[str, Any]] = {}
    output_rows = []

    def phase_values(season: int, phase: str) -> tuple[pd.DataFrame, np.ndarray, np.ndarray, dict[str, np.ndarray]]:
        base = source[source["phase"].eq(phase)].copy()
        test = by_row.loc[base["row_id"]].copy()
        components = receiving.receiving_components(
            foundation, frame, teams, season, team_features, player_features, test,
        )
        incumbent_targets = foundation.budget_prediction(
            teams, season, team_features, "team_targets", test[["game_id", "team"]],
        ) * foundation.normalized_team_target_share_prediction(
            frame, season, player_features, test,
        )
        ypt = np.divide(components["direct"], incumbent_targets,
                        out=np.zeros(len(test)), where=incumbent_targets > 0)
        identity_projection = {
            identity: np.clip(workload[identity].reindex(test["row_id"].astype(str)).fillna(0.0).to_numpy(float) * ypt, 0.0, None)
            for identity in IDENTITIES
        }
        actual = base["actual"].to_numpy(float)
        foundation_control = base["released_projection"].to_numpy(float)
        control = np.where(
            test["position"].to_numpy(str) == "WR",
            0.5 * foundation_control + 0.5 * components["direct"],
            foundation_control,
        )
        return test, actual, control, identity_projection

    selection_test, selection_actual, selection_control, selection_components = phase_values(2024, "selection")
    selection_control_metrics = metrics(selection_actual, selection_control)
    for identity in IDENTITIES:
        for weight in WEIGHTS:
            name = f"{identity}_blend_{int(weight * 100)}"
            candidate = np.clip((1 - weight) * selection_control + weight * selection_components[identity], 0.0, None)
            reports[name] = {"selection": metrics(selection_actual, candidate)}
    selection_eligible = [name for name, report in reports.items()
                          if report["selection"]["mae"] < selection_control_metrics["mae"]
                          and report["selection"]["rmse"] < selection_control_metrics["rmse"]]
    frozen = sorted(selection_eligible, key=lambda name: (int(name.rpartition("_")[-1]), report_score(reports[name]["selection"])))[0] if selection_eligible else None

    confirmation_values = None
    confirmation_control_metrics = None
    confirmation_pass = False
    if frozen:
        confirmation_values = phase_values(2025, "confirmation")
        confirmation_test, confirmation_actual, confirmation_control, confirmation_components = confirmation_values
        confirmation_control_metrics = metrics(confirmation_actual, confirmation_control)
        identity, _, weight_text = frozen.rpartition("_blend_")
        weight = int(weight_text) / 100
        frozen_prediction = np.clip((1 - weight) * confirmation_control + weight * confirmation_components[identity], 0.0, None)
        reports[frozen]["confirmation"] = metrics(confirmation_actual, frozen_prediction)
        reports[frozen]["stability"] = stability(
            confirmation_test, confirmation_actual, confirmation_control, frozen_prediction,
        )
        confirmation_pass = bool(
            reports[frozen]["confirmation"]["mae"] <= confirmation_control_metrics["mae"]
            and reports[frozen]["confirmation"]["rmse"] <= confirmation_control_metrics["rmse"]
            and reports[frozen]["stability"]["passes"]
        )

    current = None
    locked_rows = None
    if frozen and confirmation_pass:
        replay = pd.DataFrame(json.loads(LOCKED_REPLAY.read_text(encoding="utf-8"))["rows"])
        replay = replay[replay["market"].eq("receiving_yards")].copy()
        replay["normalized_player"] = replay["playerName"].map(foundation.normalize_player)
        frame_current = frame[frame["season"].eq(2026)].copy()
        frame_current["normalized_player"] = frame_current["player_name"].map(foundation.normalize_player)
        offered = replay[["week", "team", "normalized_player"]].drop_duplicates().merge(
            frame_current, on=["week", "team", "normalized_player"], how="left", validate="one_to_one",
        )
        if offered["row_id"].isna().any():
            raise RuntimeError("unmatched current Receiving Yards rows")
        components = receiving.receiving_components(
            foundation, frame, teams, 2026, team_features, player_features, offered,
            {str(value) for value in offered["row_id"]},
        )
        incumbent_targets = foundation.budget_prediction(
            teams, 2026, team_features, "team_targets", offered[["game_id", "team"]],
        ) * foundation.normalized_team_target_share_prediction(
            frame, 2026, player_features, offered, {str(value) for value in offered["row_id"]},
        )
        ypt = np.divide(components["direct"], incumbent_targets,
                        out=np.zeros(len(offered)), where=incumbent_targets > 0)
        identity, _, weight_text = frozen.rpartition("_blend_")
        weight = int(weight_text) / 100
        component_by_player = pd.DataFrame({
            "week": offered["week"], "team": offered["team"], "normalized_player": offered["normalized_player"],
            "workloadProjection": workload[identity].reindex(offered["row_id"].astype(str)).fillna(0.0).to_numpy(float) * ypt,
        })
        replay = replay.merge(component_by_player, on=["week", "team", "normalized_player"], how="left", validate="many_to_one")
        control = replay["independentProjection"].to_numpy(float)
        candidate = np.clip((1 - weight) * control + weight * replay["workloadProjection"].to_numpy(float), 0.0, None)
        actual = replay["actual"].to_numpy(float)
        line = replay["line"].to_numpy(float)
        current = {
            "control": metrics(actual, control), "candidate": metrics(actual, candidate),
            "controlDirection": direction(actual, control, line), "candidateDirection": direction(actual, candidate, line),
        }
        current["passes"] = bool(current["candidate"]["mae"] <= current["control"]["mae"]
                                 and current["candidate"]["rmse"] <= current["control"]["rmse"]
                                 and current["candidateDirection"] >= current["controlDirection"])
        locked_rows = replay.copy()
        locked_rows["control"] = control
        locked_rows["candidate"] = candidate
        locked_rows["phase"] = "locked_replay"

    output_phases = [("selection", (selection_test, selection_actual, selection_control, selection_components))]
    if confirmation_values is not None:
        output_phases.append(("confirmation", confirmation_values))
    for phase, (test, actual, control, phase_components) in output_phases:
        values = test[["row_id", "season", "week", "game_id", "team", "opponent", "player_id", "player_name", "position"]].copy()
        values["actual"] = actual
        values["control"] = control
        values["phase"] = phase
        for identity in IDENTITIES:
            values[identity] = phase_components[identity]
        output_rows.append(values)
    if locked_rows is not None:
        output_rows.append(locked_rows)
    ROWS.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(output_rows, ignore_index=True, sort=False).to_parquet(ROWS, index=False)
    result = {
        "release": "nfl_player_props_receiving_yards_recent_workload_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True, "marketIndependent": True, "marketFeatures": [],
        "identities": list(IDENTITIES), "weights": list(WEIGHTS),
        "selectionControl": selection_control_metrics,
        "confirmationControl": confirmation_control_metrics,
        "reports": reports, "selectionEligible": selection_eligible, "frozenCandidate": frozen,
        "confirmationPass": confirmation_pass, "currentOpened": current is not None, "current": current,
        "injuryMetadata": injury_metadata,
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ["release", "selectionControl", "confirmationControl", "selectionEligible", "frozenCandidate", "confirmationPass", "currentOpened", "current"]}, indent=2))


def report_score(value: dict[str, float | int]) -> float:
    return float(value["mae"]) + float(value["rmse"])


if __name__ == "__main__":
    main()
