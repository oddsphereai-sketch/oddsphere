#!/usr/bin/env python3
"""Independent NFL passing-touchdown count-model tournament.

Model selection is locked on 2025. The winner is refit through 2025 and scored
on 2026 Weeks 2-5, with OddSphere's two captured Week 5 games reported as a
separate four-quarterback slice. No market feature, price, or line is loaded.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import poisson
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import PoissonRegressor
from sklearn.metrics import mean_absolute_error, mean_poisson_deviance, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


RELEASE = "nfl_player_props_passing_touchdowns_tournament_2026_10_15_r1"
LINES = (0.5, 1.5, 2.5, 3.5)
CAPTURED_GAMES = {"2026_05_TB_DAL", "2026_05_BUF_LA"}


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--historical-root", type=Path, required=True)
    parser.add_argument("--current-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rows-output", type=Path)
    return parser.parse_args()


def main() -> None:
    cli = args()
    features = pd.read_parquet(cli.features)
    stats = load_years(cli.historical_root, cli.current_root, "player_stats", range(2016, 2027))
    pbp = load_years(cli.historical_root, cli.current_root, "pbp", range(2016, 2027), columns=PBP_COLUMNS)
    frame = build_frame(features, stats, pbp)

    train = frame[(frame["season"] >= 2017) & (frame["season"] <= 2024)].copy()
    validation = frame[frame["season"] == 2025].copy()
    current = frame[(frame["season"] == 2026) & (frame["week"].between(2, 5))].copy()
    captured = current[current["game_id"].isin(CAPTURED_GAMES)].copy()
    if len(captured) != 4:
        raise RuntimeError(f"Expected four captured-game quarterbacks; found {len(captured)}")

    feature_columns = model_features(frame)
    foundation_validation = foundation_mean(validation)
    validation_predictions = {"foundation": foundation_validation}
    fitted = fit_models(train, feature_columns)
    for name, model in fitted.items():
        validation_predictions[name] = clipped(model.predict(validation[feature_columns]))
    validation_metrics = {
        name: metrics(validation["passing_tds"].to_numpy(float), prediction)
        for name, prediction in validation_predictions.items()
    }
    candidates = ["poisson_glm", "poisson_hgb"]
    selected = sorted(candidates, key=lambda name: (
        validation_metrics[name]["meanPoissonDeviance"],
        validation_metrics[name]["averageThresholdBrier"],
        validation_metrics[name]["mae"],
        name,
    ))[0]

    through_2025 = pd.concat([train, validation], ignore_index=True)
    final_models = fit_models(through_2025, feature_columns)
    current_predictions = {"foundation": foundation_mean(current)}
    captured_predictions = {"foundation": foundation_mean(captured)}
    for name, model in final_models.items():
        current_predictions[name] = clipped(model.predict(current[feature_columns]))
        captured_predictions[name] = clipped(model.predict(captured[feature_columns]))
    current_metrics = {
        name: metrics(current["passing_tds"].to_numpy(float), prediction)
        for name, prediction in current_predictions.items()
    }
    captured_metrics = {
        name: metrics(captured["passing_tds"].to_numpy(float), prediction)
        for name, prediction in captured_predictions.items()
    }
    gate = advancement_gate(current_metrics["foundation"], current_metrics[selected], captured_metrics[selected])

    scored_rows = []
    for index, row in current.reset_index(drop=True).iterrows():
        scored_rows.append({
            "season": int(row["season"]),
            "week": int(row["week"]),
            "gameId": row["game_id"],
            "playerId": row["player_id"],
            "playerName": row["player_name"],
            "team": row["team"],
            "opponent": row["opponent"],
            "actualPassingTouchdowns": int(row["passing_tds"]),
            "capturedGame": bool(row["game_id"] in CAPTURED_GAMES),
            "projections": {name: float(values[index]) for name, values in current_predictions.items()},
        })

    result = {
        "release": RELEASE,
        "readOnly": True,
        "productionWrites": 0,
        "marketFeatures": [],
        "marketOfferRows": 0,
        "modelSelectionSeason": 2025,
        "primaryEvaluation": {"season": 2026, "weeks": [2, 3, 4, 5]},
        "capturedGameIds": sorted(CAPTURED_GAMES),
        "data": {
            "trainRows": len(train),
            "validationRows": len(validation),
            "currentSeasonRows": len(current),
            "capturedGameRows": len(captured),
            "featureCount": len(feature_columns),
            "eligibility": "pregame depth starter OR prior attempts avg3/ewm >= 12; official participant required for settlement",
        },
        "features": feature_columns,
        "validation2025": validation_metrics,
        "selection": {
            "winner": selected,
            "criterion": "minimum 2025 mean Poisson deviance; average threshold Brier then MAE tiebreakers",
        },
        "currentSeason2026Weeks2To5": current_metrics,
        "currentSeasonPairedGameBootstrap95": paired_game_bootstrap(
            current["passing_tds"].to_numpy(float),
            current_predictions["foundation"],
            current_predictions[selected],
            current["game_id"].astype(str).to_numpy(),
        ),
        "capturedWeek5Games": captured_metrics,
        "dispersion": dispersion_audit(current["passing_tds"].to_numpy(float), current_predictions[selected]),
        "advancement": gate,
        "limitations": [
            "No release-pure passing-touchdown offer or price was retained in the Week 5 private archive/market observer.",
            "The two-game OddSphere archive slice contains only four quarterbacks.",
            "Weeks 1-4 lack full private-board archives; current-season count accuracy is official-outcome research, not an economic replay.",
            "Route-level receiver inputs are unavailable, but this quarterback/team red-zone architecture does not require them.",
        ],
        "capturedRows": [row for row in scored_rows if row["capturedGame"]],
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    if cli.rows_output:
        pd.DataFrame(scored_rows).to_json(cli.rows_output, orient="records", indent=2)
    print(json.dumps({
        "release": RELEASE,
        "selection": result["selection"],
        "validation2025": validation_metrics,
        "currentSeason2026Weeks2To5": current_metrics,
        "capturedWeek5Games": captured_metrics,
        "advancement": gate,
        "capturedRows": result["capturedRows"],
    }, indent=2))


PBP_COLUMNS = [
    "season", "week", "game_id", "posteam", "defteam", "play_type", "pass_attempt",
    "pass_touchdown", "yardline_100", "goal_to_go", "qb_dropback", "qb_scramble",
    "sack", "aborted_play",
]


def load_years(historical: Path, current: Path, family: str, years, columns=None) -> pd.DataFrame:
    rows = []
    for year in years:
        path = (current / family / f"{year}.parquet") if year == 2026 else (historical / family / f"{year}.parquet")
        if not path.exists():
            raise FileNotFoundError(path)
        rows.append(pd.read_parquet(path, columns=columns))
    return pd.concat(rows, ignore_index=True)


def build_frame(features: pd.DataFrame, stats: pd.DataFrame, pbp: pd.DataFrame) -> pd.DataFrame:
    features = features.copy()
    features = features[(features["position"] == "QB") & features["player_id"].notna()].copy()
    stats = stats[(stats["position"] == "QB") & (pd.to_numeric(stats["attempts"], errors="coerce") > 0)].copy()
    stats = stats[[
        "season", "week", "game_id", "player_id", "player_display_name", "team", "opponent_team",
        "attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions",
    ]].drop_duplicates(["season", "week", "game_id", "player_id"])
    history = touchdown_history(stats)
    redzone = redzone_history(pbp)
    frame = features.merge(
        stats[["season", "week", "game_id", "player_id", "passing_tds", "attempts"]],
        on=["season", "week", "game_id", "player_id"], how="inner", suffixes=("", "_actual"),
    )
    frame = frame.merge(history, on=["season", "week", "game_id", "player_id"], how="left")
    frame = frame.merge(redzone, on=["season", "week", "game_id", "team"], how="left")
    starter = pd.to_numeric(frame.get("external_depth_starter"), errors="coerce").fillna(0).eq(1)
    prior_avg3 = pd.to_numeric(frame["prior_passing_attempts_avg3"], errors="coerce").fillna(0)
    prior_ewm = pd.to_numeric(frame["prior_passing_attempts_ewm"], errors="coerce").fillna(0)
    frame = frame[starter | prior_avg3.ge(12) | prior_ewm.ge(12)].copy()
    return frame.sort_values(["season", "week", "game_id", "team", "player_id"]).reset_index(drop=True)


def touchdown_history(stats: pd.DataFrame) -> pd.DataFrame:
    stats = stats.sort_values(["player_id", "season", "week", "game_id"]).copy()
    for window in (3, 5):
        stats[f"prior_qb_tds_avg{window}"] = grouped_rolling(stats, "player_id", "passing_tds", window, "mean")
        prior_tds = grouped_rolling(stats, "player_id", "passing_tds", window, "sum")
        prior_atts = grouped_rolling(stats, "player_id", "attempts", window, "sum")
        stats[f"prior_qb_td_rate{window}"] = shrunk_rate(prior_tds, prior_atts, 0.045, 80)
    stats["prior_qb_tds_ewm"] = stats.groupby("player_id", sort=False)["passing_tds"].transform(
        lambda values: values.shift().ewm(alpha=0.4, adjust=False).mean()
    )

    team = stats.groupby(["season", "week", "game_id", "team", "opponent_team"], as_index=False).agg(
        team_pass_tds=("passing_tds", "sum"), team_pass_attempts=("attempts", "sum")
    ).sort_values(["season", "team", "week", "game_id"])
    team_history = team_rates(team, "team", "team_pass_tds", "team_pass_attempts", "prior_team")
    defense = team.rename(columns={"team": "offense", "opponent_team": "team"}).copy()
    defense_history = team_rates(defense, "team", "team_pass_tds", "team_pass_attempts", "prior_opponent_allowed")
    defense_history = defense_history.rename(columns={"offense": "opponent_team"})
    keys = ["season", "week", "game_id", "team"]
    result = stats[["season", "week", "game_id", "player_id", "team", "opponent_team",
                    "prior_qb_tds_avg3", "prior_qb_tds_avg5", "prior_qb_tds_ewm",
                    "prior_qb_td_rate3", "prior_qb_td_rate5"]]
    result = result.merge(team_history.drop(columns=["opponent_team"]), on=keys, how="left")
    result = result.merge(
        defense_history.drop(columns=["team"]).rename(columns={"opponent_team": "team"}),
        on=keys, how="left",
    )
    return result.drop(columns=["team", "opponent_team"])


def team_rates(frame: pd.DataFrame, group: str, td_column: str, attempt_column: str, prefix: str) -> pd.DataFrame:
    frame = frame.sort_values(["season", group, "week", "game_id"]).copy()
    for window in (3, 5):
        tds = frame.groupby(["season", group], sort=False)[td_column].transform(
            lambda values: values.shift().rolling(window, min_periods=1).sum()
        )
        attempts = frame.groupby(["season", group], sort=False)[attempt_column].transform(
            lambda values: values.shift().rolling(window, min_periods=1).sum()
        )
        frame[f"{prefix}_pass_tds_avg{window}"] = frame.groupby(["season", group], sort=False)[td_column].transform(
            lambda values: values.shift().rolling(window, min_periods=1).mean()
        )
        frame[f"{prefix}_td_rate{window}"] = shrunk_rate(tds, attempts, 0.045, 120)
    return frame.drop(columns=[td_column, attempt_column])


def redzone_history(pbp: pd.DataFrame) -> pd.DataFrame:
    pbp = pbp.copy()
    valid = pbp["posteam"].notna() & pbp["defteam"].notna() & ~pd.to_numeric(
        pbp["aborted_play"], errors="coerce"
    ).fillna(0).eq(1)
    pbp = pbp[valid].copy()
    pbp["is_play"] = pbp["play_type"].isin(["pass", "run"]).astype(int)
    pbp["is_pass"] = pd.to_numeric(pbp["pass_attempt"], errors="coerce").fillna(0).eq(1).astype(int)
    pbp["pass_td"] = pd.to_numeric(pbp["pass_touchdown"], errors="coerce").fillna(0).eq(1).astype(int)
    pbp["redzone"] = pd.to_numeric(pbp["yardline_100"], errors="coerce").le(20).astype(int)
    pbp["goal_to_go_flag"] = pd.to_numeric(pbp["goal_to_go"], errors="coerce").fillna(0).eq(1).astype(int)
    pbp["rz_play"] = pbp["is_play"] * pbp["redzone"]
    pbp["rz_pass"] = pbp["is_pass"] * pbp["redzone"]
    pbp["rz_pass_td"] = pbp["pass_td"] * pbp["redzone"]
    pbp["g2g_play"] = pbp["is_play"] * pbp["goal_to_go_flag"]
    pbp["g2g_pass"] = pbp["is_pass"] * pbp["goal_to_go_flag"]
    pbp["g2g_pass_td"] = pbp["pass_td"] * pbp["goal_to_go_flag"]
    game = pbp.groupby(["season", "week", "game_id", "posteam", "defteam"], as_index=False).agg(
        rz_plays=("rz_play", "sum"), rz_pass_attempts=("rz_pass", "sum"), rz_pass_tds=("rz_pass_td", "sum"),
        g2g_plays=("g2g_play", "sum"), g2g_pass_attempts=("g2g_pass", "sum"), g2g_pass_tds=("g2g_pass_td", "sum"),
    ).rename(columns={"posteam": "team", "defteam": "opponent"})
    offense = rolling_redzone(game, "team", "prior_team_rz")
    defense_base = game.rename(columns={"team": "offense", "opponent": "team"})
    defense = rolling_redzone(defense_base, "team", "prior_opponent_allowed_rz").rename(columns={"offense": "opponent"})
    keys = ["season", "week", "game_id", "team"]
    return offense.drop(columns=["opponent"]).merge(
        defense.drop(columns=["team"]).rename(columns={"opponent": "team"}), on=keys, how="left"
    )


def rolling_redzone(frame: pd.DataFrame, group: str, prefix: str) -> pd.DataFrame:
    frame = frame.sort_values(["season", group, "week", "game_id"]).copy()
    output = frame[["season", "week", "game_id", group, "opponent" if group == "team" and "opponent" in frame else "offense"]].copy()
    grouping = ["season", group]
    for window in (3, 5):
        totals = {}
        for column in ("rz_plays", "rz_pass_attempts", "rz_pass_tds", "g2g_plays", "g2g_pass_attempts", "g2g_pass_tds"):
            totals[column] = frame.groupby(grouping, sort=False)[column].transform(
                lambda values: values.shift().rolling(window, min_periods=1).sum()
            )
        output[f"{prefix}_pass_attempts_avg{window}"] = totals["rz_pass_attempts"] / window
        output[f"{prefix}_pass_rate{window}"] = safe_ratio(totals["rz_pass_attempts"], totals["rz_plays"])
        output[f"{prefix}_pass_td_rate{window}"] = shrunk_rate(
            totals["rz_pass_tds"], totals["rz_pass_attempts"], 0.22, 15
        )
        output[f"{prefix}_g2g_pass_rate{window}"] = safe_ratio(totals["g2g_pass_attempts"], totals["g2g_plays"])
        output[f"{prefix}_g2g_pass_td_rate{window}"] = shrunk_rate(
            totals["g2g_pass_tds"], totals["g2g_pass_attempts"], 0.30, 10
        )
    return output


def grouped_rolling(frame: pd.DataFrame, group: str, column: str, window: int, operation: str) -> pd.Series:
    grouped = frame.groupby(group, sort=False)[column]
    return grouped.transform(lambda values: getattr(values.shift().rolling(window, min_periods=1), operation)())


def shrunk_rate(successes: pd.Series, attempts: pd.Series, prior: float, strength: float) -> pd.Series:
    return (pd.to_numeric(successes, errors="coerce").fillna(0) + prior * strength) / (
        pd.to_numeric(attempts, errors="coerce").fillna(0) + strength
    )


def safe_ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    denominator = pd.to_numeric(denominator, errors="coerce")
    return pd.to_numeric(numerator, errors="coerce") / denominator.where(denominator > 0)


def model_features(frame: pd.DataFrame) -> list[str]:
    requested = [
        "prior_passing_attempts_avg3", "prior_passing_attempts_avg5", "prior_passing_attempts_ewm",
        "prior_passing_completions_avg3", "prior_passing_completions_ewm",
        "prior_passing_yards_avg3", "prior_passing_yards_ewm",
        "prior_qb_tds_avg3", "prior_qb_tds_avg5", "prior_qb_tds_ewm", "prior_qb_td_rate3", "prior_qb_td_rate5",
        "prior_team_pass_attempts_avg3", "prior_team_pass_attempts_ewm",
        "prior_opponent_allowed_pass_attempts_avg3", "prior_opponent_allowed_pass_attempts_ewm",
        "prior_team_pass_tds_avg3", "prior_team_pass_tds_avg5", "prior_team_td_rate3", "prior_team_td_rate5",
        "prior_opponent_allowed_pass_tds_avg3", "prior_opponent_allowed_pass_tds_avg5",
        "prior_opponent_allowed_td_rate3", "prior_opponent_allowed_td_rate5",
        "prior_team_rz_pass_attempts_avg3", "prior_team_rz_pass_rate3", "prior_team_rz_pass_td_rate3",
        "prior_team_rz_g2g_pass_rate3", "prior_team_rz_g2g_pass_td_rate3",
        "prior_opponent_allowed_rz_pass_attempts_avg3", "prior_opponent_allowed_rz_pass_rate3",
        "prior_opponent_allowed_rz_pass_td_rate3", "prior_opponent_allowed_rz_g2g_pass_rate3",
        "prior_opponent_allowed_rz_g2g_pass_td_rate3",
        "external_state_team_plays_avg3", "external_state_team_dropback_rate_avg3",
        "external_state_team_pass_oe_avg3", "external_state_team_neutral_pass_rate_avg3",
        "external_state_team_early_down_pass_rate_avg3", "external_state_team_no_huddle_rate_avg3",
        "external_state_team_air_yards_per_attempt_avg3", "external_state_team_xyac_per_completion_avg3",
        "external_state_opponent_allowed_plays_avg3", "external_state_opponent_allowed_dropback_rate_avg3",
        "external_state_opponent_allowed_pass_oe_avg3", "external_state_opponent_allowed_qb_hit_rate_avg3",
        "external_state_opponent_allowed_sack_rate_avg3", "external_state_opponent_allowed_air_yards_per_attempt_avg3",
        "external_ngs_passing_avg_time_to_throw_ewm", "external_ngs_passing_avg_intended_air_yards_ewm",
        "external_ngs_passing_completion_percentage_above_expectation_ewm",
        "external_pfr_pass_times_pressured_pct_ewm", "external_pfr_pass_passing_bad_throw_pct_ewm",
        "external_environment_temperature_f", "external_environment_wind_mph", "external_environment_outdoor",
        "is_home", "external_depth_starter",
    ]
    return [column for column in requested if column in frame]


def foundation_mean(frame: pd.DataFrame) -> np.ndarray:
    attempts = row_mean(frame, [
        "prior_passing_attempts_avg3", "prior_passing_attempts_ewm", "prior_team_pass_attempts_avg3",
        "prior_team_pass_attempts_ewm", "prior_opponent_allowed_pass_attempts_avg3",
        "prior_opponent_allowed_pass_attempts_ewm",
    ], fallback=31.5)
    qb_rate = row_mean(frame, ["prior_qb_td_rate3", "prior_qb_td_rate5"], fallback=0.045)
    team_rate = row_mean(frame, ["prior_team_td_rate3", "prior_team_td_rate5"], fallback=0.045)
    opponent_rate = row_mean(frame, ["prior_opponent_allowed_td_rate3", "prior_opponent_allowed_td_rate5"], fallback=0.045)
    rate = 0.50 * qb_rate + 0.30 * team_rate + 0.20 * opponent_rate
    return clipped(attempts * rate)


def row_mean(frame: pd.DataFrame, columns: list[str], fallback: float) -> np.ndarray:
    present = [column for column in columns if column in frame]
    if not present:
        return np.full(len(frame), fallback)
    values = frame[present].apply(pd.to_numeric, errors="coerce").mean(axis=1).fillna(fallback)
    return values.to_numpy(float)


def fit_models(frame: pd.DataFrame, feature_columns: list[str]):
    x = frame[feature_columns]
    y = frame["passing_tds"].to_numpy(float)
    glm = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", PoissonRegressor(alpha=4.0, max_iter=2_000, tol=1e-7)),
    ])
    hgb = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", HistGradientBoostingRegressor(
            loss="poisson", learning_rate=0.035, max_iter=250, max_leaf_nodes=15,
            max_depth=4, min_samples_leaf=60, l2_regularization=12.0, random_state=20261015,
        )),
    ])
    glm.fit(x, y)
    hgb.fit(x, y)
    return {"poisson_glm": glm, "poisson_hgb": hgb}


def clipped(values) -> np.ndarray:
    return np.clip(np.asarray(values, dtype=float), 0.02, 6.0)


def metrics(actual: np.ndarray, prediction: np.ndarray) -> dict:
    prediction = clipped(prediction)
    threshold = {}
    for line in LINES:
        probability = 1.0 - poisson.cdf(math.floor(line), prediction)
        observed = (actual > line).astype(float)
        threshold[str(line)] = {
            "brier": float(np.mean(np.square(probability - observed))),
            "logLoss": float(np.mean(-(observed * np.log(np.clip(probability, 1e-9, 1 - 1e-9))
                + (1 - observed) * np.log(np.clip(1 - probability, 1e-9, 1 - 1e-9))))),
            "observedRate": float(np.mean(observed)),
            "meanProbability": float(np.mean(probability)),
        }
    log_score = -poisson.logpmf(actual.astype(int), prediction)
    return {
        "rows": len(actual),
        "meanActual": float(np.mean(actual)),
        "meanProjection": float(np.mean(prediction)),
        "mae": float(mean_absolute_error(actual, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(actual, prediction))),
        "meanPoissonDeviance": float(mean_poisson_deviance(actual, prediction)),
        "meanPoissonLogScore": float(np.mean(log_score)),
        "averageThresholdBrier": float(np.mean([value["brier"] for value in threshold.values()])),
        "thresholds": threshold,
    }


def advancement_gate(foundation: dict, candidate: dict, captured: dict) -> dict:
    threshold_wins = sum(
        candidate["thresholds"][str(line)]["brier"] < foundation["thresholds"][str(line)]["brier"]
        for line in LINES
    )
    checks = {
        "poissonDevianceImproves": candidate["meanPoissonDeviance"] < foundation["meanPoissonDeviance"],
        "maeImproves": candidate["mae"] < foundation["mae"],
        "averageThresholdBrierImproves": candidate["averageThresholdBrier"] < foundation["averageThresholdBrier"],
        "thresholdBrierWinsAtLeastThree": threshold_wins >= 3,
        "capturedSliceNoCatastrophicError": captured["mae"] <= 2.0 and captured["meanPoissonDeviance"] <= 4.0,
    }
    accuracy_pass = all(checks.values())
    return {
        "accuracyGatePass": accuracy_pass,
        "productionAuthorized": False,
        "checks": checks,
        "thresholdBrierWins": threshold_wins,
        "reason": "Exact release-pure passing-TD offers/prices were not captured; accuracy alone cannot establish economic actionability."
        if accuracy_pass else "The selected candidate did not clear every predeclared current-season accuracy gate.",
    }


def dispersion_audit(actual: np.ndarray, prediction: np.ndarray) -> dict:
    residual = actual - prediction
    return {
        "actualMean": float(np.mean(actual)),
        "actualVariance": float(np.var(actual, ddof=1)),
        "residualVariance": float(np.var(residual, ddof=1)),
        "meanPredictedPoissonVariance": float(np.mean(prediction)),
        "residualVarianceToPredictedMean": float(np.var(residual, ddof=1) / np.mean(prediction)),
    }


def paired_game_bootstrap(
    actual: np.ndarray,
    foundation: np.ndarray,
    candidate: np.ndarray,
    clusters: np.ndarray,
    iterations: int = 2_000,
) -> dict:
    unique = np.unique(clusters)
    indices = {cluster: np.flatnonzero(clusters == cluster) for cluster in unique}
    rng = np.random.default_rng(20261015)
    samples = {"maeDelta": [], "poissonDevianceDelta": [], "averageThresholdBrierDelta": []}
    for _ in range(iterations):
        selected = rng.choice(unique, size=len(unique), replace=True)
        take = np.concatenate([indices[cluster] for cluster in selected])
        y = actual[take]
        base = clipped(foundation[take])
        cand = clipped(candidate[take])
        samples["maeDelta"].append(float(np.mean(np.abs(y - cand)) - np.mean(np.abs(y - base))))
        base_deviance = poisson_deviance_rows(y, base)
        candidate_deviance = poisson_deviance_rows(y, cand)
        samples["poissonDevianceDelta"].append(float(np.mean(candidate_deviance - base_deviance)))
        samples["averageThresholdBrierDelta"].append(float(
            threshold_brier(y, cand) - threshold_brier(y, base)
        ))
    return {
        "clusters": len(unique),
        "iterations": iterations,
        "deltaDefinition": "candidate minus foundation; negative favors candidate",
        **{name: interval(values) for name, values in samples.items()},
    }


def poisson_deviance_rows(actual: np.ndarray, prediction: np.ndarray) -> np.ndarray:
    positive = actual > 0
    result = 2 * prediction.copy()
    result[positive] = 2 * (
        actual[positive] * np.log(actual[positive] / prediction[positive]) - actual[positive] + prediction[positive]
    )
    return result


def threshold_brier(actual: np.ndarray, prediction: np.ndarray) -> float:
    scores = []
    for line in LINES:
        probability = 1.0 - poisson.cdf(math.floor(line), prediction)
        observed = (actual > line).astype(float)
        scores.append(float(np.mean(np.square(probability - observed))))
    return float(np.mean(scores))


def interval(values: list[float]) -> dict:
    array = np.asarray(values, dtype=float)
    return {
        "mean": float(np.mean(array)),
        "ci": [float(np.quantile(array, 0.025)), float(np.quantile(array, 0.975))],
        "probabilityCandidateImproves": float(np.mean(array < 0)),
    }


if __name__ == "__main__":
    main()
