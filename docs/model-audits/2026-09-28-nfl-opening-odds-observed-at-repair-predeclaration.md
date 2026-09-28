# NFL Opening Odds `opened_at` Repair Predeclaration

## Defect and scope

BALLDONTLIE's NFL `/odds/opening` response timestamps rows with `opened_at`. The current NFL
normalizer requires `updated_at`, so valid provider opening rows are discarded before operational
opening and same-book market-reading logic. A bounded production probe confirmed the provider row
contains `opened_at` and no `updated_at`.

This repair affects the NFL regular-slate adapter and target-ineligible forward context only. The
first release does not replace the established operational opening or alter weekly outcomes,
scores, sides, exact-price decisions, grades, stakes, member fixture/snapshot, tracking, Player
Props, or any other sport. Member copy, labels, layout, cron cadence, and lease topology do not
change.

## Frozen repair

- Current odds continue to require their provider `updated_at` timestamp.
- Opening odds may use `opened_at` only when `updated_at` is absent.
- The timestamp is never synthesized from request time or from a current quote.
- Opening/current evidence must retain exact provider game and sportsbook identity.
- Missing or malformed opening rows remain unavailable.
- Existing T-60 rows and tracking records remain immutable. Repaired provider openers enter only
  the existing target-ineligible contextual capture through the sole
  `runNflForwardEvidenceWriter` path under `prediction_pipeline:nfl`. The active operational
  opening continues using its existing first-observed behavior until a separate forward gate
  explicitly promotes the provider-opening signal.

## Release and evaluation gates

The adapter, context capture, collector, and writer releases advance together. A no-write
current-board replay must report provider-opening coverage and prove zero score, probability, side,
grade, promotion, demotion, or actionable-count changes. Any later active promotion requires a new
model release and release-pure forward evidence. The capture release is rejected on missing current
prices, cross-market contradiction, locked-row rewrite, additional writer/schedule, or load
increase beyond the existing bounded opening request.

Focused NFL tests, TypeScript, lint, `npm run verify:model-change`, build, integration safety,
protected-PR checks, merge, and live release/lease/coverage/site proof remain mandatory. The prior
pressure-direction release family is the rollback target.
