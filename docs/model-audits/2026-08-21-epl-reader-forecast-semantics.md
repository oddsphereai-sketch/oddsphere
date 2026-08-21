# EPL reader forecast semantics — display-only treatment

## Decision

Keep every production prediction, probability, projection, side, grade, stake,
writer, lock, and tracking row unchanged. Treat the displayed expected goals as
a **market-informed goal outlook**: useful scoring context, but not the common
source of the released Match Result, Total, and BTTS forecasts.

This is a reader-contract change only. It produces zero promotions, zero
demotions, and zero net actionable-board change.

## Exact public semantics

- **Match Result:** the club-model three-way probabilities set the displayed
  result side and grade. The goal outlook can support the same winner while
  assigning a materially different probability.
- **Total:** the dedicated calibrated Over/Under probabilities set the side and
  grade. The goal-outlook mean, median, and mode remain scoring context.
- **BTTS:** the dedicated Yes/No probabilities set the side and grade. Per-team
  scoring chances computed from the goal outlook remain context.
- **Illustrative scenario:** the displayed integer score is a possible score
  consistent with the three selected directions. Its probability is measured
  inside the goal-outlook distribution. It is not the modal score and does not
  generate all three market probabilities.

Legacy soccer snapshots without reader-only goal-outlook marginals receive the
same separation label but no inferred comparison. Nothing is fabricated.

## Disagreement treatment

The reader always labels the views as separate. It adds an informational
`Forecast heads differ` notice when:

- the goal outlook and released forecast select different sides; or
- Match Result differs by at least 15 percentage points on any outcome; or
- Total/BTTS differs by at least 10 percentage points on the Yes/No or
  Over/Under probability.

For the audited Manchester United example, the reader reports approximately
`Goal outlook: MAN 62.9% · Match Result: MAN 46.1%`. On BTTS it reports the
directional split between goal-outlook Yes and released BTTS No.

This notice is not a data-health hold. Both values can be valid outputs from
separately calibrated heads, and the audit found no missing or corrupt input.
Automatically suppressing a market would be a model/grade behavior change and
has no chronological board-impact evidence. Any future hold must follow the
model-change protocol and report promotions, demotions, net actionable count,
and market mix.

## Runtime and cost

The authoritative EPL writer and shared soccer `prediction_pipeline` lease are
unchanged. The writer serializes seven reader-only marginals from an in-memory
score distribution it already computes. Member reads make no additional API or
database calls.

## Verification

- `npx tsx scripts/test-soccer-reader-semantics.ts`
- `npx tsx scripts/test-epl-shadow-model.ts`
- `npm run verify:model-change`
- `npx tsc --noEmit --pretty false`
- `npx next build --webpack`
- `node scripts/verify-integration-safety.mjs --base-ref=origin/main`
