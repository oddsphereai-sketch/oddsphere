# CFB SharpAPI exact-event pagination r25 predeclaration

Date: 2026-08-28

## Trigger

The first natural production cycle after the Division I coverage release started at
`2026-08-28T18:39:48.429Z` and failed before publication with:

`CFB SharpAPI event ncaaf_northcarolinatarheels_tcuhornedfrogs_2026-08-29_b2 reported more rows without a valid forward offset.`

The failed run wrote zero evidence rows. The prior coherent member snapshot remained live.

## Scope and authority

- Sport: CFB only.
- Markets: Moneyline, Spread, and Total named-book evidence returned by the existing exact-event SharpAPI fallback.
- Forecast/model/calibration/grade policy: unchanged.
- Authoritative path: the existing `cfb-forward-evidence` cron and sole
  `prediction_pipeline:cfb` leased writer. No endpoint, timer, or writer is added.
- Current provider/collector/member/writer releases:
  `cfb_sharpapi_named_book_fallback_2026_08_28_r4_display_quote_coverage`,
  `cfb_forward_evidence_collector_2026_08_28_r11_model_covered_division_i`,
  `cfb_v1_member_release_2026_08_28_r11_model_covered_division_i`, and
  `cfb_forward_evidence_writer_2026_08_28_r13_model_covered_division_i`.

## Predeclared repair

When `has_more=true` and `next_offset` is missing or non-advancing, derive the next offset
only from internally coherent provider metadata: the reported current offset plus a positive
reported count, falling back to the non-empty returned row count. Reject a reported offset
that conflicts with the requested offset, reject an empty page that still claims more rows,
and retain the existing request/page caps. If the provider ignores the derived offset or
returns non-advancing metadata, fail closed before the all-game append.

This is a pagination transport repair, not permission to relax exact event/team/date,
sportsbook, main-line, pairing, representative-market, outlier, target-book, consensus,
price, or cross-market coherence gates.

## Release and acceptance gates

- Bump the Sharp fallback, collector, member, fixture, and sole writer releases.
- Add recorded-response tests for missing `next_offset`, conflicting provider offset,
  repeated/non-advancing pages, empty claimed-more pages, and the existing hard caps.
- Run focused CFB provider/writer/member/coherence tests, TypeScript, full
  `npm run verify:model-change`, webpack build, diff/integration safety, protected PR, and
  production deployment.
- Natural-cycle acceptance requires the new writer release to complete successfully,
  preserve the existing eight-game/24-market grade tuples unless fresh exact prices genuinely
  move them, and add only pre-kickoff games with two qualified model profiles.
- Report exact promotions/demotions and new-board games. No actionable-count quota is used.

Rollback is the r4/r11/r11/r13 release set and its last coherent immutable snapshot.
