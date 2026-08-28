# MLB persisted split clear r72

Date: 2026-08-28
Candidate: `mlb_daily_edge_decision_2026_08_28_r72_persisted_split_clear`
Base: production `5aac14b2c65e` (MLB r71)

## Finding

The first normal post-r71 cycle completed at 2026-08-28T16:01:15Z. New
canonical SharpAPI rows correctly withheld unsupported endpoint values, and
recent source-aware endpoint history fell from 85 rows to 22. The
provider-separated mirror still contained 16 older endpoint rows, however,
because its mapper skipped a matched observation when both scrubbed fields
were null instead of letting the upsert clear the old values.

The r71 reader and decision boundaries already reject those stored values, so
the defect did not reappear in the signed-in member product. It remained an
ingestion/LKG hygiene defect and was not accepted as complete.

## Repair

r72 persists an exact matched MLB provider/game/market/side mirror row even
when both verified percentage fields are null. The existing upsert then clears
older unsupported endpoint values. Non-MLB sports keep the prior sparse-row
behavior and still skip a completely empty observation.

No provider call, timer, writer, schema, sportsbook selector, projection,
probability, side, price, grade threshold, lock, tracking row, settlement, or
stake changes. No replacement percentage is synthesized. The shared member
presentation remains r9 because r71's read-side behavior is unchanged.

## Frozen board impact

The current SELECT-only 45-market replay compared r72 with the already-active
r71 evidence rule using identical inputs:

| Grade | r71 current | r72 |
| --- | ---: | ---: |
| Best Angle | 2 | 2 |
| Lean | 16 | 16 |
| Watchlist | 11 | 11 |
| No Play | 16 | 16 |

- Promotions: 0
- Demotions: 0
- Side, probability, fair probability, EV, quote, and grade changes: 0
- Provider calls: 0
- Writes: 0

These counts differ from the earlier frozen r70-to-r71 comparison only because
the live market inputs continued to move; r72 itself is byte-stable against
r71 on the identical current inputs.

## Releases

- Decision: `mlb_daily_edge_decision_2026_08_28_r72_persisted_split_clear`
- Rule bundle: `mlb_daily_edge_rule_bundle_v60_persisted_split_clear_2026_08_28`
- Grade policy: `mlb_public_grade_policy_v50_persisted_split_clear_2026_08_28`
- Correction policy: unchanged
  `mlb_prediction_corrections_v22_coherent_near_edge_watchlist_2026_08_26`
- Shared member presentation: unchanged
  `daily_edge_member_presentation_2026_08_28_r9_verified_mlb_split_evidence`

## Validation

Passed before publication:

- pure split-quality and persisted-mirror selection tests;
- MLB pipeline/version/lease/T-60 tests;
- SELECT-only current 45-market r71/r72 parity replay;
- full `npm run verify:model-change`;
- `npx tsc --noEmit`;
- `npm run build -- --webpack`;
- `git diff --check`;
- `node scripts/verify-integration-safety.mjs --base-ref=origin/main`, proving
  the committed candidate contains current production `5aac14b2c65e` with no
  overlapping uncommitted worktree changes.

Still required:

- protected PR checks;
- a normal post-deploy split cycle proving zero current endpoint mirror rows;
- signed-in production QA confirming valid splits remain and endpoint rows do
  not render.

## Rollback

Rollback is r71/v59/v49. The r71 read-side endpoint guard must remain active
even if the persisted cleanup is rolled back.
