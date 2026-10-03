# CFB exact-kickoff duplicate-event disambiguation r84

## Scope

- Sport / markets: CFB Moneyline, Spread, and Total price ingestion.
- Runtime: the existing SharpAPI named-book fallback inside the sole CFB forward writer.
- Releases: `cfb_sharpapi_named_book_fallback_2026_10_03_r14_exact_kickoff_disambiguation` and
  `cfb_forward_evidence_writer_2026_10_03_r84_exact_kickoff_disambiguation`.
- Lease / cadence: unchanged `prediction_pipeline:cfb` lease and existing writer schedule.
- Member surface: no copy, label, layout, or navigation change.

## Failure and repair

The October 3 provider catalog contains two SJSU-Hawaii events with exact team/date identity and
kickoffs one minute apart. The released matcher correctly refused to guess between them, but that
left all three member prices unavailable even though exactly one catalog event matches the
authoritative scheduled kickoff.

R14 keeps the existing strict team match and 15-minute discovery boundary, but permits a duplicate
catalog to resolve only when exactly one candidate has the identical kickoff timestamp. Same-time
duplicates, multiple exact matches, catalogs without an exact match, and stale trusted IDs remain
ambiguous and make no odds request. A current trusted provider event ID retains priority.

## Prediction and board impact

This is an input-availability correction, not a model or grade recalibration. Previously complete
games have zero score changes, side changes, promotions, or demotions. The affected SJSU-Hawaii
game changes from three incomplete price tuples to the exact named-book offers returned for its
canonical event; the existing model and exact-price policy then evaluate those offers normally.
No quota or fabricated price is introduced.

The bounded live-provider proof selected provider event
`ncaaf_hawaii_sanjosestatespartans_2026-10-03_b3` for the authoritative
`2026-10-04T03:59:00.000Z` kickoff. It returned complete two-sided Moneyline, Spread, and Total
offers, including BetRivers and FanDuel target books plus Pinnacle reference context. The proof
performed zero writes and reported no event-level failure.

## Load, failure behavior, and rollback

The repair adds no request. It replaces an ambiguous no-call with the same single exact-event call
that any unambiguous game already makes, within the unchanged 192-request and per-event page caps.
All other ambiguity remains fail-closed. Roll back the two release constants and matcher branch if
live verification shows a wrong event ID, mixed writer releases, lost sibling coverage, or a
member price that does not match the selected exact provider event. Existing locks remain
immutable.
