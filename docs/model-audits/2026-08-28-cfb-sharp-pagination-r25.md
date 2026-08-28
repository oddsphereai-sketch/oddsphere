# CFB SharpAPI exact-event pagination r25 audit

Date: 2026-08-28

## Result

The existing sole CFB writer now tolerates SharpAPI's observed exact-event response where
`has_more=true` is returned without `next_offset`. It derives one bounded forward offset from
the non-empty returned page only when the provider's reported offset agrees with the requested
offset. The repair retains all existing page/request caps and rejects repeated, conflicting,
empty, non-advancing, malformed, and over-cap pagination before the all-game append.

No exact-event identity, team/date identity, sportsbook, main-line, paired-alternate,
representative-market, outlier, target-book, consensus, price, PMF, grade, lock, or tracking
gate changed. No writer, endpoint, provider request lane, timer, or lease was added.

## Releases

- Sharp price fallback: `cfb_sharpapi_named_book_fallback_2026_08_28_r5_resilient_offset_pagination`
- Collector: `cfb_forward_evidence_collector_2026_08_28_r12_resilient_sharp_pagination`
- Member: `cfb_v1_member_release_2026_08_28_r12_resilient_sharp_pagination`
- Member fixture: `cfb_v1_member_fixture_2026_08_28_r16_resilient_sharp_pagination`
- Sole writer: `cfb_forward_evidence_writer_2026_08_28_r14_resilient_sharp_pagination`
- Decision, r18 outcome, schema, tracking, and lease releases: unchanged.

## Read-only board comparison

The current immutable eight-game/24-market replay used 256 stored rows, zero provider calls,
and zero writes:

- 23 exact-price decisions before and after.
- 2 Best Angle / 3 Lean / 8 Watchlist / 10 evaluated No Play before and after.
- One SJSU-USC Moneyline without a coherent target-book pair before and after.
- 0 exact tuple changes, 0 promotions, and 0 demotions.
- 8/8 score/winner/representative-score/event-containment coherence.
- Hawaii primary prediction, Hawaii exact-price selection separation, UVA cross-market price
  explanation, and SJSU market-specific unavailability checks all passed.

The transport repair can admit additional real exact-event rows on a future provider cycle.
Any resulting price or grade change must remain stamped to the new release and is evaluated as
fresh forward evidence, not called an audit promotion.

## Verification

- Recorded-response SharpAPI odds tests passed, including explicit/missing offsets, ignored
  offsets, conflicting offsets, empty claimed-more pages, malformed pages, request cap, and page cap.
- CFB decision, weekly engine, production/member/writer, strict splits, and r18 PMF tests passed.
- Shared football cross-market coherence passed.
- `npx tsc --noEmit` passed.
- Full `npm run verify:model-change` passed.
- `npm run build -- --webpack` passed with 105/105 static pages.

Production acceptance remains the next natural scheduled cycle under
`prediction_pipeline:cfb`; no manual cron, writer, provider, or database mutation is authorized.
