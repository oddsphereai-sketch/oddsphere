#!/usr/bin/env python3
"""Build the frozen NHL 2026 opening-roster player prior artifact."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import zipfile
from pathlib import Path
from typing import Any


PRIORS = {"gameScore": 1.45, "ixg": 0.60, "points": 1.45, "onIceXgDiff": 0.0}


def finite(value: Any) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else 0.0
    except (TypeError, ValueError):
        return 0.0


def normalize_name(value: str) -> str:
    return " ".join(value.strip().lower().split())


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skaters", required=True, action="append", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    states: dict[str, dict[str, float | int | str]] = {}
    prior_season: int | None = None
    for path in args.skaters:
        season = int(path.stem.rsplit("-", 1)[1])
        if prior_season is not None and season != prior_season:
            for state in states.values():
                for field, prior in PRIORS.items():
                    state[field] = prior + 0.65 * (float(state[field]) - prior)
                state["icePerGame"] = 12.0 + 0.65 * (float(state["icePerGame"]) - 12.0)
        prior_season = season
        with zipfile.ZipFile(path) as archive:
            csv_name = next(name for name in archive.namelist() if name.endswith(".csv"))
            with archive.open(csv_name) as raw:
                for row in csv.DictReader(line.decode("utf-8") for line in raw):
                    game_id = str(row.get("gameId") or "")
                    if row.get("situation") != "all" or row.get("position") == "G" or len(game_id) < 6 or game_id[4:6] != "02":
                        continue
                    key = normalize_name(row["name"])
                    state = states.setdefault(key, {
                        "name": row["name"], "games": 0, "iceHours": 0.0, "icePerGame": 12.0,
                        **PRIORS,
                    })
                    ice_hours = finite(row.get("icetime")) / 3600
                    if ice_hours <= 0:
                        continue
                    minutes = ice_hours * 60
                    alpha = 0.04
                    effective = alpha * min(1.0, minutes / 18.0)
                    observed = {
                        "gameScore": finite(row.get("gameScore")) / ice_hours,
                        "ixg": finite(row.get("I_F_xGoals")) / ice_hours,
                        "points": finite(row.get("I_F_points")) / ice_hours,
                        "onIceXgDiff": (finite(row.get("OnIce_F_xGoals")) - finite(row.get("OnIce_A_xGoals"))) / ice_hours,
                    }
                    for field, value in observed.items():
                        state[field] = (1 - effective) * float(state[field]) + effective * value
                    state["icePerGame"] = (1 - alpha) * float(state["icePerGame"]) + alpha * minutes
                    state["games"] = int(state["games"]) + 1
                    state["iceHours"] = float(state["iceHours"]) + ice_hours
    for state in states.values():
        for field, prior in PRIORS.items():
            state[field] = prior + 0.65 * (float(state[field]) - prior)
        state["icePerGame"] = 12.0 + 0.65 * (float(state["icePerGame"]) - 12.0)
        for field in ("iceHours", "icePerGame", *PRIORS):
            state[field] = round(float(state[field]), 8)
    payload = {
        "release": "nhl_roster_player_priors_2026_09_30_r1",
        "source": "MoneyPuck regular-season skater game summaries",
        "seasons": [2022, 2023, 2024, 2025],
        "alpha": 0.04,
        "seasonRetention": 0.65,
        "neutral": PRIORS,
        "inputs": [{"file": path.name, "sha256": checksum(path)} for path in args.skaters],
        "players": {key: value for key, value in sorted(states.items())},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(json.dumps({"output": str(args.output), "players": len(states), "release": payload["release"]}, indent=2))


if __name__ == "__main__":
    main()
