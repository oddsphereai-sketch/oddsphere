#!/usr/bin/env python3
"""Qualifying rerun for the frozen r1 head under the corrected mean gate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tournament_cfb_v1_model import run


RELEASE = "cfb_v1_independent_joint_distribution_2026_08_25_r3"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", default="football-research/cache/cfb-model/source")
    parser.add_argument("--output", default="football-research/reports/cfb_v1_independent_joint_distribution_2026_08_25_r3.json")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()
    report = run(args)
    selected = report["selectedFamily"]
    seasons = [str(report["chronology"]["selection"]), *map(str, report["chronology"]["confirmation"])]
    values = {
        seasons[0]: report["selectionCandidates"][selected],
        **report["confirmation"],
    }
    mean_dispersion = all(
        min(
            values[season]["margin_to_market_dispersion"],
            values[season]["total_to_market_dispersion"],
            values[season]["team_score_to_market_dispersion"],
        ) >= 0.75
        for season in seasons
    )
    interval_coverage = all(
        0.15 <= report["confirmation"][str(season)]["total_interval_miss"] <= 0.30
        for season in report["chronology"]["confirmation"]
    )
    gates = {
        key: value
        for key, value in report["gates"].items()
        if key != "confirmation_dispersion"
    }
    gates["conditional_mean_vs_market_dispersion"] = mean_dispersion
    gates["joint_interval_coverage"] = interval_coverage
    report.update({
        "release": RELEASE,
        "qualificationCorrection": "conditional_means_compared_with_market_means_full_distribution_checked_by_interval_coverage",
        "gates": gates,
        "promotable": all(gates.values()),
    })
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "output": str(output),
        "selected": selected,
        "dispersion": {season: {
            "margin": values[season]["margin_to_market_dispersion"],
            "total": values[season]["total_to_market_dispersion"],
            "teamScore": values[season]["team_score_to_market_dispersion"],
        } for season in seasons},
        "gates": gates,
        "promotable": report["promotable"],
    }, indent=2))


if __name__ == "__main__":
    main()
