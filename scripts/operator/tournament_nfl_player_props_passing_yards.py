#!/usr/bin/env python3
"""Chronological independent Passing Yards point-head tournament."""

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


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.manifest.json"
FOUNDATION_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
COMPLETION_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_completions_rows_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
RUNTIME_PASSING_ATTEMPTS = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeMarketPassingAttempts.json"
RUNTIME_PASSING_COMPLETIONS = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeMarketPassingCompletions.json"
RUNTIME_JOINT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeJoint.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_yards_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_yards_rows_r1.parquet"
FEATURE_FAMILIES = ("state", "state_pressure", "state_ftn", "state_ngs", "full_external")
BLEND_WEIGHTS = (0.50, 0.75, 1.0)
LOSSES = ("squared_error", "absolute_error")


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = np.asarray(prediction, dtype=float) - np.asarray(actual, dtype=float)
    return {
        "rows": int(len(error)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
        "underpredictionRate": float(np.mean(error < 0)),
    }


def portable_hgb_predict(model: dict[str, Any], rows: pd.DataFrame) -> np.ndarray:
    """Score the frozen JSON HGB format used by the production runtime."""
    if model.get("kind") != "hgb_regressor":
        raise RuntimeError(f"expected hgb_regressor, received {model.get('kind')}")
    inputs = rows.reindex(columns=model["featureNames"]).to_numpy(float)
    prediction = np.full(len(rows), float(model["baseline"]), dtype=float)
    for iteration in model["trees"]:
        for tree in iteration:
            nodes = tree["nodes"]
            for row_index, values in enumerate(inputs):
                node_index = 0
                while True:
                    node = nodes[node_index]
                    if node["isLeaf"]:
                        prediction[row_index] += float(node["value"])
                        break
                    value = values[int(node["featureIndex"])]
                    if not np.isfinite(value):
                        node_index = int(node["left"] if node["missingGoToLeft"] else node["right"])
                    else:
                        node_index = int(node["left"] if value <= float(node["threshold"]) else node["right"])
    if model.get("link") == "exponential":
        prediction = np.exp(prediction)
    return prediction


def foundation_passing_completions(rows: pd.DataFrame) -> np.ndarray:
    """Reproduce the preceding portable runtime's joint completion projection."""
    attempts_artifact = json.loads(RUNTIME_PASSING_ATTEMPTS.read_text(encoding="utf-8"))
    completions_artifact = json.loads(RUNTIME_PASSING_COMPLETIONS.read_text(encoding="utf-8"))
    joint = json.loads(RUNTIME_JOINT.read_text(encoding="utf-8"))["passingCompletions"]
    attempts = portable_hgb_predict(attempts_artifact["model"], rows)
    direct = portable_hgb_predict(completions_artifact["model"], rows)
    rate_logit = portable_hgb_predict(joint["completionRateModel"], rows)
    rate = 1.0 / (1.0 + np.exp(-rate_logit))
    return np.minimum(attempts, np.maximum(
        0.0, float(joint["jointWeight"]) * attempts * rate + float(joint["directWeight"]) * direct,
    ))


def confirmation_stability(
    rows: pd.DataFrame, actual: np.ndarray, reference: np.ndarray, candidate: np.ndarray,
) -> dict[str, Any]:
    values = rows[["game_id", "week"]].copy()
    values["reference_abs"] = np.abs(reference - actual)
    values["candidate_abs"] = np.abs(candidate - actual)
    values["delta"] = values["candidate_abs"] - values["reference_abs"]
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    rng = np.random.default_rng(20261008)
    bootstrap: list[float] = []
    for _ in range(20):
        indexes = rng.integers(0, len(grouped), size=(500, len(grouped)))
        sample = grouped[indexes]
        bootstrap.extend((sample[:, :, 0].sum(axis=1) / sample[:, :, 1].sum(axis=1)).tolist())
    segments: dict[str, dict[str, float | int]] = {}
    for name, lower, upper in (
        ("weeks_1_4", 1, 4), ("weeks_5_9", 5, 9),
        ("weeks_10_13", 10, 13), ("weeks_14_18", 14, 18),
    ):
        segment = values[values["week"].between(lower, upper)]
        segments[name] = {
            "rows": int(len(segment)),
            "referenceMae": float(segment["reference_abs"].mean()),
            "candidateMae": float(segment["candidate_abs"].mean()),
            "maeDelta": float(segment["delta"].mean()),
        }
    return {
        "games": int(len(grouped)),
        "maeDelta": float(values["delta"].mean()),
        "gameClusterBootstrap95": [
            float(np.quantile(bootstrap, 0.025)), float(np.quantile(bootstrap, 0.975)),
        ],
        "chronologicalSegments": segments,
    }


def independent_passing_inputs(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    team_features: list[str],
    passing_features: list[str],
    completion_features: list[str],
    test: pd.DataFrame,
    foundation_completions: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Rebuild the released market-free pass-volume/completion components."""
    leaders = foundation.lead_passer_rows(frame)
    training = leaders[leaders["season"].lt(season) & leaders["passing_attempts"].gt(0)].copy()
    team_attempts = teams.set_index(["season", "game_id", "team"])["team_pass_attempts"]
    keys = pd.MultiIndex.from_frame(training[["season", "game_id", "team"]])
    training["lead_pass_share"] = (
        training["passing_attempts"].to_numpy(float) / team_attempts.reindex(keys).to_numpy(float)
    )
    share_model = foundation.model("squared_error").fit(
        training[passing_features], training["lead_pass_share"].clip(0.50, 1.0),
    )
    share = np.clip(np.asarray(share_model.predict(test[passing_features]), dtype=float), 0.50, 1.0)
    budget = foundation.budget_prediction(
        teams, season, team_features, "team_pass_attempts", test[["game_id", "team"]],
    )
    attempts = np.clip(budget * share, 0.0, None)
    completion_share_model = foundation.model("squared_error").fit(
        training[completion_features], training["lead_pass_share"].clip(0.50, 1.0),
    )
    completion_share = np.clip(
        np.asarray(completion_share_model.predict(test[completion_features]), dtype=float), 0.50, 1.0,
    )
    completion_train = training[training["passing_attempts"].ge(5)].copy()
    completion_rate = (
        completion_train["passing_completions"] / completion_train["passing_attempts"]
    ).clip(0.30, 0.85)
    completion_model = foundation.model("squared_error").fit(
        completion_train[completion_features], completion_rate.to_numpy(float),
        sample_weight=completion_train["passing_attempts"].to_numpy(float),
    )
    predicted_rate = np.clip(
        np.asarray(completion_model.predict(test[completion_features]), dtype=float), 0.30, 0.85,
    )
    completion_component = budget * completion_share * predicted_rate
    completions = 0.25 * foundation_completions + 0.75 * completion_component
    return attempts, np.minimum(attempts, np.maximum(0.0, completions))


def yardage_components(
    foundation: Any,
    frame: pd.DataFrame,
    season: int,
    features: list[str],
    test: pd.DataFrame,
    attempts: np.ndarray,
    completions: np.ndarray,
) -> dict[str, np.ndarray]:
    leaders = foundation.lead_passer_rows(frame)
    train = leaders[
        leaders["season"].lt(season)
        & leaders["participated"].eq(1)
        & leaders["passing_attempts"].ge(5)
        & leaders["passing_completions"].ge(1)
    ].copy()
    ypa = (train["passing_yards"] / train["passing_attempts"]).clip(2.0, 14.0)
    ypc = (train["passing_yards"] / train["passing_completions"]).clip(4.0, 24.0)
    result: dict[str, np.ndarray] = {}
    for loss in LOSSES:
        for weighted in (False, True):
            suffix = "exposure_weighted" if weighted else "game_weighted"
            ypa_model = foundation.model(loss).fit(
                train[features], ypa.to_numpy(float),
                sample_weight=train["passing_attempts"].to_numpy(float) if weighted else None,
            )
            ypc_model = foundation.model(loss).fit(
                train[features], ypc.to_numpy(float),
                sample_weight=train["passing_completions"].to_numpy(float) if weighted else None,
            )
            predicted_ypa = np.clip(np.asarray(ypa_model.predict(test[features]), dtype=float), 2.0, 14.0)
            predicted_ypc = np.clip(np.asarray(ypc_model.predict(test[features]), dtype=float), 4.0, 24.0)
            by_attempt = attempts * predicted_ypa
            by_completion = completions * predicted_ypc
            result[f"ypa_{loss}_{suffix}"] = by_attempt
            result[f"ypc_{loss}_{suffix}"] = by_completion
            result[f"hybrid_{loss}_{suffix}"] = 0.50 * by_attempt + 0.50 * by_completion
    return result


def indexed_projection(source: pd.DataFrame, market: str, phase: str, column: str, rows: pd.DataFrame) -> np.ndarray:
    values = source[source["market"].eq(market) & source["phase"].eq(phase)].set_index("row_id")
    if not rows["row_id"].isin(values.index).all():
        raise RuntimeError(f"missing {market} {phase} input rows")
    return values.loc[rows["row_id"], column].to_numpy(float)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path, default=EXTERNAL_MANIFEST)
    parser.add_argument("--foundation-projections", type=pathlib.Path, default=FOUNDATION_PROJECTIONS)
    parser.add_argument("--completion-rows", type=pathlib.Path, default=COMPLETION_ROWS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--injury-root", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    foundation = load("py_foundation", ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py")
    availability = load("py_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py")
    external = load("py_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py")
    manifest = json.loads(args.external_manifest.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, _, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), args.injury_root or foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position.lower()}"
        frame[column] = frame["position"].eq(position).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    family_features = {
        family: list(dict.fromkeys([
            *external.relevant_features("passing_yards", groups)[family],
            *groups.get("depth", []), *availability_groups["combined"],
        ]))
        for family in FEATURE_FAMILIES
    }
    family_features = {
        family: [name for name in values if name in frame.columns]
        for family, values in family_features.items()
    }
    passing_features = list(dict.fromkeys([
        *external.relevant_features("passing_yards", groups)["full_external"],
        *external.relevant_features("rushing_yards", groups)["full_external"],
        *external.relevant_features("receiving_yards", groups)["full_external"],
        *groups.get("depth", []), *availability_groups["combined"],
    ]))
    passing_features = [name for name in passing_features if name in frame.columns]
    completion_features = list(dict.fromkeys([
        *external.relevant_features("passing_completions", groups)["full_external"],
        *groups.get("depth", []), *availability_groups["combined"],
    ]))
    completion_features = [name for name in completion_features if name in frame.columns]
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    numeric = list(dict.fromkeys([
        *team_features, *passing_features, *completion_features,
        *(x for values in family_features.values() for x in values),
    ]))
    frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)
    prior = pd.read_parquet(args.foundation_projections)
    completion_rows = pd.read_parquet(args.completion_rows)
    yard_rows = prior[
        prior["market"].eq("passing_yards") & prior["phase"].isin(["selection", "confirmation"])
    ].copy()

    candidates: dict[str, dict[int, np.ndarray]] = {}
    rows_by_season: dict[int, pd.DataFrame] = {}
    reference: dict[int, np.ndarray] = {}
    actual: dict[int, np.ndarray] = {}
    output_rows: list[pd.DataFrame] = []
    for season in (2024, 2025):
        print(f"passing-yards season {season}...", flush=True)
        phase = "selection" if season == 2024 else "confirmation"
        source = yard_rows[yard_rows["phase"].eq(phase)].copy()
        test = by_row.loc[source["row_id"]].copy()
        rows_by_season[season] = test
        reference[season] = source["released_projection"].to_numpy(float)
        actual[season] = source["actual"].to_numpy(float)
        attempts = indexed_projection(prior, "passing_attempts", phase, "candidate_projection", source)
        completion_index = completion_rows[completion_rows["phase"].eq(phase)].set_index("row_id")
        if not source["row_id"].isin(completion_index.index).all():
            raise RuntimeError(f"missing Passing Completions {phase} input rows")
        completions = completion_index.loc[source["row_id"], "candidate_projection"].to_numpy(float)
        for family, features in family_features.items():
            components = yardage_components(
                foundation, frame, season, features, test, attempts, completions,
            )
            for mode, component in components.items():
                for weight in BLEND_WEIGHTS:
                    name = f"{family}__{mode}__blend_{int(weight * 100)}"
                    candidates.setdefault(name, {})[season] = np.clip(
                        (1.0 - weight) * reference[season] + weight * component, 0.0, None,
                    )

    reference_2024 = metrics(actual[2024], reference[2024])
    selection = {name: metrics(actual[2024], values[2024]) for name, values in candidates.items()}
    eligible = [
        name for name, value in selection.items()
        if value["mae"] < reference_2024["mae"] and value["rmse"] < reference_2024["rmse"]
    ]
    reference_2025 = metrics(actual[2025], reference[2025])
    confirmation = {name: metrics(actual[2025], candidates[name][2025]) for name in eligible}
    historically_eligible = [
        name for name in eligible
        if confirmation[name]["mae"] <= reference_2025["mae"]
        and confirmation[name]["rmse"] <= reference_2025["rmse"]
    ]
    ranked_historical = sorted(historically_eligible, key=lambda name: (
        selection[name]["mae"] / reference_2024["mae"]
        + selection[name]["rmse"] / reference_2024["rmse"]
        + abs(selection[name]["bias"]) / max(float(np.mean(actual[2024])), 1.0)
    ))
    historical_champion = ranked_historical[0] if ranked_historical else None

    replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("passing_yards")].copy()
    replay["normalized_player"] = replay["playerName"].map(foundation.normalize_player)
    current = frame[frame["season"].eq(2026)].copy()
    current["normalized_player"] = current["player_name"].map(foundation.normalize_player)
    offered = replay.merge(
        current, on=["week", "team", "normalized_player"], how="left", validate="many_to_one",
        suffixes=("_locked", ""),
    )
    if offered["row_id"].isna().any():
        raise RuntimeError("unmatched 2026 Passing Yards replay rows")
    locked_reference = offered["independentProjection"].to_numpy(float)
    locked_actual = offered["actual"].to_numpy(float)
    locked_lines = offered["line"].to_numpy(float)
    locked_reference_metrics = metrics(locked_actual, locked_reference)
    direction_reference = float(np.mean(
        np.sign(locked_reference - locked_lines) == np.sign(locked_actual - locked_lines)
    ))
    attempts, completions = independent_passing_inputs(
        foundation, frame, teams, 2026, team_features, passing_features, completion_features,
        offered, foundation_passing_completions(offered),
    )
    current_components = {
        family: yardage_components(
            foundation, frame, 2026, features, offered, attempts, completions,
        )
        for family, features in family_features.items()
    }
    current_replay: dict[str, dict[str, Any]] = {}
    current_predictions: dict[str, np.ndarray] = {}
    for name in ranked_historical:
        family, mode, blend_name = name.split("__")
        weight = int(blend_name.removeprefix("blend_")) / 100.0
        prediction = np.clip(
            (1.0 - weight) * locked_reference + weight * current_components[family][mode], 0.0, None,
        )
        candidate_metrics = metrics(locked_actual, prediction)
        direction = float(np.mean(
            np.sign(prediction - locked_lines) == np.sign(locked_actual - locked_lines)
        ))
        passes = bool(
            candidate_metrics["mae"] <= locked_reference_metrics["mae"]
            and candidate_metrics["rmse"] <= locked_reference_metrics["rmse"]
            and direction >= direction_reference
        )
        current_replay[name] = {
            "metrics": candidate_metrics, "direction": direction, "passes": passes,
        }
        current_predictions[name] = prediction
    frozen = next((name for name in ranked_historical if current_replay[name]["passes"]), None)
    selected = frozen
    candidate_2025 = confirmation[frozen] if frozen else None
    confirmed = frozen is not None
    candidate = current_predictions[frozen] if frozen else locked_reference.copy()
    for season in (2024, 2025):
        values = rows_by_season[season][[
            "row_id", "season", "week", "game_id", "team", "opponent",
            "player_id", "player_name", "position", "passing_yards",
        ]].copy().rename(columns={"passing_yards": "actual"})
        values["phase"] = "selection" if season == 2024 else "confirmation"
        values["reference_projection"] = reference[season]
        values["candidate_projection"] = candidates[frozen][season] if frozen else reference[season]
        output_rows.append(values)
    offered_rows = offered[[
        "row_id", "season", "week", "game_id", "team", "opponent",
        "player_id", "player_name", "position", "actual", "line", "side",
    ]].copy()
    offered_rows["phase"] = "locked_replay"
    offered_rows["reference_projection"] = locked_reference
    offered_rows["candidate_projection"] = candidate
    output_rows.append(offered_rows)

    result_rows = pd.concat(output_rows, ignore_index=True)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)
    report = {
        "release": "nfl_player_props_passing_yards_tournament_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True, "marketIndependent": True, "marketFeatures": [],
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025, "diagnostic": "2026 Weeks 1-4 opened"},
        "selection": {
            "reference": reference_2024, "candidates": selection, "historicalChampion": historical_champion,
            "selected": selected,
        },
        "confirmation": {"reference": reference_2025, "candidate": candidate_2025, "confirmed": confirmed},
        "confirmationStability": confirmation_stability(
            rows_by_season[2025], actual[2025], reference[2025], candidates[frozen][2025],
        ) if frozen else None,
        "frozenCandidate": frozen,
        "historicallyEligibleRanking": ranked_historical,
        "historicallyEligibleReplay": current_replay,
        "locked2026": {
            "reference": locked_reference_metrics,
            "candidate": metrics(locked_actual, candidate),
            "directionReference": direction_reference,
            "directionCandidate": float(np.mean(
                np.sign(candidate - offered_rows["line"].to_numpy(float))
                == np.sign(offered_rows["actual"].to_numpy(float) - offered_rows["line"].to_numpy(float))
            )),
        },
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": foundation.sha256_file(args.rows),
    }
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "selected": selected, "confirmed": confirmed,
        "confirmation": report["confirmation"], "locked2026": report["locked2026"],
    }, indent=2))


if __name__ == "__main__":
    main()
