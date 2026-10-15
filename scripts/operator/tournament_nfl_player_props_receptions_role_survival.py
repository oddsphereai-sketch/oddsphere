#!/usr/bin/env python3
"""Chronological target-role survival Receptions tournament."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import sys
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor


ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.manifest.json"
RECEPTIONS_ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_rows_r1.parquet"
INJURY_ROOT = ROOT / "football-research/cache/nfl-player-props-external/injuries"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_role_survival_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_role_survival_rows_r1.parquet"
POSITIONS = ("RB", "FB", "WR", "TE")
ROLE_THRESHOLDS = (1, 2)
WEIGHTS = (0.25, 0.50, 0.75)
BLOCKS = ((1, 4), (5, 9), (10, 13), (14, 18))
SEED = 20261015


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regression(loss: str) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss=loss,
        max_iter=180,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=35,
        l2_regularization=12.0,
        random_state=SEED,
    )


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
    rows: pd.DataFrame,
    actual: np.ndarray,
    reference: np.ndarray,
    candidate: np.ndarray,
) -> dict[str, Any]:
    values = rows[["game_id", "week"]].copy()
    values["delta"] = np.abs(candidate - actual) - np.abs(reference - actual)
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


def prepare_frame(
    manifest_path: pathlib.Path,
    injury_root: pathlib.Path,
) -> tuple[pd.DataFrame, list[str], list[str], dict[str, Any]]:
    external = load_module(
        "props_role_survival_external",
        ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    availability = load_module(
        "props_role_survival_availability",
        ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py",
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), injury_root,
    )
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position.lower()}"
        frame[column] = frame["position"].eq(position).astype(float)
        groups["base"].append(column)
    if "is_home" not in groups["base"]:
        groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("receiving_yards", groups)["full_external"],
        *groups.get("depth", []),
        *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    numeric = list(dict.fromkeys([*player_features, *team_features]))
    frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
    keys = ["season", "week", "game_id", "team"]
    totals = frame.groupby(keys, observed=True)["targets"].transform("sum")
    frame["team_targets"] = totals
    frame["team_target_share"] = np.where(totals.gt(0), frame["targets"] / totals, 0.0)
    return frame, player_features, team_features, injury_metadata


def team_table(frame: pd.DataFrame, team_features: list[str]) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team"]
    outcomes = frame.groupby(keys, observed=True, as_index=False).agg(team_targets=("targets", "sum"))
    context = frame.sort_values([*keys, "player_id"]).drop_duplicates(keys)[[*keys, *team_features]]
    return outcomes.merge(context, on=keys, validate="one_to_one")


def role_survival_prediction(
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    player_features: list[str],
    team_features: list[str],
    test: pd.DataFrame,
    role_threshold: int,
) -> tuple[np.ndarray, dict[str, Any]]:
    team_train = teams[teams["season"].lt(season)]
    team_current = teams[teams["season"].eq(season)].copy()
    team_model = regression("poisson").fit(
        team_train[team_features], team_train["team_targets"].to_numpy(float),
    )
    team_current["predicted_team_targets"] = np.clip(
        np.asarray(team_model.predict(team_current[team_features]), dtype=float), 1e-6, None,
    )
    budget_index = team_current.set_index(["game_id", "team"])["predicted_team_targets"]
    budget = budget_index.reindex(pd.MultiIndex.from_frame(test[["game_id", "team"]])).to_numpy(float)
    if np.isnan(budget).any():
        raise RuntimeError(f"missing team target budget for {season}")

    population = frame[frame["season"].lt(season) & frame["position"].isin(POSITIONS)].copy()
    role_target = population["targets"].ge(role_threshold).astype(int)
    role_model = HistGradientBoostingClassifier(
        max_iter=140,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=35,
        l2_regularization=12.0,
        random_state=SEED,
    ).fit(population[player_features], role_target.to_numpy(int))
    conditional = population[population["targets"].ge(role_threshold)].copy()
    share_model = regression("squared_error").fit(
        conditional[player_features], conditional["team_target_share"].to_numpy(float),
    )
    roster = frame[
        frame["season"].eq(season)
        & frame["position"].isin(POSITIONS)
        & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
    ].copy()
    role_probability = np.asarray(role_model.predict_proba(roster[player_features])[:, 1], dtype=float)
    conditional_share = np.clip(
        np.asarray(share_model.predict(roster[player_features]), dtype=float), 0.0, 1.0,
    )
    roster["raw_expected_share"] = role_probability * conditional_share
    denominator = roster.groupby(["game_id", "team"], observed=True)["raw_expected_share"].transform("sum")
    roster["normalized_expected_share"] = np.where(
        denominator.gt(0), roster["raw_expected_share"] / denominator, 0.0,
    )
    share_index = roster.set_index("row_id")["normalized_expected_share"]
    share = share_index.reindex(test["row_id"]).to_numpy(float)
    missing = np.isnan(share)
    if missing.any():
        fallback_role = np.asarray(role_model.predict_proba(test.loc[missing, player_features])[:, 1], dtype=float)
        fallback_share = np.clip(
            np.asarray(share_model.predict(test.loc[missing, player_features]), dtype=float), 0.0, 1.0,
        )
        share[missing] = fallback_role * fallback_share

    rate_train = population[population["targets"].gt(0)].copy()
    catch_rate = (rate_train["receptions"] / rate_train["targets"]).clip(0.0, 1.0)
    rate_model = regression("squared_error").fit(
        rate_train[player_features],
        catch_rate.to_numpy(float),
        sample_weight=rate_train["targets"].to_numpy(float),
    )
    predicted_catch_rate = np.clip(
        np.asarray(rate_model.predict(test[player_features]), dtype=float), 0.0, 1.0,
    )
    predicted_targets = np.clip(budget * share, 0.0, None)
    prediction = np.clip(predicted_targets * predicted_catch_rate, 0.0, predicted_targets)
    return prediction, {
        "season": season,
        "roleThreshold": role_threshold,
        "teamRows": int(len(team_current)),
        "teamBudget": metrics(
            team_current["team_targets"].to_numpy(float),
            team_current["predicted_team_targets"].to_numpy(float),
        ),
        "testRows": int(len(test)),
        "rosterRows": int(len(roster)),
        "missingNormalizedShareRows": int(missing.sum()),
        "meanPredictedTeamTargets": float(np.mean(budget)),
        "meanPredictedShare": float(np.mean(share)),
        "meanPredictedPlayerTargets": float(np.mean(predicted_targets)),
        "meanPredictedCatchRate": float(np.mean(predicted_catch_rate)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=MANIFEST)
    parser.add_argument("--receptions-rows", type=pathlib.Path, default=RECEPTIONS_ROWS)
    parser.add_argument("--injury-root", type=pathlib.Path, default=INJURY_ROOT)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    frame, player_features, team_features, injury_metadata = prepare_frame(args.manifest, args.injury_root)
    teams = team_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)
    source = pd.read_parquet(args.receptions_rows)
    phases = {
        phase: source[source["phase"].eq(phase)].reset_index(drop=True).copy()
        for phase in ("selection", "confirmation", "locked_replay")
    }
    components: dict[int, dict[int, np.ndarray]] = {threshold: {} for threshold in ROLE_THRESHOLDS}
    diagnostics: dict[str, Any] = {}
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        test = by_row.loc[phases[phase]["row_id"]].reset_index(drop=True)
        for threshold in ROLE_THRESHOLDS:
            prediction, diagnostic = role_survival_prediction(
                frame, teams, season, player_features, team_features, test, threshold,
            )
            components[threshold][season] = prediction
            diagnostics[f"{season}:targets_ge_{threshold}"] = diagnostic

    reference_metrics = {
        phase: metrics(
            phases[phase]["actual"].to_numpy(float),
            phases[phase]["candidate_projection"].to_numpy(float),
        )
        for phase in ("selection", "confirmation")
    }
    reports: dict[str, dict[str, Any]] = {}
    for threshold in ROLE_THRESHOLDS:
        for weight in WEIGHTS:
            name = f"role_targets_ge_{threshold}_blend_{int(weight * 100)}"
            reports[name] = {"spec": {"roleThreshold": threshold, "weight": weight}}
            for season, phase in ((2024, "selection"), (2025, "confirmation")):
                actual = phases[phase]["actual"].to_numpy(float)
                reference = phases[phase]["candidate_projection"].to_numpy(float)
                candidate = np.clip(
                    (1.0 - weight) * reference + weight * components[threshold][season], 0.0, None,
                )
                reports[name][phase] = metrics(actual, candidate)
                if phase == "confirmation":
                    reports[name]["stability"] = stability(phases[phase], actual, reference, candidate)

    selectable = [
        name for name, report in reports.items()
        if report["selection"]["mae"] < reference_metrics["selection"]["mae"]
        and report["selection"]["rmse"] < reference_metrics["selection"]["rmse"]
    ]
    selected = min(selectable, key=lambda name: (
        float(reports[name]["selection"]["mae"]) / float(reference_metrics["selection"]["mae"])
        + float(reports[name]["selection"]["rmse"]) / float(reference_metrics["selection"]["rmse"]),
        float(reports[name]["selection"]["mae"]),
    )) if selectable else None
    confirmed = bool(
        selected
        and reports[selected]["confirmation"]["mae"] <= reference_metrics["confirmation"]["mae"]
        and reports[selected]["confirmation"]["rmse"] <= reference_metrics["confirmation"]["rmse"]
        and abs(float(reports[selected]["confirmation"]["bias"]))
            <= abs(float(reference_metrics["confirmation"]["bias"])) + 0.25
        and reports[selected]["stability"]["passes"]
    )

    current = phases["locked_replay"]
    current_gate: dict[str, Any] | None = None
    current_candidate = current["candidate_projection"].to_numpy(float)
    if confirmed and selected:
        spec = reports[selected]["spec"]
        current_test = by_row.loc[current["row_id"]].reset_index(drop=True)
        current_component, current_diagnostic = role_survival_prediction(
            frame,
            teams,
            2026,
            player_features,
            team_features,
            current_test,
            int(spec["roleThreshold"]),
        )
        current_candidate = np.clip(
            (1.0 - float(spec["weight"])) * current_candidate
            + float(spec["weight"]) * current_component,
            0.0,
            None,
        )
        actual = current["actual"].to_numpy(float)
        reference = current["candidate_projection"].to_numpy(float)
        lines = current["line"].to_numpy(float)
        reference_current = metrics(actual, reference)
        candidate_current = metrics(actual, current_candidate)
        current_gate = {
            "reference": reference_current,
            "candidate": candidate_current,
            "directionReference": direction(actual, reference, lines),
            "directionCandidate": direction(actual, current_candidate, lines),
            "passes": bool(
                candidate_current["mae"] < reference_current["mae"]
                and candidate_current["rmse"] < reference_current["rmse"]
                and direction(actual, current_candidate, lines) >= direction(actual, reference, lines)
            ),
            "diagnostic": current_diagnostic,
        }

    output_rows: list[pd.DataFrame] = []
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        values = phases[phase][[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", "actual",
        ]].copy()
        values["phase"] = phase
        values["reference_projection"] = phases[phase]["candidate_projection"].to_numpy(float)
        if selected:
            spec = reports[selected]["spec"]
            values["candidate_projection"] = np.clip(
                (1.0 - float(spec["weight"])) * values["reference_projection"].to_numpy(float)
                + float(spec["weight"]) * components[int(spec["roleThreshold"])][season],
                0.0,
                None,
            )
        else:
            values["candidate_projection"] = values["reference_projection"]
        output_rows.append(values)
    locked_rows = current[[
        "row_id", "season", "week", "game_id", "team", "opponent", "player_id", "player_name",
        "position", "actual", "line", "side",
    ]].copy()
    locked_rows["phase"] = "locked_replay"
    locked_rows["reference_projection"] = current["candidate_projection"].to_numpy(float)
    locked_rows["candidate_projection"] = current_candidate
    output_rows.append(locked_rows)
    result_rows = pd.concat(output_rows, ignore_index=True)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)

    payload = {
        "release": "nfl_player_props_receptions_role_survival_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "chronology": {
            "training": "strictly prior seasons",
            "selection": 2024,
            "confirmation": 2025,
            "diagnostic": "exact immutable 2026 Weeks 1-4 offered Receptions rows",
        },
        "featureCounts": {"player": len(player_features), "team": len(team_features)},
        "injuryEvidence": injury_metadata,
        "reference": reference_metrics,
        "candidates": reports,
        "selectionEligible": selectable,
        "selected": selected,
        "confirmed": confirmed,
        "currentSeason": current_gate,
        "diagnostics": diagnostics,
        "rowsFile": str(args.rows.resolve()),
        "rowsSha256": sha256(args.rows),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "selected": selected,
        "confirmed": confirmed,
        "currentSeason": current_gate,
    }, indent=2))


if __name__ == "__main__":
    main()
