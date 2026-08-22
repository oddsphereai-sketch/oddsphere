#!/usr/bin/env python3
"""Export the accepted NFL r6 shadow models to a deterministic JSON runtime.

The production application cannot load Python/joblib artifacts. This operator
converts the frozen r2 margin residual model, r6 probability wrapper, and the
pregame state needed to evaluate current QB/roster/injury inputs into a portable
JSON artifact. It does not read or write predictions, grades, tracking, or a
database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import sys
import types
from dataclasses import dataclass
from typing import Any

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from build_nfl_player_value_features import (  # noqa: E402
    RoleState,
    add_player_key,
    adjusted_role,
    load_identity_frames,
    update_role_states,
)
from score_current_nfl_daily_edge import (  # noqa: E402
    normalize_schedule_name,
    normalize_team,
)
from build_nfl_pregame_features import (  # noqa: E402
    METRIC_PRIORS,
    QB_OFFSEASON_CARRY,
    TEAM_OFFSEASON_CARRY,
)


ARTIFACT_RELEASE = "nfl_r6_moneyline_runtime_artifact_2026_08_22_r1"
MODEL_RELEASE = "nfl_market_led_moneyline_shadow_2026_08_22_r6"
CALIBRATION_RELEASE = "nfl_market_led_price_calibration_shadow_2026_08_22_r6"
DECISION_RELEASE = "nfl_market_led_moneyline_lean_shadow_2026_08_22_r6"
SOURCE_POINT_MODEL_RELEASE = "nfl_pregame_market_residual_shadow_2026_08_21_r2"


@dataclass(frozen=True)
class _PortablePolicy:
    minimum_ev: float
    minimum_edge_pp: float
    price_band: str
    maximum_actions_per_week: int | None


# The accepted r6 joblib stores only this small frozen policy value from the
# research module. Register a compatible class so exporting does not depend on
# an unmerged research branch at runtime.
_PortablePolicy.__module__ = "tournament_nfl_market_led_baseline_v4"
_policy_module = types.ModuleType(_PortablePolicy.__module__)
_policy_module.Policy = _PortablePolicy
sys.modules.setdefault(_PortablePolicy.__module__, _policy_module)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_manifest_file(cache_root: pathlib.Path, manifest: dict[str, Any], key: str) -> pathlib.Path:
    path = pathlib.Path(str(manifest[key]))
    if path.exists():
        return path
    candidate = cache_root / "nfl-model" / path.name
    if candidate.exists():
        return candidate
    raise RuntimeError(f"manifest file is unavailable: {key}={path}")


def regressed_metric(value: float, prior: float, carry: float) -> float:
    return prior + carry * (float(value) - prior)


def team_state_after_offseason(raw: dict[str, Any]) -> dict[str, Any]:
    buckets: dict[str, dict[str, float]] = {}
    for key in ("offFast", "offSlow", "defFast", "defSlow", "offAdjusted", "defAdjusted"):
        buckets[key] = {
            metric: regressed_metric(float(raw[key][metric]), prior, TEAM_OFFSEASON_CARRY)
            for metric, prior in METRIC_PRIORS.items()
        }
    return {
        **buckets,
        "elo": 1500.0 + TEAM_OFFSEASON_CARRY * (float(raw["elo"]) - 1500.0),
        "lastQbId": raw.get("lastQbId"),
    }


def quarterback_after_offseason(raw: dict[str, Any] | None) -> dict[str, float]:
    if raw is None:
        return {
            "epa": 0.0,
            "cpoe": 0.0,
            "sackRate": METRIC_PRIORS["sack_rate"],
            "turnoverRate": METRIC_PRIORS["turnover_rate"],
            "dropbacks": 0.0,
        }
    return {
        "epa": float(raw.get("epa", 0.0)) * QB_OFFSEASON_CARRY,
        "cpoe": float(raw.get("cpoe", 0.0)) * QB_OFFSEASON_CARRY,
        "sackRate": regressed_metric(
            float(raw.get("sackRate", METRIC_PRIORS["sack_rate"])),
            METRIC_PRIORS["sack_rate"],
            QB_OFFSEASON_CARRY,
        ),
        "turnoverRate": regressed_metric(
            float(raw.get("turnoverRate", METRIC_PRIORS["turnover_rate"])),
            METRIC_PRIORS["turnover_rate"],
            QB_OFFSEASON_CARRY,
        ),
        "dropbacks": float(raw.get("dropbacks", 0.0)) * QB_OFFSEASON_CARRY,
    }


def export_trees(model: Any) -> list[list[dict[str, Any]]]:
    result: list[list[dict[str, Any]]] = []
    for iteration in model._predictors:  # noqa: SLF001 - frozen sklearn artifact export
        trees: list[dict[str, Any]] = []
        for predictor in iteration:
            nodes: list[dict[str, Any]] = []
            for node in predictor.nodes:
                if bool(node["is_categorical"]):
                    raise RuntimeError("categorical HistGradientBoosting nodes are unsupported")
                nodes.append({
                    "value": float(node["value"]),
                    "featureIndex": int(node["feature_idx"]),
                    "threshold": float(node["num_threshold"]),
                    "missingGoToLeft": bool(node["missing_go_to_left"]),
                    "left": int(node["left"]),
                    "right": int(node["right"]),
                    "isLeaf": bool(node["is_leaf"]),
                })
            trees.append({"nodes": nodes})
        result.append(trees)
    return result


def build_runtime_roles(cache_root: pathlib.Path) -> tuple[dict[str, RoleState], dict[str, str]]:
    source_manifest_path = cache_root / "nflverse/real-model-r1/manifest.json"
    manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    paths: dict[tuple[str, int], pathlib.Path] = {}
    for item in manifest["files"]:
        if item["dataset"] not in {"injuries", "snap_counts", "weekly_rosters"}:
            continue
        path = pathlib.Path(str(item["filename"]))
        if not path.exists():
            path = source_manifest_path.parent / str(item["dataset"]) / path.name
        if not path.exists() or sha256_file(path) != item["sha256"]:
            raise RuntimeError(f"source checksum mismatch: {path}")
        paths[(str(item["dataset"]), int(item["season"]))] = path
    expected = {
        (dataset, season)
        for dataset in ("injuries", "snap_counts", "weekly_rosters")
        for season in range(2016, 2026)
    }
    if set(paths) != expected:
        raise RuntimeError("NFL player-value source cache is incomplete")
    _, snaps, _, gsis_to_pfr, name_to_pfr = load_identity_frames(paths)
    snaps = add_player_key(snaps, "pfr_player_id", None, gsis_to_pfr, name_to_pfr)
    roles: dict[str, RoleState] = {}
    for (season, week), rows in snaps.groupby(["season", "week"], sort=True, observed=True):
        update_role_states(int(season), int(week), rows, roles)
    return roles, name_to_pfr


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=pathlib.Path, required=True)
    parser.add_argument("--point-artifact", type=pathlib.Path, required=True)
    parser.add_argument("--probability-artifact", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()

    cache_root = args.cache_root.resolve()
    point_path = args.point_artifact.resolve()
    probability_path = args.probability_artifact.resolve()
    output_path = args.output.resolve()

    point = joblib.load(point_path)
    probability = joblib.load(probability_path)
    if point.get("modelRelease") != SOURCE_POINT_MODEL_RELEASE:
        raise RuntimeError("point model release mismatch")
    if (
        probability.get("modelRelease") != MODEL_RELEASE
        or probability.get("calibrationRelease") != CALIBRATION_RELEASE
        or probability.get("decisionRelease") != DECISION_RELEASE
        or probability.get("sourcePointModelSha256") != sha256_file(point_path)
    ):
        raise RuntimeError("r6 model release/checksum mismatch")

    margin = point["margin"]
    margin_pipeline = margin["model"]
    imputer = margin_pipeline.named_steps["imputer"]
    tree_model = margin_pipeline.named_steps["model"]
    probability_pipeline = probability["probabilityModel"]
    scaler = probability_pipeline.named_steps["scale"]
    logistic = probability_pipeline.named_steps["model"]

    roles, name_to_pfr = build_runtime_roles(cache_root)
    state_manifest = json.loads((
        cache_root / "nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    ).read_text(encoding="utf-8"))
    state_path = resolve_manifest_file(cache_root, state_manifest, "stateFile")
    if sha256_file(state_path) != state_manifest.get("stateFileSha256"):
        raise RuntimeError("state artifact checksum mismatch")
    state = json.loads(state_path.read_text(encoding="utf-8"))

    schedule_manifest = json.loads((
        cache_root / "nflverse/games.latest.json"
    ).read_text(encoding="utf-8"))
    schedule_path = cache_root / "nflverse" / str(schedule_manifest["filename"])
    if sha256_file(schedule_path) != schedule_manifest.get("sha256"):
        raise RuntimeError("schedule cache checksum mismatch")
    schedule = pd.read_csv(schedule_path, low_memory=False)

    qb_name_to_id: dict[str, str] = {}
    for historical in schedule[schedule["season"].between(2016, 2025)].itertuples(index=False):
        for side in ("home", "away"):
            name = getattr(historical, f"{side}_qb_name")
            qb_id = getattr(historical, f"{side}_qb_id")
            if not pd.isna(name) and not pd.isna(qb_id):
                qb_name_to_id[normalize_schedule_name(name)] = str(qb_id)

    adjusted_roles: dict[str, dict[str, Any]] = {}
    for player_key, role in roles.items():
        offense, defense, matched = adjusted_role(role, 2026, 1)
        if not matched:
            continue
        adjusted_roles[str(player_key)] = {
            "offense": float(offense),
            "defense": float(defense),
            "lastTeam": normalize_team(role.last_team),
            "position": str(role.position or ""),
        }

    policy = probability["policy"]
    feature_names = list(margin["featureNames"])
    imputer_medians = np.asarray(imputer.statistics_, dtype=float)
    margin_parity_inputs = [
        imputer_medians,
        imputer_medians + np.asarray([0.05 * math.sin(index + 1) for index in range(len(imputer_medians))]),
        imputer_medians + np.asarray([0.03 * math.cos((index + 1) * 0.7) for index in range(len(imputer_medians))]),
    ]
    margin_parity = [
        {
            "features": [float(value) for value in values],
            "expected": float(margin_pipeline.predict(pd.DataFrame([values], columns=feature_names))[0]),
        }
        for values in margin_parity_inputs
    ]
    probability_parity: list[dict[str, float]] = []
    for consensus_home, projected_margin in ((0.50, 0.0), (0.60, 3.0), (0.35, -6.5)):
        probability_features = pd.DataFrame([{
            "market_logit": math.log(consensus_home / (1.0 - consensus_home)),
            "margin_edge": projected_margin / 7.0,
            "signed_sqrt_margin": math.copysign(math.sqrt(abs(projected_margin)), projected_margin) / math.sqrt(7.0)
            if projected_margin != 0 else 0.0,
        }])
        probability_parity.append({
            "consensusHome": consensus_home,
            "projectedHomeMargin": projected_margin,
            "expected": float(probability_pipeline.predict_proba(
                probability_features[list(probability["probabilityFeatures"])]
            )[0, 1]),
        })

    artifact = {
        "artifactRelease": ARTIFACT_RELEASE,
        "generatedAt": probability["generatedAt"],
        "shadowOnly": True,
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "sourcePointModelRelease": SOURCE_POINT_MODEL_RELEASE,
        "sourceChecksums": {
            "pointModelSha256": sha256_file(point_path),
            "probabilityModelSha256": sha256_file(probability_path),
            "stateSha256": sha256_file(state_path),
            "scheduleSha256": sha256_file(schedule_path),
        },
        "policy": {
            "minimumExpectedValue": float(policy.minimum_ev),
            "minimumEdgePercentagePoints": float(policy.minimum_edge_pp),
            "minimumAmericanPrice": -300,
            "maximumAmericanPrice": 300,
            "maximumActionsPerWeek": None,
            "bestAngleAuthorized": False,
        },
        "marginModel": {
            "featureNames": feature_names,
            "imputerMedians": [float(value) for value in imputer_medians],
            "baseline": float(tree_model._baseline_prediction[0][0]),  # noqa: SLF001
            "trees": export_trees(tree_model),
            "weight": float(margin["candidate"]["weight"]),
            "correctionCap": 6.0,
        },
        "probabilityModel": {
            "featureNames": list(probability["probabilityFeatures"]),
            "means": [float(value) for value in scaler.mean_],
            "scales": [float(value) for value in scaler.scale_],
            "coefficients": [float(value) for value in logistic.coef_[0]],
            "intercept": float(logistic.intercept_[0]),
        },
        "teamStates": {
            normalize_team(team): team_state_after_offseason(values)
            for team, values in state["teamStates"].items()
        },
        "quarterbackStates": {
            str(qb_id): quarterback_after_offseason(values)
            for qb_id, values in state["quarterbackStates"].items()
        },
        "quarterbackNameToId": qb_name_to_id,
        "playerNameToPfr": {str(name): str(pfr) for name, pfr in name_to_pfr.items()},
        "adjustedPlayerRoles2026Week1": adjusted_roles,
        "parityCases": {
            "margin": margin_parity,
            "probability": probability_parity,
        },
    }

    if len(artifact["teamStates"]) != 32:
        raise RuntimeError("runtime artifact must contain all 32 NFL team states")
    if len(artifact["marginModel"]["featureNames"]) != len(artifact["marginModel"]["imputerMedians"]):
        raise RuntimeError("margin feature/imputer length mismatch")
    if not all(math.isfinite(value) for value in artifact["marginModel"]["imputerMedians"]):
        raise RuntimeError("margin imputer contains a non-finite value")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(artifact, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "artifactRelease": ARTIFACT_RELEASE,
        "output": str(output_path),
        "sha256": sha256_file(output_path),
        "teams": len(artifact["teamStates"]),
        "quarterbacks": len(artifact["quarterbackStates"]),
        "playerRoles": len(adjusted_roles),
        "trees": len(artifact["marginModel"]["trees"]),
    }, indent=2))


if __name__ == "__main__":
    main()
