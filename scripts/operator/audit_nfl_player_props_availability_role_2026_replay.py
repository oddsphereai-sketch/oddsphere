#!/usr/bin/env python3
"""Exact locked replay for frozen availability and vacated-role candidates."""

from __future__ import annotations

import importlib.util
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]
TOURNAMENT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_availability_role_r1.json"
REPLAY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_2026_locked_replay_rows_r1.json"
OUTPUT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_availability_role_2026_replay_r1.json"
RELEASE = "nfl_player_props_availability_role_2026_locked_replay_2026_10_08_r1"


def load() -> object:
    path = ROOT / "scripts/operator/audit_nfl_player_props_opportunity_efficiency_2026_replay.py"
    spec = importlib.util.spec_from_file_location("props_availability_replay", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = value
    spec.loader.exec_module(value)
    return value


if __name__ == "__main__":
    forwarded = sys.argv[1:]
    sys.argv = [
        sys.argv[0],
        "--tournament", str(TOURNAMENT),
        "--replay", str(REPLAY),
        "--output", str(OUTPUT),
        "--release", RELEASE,
        *forwarded,
    ]
    load().main()
