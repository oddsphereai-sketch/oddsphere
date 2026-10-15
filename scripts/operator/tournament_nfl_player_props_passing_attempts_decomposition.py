#!/usr/bin/env python3
"""Research-only factorized Passing Attempts opportunity tournament."""

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
import pyarrow.parquet as pq
from sklearn.ensemble import HistGradientBoostingRegressor


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.manifest.json"
BASE_SOURCE_MANIFEST = ROOT / "football-research/cache/nflverse/real-model-r1/manifest.json"
CURRENT_SOURCE_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/manifest.json"
FOUNDATION_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_expected_role_system_2026_projections_r1.parquet"
LOCKED_REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_through_week_5_r2.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_decomposition_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_decomposition_rows_r1.parquet"
WEIGHTS = (0.25, 0.50, 0.75, 1.0)
SEED = 20261015


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_player(value: str) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", plain)


def read_manifest(path: pathlib.Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def verified_pbp_paths() -> list[pathlib.Path]:
    paths: list[pathlib.Path] = []
    for manifest_path in (BASE_SOURCE_MANIFEST, CURRENT_SOURCE_MANIFEST):
        manifest = read_manifest(manifest_path)
        for item in manifest.get("files", []):
            if item.get("dataset") != "pbp":
                continue
            path = pathlib.Path(str(item["filename"]))
            if not path.exists() or sha256_file(path) != item.get("sha256"):
                raise RuntimeError(f"PBP checksum mismatch: {path}")
            paths.append(path)
    if len(paths) != 11:
        raise RuntimeError(f"expected 11 PBP seasons, found {len(paths)}")
    return sorted(paths)


def pbp_team_labels(paths: list[pathlib.Path]) -> pd.DataFrame:
    columns = [
        "season", "season_type", "week", "game_id", "posteam", "defteam",
        "qb_dropback", "rush_attempt", "qb_kneel", "qb_spike", "pass_attempt",
    ]
    frames: list[pd.DataFrame] = []
    for path in paths:
        available = set(pq.read_schema(path).names)
        selected = [column for column in columns if column in available]
        frame = pq.read_table(path, columns=selected).to_pandas()
        for column in columns:
            if column not in frame:
                frame[column] = pd.NA
        frames.append(frame)
    plays = pd.concat(frames, ignore_index=True)
    plays = plays[
        plays["season_type"].fillna("").eq("REG")
        & plays["posteam"].notna()
        & plays["defteam"].notna()
    ].copy()
    for column in ("qb_dropback", "rush_attempt", "qb_kneel", "qb_spike", "pass_attempt"):
        plays[column] = pd.to_numeric(plays[column], errors="coerce").fillna(0.0)
    eligible = (plays["qb_dropback"].eq(1) | plays["rush_attempt"].eq(1))
    eligible &= ~plays["qb_kneel"].eq(1) & ~plays["qb_spike"].eq(1)
    plays = plays[eligible].copy()
    labels = plays.groupby(
        ["season", "week", "game_id", "posteam", "defteam"], observed=True, as_index=False,
    ).agg(
        offensive_plays=("game_id", "size"),
        dropbacks=("qb_dropback", "sum"),
        credited_attempts=("pass_attempt", "sum"),
    ).rename(columns={"posteam": "team", "defteam": "opponent"})
    labels["dropback_rate"] = labels["dropbacks"] / labels["offensive_plays"].clip(lower=1)
    labels["credited_attempt_rate"] = labels["credited_attempts"] / labels["dropbacks"].clip(lower=1)
    return labels


def factor_model(loss: str) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss=loss,
        max_iter=180,
        max_leaf_nodes=15,
        learning_rate=0.04,
        min_samples_leaf=35,
        l2_regularization=12.0,
        random_state=SEED,
    )


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
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
    rows = frame.copy()
    rows["delta"] = np.abs(rows[candidate] - rows["actual"]) - np.abs(rows[incumbent] - rows["actual"])
    grouped = rows.groupby("game_id", observed=True)["delta"].agg(["sum", "count"]).to_numpy(float)
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path, default=EXTERNAL_MANIFEST)
    parser.add_argument("--foundation-projections", type=pathlib.Path, default=FOUNDATION_PROJECTIONS)
    parser.add_argument("--locked-replay", type=pathlib.Path, default=LOCKED_REPLAY)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--rows", type=pathlib.Path, default=ROWS)
    args = parser.parse_args()

    foundation = load_module(
        "pa_decomposition_foundation",
        ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py",
    )
    manifest = read_manifest(args.external_manifest)
    feature_path = pathlib.Path(str(manifest["featureFile"]))
    if sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame = pd.read_parquet(feature_path)
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
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    frame[[*dict.fromkeys([*player_features, *team_features])]] = frame[
        [*dict.fromkeys([*player_features, *team_features])]
    ].replace([np.inf, -np.inf], np.nan)

    labels = pbp_team_labels(verified_pbp_paths())
    team_context = frame.sort_values(
        ["season", "week", "game_id", "team", "player_id"],
    ).drop_duplicates(["season", "week", "game_id", "team"])[
        ["season", "week", "game_id", "team", *team_features]
    ]
    teams = labels.merge(
        team_context,
        on=["season", "week", "game_id", "team"],
        how="inner",
        validate="one_to_one",
    )
    leaders = foundation.lead_passer_rows(frame)
    team_attempt_index = teams.set_index(["season", "game_id", "team"])["credited_attempts"]
    leader_keys = pd.MultiIndex.from_frame(leaders[["season", "game_id", "team"]])
    leaders["lead_pass_share"] = (
        leaders["passing_attempts"].to_numpy(float)
        / np.maximum(team_attempt_index.reindex(leader_keys).to_numpy(float), 1.0)
    )
    leaders["lead_pass_share"] = leaders["lead_pass_share"].clip(0.50, 1.0)

    def factorized(rows: pd.DataFrame, season: int) -> tuple[np.ndarray, dict[str, np.ndarray]]:
        train_teams = teams[teams["season"].lt(season)].copy()
        current_teams = teams[teams["season"].eq(season)].copy()
        play_model = factor_model("poisson").fit(
            train_teams[team_features], train_teams["offensive_plays"].to_numpy(float),
        )
        dropback_model = factor_model("squared_error").fit(
            train_teams[team_features], train_teams["dropback_rate"].to_numpy(float),
        )
        attempt_rate_model = factor_model("squared_error").fit(
            train_teams[team_features], train_teams["credited_attempt_rate"].to_numpy(float),
        )
        predicted_plays = np.clip(np.asarray(play_model.predict(current_teams[team_features]), dtype=float), 35.0, 85.0)
        predicted_dropback_rate = np.clip(np.asarray(dropback_model.predict(current_teams[team_features]), dtype=float), 0.25, 0.85)
        predicted_attempt_rate = np.clip(np.asarray(attempt_rate_model.predict(current_teams[team_features]), dtype=float), 0.55, 1.0)
        current_teams = current_teams[["game_id", "team"]].copy()
        current_teams["predicted_plays"] = predicted_plays
        current_teams["predicted_dropback_rate"] = predicted_dropback_rate
        current_teams["predicted_attempt_rate"] = predicted_attempt_rate
        current_teams["predicted_team_attempts"] = predicted_plays * predicted_dropback_rate * predicted_attempt_rate
        indexed = current_teams.set_index(["game_id", "team"])
        requested = pd.MultiIndex.from_frame(rows[["game_id", "team"]])

        share_train = leaders[
            leaders["season"].lt(season) & leaders["passing_attempts"].gt(0)
        ].copy()
        share_model = foundation.model("squared_error").fit(
            share_train[player_features], share_train["lead_pass_share"].to_numpy(float),
        )
        share = np.clip(np.asarray(share_model.predict(rows[player_features]), dtype=float), 0.50, 1.0)
        components = {
            "plays": indexed["predicted_plays"].reindex(requested).to_numpy(float),
            "dropbackRate": indexed["predicted_dropback_rate"].reindex(requested).to_numpy(float),
            "attemptRate": indexed["predicted_attempt_rate"].reindex(requested).to_numpy(float),
            "leadPassShare": share,
        }
        if any(np.isnan(values).any() for values in components.values()):
            raise RuntimeError(f"factorized Passing Attempts component missing for {season}")
        prediction = (
            components["plays"] * components["dropbackRate"]
            * components["attemptRate"] * components["leadPassShare"]
        )
        return np.clip(prediction, 0.0, None), components

    projections = pd.read_parquet(args.foundation_projections)
    projections = projections[projections["market"].eq("passing_attempts")].copy()
    output_rows: list[pd.DataFrame] = []
    candidate_by_phase: dict[str, dict[str, Any]] = {}

    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        base = projections[projections["phase"].eq(phase)].copy()
        requested = frame.set_index("row_id").loc[base["row_id"]].reset_index(drop=True)
        challenger, components = factorized(requested, season)
        base["incumbent"] = base["candidate_projection"].to_numpy(float)
        base["challenger"] = challenger
        for name, values in components.items():
            base[name] = values
        for weight in WEIGHTS:
            base[f"blend_{int(weight * 100)}"] = (
                (1.0 - weight) * base["incumbent"] + weight * base["challenger"]
            )
        output_rows.append(base)
        actual = base["actual"].to_numpy(float)
        candidate_by_phase[phase] = {
            "incumbent": point_metrics(actual, base["incumbent"].to_numpy(float)),
            "candidates": {
                f"blend_{int(weight * 100)}": point_metrics(
                    actual, base[f"blend_{int(weight * 100)}"].to_numpy(float),
                )
                for weight in WEIGHTS
            },
        }

    selection = candidate_by_phase["selection"]
    eligible = [
        name for name, metrics in selection["candidates"].items()
        if float(metrics["mae"]) < float(selection["incumbent"]["mae"])
        and float(metrics["rmse"]) < float(selection["incumbent"]["rmse"])
    ]
    selected = min(
        eligible,
        key=lambda name: (
            float(selection["candidates"][name]["mae"]) / float(selection["incumbent"]["mae"])
            + float(selection["candidates"][name]["rmse"]) / float(selection["incumbent"]["rmse"])
        ),
    ) if eligible else None
    confirmation = candidate_by_phase["confirmation"]
    confirmed = bool(
        selected
        and float(confirmation["candidates"][selected]["mae"]) <= float(confirmation["incumbent"]["mae"])
        and float(confirmation["candidates"][selected]["rmse"]) <= float(confirmation["incumbent"]["rmse"])
    )

    current_reports: dict[str, Any] = {}
    frozen = selected if confirmed else None
    for phase in ("diagnostic", "locked_replay"):
        base = projections[projections["phase"].eq(phase)].copy()
        if base.empty:
            continue
        requested = frame.set_index("row_id").loc[base["row_id"]].reset_index(drop=True)
        challenger, components = factorized(requested, 2026)
        base["incumbent"] = base["component_projection"].to_numpy(float)
        base["challenger"] = challenger
        for name, values in components.items():
            base[name] = values
        for weight in WEIGHTS:
            base[f"blend_{int(weight * 100)}"] = (
                (1.0 - weight) * base["incumbent"] + weight * base["challenger"]
            )
        output_rows.append(base)
        current_reports[phase] = {
            "incumbent": point_metrics(base["actual"].to_numpy(float), base["incumbent"].to_numpy(float)),
            "candidates": {
                f"blend_{int(weight * 100)}": point_metrics(
                    base["actual"].to_numpy(float), base[f"blend_{int(weight * 100)}"].to_numpy(float),
                )
                for weight in WEIGHTS
            },
            "byWeek": {
                str(int(week)): {
                    "incumbent": point_metrics(rows["actual"].to_numpy(float), rows["incumbent"].to_numpy(float)),
                    "candidate": point_metrics(rows["actual"].to_numpy(float), rows[frozen].to_numpy(float)) if frozen else None,
                }
                for week, rows in base.groupby("week", observed=True)
            },
        }

    all_rows = pd.concat(output_rows, ignore_index=True)
    replay = pd.DataFrame(read_manifest(args.locked_replay)["rows"])
    replay = replay[replay["market"].eq("passing_attempts")].copy()
    replay["normalized_player"] = replay["playerName"].map(normalize_player)
    locked = all_rows[all_rows["phase"].eq("locked_replay")].copy()
    locked["normalized_player"] = locked["player_name"].map(normalize_player)
    exact = replay.merge(
        locked,
        on=["week", "team", "normalized_player"],
        how="left",
        validate="one_to_one",
        suffixes=("_replay", ""),
    )
    if exact["challenger"].isna().any():
        raise RuntimeError("exact 2026 Passing Attempts replay join is incomplete")
    exact_report: dict[str, Any] = {
        "rows": int(len(exact)),
        "games": int(exact["gameId"].nunique()),
        "incumbent": point_metrics(exact["actual_replay"].to_numpy(float), exact["incumbent"].to_numpy(float)),
        "candidates": {},
    }
    for weight in WEIGHTS:
        name = f"blend_{int(weight * 100)}"
        exact_report["candidates"][name] = {
            **point_metrics(exact["actual_replay"].to_numpy(float), exact[name].to_numpy(float)),
            "directionAccuracy": direction(
                exact["actual_replay"].to_numpy(float), exact[name].to_numpy(float), exact["line"].to_numpy(float),
            ),
        }
    exact_report["incumbent"]["directionAccuracy"] = direction(
        exact["actual_replay"].to_numpy(float), exact["incumbent"].to_numpy(float), exact["line"].to_numpy(float),
    )

    current = all_rows[all_rows["phase"].eq("diagnostic")].copy()
    current["actual_team_max"] = current.groupby(
        ["game_id", "team"], observed=True,
    )["actual"].transform("max")
    current_leads = current[current["actual"].eq(current["actual_team_max"])].copy()
    current_lead_report = {
        "population": "postgame lead passer, used only as an evaluation denominator",
        "rows": int(len(current_leads)),
        "games": int(current_leads["game_id"].nunique()),
        "incumbent": point_metrics(
            current_leads["actual"].to_numpy(float), current_leads["incumbent"].to_numpy(float),
        ),
        "candidates": {
            f"blend_{int(weight * 100)}": point_metrics(
                current_leads["actual"].to_numpy(float),
                current_leads[f"blend_{int(weight * 100)}"].to_numpy(float),
            )
            for weight in WEIGHTS
        },
        "byWeek": {
            str(int(week)): {
                "incumbent": point_metrics(rows["actual"].to_numpy(float), rows["incumbent"].to_numpy(float)),
                "candidate": point_metrics(rows["actual"].to_numpy(float), rows[frozen].to_numpy(float)) if frozen else None,
            }
            for week, rows in current_leads.groupby("week", observed=True)
        },
    }
    advancement = bool(
        frozen
        and float(current_lead_report["candidates"][frozen]["mae"]) < float(current_lead_report["incumbent"]["mae"])
        and float(current_lead_report["candidates"][frozen]["rmse"]) < float(current_lead_report["incumbent"]["rmse"])
        and float(exact_report["candidates"][frozen]["mae"]) < float(exact_report["incumbent"]["mae"])
        and float(exact_report["candidates"][frozen]["rmse"]) < float(exact_report["incumbent"]["rmse"])
        and float(exact_report["candidates"][frozen]["directionAccuracy"]) >= float(exact_report["incumbent"]["directionAccuracy"])
    )
    interval = cluster_interval(current_leads, frozen, "incumbent") if frozen else None
    output = {
        "release": "nfl_player_props_passing_attempts_decomposition_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025, "diagnostic": "2026 Weeks 1-5"},
        "candidate": "offensive plays x dropback rate x credited-attempt rate x lead-passer share",
        "selection": {**selection, "selected": selected},
        "confirmation": {**confirmation, "confirmed": confirmed},
        "frozenCandidate": frozen,
        "currentSeason": current_reports,
        "currentSeasonLeadPasserEvaluation": current_lead_report,
        "currentSeasonAllEligibleWarning": "The broader diagnostic includes role-changing backups and is not the prop-offer population.",
        "exactOfferedReplay": exact_report,
        "gameClusterCandidateMinusIncumbentMae95": interval,
        "pointAdvancementGatePassed": advancement,
        "probabilityAndBoardGatesPending": advancement,
        "productionAuthorized": False,
        "sourceChecksums": {
            "externalManifest": sha256_file(args.external_manifest),
            "foundationProjections": sha256_file(args.foundation_projections),
            "lockedReplay": sha256_file(args.locked_replay),
            "basePbpManifest": sha256_file(BASE_SOURCE_MANIFEST),
            "currentPbpManifest": sha256_file(CURRENT_SOURCE_MANIFEST),
        },
    }
    args.rows.parent.mkdir(parents=True, exist_ok=True)
    all_rows.to_parquet(args.rows, index=False)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
