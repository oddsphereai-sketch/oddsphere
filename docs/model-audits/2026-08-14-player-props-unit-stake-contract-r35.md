# MLB player props unit stake contract — r35

Date: 2026-08-14

## Decision

- Previous release: `mlb_props_2026_08_13_r34`
- Candidate release: `mlb_props_2026_08_14_r35`
- Standard actionable stake: 1.00u
- Home Run longshot stake: 0.25u
- Authoritative writer: unchanged `/api/cron/mlb-player-props-refresh`
  through `refreshMlbPropsBoard` and the shared `prediction_pipeline:mlb`
  lease

R35 corrects a unit-definition mismatch. The member-board writer had assigned
0.25u to ordinary Leans and Best Angles. The RBI value sleeve and Home Run
portfolio had separately assigned 0.10u. The owner-approved contract is a flat
1.00u risk for every non-Home Run actionable prop and a reduced 0.25u risk only
for the diversified Home Run longshot portfolio.

This is a stake-label and tracking correction. It does not change a selected
side, line, price, model probability, projection, model edge, expected value,
grade, promotion/demotion rule, or market eligibility gate.

## Paired board impact

The no-write August 14 candidate snapshot was publishable with no validation
errors:

- board rows: 5,631;
- Best Angles: 24;
- Leans: 122;
- total actionables: 146;
- standard actionables: 141, all exactly 1.00u;
- Home Run actionables: 5, all exactly 0.25u;
- standard stake mismatches: zero;
- Home Run stake mismatches: zero;
- stake-only promotions: zero;
- stake-only demotions: zero;
- net actionable-board change: zero.

A separate stored-board comparison observed normal provider, lineup, and price
churn while the full refresh was running. Those time-based grade changes are
not attributed to this correction. The valid same-snapshot comparison changes
only `units` according to market family.

## Historical evidence and reporting

R35 does not rewrite any immutable T-60 tracking row. Settled r34 rows continue
to preserve the stake value actually stamped at lock. When reporting the
owner's intended unit convention for an older slate, the report must explicitly
recompute flat 1.00u profit at the locked American price for non-Home Run rows
and 0.25u profit for Home Run rows. It must not present the old stored 0.25u and
0.10u fields as the approved staking policy.

Under the corrected convention, the August 13 Best Angle portfolio remains
7-1 and returns approximately +1.343u, or +16.8% ROI on 8.00u risk. This
normalization changes neither the record nor the underlying recommendations.

## Verification and rollback

- `npm run test:mlb-props-engine`: 382 passed, 0 failed.
- No-write live rebuild: publishable, zero validation errors.
- Release regression protection: unchanged.
- Snapshot, tracking, settlement, reader, and cron ownership: unchanged.
- Rollback release: `mlb_props_2026_08_13_r34`.

Rollback if the live board reports mixed releases, a non-Home Run actionable
with a stake other than 1.00u, a Home Run actionable with a stake other than
0.25u, any grade/side drift attributable to the stake patch, or a publication
or lock-coherence failure.
