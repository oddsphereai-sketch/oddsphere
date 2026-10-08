#!/usr/bin/env python3
"""Cache checksum-pinned public inputs for NFL player-props shadow research.

This is deliberately separate from the production provider path. It downloads
public postgame research data only and cannot write predictions or snapshots.
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
from dataclasses import dataclass


CACHE_RELEASE = "nfl_player_props_external_source_cache_2026_10_08_r1"
BASE = "https://github.com/nflverse/nflverse-data/releases/download"
DEFAULT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-external")


@dataclass(frozen=True)
class Source:
    dataset: str
    season: int | None
    url: str
    relative_path: pathlib.Path


def sources(current_season: int) -> list[Source]:
    rows = [
        Source(
            dataset=f"ngs_{stat_type}",
            season=None,
            url=f"{BASE}/nextgen_stats/ngs_{stat_type}.parquet",
            relative_path=pathlib.Path("nextgen_stats") / f"ngs_{stat_type}.parquet",
        )
        for stat_type in ("passing", "receiving", "rushing")
    ]
    rows.extend(
        Source(
            dataset="ftn_charting",
            season=season,
            url=f"{BASE}/ftn_charting/ftn_charting_{season}.parquet",
            relative_path=pathlib.Path("ftn_charting") / f"{season}.parquet",
        )
        for season in range(2022, current_season + 1)
    )
    rows.extend(
        Source(
            dataset=f"pfr_{stat_type}",
            season=season,
            url=f"{BASE}/pfr_advstats/advstats_week_{stat_type}_{season}.parquet",
            relative_path=pathlib.Path("pfr_advstats") / stat_type / f"{season}.parquet",
        )
        for stat_type in ("pass", "rush", "rec", "def")
        for season in range(2018, current_season + 1)
    )
    current_patterns = {
        "pbp": "pbp/play_by_play_{season}.parquet",
        "weekly_rosters": "weekly_rosters/roster_weekly_{season}.parquet",
        "snap_counts": "snap_counts/snap_counts_{season}.parquet",
        "injuries": "injuries/injuries_{season}.parquet",
        "player_stats": "stats_player/stats_player_week_{season}.parquet",
        "team_stats": "stats_team/stats_team_week_{season}.parquet",
    }
    rows.extend(
        Source(
            dataset=dataset,
            season=current_season,
            url=f"{BASE}/{pattern.format(season=current_season)}",
            relative_path=pathlib.Path("current") / dataset / f"{current_season}.parquet",
        )
        for dataset, pattern in current_patterns.items()
    )
    return rows


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(source: Source, root: pathlib.Path, retries: int) -> dict[str, object]:
    target = root / source.relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size > 0:
        return {
            "dataset": source.dataset,
            "season": source.season,
            "url": source.url,
            "filename": str(target.resolve()),
            "bytes": target.stat().st_size,
            "sha256": sha256_file(target),
            "cacheHit": True,
        }

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        temporary: pathlib.Path | None = None
        try:
            request = urllib.request.Request(
                source.url,
                headers={"User-Agent": "OddSphere-NFL-Player-Props-External-Research/1.0"},
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                expected = response.headers.get("Content-Length")
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    delete=False,
                    dir=target.parent,
                    prefix=f".{target.name}.",
                    suffix=".partial",
                ) as handle:
                    temporary = pathlib.Path(handle.name)
                    while chunk := response.read(1024 * 1024):
                        handle.write(chunk)
            if expected is not None and temporary.stat().st_size != int(expected):
                raise RuntimeError(
                    f"short download for {source.url}: {temporary.stat().st_size} != {expected}"
                )
            os.replace(temporary, target)
            return {
                "dataset": source.dataset,
                "season": source.season,
                "url": source.url,
                "filename": str(target.resolve()),
                "bytes": target.stat().st_size,
                "sha256": sha256_file(target),
                "cacheHit": False,
            }
        except (OSError, RuntimeError, urllib.error.URLError) as error:
            last_error = error
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(2 * attempt)
    raise RuntimeError(f"failed to download {source.url} after {retries} attempts") from last_error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current-season", type=int, default=2026)
    parser.add_argument("--root", type=pathlib.Path, default=DEFAULT_ROOT)
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()
    if not 2022 <= args.current_season <= 2100:
        raise SystemExit("current season must be 2022 or later")
    selected = sources(args.current_season)
    files: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []
    for source in selected:
        try:
            item = download(source, args.root, args.retries)
            files.append(item)
            print(
                f"{source.dataset:18} {str(source.season or 'all'):>4}: "
                f"{int(item['bytes']) / 1024 / 1024:7.1f} MB "
                f"sha256={str(item['sha256'])[:12]} cache={item['cacheHit']}",
                flush=True,
            )
        except RuntimeError as error:
            failures.append(
                {
                    "dataset": source.dataset,
                    "season": source.season,
                    "url": source.url,
                    "error": str(error),
                }
            )
            print(f"{source.dataset:18} {str(source.season or 'all'):>4}: UNAVAILABLE", flush=True)

    manifest = {
        "cacheRelease": CACHE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "currentSeason": args.current_season,
        "researchOnly": True,
        "attribution": {"ftn_charting": "FTN Data via nflverse"},
        "files": files,
        "failures": failures,
        "totalBytes": sum(int(item["bytes"]) for item in files),
    }
    args.root.mkdir(parents=True, exist_ok=True)
    manifest_path = args.root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"manifest: {manifest_path}")
    print(f"verified files: {len(files)}; unavailable: {len(failures)}")
    required = {"ngs_passing", "ngs_receiving", "ngs_rushing", "ftn_charting", "pbp", "player_stats", "team_stats"}
    failed_required = sorted(required.intersection({str(item["dataset"]) for item in failures}))
    if failed_required:
        raise SystemExit(f"required external research sources unavailable: {', '.join(failed_required)}")


if __name__ == "__main__":
    main()

