# Missing-grade CFB settlement continuity — 2026-10-09

## Scope

This is a settlement-continuity repair. It changes no prediction, projected
score, probability, side, line, price, play grade, stake, model release, copy,
label, or layout. Locked `prediction_records` remain immutable. Only official
game status/final scores and the deterministic grade derived from that frozen
record may be written.

Settlement contract:
`tracking_settlement_v6_missing_grade_cfb_provider_catchup_2026_10_09`.

## Production finding and cleanup

After the MLB stale-pending cleanup, the public aggregate still contained 17
CFB pendings: 13 Moneyline, two Spread, and two Total records. They were locked
member records from September 5–6. Their linked games had remained `scheduled`
with null scores and no `prediction_grades` row even though the games were long
complete.

The prior bounded repair discovered only records joined to an existing grade
whose result was `pending`. A record whose grade row was entirely absent is
also counted as pending by the member aggregate, but could never enter that
repair query. The normal refresh no longer revisited those old slate dates.

The existing CFB score ingester was dry-run first. Its BALLDONTLIE-primary and
strict ESPN fallback path matched every stored game on both dates without an
error. The normal leased tracking cycle then wrote official results and graded
the frozen records. September 5 settled 170 locked rows (112 wins, 57 losses,
one void) after 62 game lifecycle updates; September 6 settled 12 locked rows
(eight wins, four losses) after six updates. The member-visible CFB pending
count is now zero in Moneyline, Spread, and Total.

## Durable repair

The bounded historical discovery now treats two states as candidates for MLB
and CFB: an explicit pending grade, or a locked record with no grade row. The
two bounded result sets are de-duplicated and capped at 1,000 candidate records.
At most three historical dates are processed per sport per hourly run. CFB uses
the existing official score ingester before the shared grader, just as its
ordinary date cycle does. Other sports retain their database-only pending-grade
behavior.

The cron diagnostic surface separately reports pending-grade and missing-grade
scan counts. Provider work stays within the existing sport-scoped
`prediction_pipeline` lease and does not introduce another writer.

## Safety and rollback

The repair does not write `game_predictions`, `slate_status`, `locked_at`, or
any decision field in `prediction_records`. The shared grader retains its
settled-to-pending regression guard. The CFB result ingester accepts only exact
provider identity or the existing strict ESPN canonical team/date/start match.

Rollback restores settlement v5, removes the missing-grade anti-join and CFB
historical provider call, and leaves already-settled official results intact;
authoritative settlement must never be regressed to pending.
