# CFB SharpAPI exact-event page-stride r26 predeclaration

Date: 2026-08-28

## Trigger

The first natural production cycle on the r25 pagination release started at
`2026-08-28T19:09:48.810Z` and failed before publication with:

`SharpAPI HTTP 400 on /odds`

The preceding r24 cycles had failed on the same UNC-TCU exact event because SharpAPI returned
`has_more=true` without `next_offset`. The r25 fallback advanced by the returned row count.
SharpAPI's current official client instead defines odds pagination by the provider-reported
`limit`, `offset`, and `has_more`, and exposes `offset_too_large` as a distinct 400 failure.
The natural-cycle result therefore proves that returned row cardinality is not a safe page
stride for this exact-event response.

## Scope and authority

- Sport: CFB only.
- Markets: Moneyline, Spread, and Total named-book evidence returned by the existing exact-event
  SharpAPI fallback.
- Forecast, PMF, calibration, selected side, grade policy, lock, stake, and tracking: unchanged.
- Authoritative path: the existing `cfb-forward-evidence` cron and sole
  `prediction_pipeline:cfb` leased writer. No endpoint, timer, provider lane, or writer is added.
- Current provider/collector/member/writer releases:
  `cfb_sharpapi_named_book_fallback_2026_08_28_r5_resilient_offset_pagination`,
  `cfb_forward_evidence_collector_2026_08_28_r12_resilient_sharp_pagination`,
  `cfb_v1_member_release_2026_08_28_r12_resilient_sharp_pagination`, and
  `cfb_forward_evidence_writer_2026_08_28_r14_resilient_sharp_pagination`.

## Predeclared repair

When `has_more=true` and `next_offset` is absent or non-advancing, derive the forward offset
from the provider-reported positive integer page `limit` before considering returned row count.
The reported current offset must still match the requested offset. Returned row count remains
only a compatibility fallback when the provider does not report a usable limit.

Retain repeated-page detection, request/page caps, empty-page rejection, malformed-response
rejection, and every exact event/team/date, sportsbook, main-line, pairing,
representative-market, outlier, target-book, consensus, price, and cross-market coherence gate.

## Release and acceptance gates

- Bump the Sharp fallback, collector, member, fixture, and sole writer releases.
- Add a recorded-response regression in which one response expands more rows than its advertised
  page limit; require the second request to advance by the advertised limit.
- Run focused CFB provider/writer/member/coherence tests, TypeScript, full
  `npm run verify:model-change`, webpack build, diff/integration safety, protected PR, and
  production deployment.
- Natural-cycle acceptance requires the new writer release to complete successfully and publish
  all pre-kickoff model-covered games. Fresh real prices may change exact grades; no action-count
  quota or grade manufacture is permitted.

Rollback is the r5/r12/r12/r14 release set and fixture r16, with the last coherent immutable
snapshot remaining reader-visible until a successful replacement append.
