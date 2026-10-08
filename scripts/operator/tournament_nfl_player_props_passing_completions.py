#!/usr/bin/env python3
"""Chronological independent Passing Completions point-head tournament."""

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
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_completions_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_completions_rows_r1.parquet"
FEATURE_FAMILIES = ("state", "state_pressure", "state_ftn", "state_ngs", "full_external")
WEIGHTS = (0.50, 0.75, 1.0)


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


def completion_prediction(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    team_features: list[str],
    features: list[str],
    test: pd.DataFrame,
    exposure_weighted: bool,
) -> np.ndarray:
    leaders = foundation.lead_passer_rows(frame)
    train = leaders[
        leaders["season"].lt(season)
        & leaders["passing_attempts"].ge(5)
        & leaders["participated"].eq(1)
    ].copy()
    share_train = leaders[leaders["season"].lt(season) & leaders["passing_attempts"].gt(0)].copy()
    team_attempts = teams.set_index(["season", "game_id", "team"])["team_pass_attempts"]
    keys = pd.MultiIndex.from_frame(share_train[["season", "game_id", "team"]])
    share_train["lead_pass_share"] = (
        share_train["passing_attempts"].to_numpy(float) / team_attempts.reindex(keys).to_numpy(float)
    )
    share_model = foundation.model("squared_error").fit(
        share_train[features], share_train["lead_pass_share"].clip(0.50, 1.0),
    )
    share = np.clip(np.asarray(share_model.predict(test[features]), dtype=float), 0.50, 1.0)
    budget = foundation.budget_prediction(
        teams, season, team_features, "team_pass_attempts", test[["game_id", "team"]],
    )
    attempts = np.clip(budget * share, 0.0, None)
    rate = (train["passing_completions"] / train["passing_attempts"]).clip(0.30, 0.85)
    sample_weight = train["passing_attempts"].to_numpy(float) if exposure_weighted else None
    rate_model = foundation.model("squared_error").fit(
        train[features], rate.to_numpy(float), sample_weight=sample_weight,
    )
    predicted_rate = np.clip(np.asarray(rate_model.predict(test[features]), dtype=float), 0.30, 0.85)
    return np.minimum(attempts, attempts * predicted_rate)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path, default=EXTERNAL_MANIFEST)
    parser.add_argument("--foundation-projections", type=pathlib.Path, default=FOUNDATION_PROJECTIONS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    foundation = load("pc_foundation", ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py")
    availability = load("pc_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py")
    external = load("pc_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py")
    manifest = json.loads(args.external_manifest.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, _, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
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
            *external.relevant_features("passing_completions", groups)[family],
            *groups.get("depth", []),
            *availability_groups["combined"],
        ]))
        for family in FEATURE_FAMILIES
    }
    family_features = {
        family: [name for name in values if name in frame.columns]
        for family, values in family_features.items()
    }
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    numeric = list(dict.fromkeys([*team_features, *(name for values in family_features.values() for name in values)]))
    frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)
    prior = pd.read_parquet(args.foundation_projections)
    prior = prior[prior["market"].eq("passing_completions") & prior["phase"].isin(["selection", "confirmation"])].copy()

    candidates: dict[str, dict[int, np.ndarray]] = {}
    rows_by_season: dict[int, pd.DataFrame] = {}
    reference: dict[int, np.ndarray] = {}
    actual: dict[int, np.ndarray] = {}
    output_rows: list[pd.DataFrame] = []
    for season in (2024, 2025):
        print(f"passing-completions season {season}...", flush=True)
        phase = "selection" if season == 2024 else "confirmation"
        source = prior[prior["phase"].eq(phase)].copy()
        test = by_row.loc[source["row_id"]].copy()
        rows_by_season[season] = test
        reference[season] = source["released_projection"].to_numpy(float)
        actual[season] = source["actual"].to_numpy(float)
        for family, features in family_features.items():
            for exposure_weighted in (False, True):
                component = completion_prediction(
                    foundation, frame, teams, season, team_features, features, test,
                    exposure_weighted,
                )
                mode = "attempt_weighted" if exposure_weighted else "game_weighted"
                for weight in WEIGHTS:
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
    selected = min(eligible, key=lambda name: (
        selection[name]["mae"] / reference_2024["mae"]
        + selection[name]["rmse"] / reference_2024["rmse"]
        + abs(selection[name]["bias"]) / max(float(np.mean(actual[2024])), 1.0)
    ))
    reference_2025 = metrics(actual[2025], reference[2025])
    candidate_2025 = metrics(actual[2025], candidates[selected][2025])
    confirmed = bool(
        candidate_2025["mae"] <= reference_2025["mae"]
        and candidate_2025["rmse"] <= reference_2025["rmse"]
    )
    frozen = selected if confirmed else None

    for season in (2024, 2025):
        values = rows_by_season[season][[
            "row_id", "season", "week", "game_id", "team", "opponent",
            "player_id", "player_name", "position", "passing_completions",
        ]].copy().rename(columns={"passing_completions": "actual"})
        values["phase"] = "selection" if season == 2024 else "confirmation"
        values["reference_projection"] = reference[season]
        values["candidate_projection"] = candidates[frozen][season] if frozen else reference[season]
        output_rows.append(values)

    replay = pd.DataFrame(json.loads(args.locked_replay.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("passing_completions")].copy()
    replay["normalized_player"] = replay["playerName"].map(foundation.normalize_player)
    current = frame[frame["season"].eq(2026)].copy()
    current["normalized_player"] = current["player_name"].map(foundation.normalize_player)
    offered = replay.merge(
        current, on=["week", "team", "normalized_player"], how="left", validate="many_to_one",
        suffixes=("_locked", ""),
    )
    if offered["row_id"].isna().any():
        raise RuntimeError("unmatched 2026 Passing Completions replay rows")
    if frozen:
        family, mode, blend_name = frozen.split("__")
        weight = int(blend_name.removeprefix("blend_")) / 100.0
        component = completion_prediction(
            foundation, frame, teams, 2026, team_features, family_features[family], offered,
            mode == "attempt_weighted",
        )
        # The immutable locked independent point is the honest preceding 2026 benchmark.
        locked_reference = offered["independentProjection"].to_numpy(float)
        candidate = np.clip((1.0 - weight) * locked_reference + weight * component, 0.0, None)
    else:
        locked_reference = offered["independentProjection"].to_numpy(float)
        candidate = locked_reference
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
        "release": "nfl_player_props_passing_completions_tournament_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025, "diagnostic": "2026 Weeks 1-4 opened"},
        "selection": {"reference": reference_2024, "candidates": selection, "selected": selected},
        "confirmation": {"reference": reference_2025, "candidate": candidate_2025, "confirmed": confirmed},
        "confirmationStability": confirmation_stability(
            rows_by_season[2025], actual[2025], reference[2025], candidates[frozen][2025],
        ) if frozen else None,
        "frozenCandidate": frozen,
        "locked2026": {
            "reference": metrics(offered_rows["actual"].to_numpy(float), locked_reference),
            "candidate": metrics(offered_rows["actual"].to_numpy(float), candidate),
            "directionReference": float(np.mean(
                np.sign(locked_reference - offered_rows["line"].to_numpy(float))
                == np.sign(offered_rows["actual"].to_numpy(float) - offered_rows["line"].to_numpy(float))
            )),
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
