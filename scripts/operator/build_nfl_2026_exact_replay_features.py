#!/usr/bin/env python3
"""Build a leakage-safe 2016-2026 feature table for exact locked-game replay."""

from __future__ import annotations

import json
import pathlib
import time

import build_nfl_pregame_features as base


FEATURE_RELEASE = "nfl_real_pregame_features_2016_2026_2026_10_15_r3_exact_replay"
SOURCE_RELEASE = "nfl_real_model_source_cache_2016_2026_2026_10_15_r4_exact_replay"
SOURCE_MANIFEST_NAME = "manifest-2016-2026-exact-replay.json"


def main() -> None:
    root = pathlib.Path.cwd()
    source_manifest, paths = base.load_verified_manifest(
        root,
        manifest_name=SOURCE_MANIFEST_NAME,
        expected_release=SOURCE_RELEASE,
    )
    schedule, schedule_manifest, schedule_checksum = base.load_schedule(root, end_season=2026)
    aggregates = base.aggregate_pbp(paths)
    snap_share_priors = base.prior_snap_share_history(paths)
    injuries = base.injury_features(paths, snap_share_priors)
    continuity = base.roster_continuity(paths)
    features, states = base.build_features(
        schedule,
        aggregates,
        injuries,
        continuity,
        feature_release=FEATURE_RELEASE,
    )
    if len(features) < 2_650 or features["game_id"].nunique() != len(features):
        raise RuntimeError(f"unexpected exact-replay feature identity: {len(features)}")

    output_root = root / "football-research/cache/nfl-model"
    output_root.mkdir(parents=True, exist_ok=True)
    feature_path = output_root / "nfl_pregame_features_2016_2026_exact_replay_r1.parquet"
    state_path = output_root / "nfl_state_after_2026_exact_replay_r1.json"
    features.to_parquet(feature_path, index=False)
    state_path.write_text(json.dumps(states, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    source_manifest_path = root / "football-research/cache/nflverse/real-model-r1" / SOURCE_MANIFEST_NAME
    manifest = {
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceCacheRelease": source_manifest["cacheRelease"],
        "sourceManifestSha256": base.sha256_file(source_manifest_path),
        "scheduleCacheRelease": schedule_manifest["cacheRelease"],
        "scheduleSha256": schedule_checksum,
        "featureFile": str(feature_path),
        "featureFileSha256": base.sha256_file(feature_path),
        "stateFile": str(state_path),
        "stateFileSha256": base.sha256_file(state_path),
        "rows": len(features),
        "seasonCounts": {
            str(int(season)): int(count)
            for season, count in features.groupby("season")["game_id"].count().items()
        },
        "columns": list(features.columns),
        "asOfPolicy": "features_locked_before_complete_week_update",
        "pregameReplayOnly": True,
    }
    manifest_path = output_root / "nfl_pregame_features_2016_2026_exact_replay_r1.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "featureRelease": FEATURE_RELEASE,
        "rows": len(features),
        "seasonCounts": manifest["seasonCounts"],
        "featureFile": str(feature_path),
        "featureSha256": manifest["featureFileSha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
