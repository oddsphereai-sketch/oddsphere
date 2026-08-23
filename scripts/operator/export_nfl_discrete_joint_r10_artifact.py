#!/usr/bin/env python3
"""Export the qualified NFL r10 Week 1 joint-distribution runtime artifact."""

from __future__ import annotations

import hashlib
import json
import pathlib


REPORT = pathlib.Path("football-research/reports/nfl_discrete_drive_joint_2026_08_23_r10.json")
SOURCE_ARTIFACT = pathlib.Path("lib/services/football/modelArtifacts/nflV1WeekOneOutcome.json")
OUTPUT = SOURCE_ARTIFACT


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    report = json.loads(REPORT.read_text())
    source = json.loads(SOURCE_ARTIFACT.read_text())
    if not report.get("qualified"):
        raise RuntimeError("NFL r10 report is not qualified")
    if report.get("selectedRepresentativeWeight") != 0.4:
        raise RuntimeError("NFL r10 representative weight mismatch")
    source_by_game = {str(game["providerGameId"]): game for game in source["games"]}
    games = []
    for game in report["currentWeek1"]["games"]:
        provider_game_id = str(game["providerGameId"])
        prior = source_by_game[provider_game_id]
        representative = game["representativeScore"]
        source_away = prior.get("projectedAwayScore", prior.get("sourceExpectedAwayScore"))
        source_home = prior.get("projectedHomeScore", prior.get("sourceExpectedHomeScore"))
        if source_away is None or source_home is None:
            raise RuntimeError(f"NFL r10 source projection is missing for {provider_game_id}")
        games.append({
            "providerGameId": provider_game_id,
            "awayTeam": game["awayTeam"],
            "homeTeam": game["homeTeam"],
            "expectedAwayScore": game["expectedAwayScore"],
            "expectedHomeScore": game["expectedHomeScore"],
            "representativeAwayScore": representative["awayScore"],
            "representativeHomeScore": representative["homeScore"],
            "representativeScoreProbability": representative["probability"],
            "awayWinProbability": game["awayWinProbability"],
            "homeWinProbability": game["homeWinProbability"],
            "tieProbability": game["tieProbability"],
            "marginDistribution": game["marginDistribution"],
            "totalDistribution": game["totalDistribution"],
            "sourceExpectedAwayScore": source_away,
            "sourceExpectedHomeScore": source_home,
        })
    if len(games) != 16 or len({game["providerGameId"] for game in games}) != 16:
        raise RuntimeError("NFL r10 artifact must contain 16 unique games")
    artifact = {
        "artifactRelease": "nfl_v1_week_one_outcome_artifact_2026_08_23_r2_discrete_joint",
        "modelRelease": "nfl_v1_discrete_drive_outcome_2026_08_23_r2",
        "distributionRelease": report["distributionRelease"],
        "probabilityRelease": "nfl_v1_discrete_joint_probability_2026_08_23_r2",
        "representativeScorePolicyRelease": "nfl_v1_representative_score_2026_08_23_r2",
        "tournamentRelease": report["tournamentRelease"],
        "source": {
            **source["source"],
            "pbpManifestSha256": report["source"]["pbpManifestSha256"],
            "r10ReportSha256": sha256(REPORT),
        },
        "games": games,
    }
    OUTPUT.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "output": str(OUTPUT),
        "sha256": sha256(OUTPUT),
        "games": len(games),
        "tournamentRelease": artifact["tournamentRelease"],
    }, indent=2))


if __name__ == "__main__":
    main()
