#!/usr/bin/env python3
"""Frozen CFB v1 independent-score tournament.

Reads only checksum-backed public historical parquet inputs. Every feature for
game G is materialized before G is applied to rolling state. Market columns are
kept outside the independent feature matrix and are used only for baselines and
the separately reported execution layer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.compose import TransformedTargetRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet, Ridge
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


RELEASE = "cfb_v1_independent_score_tournament_2026_08_25_r1"
FIT_SEASONS = (2021, 2022)
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
SEASONS = FIT_SEASONS + (SELECTION_SEASON,) + CONFIRMATION_SEASONS
SOURCE_DATASETS = (
    "adv_team",
    "adv_situational",
    "adv_drives",
    "adv_turnover",
    "adv_passing",
    "schedules",
    "betting",
    "rosters",
)

ROLLING_KEYS = (
    "points_for", "points_against", "margin", "total",
    "epa_play", "pass_epa", "rush_epa", "explosive", "success",
    "early_epa", "early_success", "red_zone_success", "third_success",
    "pace", "drives", "yards_drive", "field_position", "line_yards",
    "stuff_rate", "opportunity_rate", "special_teams_epa", "penalty_yards",
    "expected_turnovers", "turnover_luck", "qb_epa", "qb_success",
)


def finite(value: Any, default: float = np.nan) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def safe_div(numerator: Any, denominator: Any) -> float:
    n, d = finite(numerator), finite(denominator)
    return n / d if math.isfinite(n) and math.isfinite(d) and abs(d) > 1e-9 else np.nan


def normalized_name(value: Any) -> str:
    return " ".join(str(value or "").lower().replace("'", "").replace(".", "").split())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass
class TeamState:
    games: int = 0
    sums: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def observe(self, metrics: dict[str, float]) -> None:
        self.games += 1
        for key in ROLLING_KEYS:
            value = metrics.get(key, np.nan)
            if math.isfinite(value):
                self.sums[key] += value
                self.counts[key] += 1

    def mean(self, key: str) -> float:
        return self.sums[key] / self.counts[key] if self.counts[key] else np.nan


def read_sources(root: Path) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    frames: dict[str, list[pd.DataFrame]] = defaultdict(list)
    checksums: dict[str, str] = {}
    for dataset in SOURCE_DATASETS:
        for season in SEASONS:
            path = root / f"{dataset}_{season}.parquet"
            if not path.exists():
                raise FileNotFoundError(path)
            checksums[str(path)] = sha256(path)
            frame = pd.read_parquet(path)
            frame["season"] = season
            frames[dataset].append(frame)
    return {key: pd.concat(values, ignore_index=True) for key, values in frames.items()}, checksums


def team_game_metrics(frames: dict[str, pd.DataFrame]) -> dict[tuple[int, str], dict[str, float]]:
    adv = frames["adv_team"].copy()
    adv["game_id"] = adv["game_id"].astype(int)
    situ = frames["adv_situational"].copy()
    situ["game_id"] = situ["game_id"].astype(int)
    drives = frames["adv_drives"].copy()
    drives["game_id"] = drives["game_id"].astype(int)
    turnovers = frames["adv_turnover"].copy()
    turnovers["game_id"] = turnovers["game_id"].astype(int)
    passing = frames["adv_passing"].copy()
    passing["game_id"] = passing["game_id"].astype(int)
    passing["Att_num"] = pd.to_numeric(passing["Att"], errors="coerce").fillna(0)
    passing = passing.sort_values("Att_num").groupby(["game_id", "pos_team"], as_index=False).tail(1)

    joined = adv.merge(
        situ,
        on=["game_id", "season", "week", "pos_team_id", "pos_team"],
        how="left",
        suffixes=("", "_situ"),
    ).merge(
        drives,
        on=["game_id", "season", "week", "pos_team_id", "pos_team"],
        how="left",
        suffixes=("", "_drive"),
    ).merge(
        turnovers,
        on=["game_id", "season", "week", "pos_team_id", "pos_team"],
        how="left",
        suffixes=("", "_to"),
    ).merge(
        passing[["game_id", "pos_team", "qbr_epa", "SR", "Att_num", "passer_player_name"]],
        on=["game_id", "pos_team"],
        how="left",
        suffixes=("", "_qb"),
    )
    result: dict[tuple[int, str], dict[str, float]] = {}
    for row in joined.to_dict("records"):
        plays = finite(row.get("scrimmage_plays"))
        special_plays = finite(row.get("special_teams_plays"))
        result[(int(row["game_id"]), normalized_name(row["pos_team"]))] = {
            "epa_play": finite(row.get("EPA_per_play")),
            "pass_epa": finite(row.get("EPA_passing_per_play")),
            "rush_epa": finite(row.get("EPA_rushing_per_play")),
            "explosive": finite(row.get("EPA_explosive_rate")),
            "success": finite(row.get("first_downs_created_rate")),
            "early_epa": finite(row.get("EPA_early_down_per_play")),
            "early_success": finite(row.get("EPA_success_early_down_rate")),
            "red_zone_success": finite(row.get("EPA_success_rate_rz")),
            "third_success": finite(row.get("EPA_success_rate_third")),
            "pace": plays,
            "drives": finite(row.get("drives")),
            "yards_drive": finite(row.get("yards_per_drive")),
            "field_position": finite(row.get("avg_field_position")),
            "line_yards": finite(row.get("line_yards_per_carry")),
            "stuff_rate": finite(row.get("rushing_stuff_rate")),
            "opportunity_rate": finite(row.get("rushing_opportunity_rate")),
            "special_teams_epa": safe_div(row.get("EPA_special_teams"), special_plays),
            "penalty_yards": safe_div(row.get("penalty_yards"), plays),
            "expected_turnovers": finite(row.get("expected_turnovers")),
            "turnover_luck": finite(row.get("turnover_luck")),
            "qb_epa": safe_div(row.get("qbr_epa"), row.get("Att_num")),
            "qb_success": finite(row.get("SR_qb", row.get("SR"))),
            "quarterback": str(row.get("passer_player_name") or ""),
        }
    return result


def roster_context(rosters: pd.DataFrame, passing: pd.DataFrame) -> dict[tuple[int, str], dict[str, float]]:
    roster_sets: dict[tuple[int, str], set[str]] = {}
    experience: dict[tuple[int, str], float] = {}
    names: dict[tuple[int, str], set[str]] = {}
    for (season, team), rows in rosters.groupby(["season", "team_display_name"]):
        key = (int(season), normalized_name(team))
        roster_sets[key] = set(rows["athlete_id"].dropna().astype(str))
        names[key] = set(rows["athlete_display_name"].dropna().map(normalized_name))
        exp = pd.to_numeric(rows["experience_years"], errors="coerce")
        experience[key] = float(exp.mean()) if exp.notna().any() else np.nan
    passers = passing.copy()
    passers["Att_num"] = pd.to_numeric(passers["Att"], errors="coerce").fillna(0)
    prior_qb: dict[tuple[int, str], str] = {}
    for (season, team), rows in passers.groupby(["season", "pos_team"]):
        attempts = rows.groupby("passer_player_name", as_index=False)["Att_num"].sum().sort_values("Att_num")
        if len(attempts):
            prior_qb[(int(season), normalized_name(team))] = normalized_name(attempts.iloc[-1]["passer_player_name"])
    output: dict[tuple[int, str], dict[str, float]] = {}
    all_keys = sorted(roster_sets)
    for season, team in all_keys:
        current = roster_sets.get((season, team), set())
        previous = roster_sets.get((season - 1, team), set())
        union = current | previous
        qb = prior_qb.get((season - 1, team), "")
        output[(season, team)] = {
            "roster_continuity": len(current & previous) / len(union) if union else np.nan,
            "roster_experience": experience.get((season, team), np.nan),
            "returning_qb": float(bool(qb) and qb in names.get((season, team), set())),
        }
    return output


def blend_state(previous: TeamState | None, current: TeamState | None, key: str, global_mean: float) -> float:
    prior = previous.mean(key) if previous else np.nan
    if not math.isfinite(prior):
        prior = global_mean
    prior = 0.82 * prior + 0.18 * global_mean
    if not current or current.games == 0:
        return prior
    now = current.mean(key)
    if not math.isfinite(now):
        return prior
    weight = current.games / (current.games + 4.0)
    return weight * now + (1.0 - weight) * prior


def build_dataset(frames: dict[str, pd.DataFrame], future_games: pd.DataFrame | None = None) -> pd.DataFrame:
    schedules = frames["schedules"].copy()
    schedules = schedules[schedules["season_type"].isin([2, 3])]
    schedules["game_id"] = schedules["game_id"].astype(int)
    schedules["game_date"] = pd.to_datetime(schedules["game_date"], utc=True)
    schedules = schedules.sort_values(["game_date", "game_id"])
    betting = frames["betting"].copy()
    betting["game_id"] = betting["game_id"].astype(int)
    schedules = schedules.merge(betting[["game_id", "home_team_spread", "over_under", "odds_source"]], on="game_id", how="left")
    if future_games is not None and len(future_games):
        schedules = pd.concat([schedules, future_games], ignore_index=True, sort=False)
        schedules["game_date"] = pd.to_datetime(schedules["game_date"], utc=True)
        schedules = schedules.sort_values(["game_date", "game_id"])
    metrics = team_game_metrics(frames)
    personnel = roster_context(frames["rosters"], frames["adv_passing"])

    state: dict[tuple[int, str], TeamState] = defaultdict(TeamState)
    season_final: dict[tuple[int, str], TeamState] = {}
    elo: dict[str, float] = defaultdict(lambda: 1500.0)
    last_season: int | None = None
    last_played: dict[str, pd.Timestamp] = {}
    global_means = {key: 0.0 for key in ROLLING_KEYS}
    global_means.update({"points_for": 28.0, "points_against": 28.0, "margin": 0.0, "total": 56.0, "pace": 68.0, "drives": 12.0})
    rows: list[dict[str, Any]] = []

    for game in schedules.to_dict("records"):
        season = int(game["season"])
        if last_season is None or season != last_season:
            if last_season is not None:
                for (state_season, team), team_state in list(state.items()):
                    if state_season == last_season:
                        season_final[(last_season, team)] = team_state
                for team in list(elo):
                    elo[team] = 1500.0 + 0.72 * (elo[team] - 1500.0)
            last_season = season
        home = normalized_name(game["home_team"])
        away = normalized_name(game["away_team"])
        home_prev = season_final.get((season - 1, home))
        away_prev = season_final.get((season - 1, away))
        home_now = state.get((season, home))
        away_now = state.get((season, away))
        home_personnel = personnel.get((season, home), {})
        away_personnel = personnel.get((season, away), {})
        neutral = bool(game.get("neutral_site"))
        date = game["game_date"]
        home_rest = (date - last_played[home]).total_seconds() / 86400 if home in last_played else 14.0
        away_rest = (date - last_played[away]).total_seconds() / 86400 if away in last_played else 14.0
        feature: dict[str, Any] = {
            "game_id": int(game["game_id"]), "season": season, "week": int(game["week"]),
            "game_date": date.isoformat(), "home_team": str(game["home_team"]), "away_team": str(game["away_team"]),
            "home_score": float(game["home_score"]), "away_score": float(game["away_score"]),
            "home_spread": finite(game.get("home_team_spread")), "market_total": finite(game.get("over_under")),
            "market_source": str(game.get("odds_source") or ""), "neutral": float(neutral),
            "home_field": 0.0 if neutral else 1.0,
            "elo_diff": elo[home] - elo[away] + (0.0 if neutral else 55.0),
            "elo_sum_strength": elo[home] + elo[away] - 3000.0,
            "rest_diff": max(-14.0, min(14.0, home_rest - away_rest)),
        }
        for key in ROLLING_KEYS:
            hv = blend_state(home_prev, home_now, key, global_means[key])
            av = blend_state(away_prev, away_now, key, global_means[key])
            feature[f"{key}_diff"] = hv - av
            feature[f"{key}_sum"] = hv + av
            feature[f"home_{key}"] = hv
            feature[f"away_{key}"] = av
        for key in ("roster_continuity", "roster_experience", "returning_qb"):
            hv = finite(home_personnel.get(key), np.nan)
            av = finite(away_personnel.get(key), np.nan)
            feature[f"{key}_diff"] = hv - av
            feature[f"{key}_sum"] = hv + av
        feature["home_prior_games"] = float(home_prev.games if home_prev else 0)
        feature["away_prior_games"] = float(away_prev.games if away_prev else 0)
        feature["home_current_games"] = float(home_now.games if home_now else 0)
        feature["away_current_games"] = float(away_now.games if away_now else 0)
        rows.append(feature)

        if not math.isfinite(home_score := finite(game.get("home_score"))) or not math.isfinite(away_score := finite(game.get("away_score"))):
            continue

        home_metric = dict(metrics.get((int(game["game_id"]), home), {}))
        away_metric = dict(metrics.get((int(game["game_id"]), away), {}))
        home_metric.update(points_for=home_score, points_against=away_score, margin=home_score-away_score, total=home_score+away_score)
        away_metric.update(points_for=away_score, points_against=home_score, margin=away_score-home_score, total=home_score+away_score)
        state[(season, home)].observe(home_metric)
        state[(season, away)].observe(away_metric)
        margin = home_score - away_score
        expectation = 1.0 / (1.0 + 10.0 ** (-(elo[home] - elo[away] + (0 if neutral else 55.0)) / 400.0))
        outcome = 1.0 if margin > 0 else 0.5 if margin == 0 else 0.0
        multiplier = math.log1p(abs(margin)) * (2.2 / ((elo[home] - elo[away]) * 0.001 + 2.2))
        delta = 24.0 * multiplier * (outcome - expectation)
        elo[home] += delta
        elo[away] -= delta
        last_played[home] = date
        last_played[away] = date
    return pd.DataFrame(rows)


META_COLUMNS = {
    "game_id", "season", "week", "game_date", "home_team", "away_team",
    "home_score", "away_score", "home_spread", "market_total", "market_source",
}


def model_families(seed: int) -> dict[str, Any]:
    numeric = lambda estimator: Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", estimator),
    ])
    return {
        "ridge": numeric(Ridge(alpha=24.0)),
        "elastic_net": numeric(ElasticNet(alpha=0.035, l1_ratio=0.15, max_iter=20000, random_state=seed)),
        "hist_gradient_boosting": Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("model", HistGradientBoostingRegressor(max_iter=260, learning_rate=0.045, max_leaf_nodes=15, min_samples_leaf=28, l2_regularization=4.0, random_state=seed)),
        ]),
    }


FOOTBALL_SCORE_SUPPORT = np.array([
    0, 2, 3, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
    58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76,
    77, 78, 79, 80,
])


def nearest_football_scores(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, FOOTBALL_SCORE_SUPPORT[0], FOOTBALL_SCORE_SUPPORT[-1])
    right = np.searchsorted(FOOTBALL_SCORE_SUPPORT, clipped, side="left")
    right = np.clip(right, 0, len(FOOTBALL_SCORE_SUPPORT) - 1)
    left = np.maximum(right - 1, 0)
    choose_left = np.abs(clipped - FOOTBALL_SCORE_SUPPORT[left]) <= np.abs(
        clipped - FOOTBALL_SCORE_SUPPORT[right]
    )
    return np.where(choose_left, FOOTBALL_SCORE_SUPPORT[left], FOOTBALL_SCORE_SUPPORT[right])


def probability_rows(pred_home: np.ndarray, pred_away: np.ndarray, residuals: np.ndarray, seed: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    samples = 4000
    picks = rng.integers(0, len(residuals), size=(len(pred_home), samples))
    home = np.clip(pred_home[:, None] + residuals[picks, 0], 0, 90)
    away = np.clip(pred_away[:, None] + residuals[picks, 1], 0, 90)
    home = nearest_football_scores(home)
    away = nearest_football_scores(away)
    win = ((home > away).mean(axis=1) + 0.5 * (home == away).mean(axis=1))
    return win, home.mean(axis=1), away.mean(axis=1), home, away


def ece(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for low, high in zip(edges[:-1], edges[1:]):
        mask = (p >= low) & (p < high if high < 1 else p <= high)
        if mask.any():
            total += mask.mean() * abs(y[mask].mean() - p[mask].mean())
    return float(total)


def metrics(frame: pd.DataFrame, ph: np.ndarray, pa: np.ndarray, prob: np.ndarray, sim_h: np.ndarray, sim_a: np.ndarray) -> dict[str, float]:
    ah = frame.home_score.to_numpy(float); aa = frame.away_score.to_numpy(float)
    actual_margin = ah - aa; actual_total = ah + aa
    pred_margin = ph - pa; pred_total = ph + pa
    y = (actual_margin > 0).astype(float)
    lo = np.quantile(sim_h + sim_a, 0.10, axis=1); hi = np.quantile(sim_h + sim_a, 0.90, axis=1)
    value = {
        "games": int(len(frame)),
        "home_mae": float(mean_absolute_error(ah, ph)), "away_mae": float(mean_absolute_error(aa, pa)),
        "team_score_mae": float((mean_absolute_error(ah, ph) + mean_absolute_error(aa, pa)) / 2),
        "margin_mae": float(mean_absolute_error(actual_margin, pred_margin)),
        "total_mae": float(mean_absolute_error(actual_total, pred_total)),
        "moneyline_brier": float(brier_score_loss(y, np.clip(prob, 1e-4, 1-1e-4))),
        "moneyline_log_loss": float(log_loss(y, np.clip(prob, 1e-4, 1-1e-4))),
        "moneyline_ece": ece(y, prob),
        "winner_accuracy": float(((prob >= 0.5) == (y > 0.5)).mean()),
        "total_interval_miss": float(((actual_total < lo) | (actual_total > hi)).mean()),
        "home_bias": float(np.mean(ph-ah)), "away_bias": float(np.mean(pa-aa)),
        "margin_bias": float(np.mean(pred_margin-actual_margin)), "total_bias": float(np.mean(pred_total-actual_total)),
        "team_score_pred_sd": float(np.std(np.concatenate([ph, pa]))),
        "team_score_actual_sd": float(np.std(np.concatenate([ah, aa]))),
        "margin_pred_sd": float(np.std(pred_margin)), "margin_actual_sd": float(np.std(actual_margin)),
        "total_pred_sd": float(np.std(pred_total)), "total_actual_sd": float(np.std(actual_total)),
    }
    market_mask = frame.home_spread.notna().to_numpy() & frame.market_total.notna().to_numpy()
    if market_mask.any():
        market_margin = -frame.loc[market_mask, "home_spread"].to_numpy(float)
        market_total = frame.loc[market_mask, "market_total"].to_numpy(float)
        market_home = (market_total + market_margin) / 2.0
        market_away = (market_total - market_margin) / 2.0
        forecast_team = np.concatenate([ph[market_mask], pa[market_mask]])
        value.update({
            "market_games": int(market_mask.sum()),
            "market_margin_sd": float(np.std(market_margin)),
            "market_total_sd": float(np.std(market_total)),
            "market_team_score_sd": float(np.std(np.concatenate([market_home, market_away]))),
            "margin_to_market_dispersion": float(np.std(pred_margin[market_mask]) / np.std(market_margin)),
            "total_to_market_dispersion": float(np.std(pred_total[market_mask]) / np.std(market_total)),
            "team_score_to_market_dispersion": float(np.std(forecast_team) / np.std(np.concatenate([market_home, market_away]))),
        })
    return value


def composite(value: dict[str, float]) -> float:
    return (value["team_score_mae"] / 14.0 + value["margin_mae"] / 18.0 + value["total_mae"] / 18.0 + value["moneyline_brier"] / 0.25 + value["total_interval_miss"] / 0.20) / 5.0


def baseline_predictions(train: pd.DataFrame, test: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    home_mean = float(train.home_score.mean()); away_mean = float(train.away_score.mean())
    strength = test.elo_diff.to_numpy(float) / 28.0
    total_context = (test.total_sum.to_numpy(float) - 112.0) * 0.12 if "total_sum" in test else np.zeros(len(test))
    return home_mean + 0.5 * strength + 0.25 * total_context, away_mean - 0.5 * strength + 0.25 * total_context


def run(args: argparse.Namespace) -> dict[str, Any]:
    root = Path(args.source_dir)
    frames, checksums = read_sources(root)
    data = build_dataset(frames)
    data = data.replace([np.inf, -np.inf], np.nan)
    features = sorted(column for column in data.columns if column not in META_COLUMNS)
    fit = data[data.season.isin(FIT_SEASONS)]
    selection = data[data.season == SELECTION_SEASON]
    if len(fit) < 1000 or len(selection) < 500:
        raise RuntimeError("CFB tournament has insufficient chronological rows")
    Xfit = fit[features]; Xsel = selection[features]
    candidates: dict[str, Any] = {}
    fitted: dict[str, tuple[Any, Any, np.ndarray]] = {}
    for name, estimator in model_families(args.seed).items():
        home_model = estimator
        away_model = model_families(args.seed + 1)[name]
        home_model.fit(Xfit, fit.home_score)
        away_model.fit(Xfit, fit.away_score)
        fit_residuals = np.column_stack([fit.home_score.to_numpy() - home_model.predict(Xfit), fit.away_score.to_numpy() - away_model.predict(Xfit)])
        ph = home_model.predict(Xsel); pa = away_model.predict(Xsel)
        prob, eph, epa, sh, sa = probability_rows(ph, pa, fit_residuals, args.seed)
        value = metrics(selection, eph, epa, prob, sh, sa)
        value["composite"] = composite(value)
        candidates[name] = value
        fitted[name] = (home_model, away_model, fit_residuals)
    # A deployable ridge/boosted ensemble is retained as a genuinely distinct family.
    ridge = fitted["ridge"]; boost = fitted["hist_gradient_boosting"]
    ph = 0.5 * ridge[0].predict(Xsel) + 0.5 * boost[0].predict(Xsel)
    pa = 0.5 * ridge[1].predict(Xsel) + 0.5 * boost[1].predict(Xsel)
    ensemble_residuals = np.column_stack([fit.home_score.to_numpy()-0.5*(ridge[0].predict(Xfit)+boost[0].predict(Xfit)), fit.away_score.to_numpy()-0.5*(ridge[1].predict(Xfit)+boost[1].predict(Xfit))])
    prob, eph, epa, sh, sa = probability_rows(ph, pa, ensemble_residuals, args.seed)
    candidates["ridge_boost_ensemble"] = metrics(selection, eph, epa, prob, sh, sa)
    candidates["ridge_boost_ensemble"]["composite"] = composite(candidates["ridge_boost_ensemble"])
    selected = min(candidates, key=lambda name: candidates[name]["composite"])

    baseline: dict[str, Any] = {}
    confirmation: dict[str, Any] = {}
    all_train = data[data.season <= SELECTION_SEASON]
    Xall = all_train[features]
    family = model_families(args.seed)[selected] if selected != "ridge_boost_ensemble" else None
    if selected == "ridge_boost_ensemble":
        hm1=model_families(args.seed)["ridge"]; am1=model_families(args.seed+1)["ridge"]
        hm2=model_families(args.seed)["hist_gradient_boosting"]; am2=model_families(args.seed+1)["hist_gradient_boosting"]
        hm1.fit(Xall,all_train.home_score);am1.fit(Xall,all_train.away_score);hm2.fit(Xall,all_train.home_score);am2.fit(Xall,all_train.away_score)
        predict=lambda X:(0.5*(hm1.predict(X)+hm2.predict(X)),0.5*(am1.predict(X)+am2.predict(X)))
        train_ph,train_pa=predict(Xall)
        export_models=None
    else:
        hm=family; am=model_families(args.seed+1)[selected]
        hm.fit(Xall,all_train.home_score);am.fit(Xall,all_train.away_score)
        predict=lambda X:(hm.predict(X),am.predict(X))
        train_ph,train_pa=predict(Xall)
        export_models=(hm,am)
    residuals=np.column_stack([all_train.home_score.to_numpy()-train_ph,all_train.away_score.to_numpy()-train_pa])
    for season in CONFIRMATION_SEASONS:
        test=data[data.season==season]; ph,pa=predict(test[features]); prob,eph,epa,sh,sa=probability_rows(ph,pa,residuals,args.seed+season)
        value=metrics(test,eph,epa,prob,sh,sa);value["composite"]=composite(value);confirmation[str(season)]=value
        bph,bpa=baseline_predictions(all_train,test); bprob,bh,ba,bsh,bsa=probability_rows(bph,bpa,residuals,args.seed+season+100)
        bvalue=metrics(test,bh,ba,bprob,bsh,bsa);bvalue["composite"]=composite(bvalue);baseline[str(season)]=bvalue
    bph,bpa=baseline_predictions(fit,selection); bprob,bh,ba,bsh,bsa=probability_rows(bph,bpa,fitted["ridge"][2],args.seed+99)
    baseline_selection=metrics(selection,bh,ba,bprob,bsh,bsa);baseline_selection["composite"]=composite(baseline_selection)

    selection_improvement=(baseline_selection["composite"]-candidates[selected]["composite"])/baseline_selection["composite"]
    gates={
        "selection_improvement_2pct": selection_improvement>=0.02,
        "confirmation_composite_stability": all(confirmation[str(s)]["composite"]<=baseline[str(s)]["composite"]*1.02 for s in CONFIRMATION_SEASONS),
        "confirmation_component_breadth": all(sum(confirmation[str(s)][k]<baseline[str(s)][k] for k in ("team_score_mae","margin_mae","total_mae","moneyline_brier","total_interval_miss"))>=3 for s in CONFIRMATION_SEASONS),
        "confirmation_ece": all(confirmation[str(s)]["moneyline_ece"]<=0.08 for s in CONFIRMATION_SEASONS),
        "confirmation_bias": all(max(abs(confirmation[str(s)][k]) for k in ("home_bias","away_bias","margin_bias","total_bias"))<=2.5 for s in CONFIRMATION_SEASONS),
        "confirmation_dispersion": all(min(confirmation[str(s)]["team_score_pred_sd"]/confirmation[str(s)]["team_score_actual_sd"],confirmation[str(s)]["margin_pred_sd"]/confirmation[str(s)]["margin_actual_sd"],confirmation[str(s)]["total_pred_sd"]/confirmation[str(s)]["total_actual_sd"])>=0.70 for s in CONFIRMATION_SEASONS),
    }
    return {
        "release": RELEASE, "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "chronology": {"fit": list(FIT_SEASONS), "selection": SELECTION_SEASON, "confirmation": list(CONFIRMATION_SEASONS)},
        "rowsBySeason": {str(s): int((data.season==s).sum()) for s in SEASONS},
        "sourceChecksums": checksums, "featureCount": len(features), "features": features,
        "selectionCandidates": candidates, "selectedFamily": selected,
        "selectionBaseline": baseline_selection, "selectionImprovement": selection_improvement,
        "confirmation": confirmation, "confirmationBaseline": baseline,
        "gates": gates, "promotable": all(gates.values()),
    }


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--source-dir",default="football-research/cache/cfb-model/source")
    parser.add_argument("--output",default="football-research/reports/cfb_v1_independent_score_tournament_2026_08_25_r1.json")
    parser.add_argument("--seed",type=int,default=20260825)
    args=parser.parse_args()
    report=run(args)
    output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({"output":str(output),"selected":report["selectedFamily"],"gates":report["gates"],"promotable":report["promotable"]},indent=2))


if __name__ == "__main__":
    main()
