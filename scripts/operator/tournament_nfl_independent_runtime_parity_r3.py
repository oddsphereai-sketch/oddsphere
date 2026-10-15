#!/usr/bin/env python3
"""Select the smallest frozen Extra Trees margin head that matches r1."""

from __future__ import annotations

import json
import pathlib
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

import tournament_nfl_independent_score_rebuild_r1 as r1


RELEASE = "nfl_independent_runtime_parity_tournament_2026_10_15_r3"
TREE_COUNTS = (48, 72, 96, 160, 500)
REFERENCE_TREES = 500


def forest(trees: int) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=False)),
        ("model", ExtraTreesRegressor(
            n_estimators=trees,
            min_samples_leaf=12,
            max_features=0.65,
            n_jobs=-1,
            random_state=r1.RANDOM_STATE,
        )),
    ])


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, trees: int) -> np.ndarray:
    train_x = r1.engineered_features(train, "core")
    test_x = r1.engineered_features(test, "core")
    model = forest(trees)
    model.fit(train_x, train["actual_margin"].to_numpy(float))
    return np.asarray(model.predict(test_x), dtype=float)


def direction_rate(report: dict[str, Any], key: str) -> float:
    value = report[key]["hitRate"]
    if value is None:
        raise RuntimeError(f"missing {key} hit rate")
    return float(value)


def margin_report(games: pd.DataFrame, margin: np.ndarray) -> dict[str, Any]:
    actual = games["actual_margin"].to_numpy(float)
    market = games["market_home_margin"].to_numpy(float)
    return {
        "games": len(games),
        "margin": r1.point_metrics(actual, margin),
        "moneyline": r1.selected_side_record(margin, actual, 0.0),
        "spread": r1.selected_side_record(margin, actual, market),
        "spreadPlus3": r1.selected_side_record(margin, actual, market, 3.0),
        "spreadPlus6": r1.selected_side_record(margin, actual, market, 6.0),
        "finite": bool(np.isfinite(margin).all()),
    }


def parity(candidate: dict[str, Any], reference: dict[str, Any]) -> dict[str, bool]:
    return {
        "pooledMarginMae": candidate["pooled"]["margin"]["mae"] <= reference["pooled"]["margin"]["mae"] + 0.10,
        "pooledMoneyline": direction_rate(candidate["pooled"], "moneyline") >= direction_rate(reference["pooled"], "moneyline") - 0.005,
        "pooledSpread": direction_rate(candidate["pooled"], "spread") >= direction_rate(reference["pooled"], "spread") - 0.005,
        "pooledSpreadPlus3": direction_rate(candidate["pooled"], "spreadPlus3") >= direction_rate(reference["pooled"], "spreadPlus3") - 0.005,
        "pooledSpreadPlus6": direction_rate(candidate["pooled"], "spreadPlus6") >= direction_rate(reference["pooled"], "spreadPlus6") - 0.005,
        "seasonMarginMae": all(
            candidate["bySeason"][str(season)]["margin"]["mae"]
            <= reference["bySeason"][str(season)]["margin"]["mae"] + 0.15
            for season in r1.CONFIRMATION_SEASONS
        ),
        "finite": bool(candidate["finite"]),
    }


def evaluate(games: pd.DataFrame, trees: int) -> dict[str, Any]:
    frames: list[pd.DataFrame] = []
    margins: list[np.ndarray] = []
    by_season: dict[str, Any] = {}
    for season in r1.CONFIRMATION_SEASONS:
        train = games[games["season"].lt(season)].reset_index(drop=True)
        test = games[games["season"].eq(season)].reset_index(drop=True)
        margin = fit_predict(train, test, trees)
        report = margin_report(test, margin)
        frames.append(test)
        margins.append(margin)
        by_season[str(season)] = report
    pooled_frame = pd.concat(frames, ignore_index=True)
    pooled_margin = np.concatenate(margins)
    pooled = margin_report(pooled_frame, pooled_margin)
    return {
        "trees": trees,
        "pooled": pooled,
        "bySeason": by_season,
        "finite": bool(np.isfinite(pooled_margin).all()),
    }


def exact_2026(games: pd.DataFrame, trees: int) -> dict[str, Any]:
    train = games[games["season"].le(2025)].reset_index(drop=True)
    test = games[games["season"].eq(2026)].reset_index(drop=True)
    margin = fit_predict(train, test, trees)
    return margin_report(test, margin)


def read_verified(root: pathlib.Path, manifest_name: str, expected_release: str) -> pd.DataFrame:
    manifest_path = root / "football-research/cache/nfl-model" / manifest_name
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != expected_release:
        raise RuntimeError(f"feature release mismatch: {manifest_name}")
    feature_path = pathlib.Path(manifest["featureFile"])
    if r1.sha256_file(feature_path) != manifest.get("featureFileSha256"):
        raise RuntimeError(f"feature checksum mismatch: {feature_path}")
    return pd.read_parquet(feature_path).sort_values(["season", "week", "game_id"]).reset_index(drop=True)


def main() -> None:
    root = pathlib.Path.cwd()
    historical = read_verified(
        root,
        "nfl_pregame_features_2016_2025_r1.manifest.json",
        r1.FEATURE_RELEASE,
    )
    results = {count: evaluate(historical, count) for count in TREE_COUNTS}
    reference = results[REFERENCE_TREES]
    candidates = []
    selected: dict[str, Any] | None = None
    for count in TREE_COUNTS[:-1]:
        row = results[count]
        gates = parity(row, reference)
        candidate = {**row, "gates": gates, "allGatesPass": all(gates.values())}
        candidates.append(candidate)
        if selected is None and candidate["allGatesPass"]:
            selected = candidate

    current = None
    if selected is not None:
        exact = read_verified(
            root,
            "nfl_pregame_features_2016_2026_exact_replay_r1.manifest.json",
            "nfl_real_pregame_features_2016_2026_2026_10_15_r3_exact_replay",
        )
        current = {
            "selected": exact_2026(exact, int(selected["trees"])),
            "reference": exact_2026(exact, REFERENCE_TREES),
        }

    payload = {
        "release": RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "referenceTrees": REFERENCE_TREES,
        "selectedTrees": None if selected is None else selected["trees"],
        "selectionBoundary": "2024-2025 parity to already-selected r1 architecture",
        "current2026Boundary": "opened stress test, not tree-count selection",
        "reference": reference,
        "candidates": candidates,
        "exact2026": current,
        "productionDecisionEffect": False,
    }
    output_root = root / "football-research/reports/nfl-independent-runtime-parity-r3"
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "tournament.json"
    output_path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "release": RELEASE,
        "selectedTrees": payload["selectedTrees"],
        "candidates": [{"trees": row["trees"], "gates": row["gates"], "allGatesPass": row["allGatesPass"]} for row in candidates],
        "reference": reference["pooled"],
        "selected": None if selected is None else selected["pooled"],
        "exact2026": current,
        "output": str(output_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
