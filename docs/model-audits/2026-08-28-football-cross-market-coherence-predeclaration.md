# Football cross-market coherence r19 predeclaration

Date: 2026-08-28

Status: predeclared before implementation or replay

## Problem

NFL and CFB publish an outcome forecast and three separately priced betting markets. A
different Bet grade can be correct when exact prices have different break-even probabilities,
but the probability layer must still obey the containment relationship between winning and
covering a spread. For a home underdog, `P(home covers +x) >= P(home wins)`; for a home
favorite, `P(home covers -x) <= P(home wins)`. Pick'em cover and win probabilities must agree
within the declared numerical tolerance. Score mean, representative final, winner, exact quote,
EV, side, and grade also need one machine-checked publication boundary.

The SELECT-only 2026 Week 1 replay found 14/16 NFL games already satisfy event containment.
MIA-LV and DEN-KC do not: their separately calibrated Spread heads assign the home favorite a
higher cover probability than the Moneyline head assigns it a win probability. The current CFB
8-game wave satisfies containment, including Hawaii-Stanford; its Moneyline Lean versus +4 No
Play is explained by +152 versus -110 exact-price economics, not by a nesting violation.

## Predeclared change

1. Add shared release `football_cross_market_coherence_2026_08_28_r1_event_containment`.
2. Project the NFL calibrated home-cover probability onto the smallest mathematically valid
   interval implied by the published Moneyline probability and exact home spread. This is a
   deterministic event-containment correction with no fitted threshold and no slate quota.
3. After that correction, reselect the Spread side and recompute exact-price EV, edge, cushion,
   and grade from the existing frozen thresholds. Moneyline and Total math is unchanged.
4. Run a writer-owned assertion for every NFL and CFB payload before the sole append. It fails
   closed on score/winner disagreement, duplicate or malformed markets, side/line sign errors,
   EV mismatch, nonpositive-EV actionable grades, or ML/Spread event-containment violations.
5. A Moneyline/Spread grade difference remains allowed only as an explicit price/threshold
   divergence. The gate never promotes one market merely to imitate a sibling grade.
6. Preserve market-scoped availability, one sport-scoped lease/writer, T-60, tracking,
   settlement, and the shared MLB Daily Edge reader.

## Release plan

- NFL model/calibration/decision/policy/member:
  `nfl_v1_daily_edge_model_2026_08_28_r4_event_containment` /
  `nfl_v1_daily_edge_calibration_2026_08_28_r4_event_containment` /
  `nfl_v1_daily_edge_decision_2026_08_28_r10_event_containment` /
  `nfl_v1_grade_policy_2026_08_28_r10_event_containment` /
  `nfl_v1_member_release_2026_08_28_r7_event_containment`.
- NFL writer: `nfl_forward_evidence_writer_2026_08_28_r11_cross_market_coherence`.
- CFB writer: `cfb_forward_evidence_writer_2026_08_28_r10_cross_market_coherence`.
- CFB outcome and exact-price model/grade releases remain unchanged unless replay proves the
  shared assertion requires a model correction.

## Acceptance gates

- Full 16-game/48-market NFL replay and 8-game/24-market CFB replay.
- Exact before/after grade counts, promotions, demotions, side changes, and probability changes.
- All 24 games pass score/winner identity and ML/Spread event containment.
- Every actionable grade has positive exact-price EV; every differing ML/Spread grade has a
  deterministic `price_or_threshold_divergence` explanation.
- Existing historical qualification evidence remains the predictive-quality authority; this
  mathematical correction cannot be presented as new ROI evidence.
- Focused NFL/CFB tests, shared Daily Edge tests, TypeScript, scoped lint,
  `npm run verify:model-change`, webpack build, latest-main integration safety, protected PR,
  natural-cycle read-only confirmation, and signed-in desktop/mobile QA.

## Rollback

Rollback restores NFL r3/r9/r6 decisions and both prior writers. Immutable rows remain release
scoped. No historical or T-60 records are rewritten.
