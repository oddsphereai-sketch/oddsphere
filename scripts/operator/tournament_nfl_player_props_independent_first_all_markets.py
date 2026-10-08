#!/usr/bin/env python3
"""Evaluate independent-first probability weights for every NFL O/U prop family.

Active portable point models and empirical distributions are scored against exact
2025 opening lines.  The evaluated book is excluded from the market consensus.
This research script is read-only and cannot alter product predictions.
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
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
ARTIFACT_NAMES = {
    "passing_attempts": "nflPlayerPropsRuntimeMarketPassingAttempts.json",
    "passing_completions": "nflPlayerPropsRuntimeMarketPassingCompletions.json",
    "passing_yards": "nflPlayerPropsRuntimeMarketPassingYards.json",
    "rushing_attempts": "nflPlayerPropsRuntimeMarketRushingAttempts.json",
    "rushing_yards": "nflPlayerPropsRuntimeMarketRushingYards.json",
    "receptions": "nflPlayerPropsRuntimeMarketReceptions.json",
    "receiving_yards": "nflPlayerPropsRuntimeMarketReceivingYards.json",
}
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


def predict_object_tree(nodes: list[dict[str, Any]], inputs: np.ndarray) -> np.ndarray:
    output = np.empty(len(inputs), dtype=float)
    for row_index, row in enumerate(inputs):
        node_index = 0
        while True:
            node = nodes[node_index]
            if bool(node["isLeaf"]):
                output[row_index] = float(node["value"])
                break
            value = row[int(node["featureIndex"])]
            node_index = int(
                node["left"] if (not np.isfinite(value) and node["missingGoToLeft"])
                or (np.isfinite(value) and value <= float(node["threshold"])) else node["right"]
            )
    return output


def predict_compact_tree(nodes: list[list[float | int]], inputs: np.ndarray) -> np.ndarray:
    output = np.empty(len(inputs), dtype=float)
    for row_index, row in enumerate(inputs):
        node_index = 0
        while True:
            node = nodes[node_index]
            if bool(node[6]):
                output[row_index] = float(node[0])
                break
            value = row[int(node[1])]
            node_index = int(
                node[4] if (not np.isfinite(value) and bool(node[3]))
                or (np.isfinite(value) and value <= float(node[2])) else node[5]
            )
    return output


def predict_model(model: dict[str, Any], frame: pd.DataFrame) -> np.ndarray:
    kind = str(model["kind"])
    if kind == "weighted_blend":
        return sum(float(component["weight"]) * predict_model(component["model"], frame)
                   for component in model["components"])
    feature_names = list(model["featureNames"])
    missing = [name for name in feature_names if name not in frame]
    if missing:
        raise RuntimeError(f"historical frame is missing {len(missing)} portable features")
    inputs = frame[feature_names].to_numpy(float)
    if kind == "extra_trees_regressor":
        trees = [predict_compact_tree(tree["nodes"], inputs) for tree in model["trees"]]
        return np.clip(np.mean(trees, axis=0), 0.0, None)
    if kind == "linear_regressor":
        imputer = np.asarray(model["imputer"], dtype=float)
        filled = np.where(np.isfinite(inputs), inputs, imputer)
        standardized = (filled - np.asarray(model["means"], dtype=float)) / np.asarray(model["scales"], dtype=float)
        return np.clip(float(model["intercept"]) + standardized @ np.asarray(model["coefficients"], dtype=float), 0.0, None)
    if kind != "hgb_regressor":
        raise RuntimeError(f"unsupported portable model kind: {kind}")
    prediction = np.full(len(frame), float(model["baseline"]), dtype=float)
    for iteration in model["trees"]:
        for tree in iteration:
            prediction += predict_object_tree(tree["nodes"], inputs)
    if model.get("link") == "exponential":
        prediction = np.exp(prediction)
    return np.clip(prediction, 0.0, None)


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
            raise RuntimeError("portable distribution is not empirical residual")
        residuals = np.asarray(selected["residualQuantiles"], dtype=float)
        cdf = np.searchsorted(residuals, row_line - row_mean, side="right") / len(residuals)
        probabilities[index] = 1 - cdf
    return np.clip(probabilities, 1e-6, 1 - 1e-6)


def selected_residuals(mean: float, distribution: dict[str, Any]) -> np.ndarray:
    selected = distribution
    if distribution["family"] == "empirical_residual_mean_bucket":
        selected = distribution["fallback"]
        for bucket in distribution["buckets"]:
            if float(bucket["lower"]) <= mean <= float(bucket["upper"]):
                selected = bucket["distribution"]
                break
    if selected["family"] != "empirical_residual":
        raise RuntimeError("portable distribution is not empirical residual")
    return np.asarray(selected["residualQuantiles"], dtype=float)


def coherent_projection(
    independent: np.ndarray, line: np.ndarray, probability: np.ndarray, distribution: dict[str, Any],
) -> np.ndarray:
    output = np.empty(len(independent), dtype=float)
    for index, (mean, row_line, row_probability) in enumerate(
        zip(independent, line, probability, strict=True),
    ):
        residuals = selected_residuals(float(mean), distribution)
        quantile = lambda p: float(np.interp(  # noqa: E731 - compact mirror of runtime interpolation
            np.clip(p, 0.0, 1.0), np.linspace(0.0, 1.0, len(residuals)), residuals,
        ))
        location = row_line - quantile(1 - row_probability)
        output[index] = max(0.0, location + quantile(0.5))
    return output


def calibration_gap(y: np.ndarray, probabilities: np.ndarray) -> float:
    bins = pd.qcut(probabilities, q=10, duplicates="drop")
    grouped = pd.DataFrame({"p": probabilities, "y": y, "bin": bins}).groupby(
        "bin", observed=True,
    ).agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"))
    return float(np.average(abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"]))


def probability_metrics(y: np.ndarray, probabilities: np.ndarray) -> dict[str, float | int]:
    predicted = probabilities >= 0.5
    return {
        "rows": int(len(y)), "directionWins": int(np.sum(predicted == y)),
        "directionAccuracy": float(np.mean(predicted == y)),
        "brier": float(brier_score_loss(y, probabilities)),
        "logLoss": float(log_loss(y, probabilities)),
        "calibrationGap": calibration_gap(y, probabilities),
    }


def point_metrics(y: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(y)), "mae": float(np.mean(abs(prediction - y))),
        "rmse": float(math.sqrt(np.mean((prediction - y) ** 2))),
        "bias": float(np.mean(prediction - y)),
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
        "ciLow": float(np.quantile(draws, 0.025)), "ciHigh": float(np.quantile(draws, 0.975)),
        "gameClusters": int(len(values)),
    }


def load_history(manifest_path: pathlib.Path, source_manifest: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any], pathlib.Path]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    history_path = pathlib.Path(str(manifest["featureFile"]))
    if not history_path.exists() or sha256_file(history_path) != manifest["featureFileSha256"]:
        raise RuntimeError("historical NFL props checksum mismatch")
    baseline = load_module("all_market_independent_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("all_market_independent_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    matchup.SOURCE_MANIFEST = source_manifest
    history, _ = baseline.prepare_features(pd.read_parquet(history_path), manifest)
    matchup_rows, _ = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, _ = matchup.game_environment(manifest)
    history = history.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    history = history.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    return history, manifest, history_path


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
        if int(nearest.iloc[0]["date_delta"]) <= 1 and (
            len(nearest) == 1 or nearest.iloc[0]["date_delta"] < nearest.iloc[1]["date_delta"]
        ):
            mapping[str(game["id"])] = str(nearest.iloc[0]["game_id"])
    if len(mapping) < 260:
        raise RuntimeError(f"opening/history game identity coverage is low: {len(mapping)}")
    return mapping


def market_rows(
    history: pd.DataFrame, observations: pd.DataFrame, game_map: dict[str, str],
    market: str, artifact: dict[str, Any],
) -> tuple[pd.DataFrame, dict[str, int]]:
    holdout = history[history["season"].eq(2025) & history["participated"].eq(1)].copy()
    holdout["_name"] = holdout["player_name"].astype(str).map(normalized_name)
    holdout["independent_projection"] = predict_model(artifact["model"], holdout)
    offers = observations[
        observations["market"].eq(market) & observations["offerType"].eq("over_under")
        & observations["side"].isin(["over", "under"])
    ].copy()
    offers["game_id"] = offers["providerEventId"].astype(str).map(game_map)
    offers["_name"] = offers["playerName"].astype(str).map(normalized_name)
    offers = offers.dropna(subset=["game_id"])
    keys = ["game_id", "_name", "playerName", "sportsbook", "market", "line", "observedAt"]
    paired = offers.pivot_table(index=keys, columns="side", values="americanPrice", aggfunc="last").reset_index()
    paired = paired.dropna(subset=["over", "under"])
    paired[["over", "under"]] = paired[["over", "under"]].astype(int)
    joined = paired.merge(
        holdout[["game_id", "game_date", "_name", "player_name", market, "independent_projection"]],
        on=["game_id", "_name"], how="inner", validate="many_to_one",
    )
    over_implied = joined["over"].map(implied_probability)
    under_implied = joined["under"].map(implied_probability)
    joined["book_over_probability"] = over_implied / (over_implied + under_implied)
    scope = ["game_id", "_name", "market", "line"]
    group = joined.groupby(scope, observed=True)["book_over_probability"]
    joined["independent_book_count"] = group.transform("count") - 1
    joined["market_over_probability"] = (
        group.transform("sum") - joined["book_over_probability"]
    ) / joined["independent_book_count"].replace(0, np.nan)
    joined = joined[joined["independent_book_count"].ge(1)].sort_values(
        [*scope, "over", "sportsbook"], ascending=[True, True, True, True, False, True],
    ).drop_duplicates(scope, keep="first")
    joined["model_over_probability"] = empirical_over_probability(
        joined["independent_projection"].to_numpy(float), joined["line"].to_numpy(float), artifact["distribution"],
    )
    joined["outcome_over"] = joined[market].gt(joined["line"]).astype(int)
    joined["actual_value"] = joined[market].astype(float)
    joined["push"] = joined[market].eq(joined["line"])
    joined = joined[~joined["push"]].copy()
    return joined, {
        "marketObservations": int(len(offers)), "pairedOffers": int(len(paired)),
        "evaluatedScopes": int(len(joined)),
    }


def evaluate(rows: pd.DataFrame, distribution: dict[str, Any]) -> dict[str, Any]:
    rows["date"] = pd.to_datetime(rows["game_date"]).dt.date
    selection = rows[rows["date"].le(SELECTION_END)].copy()
    confirmation = rows[rows["date"].ge(CONFIRMATION_START)].copy()
    scores: dict[str, Any] = {}
    point_scores: dict[str, Any] = {}
    for weight in WEIGHTS:
        label = f"{weight:.2f}"
        scores[label] = {}
        point_scores[label] = {}
        for split_name, split in (("selection", selection), ("confirmation", confirmation)):
            probability = residual_probability(
                split["model_over_probability"], split["market_over_probability"], weight,
            )
            scores[label][split_name] = probability_metrics(split["outcome_over"].to_numpy(int), probability)
            point_scores[label][split_name] = point_metrics(
                split["actual_value"].to_numpy(float),
                coherent_projection(
                    split["independent_projection"].to_numpy(float), split["line"].to_numpy(float),
                    probability, distribution,
                ),
            )
    incumbent = scores["0.20"]["selection"]
    eligible = [weight for weight in SHIPPABLE_WEIGHTS if (
        scores[f"{weight:.2f}"]["selection"]["brier"] < incumbent["brier"]
        and scores[f"{weight:.2f}"]["selection"]["logLoss"] < incumbent["logLoss"]
    )]
    selected = min(eligible, key=lambda weight: scores[f"{weight:.2f}"]["selection"]["brier"]) if eligible else None
    passes = False
    uncertainty = None
    if selected is not None:
        candidate = scores[f"{selected:.2f}"]["confirmation"]
        reference = scores["0.20"]["confirmation"]
        passes = bool(
            candidate["brier"] < reference["brier"] and candidate["logLoss"] < reference["logLoss"]
            and candidate["directionAccuracy"] >= reference["directionAccuracy"]
            and candidate["calibrationGap"] <= reference["calibrationGap"] + 0.005
        )
        uncertainty = clustered_brier_delta(
            confirmation,
            residual_probability(confirmation["model_over_probability"], confirmation["market_over_probability"], selected),
            residual_probability(confirmation["model_over_probability"], confirmation["market_over_probability"], 0.20),
        )
    return {
        "chronology": {"selectionRows": int(len(selection)), "confirmationRows": int(len(confirmation))},
        "weights": scores,
        "singleMarketPosteriorPointWeights": point_scores,
        "selection": {"eligibleIndependentFirstWeights": eligible, "selectedWeight": selected,
                      "passesConfirmation": passes, "clusteredConfirmationBrierDelta": uncertainty},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=pathlib.Path)
    parser.add_argument("--source-manifest", required=True, type=pathlib.Path)
    parser.add_argument("--openings", required=True, type=pathlib.Path)
    parser.add_argument("--artifact-root", default=ROOT / "lib/services/football/modelArtifacts", type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()
    history, manifest, history_path = load_history(args.manifest, args.source_manifest)
    openings = json.loads(args.openings.read_text(encoding="utf-8"))
    observations = pd.DataFrame(openings["observations"])
    game_map = build_game_map(history, openings)
    report: dict[str, Any] = {}
    for market in MARKETS:
        print(f"independent-first {market}...", flush=True)
        artifact_path = args.artifact_root / ARTIFACT_NAMES[market]
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        rows, coverage = market_rows(history, observations, game_map, market, artifact)
        if len(rows) < 200:
            report[market] = {"coverage": coverage, "status": "insufficient_exact_opening_rows"}
            continue
        result = evaluate(rows, artifact["distribution"])
        unique = rows.drop_duplicates(["game_id", "_name"])
        error = unique["independent_projection"].to_numpy(float) - unique[market].to_numpy(float)
        report[market] = {
            "coverage": coverage, **result,
            "joinedIndependentPoint": {
                "rows": int(len(unique)), "mae": float(np.mean(abs(error))),
                "rmse": float(math.sqrt(np.mean(error ** 2))), "bias": float(np.mean(error)),
            },
            "artifactSha256": sha256_file(artifact_path),
        }
    output = {
        "release": "nfl_player_props_independent_first_all_markets_2026_10_08_r1",
        "readOnly": True, "writes": 0, "providerCalls": 0,
        "gameMappings": len(game_map),
        "chronology": {"selectionEnd": str(SELECTION_END), "confirmationStart": str(CONFIRMATION_START)},
        "checksums": {"manifest": sha256_file(args.manifest), "history": sha256_file(history_path),
                      "openings": sha256_file(args.openings)},
        "sourceReleases": {"openings": openings["release"], "history": manifest.get("datasetRelease")},
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {market: {
            "coverage": values.get("coverage"), "chronology": values.get("chronology"),
            "selection": values.get("selection"), "status": values.get("status"),
        } for market, values in report.items()},
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
