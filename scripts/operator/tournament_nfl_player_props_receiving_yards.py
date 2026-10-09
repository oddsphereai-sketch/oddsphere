#!/usr/bin/env python3
"""Release-gated independent Receiving Yards point-head tournament."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
FOUNDATION_SCRIPT = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
FOUNDATION_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_yards_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_yards_rows_r1.parquet"
WEIGHTS = (0.50, 0.75, 1.0)
MODES = ("direct", "exposure_weighted", "decomposed")
BLOCKS = ((1, 4), (5, 9), (10, 13), (14, 18))


def load(name: str, path: pathlib.Path) -> Any:
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


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


def candidate_identity(name: str) -> tuple[str, float, bool]:
    role_only = name.startswith("wr_")
    normalized = name[3:] if role_only else name
    mode, _, weight_text = normalized.rpartition("_blend_")
    return mode, int(weight_text) / 100.0, role_only


def candidate_projection(
    reference: np.ndarray,
    component: np.ndarray,
    positions: np.ndarray,
    name: str,
) -> np.ndarray:
    _, weight, role_only = candidate_identity(name)
    blended = np.clip((1.0 - weight) * reference + weight * component, 0.0, None)
    return np.where(positions == "WR", blended, reference) if role_only else blended


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


def receiving_components(
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
    opportunity = np.clip(budget * share, 0.0, None)
    outputs = {mode: np.zeros(len(test), dtype=float) for mode in MODES}
    for group in sorted(test["expected_role_group"].unique()):
        mask = test["expected_role_group"].eq(group).to_numpy()
        subset = test.loc[mask]
        direct = foundation.rate_prediction(
            frame, season, player_features, "receiving_yards", "targets",
            group, subset, 0.0, 30.0, False,
        )
        weighted = foundation.rate_prediction(
            frame, season, player_features, "receiving_yards", "targets",
            group, subset, 0.0, 30.0, True,
        )
        catch_rate = foundation.rate_prediction(
            frame, season, player_features, "receptions", "targets",
            group, subset, 0.0, 1.0, True,
        )
        yards_per_reception = foundation.rate_prediction(
            frame, season, player_features, "receiving_yards", "receptions",
            group, subset, 0.0, 40.0, True,
        )
        outputs["direct"][mask] = opportunity[mask] * direct
        outputs["exposure_weighted"][mask] = opportunity[mask] * weighted
        outputs["decomposed"][mask] = opportunity[mask] * catch_rate * yards_per_reception
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation-projections", type=pathlib.Path, default=FOUNDATION_PROJECTIONS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    foundation = load("props_receiving_yards_foundation", FOUNDATION_SCRIPT)
    external = foundation.load_module(
        "props_receiving_yards_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    availability = foundation.load_module(
        "props_receiving_yards_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py",
    )
    manifest = json.loads(foundation.DEFAULT_EXTERNAL_MANIFEST.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    feature_groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        feature_groups["base"].append(column)
    feature_groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("receiving_yards", feature_groups)["full_external"],
        *feature_groups.get("depth", []),
        *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [
        name for name in [*feature_groups["base"], *feature_groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    frame[list(dict.fromkeys([*player_features, *team_features]))] = frame[
        list(dict.fromkeys([*player_features, *team_features]))
    ].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)

    source = pd.read_parquet(args.foundation_projections)
    source = source[source["market"].eq("receiving_yards")].copy()
    historical = source[source["phase"].isin(["selection", "confirmation"])].copy()
    actual: dict[int, np.ndarray] = {}
    reference: dict[int, np.ndarray] = {}
    rows_by_season: dict[int, pd.DataFrame] = {}
    components: dict[str, dict[int, np.ndarray]] = {mode: {} for mode in MODES}
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        print(f"Receiving Yards {phase} {season}...", flush=True)
        base = historical[historical["phase"].eq(phase)].copy()
        test = by_row.loc[base["row_id"]].copy()
        rows_by_season[season] = test
        actual[season] = base["actual"].to_numpy(float)
        reference[season] = base["released_projection"].to_numpy(float)
        calculated = receiving_components(
            foundation, frame, teams, season, team_features, player_features, test,
        )
        for mode in MODES:
            components[mode][season] = calculated[mode]

    reference_metrics = {
        "selection": metrics(actual[2024], reference[2024]),
        "confirmation": metrics(actual[2025], reference[2025]),
    }
    reports: dict[str, dict[str, Any]] = {}
    for mode in MODES:
        for weight in WEIGHTS:
            name = f"{mode}_blend_{int(weight * 100)}"
            reports[name] = {}
            for season, phase in ((2024, "selection"), (2025, "confirmation")):
                candidate = np.clip(
                    (1.0 - weight) * reference[season] + weight * components[mode][season],
                    0.0, None,
                )
                reports[name][phase] = metrics(actual[season], candidate)
                if season == 2025:
                    reports[name]["stability"] = stability(
                        rows_by_season[season], actual[season], reference[season], candidate,
                    )
    eligible = [
        name for name, value in reports.items()
        if value["selection"]["mae"] < reference_metrics["selection"]["mae"]
        and value["selection"]["rmse"] < reference_metrics["selection"]["rmse"]
        and value["confirmation"]["mae"] <= reference_metrics["confirmation"]["mae"]
        and value["confirmation"]["rmse"] <= reference_metrics["confirmation"]["rmse"]
        and value["stability"]["passes"]
        and abs(float(value["confirmation"]["bias"]))
            <= abs(float(reference_metrics["confirmation"]["bias"])) + 2.0
    ]
    ranked = sorted(eligible, key=lambda name: (
        float(reports[name]["stability"]["gameClusterBootstrap95"][1]),
        float(reports[name]["selection"]["mae"]) / float(reference_metrics["selection"]["mae"])
        + float(reports[name]["selection"]["rmse"]) / float(reference_metrics["selection"]["rmse"]),
        float(reports[name]["confirmation"]["mae"]),
    ))

    role_reports: dict[str, dict[str, Any]] = {}
    for mode in MODES:
        name = f"wr_{mode}_blend_50"
        role_reports[name] = {}
        for season, phase in ((2024, "selection"), (2025, "confirmation")):
            candidate = candidate_projection(
                reference[season], components[mode][season],
                rows_by_season[season]["position"].to_numpy(str), name,
            )
            role_reports[name][phase] = metrics(actual[season], candidate)
            if season == 2025:
                role_reports[name]["stability"] = stability(
                    rows_by_season[season], actual[season], reference[season], candidate,
                )
    role_eligible = [
        name for name, value in role_reports.items()
        if value["selection"]["mae"] < reference_metrics["selection"]["mae"]
        and value["selection"]["rmse"] < reference_metrics["selection"]["rmse"]
        and value["confirmation"]["mae"] <= reference_metrics["confirmation"]["mae"]
        and value["confirmation"]["rmse"] <= reference_metrics["confirmation"]["rmse"]
        and value["stability"]["passes"]
        and abs(float(value["confirmation"]["bias"]))
            <= abs(float(reference_metrics["confirmation"]["bias"])) + 2.0
    ]
    role_ranked = sorted(role_eligible, key=lambda name: (
        float(role_reports[name]["stability"]["gameClusterBootstrap95"][1]),
        float(role_reports[name]["selection"]["mae"]) / float(reference_metrics["selection"]["mae"])
        + float(role_reports[name]["selection"]["rmse"]) / float(reference_metrics["selection"]["rmse"]),
        float(role_reports[name]["confirmation"]["mae"]),
    ))

    replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("receiving_yards")].copy()
    replay["normalized_player"] = replay["playerName"].map(foundation.normalize_player)
    current = frame[frame["season"].eq(2026)].copy()
    current["normalized_player"] = current["player_name"].map(foundation.normalize_player)
    offered = replay[["week", "playerName", "team", "normalized_player"]].drop_duplicates(
        ["week", "team", "normalized_player"],
    ).merge(
        current, on=["week", "team", "normalized_player"], how="left", validate="one_to_one",
    )
    if offered["row_id"].isna().any():
        raise RuntimeError("unmatched exact-2026 Receiving Yards replay rows")
    locked_components = receiving_components(
        foundation, frame, teams, 2026, team_features, player_features, offered,
        {str(value) for value in offered["row_id"]},
    )
    component_rows = offered[["week", "team", "normalized_player", "row_id", "season", "game_id",
                              "opponent", "player_id", "player_name", "position"]].copy()
    for mode in MODES:
        component_rows[mode] = locked_components[mode]
    replay = replay.merge(
        component_rows,
        on=["week", "team", "normalized_player"], how="left", validate="many_to_one",
    )
    actual_locked = replay["actual"].to_numpy(float)
    line = replay["line"].to_numpy(float)
    reference_locked = replay["independentProjection"].to_numpy(float)
    locked_reference_metrics = metrics(actual_locked, reference_locked)
    direction_reference = direction(actual_locked, reference_locked, line)
    for name in ranked:
        mode, _, _ = candidate_identity(name)
        candidate = candidate_projection(
            reference_locked, replay[mode].to_numpy(float), replay["position"].to_numpy(str), name,
        )
        candidate_metrics = metrics(actual_locked, candidate)
        candidate_direction = direction(actual_locked, candidate, line)
        reports[name]["locked2026"] = {
            "metrics": candidate_metrics, "direction": candidate_direction,
            "passes": bool(
                candidate_metrics["mae"] <= locked_reference_metrics["mae"]
                and candidate_metrics["rmse"] <= locked_reference_metrics["rmse"]
                and candidate_direction >= direction_reference
            ),
        }
    initial_selected = ranked[0] if ranked and reports[ranked[0]]["locked2026"]["passes"] else None
    for name in role_ranked:
        mode, _, _ = candidate_identity(name)
        candidate = candidate_projection(
            reference_locked, replay[mode].to_numpy(float), replay["position"].to_numpy(str), name,
        )
        candidate_metrics = metrics(actual_locked, candidate)
        candidate_direction = direction(actual_locked, candidate, line)
        role_reports[name]["locked2026"] = {
            "metrics": candidate_metrics, "direction": candidate_direction,
            "passes": bool(
                candidate_metrics["mae"] <= locked_reference_metrics["mae"]
                and candidate_metrics["rmse"] <= locked_reference_metrics["rmse"]
                and candidate_direction >= direction_reference
            ),
        }
    role_selected = (
        role_ranked[0]
        if not initial_selected and role_ranked and role_reports[role_ranked[0]]["locked2026"]["passes"]
        else None
    )
    selected = initial_selected or role_selected
    selected_mode, _, _ = candidate_identity(selected) if selected else ("direct", 0.0, False)
    candidate_locked = (
        candidate_projection(
            reference_locked, replay[selected_mode].to_numpy(float), replay["position"].to_numpy(str), selected,
        ) if selected else reference_locked.copy()
    )

    output_rows: list[pd.DataFrame] = []
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        test = rows_by_season[season]
        values = test[["row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                       "player_name", "position", "receiving_yards"]].copy().rename(
            columns={"receiving_yards": "actual"},
        )
        values["phase"] = phase
        values["reference_projection"] = reference[season]
        values["candidate_projection"] = (
            candidate_projection(
                reference[season], components[selected_mode][season], test["position"].to_numpy(str), selected,
            ) if selected else reference[season].copy()
        )
        output_rows.append(values)
    locked_rows = replay[["row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                          "player_name", "position", "actual", "line", "side"]].copy()
    locked_rows["phase"] = "locked_replay"
    locked_rows["reference_projection"] = reference_locked
    locked_rows["candidate_projection"] = candidate_locked
    for mode in MODES:
        locked_rows[f"{mode}_component"] = replay[mode].to_numpy(float)
        for weight in WEIGHTS:
            locked_rows[f"{mode}_blend_{int(weight * 100)}"] = np.clip(
                (1.0 - weight) * reference_locked
                + weight * replay[mode].to_numpy(float), 0.0, None,
            )
    output_rows.append(locked_rows)
    result_rows = pd.concat(output_rows, ignore_index=True)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_receiving_yards_tournament_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True, "marketIndependent": True, "marketFeatures": [],
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025,
                       "diagnostic": "exact 2026 Weeks 1-4 locked scopes"},
        "externalManifestSha256": foundation.sha256_file(foundation.DEFAULT_EXTERNAL_MANIFEST),
        "injurySources": injury_metadata,
        "reference": reference_metrics, "candidates": reports,
        "historicallyEligibleRanking": ranked, "initialSelected": initial_selected,
        "roleGate": {
            "diagnosticLed": True,
            "currentSeasonIsPristineHoldout": False,
            "candidates": role_reports,
            "historicallyEligibleRanking": role_ranked,
            "selected": role_selected,
        },
        "selected": selected,
        "locked2026": {
            "reference": locked_reference_metrics, "candidate": metrics(actual_locked, candidate_locked),
            "published": metrics(actual_locked, replay["publishedProjection"].to_numpy(float)),
            "directionReference": direction_reference,
            "directionCandidate": direction(actual_locked, candidate_locked, line),
            "directionPublished": direction(actual_locked, replay["publishedProjection"].to_numpy(float), line),
        },
        "rowsFile": str(args.rows.resolve()), "rowsSha256": sha256(args.rows),
    }
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "selected": selected,
                      "historicallyEligibleRanking": ranked, "locked2026": output["locked2026"]}, indent=2))


if __name__ == "__main__":
    main()
