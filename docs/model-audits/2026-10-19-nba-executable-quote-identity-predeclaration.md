# NBA executable quote and event identity — predeclaration

Date: 2026-10-19
Status: candidate verified; production verification pending
Base: `819ccedebd00194852610bf77c356b88d4f40f7d`

## Scope

- Sport and markets: NBA Moneyline, Spread, and Total market-input identity; the direct line-selection
  correction affects Spread and Total.
- Model family: candidate `nba_professional_unified_2026_10_19_r7_executable_quote_identity`.
- Market marriage: candidate `nba_market_marriage_2026_10_19_r7_executable_quote_identity`.
- Grade policy: `nba_grade_policy_2026_10_16_r5_market_specific_accuracy` remains mathematically
  unchanged, but grades may recover when a real exact-price tuple replaces a synthetic or missing one.
- Internal reader: `nba_professional_market_reader_2026_10_16_r5_canonical_split_identity`; reader
  qualification rules and correction thresholds remain unchanged.
- Writer and cron: the existing NBA prediction writer and `nba_daily_refresh` route remain the sole
  paths under `prediction_pipeline:nba`. No new timer, request loop, or database writer is authorized.
- Locks: stored locked member payloads remain byte-for-byte authoritative and are never reconstructed.

## Production findings before editing

At 2026-10-19T22:39:49Z, the read-only October 20-21 audit found 14 games and zero games with a
complete multi-observation same-book sequence across all markets. Current quotes themselves were
broadly available: Boston-Detroit carried complete Spread pairs at 19 books, and the scheduled
provider dry run at 22:42Z returned 6,239 raw odds rows and 935 canonical rows for 10 of 11 October 21
games.

Three distinct failures were reproduced:

1. Boston-Detroit displayed `DET +1.25`, and Utah-Memphis displayed `UTAH +1.25`. The consensus used
   the arithmetic median of an even number of sportsbook handicaps. No sportsbook offered `1.25`, so
   the exact-line price selector correctly returned no price and the market was forced to No Play.
2. Phoenix-Portland had no stored current rows in the published snapshot, although the live bounded
   provider dry run now returned a complete event and canonical prices. The last successful published
   snapshot predated that provider availability.
3. Sacramento-LA Clippers was the one October 21 event rejected before odds retrieval. The provider
   supplied `Los Angeles Clippers`; the database stored `LA Clippers`. The refresh used substring
   matching instead of the repository's existing exact NBA alias registry.

The production cron itself was healthy: its five most recent rows were successful, including
2026-10-19T22:12:33Z through 22:14:52Z with 2,312 records updated. This is an input-contract defect,
not a crashed scheduler.

## Frozen correction

1. Resolve both provider and stored team names through the existing NBA team registry before exact
   home/away event matching. Retain the previous conservative fallback only when a provider value is
   genuinely unknown to the registry.
2. Reject non-half-point NBA Spread/Total inputs as non-executable.
3. When the robust accepted-book median falls between two offered lines, select an actual accepted
   line nearest that median, preferring the line offered by more accepted books and then a stable
   deterministic tie-break. Never fabricate a midpoint.
4. Continue to select price and target-excluded fair probability at that exact line. Missing complete
   exact-line evidence remains No Play; no grade threshold is loosened.

## Baseline board

- October 20: 3 games, 9 markets, 0 actionables. Boston-Detroit Spread was `DET +1.25`, null price,
  `no_market`.
- October 21: 11 games, 33 markets, 5 actionables (4 Best Angles, 1 Lean), 20 Watchlists, 8 No-Market.
  Utah-Memphis Spread was `UTAH +1.25`, null price. Phoenix-Portland and Sacramento-Clippers each had
  all three markets without a current price in the evaluated snapshot.

## Required result evidence

- Exact same-input before/after rows for every October 20-21 market, including promotions, demotions,
  pick changes, line changes, price recovery, and actionable totals.
- Zero nonpositive-EV promotions and no unexplained market loss.
- Focused event-identity, consensus, exact-price, professional-candidate, site-wiring, and locked-reader
  tests; `npm run verify:model-change`; TypeScript; integration safety from latest `origin/main`.
- Post-deploy proof that the live reader shows only executable Spread/Total lines, Phoenix-Portland and
  Sacramento-Clippers receive current prices when the provider offers them, release identifiers are
  coherent, the refresh remains healthy, and no locked payload changed.

## Candidate result

The exact current-input replay changed only the two synthetic quarter-point Spread rows before the
identity refresh could run in production:

- October 20 remained 3 games / 9 markets / 0 actionables. Boston-Detroit recovered from
  `DET +1.25`, null price, No Market to the offered `DET +1.5` at -104, Watchlist. The other eight
  rows retained their grade, and there was no actionable promotion or demotion.
- October 21 remained 11 games / 33 markets / 5 actionables (4 Best Angles and 1 Lean). Watchlists
  moved from 20 to 22 and No Market from 8 to 6 solely because Utah-Memphis recovered an offered
  `MEM -1.5` at +102 instead of the synthetic `UTAH +1.25` null-price tuple. That row changed its
  non-actionable displayed side at the real exact line; the five actionable sides and grades were
  unchanged. There were zero actionable promotions, zero actionable demotions, and zero
  nonpositive-EV promotions across both dates.

The provider dry run improved from 10 of 11 to 11 of 11 matched October 21 events after exact alias
resolution, with fetched rows increasing from 6,239 to 6,786 and canonical rows from 935 to 1,043.
The restored event is Sacramento-LA Clippers. Phoenix-Portland was already present in the later
provider payload and requires only the next successful production refresh to replace the older
published no-market snapshot.

Focused executable-consensus, team-identity, current-board fetch, and rolling-board tests pass.
Strict TypeScript and `npm run verify:model-change` pass. The combined refresh-cycle source test
reaches and passes the updated NBA release assertion, then fails on an unrelated stale NHL release
literal already present on the production base; this NBA change does not alter that NHL contract.
