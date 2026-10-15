#!/usr/bin/env python3
"""Chronological team-budget x player-share x YPC Rushing Yards tournament."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import re
import sys
import time
import unicodedata
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor


ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.manifest.json"
FOUNDATION = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_through_week_5_r2.json"
INJURY_ROOT = ROOT / "football-research/cache/nfl-player-props-external/injuries"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_team_factorization_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_team_factorization_rows_r1.parquet"
POSITIONS = ("QB", "RB", "FB", "WR")
EFFICIENCY_MODES = ("equal", "attempt_weighted")
WEIGHTS = (0.25, 0.50, 0.75)
BLOCKS = ((1, 4), (5, 9), (10, 13), (14, 18))
SEED = 20261015


def load_module(name: str, path: pathlib.Path) -> Any:
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


def normalize_player(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


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
        "props_team_factorization_external",
        ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    availability = load_module(
        "props_team_factorization_availability",
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
        *external.relevant_features("rushing_yards", groups)["full_external"],
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
    totals = frame.groupby(keys, observed=True)["rushing_attempts"].transform("sum")
    frame["team_rush_attempts"] = totals
    frame["team_rush_share"] = np.where(totals.gt(0), frame["rushing_attempts"] / totals, 0.0)
    return frame, player_features, team_features, injury_metadata


def team_table(frame: pd.DataFrame, team_features: list[str]) -> pd.DataFrame:
    keys = ["season", "week", "game_id", "team"]
    outcomes = frame.groupby(keys, observed=True, as_index=False).agg(
        team_rush_attempts=("rushing_attempts", "sum"),
    )
    context = frame.sort_values([*keys, "player_id"]).drop_duplicates(keys)[[*keys, *team_features]]
    return outcomes.merge(context, on=keys, validate="one_to_one")


def factorized_predictions(
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    player_features: list[str],
    team_features: list[str],
    test: pd.DataFrame,
    efficiency_mode: str,
    known_active_row_ids: set[str] | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    team_train = teams[teams["season"].lt(season)]
    team_current = teams[teams["season"].eq(season)]
    team_model = regression("poisson").fit(
        team_train[team_features], team_train["team_rush_attempts"].to_numpy(float),
    )
    team_current = team_current.copy()
    team_current["predicted_team_rush_attempts"] = np.clip(
        np.asarray(team_model.predict(team_current[team_features]), dtype=float), 1e-6, None,
    )
    budget_index = team_current.set_index(["game_id", "team"])["predicted_team_rush_attempts"]
    test_keys = pd.MultiIndex.from_frame(test[["game_id", "team"]])
    budget = budget_index.reindex(test_keys).to_numpy(float)
    if np.isnan(budget).any():
        raise RuntimeError(f"missing team budget for {season}")

    population = frame[frame["season"].lt(season) & frame["position"].isin(POSITIONS)].copy()
    active = population[population["participated"].eq(1)].copy()
    share_model = regression("squared_error").fit(
        active[player_features], active["team_rush_share"].fillna(0.0).to_numpy(float),
    )
    participation_model = HistGradientBoostingClassifier(
        max_iter=140,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=35,
        l2_regularization=12.0,
        random_state=SEED,
    ).fit(population[player_features], population["participated"].to_numpy(int))
    roster = frame[
        frame["season"].eq(season)
        & frame["position"].isin(POSITIONS)
        & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
    ].copy()
    active_probability = np.asarray(participation_model.predict_proba(roster[player_features])[:, 1], dtype=float)
    if known_active_row_ids:
        active_probability[roster["row_id"].isin(known_active_row_ids).to_numpy()] = 1.0
    conditional_share = np.clip(
        np.asarray(share_model.predict(roster[player_features]), dtype=float), 0.0, 1.0,
    )
    roster["raw_expected_share"] = active_probability * conditional_share
    denominator = roster.groupby(["game_id", "team"], observed=True)["raw_expected_share"].transform("sum")
    roster["normalized_expected_share"] = np.where(
        denominator.gt(0), roster["raw_expected_share"] / denominator, 0.0,
    )
    share_index = roster.set_index("row_id")["normalized_expected_share"]
    share = share_index.reindex(test["row_id"]).to_numpy(float)
    missing_share = np.isnan(share)
    if missing_share.any():
        fallback = np.clip(
            np.asarray(share_model.predict(test.loc[missing_share, player_features]), dtype=float),
            0.0,
            1.0,
        )
        share[missing_share] = fallback

    rate_train = active[active["rushing_attempts"].gt(0)].copy()
    rate_target = (rate_train["rushing_yards"] / rate_train["rushing_attempts"]).clip(0.0, 15.0)
    sample_weight = (
        rate_train["rushing_attempts"].to_numpy(float)
        if efficiency_mode == "attempt_weighted" else None
    )
    rate_model = regression("squared_error").fit(
        rate_train[player_features], rate_target.to_numpy(float), sample_weight=sample_weight,
    )
    rate = np.clip(np.asarray(rate_model.predict(test[player_features]), dtype=float), 0.0, 15.0)
    opportunity = np.clip(budget * share, 0.0, None)
    prediction = np.clip(opportunity * rate, 0.0, None)
    team_actual = team_current["team_rush_attempts"].to_numpy(float)
    team_prediction = team_current["predicted_team_rush_attempts"].to_numpy(float)
    return prediction, {
        "season": season,
        "teamRows": int(len(team_current)),
        "teamBudget": metrics(team_actual, team_prediction),
        "testRows": int(len(test)),
        "rosterRows": int(len(roster)),
        "missingNormalizedShareRows": int(missing_share.sum()),
        "meanPredictedTeamAttempts": float(np.mean(budget)),
        "meanPredictedShare": float(np.mean(share)),
        "meanPredictedYardsPerCarry": float(np.mean(rate)),
        "meanPredictedPlayerAttempts": float(np.mean(opportunity)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=MANIFEST)
    parser.add_argument("--foundation", type=pathlib.Path, default=FOUNDATION)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--injury-root", type=pathlib.Path, default=INJURY_ROOT)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    frame, player_features, team_features, injury_metadata = prepare_frame(args.manifest, args.injury_root)
    teams = team_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)
    foundation = pd.read_parquet(args.foundation)
    historical = foundation[
        foundation["market"].eq("rushing_yards")
        & foundation["phase"].isin(["selection", "confirmation"])
    ].copy()
    historical_by_season = {
        season: historical[historical["season"].eq(season)].copy()
        for season in (2024, 2025)
    }
    components: dict[str, dict[int, np.ndarray]] = {mode: {} for mode in EFFICIENCY_MODES}
    diagnostics: dict[str, Any] = {}
    for season in (2024, 2025):
        source = historical_by_season[season]
        test = by_row.loc[source["row_id"]].copy()
        for mode in EFFICIENCY_MODES:
            prediction, diagnostic = factorized_predictions(
                frame, teams, season, player_features, team_features, test, mode,
            )
            components[mode][season] = prediction
            diagnostics[f"{season}:{mode}"] = diagnostic

    reference_metrics: dict[str, dict[str, float | int]] = {}
    reports: dict[str, dict[str, Any]] = {}
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        source = historical_by_season[season]
        reference_metrics[phase] = metrics(
            source["actual"].to_numpy(float), source["released_projection"].to_numpy(float),
        )
    for mode in EFFICIENCY_MODES:
        for weight in WEIGHTS:
            name = f"team_factorized_{mode}_blend_{int(weight * 100)}"
            reports[name] = {"spec": {"efficiencyMode": mode, "weight": weight}}
            for season, phase in ((2024, "selection"), (2025, "confirmation")):
                source = historical_by_season[season]
                actual = source["actual"].to_numpy(float)
                reference = source["released_projection"].to_numpy(float)
                candidate = np.clip((1.0 - weight) * reference + weight * components[mode][season], 0.0, None)
                reports[name][phase] = metrics(actual, candidate)
                if phase == "confirmation":
                    reports[name]["stability"] = stability(source, actual, reference, candidate)

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
            <= abs(float(reference_metrics["confirmation"]["bias"])) + 1.0
        and reports[selected]["stability"]["passes"]
    )

    replay_payload = json.loads(args.locked_replay.read_text(encoding="utf-8"))
    replay = pd.DataFrame(replay_payload["rows"])
    replay = replay[replay["market"].eq("rushing_yards")].copy()
    replay["normalized_player"] = replay["playerName"].map(normalize_player)
    current_frame = frame[frame["season"].eq(2026)].copy()
    current_frame["normalized_player"] = current_frame["player_name"].map(normalize_player)
    requested = replay[["week", "team", "normalized_player"]].drop_duplicates()
    matched = requested.merge(
        current_frame,
        on=["week", "team", "normalized_player"],
        how="left",
        validate="one_to_one",
    )
    if matched["row_id"].isna().any():
        missing = matched.loc[matched["row_id"].isna(), ["week", "team", "normalized_player"]]
        raise RuntimeError(f"unmatched exact-2026 Rushing Yards rows: {missing.to_dict('records')}")
    replay = replay.merge(
        matched[["week", "team", "normalized_player", "row_id", "season", "game_id", "opponent",
                 "player_id", "player_name", "position"]],
        on=["week", "team", "normalized_player"],
        how="left",
        validate="many_to_one",
    )
    current_gate: dict[str, Any] | None = None
    current_component: np.ndarray | None = None
    current_candidate = replay["independentProjection"].to_numpy(float)
    if confirmed and selected:
        spec = reports[selected]["spec"]
        unique_test = matched.set_index("row_id").loc[replay["row_id"].drop_duplicates()].reset_index()
        unique_component, current_diagnostic = factorized_predictions(
            frame,
            teams,
            2026,
            player_features,
            team_features,
            unique_test,
            str(spec["efficiencyMode"]),
            set(unique_test["row_id"]),
        )
        component_by_row = pd.Series(unique_component, index=unique_test["row_id"])
        current_component = component_by_row.reindex(replay["row_id"]).to_numpy(float)
        current_candidate = np.clip(
            (1.0 - float(spec["weight"])) * current_candidate
            + float(spec["weight"]) * current_component,
            0.0,
            None,
        )
        actual = replay["actual"].to_numpy(float)
        reference = replay["independentProjection"].to_numpy(float)
        lines = replay["line"].to_numpy(float)
        reference_current = metrics(actual, reference)
        candidate_current = metrics(actual, current_candidate)
        current_gate = {
            "reference": reference_current,
            "candidate": candidate_current,
            "directionReference": direction(actual, reference, lines),
            "directionCandidate": direction(actual, current_candidate, lines),
            "passes": bool(
                candidate_current["mae"] <= reference_current["mae"]
                and candidate_current["rmse"] <= reference_current["rmse"]
                and direction(actual, current_candidate, lines) >= direction(actual, reference, lines)
            ),
            "diagnostic": current_diagnostic,
        }

    output_rows: list[pd.DataFrame] = []
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        source = historical_by_season[season]
        values = source[[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", "actual",
        ]].copy()
        values["phase"] = phase
        values["reference_projection"] = source["released_projection"].to_numpy(float)
        if selected:
            spec = reports[selected]["spec"]
            values["candidate_projection"] = np.clip(
                (1.0 - float(spec["weight"])) * values["reference_projection"].to_numpy(float)
                + float(spec["weight"]) * components[str(spec["efficiencyMode"])][season],
                0.0,
                None,
            )
        else:
            values["candidate_projection"] = values["reference_projection"]
        output_rows.append(values)
    locked_rows = replay[[
        "row_id", "season", "week", "game_id", "team", "opponent", "player_id", "player_name",
        "position", "actual", "line", "side",
    ]].copy()
    locked_rows["phase"] = "locked_replay"
    locked_rows["reference_projection"] = replay["independentProjection"].to_numpy(float)
    locked_rows["candidate_projection"] = current_candidate
    output_rows.append(locked_rows)
    result_rows = pd.concat(output_rows, ignore_index=True)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    result_rows.to_parquet(args.rows, index=False)

    output = {
        "release": "nfl_player_props_rushing_yards_team_factorization_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "chronology": {
            "training": "strictly prior seasons",
            "selection": 2024,
            "confirmation": 2025,
            "diagnostic": "exact immutable 2026 Weeks 1-5 offered Rushing Yards rows",
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
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "selected": selected,
        "confirmed": confirmed,
        "currentSeason": current_gate,
    }, indent=2))


if __name__ == "__main__":
    main()
