#!/usr/bin/env python3
"""Export deterministic rows for TypeScript/Python NBA artifact parity."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import tournament_nba_professional_model as professional


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rows", type=int, default=25)
    return parser.parse_args()


def main() -> None:
    args = arguments()
    artifact = json.loads(args.artifact.read_text())
    source = []
    with args.predictions.open() as handle:
        for line in handle:
            if len(source) >= args.rows:
                break
            source.append(json.loads(line))
    features = pd.DataFrame([row["selectedFeatureState"] for row in source])
    home, away = professional.predict_deployment_candidate(features, artifact)
    fixture = {
        "artifact": artifact,
        "rows": [
            {
                "gameId": int(source[index]["gameId"]),
                "features": source[index]["selectedFeatureState"],
                "expected": {
                    "homeScore": float(home[index]),
                    "awayScore": float(away[index]),
                    "marginHome": float(home[index] - away[index]),
                    "total": float(home[index] + away[index]),
                },
            }
            for index in range(len(source))
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(fixture, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"output": str(args.output), "rows": len(source)}, indent=2))


if __name__ == "__main__":
    main()

