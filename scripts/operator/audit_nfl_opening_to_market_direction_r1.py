#!/usr/bin/env python3
"""Read-only NFL opening-to-later-market direction audit.

The frozen rule and chronological gates live in
docs/model-audits/2026-09-21-nfl-opening-to-market-direction-predeclaration.md.
This operator never writes production, predictions, grades, or tracking rows.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
from typing import Any

import numpy as np
import pandas as pd


AUDIT_RELEASE = "nfl_opening_to_market_direction_audit_2026_09_21_r1"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
SELECTION_SEASONS = (2021, 2022, 2023)
CONFIRMATION_SEASONS = (2024, 2025)
OPENING_RELEASES = {
    season: f"bdl_nfl_opening_history_{season}_2026_08_20_r2"
    for season in (*SELECTION_SEASONS, *CONFIRMATION_SEASONS)
}


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implied(price: pd.Series) -> np.ndarray:
    values = pd.to_numeric(price, errors="coerce").to_numpy(float)
    result = np.full(values.shape, np.nan, dtype=float)
    positive = values > 0
    negative = values < 0
    result[positive] = 100.0 / (values[positive] + 100.0)
    result[negative] = -values[negative] / (-values[negative] + 100.0)
    return result


def no_vig(first: pd.Series, second: pd.Series) -> np.ndarray:
    a = implied(first)
    b = implied(second)
    denominator = a + b
    return np.divide(a, denominator, out=np.full(a.shape, np.nan), where=denominator > 0)


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / -price


def load(root: pathlib.Path) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    feature_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    feature_manifest = json.loads(feature_manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(str(feature_manifest["featureFile"]))
    if not feature_path.exists():
        feature_path = feature_manifest_path.parent / feature_path.name
    if feature_manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    if sha256_file(feature_path) != feature_manifest.get("featureFileSha256"):
        raise RuntimeError("feature checksum mismatch")
    features = pd.read_parquet(feature_path)
    features["homeJoin"] = features["home_team"].replace({"LA": "LAR", "WAS": "WSH"})
    features["awayJoin"] = features["away_team"].replace({"LA": "LAR", "WAS": "WSH"})

    frames: list[pd.DataFrame] = []
    evidence: list[dict[str, Any]] = []
    for season, release in OPENING_RELEASES.items():
        manifest_path = root / "football-research/cache/nfl-market" / f"{release}.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        data_path = pathlib.Path(str(manifest["dataFile"]))
        if not data_path.exists():
            data_path = manifest_path.parent / data_path.name
        if manifest.get("cacheRelease") != release or sha256_file(data_path) != manifest.get("dataSha256"):
            raise RuntimeError(f"opening release/checksum mismatch: {release}")
        payload = json.loads(data_path.read_text(encoding="utf-8"))
        games = pd.DataFrame(payload["games"])
        openings = pd.DataFrame(payload["openings"])
        openings = openings[openings["vendor"].eq("draftkings")].copy()
        if openings["gameId"].duplicated().any():
            raise RuntimeError(f"duplicate DraftKings opening: {season}")
        provider = games.merge(openings, on="gameId", validate="one_to_one")
        season_features = features[features["season"].eq(season)].copy()
        joined = provider.merge(
            season_features,
            left_on=["season", "homeTeam", "awayTeam"],
            right_on=["season", "homeJoin", "awayJoin"],
            validate="one_to_one",
        )
        frames.append(joined)
        evidence.append({
            "season": season,
            "release": release,
            "sha256": manifest["dataSha256"],
            "draftKingsOpenings": int(len(openings)),
            "joinedGames": int(len(joined)),
        })
    return pd.concat(frames, ignore_index=True), evidence


def decisions(frame: pd.DataFrame) -> pd.DataFrame:
    rows = frame.copy()
    rows["laterHomeLine"] = -pd.to_numeric(rows["market_home_margin"], errors="coerce")
    rows["laterTotal"] = pd.to_numeric(rows["market_total"], errors="coerce")
    rows["spreadMovement"] = rows["laterHomeLine"] - pd.to_numeric(rows["spreadHomeLine"], errors="coerce")
    rows["totalMovement"] = rows["laterTotal"] - pd.to_numeric(rows["totalLine"], errors="coerce")
    rows["homeFair"] = no_vig(rows["home_spread_odds"], rows["away_spread_odds"])
    rows["overFair"] = no_vig(rows["over_odds"], rows["under_odds"])

    rows["spreadFirst"] = np.where(
        rows["spreadMovement"].le(-0.5),
        True,
        np.where(rows["spreadMovement"].ge(0.5), False, rows["homeFair"].ge(0.5)),
    )
    rows["spreadReason"] = np.where(
        rows["spreadMovement"].le(-0.5),
        "move_home",
        np.where(rows["spreadMovement"].ge(0.5), "move_away", "flat_price"),
    )
    rows["spreadOutcome"] = rows["actual_margin"].gt(rows["market_home_margin"])
    rows["spreadPush"] = rows["actual_margin"].eq(rows["market_home_margin"])
    rows["spreadPrice"] = np.where(rows["spreadFirst"], rows["home_spread_odds"], rows["away_spread_odds"])

    rows["totalFirst"] = np.where(
        rows["totalMovement"].ge(0.5),
        True,
        np.where(rows["totalMovement"].le(-0.5), False, rows["overFair"].ge(0.5)),
    )
    rows["totalReason"] = np.where(
        rows["totalMovement"].ge(0.5),
        "move_over",
        np.where(rows["totalMovement"].le(-0.5), "move_under", "flat_price"),
    )
    rows["totalOutcome"] = rows["actual_total"].gt(rows["market_total"])
    rows["totalPush"] = rows["actual_total"].eq(rows["market_total"])
    rows["totalPrice"] = np.where(rows["totalFirst"], rows["over_odds"], rows["under_odds"])
    return rows


def summarize(rows: pd.DataFrame, market: str) -> dict[str, Any]:
    first = rows[f"{market}First"].astype(bool)
    outcome = rows[f"{market}Outcome"].astype(bool)
    push = rows[f"{market}Push"].astype(bool)
    price = pd.to_numeric(rows[f"{market}Price"], errors="coerce")
    resolved = rows.loc[~push & price.notna()].copy()
    resolved_first = resolved[f"{market}First"].astype(bool)
    resolved_outcome = resolved[f"{market}Outcome"].astype(bool)
    won = resolved_first.eq(resolved_outcome)
    prices = pd.to_numeric(resolved[f"{market}Price"], errors="coerce")
    units = [profit_one(float(p)) if bool(w) else -1.0 for p, w in zip(prices, won)]
    reasons: dict[str, Any] = {}
    for reason, group in resolved.assign(correct=won.to_numpy(), units=units).groupby(f"{market}Reason"):
        reasons[str(reason)] = {
            "resolved": int(len(group)),
            "wins": int(group["correct"].sum()),
            "accuracy": float(group["correct"].mean()),
            "units": float(group["units"].sum()),
        }
    return {
        "games": int(len(rows)),
        "resolved": int(len(resolved)),
        "pushes": int(push.sum()),
        "firstDirection": int(first.sum()),
        "secondDirection": int((~first).sum()),
        "wins": int(won.sum()),
        "accuracy": float(won.mean()) if len(won) else None,
        "units": float(sum(units)),
        "roi": float(sum(units) / len(units)) if units else None,
        "byReason": reasons,
    }


def report_period(frame: pd.DataFrame, seasons: tuple[int, ...]) -> dict[str, Any]:
    selected = frame[frame["season"].isin(seasons)].copy()
    by_season = {
        str(season): {
            market: summarize(selected[selected["season"].eq(season)], market)
            for market in ("spread", "total")
        }
        for season in seasons
    }
    return {
        "seasons": list(seasons),
        "pooled": {market: summarize(selected, market) for market in ("spread", "total")},
        "bySeason": by_season,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    frame, evidence = load(root)
    frame = decisions(frame)
    opened = os.environ.get("NFL_OPEN_CONFIRMATION") == "1"
    output = {
        "auditRelease": AUDIT_RELEASE,
        "readOnly": True,
        "productionBehaviorChanged": False,
        "confirmationOpened": opened,
        "evidence": evidence,
        "selection": report_period(frame, SELECTION_SEASONS),
        "confirmation": report_period(frame, CONFIRMATION_SEASONS) if opened else None,
    }
    print(json.dumps(output, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
