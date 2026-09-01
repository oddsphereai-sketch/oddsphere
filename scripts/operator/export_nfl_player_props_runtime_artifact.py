#!/usr/bin/env python3
"""Export frozen NFL player-props models and pre-2026 state to portable JSON."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.pipeline import Pipeline


RUNTIME_RELEASE = "nfl_player_props_runtime_2026_09_01_r4_cross_market_movement"
MARKET_RESIDUAL_RELEASE = "nfl_player_props_market_residual_calibration_2026_09_01_r5_cross_market_movement"
SCORER_PATH = pathlib.Path("lib/services/football/nfl_player_props_shadow_model.py")
FEATURE_BUILDER_PATH = pathlib.Path("scripts/operator/build_nfl_player_props_2026_features.py")
VOLUME_ARTIFACT = pathlib.Path("football-research/cache/nfl-player-props-calibration/nfl_player_props_distribution_shadow_2026_08_25_r2.joblib")
MARKET_REPORT = pathlib.Path("football-research/cache/nfl-player-props-market-residual/nfl_player_props_market_residual_r1.json")
DECISION_CONTRACT = pathlib.Path("lib/services/football/nflPlayerPropsDecisionContract.json")
MARKET_RESIDUAL_CONTRACT = pathlib.Path("lib/services/football/nflPlayerPropsMarketResidualContract.json")
EXISTING_RUNTIME = pathlib.Path("lib/services/football/modelArtifacts/nflPlayerPropsRuntime.json")


def shard_path(output: pathlib.Path, suffix: str) -> pathlib.Path:
    return output.with_name(f"{output.stem}{suffix}.json")


def read_existing_runtime() -> dict[str, Any]:
    core = json.loads(EXISTING_RUNTIME.read_text(encoding="utf-8"))
    if "markets" in core:
        return core
    markets = {
        market: json.loads(shard_path(EXISTING_RUNTIME, f"Market{''.join(part.title() for part in market.split('_'))}").read_text(encoding="utf-8"))
        for market in ("passing_attempts", "passing_completions", "passing_yards", "rushing_attempts", "rushing_yards", "receptions", "receiving_yards")
    }
    player_states: dict[str, Any] = {}
    for bucket in range(4):
        player_states.update(json.loads(shard_path(EXISTING_RUNTIME, f"Players{bucket}").read_text(encoding="utf-8")))
    return {
        **core,
        "markets": markets,
        "touchdown": json.loads(shard_path(EXISTING_RUNTIME, "Touchdown").read_text(encoding="utf-8")),
        "playerStates": player_states,
    }


def write_runtime_shards(output: pathlib.Path, payload: dict[str, Any]) -> int:
    core = {key: value for key, value in payload.items() if key not in {"markets", "touchdown", "playerStates"}}
    output.write_text(json.dumps(core, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    for market, value in payload["markets"].items():
        suffix = f"Market{''.join(part.title() for part in market.split('_'))}"
        shard_path(output, suffix).write_text(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    shard_path(output, "Touchdown").write_text(json.dumps(payload["touchdown"], separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    player_buckets: list[dict[str, Any]] = [{}, {}, {}, {}]
    for name, value in payload["playerStates"].items():
        player_buckets[ord(name[0]) % len(player_buckets)][name] = value
    for index, bucket in enumerate(player_buckets):
        shard_path(output, f"Players{index}").write_text(json.dumps(bucket, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    paths = [output, shard_path(output, "Touchdown")]
    paths.extend(shard_path(output, f"Market{''.join(part.title() for part in market.split('_'))}") for market in payload["markets"])
    paths.extend(shard_path(output, f"Players{index}") for index in range(len(player_buckets)))
    return sum(path.stat().st_size for path in paths)


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_trees(model: HistGradientBoostingClassifier | HistGradientBoostingRegressor) -> list[list[dict[str, Any]]]:
    result: list[list[dict[str, Any]]] = []
    for iteration in model._predictors:  # noqa: SLF001 - frozen sklearn export
        trees: list[dict[str, Any]] = []
        for predictor in iteration:
            nodes: list[dict[str, Any]] = []
            for node in predictor.nodes:
                if bool(node["is_categorical"]):
                    raise RuntimeError("categorical HGB nodes are unsupported")
                threshold = float(node["num_threshold"])
                nodes.append({
                    "value": float(node["value"]),
                    "featureIndex": int(node["feature_idx"]),
                    "threshold": threshold if np.isfinite(threshold) else (1e308 if threshold > 0 else -1e308),
                    "missingGoToLeft": bool(node["missing_go_to_left"]),
                    "left": int(node["left"]),
                    "right": int(node["right"]),
                    "isLeaf": bool(node["is_leaf"]),
                })
            trees.append({"nodes": nodes})
        result.append(trees)
    return result


def export_model(model: Any, feature_names: list[str], *, classifier: bool = False) -> dict[str, Any]:
    if isinstance(model, (HistGradientBoostingClassifier, HistGradientBoostingRegressor)):
        return {
            "kind": "hgb_classifier" if classifier else "hgb_regressor",
            "featureNames": feature_names,
            "baseline": float(np.ravel(model._baseline_prediction)[0]),  # noqa: SLF001
            "trees": export_trees(model),
        }
    if isinstance(model, Pipeline):
        imputer = next(value for value in model.named_steps.values() if hasattr(value, "statistics_"))
        scaler = next(value for value in model.named_steps.values() if hasattr(value, "scale_") and hasattr(value, "mean_"))
        linear = next(value for value in model.named_steps.values() if hasattr(value, "coef_") and hasattr(value, "intercept_"))
        return {
            "kind": "linear_regressor",
            "featureNames": feature_names,
            "imputer": [float(value) for value in imputer.statistics_],
            "means": [float(value) for value in scaler.mean_],
            "scales": [float(value) for value in scaler.scale_],
            "coefficients": [float(value) for value in np.ravel(linear.coef_)],
            "intercept": float(np.ravel(np.asarray(linear.intercept_))[0]),
        }
    raise RuntimeError(f"unsupported portable model: {type(model)}")


def clean_record(values: dict[str, Any]) -> dict[str, float | str | None]:
    result: dict[str, float | str | None] = {}
    for key, value in values.items():
        if isinstance(value, (str, np.str_)):
            result[key] = str(value)
        elif value is None or bool(pd.isna(value)):
            result[key] = None
        elif isinstance(value, (int, float, np.integer, np.floating)):
            result[key] = float(value)
    return result


def portable_distribution(value: dict[str, Any]) -> dict[str, Any]:
    """Remove redundant percentile grids; the scorer only needs sorted residuals."""
    result = {key: item for key, item in value.items() if key != "probabilities"}
    if "fallback" in result:
        result["fallback"] = portable_distribution(result["fallback"])
    if "buckets" in result:
        result["buckets"] = [
            {**bucket, "distribution": portable_distribution(bucket["distribution"])}
            for bucket in result["buckets"]
        ]
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history-manifest", type=pathlib.Path, required=True)
    parser.add_argument("--parity-features", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()

    scorer = load_module("nfl_props_runtime_export_scorer", SCORER_PATH)
    builder = load_module("nfl_props_runtime_export_features", FEATURE_BUILDER_PATH)
    manifest = json.loads(args.history_manifest.read_text(encoding="utf-8"))
    history_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(history_path) != manifest["featureFileSha256"]:
        raise RuntimeError("NFL props runtime history checksum mismatch")
    history = pd.read_parquet(history_path)
    history = builder.load_touchdown_history(history)
    existing = read_existing_runtime()
    current_feature_names = (
        set(pd.read_parquet(args.parity_features, columns=["player_name"])["player_name"].astype(str).map(builder.normalized_name))
        if args.parity_features
        else set(existing["playerStates"])
    )
    volume = joblib.load(VOLUME_ARTIFACT)
    market_report = json.loads(MARKET_REPORT.read_text(encoding="utf-8"))
    decision = json.loads(DECISION_CONTRACT.read_text(encoding="utf-8"))
    market_residual_contract = json.loads(MARKET_RESIDUAL_CONTRACT.read_text(encoding="utf-8"))

    player_states: dict[str, Any] = {}
    ambiguous_names: list[str] = []
    keyed = history.assign(_name=history["player_name"].astype(str).map(builder.normalized_name))
    for name, rows in keyed.groupby("_name", observed=True):
        if int(rows["player_id"].nunique()) != 1:
            ambiguous_names.append(str(name))
            continue
        latest = rows.sort_values(["season", "week", "game_id"]).iloc[-1]
        # A production scorer only needs players active in the immediately
        # preceding season. New/returning players fail closed to a role hold.
        if int(latest["season"]) != 2025 and str(name) not in current_feature_names:
            continue
        player_states[str(name)] = clean_record({
            "playerId": str(latest["player_id"]),
            "lastTeam": builder.normalize_team(str(latest["team"])),
            **builder.player_features(rows),
            **builder.touchdown_features(rows),
        })

    team_games = builder.team_game_outcomes(history)
    teams = sorted(set(team_games["team"].astype(str).map(builder.normalize_team)))
    team_states: dict[str, Any] = {}
    opponent_states: dict[str, Any] = {}
    for team in teams:
        other = next(value for value in teams if value != team)
        combined = clean_record(builder.rolling_team_features(team_games, team, other))
        team_states[team] = {key: value for key, value in combined.items() if key.startswith("prior_team_")}
        reverse = clean_record(builder.rolling_team_features(team_games, other, team))
        opponent_states[team] = {key: value for key, value in reverse.items() if key.startswith("prior_opponent_")}

    feature_names = list(volume["featureColumns"])
    markets: dict[str, Any] = {}
    for market, value in volume["markets"].items():
        markets[market] = {
            "model": export_model(value["model"], feature_names),
            "distribution": portable_distribution(value["distribution"]),
            "baselineColumn": value["baselineColumn"],
            "eligibility": value["eligibility"],
            "marketResidualWeight": float(market_report["selectedWeights"][market]),
            "marketResidualQualified": bool(market_report["qualifiedMarkets"][market]),
            "promotionPolicy": market_residual_contract["promotionPolicy"][market],
        }
    participation = volume["participationModel"]
    parity_frame = pd.DataFrame([row["inputs"] for row in existing["parity"][:4]])
    volume_parity = scorer.score_shadow_rows(volume, parity_frame)
    parity: list[dict[str, Any]] = []
    for index, (_, row) in enumerate(parity_frame.iterrows()):
        inputs = {name: (None if pd.isna(row[name]) else float(row[name])) for name in row.index}
        parity.append({
            "inputs": inputs,
            "participationProbability": float(volume_parity.iloc[index]["participation_probability"]),
            "projections": {market: float(volume_parity.iloc[index][f"{market}_projection"]) for market in markets},
            "touchdownProbability": float(existing["parity"][index]["touchdownProbability"]),
        })

    output = {
        "runtimeRelease": RUNTIME_RELEASE,
        "modelRelease": decision["modelRelease"],
        "calibrationRelease": decision["calibrationRelease"],
        "touchdownModelRelease": decision["touchdownModelRelease"],
        "touchdownCalibrationRelease": decision["touchdownCalibrationRelease"],
        "decisionRelease": decision["decisionRelease"],
        "marketResidualRelease": MARKET_RESIDUAL_RELEASE,
        "sourceChecksums": {
            "history": manifest["featureFileSha256"],
            "volumeArtifact": sha256_file(VOLUME_ARTIFACT),
            "touchdownArtifact": existing["sourceChecksums"]["touchdownArtifact"],
            "marketReport": sha256_file(MARKET_REPORT),
            "touchdownReport": existing["sourceChecksums"]["touchdownReport"],
            "sourceVolumeModelRelease": volume["shadowModelRelease"],
            "sourceVolumeCalibrationRelease": volume["calibrationRelease"],
            "sourceTouchdownModelRelease": existing["sourceChecksums"]["sourceTouchdownModelRelease"],
            "sourceTouchdownCalibrationRelease": existing["sourceChecksums"]["sourceTouchdownCalibrationRelease"],
            "sourceMarketResidualRelease": market_report["marketResidualRelease"],
        },
        "featureNames": feature_names,
        "participationModel": export_model(participation["model"], feature_names, classifier=True),
        "markets": markets,
        "touchdown": existing["touchdown"],
        "decision": decision,
        "playerStates": player_states,
        "ambiguousPlayerNames": sorted(ambiguous_names),
        "teamStates": team_states,
        "opponentStates": opponent_states,
        "parity": parity,
        "trainingThrough": int(volume["trainingThrough"]),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    total_bytes = write_runtime_shards(args.output, output)
    print(json.dumps({
        "output": str(args.output),
        "sha256": sha256_file(args.output),
        "runtimeRelease": RUNTIME_RELEASE,
        "players": len(player_states),
        "ambiguousPlayers": len(ambiguous_names),
        "teams": len(team_states),
        "bytes": total_bytes,
    }, indent=2))


if __name__ == "__main__":
    main()
