# MLB Player Props current-observation release r23

Date: 2026-08-10
Status: private launch candidate passed data validation; not deployed

## Scope and cause

Ball Don’t Lie’s current player-props endpoint returns offers that remain
listed even when their prices have not changed recently. The adapter had been
using the provider’s `updated_at` price-change timestamp as the time at which
OddSphere observed the current response. The 45-minute freshness gate then
removed unchanged, still-current offers. On the August 10 slate this reduced
the member board from 3,834 rows to 1,849 and actionables from 83 to 4,
including every two-sided hitter offer.

r23 stamps a current response with its fetch observation time and preserves
the provider `updated_at` value in raw audit evidence. Opening responses still
use `opened_at` (falling back to `updated_at` only when necessary). No model
coefficient, projection formula, grade threshold, stake, market selection, or
writer path changed.

## Immutable ownership

- Candidate release: `mlb_props_2026_08_10_r23`
- Comparison snapshot: `mlb_props_2026_08_10_r21`
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard`
- Lease: existing MLB-scoped `prediction_pipeline` lease
- Public display/API/real-publish flags: remained closed
- Persistence during audit: disabled

## Current-slate contract result

The 2026-08-10 read-only full rebuild returned:

- 10 games and 3,993 member rows;
- 16 supported markets and 6 sportsbooks;
- 16,148 source rows, all mapped;
- 79 actionable rows;
- zero stale displayed odds;
- zero missing required research modules;
- complete player identity, recent form, starter, matchup, park, and game-time
  weather coverage;
- 56 bounded Ball Don’t Lie calls;
- a publishable candidate with no validation errors.

Projected lineup status remained the only non-critical warning. Posted
lineups continue to refresh the same authoritative board when available.

## Paired board impact

Against the latest valid r21 private snapshot:

- previous: 3,834 rows and 83 actionables;
- candidate: 3,993 rows and 79 actionables;
- exact matched rows: 3,789;
- added rows: 204;
- removed rows: 45;
- matched rows with a price change: 2,194;
- retained actionables: 69;
- actionable promotions: 10;
- actionable demotions: 14;
- net actionable delta: -4.

The candidate therefore restores coverage without concealing a flattened
board. Grade movement is attributable to the later current-price/research
snapshot evaluated by the unchanged actionability policies; the timestamp
fix itself restores offers to those policies rather than introducing a new
promotion or demotion rule.

## Required promotion gates

Before public activation:

1. Run `npm run verify:model-change` and focused Player Props tests.
2. Enable refresh, immutable tracking, and settlement only in the controlled
   prelaunch environment.
3. Produce three consecutive persisted, publishable r23 snapshots spanning at
   least 15 scheduled minutes.
4. Verify the live release id, provider budget, current-board freshness,
   tracking locks, settlement health, and member reader coherence.
5. Keep public props flags closed until the final owner approval and cutover.
