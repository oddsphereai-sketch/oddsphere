#!/usr/bin/env python3
"""Score the frozen r6 policy on the latest authoritative Week 1 evidence."""

from __future__ import annotations

import score_current_nfl_market_led_lean as shared_scorer
from tournament_nfl_market_led_best_available_v6 import (
    CALIBRATION_RELEASE,
    DECISION_RELEASE,
    EXPECTED_POLICY,
    MODEL_RELEASE,
)


FORWARD_RELEASE = "nfl_market_led_week1_multibook_forward_shadow_2026_08_22_r6"


if __name__ == "__main__":
    shared_scorer.main(
        forward_release=FORWARD_RELEASE,
        model_release=MODEL_RELEASE,
        calibration_release=CALIBRATION_RELEASE,
        decision_release=DECISION_RELEASE,
        fixed_policy=EXPECTED_POLICY,
        health_holds=[
            "r6 is historically Lean-eligible but is not integrated into the authoritative writer",
            "quarterback confirmation is a health hold, not an ordinary No Play",
            "timestamped 2026 coach and full-roster continuity inputs are unavailable and imputed",
            "SharpAPI splits are unavailable and do not alter the grade",
            "the pooled historical bootstrap interval crosses zero; Best Angle is unavailable",
        ],
        comparison_shadow_release="nfl_market_led_moneyline_lean_shadow_2026_08_22_r5",
        comparison_price_band="competitive",
    )
