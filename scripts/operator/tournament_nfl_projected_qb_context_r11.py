#!/usr/bin/env python3
"""Audit a projected-QB-conditioned Week 1 score scenario.

The historical model and its frozen selection remain unchanged. This operator
only substitutes timestamp-valid projected quarterback history into the five
QB-room fields of the current 2026 Week 1 feature matrix, refits the already
selected football components on their frozen history, and passes the resulting
team means through the qualified r10 discrete scoring-event law.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import pathlib
import re
import sys
import time
from typing import Any

import numpy as np


TOURNAMENT_RELEASE = "nfl_projected_qb_score_context_2026_08_25_r11"
COMPREHENSIVE_RELEASE = "nfl_v1_comprehensive_projected_qb_scenario_2026_08_25_r11"
R10_RELEASE = "nfl_discrete_drive_joint_2026_08_23_r10"
MAX_TEAM_SCORE_MOVE = 3.0
MAX_MARGIN_MOVE = 5.0


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_name(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


def load_module(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load research module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    root = pathlib.Path.cwd()
    source_root = pathlib.Path(os.environ.get(
        "NFL_COMPREHENSIVE_SOURCE_ROOT",
        "/private/tmp/oddsphere-nfl-v1-comprehensive-shadow-20260822",
    )).resolve()
    source_script = source_root / "scripts/operator/tournament_nfl_v1_comprehensive.py"
    if not source_script.exists():
        raise RuntimeError("frozen comprehensive research source is unavailable")
    source_scripts = source_script.parent
    sys.path.insert(0, str(source_scripts))
    comprehensive = load_module("nfl_v1_comprehensive_projected_qb_source", source_script)
    r10 = load_module(
        "nfl_discrete_drive_joint_projected_qb_source",
        root / "scripts/operator/tournament_nfl_discrete_drive_joint_r7.py",
    )

    evidence_path = pathlib.Path(os.environ.get(
        "NFL_FORWARD_EVIDENCE_PATH",
        str(root / "football-research/reports/nfl_forward_evidence_r8_latest.local.json"),
    )).resolve()
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    latest_rows = evidence.get("latestRows", [])
    if evidence.get("season") != 2026 or evidence.get("week") != 1 or len(latest_rows) != 16:
        raise RuntimeError("projected-QB scenario requires the exact 16-game Week 1 evidence")

    r6_artifact_path = root / "lib/services/football/modelArtifacts/nflR6MoneylineShadow.json"
    r6_artifact = json.loads(r6_artifact_path.read_text(encoding="utf-8"))
    name_to_id = r6_artifact["quarterbackNameToId"]
    projected: dict[str, dict[str, Any]] = {}
    for stored in latest_rows:
        payload = stored["payload"]
        for side in ("away", "home"):
            team = comprehensive.normalize_team(payload["game"][side]["abbreviation"])
            depth = payload["startersAndDepth"][side]["quarterbackDepth"]
            if not depth:
                raise RuntimeError(f"quarterback depth is empty for {team}")
            quarterback = depth[0]
            name = str(quarterback["name"])
            quarterback_id = name_to_id.get(normalize_name(name))
            if not quarterback_id:
                raise RuntimeError(f"projected quarterback history is unmatched: {team} {name}")
            projected[team] = {
                "name": name,
                "id": quarterback_id,
                "status": "confirmed" if quarterback.get("explicitStarter") else "projected",
            }
    if len(projected) != 32:
        raise RuntimeError(f"expected 32 projected quarterbacks; found {len(projected)}")

    comprehensive.OPENING_RELEASES[2021] = "bdl_nfl_opening_history_2021_2026_08_20_r2"
    comprehensive.OPENING_RELEASES[2025] = "bdl_nfl_opening_history_2025_2026_08_20_r2"
    os.environ.setdefault(
        "NFL_RESEARCH_CACHE_ROOT",
        "/private/tmp/oddsphere-nfl-predictive-audit-20260821/football-research/cache",
    )
    os.environ["NFL_FORWARD_EVIDENCE_PATH"] = str(evidence_path)

    state_manifest_path = (
        root / "football-research/reports/nfl-v1-comprehensive/"
        "nfl_v1_comprehensive_features_2016_2025_r1.manifest.json"
    )
    state_manifest = json.loads(state_manifest_path.read_text(encoding="utf-8"))
    state_path = pathlib.Path(state_manifest["stateFile"])
    if not state_path.exists():
        state_path = state_manifest_path.parent / state_path.name
    if sha256_file(state_path) != state_manifest["stateFileSha256"]:
        raise RuntimeError("comprehensive QB state checksum mismatch")
    qb_states = json.loads(state_path.read_text(encoding="utf-8"))["quarterbackStates"]

    original_current_week_features = comprehensive.current_week_features
    substitutions: list[dict[str, Any]] = []

    def projected_qb_current_week_features(*args, **kwargs):
        current, markets, source = original_current_week_features(*args, **kwargs)
        carry = comprehensive.feature_builder.QB_OFFSEASON_CARRY
        for index, row in current.iterrows():
            for side in ("home", "away"):
                team = str(row[f"{side}_team"])
                context = projected[team]
                state = qb_states.get(context["id"])
                if not state:
                    raise RuntimeError(f"projected quarterback state is unavailable: {team} {context['name']}")
                dropbacks = carry * float(state["dropbacks"])
                weight = min(1.0, dropbacks / 180.0)
                values = {
                    f"{side}_qb_room_epa": weight * carry * float(state["epa"]),
                    f"{side}_qb_room_cpoe": weight * carry * float(state["cpoe"]),
                    f"{side}_qb_room_sack_rate": weight * (
                        comprehensive.METRIC_PRIORS["sack_rate"] + carry * (
                            float(state["sackRate"]) - comprehensive.METRIC_PRIORS["sack_rate"]
                        )
                    ) + (1.0 - weight) * comprehensive.METRIC_PRIORS["sack_rate"],
                    f"{side}_qb_room_turnover_rate": weight * (
                        comprehensive.METRIC_PRIORS["turnover_rate"] + carry * (
                            float(state["turnoverRate"]) - comprehensive.METRIC_PRIORS["turnover_rate"]
                        )
                    ) + (1.0 - weight) * comprehensive.METRIC_PRIORS["turnover_rate"],
                    f"{side}_qb_room_log_dropbacks": math.log1p(dropbacks),
                }
                before = {column: float(current.at[index, column]) for column in values}
                for column, value in values.items():
                    current.at[index, column] = value
                substitutions.append({
                    "gameId": str(row["game_id"]), "team": team, **context,
                    "before": before, "after": values,
                })
        return current, markets, {
            **source,
            "projectedQbScenario": True,
            "projectedQbCount": len(projected),
        }

    comprehensive.current_week_features = projected_qb_current_week_features
    comprehensive.TOURNAMENT_RELEASE = COMPREHENSIVE_RELEASE
    comprehensive.main()
    scenario_path = root / f"football-research/reports/{COMPREHENSIVE_RELEASE}.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))

    r10_report_path = pathlib.Path(os.environ.get(
        "NFL_R10_REPORT_PATH",
        "/private/tmp/oddsphere-nfl-joint-production-20260823/football-research/reports/"
        "nfl_discrete_drive_joint_2026_08_23_r10.json",
    )).resolve()
    r10_report = json.loads(r10_report_path.read_text(encoding="utf-8"))
    if r10_report.get("tournamentRelease") != R10_RELEASE or not r10_report.get("qualified"):
        raise RuntimeError("qualified frozen r10 report is required")
    law = r10.DriveLaw(
        events=tuple(
            (int(row["offense"]), int(row["defense"]), float(row["probability"]))
            for row in r10_report["driveLaw"]["events"]
        ),
        count_pairs=tuple(
            (int(row["home"]), int(row["away"]), float(row["probability"]))
            for row in r10_report["driveLaw"]["countPairs"]
        ),
    )
    baseline_artifact_path = root / "lib/services/football/modelArtifacts/nflV1WeekOneOutcome.json"
    baseline_artifact = json.loads(baseline_artifact_path.read_text(encoding="utf-8"))
    baseline = {str(game["providerGameId"]): game for game in baseline_artifact["games"]}
    games: list[dict[str, Any]] = []
    for game in scenario["currentWeek1"]["games"]:
        game_id = str(game["gameId"])
        pmf = r10.joint_pmf(
            law,
            float(game["projectedHomeScore"]),
            float(game["projectedAwayScore"]),
            r10.ENVIRONMENT_SIGMA,
            r10.EVENT_CONCENTRATION,
        )
        summary = r10.summarize(
            pmf,
            home_line=-float(game["currentConsensusHomeMargin"]),
            total_line=float(game["currentConsensusTotal"]),
        )
        representative = r10.representative_score(
            pmf, summary, float(r10_report["selectedRepresentativeWeight"]),
        )
        prior = baseline[game_id]
        games.append({
            "providerGameId": game_id,
            "awayTeam": game["away"], "homeTeam": game["home"],
            **summary,
            "representativeScore": representative,
            "baselineExpectedAwayScore": prior["expectedAwayScore"],
            "baselineExpectedHomeScore": prior["expectedHomeScore"],
            "awayScoreMove": summary["expectedAwayScore"] - float(prior["expectedAwayScore"]),
            "homeScoreMove": summary["expectedHomeScore"] - float(prior["expectedHomeScore"]),
            "marginMove": (
                summary["expectedHomeScore"] - summary["expectedAwayScore"]
                - (float(prior["expectedHomeScore"]) - float(prior["expectedAwayScore"]))
            ),
        })

    team_scores = np.asarray([
        score for game in games for score in (game["expectedAwayScore"], game["expectedHomeScore"])
    ], dtype=float)
    margins = np.asarray([
        game["expectedHomeScore"] - game["expectedAwayScore"] for game in games
    ], dtype=float)
    totals = np.asarray([
        game["expectedHomeScore"] + game["expectedAwayScore"] for game in games
    ], dtype=float)
    over_directions = sum(game["total"]["overProbability"] > game["total"]["underProbability"] for game in games)
    gates = {
        "exactSlate": len(games) == 16 and len({game["providerGameId"] for game in games}) == 16,
        "exactQuarterbacks": len(substitutions) == 32,
        "finite": all(math.isfinite(float(value)) for value in np.concatenate([team_scores, margins, totals])),
        "teamScoreDispersion": float(np.std(team_scores)) >= 2.0,
        "marginDispersion": float(np.std(margins)) >= 3.0,
        "totalDispersion": float(np.std(totals)) >= 2.0,
        "bothTotalDirections": 0 < over_directions < len(games),
        "boundedTeamMoves": max(
            abs(float(game[key])) for game in games for key in ("awayScoreMove", "homeScoreMove")
        ) <= MAX_TEAM_SCORE_MOVE,
        "boundedMarginMoves": max(abs(float(game["marginMove"])) for game in games) <= MAX_MARGIN_MOVE,
        "representativeWinnerFidelity": all(game["representativeScore"]["winnerFidelity"] for game in games),
    }
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "shadowOnly": True,
        "productionAuthorized": False,
        "historicalModelChanged": False,
        "source": {
            "comprehensiveScript": str(source_script),
            "comprehensiveScriptSha256": sha256_file(source_script),
            "comprehensiveScenarioReportSha256": sha256_file(scenario_path),
            "r10ReportSha256": sha256_file(r10_report_path),
            "r6ArtifactSha256": sha256_file(r6_artifact_path),
            "forwardEvidenceSha256": sha256_file(evidence_path),
            "baselineArtifactSha256": sha256_file(baseline_artifact_path),
        },
        "projectedQuarterbacks": substitutions,
        "games": games,
        "dispersion": {
            "teamScoreSd": float(np.std(team_scores)),
            "teamScoreRange": [float(np.min(team_scores)), float(np.max(team_scores))],
            "marginSd": float(np.std(margins)),
            "marginRange": [float(np.min(margins)), float(np.max(margins))],
            "totalSd": float(np.std(totals)),
            "totalRange": [float(np.min(totals)), float(np.max(totals))],
            "overDirections": int(over_directions),
            "underDirections": int(len(games) - over_directions),
        },
        "movement": {
            "maximumTeamScoreMove": max(
                abs(float(game[key])) for game in games for key in ("awayScoreMove", "homeScoreMove")
            ),
            "maximumMarginMove": max(abs(float(game["marginMove"])) for game in games),
            "winnerFlips": sum(
                (game["homeWinProbability"] > game["awayWinProbability"])
                != (baseline[game["providerGameId"]]["homeWinProbability"] > baseline[game["providerGameId"]]["awayWinProbability"])
                for game in games
            ),
        },
        "gates": gates,
        "qualifiedForwardScenario": all(gates.values()),
        "productionBlocker": (
            "projected-QB scenario has no comparable historical as-of starter-designation holdout; "
            "collect beside r10 until confirmation and T-60 settlement evidence exist"
        ),
    }
    output = root / f"football-research/reports/{TOURNAMENT_RELEASE}.json"
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(output),
        "qualifiedForwardScenario": report["qualifiedForwardScenario"],
        "gates": gates,
        "dispersion": report["dispersion"],
        "movement": report["movement"],
    }, indent=2))


if __name__ == "__main__":
    main()
