#!/usr/bin/env python3
"""Download and checksum the bounded nflverse inputs used by the local NFL model.

Raw files are intentionally stored under football-research/cache, which is ignored by
git. The derived model artifact records every source SHA-256 so a later run cannot
silently train on different bytes under the same release.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import tempfile
import time
import urllib.error
import urllib.request


CACHE_RELEASE = "nfl_real_model_source_cache_2016_2025_2026_08_19_r1"
DEFAULT_START = 2016
DEFAULT_END = 2025
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
DATASETS = {
    "pbp": f"{BASE}/pbp/play_by_play_{{season}}.parquet",
    "weekly_rosters": f"{BASE}/weekly_rosters/roster_weekly_{{season}}.parquet",
    "snap_counts": f"{BASE}/snap_counts/snap_counts_{{season}}.parquet",
    "injuries": f"{BASE}/injuries/injuries_{{season}}.parquet",
}


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, target: pathlib.Path, *, retries: int = 3) -> dict[str, object]:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size > 0:
        return {
            "url": url,
            "filename": str(target),
            "bytes": target.stat().st_size,
            "sha256": sha256_file(target),
            "cacheHit": True,
        }

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        temp_path: pathlib.Path | None = None
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "OddSphere-NFL-Research/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response:
                expected = response.headers.get("Content-Length")
                with tempfile.NamedTemporaryFile(
                    mode="wb", delete=False, dir=target.parent, prefix=f".{target.name}.", suffix=".partial"
                ) as temp:
                    temp_path = pathlib.Path(temp.name)
                    while chunk := response.read(1024 * 1024):
                        temp.write(chunk)
            if expected is not None and temp_path.stat().st_size != int(expected):
                raise RuntimeError(
                    f"short download for {url}: {temp_path.stat().st_size} != {expected}"
                )
            os.replace(temp_path, target)
            return {
                "url": url,
                "filename": str(target),
                "bytes": target.stat().st_size,
                "sha256": sha256_file(target),
                "cacheHit": False,
            }
        except (OSError, RuntimeError, urllib.error.URLError) as error:
            last_error = error
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(attempt * 2)
    raise RuntimeError(f"failed to download {url} after {retries} attempts") from last_error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=DEFAULT_START)
    parser.add_argument("--end", type=int, default=DEFAULT_END)
    parser.add_argument("--datasets", nargs="+", choices=sorted(DATASETS), default=sorted(DATASETS))
    args = parser.parse_args()
    if args.start < 1999 or args.end > DEFAULT_END or args.start > args.end:
        raise SystemExit("season range must be ordered and end no later than the completed 2025 season")

    root = pathlib.Path.cwd() / "football-research" / "cache" / "nflverse" / "real-model-r1"
    files: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []
    for dataset in args.datasets:
        for season in range(args.start, args.end + 1):
            url = DATASETS[dataset].format(season=season)
            target = root / dataset / f"{season}.parquet"
            try:
                item = download(url, target)
                item.update({"dataset": dataset, "season": season})
                files.append(item)
                print(
                    f"{dataset:14} {season}: {int(item['bytes']) / 1024 / 1024:7.1f} MB "
                    f"sha256={str(item['sha256'])[:12]} cache={item['cacheHit']}"
                )
            except RuntimeError as error:
                failures.append({"dataset": dataset, "season": season, "url": url, "error": str(error)})
                print(f"{dataset:14} {season}: UNAVAILABLE ({error})")

    manifest = {
        "cacheRelease": CACHE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seasonRange": [args.start, args.end],
        "datasetsRequested": args.datasets,
        "files": files,
        "failures": failures,
        "totalBytes": sum(int(item["bytes"]) for item in files),
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"manifest: {manifest_path}")
    print(f"downloaded/cache-verified files: {len(files)}; unavailable: {len(failures)}")
    if any(item["dataset"] == "pbp" for item in failures):
        raise SystemExit("required play-by-play source is unavailable")


if __name__ == "__main__":
    main()
