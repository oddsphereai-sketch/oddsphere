# MLB same-book evaluated movement r66

Date: 2026-08-22

Status: candidate passed the paired dry run; full verification, deployment, and
natural-cycle live proof remain pending.

## Scope and ownership

- Sport/market: MLB Moneyline grading and shared MLB line-movement snapshots.
- Authoritative writer: `lib/services/predictionRecordService.ts` under the
  existing `prediction_pipeline:mlb` lease.
- No new writer, cron, provider call, probability head, side-selection rule,
  threshold, stake rule, or lock path is introduced.
- Locked prediction records remain immutable.

## Incident diagnosis

TB at BAL changed from Best Angle to No Play on August 22 even though the
evaluated Bally Bet quote moved toward Tampa. The writer compared a BetMGM
opening quote of TB -135 with a Bally Bet current quote of TB -132 and labeled
the artificial cross-book difference `against_pick`. Bally Bet's genuine
same-book trail was -125 to -132, which was `toward_pick`.

The defect was general: opener and current rows were independently selected by
book priority/freshness, while r65 evaluated a separately selected fresh,
coherent best-playable exact quote. A sportsbook source change could therefore
create a false movement direction and alter a price-sensitive grade.

## r66 contract

- Select the current quote first, then require the opener from that same book.
- For an r65-style best-playable Moneyline evaluation, recompute movement using
  the evaluated sportsbook before resolving the final grade.
- If the evaluated book has no valid opener, movement is `unknown`; never
  compare unrelated books.
- Preserve the evaluated book, price, and observation time in the existing
  exact-price tuple and stamp the movement sportsbook in the movement snapshot.

## Immutable versions

- Calibration: `mlb_public_calibration_v26_same_book_evaluated_movement_2026_08_22`
- Decision: `mlb_daily_edge_decision_2026_08_22_r66`
- Rule bundle: `mlb_daily_edge_rule_bundle_v54_2026_08_22`
- Grade: `mlb_public_grade_policy_v44_same_book_evaluated_movement_2026_08_22`
- Correction: `mlb_prediction_corrections_v18_same_book_evaluated_movement_2026_08_22`

## Paired board and validation

The exact same-input August 22 dry runs each scanned 15 games, proposed 43
records, and held two markets. The actionable board moved from nine actions to
ten: one promotion, zero actionable demotions, net +1. The only actionable
change was TB at BAL Moneyline from No Play to Best Angle at the same 54.2%
outcome probability and Bally Bet -132 evaluated price. Its movement changed
from the invalid cross-book BetMGM -135 / Bally Bet -132 comparison to the
coherent Bally Bet -125 / -132 trail (`toward_pick`, +1.34 implied-probability
points). Every Total and First Inning grade was unchanged.

DET at KC Moneyline changed only within the nonactionable layer from
`market_aligned` to No Play. Its evaluated Saba trail was genuinely same-book
-118 to -112 (`against_pick`, -1.30 implied-probability points), so r66 removes
cross-book support rather than manufacturing an action. This is not an
actionable demotion and does not flatten the betting board.

Pre-publication validation:

- `scripts/test-prediction-record-service.ts`: 350/350 passed, including the
  exact Tampa cross-book fixture.
- `scripts/test-mlb-pipeline-safety.ts`: 62/62 passed.
- `npm run verify:model-change`: passed the full cross-sport gate.
- `npx tsc --noEmit --pretty false`: passed.
- `git diff --check`: passed.
- Exact r65 and r66 dry runs: passed with no writes.

Remaining before declaring production success: clean commit, integration
safety on current main, deployment, and natural-cycle proof that every unlocked
MLB row carries r66 while locked rows preserve their historical release.
