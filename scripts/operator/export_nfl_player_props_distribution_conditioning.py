#!/usr/bin/env python3
"""Export validated calibration-only NFL props distributions.

The point models and every non-distribution artifact field are preserved.  The
script can target a temporary directory for a no-write board replay before any
production artifact is replaced.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_REPORT = ROOT / "football-research/cache/nfl-player-props-distribution-conditioning/nfl_player_props_distribution_conditioning_r1.json"
DEFAULT_ARTIFACTS = ROOT / "lib/services/football/modelArtifacts"
MARKET_FILES = {
    "passing_attempts": "nflPlayerPropsRuntimeMarketPassingAttempts.json",
    "passing_completions": "nflPlayerPropsRuntimeMarketPassingCompletions.json",
    "passing_yards": "nflPlayerPropsRuntimeMarketPassingYards.json",
    "rushing_attempts": "nflPlayerPropsRuntimeMarketRushingAttempts.json",
    "rushing_yards": "nflPlayerPropsRuntimeMarketRushingYards.json",
    "receptions": "nflPlayerPropsRuntimeMarketReceptions.json",
    "receiving_yards": "nflPlayerPropsRuntimeMarketReceivingYards.json",
}
PORTABLE_RELEASE = "nfl_player_props_runtime_2026_10_07_r7_market_selective_mean_quintile"
MODEL_RELEASE = "nfl_player_props_distribution_model_2026_10_07_r16_market_selective_mean_quintile"
CALIBRATION_RELEASE = "nfl_player_props_distribution_calibration_2026_10_07_r18_market_selective_mean_quintile"
DECISION_RELEASE = "nfl_player_props_decision_2026_10_07_r21_market_selective_mean_quintile"
PROMOTED_MARKETS = {
    "passing_attempts",
    "passing_yards",
    "rushing_attempts",
    "rushing_yards",
    "receiving_yards",
}


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def write_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")


def portable_distribution(value: dict[str, Any]) -> dict[str, Any]:
    """Remove redundant percentile grids; the scorer only needs sorted residuals."""
    result = {key: item for key, item in value.items() if key != "probabilities"}
    if "fallback" in result:
        result["fallback"] = portable_distribution(result["fallback"])
    if "buckets" in result:
        result["buckets"] = [
            {**bucket, "distribution": portable_distribution(bucket["distribution"])}
            for bucket in result["buckets"]
        ]
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=pathlib.Path, default=DEFAULT_REPORT)
    parser.add_argument("--input-dir", type=pathlib.Path, default=DEFAULT_ARTIFACTS)
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    args = parser.parse_args()

    report = json.loads(args.report.read_text(encoding="utf-8"))
    if report.get("release") != "nfl_player_props_distribution_conditioning_tournament_2026_10_07_r1":
        raise RuntimeError("NFL props distribution-conditioning report release mismatch")
    if set(report.get("productionDistributions", {})) != set(MARKET_FILES):
        raise RuntimeError("NFL props production distribution set is incomplete")
    failed = [market for market, values in report["markets"].items() if not values["holdout"]["passes"]]
    if failed:
        raise RuntimeError(f"NFL props distribution holdout failed: {failed}")
    unexpected = [
        market for market, values in report["markets"].items()
        if values["candidateSelection"]["selected"] != "mean_quintile"
    ]
    if unexpected:
        raise RuntimeError(f"NFL props selected calibration changed: {unexpected}")

    artifact_checks: dict[str, Any] = {}
    for market, filename in MARKET_FILES.items():
        source_path = args.input_dir / filename
        preceding_sha256 = sha256(source_path)
        source = json.loads(source_path.read_text(encoding="utf-8"))
        promoted = market in PROMOTED_MARKETS
        candidate = {
            **source,
            "distribution": (
                portable_distribution(report["productionDistributions"][market])
                if promoted
                else source["distribution"]
            ),
        }
        if canonical(candidate["model"]) != canonical(source["model"]):
            raise RuntimeError(f"NFL props point model changed for {market}")
        unchanged_keys = set(source) - {"distribution"}
        if any(canonical(candidate[key]) != canonical(source[key]) for key in unchanged_keys):
            raise RuntimeError(f"NFL props non-distribution artifact field changed for {market}")
        output_path = args.output_dir / filename
        write_json(output_path, candidate)
        artifact_checks[market] = {
            "pointModelByteIdentical": True,
            "meanQuintilePromoted": promoted,
            "precedingSha256": preceding_sha256,
            "candidateSha256": sha256(output_path),
            "bucketCount": len(candidate["distribution"].get("buckets", [])),
        }

    core_name = "nflPlayerPropsRuntime.json"
    core_source_path = args.input_dir / core_name
    preceding_core_sha256 = sha256(core_source_path)
    core = json.loads(core_source_path.read_text(encoding="utf-8"))
    candidate_core = {
        **core,
        "runtimeRelease": PORTABLE_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "decisionRelease": DECISION_RELEASE,
        "sourceChecksums": {
            **core["sourceChecksums"],
            "distributionCalibrationHistory": report["historicalFeatureSha256"],
            "distributionConditioningTournament": sha256(args.report),
        },
    }
    allowed_core_changes = {
        "runtimeRelease", "modelRelease", "calibrationRelease", "decisionRelease", "sourceChecksums",
    }
    if any(canonical(candidate_core[key]) != canonical(core[key]) for key in set(core) - allowed_core_changes):
        raise RuntimeError("NFL props calibration export changed a non-release core artifact field")
    core_output_path = args.output_dir / core_name
    write_json(core_output_path, candidate_core)
    manifest = {
        "release": "nfl_player_props_distribution_conditioning_export_2026_10_07_r1",
        "sourceReport": str(args.report.resolve().relative_to(ROOT)),
        "sourceReportSha256": sha256(args.report),
        "historicalFeatureSha256": report["historicalFeatureSha256"],
        "releases": {
            "portable": PORTABLE_RELEASE,
            "model": MODEL_RELEASE,
            "calibration": CALIBRATION_RELEASE,
            "decision": DECISION_RELEASE,
        },
        "pointModelsByteIdentical": True,
        "promotedMarkets": sorted(PROMOTED_MARKETS),
        "deferredMarkets": sorted(set(MARKET_FILES) - PROMOTED_MARKETS),
        "deferredReason": "Exact Week 4 same-board replay rejected harmful actionable transitions for passing_completions and receptions.",
        "marketArtifacts": artifact_checks,
        "core": {
            "precedingSha256": preceding_core_sha256,
            "candidateSha256": sha256(core_output_path),
        },
    }
    manifest_path = args.output_dir / "nflPlayerPropsDistributionConditioningManifest.json"
    write_json(manifest_path, manifest)
    print(json.dumps({"outputDir": str(args.output_dir), **manifest}, indent=2))


if __name__ == "__main__":
    main()
