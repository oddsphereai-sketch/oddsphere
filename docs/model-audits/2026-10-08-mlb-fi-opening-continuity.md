# MLB first-inning opening continuity — 2026-10-08

## Scope

Repair the member-reader path that resolves the evaluated first-inning sportsbook from the stored
FI market reason. Do not change model inputs, market arbitration, prediction probabilities, sides,
grades, stakes, locks, tracking, providers, schedules, member copy, labels, or layout.

## Root cause

The FI model emits the reason format
`fi_target_excluded_consensus_<n>_movement_<n>_evaluation_<sportsbook>`. The reader still recognized
only the legacy `fi_market_ok_<sportsbook>` format. It therefore had the correct two-sided current
quote and existing same-book history, but could not reliably bind the Opening/Prior fields to the
evaluated sportsbook.

This was not a provider-ingestion or model-arbitration failure. The authoritative FI baseline
already constructs complete named-book opening pairs, intersects them with current target-excluded
pairs by sportsbook, applies the released bounded same-book movement residual, and persists that
evidence in the FI audit payload before the member route runs.

## Repair

- Preserve legacy parsing.
- Parse the current target-excluded evaluation suffix exactly.
- Continue requiring the same sportsbook and the 0.5-run FI line for Opening/Prior.
- Never borrow another book's opening to fill a gap.
- Make the read-only odds-trail audit use the same production parser.

Shared member presentation release:
`daily_edge_member_presentation_2026_10_08_r24_mlb_fi_opening_continuity`.

## Model and board impact

Predictions, post-market probabilities, expected runs, sides, current exact prices, grades,
actionability, locks, and tracking are unchanged. Promotions / demotions / changed decisions are
0 / 0 / 0. The only response change is restoring authentic same-book FI Opening/Prior values that
were already persisted.

## Acceptance and rollback

Acceptance requires unit coverage for both reason formats, malformed-reason rejection, FI model
movement tests, TypeScript validation, and a read-only live odds-trail audit proving every displayed
FI current/opening/prior price exists in the persisted current or history tables under one book.

Rollback the parser, audit parser, and shared presentation release identifier together. No database
row or locked record requires reversal.
