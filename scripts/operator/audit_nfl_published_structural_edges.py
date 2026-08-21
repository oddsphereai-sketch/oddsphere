#!/usr/bin/env python3
"""Replay pre-specified NFL market effects from published research.

Local diagnostic only. Prices are terminal nflverse prices rather than
OddSphere lock snapshots, so nothing here is a grade, official record, or
promotion rule.
"""

from __future__ import annotations

import json
import pathlib
from typing import Callable

import numpy as np
import pandas as pd


AUDIT_RELEASE = "nfl_published_structural_edge_audit_2026_08_20_r1"


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def settle(frame: pd.DataFrame, side: pd.Series, market: str) -> pd.DataFrame:
    rows = frame.copy()
    if market == "spread":
        home_cover = rows["actual_margin"] > rows["market_home_margin"]
        push = rows["actual_margin"] == rows["market_home_margin"]
        take_home = side.eq("home")
        won = np.where(take_home, home_cover, ~home_cover)
        price = np.where(take_home, rows["home_spread_odds"], rows["away_spread_odds"])
    elif market == "total":
        over = rows["actual_total"] > rows["market_total"]
        push = rows["actual_total"] == rows["market_total"]
        take_over = side.eq("over")
        won = np.where(take_over, over, ~over)
        price = np.where(take_over, rows["over_odds"], rows["under_odds"])
    else:
        raise ValueError(market)
    rows["side"] = side.to_numpy(object)
    rows["push"] = push.to_numpy(bool)
    rows["won"] = np.asarray(won, dtype=bool)
    rows["price"] = np.asarray(price, dtype=float)
    rows = rows[np.isfinite(rows["price"]) & rows["side"].notna()].copy()
    rows["units"] = [0.0 if push_value else profit_one(price_value) if won_value else -1.0 for push_value, won_value, price_value in zip(rows["push"], rows["won"], rows["price"])]
    return rows


def summarize(rows: pd.DataFrame) -> dict[str, object]:
    resolved = rows[~rows["push"]]
    by_season = []
    for season, season_rows in rows.groupby("season", sort=True):
        resolved_season = season_rows[~season_rows["push"]]
        units = float(season_rows["units"].sum())
        by_season.append({
            "season": int(season),
            "bets": int(len(season_rows)),
            "wins": int(resolved_season["won"].sum()),
            "losses": int((~resolved_season["won"]).sum()),
            "pushes": int(season_rows["push"].sum()),
            "units": units,
            "roi": units / len(season_rows) if len(season_rows) else None,
        })
    units = float(rows["units"].sum())
    weeks = rows[["season", "week"]].drop_duplicates()
    season_week_counts = rows.groupby(["season", "week"]).size()
    return {
        "bets": int(len(rows)),
        "wins": int(resolved["won"].sum()),
        "losses": int((~resolved["won"]).sum()),
        "pushes": int(rows["push"].sum()),
        "units": units,
        "roi": units / len(rows) if len(rows) else None,
        "coveredSeasonWeeks": int(len(weeks)),
        "minimumBetsInCoveredWeek": int(season_week_counts.min()) if len(season_week_counts) else 0,
        "bySeason": by_season,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    feature_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.parquet"
    frame = pd.read_parquet(feature_path)
    frame = frame[(frame["season"] >= 2018) & (frame["season"] <= 2025)].copy()
    strategies: dict[str, tuple[str, pd.DataFrame, pd.Series, str]] = {}

    division = frame[frame["division_game"].eq(1)].copy()
    strategies["published_division_away_spread"] = (
        "Shank (2019): divisional familiarity lowers the home cover rate",
        division,
        pd.Series("away", index=division.index),
        "spread",
    )
    strategies["published_division_under"] = (
        "Shank (2019): divisional familiarity lowers the Over rate",
        division,
        pd.Series("under", index=division.index),
        "total",
    )

    home_dogs = frame[frame["market_home_margin"] < 0].copy()
    strategies["diagnostic_home_underdog_spread"] = (
        "Common market-regime diagnostic; not claimed as a published champion",
        home_dogs,
        pd.Series("home", index=home_dogs.index),
        "spread",
    )
    road_dogs = frame[frame["market_home_margin"] > 0].copy()
    strategies["diagnostic_road_underdog_spread"] = (
        "Common market-regime diagnostic; not claimed as a published champion",
        road_dogs,
        pd.Series("away", index=road_dogs.index),
        "spread",
    )
    windy = frame[frame["wind"] >= 15].copy()
    strategies["diagnostic_wind_15_under"] = (
        "Weather-regime diagnostic using the pregame sustained-wind field",
        windy,
        pd.Series("under", index=windy.index),
        "total",
    )

    report = {
        "auditRelease": AUDIT_RELEASE,
        "localOnly": True,
        "actionable": False,
        "source": str(feature_path),
        "sourceLimitation": "nflverse terminal prices; not timestamped OddSphere lock prices",
        "strategies": {
            name: {"hypothesis": hypothesis, **summarize(settle(rows, side, market))}
            for name, (hypothesis, rows, side, market) in strategies.items()
        },
    }
    report_path = root / "football-research/reports" / f"{AUDIT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({name: {key: value for key, value in result.items() if key != "bySeason"} for name, result in report["strategies"].items()}, indent=2))
    print(report_path)


if __name__ == "__main__":
    main()
