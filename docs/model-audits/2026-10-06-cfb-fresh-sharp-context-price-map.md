# CFB fresh sharp-context held price map — 2026-10-06

## Scope and pre-declared invariants

The Southern Miss at Troy member card retained a single older Rebet quote even after the next
scheduled evidence capture. The writer row contained fresh Playbook lines and fresh target-excluded
Circa/Pinnacle context, while the full SharpAPI exact-price fallback was correctly deferred by the
existing bounded slate request budget. This audit changes only which already-stored verified quote
may populate a held market's current price map.

The candidate must preserve:

- the independent forecast, PMF, projected score and representative score;
- every market prediction side and probability;
- every evaluated quote, exact-price decision, grade and actionability state;
- all T-60 locks and official tracking rows;
- the sole `prediction_pipeline:cfb` writer and existing provider request cadence;
- the member-facing layout, copy and labels; and
- same-book chronology with real observation timestamps only.

No opening quote may be inferred. No target-excluded context quote may become an evaluated quote or
clear a held exact-price decision.

## Root cause

`cfbForwardContextSharpHistoryBooks` already reconstructs complete Circa, Pinnacle and Bookmaker
pairs from the bounded forward-context capture. The writer uses those landmarks to preserve future
sharp-book chronology, but `currentDisplayQuote` considered only `displayBooks`/`currentBooks`.
When the full SharpAPI odds fallback was deferred, a retained older Rebet row therefore outranked
fresh sharp-book evidence that was present in the same immutable payload.

## Repair

Member fixture r73 adds the forward-context sharp-book pairs to the held-market display candidate
set. Existing freshness, complete-pair, line-distance and same-book trail rules remain authoritative.
The exact evaluated-quote path runs before this fallback and is unchanged.

Compact snapshot r33 and reader r18 version the changed member representation. No evidence schema,
collector, writer, forecast, market reader, decision, grade, lock or tracking release changes.

## Outcome-blind production replay

The replay used the latest production writer evidence and compact market-only history before
publication.

| Measure | Live r72 | Candidate r73 |
| --- | ---: | ---: |
| Games | 89 | 89 |
| Market forecasts | 267 | 267 |
| Best Angle | 12 | 12 |
| Lean | 77 | 77 |
| Watchlist | 66 | 66 |
| No Play | 112 | 112 |
| Complete first/open-to-current trails | 168 | 171 |
| Forecast/side/probability/grade changes | 0 | 0 |
| Promotions | 0 | 0 |
| Demotions | 0 | 0 |

Only the three held Southern Miss at Troy display rows change:

- Moneyline: Circa `-405` at `2026-10-06T16:39:54.357Z` to `-400` at
  `2026-10-06T17:38:58.840Z`.
- Spread: Circa Troy `-10.5 (-110)` to Troy `-10 (-105)` across the same verified timestamps.
- Total: Circa `51.5 (-110)` at both verified timestamps. The price and line are flat, but the
  second observation is real and proves the current state rather than inventing movement.

Jacksonville State at Kennesaw State and New Mexico State at Florida International retain their
r72 evaluated-book opening trails unchanged.

## Verification

- `npx tsx scripts/test-cfb-v1-production.ts`
- `npx tsx --env-file=.env.local scripts/operator/audit-cfb-price-history-continuity.ts`
- `npx tsc --noEmit`
- `npm run verify:model-change`
- `npm run build`
- `node scripts/verify-integration-safety.mjs --base-ref=origin/main`

The focused regression proves a fresher complete Circa context pair outranks stale Rebet display
fallback for all three held markets while the pick and evaluated price remain null, the hold remains
true, and the price trail stays Circa-only.

## Rollback

Roll back member fixture/snapshot/reader r73/r33/r18 together to r72/r32/r17. Stored evidence,
provider cadence, locks and tracking rows are unchanged and must not be rewritten.
