#!/usr/bin/env python3
"""Untouched historical consensus audit for the active opening roster head."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any


ROSTER_SCORE_BETA = [
    2.8627335183356593, 0.18097660433990212, -0.04290122589447318,
    0.17336428120862124, 0.08375237227954732, 0.2904386353953811,
    -0.06622197415700082, 0.2669045558563523, -0.04503468060624234,
    0.23788365112877533, -0.13014779631034876, -0.17124085523932803,
    -0.12665359817437713, -0.11707435418720692, -0.462594552181677,
    0.45923342632413855, 0.07011129359055548, -0.13216188373581528,
    0.057010954106550105, 0.023780899098990116, 0.24853606087984212,
    -0.19194588224494297, 0.1512376901428658, -0.030318817072768782,
    0.6648677791438763, -0.12458888446629911,
]

SCORE_BETA = [
    2.9780546116531066, 0.1796256256709038, 0.19790828165857607,
    0.1916787455944218, 0.21571727756307035, 0.31307021298110915,
    0.043241636066699105, 0.3101399816597343, 0.05952024232239039,
    0.213239319922914, -0.011341534853054044, -0.03964933962980568,
    -0.017808995904590084, -0.12139146738681414, 0.05824064025009689,
    0.3687578559301108, 0.07458718668794515, -0.11097641372547018,
    0.04338959014834951, 0.08307004907456006,
]

ABILITY_BETA = [
    -0.17236562564475472, 0.7948403714740907, 0.37042700976601217,
    -0.6233355872095584, -0.03540520777115418, -0.014228820288914758,
    -0.015795062368390175, -0.06228140429571857,
]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def evaluate(rows: list[dict[str, Any]], threshold: float | None, base: Any) -> dict[str, Any]:
    wins = conflicts = market_conflict_wins = flips = corrections = harms = 0
    brier = log_loss = 0.0
    for row in rows:
        distribution = base.distribution(row["ind_home"], row["ind_away"])
        independent_probability = distribution["home_win"]
        actual_home = row["home_goals"] > row["away_goals"]
        independent_home = independent_probability >= 0.5
        market_probability = row["market"]["home_prob"]
        probability = independent_probability
        final_home = independent_home
        if market_probability is not None:
            market_home = market_probability >= 0.5
            conflict = market_home != independent_home
            if conflict:
                conflicts += 1
                market_conflict_wins += int(market_home == actual_home)
            if threshold is not None and conflict and max(market_probability, 1 - market_probability) >= threshold:
                flips += 1
                final_home = market_home
                probability = market_probability
                if market_home == actual_home:
                    corrections += 1
                else:
                    harms += 1
        wins += int(final_home == actual_home)
        actual = int(actual_home)
        probability = max(0.001, min(0.999, probability))
        brier += (probability - actual) ** 2
        log_loss += -(actual * math.log(probability) + (1 - actual) * math.log(1 - probability))
    n = len(rows)
    return {
        "n": n,
        "record": f"{wins}-{n - wins}",
        "accuracy": wins / n if n else None,
        "brier": brier / n if n else None,
        "log_loss": log_loss / n if n else None,
        "conflicts": conflicts,
        "conflict_market_record": f"{market_conflict_wins}-{conflicts - market_conflict_wins}",
        "flips": flips,
        "corrections": corrections,
        "harms": harms,
        "net_corrections": corrections - harms,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--teams", required=True, type=Path)
    parser.add_argument("--skaters", required=True, action="append", type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load_module("nhl_roster_consensus_base", root / "scripts/operator/tournament-nhl-professional-score-model.py")
    roster = load_module("nhl_roster_consensus_features", root / "scripts/operator/research-nhl-roster-prior-r12.py")
    games = base.apply_settled_scores(base.load_games(args.teams), base.load_settled_scores(args.bdl))
    lineups = roster.load_skater_rows(args.skaters)
    examples = roster.build_examples(base, games, lineups, 0.04, roster.FAMILIES["roster_scoring"])
    predicted = roster.predict(base, [row for row in examples if row["season"] == 2025], ROSTER_SCORE_BETA)
    priced = base.market_join(predicted, base.load_openings(args.bdl))
    opening = [row for row in priced if max(row["home_games"], row["away_games"]) < 10]
    cut = int(len(opening) * 0.70)
    cohorts = {
        "selection_first_70pct": opening[:cut],
        "confirmation_last_30pct": opening[cut:],
        "full_opening_window": opening,
    }
    legacy = base.load_legacy_forecasts(args.bdl)
    standard_examples = [row for row in base.build_examples(games, 0.04) if row["season"] == 2025]
    standard = base.market_join(base.predict(standard_examples, SCORE_BETA, legacy), base.load_openings(args.bdl))
    opening_keys = {(row["season"], row["date"], row["home"], row["away"]) for row in opening}
    standard = [
        row for row in standard
        if (row["season"], row["date"], row["home"], row["away"]) in opening_keys
    ]

    def with_ability(rows: list[dict[str, Any]], weight: float) -> list[dict[str, Any]]:
        adjusted: list[dict[str, Any]] = []
        for row in rows:
            home, away = base.independent_scores(row, weight, ABILITY_BETA)
            adjusted.append({**row, "ind_home": home, "ind_away": away})
        return adjusted

    def legacy_scores(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{**row, "ind_home": row["legacy_home"], "ind_away": row["legacy_away"]} for row in rows]

    roster_architectures = {
        "active_roster_score": opening,
        "roster_plus_15pct_ability": with_ability(opening, 0.15),
        "roster_plus_30pct_ability": with_ability(opening, 0.30),
        "roster_plus_45pct_ability": with_ability(opening, 0.45),
        "standard_score_only": standard,
        "standard_runtime_45pct_ability": with_ability(standard, 0.45),
        "legacy_baseline": legacy_scores(standard),
    }
    thresholds: list[float | None] = [None, 0.52, 0.54, 0.55, 0.56, 0.58, 0.60]
    print(json.dumps({
        "protocol": {
            "independent": "exact active ROSTER_SCORE_BETA with roster_scoring features",
            "window": "both teams fewer than ten prior current-season games",
            "features": "strictly earlier MoneyPuck team and player games",
            "settlement": "official BALLDONTLIE final scores",
            "market": "median no-vig opening probability joined after independent score",
        },
        "cohorts": {
            name: {
                ("independent" if threshold is None else f"consensus_{round(threshold * 100)}"):
                    evaluate(rows, threshold, base)
                for threshold in thresholds
            }
            for name, rows in cohorts.items()
        },
        "independent_architecture": {
            name: {
                "selection_first_70pct": evaluate(rows[:cut], None, base),
                "confirmation_last_30pct": evaluate(rows[cut:], None, base),
                "full_opening_window": evaluate(rows, None, base),
            }
            for name, rows in roster_architectures.items()
        },
    }, indent=2))


if __name__ == "__main__":
    main()
