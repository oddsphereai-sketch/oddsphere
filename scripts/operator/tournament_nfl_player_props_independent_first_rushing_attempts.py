#!/usr/bin/env python3
"""Chronological independent-first market-weight tournament for Rushing Attempts.

The active settlement-aligned point head and empirical distribution are frozen.
This script changes no production artifact, grade, writer, or database state.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import re
import sys
import unicodedata
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, log_loss


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OPENINGS = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2025_openings_af5f84007ba40ea5.json"
DEFAULT_ARTIFACT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeMarketRushingAttempts.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-independent-first/nfl_player_props_independent_first_rushing_attempts_r1.json"
# Zero is a diagnostic market-only benchmark. It is not eligible for selection.
WEIGHTS = (0.00, 0.20, 0.35, 0.50, 0.65, 0.80, 1.00)
SHIPPABLE_WEIGHTS = (0.65, 0.80, 1.00)
SELECTION_END = pd.Timestamp("2025-10-31").date()
CONFIRMATION_START = pd.Timestamp("2025-11-01").date()
SEED = 20261008


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def normalized_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]", "", ascii_value)


def normalize_team(value: str) -> str:
    team = value.upper().strip()
    return {"LAR": "LA", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}.get(team, team)


def implied_probability(price: int) -> float:
    return -price / (-price + 100) if price < 0 else 100 / (price + 100)


def logit(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(np.asarray(values, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped))


def expit(values: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-np.asarray(values, dtype=float)))


def residual_probability(model: np.ndarray, market: np.ndarray, weight: float) -> np.ndarray:
    return expit(logit(market) + weight * (logit(model) - logit(market)))


def predict_tree(nodes: list[dict[str, Any]], inputs: np.ndarray) -> np.ndarray:
    output = np.empty(len(inputs), dtype=float)
    for row_index, row in enumerate(inputs):
        node_index = 0
        while True:
            node = nodes[node_index]
            if bool(node["isLeaf"]):
                output[row_index] = float(node["value"])
                break
            value = row[int(node["featureIndex"])]
            if not np.isfinite(value):
                node_index = int(node["left"] if node["missingGoToLeft"] else node["right"])
            else:
                node_index = int(node["left"] if value <= float(node["threshold"]) else node["right"])
    return output


def predict_model(model: dict[str, Any], frame: pd.DataFrame) -> np.ndarray:
    kind = str(model["kind"])
    if kind == "weighted_blend":
        return sum(float(component["weight"]) * predict_model(component["model"], frame) for component in model["components"])
    if kind != "hgb_regressor":
        raise RuntimeError(f"unsupported portable Rushing Attempts model: {kind}")
    feature_names = list(model["featureNames"])
    missing = [name for name in feature_names if name not in frame]
    if missing:
        raise RuntimeError(f"historical frame is missing {len(missing)} portable features")
    inputs = frame[feature_names].to_numpy(float)
    prediction = np.full(len(frame), float(model["baseline"]), dtype=float)
    for iteration in model["trees"]:
        for tree in iteration:
            prediction += predict_tree(tree["nodes"], inputs)
    if model.get("link") == "exponential":
        prediction = np.exp(prediction)
    return np.clip(prediction, 0, None)


def empirical_over_probability(mean: np.ndarray, line: np.ndarray, distribution: dict[str, Any]) -> np.ndarray:
    probabilities = np.empty(len(mean), dtype=float)
    for index, (row_mean, row_line) in enumerate(zip(mean, line, strict=True)):
        selected = distribution
        if distribution["family"] == "empirical_residual_mean_bucket":
            selected = distribution["fallback"]
            for bucket in distribution["buckets"]:
                if float(bucket["lower"]) <= row_mean <= float(bucket["upper"]):
                    selected = bucket["distribution"]
                    break
        if selected["family"] != "empirical_residual":
            raise RuntimeError("Rushing Attempts distribution is not empirical")
        residuals = np.asarray(selected["residualQuantiles"], dtype=float)
        cdf = np.searchsorted(residuals, row_line - row_mean, side="right") / len(residuals)
        probabilities[index] = 1 - cdf
    return np.clip(probabilities, 1e-6, 1 - 1e-6)


def calibration_gap(y: np.ndarray, probabilities: np.ndarray) -> float:
    bins = pd.qcut(probabilities, q=10, duplicates="drop")
    grouped = pd.DataFrame({"p": probabilities, "y": y, "bin": bins}).groupby("bin", observed=True).agg(
        predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"),
    )
    return float(np.average(np.abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"]))


def probability_metrics(y: np.ndarray, probabilities: np.ndarray) -> dict[str, float | int]:
    predicted = probabilities >= 0.5
    return {
        "rows": int(len(y)),
        "directionWins": int(np.sum(predicted == y)),
        "directionAccuracy": float(np.mean(predicted == y)),
        "brier": float(brier_score_loss(y, probabilities)),
        "logLoss": float(log_loss(y, probabilities)),
        "calibrationGap": calibration_gap(y, probabilities),
        "meanProbability": float(np.mean(probabilities)),
        "overRate": float(np.mean(y)),
    }


def clustered_brier_delta(rows: pd.DataFrame, candidate: np.ndarray, incumbent: np.ndarray) -> dict[str, float | int]:
    y = rows["outcome_over"].to_numpy(int)
    grouped = pd.DataFrame({
        "game_id": rows["game_id"].to_numpy(),
        "delta": (candidate - y) ** 2 - (incumbent - y) ** 2,
    }).groupby("game_id", observed=True)["delta"].agg(["sum", "count"])
    values = grouped.to_numpy(float)
    rng = np.random.default_rng(SEED)
    draws = np.empty(2000, dtype=float)
    for index in range(len(draws)):
        sample = values[rng.integers(0, len(values), len(values))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    return {
        "meanDelta": float(np.mean((candidate - y) ** 2 - (incumbent - y) ** 2)),
        "ciLow": float(np.quantile(draws, 0.025)),
        "ciHigh": float(np.quantile(draws, 0.975)),
        "gameClusters": int(len(values)),
    }


def load_history(manifest_path: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any], pathlib.Path]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    candidate = pathlib.Path(str(
        manifest.get("featureFile") or manifest.get("output") or manifest.get("dataset") or ""
    ))
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    if not candidate.exists():
        candidate = manifest_path.with_suffix(".parquet")
    if not candidate.exists():
        raise RuntimeError("verified historical NFL props parquet is unavailable")
    expected = (
        manifest.get("featureFileSha256")
        or manifest.get("outputSha256")
        or manifest.get("datasetSha256")
        or manifest.get("sha256")
    )
    if expected and sha256_file(candidate) != expected:
        raise RuntimeError("historical NFL props parquet checksum mismatch")
    history = pd.read_parquet(candidate)
    baseline = load_module(
        "independent_first_ra_baseline",
        ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py",
    )
    matchup = load_module(
        "independent_first_ra_matchup",
        ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py",
    )
    contract = json.loads(
        (ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text(encoding="utf-8")
    )
    history, _ = baseline.prepare_features(history, manifest)
    matchup_rows, _ = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, _ = matchup.game_environment(manifest)
    history = history.merge(
        matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one"
    )
    history = history.merge(
        environment, on=["season", "week", "game_id"], how="left", validate="many_to_one"
    )
    del contract
    return history, manifest, candidate


def build_game_map(history: pd.DataFrame, openings: dict[str, Any]) -> dict[str, str]:
    games = history[history["season"].eq(2025)].groupby(["game_id", "game_date"], observed=True).apply(
        lambda rows: pd.Series({
            "home_team": rows.loc[rows["is_home"].eq(1), "team"].iloc[0],
            "away_team": rows.loc[rows["is_home"].eq(0), "team"].iloc[0],
        }), include_groups=False,
    ).reset_index()
    mapping: dict[str, str] = {}
    for game in openings["games"]:
        date = pd.Timestamp(game["scheduledStart"]).date()
        matches = games[
            games["home_team"].map(normalize_team).eq(normalize_team(game["homeTeam"]))
            & games["away_team"].map(normalize_team).eq(normalize_team(game["awayTeam"]))
        ].copy()
        if matches.empty:
            continue
        matches["date_delta"] = pd.to_datetime(matches["game_date"]).dt.date.map(lambda value: abs((value - date).days))
        nearest = matches.sort_values("date_delta")
        if int(nearest.iloc[0]["date_delta"]) <= 1 and (len(nearest) == 1 or nearest.iloc[0]["date_delta"] < nearest.iloc[1]["date_delta"]):
            mapping[str(game["id"])] = str(nearest.iloc[0]["game_id"])
    if len(mapping) < 260:
        raise RuntimeError(f"opening/history game identity coverage is low: {len(mapping)}")
    return mapping


def build_scoring_rows(history: pd.DataFrame, openings: dict[str, Any], artifact: dict[str, Any]) -> tuple[pd.DataFrame, dict[str, int]]:
    holdout = history[
        history["season"].eq(2025)
        & history["position"].astype(str).str.lower().isin(["qb", "rb", "fb"])
        & history["participated"].eq(1)
    ].copy()
    holdout["_name"] = holdout["player_name"].astype(str).map(normalized_name)
    holdout["independent_projection"] = predict_model(artifact["model"], holdout)
    game_map = build_game_map(history, openings)
    observations = pd.DataFrame(openings["observations"])
    observations = observations[
        observations["market"].eq("rushing_attempts")
        & observations["offerType"].eq("over_under")
        & observations["side"].isin(["over", "under"])
    ].copy()
    observations["game_id"] = observations["providerEventId"].astype(str).map(game_map)
    observations["_name"] = observations["playerName"].astype(str).map(normalized_name)
    observations = observations.dropna(subset=["game_id"])
    keys = ["game_id", "_name", "playerName", "sportsbook", "market", "line", "observedAt"]
    paired = observations.pivot_table(index=keys, columns="side", values="americanPrice", aggfunc="last").reset_index()
    paired = paired.dropna(subset=["over", "under"])
    paired[["over", "under"]] = paired[["over", "under"]].astype(int)
    joined = paired.merge(
        holdout[["game_id", "game_date", "_name", "player_name", "position", "rushing_attempts", "independent_projection"]],
        on=["game_id", "_name"], how="inner", validate="many_to_one",
    )
    if len(joined) < 500:
        raise RuntimeError(f"Rushing Attempts exact opening join is too small: {len(joined)}")
    over_implied = joined["over"].map(implied_probability)
    under_implied = joined["under"].map(implied_probability)
    joined["book_over_probability"] = over_implied / (over_implied + under_implied)
    scope = ["game_id", "_name", "market", "line"]
    group = joined.groupby(scope, observed=True)["book_over_probability"]
    joined["independent_book_count"] = group.transform("count") - 1
    joined["market_over_probability"] = (
        group.transform("sum") - joined["book_over_probability"]
    ) / joined["independent_book_count"].replace(0, np.nan)
    # Product semantics: the evaluated target is the best executable Over quote;
    # its own no-vig probability is excluded from the benchmark.
    joined = joined[joined["independent_book_count"].ge(1)].sort_values(
        [*scope, "over", "sportsbook"], ascending=[True, True, True, True, False, True],
    ).drop_duplicates(scope, keep="first")
    joined["model_over_probability"] = empirical_over_probability(
        joined["independent_projection"].to_numpy(float),
        joined["line"].to_numpy(float), artifact["distribution"],
    )
    joined["outcome_over"] = joined["rushing_attempts"].gt(joined["line"]).astype(int)
    joined["push"] = joined["rushing_attempts"].eq(joined["line"])
    joined = joined[~joined["push"]].copy()
    return joined, {
        "gamesMapped": len(game_map),
        "marketObservations": int(len(observations)),
        "pairedOffers": int(len(paired)),
        "settlementAlignedPlayers": int(holdout[["game_id", "_name"]].drop_duplicates().shape[0]),
        "evaluatedScopes": int(len(joined)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--openings", type=pathlib.Path, default=DEFAULT_OPENINGS)
    parser.add_argument("--artifact", type=pathlib.Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    history, manifest, history_path = load_history(args.manifest)
    openings = json.loads(args.openings.read_text(encoding="utf-8"))
    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    rows, coverage = build_scoring_rows(history, openings, artifact)
    rows["date"] = pd.to_datetime(rows["game_date"]).dt.date
    selection = rows[rows["date"].le(SELECTION_END)].copy()
    confirmation = rows[rows["date"].ge(CONFIRMATION_START)].copy()
    if min(len(selection), len(confirmation)) < 100:
        raise RuntimeError(f"chronological sample is too small: {len(selection)} / {len(confirmation)}")
    scores: dict[str, Any] = {}
    for weight in WEIGHTS:
        label = f"{weight:.2f}"
        scores[label] = {}
        for split_name, split in (("selection", selection), ("confirmation", confirmation)):
            probabilities = residual_probability(
                split["model_over_probability"].to_numpy(float),
                split["market_over_probability"].to_numpy(float), weight,
            )
            scores[label][split_name] = probability_metrics(split["outcome_over"].to_numpy(int), probabilities)
    incumbent_selection = scores["0.20"]["selection"]
    eligible = [weight for weight in SHIPPABLE_WEIGHTS if (
        scores[f"{weight:.2f}"]["selection"]["brier"] < incumbent_selection["brier"]
        and scores[f"{weight:.2f}"]["selection"]["logLoss"] < incumbent_selection["logLoss"]
    )]
    selected = min(eligible, key=lambda weight: scores[f"{weight:.2f}"]["selection"]["brier"]) if eligible else None
    passes = False
    uncertainty = None
    if selected is not None:
        candidate = scores[f"{selected:.2f}"]["confirmation"]
        incumbent = scores["0.20"]["confirmation"]
        passes = bool(
            candidate["brier"] < incumbent["brier"]
            and candidate["logLoss"] < incumbent["logLoss"]
            and candidate["directionAccuracy"] >= incumbent["directionAccuracy"]
            and candidate["calibrationGap"] <= incumbent["calibrationGap"] + 0.005
        )
        uncertainty = clustered_brier_delta(
            confirmation,
            residual_probability(confirmation["model_over_probability"], confirmation["market_over_probability"], selected),
            residual_probability(confirmation["model_over_probability"], confirmation["market_over_probability"], 0.20),
        )
    unique_players = rows.drop_duplicates(["game_id", "_name"])
    point_error = unique_players["independent_projection"].to_numpy(float) - unique_players["rushing_attempts"].to_numpy(float)
    output = {
        "release": "nfl_player_props_independent_first_rushing_attempts_tournament_2026_10_08_r1",
        "readOnly": True,
        "writes": 0,
        "providerCalls": 0,
        "chronology": {
            "selectionEnd": str(SELECTION_END),
            "confirmationStart": str(CONFIRMATION_START),
            "selectionRows": int(len(selection)),
            "confirmationRows": int(len(confirmation)),
        },
        "checksums": {
            "manifest": sha256_file(args.manifest),
            "history": sha256_file(history_path),
            "openings": sha256_file(args.openings),
            "artifact": sha256_file(args.artifact),
        },
        "sourceReleases": {
            "openings": openings["release"],
            "artifactModelKind": artifact["model"]["kind"],
            "historicalManifest": manifest.get("datasetRelease") or manifest.get("release"),
        },
        "coverage": coverage,
        "weights": scores,
        "selection": {
            "eligibleIndependentFirstWeights": eligible,
            "selectedWeight": selected,
            "passesConfirmation": passes,
            "clusteredConfirmationBrierDelta": uncertainty,
        },
        "joinedIndependentPoint": {
            "rows": int(len(unique_players)),
            "mae": float(np.mean(np.abs(point_error))),
            "rmse": float(math.sqrt(np.mean(point_error ** 2))),
            "bias": float(np.mean(point_error)),
            "underpredictionRate": float(np.mean(point_error < 0)),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "coverage": coverage, "chronology": output["chronology"],
        "selection": output["selection"], "weights": scores,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
