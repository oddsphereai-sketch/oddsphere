#!/usr/bin/env python3
"""Release-gated independent Receptions point-head tournament."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import re
import time
import unicodedata
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
FOUNDATION_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
TEAM_TARGET_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_team_target_allocation_2026_projections_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_rows_r1.parquet"
WEIGHTS = (0.50, 0.75, 1.0)
TEAM_TARGET_INCREMENT_WEIGHT = 0.75
FOUNDATION_POINT_WEIGHT = 0.25
FOUNDATION_COMPONENT_WEIGHT = 1.0 / 7.0
TEAM_COMPONENT_WEIGHT = 6.0 / 7.0
BLOCKS = ((1, 4), (5, 9), (10, 13), (14, 18))


def normalize_player(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def stability(
    rows: pd.DataFrame, actual: np.ndarray, reference: np.ndarray, candidate: np.ndarray,
) -> dict[str, Any]:
    values = rows[["game_id", "week"]].copy()
    values["delta"] = np.abs(candidate - actual) - np.abs(reference - actual)
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    rng = np.random.default_rng(20261008)
    bootstrap: list[float] = []
    for _ in range(20):
        indexes = rng.integers(0, len(grouped), size=(500, len(grouped)))
        sample = grouped[indexes]
        bootstrap.extend((sample[:, :, 0].sum(axis=1) / sample[:, :, 1].sum(axis=1)).tolist())
    segments: dict[str, dict[str, float | int]] = {}
    for lower, upper in BLOCKS:
        segment = values[values["week"].between(lower, upper)]
        segments[f"weeks_{lower}_{upper}"] = {
            "rows": int(len(segment)), "maeDelta": float(segment["delta"].mean()),
        }
    interval = [float(np.quantile(bootstrap, 0.025)), float(np.quantile(bootstrap, 0.975))]
    return {
        "games": int(len(grouped)), "maeDelta": float(values["delta"].mean()),
        "gameClusterBootstrap95": interval, "chronologicalSegments": segments,
        "passes": bool(interval[1] < 0 and all(value["maeDelta"] <= 0 for value in segments.values())),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation-projections", type=pathlib.Path, default=FOUNDATION_PROJECTIONS)
    parser.add_argument("--team-target-projections", type=pathlib.Path, default=TEAM_TARGET_PROJECTIONS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    foundation = pd.read_parquet(args.foundation_projections)
    team_target = pd.read_parquet(args.team_target_projections)
    foundation = foundation[
        foundation["market"].eq("receptions")
        & foundation["phase"].isin(["selection", "confirmation", "locked_replay"])
    ].copy()
    team_target = team_target[
        team_target["market"].eq("receptions")
        & team_target["phase"].isin(["selection", "confirmation", "locked_replay"])
    ].copy()

    historical = foundation[foundation["phase"].isin(["selection", "confirmation"])].merge(
        team_target[["row_id", "phase", "candidate_projection"]].rename(
            columns={"candidate_projection": "team_target_candidate"},
        ),
        on=["row_id", "phase"], how="inner", validate="one_to_one",
    )
    if set(historical["phase"].unique()) != {"selection", "confirmation"}:
        raise RuntimeError("Receptions foundation is missing a historical phase")
    historical["component_projection"] = (
        historical["team_target_candidate"].to_numpy(float)
        - FOUNDATION_POINT_WEIGHT * historical["candidate_projection"].to_numpy(float)
    ) / TEAM_TARGET_INCREMENT_WEIGHT

    reports: dict[str, dict[str, Any]] = {}
    for weight in WEIGHTS:
        name = f"team_target_blend_{int(weight * 100)}"
        reports[name] = {}
        for phase in ("selection", "confirmation"):
            rows = historical[historical["phase"].eq(phase)].copy()
            actual = rows["actual"].to_numpy(float)
            reference = rows["released_projection"].to_numpy(float)
            candidate = np.clip(
                (1.0 - weight) * reference + weight * rows["component_projection"].to_numpy(float),
                0.0, None,
            )
            reports[name][phase] = metrics(actual, candidate)
            if phase == "confirmation":
                reports[name]["stability"] = stability(rows, actual, reference, candidate)

    reference_metrics = {
        phase: metrics(
            historical.loc[historical["phase"].eq(phase), "actual"].to_numpy(float),
            historical.loc[historical["phase"].eq(phase), "released_projection"].to_numpy(float),
        )
        for phase in ("selection", "confirmation")
    }
    eligible = [
        name for name, value in reports.items()
        if value["selection"]["mae"] < reference_metrics["selection"]["mae"]
        and value["selection"]["rmse"] < reference_metrics["selection"]["rmse"]
        and value["confirmation"]["mae"] <= reference_metrics["confirmation"]["mae"]
        and value["confirmation"]["rmse"] <= reference_metrics["confirmation"]["rmse"]
        and value["stability"]["passes"]
        and abs(float(value["confirmation"]["bias"]))
            <= abs(float(reference_metrics["confirmation"]["bias"])) + 0.25
    ]
    ranked = sorted(eligible, key=lambda name: (
        float(reports[name]["stability"]["gameClusterBootstrap95"][1]),
        float(reports[name]["selection"]["mae"]) / float(reference_metrics["selection"]["mae"])
        + float(reports[name]["selection"]["rmse"]) / float(reference_metrics["selection"]["rmse"]),
        float(reports[name]["confirmation"]["mae"]),
    ))

    replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("receptions")].copy()
    replay["normalized_player"] = replay["playerName"].map(normalize_player)
    locked_component = team_target[team_target["phase"].eq("locked_replay")].copy()
    locked_component["normalized_player"] = locked_component["player_name"].map(normalize_player)
    locked_foundation = foundation[foundation["phase"].eq("locked_replay")].copy()
    locked_foundation["normalized_player"] = locked_foundation["player_name"].map(normalize_player)
    locked_component = locked_component.merge(
        locked_foundation[["week", "team", "normalized_player", "component_projection"]].rename(
            columns={"component_projection": "foundation_component_projection"},
        ),
        on=["week", "team", "normalized_player"], how="inner", validate="one_to_one",
    )
    locked_component["component_projection"] = (
        locked_component["component_projection"].to_numpy(float)
        - FOUNDATION_COMPONENT_WEIGHT
        * locked_component["foundation_component_projection"].to_numpy(float)
    ) / TEAM_COMPONENT_WEIGHT
    replay = replay.merge(
        locked_component[["week", "team", "normalized_player", "row_id", "season", "game_id",
                          "opponent", "player_id", "player_name", "position", "component_projection"]],
        on=["week", "team", "normalized_player"], how="left", validate="many_to_one",
    )
    if replay["component_projection"].isna().any():
        raise RuntimeError("unmatched exact-2026 Receptions replay rows")
    actual = replay["actual"].to_numpy(float)
    line = replay["line"].to_numpy(float)
    reference = replay["independentProjection"].to_numpy(float)
    reference_locked = metrics(actual, reference)
    direction_reference = direction(actual, reference, line)
    for name in ranked:
        weight = int(name.rsplit("_", 1)[-1]) / 100.0
        candidate = np.clip(
            (1.0 - weight) * reference + weight * replay["component_projection"].to_numpy(float),
            0.0, None,
        )
        candidate_metrics = metrics(actual, candidate)
        candidate_direction = direction(actual, candidate, line)
        reports[name]["locked2026"] = {
            "metrics": candidate_metrics, "direction": candidate_direction,
            "passes": bool(
                candidate_metrics["mae"] <= reference_locked["mae"]
                and candidate_metrics["rmse"] <= reference_locked["rmse"]
                and candidate_direction >= direction_reference
            ),
        }
    selected = ranked[0] if ranked and reports[ranked[0]]["locked2026"]["passes"] else None
    selected_weight = int(selected.rsplit("_", 1)[-1]) / 100.0 if selected else 0.0
    candidate_locked = np.clip(
        (1.0 - selected_weight) * reference
        + selected_weight * replay["component_projection"].to_numpy(float), 0.0, None,
    )

    output_rows: list[pd.DataFrame] = []
    for phase in ("selection", "confirmation"):
        rows = historical[historical["phase"].eq(phase)].copy()
        values = rows[["row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                       "player_name", "position", "actual"]].copy()
        values["phase"] = phase
        values["reference_projection"] = rows["released_projection"].to_numpy(float)
        values["candidate_projection"] = np.clip(
            (1.0 - selected_weight) * values["reference_projection"].to_numpy(float)
            + selected_weight * rows["component_projection"].to_numpy(float), 0.0, None,
        )
        output_rows.append(values)
    locked_rows = replay[["row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                          "player_name", "position", "actual", "line", "side"]].copy()
    locked_rows["phase"] = "locked_replay"
    locked_rows["reference_projection"] = reference
    locked_rows["candidate_projection"] = candidate_locked
    output_rows.append(locked_rows)

    result_rows = pd.concat(output_rows, ignore_index=True)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_receptions_tournament_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True, "marketIndependent": True, "marketFeatures": [],
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025,
                       "diagnostic": "exact 2026 Weeks 1-4 locked scopes"},
        "reference": reference_metrics, "candidates": reports,
        "historicallyEligibleRanking": ranked, "selected": selected,
        "locked2026": {
            "reference": reference_locked, "candidate": metrics(actual, candidate_locked),
            "published": metrics(actual, replay["publishedProjection"].to_numpy(float)),
            "directionReference": direction_reference,
            "directionCandidate": direction(actual, candidate_locked, line),
            "directionPublished": direction(actual, replay["publishedProjection"].to_numpy(float), line),
        },
        "rowsFile": str(args.rows.resolve()), "rowsSha256": sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "selected": selected,
                      "historicallyEligibleRanking": ranked, "locked2026": output["locked2026"]}, indent=2))


if __name__ == "__main__":
    main()
