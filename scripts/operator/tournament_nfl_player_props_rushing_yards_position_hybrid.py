#!/usr/bin/env python3
"""Position-gated salvage of the frozen Rushing Yards factorized candidate."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_team_factorization_rows_r1.parquet"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_position_hybrid_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_position_hybrid_rows_r1.parquet"
NON_QB = ("RB", "FB", "WR")
BLOCKS = ((1, 4), (5, 9), (10, 13), (14, 18))
SEED = 20261015


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


def direction(actual: np.ndarray, prediction: np.ndarray, line: np.ndarray) -> dict[str, float | int]:
    actual_side = np.sign(np.asarray(actual, dtype=float) - np.asarray(line, dtype=float))
    predicted_side = np.sign(np.asarray(prediction, dtype=float) - np.asarray(line, dtype=float))
    pushes = actual_side == 0
    decided = ~pushes
    return {
        "rows": int(len(actual_side)),
        "decided": int(decided.sum()),
        "pushes": int(pushes.sum()),
        "correct": int((predicted_side[decided] == actual_side[decided]).sum()),
        "accuracy": float(np.mean(predicted_side[decided] == actual_side[decided])) if decided.any() else 0.0,
    }


def stability(rows: pd.DataFrame) -> dict[str, Any]:
    values = rows[["game_id", "week"]].copy()
    values["delta"] = (
        np.abs(rows["hybrid_projection"].to_numpy(float) - rows["actual"].to_numpy(float))
        - np.abs(rows["reference_projection"].to_numpy(float) - rows["actual"].to_numpy(float))
    )
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    rng = np.random.default_rng(SEED)
    bootstrap: list[float] = []
    for _ in range(20):
        indexes = rng.integers(0, len(grouped), size=(500, len(grouped)))
        sample = grouped[indexes]
        bootstrap.extend((sample[:, :, 0].sum(axis=1) / sample[:, :, 1].sum(axis=1)).tolist())
    segments: dict[str, dict[str, float | int]] = {}
    for lower, upper in BLOCKS:
        segment = values[values["week"].between(lower, upper)]
        segments[f"weeks_{lower}_{upper}"] = {
            "rows": int(len(segment)),
            "maeDelta": float(segment["delta"].mean()),
        }
    interval = [float(np.quantile(bootstrap, 0.025)), float(np.quantile(bootstrap, 0.975))]
    return {
        "games": int(len(grouped)),
        "maeDelta": float(values["delta"].mean()),
        "gameClusterBootstrap95": interval,
        "chronologicalSegments": segments,
        "passes": bool(
            interval[1] < 0
            and all(value["rows"] == 0 or value["maeDelta"] <= 0 for value in segments.values())
        ),
    }


def cohort(rows: pd.DataFrame, mask: np.ndarray, offered: bool) -> dict[str, Any]:
    values = rows.loc[mask]
    report: dict[str, Any] = {
        "reference": metrics(values["actual"].to_numpy(float), values["reference_projection"].to_numpy(float)),
        "candidate": metrics(values["actual"].to_numpy(float), values["hybrid_projection"].to_numpy(float)),
        "changedProjections": int(
            (~np.isclose(values["reference_projection"], values["hybrid_projection"], atol=1e-12)).sum()
        ),
    }
    if offered:
        report["directionReference"] = direction(
            values["actual"].to_numpy(float),
            values["reference_projection"].to_numpy(float),
            values["line"].to_numpy(float),
        )
        report["directionCandidate"] = direction(
            values["actual"].to_numpy(float),
            values["hybrid_projection"].to_numpy(float),
            values["line"].to_numpy(float),
        )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, default=SOURCE)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    rows = pd.read_parquet(args.source)
    required = {
        "phase", "season", "week", "game_id", "position", "actual",
        "reference_projection", "candidate_projection",
    }
    if not required.issubset(rows.columns):
        raise RuntimeError(f"factorized source missing columns: {sorted(required - set(rows.columns))}")
    rows = rows.copy()
    use_factorized = rows["position"].isin(NON_QB)
    rows["hybrid_projection"] = np.where(
        use_factorized,
        rows["candidate_projection"].to_numpy(float),
        rows["reference_projection"].to_numpy(float),
    )
    rows["hybrid_authority"] = np.where(use_factorized, "factorized_non_qb", "released_fallback")

    phases: dict[str, Any] = {}
    for phase in ("selection", "confirmation", "locked_replay"):
        values = rows[rows["phase"].eq(phase)].copy()
        offered = phase == "locked_replay"
        non_qb = values["position"].isin(NON_QB).to_numpy()
        qb = values["position"].eq("QB").to_numpy()
        phases[phase] = {
            "all": cohort(values, np.ones(len(values), dtype=bool), offered),
            "qb": cohort(values, qb, offered),
            "nonQb": cohort(values, non_qb, offered),
            "byPosition": {
                position: cohort(values, values["position"].eq(position).to_numpy(), offered)
                for position in sorted(values["position"].dropna().unique())
            },
            "unsupportedRows": int((~(qb | non_qb)).sum()),
        }
        if phase == "confirmation":
            phases[phase]["stability"] = stability(values)

    selection = phases["selection"]
    confirmation = phases["confirmation"]
    current = phases["locked_replay"]
    qb_exact = bool(
        rows.loc[rows["position"].eq("QB"), "reference_projection"].equals(
            rows.loc[rows["position"].eq("QB"), "hybrid_projection"]
        )
    )
    historical_passes = bool(
        qb_exact
        and selection["all"]["candidate"]["mae"] < selection["all"]["reference"]["mae"]
        and selection["all"]["candidate"]["rmse"] < selection["all"]["reference"]["rmse"]
        and selection["nonQb"]["candidate"]["mae"] < selection["nonQb"]["reference"]["mae"]
        and selection["nonQb"]["candidate"]["rmse"] < selection["nonQb"]["reference"]["rmse"]
        and confirmation["all"]["candidate"]["mae"] < confirmation["all"]["reference"]["mae"]
        and confirmation["all"]["candidate"]["rmse"] < confirmation["all"]["reference"]["rmse"]
        and confirmation["nonQb"]["candidate"]["mae"] < confirmation["nonQb"]["reference"]["mae"]
        and confirmation["nonQb"]["candidate"]["rmse"] < confirmation["nonQb"]["reference"]["rmse"]
        and abs(confirmation["all"]["candidate"]["bias"])
            <= abs(confirmation["all"]["reference"]["bias"]) + 1.0
        and confirmation["stability"]["passes"]
    )
    current_passes = bool(
        historical_passes
        and current["all"]["candidate"]["mae"] < current["all"]["reference"]["mae"]
        and current["all"]["candidate"]["rmse"] < current["all"]["reference"]["rmse"]
        and current["nonQb"]["candidate"]["mae"] < current["nonQb"]["reference"]["mae"]
        and current["nonQb"]["candidate"]["rmse"] < current["nonQb"]["reference"]["rmse"]
        and current["all"]["directionCandidate"]["accuracy"]
            >= current["all"]["directionReference"]["accuracy"]
        and current["nonQb"]["directionCandidate"]["accuracy"]
            >= current["nonQb"]["directionReference"]["accuracy"]
        and current["qb"]["directionCandidate"] == current["qb"]["directionReference"]
    )

    args.rows.parent.mkdir(parents=True, exist_ok=True)
    rows.to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_rushing_yards_position_hybrid_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "candidate": {
            "QB": "exact released independent projection",
            "RB_FB_WR": "frozen 75% attempt-weighted team-factorized blend",
            "TE": "exact released independent projection until supported by the frozen artifact",
            "unsupported": "exact released independent projection",
        },
        "sourceRows": str(args.source.resolve()),
        "sourceRowsSha256": sha256(args.source),
        "phases": phases,
        "qbProjectionExact": qb_exact,
        "historicalPasses": historical_passes,
        "currentSeasonPasses": current_passes,
        "liveBoardImpact": {
            "productionWrites": 0,
            "promotions": 0,
            "demotions": 0,
            "sideChanges": 0,
            "lockedRowsMutated": 0,
        },
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "historicalPasses": historical_passes,
        "currentSeasonPasses": current_passes,
        "phases": phases,
    }, indent=2))


if __name__ == "__main__":
    main()
