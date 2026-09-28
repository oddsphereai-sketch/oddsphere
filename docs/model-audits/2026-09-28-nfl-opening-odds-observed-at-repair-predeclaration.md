# NFL Opening Odds `opened_at` Repair Predeclaration

## Defect and scope

BALLDONTLIE's NFL `/odds/opening` response timestamps rows with `opened_at`. The current NFL
normalizer requires `updated_at`, so valid provider opening rows are discarded before operational
opening and same-book market-reading logic. A bounded production probe confirmed the provider row
contains `opened_at` and no `updated_at`.

This repair affects the NFL regular-slate adapter, operational-opening input, same-book movement,
weekly outcome/score distribution, Spread/Total direction, target-excluded decisions, collector,
sole writer, member fixture/snapshot, and forward tracking release family. Player Props and every
other sport are out of scope. Member copy, labels, layout, stakes, cron cadence, and lease topology
must not change.

## Frozen repair

- Current odds continue to require their provider `updated_at` timestamp.
- Opening odds may use `opened_at` only when `updated_at` is absent.
- The timestamp is never synthesized from request time or from a current quote.
- Opening/current evidence must retain exact provider game and sportsbook identity.
- Missing or malformed opening rows remain unavailable.
- Existing T-60 rows and tracking records remain immutable. The repair applies only to new
  unlocked/future evidence through the sole `runNflForwardEvidenceWriter` path under
  `prediction_pipeline:nfl`.

## Release and evaluation gates

The adapter and every active output release whose values can change must advance together before
publication. Before promotion, a no-write current-board replay must report provider opening
coverage, score/probability/side changes, promotions, demotions, market mix, actionable count, and
coherence. A behavior-changing release is rejected on an unexpected board collapse, missing current
prices, cross-market contradiction, locked-row rewrite, additional writer/schedule, or load increase
beyond the existing bounded opening request.

Focused NFL tests, TypeScript, lint, `npm run verify:model-change`, build, integration safety,
protected-PR checks, merge, and live release/lease/coverage/site proof remain mandatory. The prior
pressure-direction release family is the rollback target.

