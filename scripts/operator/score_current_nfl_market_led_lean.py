#!/usr/bin/env python3
"""Score the latest authoritative multi-book Week 1 evidence for r5.

This operator is deliberately read-only with respect to production. It combines
the frozen r2 football margin correction, the r5 market-led probability model,
and a leave-one-book-out market consensus before evaluating each exact target
price. The output is a local forward audit: it cannot publish, track, settle, or
overwrite a member snapshot.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import sys
from typing import Any

import joblib
import numpy as np
import pandas as pd
from scipy.special import logit

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tournament_nfl_opening_residual_v2 as r2  # noqa: E402
import tournament_nfl_market_led_baseline_v4 as r4  # noqa: E402
from build_nfl_pregame_features import (  # noqa: E402
    METRIC_PRIORS,
    QB_OFFSEASON_CARRY,
    TEAM_OFFSEASON_CARRY,
)
from score_current_nfl_daily_edge import (  # noqa: E402
    build_roles,
    current_player_value_by_team,
    normalize_schedule_name,
    normalize_team,
)
from tournament_nfl_market_led_lean_v5 import (  # noqa: E402
    CALIBRATION_RELEASE,
    DECISION_RELEASE,
    FIXED_POLICY,
    MODEL_RELEASE,
)


FORWARD_RELEASE = "nfl_market_led_week1_multibook_forward_shadow_2026_08_22_r5"
SOURCE_POINT_MODEL_RELEASE = "nfl_pregame_market_residual_shadow_2026_08_21_r2"
EXPECTED_EXPORT_RELEASE = "nfl_forward_evidence_latest_readonly_export_2026_08_22_r1"
EXPECTED_EVIDENCE_RELEASE = "nfl_forward_evidence_snapshot_2026_08_22_r2_multibook"
DIVISIONS = (
    frozenset(("BUF", "MIA", "NE", "NYJ")),
    frozenset(("BAL", "CIN", "CLE", "PIT")),
    frozenset(("HOU", "IND", "JAX", "TEN")),
    frozenset(("DEN", "KC", "LV", "LAC")),
    frozenset(("DAL", "NYG", "PHI", "WAS")),
    frozenset(("CHI", "DET", "GB", "MIN")),
    frozenset(("ATL", "CAR", "NO", "TB")),
    frozenset(("ARI", "LA", "SF", "SEA")),
)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_manifest_file(root: pathlib.Path, manifest: dict[str, Any], key: str) -> pathlib.Path:
    path = pathlib.Path(str(manifest[key]))
    if path.exists():
        return path
    candidate = root / "football-research/cache/nfl-model" / path.name
    if candidate.exists():
        return candidate
    raise RuntimeError(f"manifest file is unavailable: {key}={path}")


def regressed_metric(value: float, prior: float, carry: float) -> float:
    return prior + carry * (float(value) - prior)


def team_state_after_offseason(raw: dict[str, Any]) -> dict[str, Any]:
    buckets: dict[str, dict[str, float]] = {}
    for key in ("offFast", "offSlow", "defFast", "defSlow", "offAdjusted", "defAdjusted"):
        buckets[key] = {
            metric: regressed_metric(float(raw[key][metric]), prior, TEAM_OFFSEASON_CARRY)
            for metric, prior in METRIC_PRIORS.items()
        }
    return {
        **buckets,
        "elo": 1500.0 + TEAM_OFFSEASON_CARRY * (float(raw["elo"]) - 1500.0),
        "lastQbId": raw.get("lastQbId"),
    }


def quarterback_after_offseason(raw: dict[str, Any] | None) -> dict[str, float]:
    if raw is None:
        return {
            "epa": 0.0,
            "cpoe": 0.0,
            "sackRate": METRIC_PRIORS["sack_rate"],
            "turnoverRate": METRIC_PRIORS["turnover_rate"],
            "dropbacks": 0.0,
        }
    return {
        "epa": float(raw.get("epa", 0.0)) * QB_OFFSEASON_CARRY,
        "cpoe": float(raw.get("cpoe", 0.0)) * QB_OFFSEASON_CARRY,
        "sackRate": regressed_metric(
            float(raw.get("sackRate", METRIC_PRIORS["sack_rate"])),
            METRIC_PRIORS["sack_rate"],
            QB_OFFSEASON_CARRY,
        ),
        "turnoverRate": regressed_metric(
            float(raw.get("turnoverRate", METRIC_PRIORS["turnover_rate"])),
            METRIC_PRIORS["turnover_rate"],
            QB_OFFSEASON_CARRY,
        ),
        "dropbacks": float(raw.get("dropbacks", 0.0)) * QB_OFFSEASON_CARRY,
    }


def division_game(home: str, away: str) -> float:
    return float(any(home in division and away in division for division in DIVISIONS))


def paired_player_values(
    row: dict[str, Any],
    home_values: dict[str, float],
    away_values: dict[str, float],
) -> None:
    paired = (
        "unavailable_role", "offense_unavailable", "defense_unavailable",
        "qb_unavailable", "ol_unavailable", "skill_unavailable",
        "front_unavailable", "secondary_unavailable", "out_role",
        "doubtful_role", "questionable_role", "core_out_count",
        "offense_continuity", "defense_continuity",
        "healthy_offense_continuity", "healthy_defense_continuity",
    )
    for name in paired:
        row[f"pv_{name}_diff"] = float(home_values[name]) - float(away_values[name])
        row[f"pv_{name}_sum"] = float(home_values[name]) + float(away_values[name])


def make_feature_row(
    *,
    week: int,
    home: str,
    away: str,
    home_state: dict[str, Any],
    away_state: dict[str, Any],
    home_qb: dict[str, Any],
    away_qb: dict[str, Any],
    home_player_value: dict[str, float],
    away_player_value: dict[str, float],
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "week": week,
        "neutral_site": 0.0,
        "division_game": division_game(home, away),
        "home_rest": 7.0,
        "away_rest": 7.0,
        "rest_diff": 0.0,
        "elo_diff": float(home_state["elo"]) - float(away_state["elo"]),
        "home_qb_epa": home_qb["epa"],
        "away_qb_epa": away_qb["epa"],
        "home_qb_cpoe": home_qb["cpoe"],
        "away_qb_cpoe": away_qb["cpoe"],
        "home_qb_sack_rate": home_qb["sackRate"],
        "away_qb_sack_rate": away_qb["sackRate"],
        "home_qb_turnover_rate": home_qb["turnoverRate"],
        "away_qb_turnover_rate": away_qb["turnoverRate"],
        "home_qb_log_dropbacks": math.log1p(float(home_qb["dropbacks"])),
        "away_qb_log_dropbacks": math.log1p(float(away_qb["dropbacks"])),
        "home_qb_same_as_last_start": float(home_qb["id"] is not None and home_state["lastQbId"] == home_qb["id"]),
        "away_qb_same_as_last_start": float(away_qb["id"] is not None and away_state["lastQbId"] == away_qb["id"]),
        # The current provider evidence has no timestamped 2026 coach or full-roster
        # Jaccard source. Preserve missingness for the fitted imputer instead of
        # fabricating continuity.
        "home_coach_continuity": math.nan,
        "away_coach_continuity": math.nan,
        "home_roster_continuity": math.nan,
        "away_roster_continuity": math.nan,
    }
    for metric, prior in METRIC_PRIORS.items():
        row[f"home_matchup_fast_{metric}"] = home_state["offFast"][metric] - (away_state["defFast"][metric] - prior)
        row[f"away_matchup_fast_{metric}"] = away_state["offFast"][metric] - (home_state["defFast"][metric] - prior)
        row[f"home_matchup_slow_{metric}"] = home_state["offSlow"][metric] - (away_state["defSlow"][metric] - prior)
        row[f"away_matchup_slow_{metric}"] = away_state["offSlow"][metric] - (home_state["defSlow"][metric] - prior)
        row[f"home_off_adj_{metric}"] = home_state["offAdjusted"][metric]
        row[f"away_off_adj_{metric}"] = away_state["offAdjusted"][metric]
        row[f"home_def_adj_{metric}"] = home_state["defAdjusted"][metric]
        row[f"away_def_adj_{metric}"] = away_state["defAdjusted"][metric]
    paired_player_values(row, home_player_value, away_player_value)
    for metric, key in (
        ("epa", "epa"),
        ("cpoe", "cpoe"),
        ("experience", "logDropbacks"),
        ("sack_rate", "sackRate"),
        ("turnover_rate", "turnoverRate"),
        ("continuity", "continuity"),
    ):
        row[f"pv_qb_{metric}_diff"] = float(home_qb[key]) - float(away_qb[key])
        row[f"pv_qb_{metric}_sum"] = float(home_qb[key]) + float(away_qb[key])
    return row


def expected_quarterback(
    depth: dict[str, Any],
    qb_id_by_name: dict[str, str],
    qb_states: dict[str, Any],
) -> dict[str, Any]:
    starter = depth.get("expectedStartingQuarterback") or {}
    name = str(starter.get("name") or "")
    qb_id = qb_id_by_name.get(normalize_schedule_name(name))
    values = quarterback_after_offseason(qb_states.get(qb_id or ""))
    status = str(depth.get("starterStatus") or "unknown")
    return {
        "id": qb_id,
        "name": name or None,
        "matched": qb_id is not None,
        "status": status,
        "confirmed": status == "confirmed",
        "logDropbacks": math.log1p(values["dropbacks"]),
        "continuity": 0.0,
        **values,
    }


def no_vig(first: float, second: float) -> float:
    return float(r2.no_vig(np.asarray([first]), np.asarray([second]))[0])


def runtime_inputs(latest_rows: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rosters: dict[str, list[dict[str, Any]]] = {}
    availability: dict[str, Any] = {}
    games: list[dict[str, Any]] = []
    for stored in latest_rows:
        payload = stored["payload"]
        game = payload["game"]
        games.append(game)
        for side in ("away", "home"):
            depth = payload["startersAndDepth"][side]
            team = str(depth["team"])
            rosters[team] = [
                {
                    "position": player.get("position"),
                    "depth": player.get("depthRank"),
                    "player_name": player.get("name"),
                }
                for player in depth.get("roster", [])
            ]
        if payload.get("injuries") is not None:
            availability[str(game["providerGameId"])] = payload["injuries"]
    return {"rosters": rosters, "availability": availability}, games


def other_book_consensus(books: list[dict[str, Any]], target: dict[str, Any]) -> float:
    others = [
        book for book in books
        if str(book.get("sportsbook")) != str(target.get("sportsbook"))
    ]
    if len(others) < 2:
        raise RuntimeError(
            f"target {target.get('sportsbook')} has fewer than two other comparable books"
        )
    probabilities = [
        no_vig(
            float(book["moneyline"]["homePrice"]),
            float(book["moneyline"]["awayPrice"]),
        )
        for book in others
    ]
    return float(np.mean(probabilities))


def main(
    *,
    forward_release: str = FORWARD_RELEASE,
    model_release: str = MODEL_RELEASE,
    calibration_release: str = CALIBRATION_RELEASE,
    decision_release: str = DECISION_RELEASE,
    fixed_policy: r4.Policy = FIXED_POLICY,
    health_holds: list[str] | None = None,
    comparison_shadow_release: str | None = None,
    comparison_price_band: str | None = None,
) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=pathlib.Path, required=True)
    parser.add_argument("--evidence-json", type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = pathlib.Path.cwd()
    source_root = args.source_root.resolve()
    evidence_path = args.evidence_json.resolve()
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    if (
        evidence.get("exportRelease") != EXPECTED_EXPORT_RELEASE
        or evidence.get("evidenceRelease") != EXPECTED_EVIDENCE_RELEASE
        or evidence.get("readOnly") is not True
        or evidence.get("season") != 2026
        or evidence.get("week") != 1
    ):
        raise RuntimeError("authoritative r2 evidence export contract mismatch")
    latest_rows = evidence.get("latestRows", [])
    inputs, games = runtime_inputs(latest_rows)
    if len(games) != 16:
        raise RuntimeError("Week 1 requires exactly 16 latest authoritative evidence rows")
    game_ids = [str(game["providerGameId"]) for game in games]
    if len(set(game_ids)) != 16:
        raise RuntimeError("Week 1 evidence contains duplicate game identities")
    evidence_by_game = {
        str(row["payload"]["game"]["providerGameId"]): row
        for row in latest_rows
    }

    point_artifact_path = root / "football-research/cache/nfl-model" / f"{SOURCE_POINT_MODEL_RELEASE}.joblib"
    lean_artifact_path = root / "football-research/cache/nfl-model" / f"{model_release}.joblib"
    point_artifact = joblib.load(point_artifact_path)
    lean_artifact = joblib.load(lean_artifact_path)
    if point_artifact.get("modelRelease") != SOURCE_POINT_MODEL_RELEASE:
        raise RuntimeError("point model release mismatch")
    if lean_artifact.get("modelRelease") != model_release or lean_artifact.get("decisionRelease") != decision_release:
        raise RuntimeError("Lean model/decision release mismatch")
    if sha256_file(point_artifact_path) != lean_artifact.get("sourcePointModelSha256"):
        raise RuntimeError("Lean wrapper and point-model checksum mismatch")
    margin_head = point_artifact["margin"]

    state_manifest = json.loads((
        source_root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    ).read_text(encoding="utf-8"))
    state_path = resolve_manifest_file(source_root, state_manifest, "stateFile")
    if sha256_file(state_path) != state_manifest.get("stateFileSha256"):
        raise RuntimeError("state artifact checksum mismatch")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    team_states = {
        normalize_team(team): team_state_after_offseason(values)
        for team, values in state["teamStates"].items()
    }

    schedule_manifest = json.loads((
        source_root / "football-research/cache/nflverse/games.latest.json"
    ).read_text(encoding="utf-8"))
    schedule_path = source_root / "football-research/cache/nflverse" / schedule_manifest["filename"]
    if sha256_file(schedule_path) != schedule_manifest.get("sha256"):
        raise RuntimeError("schedule cache checksum mismatch")
    schedule = pd.read_csv(schedule_path, low_memory=False)
    qb_id_by_name: dict[str, str] = {}
    for historical in schedule[schedule["season"].between(2016, 2025)].itertuples(index=False):
        for side in ("home", "away"):
            name = getattr(historical, f"{side}_qb_name")
            qb_id = getattr(historical, f"{side}_qb_id")
            if not pd.isna(name) and not pd.isna(qb_id):
                qb_id_by_name[normalize_schedule_name(name)] = str(qb_id)

    roles, name_to_pfr, _, _ = build_roles(source_root)
    player_values = current_player_value_by_team(
        inputs,
        roles,
        name_to_pfr,
        2026,
        1,
    )

    game_rows: list[dict[str, Any]] = []
    for game in games:
        game_id = str(game["providerGameId"])
        stored = evidence_by_game[game_id]
        payload = stored["payload"]
        if payload.get("schemaRelease") != EXPECTED_EVIDENCE_RELEASE:
            raise RuntimeError(f"evidence release mismatch for {game_id}")
        home_display = str(game["home"]["abbreviation"])
        away_display = str(game["away"]["abbreviation"])
        home = normalize_team(home_display)
        away = normalize_team(away_display)
        if home not in team_states or away not in team_states:
            raise RuntimeError(f"team state unavailable for {away}@{home}")
        home_qb = expected_quarterback(
            payload["startersAndDepth"]["home"], qb_id_by_name, state["quarterbackStates"]
        )
        away_qb = expected_quarterback(
            payload["startersAndDepth"]["away"], qb_id_by_name, state["quarterbackStates"]
        )
        home_qb["continuity"] = float(home_qb["id"] is not None and team_states[home]["lastQbId"] == home_qb["id"])
        away_qb["continuity"] = float(away_qb["id"] is not None and team_states[away]["lastQbId"] == away_qb["id"])
        raw = make_feature_row(
            week=1,
            home=home,
            away=away,
            home_state=team_states[home],
            away_state=team_states[away],
            home_qb=home_qb,
            away_qb=away_qb,
            home_player_value=player_values[home],
            away_player_value=player_values[away],
        )
        engineered, _ = r2.engineer(pd.DataFrame([raw]))
        features = list(margin_head["featureNames"])
        raw_correction = float(margin_head["model"].predict(engineered[features])[0])
        correction = float(margin_head["candidate"]["weight"]) * float(np.clip(raw_correction, -r2.CORRECTION_CAP, r2.CORRECTION_CAP))

        opening = payload["market"]["operationalOpening"]["quote"]
        comparable_books = payload["market"].get("comparableCurrentBooks", [])
        if len(comparable_books) < 3:
            raise RuntimeError(f"at least three comparable books are required for {game_id}")
        opening_margin = -float(opening["spread"]["homeLine"])
        projected_margin = opening_margin + correction
        exact_offers: list[dict[str, Any]] = []
        for target in comparable_books:
            consensus_home_fair = other_book_consensus(comparable_books, target)
            target_home_fair = no_vig(
                float(target["moneyline"]["homePrice"]),
                float(target["moneyline"]["awayPrice"]),
            )
            probability_features = pd.DataFrame([{
                "market_logit": float(logit(np.clip(consensus_home_fair, 0.01, 0.99))),
                "margin_edge": projected_margin / 7.0,
                "signed_sqrt_margin": float(
                    np.sign(projected_margin) * np.sqrt(abs(projected_margin)) / math.sqrt(7.0)
                ),
            }])
            home_probability = float(lean_artifact["probabilityModel"].predict_proba(
                probability_features[list(lean_artifact["probabilityFeatures"])]
            )[0, 1])
            for side, probability, consensus_fair, target_fair, price in (
                (
                    "home", home_probability, consensus_home_fair, target_home_fair,
                    float(target["moneyline"]["homePrice"]),
                ),
                (
                    "away", 1.0 - home_probability, 1.0 - consensus_home_fair,
                    1.0 - target_home_fair, float(target["moneyline"]["awayPrice"]),
                ),
            ):
                expected_value = probability * r2.profit_one(price) - (1.0 - probability)
                exact_offers.append({
                    "side": side,
                    "team": home_display if side == "home" else away_display,
                    "sportsbook": target["sportsbook"],
                    "quoteObservedAt": target["observedAt"],
                    "otherBookCount": len(comparable_books) - 1,
                    "modelProbability": probability,
                    "otherBooksConsensusFairProbability": consensus_fair,
                    "targetBookFairProbability": target_fair,
                    "edgePp": 100.0 * (probability - consensus_fair),
                    "expectedValuePerUnit": expected_value,
                    "americanPrice": int(price),
                })
        selected = max(
            exact_offers,
            key=lambda value: (value["expectedValuePerUnit"], value["edgePp"]),
        )
        low_price, high_price = r4.PRICE_BANDS[fixed_policy.price_band]
        eligible = bool(
            low_price <= selected["americanPrice"] <= high_price
            and selected["expectedValuePerUnit"] >= fixed_policy.minimum_ev
            and selected["edgePp"] >= fixed_policy.minimum_edge_pp
        )
        game_rows.append({
            "providerGameId": game_id,
            "scheduledStart": game["scheduledStart"],
            "matchup": f"{away_display}@{home_display}",
            "opening": {
                "sportsbook": opening["sportsbook"],
                "observedAt": payload["market"]["operationalOpening"]["capturedAt"],
                "provenance": payload["market"]["operationalOpening"]["provenance"],
                "homeMargin": opening_margin,
            },
            "evaluatedQuote": {
                "sportsbook": selected["sportsbook"],
                "observedAt": selected["quoteObservedAt"],
                "americanPrice": selected["americanPrice"],
            },
            "footballProjection": {
                "openingHomeMargin": opening_margin,
                "correction": correction,
                "projectedHomeMargin": projected_margin,
            },
            "selectedMoneyline": selected,
            "policyEligible": eligible,
            "sourceEvidence": {
                "id": stored["id"],
                "payloadSha256": stored["payloadSha256"],
                "stage": payload["stage"],
                "capturedAt": payload["capturedAt"],
                "comparableBooks": len(comparable_books),
            },
            "expectedQuarterbacks": {
                "away": {key: away_qb[key] for key in ("name", "matched", "status", "confirmed")},
                "home": {key: home_qb[key] for key in ("name", "matched", "status", "confirmed")},
            },
            "healthHolds": sorted(set(payload["coverage"].get("healthHolds", [])) | {
                *([] if away_qb["confirmed"] else ["away_quarterback_projected_not_confirmed"]),
                *([] if home_qb["confirmed"] else ["home_quarterback_projected_not_confirmed"]),
            }),
        })

    for row in game_rows:
        candidate = bool(row["policyEligible"])
        row["decision"] = {
            "shadowCandidateGrade": "lean" if candidate else None,
            "shadowCandidate": candidate,
            "productionActionable": False,
            "decisionRelease": decision_release,
            "decisionTimestamp": row["evaluatedQuote"]["observedAt"],
            "reason": (
                "uncapped_market_led_exact_price_candidate"
                if candidate
                else "exact_price_does_not_clear_candidate_thresholds"
            ),
        }

    candidates = [row for row in game_rows if row["decision"]["shadowCandidate"]]
    comparison_candidates: list[dict[str, Any]] = []
    if comparison_price_band is not None:
        comparison_low, comparison_high = r4.PRICE_BANDS[comparison_price_band]
        comparison_candidates = [
            row for row in candidates
            if comparison_low <= row["selectedMoneyline"]["americanPrice"] <= comparison_high
        ]
    candidate_matchups = {row["matchup"] for row in candidates}
    comparison_matchups = {row["matchup"] for row in comparison_candidates}
    output = {
        "forwardRelease": forward_release,
        "modelRelease": model_release,
        "calibrationRelease": calibration_release,
        "decisionRelease": decision_release,
        "sourcePointModelRelease": SOURCE_POINT_MODEL_RELEASE,
        "season": 2026,
        "week": 1,
        "generatedFromEvidenceAt": max(row["sourceEvidence"]["capturedAt"] for row in game_rows),
        "sourceEvidenceExport": {
            "release": evidence["exportRelease"],
            "sha256": sha256_file(evidence_path),
            "storedRowsRead": evidence["storedRowsRead"],
        },
        "localOnly": True,
        "shadowOnly": True,
        "publicationEnabled": False,
        "trackingEnabled": False,
        "games": game_rows,
        "boardCounts": {
            "shadowLeanCandidates": len(candidates),
            "productionActionable": 0,
            "betGradeHeld": len(game_rows),
        },
        "boardImpact": {
            "relativeToProductionHeld": {
                "proposedShadowPromotions": len(candidates),
                "proposedShadowDemotions": 0,
                "appliedProductionPromotions": 0,
                "appliedProductionDemotions": 0,
            },
            "relativeToComparisonShadow": (
                None
                if comparison_price_band is None
                else {
                    "release": comparison_shadow_release,
                    "priceBand": comparison_price_band,
                    "promotions": len(candidate_matchups - comparison_matchups),
                    "demotions": len(comparison_matchups - candidate_matchups),
                    "promotedMatchups": sorted(candidate_matchups - comparison_matchups),
                    "demotedMatchups": sorted(comparison_matchups - candidate_matchups),
                }
            ),
        },
        "health": {
            "games": len(game_rows),
            "matchedExpectedQuarterbacks": sum(
                int(row["expectedQuarterbacks"][side]["matched"])
                for row in game_rows
                for side in ("away", "home")
            ),
            "projectedExpectedQuarterbacks": sum(
                int(row["expectedQuarterbacks"][side]["status"] == "projected")
                for row in game_rows
                for side in ("away", "home")
            ),
            "confirmedExpectedQuarterbacks": sum(
                int(row["expectedQuarterbacks"][side]["confirmed"])
                for row in game_rows
                for side in ("away", "home")
            ),
            "holds": health_holds or [
                "r5 uncapped policy fails 2025 season stability and CLV frequency",
                "quarterback confirmation is a health hold, not an ordinary No Play",
                "timestamped 2026 coach and full-roster continuity inputs are unavailable and imputed",
                "SharpAPI splits are unavailable and do not alter the grade",
                "historical price-band selection is not backed by a pristine untouched final holdout",
            ],
        },
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    output_path = report_root / f"{forward_release}.json"
    output_path.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "forwardRelease": forward_release,
        "games": len(game_rows),
        "boardCounts": output["boardCounts"],
        "boardImpact": output["boardImpact"],
        "matchedExpectedQuarterbacks": output["health"]["matchedExpectedQuarterbacks"],
        "shadowLeanCandidates": [
            {
                "matchup": row["matchup"],
                "team": row["selectedMoneyline"]["team"],
                "sportsbook": row["selectedMoneyline"]["sportsbook"],
                "price": row["selectedMoneyline"]["americanPrice"],
                "modelProbability": row["selectedMoneyline"]["modelProbability"],
                "otherBooksConsensusFairProbability": row["selectedMoneyline"]["otherBooksConsensusFairProbability"],
                "edgePp": row["selectedMoneyline"]["edgePp"],
                "expectedValuePerUnit": row["selectedMoneyline"]["expectedValuePerUnit"],
                "decisionTimestamp": row["decision"]["decisionTimestamp"],
            }
            for row in game_rows
            if row["decision"]["shadowCandidate"]
        ],
        "productionAuthorized": False,
        "output": str(output_path),
        "sha256": sha256_file(output_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
