#!/usr/bin/env python3
"""Read-only decomposition of frozen 2026 NFL score/evidence layers."""

from __future__ import annotations

import json
import pathlib

import numpy as np


RELEASE = "nfl_2026_market_evidence_layer_audit_2026_09_25_r1"


def direction(rows: list[dict], prediction) -> dict:
    resolved = [row for row in rows if row["actualTotal"] != row["marketTotal"]]
    calls = [prediction(row) for row in resolved]
    called = [abs(call - row["marketTotal"]) > 1e-9 for row, call in zip(resolved, calls, strict=True)]
    correct = [
        (call > row["marketTotal"]) == (row["actualTotal"] > row["marketTotal"])
        for row, call, keep in zip(resolved, calls, called, strict=True)
        if keep
    ]
    return {
        "resolvedCalls": len(correct),
        "correct": int(sum(correct)),
        "accuracy": float(np.mean(correct)) if correct else None,
        "over": int(sum(call > row["marketTotal"] for row, call, keep in zip(resolved, calls, called, strict=True) if keep)),
        "under": int(sum(call < row["marketTotal"] for row, call, keep in zip(resolved, calls, called, strict=True) if keep)),
        "mae": float(np.mean([abs(prediction(row) - row["actualTotal"]) for row in resolved])),
    }


def sign_accuracy(rows: list[dict], key: str) -> dict:
    available = [row for row in rows if row[key] != 0]
    correct = [
        (row[key] > 0) == (row["actualTotal"] > row["marketTotal"])
        for row in available
    ]
    return {"rows": len(available), "correct": int(sum(correct)), "accuracy": float(np.mean(correct)) if correct else None}


def main() -> None:
    root = pathlib.Path.cwd()
    source_path = root / "football-research/reports/nfl_2026_score_engine_replay_inputs_2026_09_25_r1.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    rows = []
    for game in source["games"]:
        evidence = game.get("marketEvidence") or {}
        core = evidence.get("calibratedCore") or {}
        sharp = evidence.get("sharp") or {}
        public = evidence.get("publicConsensus") or {}
        movement = evidence.get("movement") or {}
        actual_total = float(game["homeScore"] + game["awayScore"])
        rows.append({
            "gameId": game["providerGameId"],
            "week": game["week"],
            "actualTotal": actual_total,
            "marketTotal": float(game["marketTotal"]),
            "publishedTotal": float(game["publishedExpectedHomeScore"] + game["publishedExpectedAwayScore"]),
            "coreTotal": float(core.get("calibratedTotal", game["marketTotal"])),
            "sharpShift": float(sharp.get("totalShiftPoints", 0)),
            "publicShift": float(public.get("totalShiftPoints", 0)),
            "movementShift": float(movement.get("totalShiftPoints", 0)),
            "appliedShift": float(evidence.get("appliedTotalShiftPoints", 0)),
        })
    variants = {
        "market": direction(rows, lambda row: row["marketTotal"]),
        "calibratedCore": direction(rows, lambda row: row["coreTotal"]),
        "published": direction(rows, lambda row: row["publishedTotal"]),
        "corePlusSharp": direction(rows, lambda row: row["coreTotal"] + row["sharpShift"]),
        "corePlusPublic": direction(rows, lambda row: row["coreTotal"] + row["publicShift"]),
        "corePlusMovement": direction(rows, lambda row: row["coreTotal"] + row["movementShift"]),
        "corePlusAllRaw": direction(rows, lambda row: row["coreTotal"] + row["sharpShift"] + row["publicShift"] + row["movementShift"]),
    }
    report = {
        "release": RELEASE,
        "sourceRelease": source["release"],
        "readOnly": True,
        "productionChanged": False,
        "games": len(rows),
        "variants": variants,
        "evidenceSignAccuracy": {
            "sharp": sign_accuracy(rows, "sharpShift"),
            "public": sign_accuracy(rows, "publicShift"),
            "movement": sign_accuracy(rows, "movementShift"),
            "applied": sign_accuracy(rows, "appliedShift"),
        },
    }
    report_path = root / "football-research/reports" / f"{RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
