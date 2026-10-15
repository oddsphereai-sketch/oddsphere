#!/usr/bin/env python3
"""Frozen NFL dynamic state-space score challenger with residual heads."""

from __future__ import annotations

import json
import math
import pathlib
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd

import tournament_nfl_independent_score_rebuild_r1 as r1


TOURNAMENT_RELEASE = "nfl_dynamic_state_score_rebuild_tournament_2026_10_15_r2"
STATE_GAINS = (0.05, 0.10, 0.15, 0.20)
OFFSEASON_CARRIES = (0.50, 0.65, 0.80)
HOME_FIELD_MARGINS = (1.5, 2.0, 2.5)
LEAGUE_GAINS = (0.01, 0.03, 0.06)
CORRECTION_WEIGHTS = (0.25, 0.50, 0.75, 1.00)
CORRECTION_CAPS = (2.0, 4.0, 6.0)


@dataclass(frozen=True)
class StateRecipe:
    state_gain: float
    offseason_carry: float
    home_field_margin: float
    league_gain: float


@dataclass(frozen=True)
class CorrectionRecipe:
    feature_family: str
    model_recipe: r1.Recipe
    weight: float
    cap: float


def dynamic_scores(games: pd.DataFrame, recipe: StateRecipe) -> dict[str, np.ndarray]:
    ordered = games.sort_values(["season", "week", "game_id"])
    offense: defaultdict[str, float] = defaultdict(float)
    defense: defaultdict[str, float] = defaultdict(float)
    league_points = 22.5
    current_season: int | None = None
    home_predictions = pd.Series(index=ordered.index, dtype=float)
    away_predictions = pd.Series(index=ordered.index, dtype=float)

    for (season_value, _), week_games in ordered.groupby(["season", "week"], sort=True):
        season = int(season_value)
        if current_season != season:
            if current_season is not None:
                for team in set(offense) | set(defense):
                    offense[team] *= recipe.offseason_carry
                    defense[team] *= recipe.offseason_carry
            current_season = season

        updates: list[tuple[str, str, float]] = []
        observed_scores: list[float] = []
        for index, game in week_games.iterrows():
            home = str(game["home_team"])
            away = str(game["away_team"])
            home_score = (
                league_points + offense[home] + defense[away]
                + recipe.home_field_margin / 2.0
            )
            away_score = (
                league_points + offense[away] + defense[home]
                - recipe.home_field_margin / 2.0
            )
            home_predictions.loc[index] = home_score
            away_predictions.loc[index] = away_score
            home_residual = float(game["home_score"]) - home_score
            away_residual = float(game["away_score"]) - away_score
            updates.extend([
                (home, "offense", home_residual),
                (away, "defense", home_residual),
                (away, "offense", away_residual),
                (home, "defense", away_residual),
            ])
            observed_scores.extend([float(game["home_score"]), float(game["away_score"])])

        for team, unit, residual in updates:
            change = recipe.state_gain * residual / 2.0
            if unit == "offense":
                offense[team] += change
            else:
                defense[team] += change
        active = sorted(set(offense) | set(defense))
        if active:
            offense_mean = float(np.mean([offense[team] for team in active]))
            defense_mean = float(np.mean([defense[team] for team in active]))
            for team in active:
                offense[team] -= offense_mean
                defense[team] -= defense_mean
        week_mean = float(np.mean(observed_scores))
        league_points = (1.0 - recipe.league_gain) * league_points + recipe.league_gain * week_mean

    home = home_predictions.sort_index().to_numpy(float)
    away = away_predictions.sort_index().to_numpy(float)
    return {"home": home, "away": away, "margin": home - away, "total": home + away}


def select_state_recipe(games: pd.DataFrame) -> tuple[StateRecipe, list[dict[str, Any]]]:
    selection_mask = games["season"].eq(r1.SELECTION_SEASON).to_numpy()
    selection = games.loc[selection_mask].reset_index(drop=True)
    rankings: list[dict[str, Any]] = []
    for gain in STATE_GAINS:
        for carry in OFFSEASON_CARRIES:
            for home_field in HOME_FIELD_MARGINS:
                for league_gain in LEAGUE_GAINS:
                    recipe = StateRecipe(gain, carry, home_field, league_gain)
                    scores = dynamic_scores(games, recipe)
                    report = r1.score_report(
                        selection,
                        scores["margin"][selection_mask],
                        scores["total"][selection_mask],
                    )
                    rankings.append({"recipe": recipe, "report": report})
    rankings.sort(key=lambda row: (
        row["report"]["teamScore"]["mae"],
        row["report"]["margin"]["mae"] + row["report"]["total"]["mae"],
        row["recipe"].state_gain,
    ))
    return rankings[0]["recipe"], [
        {"recipe": asdict(row["recipe"]), "report": row["report"]}
        for row in rankings
    ]


def residual_features(
    frame: pd.DataFrame,
    family: str,
    base_margin: np.ndarray,
    base_total: np.ndarray,
) -> pd.DataFrame:
    features = r1.engineered_features(frame, family).reset_index(drop=True)
    features["state_margin"] = np.asarray(base_margin, dtype=float)
    features["state_total_centered"] = np.asarray(base_total, dtype=float) - 45.0
    features["state_abs_margin"] = np.abs(np.asarray(base_margin, dtype=float))
    return features


def select_correction(
    train: pd.DataFrame,
    selection: pd.DataFrame,
    train_base: dict[str, np.ndarray],
    selection_base: dict[str, np.ndarray],
    target: str,
    head: str,
) -> tuple[CorrectionRecipe, list[dict[str, Any]]]:
    residual_target = train[target].to_numpy(float) - train_base[head]
    actual = selection[target].to_numpy(float)
    rankings: list[dict[str, Any]] = []
    for family in ("core", "availability"):
        train_features = residual_features(train, family, train_base["margin"], train_base["total"])
        selection_features = residual_features(
            selection, family, selection_base["margin"], selection_base["total"]
        )
        models = r1.fit_components(train_features, residual_target)
        predictions = r1.component_predictions(models, selection_features)
        for model_recipe in r1.recipe_definitions(family):
            raw = r1.recipe_prediction(model_recipe, predictions)
            for weight in CORRECTION_WEIGHTS:
                for cap in CORRECTION_CAPS:
                    predicted = selection_base[head] + np.clip(weight * raw, -cap, cap)
                    rankings.append({
                        "recipe": CorrectionRecipe(family, model_recipe, weight, cap),
                        **r1.point_metrics(actual, predicted),
                        "meanAbsoluteCorrection": float(np.mean(np.abs(predicted - selection_base[head]))),
                    })
    rankings.sort(key=lambda row: (
        row["mae"], row["rmse"], row["recipe"].weight, row["recipe"].cap,
        len(row["recipe"].model_recipe.components),
    ))
    return rankings[0]["recipe"], [
        {
            "recipe": {
                "featureFamily": row["recipe"].feature_family,
                "modelRecipe": asdict(row["recipe"].model_recipe),
                "weight": row["recipe"].weight,
                "cap": row["recipe"].cap,
            },
            **{key: value for key, value in row.items() if key != "recipe"},
        }
        for row in rankings
    ]


def apply_correction(
    train: pd.DataFrame,
    test: pd.DataFrame,
    train_base: dict[str, np.ndarray],
    test_base: dict[str, np.ndarray],
    target: str,
    head: str,
    recipe: CorrectionRecipe,
) -> np.ndarray:
    residual_target = train[target].to_numpy(float) - train_base[head]
    train_features = residual_features(
        train, recipe.feature_family, train_base["margin"], train_base["total"]
    )
    test_features = residual_features(
        test, recipe.feature_family, test_base["margin"], test_base["total"]
    )
    models = r1.fit_components(train_features, residual_target, recipe.model_recipe.components)
    raw = r1.recipe_prediction(recipe.model_recipe, r1.component_predictions(models, test_features))
    return test_base[head] + np.clip(recipe.weight * raw, -recipe.cap, recipe.cap)


def slice_scores(scores: dict[str, np.ndarray], mask: np.ndarray) -> dict[str, np.ndarray]:
    return {key: value[mask] for key, value in scores.items()}


def serializable_correction(recipe: CorrectionRecipe) -> dict[str, Any]:
    return {
        "featureFamily": recipe.feature_family,
        "modelRecipe": asdict(recipe.model_recipe),
        "weight": recipe.weight,
        "cap": recipe.cap,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != r1.FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if r1.sha256_file(feature_path) != manifest.get("featureFileSha256"):
        raise RuntimeError("feature checksum mismatch")
    games = pd.read_parquet(feature_path).sort_values(["season", "week", "game_id"]).reset_index(drop=True)

    state_recipe, state_rankings = select_state_recipe(games)
    base = dynamic_scores(games, state_recipe)
    train_mask = games["season"].le(r1.TRAIN_END).to_numpy()
    selection_mask = games["season"].eq(r1.SELECTION_SEASON).to_numpy()
    train = games.loc[train_mask].reset_index(drop=True)
    selection = games.loc[selection_mask].reset_index(drop=True)
    train_base = slice_scores(base, train_mask)
    selection_base = slice_scores(base, selection_mask)

    margin_recipe, margin_rankings = select_correction(
        train, selection, train_base, selection_base, "actual_margin", "margin"
    )
    total_recipe, total_rankings = select_correction(
        train, selection, train_base, selection_base, "actual_total", "total"
    )
    selection_margin = apply_correction(
        train, selection, train_base, selection_base, "actual_margin", "margin", margin_recipe
    )
    selection_total = apply_correction(
        train, selection, train_base, selection_base, "actual_total", "total", total_recipe
    )
    margin_independent_weight, margin_anchor_rankings = r1.select_anchor_weight(
        selection["actual_margin"].to_numpy(float), selection_margin,
        selection["market_home_margin"].to_numpy(float),
    )
    total_independent_weight, total_anchor_rankings = r1.select_anchor_weight(
        selection["actual_total"].to_numpy(float), selection_total,
        selection["market_total"].to_numpy(float),
    )

    confirmation_frames: list[pd.DataFrame] = []
    confirmation_margins: list[np.ndarray] = []
    confirmation_totals: list[np.ndarray] = []
    for season in r1.CONFIRMATION_SEASONS:
        fit_mask = games["season"].lt(season).to_numpy()
        test_mask = games["season"].eq(season).to_numpy()
        fit = games.loc[fit_mask].reset_index(drop=True)
        test = games.loc[test_mask].reset_index(drop=True)
        fit_base = slice_scores(base, fit_mask)
        test_base = slice_scores(base, test_mask)
        confirmation_frames.append(test)
        confirmation_margins.append(apply_correction(
            fit, test, fit_base, test_base, "actual_margin", "margin", margin_recipe
        ))
        confirmation_totals.append(apply_correction(
            fit, test, fit_base, test_base, "actual_total", "total", total_recipe
        ))

    confirmation = pd.concat(confirmation_frames, ignore_index=True)
    confirmation_margin = np.concatenate(confirmation_margins)
    confirmation_total = np.concatenate(confirmation_totals)
    anchor_margin = (
        margin_independent_weight * confirmation_margin
        + (1.0 - margin_independent_weight) * confirmation["market_home_margin"].to_numpy(float)
    )
    anchor_total = (
        total_independent_weight * confirmation_total
        + (1.0 - total_independent_weight) * confirmation["market_total"].to_numpy(float)
    )

    combined = r1.subset_report(
        confirmation, confirmation_margin, confirmation_total, r1.CONFIRMATION_SEASONS
    )
    by_season = {
        str(season): r1.subset_report(
            confirmation, confirmation_margin, confirmation_total, (season,)
        )
        for season in r1.CONFIRMATION_SEASONS
    }
    anchor_report = r1.score_report(confirmation, anchor_margin, anchor_total)
    market_report = combined["market"]
    gates = {
        "marginImprovesR1": combined["independent"]["margin"]["mae"] < 10.10498708641413,
        "totalImprovesR1": combined["independent"]["total"]["mae"] < 10.579579017550914,
        "anchorMarginImprovesMarket": anchor_report["margin"]["mae"] < market_report["margin"]["mae"],
        "anchorTotalImprovesMarket": anchor_report["total"]["mae"] < market_report["total"]["mae"],
        "finiteCoherentScores": combined["independent"]["coherentScores"],
    }
    gates["advanceToExact2026Replay"] = bool(
        gates["marginImprovesR1"]
        and gates["totalImprovesR1"]
        and gates["finiteCoherentScores"]
        and (gates["anchorMarginImprovesMarket"] or gates["anchorTotalImprovesMarket"])
    )

    payload = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "featureRelease": r1.FEATURE_RELEASE,
        "featureSha256": manifest["featureFileSha256"],
        "selected": {
            "state": asdict(state_recipe),
            "marginCorrection": serializable_correction(margin_recipe),
            "totalCorrection": serializable_correction(total_recipe),
            "marginIndependentWeightInConsensusDiagnostic": margin_independent_weight,
            "totalIndependentWeightInConsensusDiagnostic": total_independent_weight,
        },
        "selection": {
            "stateOnly": r1.score_report(selection, selection_base["margin"], selection_base["total"]),
            "correctedIndependent": r1.score_report(selection, selection_margin, selection_total),
        },
        "confirmationBySeason": by_season,
        "confirmationCombined": combined,
        "confirmationAnchorBlend": anchor_report,
        "gates": gates,
        "rankings": {
            "state": state_rankings,
            "marginCorrection": margin_rankings,
            "totalCorrection": total_rankings,
            "marginAnchor": margin_anchor_rankings,
            "totalAnchor": total_anchor_rankings,
        },
        "restrictions": [
            "research-only",
            "no production writer",
            "no locked-record mutation",
            "consensus blend is not the professional market-reader marriage",
        ],
    }
    output_root = root / "football-research/reports/nfl-dynamic-state-score-rebuild-r2"
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "tournament.json"
    output_path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "selected": payload["selected"],
        "selection": payload["selection"],
        "confirmationCombined": combined,
        "confirmationBySeason": by_season,
        "confirmationAnchorBlend": anchor_report,
        "gates": gates,
        "output": str(output_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
