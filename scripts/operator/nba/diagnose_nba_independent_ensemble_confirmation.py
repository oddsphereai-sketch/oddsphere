#!/usr/bin/env python3
"""Post-confirmation diagnostics for the NBA independent ensemble shadow.

This operator is deliberately ineligible for model promotion. The 2025 outcome
set has already been opened; the report only explains the failed close-game
gate and records spread/Total behavior for prospective follow-up design.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.operator import tournament_nba_professional_model as tournament
from scripts.operator.nba import audit_nba_independent_ensemble_shadow as audit


RELEASE = "nba_independent_ensemble_shadow_2026_10_20_r1_post_confirmation_diagnostic"
MARGIN_WEIGHTS = (0.0, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40)
TOTAL_WEIGHT = 0.20


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def masked_outcome(
    predicted: np.ndarray,
    actual: np.ndarray,
    mask: np.ndarray,
) -> dict[str, Any]:
    selected = mask & np.isfinite(predicted) & np.isfinite(actual)
    decisive = selected & (np.abs(actual) > 1e-9) & (np.abs(predicted) > 1e-9)
    if not decisive.any():
        return {"games": 0, "accuracy": None, "mae": None}
    return {
        "games": int(decisive.sum()),
        "accuracy": float(((predicted[decisive] > 0) == (actual[decisive] > 0)).mean()),
        "mae": float(np.abs(predicted[decisive] - actual[decisive]).mean()),
    }


def market_diagnostics(
    frame,
    home: np.ndarray,
    away: np.ndarray,
) -> dict[str, Any]:
    predicted_margin = home - away
    predicted_total = home + away
    actual_margin = frame["target_home_margin"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    home_spread = frame["evaluation_opening_home_spread"].to_numpy(float)
    total_line = frame["evaluation_opening_total"].to_numpy(float)

    predicted_cover = predicted_margin + home_spread
    actual_cover = actual_margin + home_spread
    predicted_over = predicted_total - total_line
    actual_over = actual_total - total_line
    spread_available = np.isfinite(home_spread)
    total_available = np.isfinite(total_line)

    favorite_home = home_spread < 0
    favorite_away = home_spread > 0
    model_calls_home = predicted_margin > 0
    model_calls_away = predicted_margin < 0
    model_calls_underdog = spread_available & (
        (favorite_home & model_calls_away) | (favorite_away & model_calls_home)
    )
    actual_underdog_wins = spread_available & (
        (favorite_home & (actual_margin < 0)) | (favorite_away & (actual_margin > 0))
    )
    correct_underdog_calls = model_calls_underdog & actual_underdog_wins

    return {
        "againstOpeningSpread": masked_outcome(
            predicted_cover, actual_cover, spread_available
        ),
        "openingTotalDirection": masked_outcome(
            predicted_over, actual_over, total_available
        ),
        "modelOutrightUnderdogCalls": int(model_calls_underdog.sum()),
        "correctOutrightUnderdogCalls": int(correct_underdog_calls.sum()),
        "outrightUnderdogCallAccuracy": (
            float(correct_underdog_calls.sum() / model_calls_underdog.sum())
            if model_calls_underdog.any()
            else None
        ),
        "actualOutrightUnderdogWins": int(actual_underdog_wins.sum()),
        "outrightUnderdogRecall": (
            float(correct_underdog_calls.sum() / actual_underdog_wins.sum())
            if actual_underdog_wins.any()
            else None
        ),
    }


def fixed_close_diagnostics(
    frame,
    reference_home: np.ndarray,
    reference_away: np.ndarray,
    candidate_home: np.ndarray,
    candidate_away: np.ndarray,
) -> dict[str, Any]:
    actual_margin = frame["target_home_margin"].to_numpy(float)
    reference_margin = reference_home - reference_away
    candidate_margin = candidate_home - candidate_away
    reference_close = np.abs(reference_margin) < 3.0
    candidate_close = np.abs(candidate_margin) < 3.0
    common_close = reference_close & candidate_close
    changed_membership = reference_close ^ candidate_close
    return {
        "referenceCloseSameGames": masked_outcome(
            candidate_margin, actual_margin, reference_close
        ),
        "referenceOnReferenceCloseSameGames": masked_outcome(
            reference_margin, actual_margin, reference_close
        ),
        "commonCloseCandidate": masked_outcome(
            candidate_margin, actual_margin, common_close
        ),
        "commonCloseReference": masked_outcome(
            reference_margin, actual_margin, common_close
        ),
        "candidateCloseGames": int(candidate_close.sum()),
        "referenceCloseGames": int(reference_close.sum()),
        "commonCloseGames": int(common_close.sum()),
        "changedMembershipGames": int(changed_membership.sum()),
        "winnerFlips": int(((candidate_margin > 0) != (reference_margin > 0)).sum()),
    }


def main() -> None:
    parsed = parse_args()
    frame = tournament.validate(tournament.read_jsonl(parsed.features))
    groups = tournament.feature_catalog(frame)
    train = frame[frame["season"] < 2025].copy()
    confirmation = frame[frame["season"] == 2025].copy()
    components = audit.predict_components(train, confirmation, groups["ratings_schedule"])
    reference_home, reference_away = components[0], components[1]
    origin_components = {}
    for season in audit.ROLLING_SEASONS:
        origin_train = frame[frame["season"] < season].copy()
        origin_evaluate = frame[frame["season"] == season].copy()
        origin_components[season] = (
            origin_evaluate,
            audit.predict_components(
                origin_train,
                origin_evaluate,
                groups["ratings_schedule"],
            ),
        )

    rows = []
    for margin_weight in MARGIN_WEIGHTS:
        home, away = audit.combine(
            *components,
            margin_weight,
            TOTAL_WEIGHT,
        )
        origins = []
        for season, (origin_evaluate, origin_parts) in origin_components.items():
            origin_home, origin_away = audit.combine(
                *origin_parts,
                margin_weight,
                TOTAL_WEIGHT,
            )
            origins.append({
                "season": season,
                "metrics": audit.metrics(origin_evaluate, origin_home, origin_away),
                "fixedClose": fixed_close_diagnostics(
                    origin_evaluate,
                    origin_parts[0],
                    origin_parts[1],
                    origin_home,
                    origin_away,
                ),
                "market": market_diagnostics(
                    origin_evaluate,
                    origin_home,
                    origin_away,
                ),
            })
        rows.append({
            "marginRatingWeight": margin_weight,
            "totalRatingWeight": TOTAL_WEIGHT,
            "rollingOrigins": origins,
            "metrics": audit.metrics(confirmation, home, away),
            "fixedClose": fixed_close_diagnostics(
                confirmation,
                reference_home,
                reference_away,
                home,
                away,
            ),
            "market": market_diagnostics(confirmation, home, away),
        })

    report = {
        "release": RELEASE,
        "status": "post_confirmation_diagnostic_only_not_promotion_eligible",
        "warning": (
            "The 2025 outcomes were already opened by the frozen r1 audit. "
            "These rows are descriptive and cannot select a production recipe."
        ),
        "season": 2025,
        "rows": rows,
        "productionAuthority": False,
    }
    parsed.output.parent.mkdir(parents=True, exist_ok=True)
    parsed.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
