#!/usr/bin/env python3
"""Research-only Passing Attempts QB1 role-survival mixture tournament."""

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
from sklearn.ensemble import HistGradientBoostingClassifier


ROOT = pathlib.Path(__file__).resolve().parents[2]
DECOMPOSITION = ROOT / "scripts/operator/tournament_nfl_player_props_passing_attempts_decomposition.py"
FOUNDATION = ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py"
AVAILABILITY = ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_role_survival_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_role_survival_rows_r1.parquet"
WEIGHTS = (0.25, 0.50, 0.75, 1.0)
SEED = 20261015


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = np.asarray(prediction, dtype=float) - np.asarray(actual, dtype=float)
    return {
        "rows": int(len(error)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
    }


def direction(actual: np.ndarray, prediction: np.ndarray, line: np.ndarray) -> float:
    return float(np.mean(np.sign(prediction - line) == np.sign(actual - line)))


def cluster_interval(frame: pd.DataFrame, candidate: str, incumbent: str, resamples: int = 4000) -> dict[str, float | int]:
    values = frame.copy()
    values["delta"] = np.abs(values[candidate] - values["actual"]) - np.abs(values[incumbent] - values["actual"])
    grouped = values.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
    random = np.random.default_rng(SEED)
    draws = np.empty(resamples)
    for index in range(resamples):
        sample = grouped[random.integers(0, len(grouped), len(grouped))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    lower, median, upper = np.quantile(draws, [0.025, 0.5, 0.975])
    return {
        "gameClusters": int(len(grouped)),
        "lower": float(lower),
        "median": float(median),
        "upper": float(upper),
    }


def qb1_rows(frame: pd.DataFrame) -> pd.DataFrame:
    rows = frame[
        frame["position"].eq("QB")
        & frame["external_depth_listed"].eq(1)
        & frame["external_depth_starter"].eq(1)
    ].copy()
    rows = rows.sort_values(
        ["season", "week", "game_id", "team", "external_depth_slot_rank", "player_id"],
    )
    return rows.drop_duplicates(["season", "week", "game_id", "team"], keep="first")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    decomp = load("pa_role_decomposition", DECOMPOSITION)
    foundation = load("pa_role_foundation", FOUNDATION)
    availability = load("pa_role_availability", AVAILABILITY)
    manifest = decomp.read_manifest(decomp.EXTERNAL_MANIFEST)
    feature_path = pathlib.Path(str(manifest["featureFile"]))
    if decomp.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")

    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *groups["base"], *groups["state"], *groups.get("pfr", []),
        *groups.get("ftn", []), *groups.get("ngs", []), *groups.get("depth", []),
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
    teams = foundation.team_table(frame, team_features)
    qb1 = qb1_rows(frame)
    team_attempts = teams.set_index(["season", "game_id", "team"])["team_pass_attempts"]
    qb1_index = pd.MultiIndex.from_frame(qb1[["season", "game_id", "team"]])
    qb1["team_attempts"] = team_attempts.reindex(qb1_index).to_numpy(float)
    qb1 = qb1[qb1["team_attempts"].gt(0)].copy()
    qb1["actual_share"] = (qb1["passing_attempts"] / qb1["team_attempts"]).clip(0.0, 1.0)
    qb1["role_state"] = np.select(
        [qb1["actual_share"].lt(0.05), qb1["actual_share"].lt(0.80)],
        [0, 1], default=2,
    ).astype(int)

    def predict(rows: pd.DataFrame, season: int, offered: bool) -> tuple[np.ndarray, dict[str, np.ndarray]]:
        training = qb1[qb1["season"].lt(season)].copy()
        classifier = HistGradientBoostingClassifier(
            max_iter=180,
            max_leaf_nodes=15,
            learning_rate=0.04,
            min_samples_leaf=30,
            l2_regularization=12.0,
            random_state=SEED,
        ).fit(training[player_features], training["role_state"].to_numpy(int))
        raw_probability = np.asarray(classifier.predict_proba(rows[player_features]), dtype=float)
        probabilities = np.zeros((len(rows), 3), dtype=float)
        for column, state in enumerate(classifier.classes_):
            probabilities[:, int(state)] = raw_probability[:, column]
        if offered:
            active = probabilities[:, 1] + probabilities[:, 2]
            probabilities[:, 0] = 0.0
            probabilities[:, 1] = np.divide(
                probabilities[:, 1], active, out=np.full(len(rows), 0.15), where=active > 0,
            )
            probabilities[:, 2] = 1.0 - probabilities[:, 1]

        full_train = training[training["role_state"].eq(2)]
        partial_train = training[training["role_state"].eq(1)]
        full_model = foundation.model("squared_error", minimum_leaf=25).fit(
            full_train[player_features], full_train["actual_share"].to_numpy(float),
        )
        partial_model = foundation.model("squared_error", minimum_leaf=20).fit(
            partial_train[player_features], partial_train["actual_share"].to_numpy(float),
        )
        full_share = np.clip(np.asarray(full_model.predict(rows[player_features]), dtype=float), 0.80, 1.0)
        partial_share = np.clip(np.asarray(partial_model.predict(rows[player_features]), dtype=float), 0.05, 0.80)
        expected_share = probabilities[:, 1] * partial_share + probabilities[:, 2] * full_share
        budget = foundation.budget_prediction(
            teams, season, team_features, "team_pass_attempts", rows[["game_id", "team"]],
        )
        prediction = np.clip(budget * expected_share, 0.0, None)
        return prediction, {
            "teamBudget": budget,
            "noRoleProbability": probabilities[:, 0],
            "partialRoleProbability": probabilities[:, 1],
            "fullRoleProbability": probabilities[:, 2],
            "partialShare": partial_share,
            "fullShare": full_share,
            "expectedShare": expected_share,
        }

    projections = pd.read_parquet(decomp.FOUNDATION_PROJECTIONS)
    projections = projections[projections["market"].eq("passing_attempts")].copy()
    phase_rows: list[pd.DataFrame] = []
    reports: dict[str, Any] = {}
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        base = projections[projections["phase"].eq(phase)].copy()
        requested = frame.set_index("row_id").loc[base["row_id"]].reset_index(drop=True)
        challenger, components = predict(requested, season, False)
        base["incumbent"] = base["candidate_projection"].to_numpy(float)
        base["challenger"] = challenger
        for name, values in components.items():
            base[name] = values
        for weight in WEIGHTS:
            base[f"blend_{int(weight * 100)}"] = (
                (1.0 - weight) * base["incumbent"] + weight * base["challenger"]
            )
        reports[phase] = {
            "incumbent": metrics(base["actual"].to_numpy(float), base["incumbent"].to_numpy(float)),
            "candidates": {
                f"blend_{int(weight * 100)}": metrics(
                    base["actual"].to_numpy(float), base[f"blend_{int(weight * 100)}"].to_numpy(float),
                ) for weight in WEIGHTS
            },
        }
        phase_rows.append(base)

    selectable = [
        name for name, result in reports["selection"]["candidates"].items()
        if float(result["mae"]) < float(reports["selection"]["incumbent"]["mae"])
        and float(result["rmse"]) < float(reports["selection"]["incumbent"]["rmse"])
    ]
    selected = min(selectable, key=lambda name: (
        float(reports["selection"]["candidates"][name]["mae"])
        + float(reports["selection"]["candidates"][name]["rmse"])
    )) if selectable else None
    confirmed = bool(
        selected
        and float(reports["confirmation"]["candidates"][selected]["mae"])
        <= float(reports["confirmation"]["incumbent"]["mae"])
        and float(reports["confirmation"]["candidates"][selected]["rmse"])
        <= float(reports["confirmation"]["incumbent"]["rmse"])
    )
    frozen = selected if confirmed else None

    current = qb1[qb1["season"].eq(2026)].copy()
    current["actual"] = current["passing_attempts"].to_numpy(float)
    current["incumbent"] = foundation.passing_predictions(
        frame, teams, 2026, team_features, player_features, current,
    )["passing_attempts"]
    current_challenger, components = predict(current, 2026, False)
    current["challenger"] = current_challenger
    for name, values in components.items():
        current[name] = values
    for weight in WEIGHTS:
        current[f"blend_{int(weight * 100)}"] = (
            (1.0 - weight) * current["incumbent"] + weight * current["challenger"]
        )
    current_report = {
        "incumbent": metrics(current["actual"].to_numpy(float), current["incumbent"].to_numpy(float)),
        "candidate": metrics(current["actual"].to_numpy(float), current[frozen].to_numpy(float)) if frozen else None,
        "byWeek": {
            str(int(week)): {
                "incumbent": metrics(group["actual"].to_numpy(float), group["incumbent"].to_numpy(float)),
                "candidate": metrics(group["actual"].to_numpy(float), group[frozen].to_numpy(float)) if frozen else None,
            } for week, group in current.groupby("week", observed=True)
        },
        "clusteredMaeDelta": cluster_interval(current, frozen, "incumbent") if frozen else None,
        "realizedStates": {
            "noRole": int(current["role_state"].eq(0).sum()),
            "partialRole": int(current["role_state"].eq(1).sum()),
            "fullRole": int(current["role_state"].eq(2).sum()),
        },
    }

    offered = projections[projections["phase"].eq("locked_replay")].copy()
    offered_requested = frame.set_index("row_id").loc[offered["row_id"]].reset_index(drop=True)
    offered["incumbent"] = offered["component_projection"].to_numpy(float)
    offered_challenger, offered_components = predict(offered_requested, 2026, True)
    offered["challenger"] = offered_challenger
    for name, values in offered_components.items():
        offered[name] = values
    for weight in WEIGHTS:
        offered[f"blend_{int(weight * 100)}"] = (
            (1.0 - weight) * offered["incumbent"] + weight * offered["challenger"]
        )
    replay = pd.DataFrame(json.loads(decomp.LOCKED_REPLAY.read_text(encoding="utf-8"))["rows"])
    replay = replay[replay["market"].eq("passing_attempts")].copy()
    replay["normalized_player"] = replay["playerName"].map(decomp.normalize_player)
    offered["normalized_player"] = offered["player_name"].map(decomp.normalize_player)
    offered = offered.merge(
        replay[["week", "team", "normalized_player", "line"]],
        on=["week", "team", "normalized_player"], how="left", validate="one_to_one",
    )
    if offered["line"].isna().any():
        raise RuntimeError("offered Passing Attempts replay line did not match")
    offered_report = {
        "incumbent": metrics(offered["actual"].to_numpy(float), offered["incumbent"].to_numpy(float)),
        "candidate": metrics(offered["actual"].to_numpy(float), offered[frozen].to_numpy(float)) if frozen else None,
        "incumbentDirection": direction(
            offered["actual"].to_numpy(float), offered["incumbent"].to_numpy(float), offered["line"].to_numpy(float),
        ),
        "candidateDirection": direction(
            offered["actual"].to_numpy(float), offered[frozen].to_numpy(float), offered["line"].to_numpy(float),
        ) if frozen else None,
    }
    point_gate = bool(
        frozen and current_report["candidate"]
        and float(current_report["candidate"]["mae"]) < float(current_report["incumbent"]["mae"])
        and float(current_report["candidate"]["rmse"]) < float(current_report["incumbent"]["rmse"])
        and float(offered_report["candidateDirection"]) >= float(offered_report["incumbentDirection"])
    )

    for values, phase in ((current, "current_qb1"), (offered, "locked_replay")):
        values["phase"] = phase
        phase_rows.append(values)
    output_rows = pd.concat(phase_rows, ignore_index=True, sort=False)
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    output_rows.to_parquet(args.rows, index=False)
    output = {
        "release": "nfl_player_props_passing_attempts_role_survival_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "candidate": "pregame depth-QB1 no-role/partial/full-role hurdle mixture",
        "stateCutoffs": {"noRoleUpperExclusive": 0.05, "fullRoleLowerInclusive": 0.80},
        "reports": reports,
        "selected": selected,
        "confirmed": confirmed,
        "frozenCandidate": frozen,
        "currentSeasonPregameQb1": current_report,
        "lockedReplay": offered_report,
        "pointGatePassed": point_gate,
        "probabilityStageAuthorized": point_gate,
        "productionAuthorized": False,
        "injurySources": injury_metadata,
        "sourceChecksums": {
            "externalManifest": decomp.sha256_file(decomp.EXTERNAL_MANIFEST),
            "foundationProjections": decomp.sha256_file(decomp.FOUNDATION_PROJECTIONS),
            "lockedReplay": decomp.sha256_file(decomp.LOCKED_REPLAY),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
