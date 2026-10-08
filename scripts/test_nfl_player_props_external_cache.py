#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import pathlib
import sys


SCRIPT = pathlib.Path(__file__).parent / "operator" / "cache_nfl_player_props_external_features.py"
spec = importlib.util.spec_from_file_location("nfl_props_external_cache", SCRIPT)
if not spec or not spec.loader:
    raise RuntimeError("external cache module could not be loaded")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


rows = module.sources(2026)
keys = {(row.dataset, row.season) for row in rows}
assert len(rows) == len(keys)
assert {f"ngs_{name}" for name in ("passing", "receiving", "rushing")} <= {row.dataset for row in rows}
assert {("ftn_charting", season) for season in range(2022, 2027)} <= keys
assert {(f"pfr_{name}", season) for name in ("pass", "rush", "rec", "def") for season in range(2018, 2027)} <= keys
assert {(name, 2026) for name in ("pbp", "weekly_rosters", "snap_counts", "injuries", "player_stats", "team_stats")} <= keys
assert all(row.url.startswith("https://github.com/nflverse/nflverse-data/releases/download/") for row in rows)
assert all("nextgen_stats/ngs_" in row.url for row in rows if row.dataset.startswith("ngs_"))
assert all("ftn_charting/ftn_charting_" in row.url for row in rows if row.dataset == "ftn_charting")
print("NFL player props external cache source inventory tests passed.")

