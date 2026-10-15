#!/usr/bin/env python3
"""Research-only Receiving Yards completed-air/YAC decomposition tournament."""

from __future__ import annotations

import argparse
import glob
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
EXISTING = ROOT / "scripts/operator/tournament_nfl_player_props_receiving_yards.py"
FOUNDATION_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_through_week_5_r2.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_yards_air_yac_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_yards_air_yac_rows_r1.parquet"
WEIGHTS = (0.25, 0.50, 0.75)
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
        "underpredictionRate": float(np.mean(error < 0)),
    }


def direction(actual: np.ndarray, prediction: np.ndarray, line: np.ndarray) -> float:
    return float(np.mean(np.sign(prediction - line) == np.sign(actual - line)))


def candidate_projection(
    incumbent: np.ndarray,
    component: np.ndarray,
    positions: np.ndarray,
    name: str,
) -> np.ndarray:
    role_only = name.startswith("wr_")
    weight = int(name.rpartition("_")[-1]) / 100.0
    blended = np.clip((1.0 - weight) * incumbent + weight * component, 0.0, None)
    return np.where(positions == "WR", blended, incumbent) if role_only else blended


def stability(rows: pd.DataFrame, actual: np.ndarray, incumbent: np.ndarray, candidate: np.ndarray) -> dict[str, Any]:
    values = rows[["game_id", "week"]].copy()
    values["delta"] = np.abs(candidate - actual) - np.abs(incumbent - actual)
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    random = np.random.default_rng(SEED)
    draws = np.empty(4000)
    for index in range(len(draws)):
        sample = grouped[random.integers(0, len(grouped), len(grouped))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    lower, median, upper = np.quantile(draws, [0.025, 0.5, 0.975])
    segments: dict[str, dict[str, float | int]] = {}
    for start, end in BLOCKS:
        segment = values[values["week"].between(start, end)]
        segments[f"weeks_{start}_{end}"] = {
            "rows": int(len(segment)),
            "maeDelta": float(segment["delta"].mean()),
        }
    return {
        "gameClusters": int(len(grouped)),
        "maeDelta": float(values["delta"].mean()),
        "clustered95": [float(lower), float(upper)],
        "clusteredMedian": float(median),
        "chronologicalSegments": segments,
        "passes": bool(upper < 0 and all(value["maeDelta"] <= 0 for value in segments.values())),
    }


def weekly_receiving_outcomes() -> pd.DataFrame:
    paths = sorted(glob.glob(str(ROOT / "football-research/cache/nflverse/real-model-r1/player_stats/*.parquet")))
    paths += sorted(glob.glob(str(ROOT / "football-research/cache/nfl-player-props-external/current/player_stats/*.parquet")))
    if not paths:
        raise RuntimeError("weekly player-stat cache is missing")
    columns = [
        "season", "week", "season_type", "player_id", "team", "targets", "receptions",
        "receiving_yards", "receiving_yards_after_catch",
    ]
    values = pd.concat((pd.read_parquet(path, columns=columns) for path in paths), ignore_index=True)
    values = values[values["season_type"].eq("REG")].copy()
    values["team"] = values["team"].replace({"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"})
    numeric = ["targets", "receptions", "receiving_yards", "receiving_yards_after_catch"]
    values[numeric] = values[numeric].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    values = values.groupby(["season", "week", "player_id", "team"], observed=True, as_index=False)[numeric].sum()
    values["completed_air_yards"] = values["receiving_yards"] - values["receiving_yards_after_catch"]
    return values


def component_predictions(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    team_features: list[str],
    player_features: list[str],
    test: pd.DataFrame,
    known_active_row_ids: set[str] | None = None,
) -> dict[str, np.ndarray]:
    budget = foundation.budget_prediction(
        teams, season, team_features, "team_targets", test[["game_id", "team"]],
    )
    share = foundation.normalized_team_target_share_prediction(
        frame, season, player_features, test, known_active_row_ids,
    )
    targets = np.clip(budget * share, 0.0, None)
    direct = np.zeros(len(test), dtype=float)
    air_yac = np.zeros(len(test), dtype=float)
    catch_rates = np.zeros(len(test), dtype=float)
    completed_air_rates = np.zeros(len(test), dtype=float)
    yac_rates = np.zeros(len(test), dtype=float)
    for group in sorted(test["expected_role_group"].unique()):
        mask = test["expected_role_group"].eq(group).to_numpy()
        subset = test.loc[mask]
        direct_rate = foundation.rate_prediction(
            frame, season, player_features, "receiving_yards", "targets",
            group, subset, 0.0, 30.0, False,
        )
        catch_rate = foundation.rate_prediction(
            frame, season, player_features, "receptions", "targets",
            group, subset, 0.0, 1.0, True,
        )
        target_train = frame[
            frame["season"].lt(season)
            & frame["expected_role_group"].eq(group)
            & frame["targets"].gt(0)
            & frame["participated"].eq(1)
            & frame["completed_air_yards"].notna()
        ].copy()
        target_train["completed_air_per_target"] = (
            target_train["completed_air_yards"] / target_train["targets"]
        ).clip(-10.0, 30.0)
        air_model = foundation.model("absolute_error").fit(
            target_train[player_features],
            target_train["completed_air_per_target"].to_numpy(float),
            sample_weight=target_train["targets"].to_numpy(float),
        )
        air_rate = np.clip(np.asarray(air_model.predict(subset[player_features]), dtype=float), -10.0, 30.0)
        reception_train = frame[
            frame["season"].lt(season)
            & frame["expected_role_group"].eq(group)
            & frame["receptions"].gt(0)
            & frame["participated"].eq(1)
            & frame["receiving_yards_after_catch"].notna()
        ].copy()
        reception_train["yac_per_reception"] = (
            reception_train["receiving_yards_after_catch"] / reception_train["receptions"]
        ).clip(-3.0, 30.0)
        yac_model = foundation.model("absolute_error").fit(
            reception_train[player_features],
            reception_train["yac_per_reception"].to_numpy(float),
            sample_weight=reception_train["receptions"].to_numpy(float),
        )
        yac_rate = np.clip(np.asarray(yac_model.predict(subset[player_features]), dtype=float), -3.0, 30.0)
        direct[mask] = targets[mask] * direct_rate
        air_yac[mask] = np.clip(targets[mask] * (air_rate + catch_rate * yac_rate), 0.0, None)
        catch_rates[mask] = catch_rate
        completed_air_rates[mask] = air_rate
        yac_rates[mask] = yac_rate
    return {
        "predictedTargets": targets,
        "direct": direct,
        "airYac": air_yac,
        "catchRate": catch_rates,
        "completedAirYardsPerTarget": completed_air_rates,
        "yacPerReception": yac_rates,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation-projections", type=pathlib.Path, default=FOUNDATION_PROJECTIONS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    foundation = load("receiving_air_yac_foundation", FOUNDATION)
    existing = load("receiving_air_yac_existing", EXISTING)
    external = foundation.load_module(
        "receiving_air_yac_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    availability = foundation.load_module(
        "receiving_air_yac_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py",
    )
    manifest = json.loads(foundation.DEFAULT_EXTERNAL_MANIFEST.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    outcomes = weekly_receiving_outcomes()
    frame = frame.merge(
        outcomes,
        on=["season", "week", "player_id", "team"],
        how="left",
        suffixes=("", "_weekly"),
        validate="many_to_one",
    )
    frame["completed_air_yards"] = frame["completed_air_yards"].where(
        frame["targets_weekly"].notna(), np.nan,
    )
    frame["receiving_yards_after_catch"] = frame["receiving_yards_after_catch"].where(
        frame["targets_weekly"].notna(), np.nan,
    )
    receiver_rows = frame[frame["expected_role_group"].isin(["BACK", "WR", "TE"]) & frame["targets"].gt(0)]
    coverage = float(receiver_rows["completed_air_yards"].notna().mean())
    if coverage < 0.98:
        raise RuntimeError(f"weekly receiving component coverage too low: {coverage:.4f}")

    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("receiving_yards", groups)["full_external"],
        *groups.get("depth", []),
        *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    numeric = list(dict.fromkeys([*player_features, *team_features]))
    frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)

    source = pd.read_parquet(args.foundation_projections)
    source = source[source["market"].eq("receiving_yards") & source["phase"].isin(["selection", "confirmation"])].copy()
    historical: dict[str, Any] = {}
    rows_by_phase: dict[str, pd.DataFrame] = {}
    candidates: dict[str, dict[str, np.ndarray]] = {}
    output_rows: list[pd.DataFrame] = []
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        base = source[source["phase"].eq(phase)].copy()
        test = by_row.loc[base["row_id"]].copy()
        components = component_predictions(
            foundation, frame, teams, season, team_features, player_features, test,
        )
        reference = base["released_projection"].to_numpy(float)
        positions = test["position"].to_numpy(str)
        incumbent = np.where(positions == "WR", 0.5 * reference + 0.5 * components["direct"], reference)
        actual = base["actual"].to_numpy(float)
        rows_by_phase[phase] = test
        historical[phase] = {
            "actual": actual,
            "incumbent": incumbent,
            "positions": positions,
            "components": components,
        }
        values = test[["row_id", "season", "week", "game_id", "team", "opponent", "player_id", "player_name", "position"]].copy()
        values["phase"] = phase
        values["actual"] = actual
        values["incumbent"] = incumbent
        for key, component in components.items():
            values[key] = component
        output_rows.append(values)

    names = [f"{prefix}air_yac_blend_{int(weight * 100)}" for prefix in ("all_", "wr_") for weight in WEIGHTS]
    reports: dict[str, dict[str, Any]] = {}
    incumbent_reports = {
        phase: metrics(value["actual"], value["incumbent"])
        for phase, value in historical.items()
    }
    for name in names:
        reports[name] = {}
        for phase in ("selection", "confirmation"):
            value = historical[phase]
            candidate = candidate_projection(value["incumbent"], value["components"]["airYac"], value["positions"], name)
            reports[name][phase] = metrics(value["actual"], candidate)
            candidates.setdefault(name, {})[phase] = candidate
            if phase == "confirmation":
                reports[name]["stability"] = stability(
                    rows_by_phase[phase], value["actual"], value["incumbent"], candidate,
                )
    eligible = [
        name for name in names
        if reports[name]["selection"]["mae"] < incumbent_reports["selection"]["mae"]
        and reports[name]["selection"]["rmse"] < incumbent_reports["selection"]["rmse"]
        and reports[name]["confirmation"]["mae"] <= incumbent_reports["confirmation"]["mae"]
        and reports[name]["confirmation"]["rmse"] <= incumbent_reports["confirmation"]["rmse"]
        and reports[name]["stability"]["passes"]
    ]
    ranked = sorted(eligible, key=lambda name: (
        float(reports[name]["stability"]["clustered95"][1]),
        float(reports[name]["selection"]["mae"]) / float(incumbent_reports["selection"]["mae"])
        + float(reports[name]["selection"]["rmse"]) / float(incumbent_reports["selection"]["rmse"]),
        float(reports[name]["confirmation"]["mae"]),
    ))
    frozen = ranked[0] if ranked else None

    replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("receiving_yards")].copy()
    replay["normalized_player"] = replay["playerName"].map(foundation.normalize_player)
    current_frame = frame[frame["season"].eq(2026)].copy()
    current_frame["normalized_player"] = current_frame["player_name"].map(foundation.normalize_player)
    offered = replay[["week", "playerName", "team", "normalized_player"]].drop_duplicates(
        ["week", "team", "normalized_player"],
    ).merge(current_frame, on=["week", "team", "normalized_player"], how="left", validate="one_to_one")
    if offered["row_id"].isna().any():
        raise RuntimeError("unmatched exact-2026 Receiving Yards replay rows")
    components = component_predictions(
        foundation, frame, teams, 2026, team_features, player_features, offered,
        {str(value) for value in offered["row_id"]},
    )
    component_rows = offered[["week", "team", "normalized_player", "row_id", "game_id", "player_id", "player_name", "position"]].copy()
    for key, component in components.items():
        component_rows[key] = component
    replay = replay.merge(component_rows, on=["week", "team", "normalized_player"], how="left", validate="many_to_one")
    actual = replay["actual"].to_numpy(float)
    incumbent = replay["independentProjection"].to_numpy(float)
    line = replay["line"].to_numpy(float)
    candidate = candidate_projection(incumbent, replay["airYac"].to_numpy(float), replay["position"].to_numpy(str), frozen) if frozen else incumbent.copy()
    current_report = {
        "incumbent": metrics(actual, incumbent),
        "incumbentDirection": direction(actual, incumbent, line),
        "candidate": metrics(actual, candidate) if frozen else None,
        "candidateDirection": direction(actual, candidate, line) if frozen else None,
        "byRole": {
            str(role): {
                "rows": int(len(group)),
                "incumbent": metrics(group["actual"].to_numpy(float), group["independentProjection"].to_numpy(float)),
                "candidate": metrics(group["actual"].to_numpy(float), candidate[group.index.to_numpy()]),
            }
            for role, group in replay.reset_index(drop=True).groupby("position", observed=True)
        } if frozen else {},
        "byWeek": {
            str(int(week)): {
                "rows": int(len(group)),
                "incumbent": metrics(group["actual"].to_numpy(float), group["independentProjection"].to_numpy(float)),
                "candidate": metrics(group["actual"].to_numpy(float), candidate[group.index.to_numpy()]),
            }
            for week, group in replay.reset_index(drop=True).groupby("week", observed=True)
        } if frozen else {},
        "clusteredMaeDelta": stability(
            replay[["gameId", "week"]].rename(columns={"gameId": "game_id"}),
            actual, incumbent, candidate,
        ) if frozen else None,
    }
    qualifies = bool(
        frozen
        and current_report["candidate"]["mae"] < current_report["incumbent"]["mae"]
        and current_report["candidate"]["rmse"] < current_report["incumbent"]["rmse"]
        and current_report["candidateDirection"] >= current_report["incumbentDirection"]
    )
    replay["phase"] = "locked_replay"
    replay["incumbent"] = incumbent
    replay["candidate"] = candidate
    output_rows.append(replay)

    args.rows.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(output_rows, ignore_index=True, sort=False).to_parquet(args.rows, index=False)
    payload = {
        "release": "nfl_player_props_receiving_yards_air_yac_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "weeklyComponentCoverage": coverage,
        "featureCount": len(player_features),
        "incumbent": "released independent Receiving Yards point head",
        "candidate": "targets * completed-air-yards-per-target + targets * catch-rate * YAC-per-reception",
        "incumbentReports": incumbent_reports,
        "reports": reports,
        "eligible": eligible,
        "frozenCandidate": frozen,
        "currentSeason": current_report,
        "qualifies": qualifies,
        "injuryMetadata": injury_metadata,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
