#!/usr/bin/env python3
"""Research-only Rushing Yards ordinary/explosive contribution tournament."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


ROOT = pathlib.Path(__file__).resolve().parents[2]
DECOMPOSITION = ROOT / "scripts/operator/tournament_nfl_player_props_passing_attempts_decomposition.py"
FOUNDATION = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
AVAILABILITY = ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py"
RUSHING_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_rows_r1.parquet"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_explosive_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_explosive_rows_r1.parquet"
WEIGHTS = (0.25, 0.50, 0.75)
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
    return {"rows": int(len(error)), "mae": float(np.mean(np.abs(error))),
            "rmse": float(math.sqrt(np.mean(error ** 2))), "bias": float(np.mean(error))}


def direction(actual: np.ndarray, prediction: np.ndarray, line: np.ndarray) -> float:
    return float(np.mean(np.sign(prediction - line) == np.sign(actual - line)))


def stability(frame: pd.DataFrame, candidate: str) -> dict[str, Any]:
    values = frame.copy()
    values["delta"] = np.abs(values[candidate] - values["actual"]) - np.abs(values["incumbent"] - values["actual"])
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    random = np.random.default_rng(SEED)
    draws = np.empty(4000)
    for index in range(len(draws)):
        sample = grouped[random.integers(0, len(grouped), len(grouped))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    lower, median, upper = np.quantile(draws, [0.025, 0.5, 0.975])
    segments = {}
    for start, end in ((1, 4), (5, 9), (10, 13), (14, 18)):
        segment = values[values["week"].between(start, end)]
        segments[f"weeks_{start}_{end}"] = {"rows": int(len(segment)), "maeDelta": float(segment["delta"].mean())}
    return {"gameClusters": int(len(grouped)), "lower": float(lower), "median": float(median),
            "upper": float(upper), "segments": segments,
            "passes": bool(upper < 0 and all(value["maeDelta"] <= 0 for value in segments.values()))}


def rushing_components(paths: list[pathlib.Path]) -> pd.DataFrame:
    columns = ["season", "season_type", "week", "game_id", "rusher_player_id", "rush_attempt", "qb_kneel", "qb_spike", "rushing_yards"]
    frames = []
    for path in paths:
        available = set(pq.read_schema(path).names)
        frame = pq.read_table(path, columns=[column for column in columns if column in available]).to_pandas()
        for column in columns:
            if column not in frame:
                frame[column] = pd.NA
        frames.append(frame)
    plays = pd.concat(frames, ignore_index=True)
    plays = plays[
        plays["season_type"].fillna("").eq("REG")
        & plays["rush_attempt"].fillna(0).eq(1)
        & ~plays["qb_kneel"].fillna(0).eq(1)
        & ~plays["qb_spike"].fillna(0).eq(1)
        & plays["rusher_player_id"].notna()
    ].copy()
    plays["rushing_yards"] = pd.to_numeric(plays["rushing_yards"], errors="coerce").fillna(0.0)
    plays["ordinary_yards"] = np.where(plays["rushing_yards"].lt(10), plays["rushing_yards"], 0.0)
    plays["explosive_yards"] = np.where(plays["rushing_yards"].ge(10), plays["rushing_yards"], 0.0)
    return plays.groupby(["season", "week", "game_id", "rusher_player_id"], observed=True, as_index=False).agg(
        pbp_rushing_attempts=("game_id", "size"), ordinary_yards=("ordinary_yards", "sum"),
        explosive_yards=("explosive_yards", "sum"),
    ).rename(columns={"rusher_player_id": "player_id"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rushing-rows", type=pathlib.Path, default=RUSHING_ROWS)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()
    decomp = load("rushing_explosive_decomposition", DECOMPOSITION)
    foundation = load("rushing_explosive_foundation", FOUNDATION)
    availability = load("rushing_explosive_availability", AVAILABILITY)
    manifest = decomp.read_manifest(decomp.EXTERNAL_MANIFEST)
    feature_path = pathlib.Path(str(manifest["featureFile"]))
    if decomp.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame).merge(
        rushing_components(decomp.verified_pbp_paths()),
        on=["season", "week", "game_id", "player_id"], how="left", validate="many_to_one",
    )
    rushers = frame[frame["rushing_attempts"].gt(0)]
    coverage = float(rushers["pbp_rushing_attempts"].notna().mean())
    # ID-backed PBP covers 97%+ of player-game rush rows; unmatched legacy
    # rusher IDs are excluded from fitting rather than name-joined.
    if coverage < 0.95:
        raise RuntimeError(f"PBP rushing coverage too low: {coverage:.4f}")
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *groups["base"], *groups["state"], *groups.get("pfr", []), *groups.get("ftn", []),
        *groups.get("ngs", []), *groups.get("depth", []), *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [name for name in [*groups["base"], *groups["state"]]
                     if name == "is_home" or name.startswith(("prior_team_", "prior_opponent_", "external_state_team_", "external_state_opponent_", "external_environment_"))]
    frame[list(dict.fromkeys([*player_features, *team_features]))] = frame[
        list(dict.fromkeys([*player_features, *team_features]))
    ].replace([np.inf, -np.inf], np.nan)
    opportunity_groups = foundation.group_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)

    def component(test: pd.DataFrame, season: int, active_ids: set[str] | None = None) -> np.ndarray:
        result = np.zeros(len(test), dtype=float)
        for group in sorted(test["expected_role_group"].unique()):
            mask = test["expected_role_group"].eq(group).to_numpy()
            subset = test.loc[mask]
            budget = foundation.budget_prediction(opportunity_groups, season, team_features, "rushing_attempts", subset[["game_id", "team"]], group)
            share = foundation.normalized_share_prediction(
                frame, season, player_features, "expected_role_rush_share", group, subset, active_ids,
            )
            carries = np.clip(budget * share, 0.0, None)
            train = frame[
                frame["season"].lt(season) & frame["expected_role_group"].eq(group)
                & frame["pbp_rushing_attempts"].gt(0) & frame["participated"].eq(1)
            ].copy()
            train["ordinary_per_attempt"] = (train["ordinary_yards"] / train["pbp_rushing_attempts"]).clip(-5.0, 8.0)
            train["explosive_per_attempt"] = (train["explosive_yards"] / train["pbp_rushing_attempts"]).clip(0.0, 15.0)
            ordinary_model = foundation.model("absolute_error").fit(
                train[player_features], train["ordinary_per_attempt"].to_numpy(float),
                sample_weight=train["pbp_rushing_attempts"].to_numpy(float),
            )
            explosive_model = foundation.model("squared_error").fit(
                train[player_features], train["explosive_per_attempt"].to_numpy(float),
                sample_weight=train["pbp_rushing_attempts"].to_numpy(float),
            )
            ordinary = np.clip(np.asarray(ordinary_model.predict(subset[player_features]), dtype=float), -5.0, 8.0)
            explosive = np.clip(np.asarray(explosive_model.predict(subset[player_features]), dtype=float), 0.0, 15.0)
            result[mask] = np.clip(carries * (ordinary + explosive), 0.0, None)
        return result

    source = pd.read_parquet(args.rushing_rows)
    reports: dict[str, Any] = {}
    phase_rows: dict[str, pd.DataFrame] = {}
    outputs = []
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        base = source[source["phase"].eq(phase)].reset_index(drop=True).copy()
        test = by_row.loc[base["row_id"]].reset_index(drop=True)
        base["incumbent"] = base["candidate_projection"].to_numpy(float)
        base["challenger"] = component(test, season)
        for weight in WEIGHTS:
            base[f"blend_{int(weight * 100)}"] = (1.0 - weight) * base["incumbent"] + weight * base["challenger"]
        phase_rows[phase] = base
        outputs.append(base)
        reports[phase] = {"incumbent": metrics(base["actual"].to_numpy(float), base["incumbent"].to_numpy(float)),
                          "candidates": {f"blend_{int(weight * 100)}": metrics(base["actual"].to_numpy(float), base[f"blend_{int(weight * 100)}"].to_numpy(float)) for weight in WEIGHTS}}
    selectable = [name for name, result in reports["selection"]["candidates"].items()
                  if result["mae"] < reports["selection"]["incumbent"]["mae"] and result["rmse"] < reports["selection"]["incumbent"]["rmse"]]
    selected = min(selectable, key=lambda name: reports["selection"]["candidates"][name]["mae"] / reports["selection"]["incumbent"]["mae"] + reports["selection"]["candidates"][name]["rmse"] / reports["selection"]["incumbent"]["rmse"]) if selectable else None
    confirmation_stability = stability(phase_rows["confirmation"], selected) if selected else None
    confirmed = bool(selected and reports["confirmation"]["candidates"][selected]["mae"] <= reports["confirmation"]["incumbent"]["mae"] and reports["confirmation"]["candidates"][selected]["rmse"] <= reports["confirmation"]["incumbent"]["rmse"] and confirmation_stability and confirmation_stability["passes"])
    frozen = selected if confirmed else None
    current = source[source["phase"].eq("locked_replay")].reset_index(drop=True).copy()
    test = by_row.loc[current["row_id"]].reset_index(drop=True)
    current["incumbent"] = current["candidate_projection"].to_numpy(float)
    current["challenger"] = component(test, 2026, set(test["row_id"].astype(str)))
    for weight in WEIGHTS:
        current[f"blend_{int(weight * 100)}"] = (1.0 - weight) * current["incumbent"] + weight * current["challenger"]
    current_report = {"incumbent": metrics(current["actual"].to_numpy(float), current["incumbent"].to_numpy(float)),
                      "candidate": metrics(current["actual"].to_numpy(float), current[frozen].to_numpy(float)) if frozen else None,
                      "incumbentDirection": direction(current["actual"].to_numpy(float), current["incumbent"].to_numpy(float), current["line"].to_numpy(float)),
                      "candidateDirection": direction(current["actual"].to_numpy(float), current[frozen].to_numpy(float), current["line"].to_numpy(float)) if frozen else None,
                      "clusteredMaeDelta": stability(current, frozen) if frozen else None}
    qualifies = bool(frozen and current_report["candidate"] and current_report["candidate"]["mae"] < current_report["incumbent"]["mae"] and current_report["candidate"]["rmse"] < current_report["incumbent"]["rmse"] and current_report["candidateDirection"] >= current_report["incumbentDirection"])
    outputs.append(current)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(outputs, ignore_index=True, sort=False).to_parquet(args.rows, index=False)
    payload = {"release": "nfl_player_props_rushing_yards_explosive_2026_10_15_r1", "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "researchOnly": True, "marketIndependent": True, "marketFeatures": [], "pbpCoverage": coverage,
               "candidate": "predicted carries times separately modeled ordinary and explosive yard contributions",
               "reports": reports, "selectionEligible": selectable, "selected": selected,
               "confirmationStability": confirmation_stability, "confirmed": confirmed, "frozenCandidate": frozen,
               "currentSeason": current_report, "qualifies": qualifies, "injuryMetadata": injury_metadata}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
