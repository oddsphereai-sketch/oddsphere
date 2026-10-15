#!/usr/bin/env python3
"""Chronological target-participation x conditional-share receiving tournament."""

from __future__ import annotations

import json
import math
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

from tournament_nfl_player_props_receiving_yards_recent_workload import (
    FOUNDATION, FOUNDATION_PROJECTIONS, ROOT, load, metrics, stability,
)


OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_target_hurdle_r1.json"
ROWS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receiving_target_hurdle_rows_r1.parquet"
WEIGHTS = (0.25, 0.50, 0.75, 1.0)
POSITIONS = ("RB", "FB", "WR", "TE")
POSITION_GROUPS = {"BACK": ("RB", "FB"), "WR": ("WR",), "TE": ("TE",)}
MARKETS = ("receptions", "receiving_yards")
SEED = 20261015


def target_hurdle(
    foundation: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    player_features: list[str],
    team_features: list[str],
    test: pd.DataFrame,
) -> tuple[np.ndarray, dict[str, float | int]]:
    population = frame[frame["season"].lt(season) & frame["position"].isin(POSITIONS)].copy()
    population["targeted"] = population["targets"].fillna(0).gt(0).astype(int)
    targeted = population[population["targeted"].eq(1)].copy()
    classifier = HistGradientBoostingClassifier(
        max_iter=160, max_leaf_nodes=15, learning_rate=0.04,
        min_samples_leaf=35, l2_regularization=12.0, random_state=SEED,
    ).fit(population[player_features], population["targeted"].to_numpy(int))
    share_model = foundation.model("squared_error", minimum_leaf=35).fit(
        targeted[player_features], targeted["expected_role_target_share"].fillna(0).to_numpy(float),
    )
    roster = frame[
        frame["season"].eq(season)
        & frame["position"].isin(POSITIONS)
        & (frame["external_depth_listed"].eq(1) | frame["prior_participations"].fillna(0).gt(0))
    ].copy()
    probability = np.asarray(classifier.predict_proba(roster[player_features])[:, 1], dtype=float)
    conditional_share = np.clip(np.asarray(share_model.predict(roster[player_features]), dtype=float), 0, 1)
    roster["raw_share"] = probability * conditional_share
    denominator = roster.groupby(["game_id", "team"], observed=True)["raw_share"].transform("sum")
    roster["share"] = np.divide(
        roster["raw_share"].to_numpy(float), denominator.to_numpy(float),
        out=np.zeros(len(roster)), where=denominator.to_numpy(float) > 0,
    )
    share = roster.set_index("row_id")["share"].reindex(test["row_id"]).to_numpy(float)
    missing = np.isnan(share)
    if missing.any():
        fallback = np.clip(np.asarray(share_model.predict(test.loc[missing, player_features]), dtype=float), 0, 1)
        share[missing] = fallback
    budget = foundation.budget_prediction(
        teams, season, team_features, "team_targets", test[["game_id", "team"]],
    )
    return np.clip(budget * share, 0, None), {
        "trainingRows": int(len(population)), "targetedTrainingRows": int(len(targeted)),
        "rosterRows": int(len(roster)), "testRows": int(len(test)),
        "missingNormalizedShareRows": int(missing.sum()),
        "meanTargetProbability": float(np.mean(probability)),
        "meanTeamTargets": float(np.mean(budget)), "meanPlayerTargets": float(np.mean(budget * share)),
    }


def market_values(
    market: str,
    base: pd.DataFrame,
    test: pd.DataFrame,
    targets: np.ndarray,
    foundation: Any,
    receiving: Any,
    frame: pd.DataFrame,
    teams: pd.DataFrame,
    season: int,
    team_features: list[str],
    player_features: list[str],
) -> tuple[np.ndarray, np.ndarray]:
    components = receiving.receiving_components(
        foundation, frame, teams, season, team_features, player_features, test,
    )
    incumbent_targets = foundation.budget_prediction(
        teams, season, team_features, "team_targets", test[["game_id", "team"]],
    ) * foundation.normalized_team_target_share_prediction(frame, season, player_features, test)
    if market == "receiving_yards":
        ypt = np.divide(components["direct"], incumbent_targets, out=np.zeros(len(test)), where=incumbent_targets > 0)
        control = np.where(
            test["position"].eq("WR").to_numpy(),
            0.5 * base["released_projection"].to_numpy(float) + 0.5 * components["direct"],
            base["released_projection"].to_numpy(float),
        )
        return control, np.clip(targets * ypt, 0, None)
    catch_rate = np.zeros(len(test), dtype=float)
    for group in sorted(test["expected_role_group"].unique()):
        mask = test["expected_role_group"].eq(group).to_numpy()
        catch_rate[mask] = foundation.rate_prediction(
            frame, season, player_features, "receptions", "targets", group,
            test.loc[mask], 0.0, 1.0, True,
        )
    return base["candidate_projection"].to_numpy(float), np.clip(targets * catch_rate, 0, None)


def position_report(rows: pd.DataFrame, actual: np.ndarray, control: np.ndarray, candidates: dict[str, np.ndarray]) -> dict[str, Any]:
    report: dict[str, Any] = {}
    for group, positions in POSITION_GROUPS.items():
        mask = rows["position"].isin(positions).to_numpy()
        report[group] = {
            "control": metrics(actual[mask], control[mask]),
            "candidates": {name: metrics(actual[mask], value[mask]) for name, value in candidates.items()},
        }
    return report


def main() -> None:
    foundation = load("target_hurdle_foundation", FOUNDATION)
    receiving = load("target_hurdle_receiving", ROOT / "scripts/operator/tournament_nfl_player_props_receiving_yards.py")
    availability = foundation.load_module(
        "target_hurdle_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py",
    )
    external = foundation.load_module(
        "target_hurdle_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py",
    )
    manifest = json.loads(foundation.DEFAULT_EXTERNAL_MANIFEST.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
    )
    frame = foundation.add_role_shares(frame)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position in ("QB", *POSITIONS):
        column = f"position_{position.lower()}"
        frame[column] = frame["position"].eq(position).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("receiving_yards", groups)["full_external"],
        *groups.get("depth", []), *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    team_features = [name for name in [*groups["base"], *groups["state"]]
                     if name == "is_home" or name.startswith(("prior_team_", "prior_opponent_", "external_state_team_", "external_state_opponent_", "external_environment_"))]
    numeric = list(dict.fromkeys([*player_features, *team_features]))
    frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
    teams = foundation.team_table(frame, team_features)
    by_row = frame.set_index("row_id", drop=False)
    source = pd.read_parquet(FOUNDATION_PROJECTIONS)
    source = source[source["market"].isin(MARKETS) & source["phase"].isin(["selection", "confirmation"])].copy()

    reports: dict[str, Any] = {}
    row_outputs: list[pd.DataFrame] = []
    for season, phase in ((2024, "selection"), (2025, "confirmation")):
        phase_base = source[source["phase"].eq(phase)]
        common = phase_base[phase_base["market"].eq("receptions")].copy()
        test = by_row.loc[common["row_id"]].reset_index(drop=True)
        targets, diagnostic = target_hurdle(foundation, frame, teams, season, player_features, team_features, test)
        reports[phase] = {"diagnostic": diagnostic, "markets": {}}
        for market in MARKETS:
            base = phase_base[phase_base["market"].eq(market)].set_index("row_id").loc[test["row_id"]].reset_index()
            actual = base["actual"].to_numpy(float)
            control, component = market_values(
                market, base, test, targets, foundation, receiving, frame, teams,
                season, team_features, player_features,
            )
            candidates = {f"blend_{int(weight * 100)}": np.clip((1-weight)*control + weight*component, 0, None)
                          for weight in WEIGHTS}
            reports[phase]["markets"][market] = {
                "control": metrics(actual, control),
                "candidates": {name: metrics(actual, value) for name, value in candidates.items()},
                "positions": position_report(test, actual, control, candidates),
            }
            values = test[["row_id", "season", "week", "game_id", "team", "opponent", "player_id", "player_name", "position"]].copy()
            values["phase"], values["market"], values["actual"] = phase, market, actual
            values["control"], values["component"] = control, component
            for name, candidate in candidates.items(): values[name] = candidate
            row_outputs.append(values)

    selected: dict[str, dict[str, str]] = {}
    confirmed: dict[str, Any] = {}
    for market in MARKETS:
        selected[market] = {}
        for group in POSITION_GROUPS:
            selection = reports["selection"]["markets"][market]["positions"][group]
            eligible = [name for name, value in selection["candidates"].items()
                        if value["mae"] < selection["control"]["mae"] and value["rmse"] < selection["control"]["rmse"]]
            if eligible:
                selected[market][group] = min(eligible, key=lambda name: int(name.split("_")[-1]))
        confirmation_rows = next(row for row in row_outputs if row["phase"].iloc[0] == "confirmation" and row["market"].iloc[0] == market)
        candidate = confirmation_rows["control"].to_numpy(float).copy()
        position_passes: dict[str, bool] = {}
        for group, name in selected[market].items():
            mask = confirmation_rows["position"].isin(POSITION_GROUPS[group]).to_numpy()
            candidate[mask] = confirmation_rows.loc[mask, name].to_numpy(float)
            position = reports["confirmation"]["markets"][market]["positions"][group]
            position_passes[group] = bool(
                position["candidates"][name]["mae"] <= position["control"]["mae"]
                and position["candidates"][name]["rmse"] <= position["control"]["rmse"]
            )
        actual = confirmation_rows["actual"].to_numpy(float)
        control = confirmation_rows["control"].to_numpy(float)
        overall = metrics(actual, candidate)
        stable = stability(confirmation_rows, actual, control, candidate) if selected[market] else None
        confirmed[market] = {
            "selectedPositions": selected[market], "positionPasses": position_passes,
            "control": metrics(actual, control), "candidate": overall, "stability": stable,
            "passes": bool(selected[market] and all(position_passes.values())
                           and overall["mae"] <= metrics(actual, control)["mae"]
                           and overall["rmse"] <= metrics(actual, control)["rmse"]
                           and stable and stable["passes"]),
        }

    ROWS.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(row_outputs, ignore_index=True).to_parquet(ROWS, index=False)
    result = {
        "release": "nfl_player_props_receiving_target_hurdle_2026_10_15_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True, "marketIndependent": True, "marketFeatures": [],
        "weights": list(WEIGHTS), "features": player_features, "reports": reports,
        "selected": selected, "confirmation": confirmed, "injuryMetadata": injury_metadata,
    }
    OUTPUT.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"release": result["release"], "selected": selected, "confirmation": confirmed}, indent=2))


if __name__ == "__main__":
    main()
