#!/usr/bin/env python3
"""Research coherent receiving/rushing heads with the matchup feature substrate."""

from __future__ import annotations

import importlib.util
import json
import math
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error


ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = pathlib.Path(
    "football-research/cache/nfl-player-props-history/"
    "nfl_player_props_2016_2025_r1.manifest.json"
)
OUTPUT = pathlib.Path(
    "football-research/cache/nfl-player-props-matchup/"
    "nfl_player_props_matchup_joint_r1.json"
)
WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)


def module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def metrics(y: np.ndarray, p: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(y)), "mae": float(mean_absolute_error(y, p)),
        "rmse": float(math.sqrt(mean_squared_error(y, p))), "bias": float(np.mean(p - y)),
    }


def scores(y: np.ndarray, direct: np.ndarray, joint: np.ndarray) -> dict[str, dict[str, float | int]]:
    return {str(weight): metrics(y, (1 - weight) * direct + weight * joint) for weight in WEIGHTS}


def normalized(value: dict[str, float | int], reference: dict[str, float | int]) -> float:
    return float(value["mae"]) / float(reference["mae"]) + float(value["rmse"]) / float(reference["rmse"])


def main() -> None:
    baseline = module("props_baseline_full_joint", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = module("props_matchup_full_joint", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    joint = module("props_joint_full_joint", ROOT / "scripts/operator/tournament_nfl_player_props_joint_model.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(MANIFEST, contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    team_features, team_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(team_features, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    features = [*base_features, *team_names, *environment_names]
    families = {
        "qb": (
            baseline.market_eligible(frame, contract["markets"]["passing_attempts"]),
            joint.predict_qb,
            ("passing_completions", "passing_yards"),
        ),
        "receiving": (
            baseline.market_eligible(frame, contract["markets"]["receptions"]),
            joint.predict_receiving,
            ("receptions", "receiving_yards"),
        ),
        "rushing": (
            baseline.market_eligible(frame, contract["markets"]["rushing_attempts"]),
            joint.predict_rushing,
            ("rushing_yards",),
        ),
    }
    report: dict[str, Any] = {}
    for family, (eligible, predictor, markets) in families.items():
        predictions: dict[int, dict[str, np.ndarray]] = {}
        rows: dict[int, pd.DataFrame] = {}
        for season in (2023, 2024, 2025):
            train = frame[eligible & frame["season"].lt(season)]
            rows[season] = frame[eligible & frame["season"].eq(season)]
            predictions[season] = predictor(train, rows[season], features)
        market_report: dict[str, Any] = {}
        for market in markets:
            selection = scores(
                rows[2023][market].to_numpy(float),
                predictions[2023][f"{market}_direct"], predictions[2023][f"{market}_joint"],
            )
            selected = min(WEIGHTS, key=lambda weight: normalized(selection[str(weight)], selection["0.0"]))
            confirmation = scores(
                rows[2024][market].to_numpy(float),
                predictions[2024][f"{market}_direct"], predictions[2024][f"{market}_joint"],
            )
            confirmed = selected if (
                float(confirmation[str(selected)]["mae"]) <= float(confirmation["0.0"]["mae"])
                and float(confirmation[str(selected)]["rmse"]) <= float(confirmation["0.0"]["rmse"]) * 1.005
            ) else 0.0
            y = rows[2025][market].to_numpy(float)
            direct = predictions[2025][f"{market}_direct"]
            candidate = (1 - confirmed) * direct + confirmed * predictions[2025][f"{market}_joint"]
            market_report[market] = {
                "selection": selection, "selectedJointWeight": selected,
                "confirmation": confirmation, "confirmedJointWeight": confirmed,
                "holdout": {"direct": metrics(y, direct), "candidate": metrics(y, candidate)},
            }
        report[family] = market_report
    output = {
        "release": "nfl_player_props_matchup_joint_2026_09_28_r1",
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "historicalFeatureSha256": manifest["featureFileSha256"], "families": report,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"output": str(OUTPUT), "families": report}, indent=2))


if __name__ == "__main__":
    main()
