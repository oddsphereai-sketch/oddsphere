#!/usr/bin/env python3
"""Historical NHL consensus-flip audit using frozen r3 coefficients.

The script is read-only. MoneyPuck game rows construct chronological pregame
features; official BALLDONTLIE final scores provide settlement labels; opening
prices are joined only after the independent forecast is built.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("nhl_historical_base", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def metrics(rows: list[dict[str, Any]], threshold: float | None, base: Any) -> dict[str, Any]:
    wins = conflicts = flips = corrections = harms = 0
    brier = log_loss = 0.0
    conflict_market_wins = 0
    for row in rows:
        actual = 1 if row["home_goals"] > row["away_goals"] else 0
        home, away = base.independent_scores(row, 0.45, row["ability_beta"])
        independent_probability = base.distribution(home, away)["home_win"]
        market_probability = row["market"].get("home_prob")
        probability = independent_probability
        independent_side = independent_probability >= 0.5
        final_side = independent_side
        if market_probability is not None:
            market_side = market_probability >= 0.5
            conflict = market_side != independent_side
            if conflict:
                conflicts += 1
                conflict_market_wins += int(market_side == bool(actual))
            strength = max(market_probability, 1 - market_probability)
            if threshold is not None and conflict and strength >= threshold:
                flips += 1
                final_side = market_side
                probability = market_probability
                if market_side == bool(actual):
                    corrections += 1
                else:
                    harms += 1
        wins += int(final_side == bool(actual))
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
        "conflict_market_record": f"{conflict_market_wins}-{conflicts - conflict_market_wins}",
        "flips": flips,
        "corrections": corrections,
        "harms": harms,
        "net_corrections": corrections - harms,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--moneypuck", required=True, type=Path)
    parser.add_argument("--bdl", required=True, type=Path)
    parser.add_argument("--artifact", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    base = load_module(root / "scripts/operator/tournament-nhl-professional-score-model.py")
    artifact = json.loads(args.artifact.read_text())
    games = base.apply_settled_scores(base.load_games(args.moneypuck), base.load_settled_scores(args.bdl))
    examples = base.build_examples(games, float(artifact["selected_core"]["alpha"]))
    legacy = base.load_legacy_forecasts(args.bdl)
    predicted = base.predict(
        [row for row in examples if row["season"] == 2025],
        artifact["selected_core"]["beta"],
        legacy,
    )
    ability_beta = artifact["selected_core"]["ability_beta"]
    for row in predicted:
        row["ability_beta"] = ability_beta
    priced = base.market_join(predicted, base.load_openings(args.bdl))
    cut = int(len(priced) * 0.70)
    cohorts = {
        "selection_first_70pct": priced[:cut],
        "confirmation_last_30pct": priced[cut:],
        "full_2025": priced,
    }
    thresholds: list[float | None] = [None, 0.52, 0.54, 0.55, 0.56, 0.58, 0.60]
    report = {
        "protocol": {
            "independent": "frozen r3 professional coefficients and ability head",
            "features": "strictly earlier MoneyPuck games",
            "settlement": "official BALLDONTLIE final scores",
            "market": "median no-vig 2025 opening probability, joined after independent score",
            "selection": "first 70% chronological priced games",
            "confirmation": "last 30% chronological priced games",
        },
        "cohorts": {
            name: {
                ("independent" if threshold is None else f"consensus_{int(threshold * 100)}"):
                    metrics(rows, threshold, base)
                for threshold in thresholds
            }
            for name, rows in cohorts.items()
        },
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
