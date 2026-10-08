#!/usr/bin/env python3
"""Chronological availability and vacated-role NFL player-props tournament."""

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


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.manifest.json"
DEFAULT_HISTORY_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_INJURY_ROOT = ROOT / "football-research/cache/nfl-player-props-external/injuries"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_availability_role_r1.json"
DEFAULT_PROJECTIONS = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_availability_role_2026_projections_r1.parquet"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
PASSING_SPECS = {
    "passing_attempts": ("state_ngs", "hgb_poisson"),
    "passing_completions": ("state_pressure", "hgb_poisson"),
    "passing_yards": ("full_external", "hgb_absolute"),
}
HIERARCHY_MARKETS = ("rushing_attempts", "rushing_yards", "receptions", "receiving_yards")
VARIANTS = ("final", "practice", "combined")
WEIGHTS = (0.50, 0.75, 1.0)


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


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    error = prediction - actual
    return {
        "rows": int(len(actual)),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
        "underpredictionRate": float(np.mean(prediction < actual)),
    }


def role_group(position: pd.Series) -> pd.Series:
    return np.select(
        [position.eq("QB"), position.isin(["RB", "FB"]), position.isin(["WR", "TE"])],
        ["quarterback", "backfield", "receiver"],
        default="other",
    )


def injury_features(frame: pd.DataFrame, injury_root: pathlib.Path) -> tuple[pd.DataFrame, dict[str, Any], dict[str, list[str]]]:
    paths = sorted(injury_root.glob("*.parquet"))
    if not paths:
        raise RuntimeError(f"no historical injury files found under {injury_root}")
    injuries = pd.concat([pd.read_parquet(path) for path in paths], ignore_index=True)
    injuries = injuries.dropna(subset=["season", "week", "team", "gsis_id"]).copy()
    injuries["season"] = injuries["season"].astype(int)
    injuries["week"] = injuries["week"].astype(int)
    injuries["team"] = injuries["team"].astype(str)
    injuries["player_id"] = injuries["gsis_id"].astype(str)
    injuries = injuries.sort_values(["season", "week", "team", "player_id"]).drop_duplicates(
        ["season", "week", "team", "player_id"], keep="last",
    )
    report = injuries["report_status"].fillna("").astype(str).str.lower()
    practice = injuries["practice_status"].fillna("").astype(str).str.lower()
    injuries["availability_evidence"] = 1.0
    injuries["availability_report_out"] = report.eq("out").astype(float)
    injuries["availability_report_doubtful"] = report.eq("doubtful").astype(float)
    injuries["availability_report_questionable"] = report.eq("questionable").astype(float)
    injuries["availability_practice_dnp"] = practice.str.contains("did not participate", regex=False).astype(float)
    injuries["availability_practice_limited"] = practice.str.contains("limited participation", regex=False).astype(float)
    injuries["availability_practice_full"] = practice.str.contains("full participation", regex=False).astype(float)
    injuries["availability_severity_final"] = (
        injuries["availability_report_out"]
        + 0.75 * injuries["availability_report_doubtful"]
        + 0.25 * injuries["availability_report_questionable"]
    ).clip(0.0, 1.0)
    injuries["availability_severity_practice"] = (
        0.65 * injuries["availability_practice_dnp"]
        + 0.25 * injuries["availability_practice_limited"]
    ).clip(0.0, 1.0)
    injuries["availability_severity_combined"] = injuries[
        ["availability_severity_final", "availability_severity_practice"]
    ].max(axis=1)

    own_columns = [
        "availability_evidence", "availability_report_out", "availability_report_doubtful",
        "availability_report_questionable", "availability_practice_dnp",
        "availability_practice_limited", "availability_practice_full",
        "availability_severity_final", "availability_severity_practice",
        "availability_severity_combined",
    ]
    enriched = frame.merge(
        injuries[["season", "week", "team", "player_id", *own_columns]],
        on=["season", "week", "team", "player_id"], how="left", validate="many_to_one",
    )
    enriched[own_columns] = enriched[own_columns].fillna(0.0)
    enriched["availability_role_group"] = role_group(enriched["position"])

    metrics = (
        "prior_pass_attempt_share_season_avg", "prior_rush_attempt_share_season_avg",
        "prior_target_share_season_avg", "prior_offense_snap_pct_avg5",
    )
    feature_groups: dict[str, list[str]] = {}
    keys = ["season", "week", "game_id", "team", "availability_role_group"]
    for variant in VARIANTS:
        severity = f"availability_severity_{variant}"
        features = ["availability_evidence", severity]
        count_contribution = enriched[severity]
        count_total = count_contribution.groupby([enriched[key] for key in keys], observed=True).transform("sum")
        count_name = f"availability_teammate_count_{variant}"
        enriched[count_name] = np.clip(count_total - count_contribution, 0.0, None)
        features.append(count_name)
        for metric in metrics:
            contribution = enriched[metric].fillna(0.0) * enriched[severity]
            total = contribution.groupby([enriched[key] for key in keys], observed=True).transform("sum")
            name = f"availability_teammate_vacated_{metric.removeprefix('prior_')}_{variant}"
            enriched[name] = np.clip(total - contribution, 0.0, None)
            features.append(name)
        feature_groups[variant] = features

    coverage = {
        str(season): {
            "rows": int(len(rows)),
            "playerRowsWithInjuryEvidence": int(rows["availability_evidence"].sum()),
            "coverage": float(rows["availability_evidence"].mean()),
            "teamGamesWithEvidence": int(rows.loc[rows["availability_evidence"].eq(1), ["game_id", "team"]].drop_duplicates().shape[0]),
        }
        for season, rows in enriched.groupby("season", observed=True)
    }
    metadata = {
        "files": [{"path": str(path.resolve()), "sha256": sha256_file(path)} for path in paths],
        "injuryRows": int(len(injuries)),
        "coverageBySeason": coverage,
    }
    return enriched, metadata, feature_groups


def candidate_passes(reference: dict[str, float | int], candidate: dict[str, float | int], actual_mean: float) -> bool:
    return bool(
        float(candidate["mae"]) < float(reference["mae"])
        and float(candidate["rmse"]) < float(reference["rmse"])
        and abs(float(candidate["bias"])) <= abs(float(reference["bias"])) + 0.0025 * actual_mean
        and float(candidate["underpredictionRate"]) <= float(reference["underpredictionRate"]) + 0.0025
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external-manifest", type=pathlib.Path, default=DEFAULT_EXTERNAL_MANIFEST)
    parser.add_argument("--history-manifest", type=pathlib.Path, default=DEFAULT_HISTORY_MANIFEST)
    parser.add_argument("--injury-root", type=pathlib.Path, default=DEFAULT_INJURY_ROOT)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--projections", type=pathlib.Path, default=DEFAULT_PROJECTIONS)
    args = parser.parse_args()

    baseline = load_module("props_availability_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_availability_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    history = load_module("props_availability_history", ROOT / "scripts/operator/build_nfl_player_props_history.py")
    identity = load_module("props_availability_identity", ROOT / "scripts/operator/tournament_nfl_player_props_opponent_matchup_identity.py")
    role = load_module("props_availability_role", ROOT / "scripts/operator/tournament_nfl_player_props_role_volume_efficiency.py")
    trainer = load_module("props_availability_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    prior_opportunity = load_module("props_availability_prior_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    conditional = load_module("props_availability_conditional", ROOT / "scripts/operator/tournament_nfl_player_props_conditional_participation.py")
    external = load_module("props_availability_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py")
    opportunity = load_module("props_availability_hierarchy", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_efficiency_external.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())

    external_manifest = json.loads(args.external_manifest.read_text(encoding="utf-8"))
    external_path = pathlib.Path(external_manifest["featureFile"])
    if sha256_file(external_path) != external_manifest["featureFileSha256"] or external_manifest.get("marketFeatures") != []:
        raise RuntimeError("external feature safety contract mismatch")
    frame, injury_metadata, availability_groups = injury_features(pd.read_parquet(external_path), args.injury_root)
    groups = {name: list(values) for name, values in external_manifest["featureGroups"].items()}
    for position_name in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position_name.lower()}"
        frame[column] = frame["position"].eq(position_name).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    all_availability_features = list(dict.fromkeys(name for values in availability_groups.values() for name in values))
    all_features = list(dict.fromkeys([*(name for values in groups.values() for name in values), *all_availability_features]))
    frame[all_features] = frame[all_features].replace([np.inf, -np.inf], np.nan)
    by_row = frame.set_index("row_id", drop=False)

    legacy, _, base_features, enhanced_features, _ = role.corrected_frames(
        baseline, matchup, history, identity, args.history_manifest, contract,
    )
    legacy_eligible = {market: baseline.market_eligible(legacy, contract["markets"][market]) for market in MARKETS}
    candidate_eligible = {market: baseline.market_eligible(frame, contract["markets"][market]) for market in MARKETS}

    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    teams = opportunity.team_games(frame, team_features)
    direct_base = {market: external.relevant_features(market, groups)[group] for market, (group, _) in PASSING_SPECS.items()}
    hierarchy_base = {
        "rushing": opportunity.relevant_external_features("rushing", groups),
        "receiving": opportunity.relevant_external_features("receiving", groups),
    }

    evaluation_rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    reference: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    predictions: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}
    specs: dict[str, dict[str, dict[str, Any]]] = {market: {} for market in MARKETS}
    budget_diagnostics: dict[str, Any] = {}

    for season in (2024, 2025):
        print(f"availability-role season {season}...", flush=True)
        incumbent_rows, incumbent_prediction, _ = prior_opportunity.incumbent_predictions(
            trainer, legacy, legacy_eligible, season, base_features, enhanced_features,
        )
        active_rows, active_prediction = conditional.conditional_predictions(
            trainer, legacy, legacy_eligible, season, base_features, enhanced_features,
        )
        test_rows: dict[str, pd.DataFrame] = {}
        for market in MARKETS:
            participated = incumbent_rows[market]["participated"].eq(1).to_numpy()
            settled = incumbent_rows[market].loc[participated]
            if not settled[["row_id"]].reset_index(drop=True).equals(active_rows[market][["row_id"]].reset_index(drop=True)):
                raise RuntimeError(f"released row mismatch: {market} {season}")
            test = by_row.loc[settled["row_id"]].copy()
            test_rows[market] = test
            evaluation_rows[market][season] = test
            actual[market][season] = test[market].to_numpy(float)
            released = incumbent_prediction[market][participated]
            if market == "rushing_attempts":
                released = 0.25 * released + 0.75 * active_prediction[market]
            reference[market][season] = released

        for market, (_, kind) in PASSING_SPECS.items():
            train = frame[candidate_eligible[market] & frame["participated"].eq(1) & frame["season"].lt(season)]
            for variant in VARIANTS:
                features = list(dict.fromkeys([*direct_base[market], *availability_groups[variant]]))
                raw = external.fit_predict(kind, train, test_rows[market], features, market)
                for weight in WEIGHTS:
                    name = f"direct__{variant}__{kind}__blend_{int(weight * 100)}"
                    predictions[market].setdefault(name, {})[season] = np.clip(
                        (1.0 - weight) * reference[market][season] + weight * raw, 0.0, None,
                    )
                    specs[market][name] = {"family": "direct", "variant": variant, "kind": kind, "weight": weight}

        for variant in VARIANTS:
            player_features = {
                name: list(dict.fromkeys([*hierarchy_base[name], *availability_groups[variant]]))
                for name in ("rushing", "receiving")
            }
            architecture, diagnostics = opportunity.hierarchy_predictions(
                frame, teams, season, team_features, player_features,
                {"rushing_attempts": test_rows["rushing_attempts"], "receptions": test_rows["receptions"]},
            )
            budget_diagnostics[f"{season}:{variant}"] = diagnostics
            for market in HIERARCHY_MARKETS:
                for weight in WEIGHTS:
                    name = f"hierarchy__{variant}__blend_{int(weight * 100)}"
                    predictions[market].setdefault(name, {})[season] = np.clip(
                        (1.0 - weight) * reference[market][season] + weight * architecture[market], 0.0, None,
                    )
                    specs[market][name] = {"family": "hierarchy", "variant": variant, "weight": weight}

    report: dict[str, Any] = {}
    frozen: dict[str, str | None] = {}
    for market in MARKETS:
        selection_reference = point_metrics(actual[market][2024], reference[market][2024])
        selection_candidates = {name: point_metrics(actual[market][2024], values[2024]) for name, values in predictions[market].items()}
        selectable = [
            name for name, metrics in selection_candidates.items()
            if candidate_passes(selection_reference, metrics, float(np.mean(actual[market][2024])))
        ]
        selected = min(selectable, key=lambda name: (
            float(selection_candidates[name]["mae"]) / float(selection_reference["mae"])
            + float(selection_candidates[name]["rmse"]) / float(selection_reference["rmse"])
        )) if selectable else None
        confirmation_reference = point_metrics(actual[market][2025], reference[market][2025])
        confirmation_candidate = point_metrics(actual[market][2025], predictions[market][selected][2025]) if selected else None
        confirmed = bool(
            selected and confirmation_candidate
            and float(confirmation_candidate["mae"]) <= float(confirmation_reference["mae"])
            and float(confirmation_candidate["rmse"]) <= float(confirmation_reference["rmse"])
            and abs(float(confirmation_candidate["bias"]))
            <= abs(float(confirmation_reference["bias"])) + 0.0025 * float(np.mean(actual[market][2025]))
        )
        frozen[market] = selected if confirmed else None
        report[market] = {
            "selection": {"reference": selection_reference, "candidates": selection_candidates, "selected": selected},
            "confirmation": {"reference": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "frozen2026Candidate": frozen[market],
            "candidateSpec": specs[market].get(frozen[market]) if frozen[market] else None,
        }

    print("availability candidates frozen; opening 2026 Weeks 1-4...", flush=True)
    diagnostic_rows = {
        market: frame[
            frame["participated"].eq(1)
            & frame["season"].eq(2026)
            & frame["position"].isin(contract["markets"][market]["positions"])
            & (candidate_eligible[market] | frame["external_depth_listed"].eq(1))
        ].copy()
        for market in MARKETS
    }
    components: dict[str, np.ndarray] = {}
    hierarchy_variants = {
        str(report[market]["candidateSpec"]["variant"])
        for market in HIERARCHY_MARKETS if report[market]["candidateSpec"]
    }
    hierarchy_2026: dict[str, dict[str, np.ndarray]] = {}
    for variant in hierarchy_variants:
        player_features = {
            name: list(dict.fromkeys([*hierarchy_base[name], *availability_groups[variant]]))
            for name in ("rushing", "receiving")
        }
        hierarchy_2026[variant], diagnostics = opportunity.hierarchy_predictions(
            frame, teams, 2026, team_features, player_features,
            {"rushing_attempts": diagnostic_rows["rushing_attempts"], "receptions": diagnostic_rows["receptions"]},
        )
        budget_diagnostics[f"2026:{variant}"] = diagnostics

    projection_frames: list[pd.DataFrame] = []
    for market in MARKETS:
        chosen = frozen[market]
        if not chosen:
            report[market]["currentSeason"] = None
            continue
        spec = specs[market][chosen]
        for season, phase in ((2024, "selection"), (2025, "confirmation")):
            rows = evaluation_rows[market][season]
            values = rows[[
                "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
                "player_name", "position", market,
            ]].copy().rename(columns={market: "actual"})
            values["market"] = market
            values["phase"] = phase
            values["candidate_name"] = chosen
            values["candidate_projection"] = predictions[market][chosen][season]
            values["component_projection"] = np.nan
            values["frozen_blend_weight"] = float(spec["weight"])
            values["released_projection"] = reference[market][season]
            projection_frames.append(values)

        test = diagnostic_rows[market]
        variant = str(spec["variant"])
        if spec["family"] == "direct":
            train = frame[candidate_eligible[market] & frame["participated"].eq(1) & frame["season"].lt(2026)]
            features = list(dict.fromkeys([*direct_base[market], *availability_groups[variant]]))
            component = external.fit_predict(str(spec["kind"]), train, test, features, market)
        else:
            component = hierarchy_2026[variant][market]
        components[market] = component
        values = test[[
            "row_id", "season", "week", "game_id", "team", "opponent", "player_id",
            "player_name", "position", market,
        ]].copy().rename(columns={market: "actual"})
        values["market"] = market
        values["phase"] = "diagnostic"
        values["candidate_name"] = chosen
        values["candidate_projection"] = np.nan
        values["component_projection"] = component
        values["frozen_blend_weight"] = float(spec["weight"])
        values["released_projection"] = np.nan
        projection_frames.append(values)
        report[market]["currentSeason"] = {
            "rows": int(len(test)),
            "weeks": sorted(test["week"].astype(int).unique().tolist()),
            "component": point_metrics(test[market].to_numpy(float), component),
        }

    args.projections.parent.mkdir(parents=True, exist_ok=True)
    projections = pd.concat(projection_frames, ignore_index=True)
    projections.to_parquet(args.projections, index=False)
    output = {
        "release": "nfl_player_props_availability_role_tournament_2026_10_08_r1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "researchOnly": True,
        "marketIndependent": True,
        "marketFeatures": [],
        "chronology": {"training": "2016-2023", "selection": 2024, "confirmation": 2025, "diagnostic": "2026 Weeks 1-4"},
        "externalManifestSha256": sha256_file(args.external_manifest),
        "injurySources": injury_metadata,
        "projectionFile": str(args.projections.resolve()),
        "projectionFileSha256": sha256_file(args.projections),
        "frozenCandidates": frozen,
        "candidateSpecs": {market: report[market]["candidateSpec"] for market in MARKETS},
        "budgetDiagnostics": budget_diagnostics,
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "projections": str(args.projections),
        "frozenCandidates": frozen,
        "confirmation": {market: report[market]["confirmation"] for market in MARKETS},
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
