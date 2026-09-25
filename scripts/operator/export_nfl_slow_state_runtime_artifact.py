#!/usr/bin/env python3
"""Export the minimal checksum-pinned NFL slow-state runtime artifact."""

from __future__ import annotations

import hashlib
import json
import pathlib


RELEASE = "nfl_slow_state_runtime_artifact_2026_09_25_r1"
METRICS = ("points", "plays", "sack_rate", "turnover_rate", "redzone_td_rate")


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    root = pathlib.Path.cwd()
    manifest = json.loads((root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json").read_text())
    state_path = pathlib.Path(manifest["stateFile"])
    if sha256_file(state_path) != manifest["stateFileSha256"]:
        raise RuntimeError("NFL state artifact checksum mismatch")
    source = json.loads(state_path.read_text())
    output = {
        "release": RELEASE,
        "sourceFeatureRelease": manifest["featureRelease"],
        "sourceStateSha256": manifest["stateFileSha256"],
        "trainedThrough": source["trainedThrough"],
        "offseasonCarry": 0.65,
        "slowAlpha": 0.16,
        "priors": {
            "points": 22.5,
            "plays": 64.0,
            "sack_rate": 0.070,
            "turnover_rate": 0.022,
            "redzone_td_rate": 0.55,
        },
        "teams": {
            team: {
                "offSlow": {metric: row["offSlow"][metric] for metric in METRICS},
                "defSlow": {metric: row["defSlow"][metric] for metric in METRICS},
            }
            for team, row in sorted(source["teamStates"].items())
        },
    }
    output_path = root / "lib/services/football/modelArtifacts/nflSlowStateRuntime.json"
    output_path.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"output": str(output_path), "teams": len(output["teams"]), "sha256": sha256_file(output_path)}, indent=2))


if __name__ == "__main__":
    main()
