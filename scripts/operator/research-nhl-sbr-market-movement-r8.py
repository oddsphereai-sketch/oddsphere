#!/usr/bin/env python3
"""Research-only NHL opening-to-closing direction audit on the public SBR archive."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

SOURCE = Path("/private/tmp/nhl_archive_10Y_sbr.json")


def implied(price: float) -> float:
    return 100 / (price + 100) if price > 0 else -price / (-price + 100)


def finite(value) -> float | None:
    try:
        value = float(value)
        return value if math.isfinite(value) and value != 0 else None
    except (TypeError, ValueError):
        return None


def evaluate(rows: list[dict], seasons: set[int]) -> dict:
    ml_by_threshold = defaultdict(list)
    total_by_threshold = defaultdict(list)
    total_price_flat = defaultdict(list)
    for row in rows:
        if int(row["season"]) not in seasons:
            continue
        home_score, away_score = finite(row.get("home_final")), finite(row.get("away_final"))
        if home_score is None or away_score is None or home_score == away_score:
            continue

        ho, ao = finite(row.get("home_open_ml")), finite(row.get("away_open_ml"))
        hc, ac = finite(row.get("home_close_ml")), finite(row.get("away_close_ml"))
        if all(value is not None for value in (ho, ao, hc, ac)):
            open_home = implied(ho) / (implied(ho) + implied(ao))
            close_home = implied(hc) / (implied(hc) + implied(ac))
            delta_pp = 100 * (close_home - open_home)
            for threshold in (0.5, 1, 2, 3, 5):
                if abs(delta_pp) >= threshold:
                    ml_by_threshold[threshold].append((delta_pp > 0) == (home_score > away_score))

        open_total, close_total = finite(row.get("open_over_under")), finite(row.get("close_over_under"))
        if open_total is None or close_total is None:
            continue
        actual_total = home_score + away_score
        line_delta = close_total - open_total
        for threshold in (0.5, 1.0):
            if abs(line_delta) >= threshold and actual_total != close_total:
                total_by_threshold[threshold].append((line_delta > 0) == (actual_total > close_total))
        if line_delta == 0 and actual_total != close_total:
            open_price = finite(row.get("open_over_under_odds"))
            close_price = finite(row.get("close_over_under_odds"))
            if open_price is not None and close_price is not None:
                probability_delta_pp = 100 * (implied(close_price) - implied(open_price))
                for threshold in (1, 2, 3, 5):
                    if abs(probability_delta_pp) >= threshold:
                        total_price_flat[threshold].append((probability_delta_pp > 0) == (actual_total > close_total))

    def summarize(values):
        return {
            "n": len(values),
            "correct": sum(values),
            "accuracy": sum(values) / len(values) if values else None,
        }

    return {
        "moneyline_probability_move": {str(key): summarize(values) for key, values in ml_by_threshold.items()},
        "total_line_move": {str(key): summarize(values) for key, values in total_by_threshold.items()},
        "flat_total_over_price_move": {str(key): summarize(values) for key, values in total_price_flat.items()},
    }


def main() -> None:
    rows = json.loads(SOURCE.read_text())
    print(json.dumps({
        "release": "nhl_sbr_market_movement_research_2026_09_29_r1",
        "source": "MIT-licensed public SBR archive mirror; 2011-2021",
        "selection_2011_2016": evaluate(rows, set(range(2011, 2017))),
        "confirmation_2017_2021": evaluate(rows, set(range(2017, 2022))),
        "all_2011_2021": evaluate(rows, set(range(2011, 2022))),
    }, indent=2))


if __name__ == "__main__":
    main()
