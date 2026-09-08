# MLB current-line pagination r87 — result

Date: 2026-09-08

## Decision

Approve r87 for production. The defect is a downstream current-price pagination gap, not an
upstream odds-feed failure and not a reason to change model or product policy. The candidate keeps
all r86 formulas, probability heads, side rules, grade thresholds, providers, book priority,
cadence, stakes, locks, tracking, and settlement behavior unchanged.

## Production evidence

The read-only September 8 audit returned 1,228 current game-level rows from 23 named books. The
newest row was fetched at `2026-09-08T17:43:39.21Z`, about eight minutes before the audit. All 15
games had complete two-sided Moneyline, Total, and valid 0.5-run first-inning coverage; there were
no missing pairs, invalid first-inning lines, or evaluated prices more than five implied-probability
points from the comparable-book center. A few one-run alternate Total rows were present, but the
existing main-line coherence selector rejected them as intended.

The production-backed member API assembled all 15 games at `2026-09-08T17:53:52.357Z` with zero
response-coherence issues and zero limited evidence markets. In the two games that had fallen past
the old 1,000-row prefix, it now surfaced the fresh current Moneyline quotes: STL@SF `-102` at
1xBet and CIN@LAD `-282` at Circa, both observed at `2026-09-08T17:43:39.21Z`. WSH@SD surfaced
`-157` at Circa at the same timestamp. The route keeps the evaluated/grade quote separate from the
current member quote until the authoritative unlocked writer refreshes it; locked rows remain
immutable.

## Outcome-blind board impact

The same-input, no-write writer comparison covered all 45 game markets. Stored r86 counts were 2
Best Angles / 8 Leans / 11 Watchlists / 24 No Plays. Candidate r87 counts are 2 / 10 / 12 / 21.
The only three material unlocked changes are:

- CIN@LAD Moneyline: evaluated price `-306` to `-282`, No Play to Lean.
- STL@SF Moneyline: evaluated price `-106` to `-102`, No Play to Watchlist.
- WSH@SD Moneyline: evaluated price remains `-157`, No Play to Lean after the complete current
  board is supplied to the existing price/economics policy.

There are two evaluated-price changes, three promotions, zero demotions, zero side changes, zero
model-probability changes, zero hold changes, and no locked-row changes. Six-decimal database
rounding was excluded from the probability-change count. No outcome was consulted, no provider was
called, and no write occurred during the audits.

## Verification

- A deterministic 1,329-row fixture returned every row in three stable 500-row pages.
- A saturated bounded fixture failed closed instead of returning a partial board.
- The shared reader orders by `lines.id`, retains the existing game/market/player filters, and
  refuses a partial result at 10,000 rows.
- The behavioral change is gated to MLB in the shared prediction writer and Daily Edge route;
  other sports retain their prior reader behavior.
- The focused pagination test, production-backed odds-health audit, writer dry comparison, and
  member-response coherence audit passed.

Full `npm run verify:model-change`, TypeScript, focused lint, and the production Next.js build all
passed. Latest-main integration safety, protected pull-request checks, and post-deploy live
verification remain mandatory publication gates. Roll back the complete r87 release family to r86
if any production gate fails. Do not alter stored immutable lock rows.
