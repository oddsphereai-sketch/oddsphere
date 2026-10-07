#!/usr/bin/env python3
"""Diagnose released NFL props point-head bias by offered-role proxies."""

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
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-projection-accuracy/nfl_player_props_projection_bias_r1.json"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def metrics(values: pd.DataFrame) -> dict[str, float | int]:
    error = values["prediction"].to_numpy(float) - values["actual"].to_numpy(float)
    return {
        "rows": int(len(values)),
        "actualMean": float(values["actual"].mean()),
        "predictionMean": float(values["prediction"].mean()),
        "mae": float(np.mean(np.abs(error))),
        "bias": float(np.mean(error)),
        "underpredictionRate": float(np.mean(error < 0)),
    }


def quintiles(values: pd.DataFrame, column: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    bins = pd.qcut(values[column], q=5, duplicates="drop")
    for index, (_, rows) in enumerate(values.groupby(bins, observed=True), start=1):
        output.append({
            "quintile": index,
            "minimum": float(rows[column].min()),
            "maximum": float(rows[column].max()),
            **metrics(rows),
        })
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    baseline = load_module("props_bias_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_bias_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("props_bias_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    opportunity = load_module("props_bias_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    matchup_rows, matchup_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    eligible = {market: baseline.market_eligible(frame, contract["markets"][market]) for market in MARKETS}
    rows, predictions, _ = opportunity.incumbent_predictions(
        trainer, frame, eligible, 2025, base_features, enhanced_features,
    )
    report: dict[str, Any] = {}
    for market in MARKETS:
        role_column = f"prior_{contract['markets'][market]['roleMetric']}_avg5"
        values = rows[market][["game_id", "position", role_column, market]].copy()
        values = values.rename(columns={market: "actual", role_column: "role"})
        values["prediction"] = predictions[market]
        report[market] = {
            "overall": metrics(values),
            "byRoleQuintile": quintiles(values, "role"),
            "byPredictionQuintile": quintiles(values, "prediction"),
            "byPosition": {
                str(position): metrics(part)
                for position, part in values.groupby("position", observed=True)
            },
        }
    output = {
        "release": "nfl_player_props_projection_bias_audit_2026_10_07_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "evaluationSeason": 2025,
        "modelTrainingThrough": 2024,
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "highRole": {market: values["byRoleQuintile"][-1] for market, values in report.items()},
        "highPrediction": {market: values["byPredictionQuintile"][-1] for market, values in report.items()},
    }, indent=2))


if __name__ == "__main__":
    main()
