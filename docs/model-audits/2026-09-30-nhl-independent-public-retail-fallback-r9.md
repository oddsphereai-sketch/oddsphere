# NHL independent public-retail split fallback (reader r9)

## Scope

After reader r8 removed a duplicated SharpAPI observation from Public Consensus,
the production September 30 feed proved that SharpAPI independently carried
complete BetMGM and DraftKings rows for all three NHL games. Playbook remained
unavailable. Reader r9 uses the distinct BetMGM retail row as the silent public
fallback while retaining Circa/DraftKings authority in Sharp Book Splits.

## Contract

- Playbook remains the primary Public Consensus source.
- When Playbook is absent and the public lane is empty, a complete BetMGM row
  may fill it only when the final Sharp Book section is owned by a different
  named book.
- Circa remains first in Sharp Book Splits, followed by DraftKings and the
  established continuity hierarchy.
- One book or observation can never populate both panels. If no distinct,
  complete retail row exists, Public Consensus remains unavailable.
- Existing member copy, labels, layout, scores, sides, probabilities, grades,
  actions, stakes, locks, tracking, provider calls, schedules, writers, and
  leases are unchanged.

The reader advances to
`nhl_daily_edge_reader_2026_09_30_r9_independent_public_retail_fallback`.
The current three-game / nine-market board retains every game and market.
Promotions/demotions: 0/0. Actionable-count change: 0.

## Verification

- `npx tsx --env-file=.env.local scripts/test-sharpapi-current-splits.ts`
- `npx tsx --env-file=.env.local scripts/test-nhl-regular-model.ts`
- `npx tsx --env-file=.env.local scripts/test-draftkings-network-splits.ts`
- `npx tsx --env-file=.env.local scripts/test-sharp-book-split-continuity.ts`
- `npx tsc --noEmit`
- `npm run verify:model-change`
- `node scripts/verify-integration-safety.mjs --base-ref=origin/main`

The focused overlay test uses different BetMGM and DraftKings percentages and
proves the public and Sharp panels remain distinct. A single-book fixture proves
that the Sharp fallback remains visible while Public Consensus stays empty.

## Rollback

Roll back reader r9 to r8 if the public fallback ever shares the final Sharp
Book source, overwrites Playbook, removes a Sharp fallback, changes any model or
grade output, or reduces board coverage. Preserve all immutable predictions,
locks, and tracking rows.
