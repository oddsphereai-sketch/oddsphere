# MLB corroborated Total opposition r90 — predeclaration

Date: 2026-10-05

## Scope

This release is limited to future unlocked MLB full-game Totals. Moneylines,
first inning, player props, other sports, provider cadence, writer ownership,
the `prediction_pipeline:mlb` lease, member copy, labels, and layout are out of
scope. Existing locks remain immutable.

## Failure mode

The r88/r89 regime-calibrated Total head explicitly bypasses the older Total
side-correction candidates. That is normally correct, but it also prevents a
correction when four pre-result facts jointly identify a narrow failure mode:

1. the independent selected-side probability is no greater than 57.5%;
2. the target-excluded two-sided no-vig price favors the opposite side;
3. a continuous same-sportsbook opening/current price trail moves against the
   selected side by the existing materiality threshold; and
4. either the existing opposing public money-versus-ticket divergence or the
   MLB-owned internal sharp-resistance signal independently corroborates the
   opposition.

Missing evidence is neutral. No cross-book trail may be constructed. A real
opposite-side quote and a coherent score-reconstruction input are mandatory.

## Candidate fixed before publication

For a qualifying row, select the priced opposite Total side. The correction
layer reports a conservative 55%-to-original-strength probability, never above
60%, while preserving the raw opposite independent probability for audit. If
the existing projected Total already supports the corrected side, retain it.
Otherwise reflect the Total across the exact listed line and preserve the
independent home-away scoring margin when rebuilding one-decimal team scores.
The resulting score, Total prediction, exact price, probability, edge, and
grade must tell one coherent story.

The corrected side remains subject to the ordinary exact-price and grade gates.
It cannot become a Best Angle through this rule. It may remain or qualify as a
Lean only when the normal economics and projection-alignment gates pass. There
is no quota or forced promotion.

## Evidence boundary

The 2026 archive used here is opened retrospective evidence. It is not described
as an untouched holdout. The owner explicitly directed an immediate,
sport-specific market-reading repair after repeated observed failures, so this
is an owner-approved provisional release. Evaluation is split chronologically
into train through July 31, August validation, September 1–18 confirmation, and
the already-open September 19 onward forward-release segment. Publication is
permitted only if the same fixed rule improves direction and Total MAE in every
segment and the current-slate replay remains complete and non-flat.

## Release identifiers

- calibration: `mlb_public_calibration_v36_corroborated_total_opposition_2026_10_05`
- decision: `mlb_daily_edge_decision_2026_10_05_r90_corroborated_total_opposition`
- rule bundle: `mlb_daily_edge_rule_bundle_v75_corroborated_total_opposition_2026_10_05`
- correction rule: `mlb_total_corroborated_opposition_v1_2026_10_05`
- projection core: `mlb_projection_core_v2_6_corroborated_total_opposition_preserve_margin_2026_10_05`

## Rollback

Restore r89/v74/v35 and projection core v2.5 for future unlocked rows. Never
rewrite an r90 lock or its tracking outcome.
