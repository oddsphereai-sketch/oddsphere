# CFB SharpAPI exact-event page-stride r26 audit

Date: 2026-08-28

## Result

The CFB exact-event SharpAPI fallback now advances a missing `next_offset` by the
provider-reported positive integer page limit. It no longer treats the cardinality of an
expanded sportsbook/market response as the provider's accepted offset stride. Returned row
count remains a compatibility fallback only when no usable limit is present.

This directly addresses the first natural r25 production cycle, which started at
`2026-08-28T19:09:48.810Z` and failed before publication with `SharpAPI HTTP 400 on /odds`.
SharpAPI's current official TypeScript client declares odds pagination as `limit`, `offset`,
and `has_more`, and declares `offset_too_large` as a distinct API error code.

No exact-event identity, team/date identity, sportsbook, main-line, paired-alternate,
representative-market, outlier, target-book, consensus, price, PMF, grade, lock, stake, or
tracking rule changed. No writer, endpoint, provider lane, timer, or lease was added.

## Releases

- Sharp price fallback: `cfb_sharpapi_named_book_fallback_2026_08_28_r6_provider_page_stride`
- Collector: `cfb_forward_evidence_collector_2026_08_28_r13_sharp_page_stride`
- Member: `cfb_v1_member_release_2026_08_28_r13_sharp_page_stride`
- Member fixture: `cfb_v1_member_fixture_2026_08_28_r17_sharp_page_stride`
- Sole writer: `cfb_forward_evidence_writer_2026_08_28_r15_sharp_page_stride`
- Decision, r18 outcome, evidence schema, strict split, tracking, and lease releases: unchanged.

## Decision impact

This transport-only change receives the same exact input rows and does not touch any decision
function. Deterministic focused replays preserve the same selected sides, exact-price tuples,
probabilities, EV calculations, and grades: zero promotions and zero demotions attributable to
r26. Fresh provider observations admitted by a successful future cycle remain genuine new
forward evidence and are not labeled as an audit promotion.

The prior current immutable eight-game/24-market replay remains the comparison baseline:
23 evaluated exact-price decisions, 2 Best Angle, 3 Lean, 8 Watchlist, 10 evaluated No Play,
and one unavailable SJSU-USC Moneyline. Every score/winner/representative-score and event
containment check passed. The stale reader snapshot remains live until the sole writer completes
a coherent all-game append on r26.

## Verification

- Recorded-response SharpAPI odds tests passed, including direct offsets, provider-limit
  derivation, row-count compatibility fallback, oversized expanded responses, repeated pages,
  conflicting offsets, empty claimed-more pages, request cap, and page cap.
- CFB decision, weekly engine, production/member/writer, strict splits, and r18 PMF tests passed.
- Shared football cross-market coherence passed.
- `npx tsc --noEmit` passed.
- Full `npm run verify:model-change` passed.
- `npm run build -- --webpack` passed with 105/105 static pages.

Production acceptance remains a protected merge, production deployment, and the next untouched
scheduled `prediction_pipeline:cfb` cycle. It must publish all pre-kickoff model-covered games,
recover the current USC Spread/Total evidence, keep Moneyline market-specific if unavailable,
and preserve the reader's existing primary-r18/football-only-secondary hierarchy.
