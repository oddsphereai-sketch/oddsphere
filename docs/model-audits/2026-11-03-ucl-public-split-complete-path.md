# UCL public source matching, refresh and immutable reader

Starting base: `d8c64bc96a6c83d1a09843a9bfba8cc371562ce3` (CBB PR965).

The stored DraftKings public feed at12:38 UTC contains all18 current UCL
fixtures, with money and tickets for each moneyline. Its soccer titles list
the home club first. The generic away-first join rejected every fixture.
Separately, member reads correctly use stored sources only, but no scheduled
collector refreshed the UCL DraftKings feed. That leaves a real source present,
unmatched and then increasingly old.

UCL now joins exact unordered club identities plus source date, rejects multiple
same-day fixtures/opponents and another-year matches, and maps percentages by
each labeled club rather than source row position. The actual18-game receipt
restores18 moneyline panels. They are DraftKings retail context, never claimed
as professional-book money. All prices, probabilities, projections, selections,
grades and stakes remain unchanged. Any stored lock, locking/missed state or
locked timestamp prevents the new overlay from touching the game.

The existing public-splits observation cron gains one soccer source-only branch
under the same `prediction_pipeline:soccer` lease used by UCL. It reuses the
same durable DraftKings collector, only with unlocked upcoming UCL fixtures,
and only when the stored source is at least15 minutes old. It adds no timer,
prediction writer, paid-provider request or schema. A refresh has the existing
eight-page/6-second free-HTML bound. Other sports retain their order, source
calls and policies. Retained old data is not restamped or reported as fresh;
source failure becomes a partial job result while preserving the complete LKG.
Health is measured against each matched active moneyline's original observation
time, not a newly refreshed feed envelope. A partially refreshed feed remains
partial while respecting its capture cadence. Future observations are rejected.
The UCL member API and initial server reader consume only the stored DK feed
through the same direct immutable overlay; they cannot fetch providers or run
unrelated legacy continuity migrations while a member waits.

Source releases: `ucl_public_split_identity_2026_11_03_r1_unordered_exact_clubs`
and `ucl_public_split_source_2026_11_03_r1_scheduled_durable_refresh`. Runtime
UCL R16/R19 and its numerical market policy remain unchanged. This repairs
public-source ingestion/rendering; it does not grant new forecast or grade
authority to retail handle or add a Best tier.

Tests cover the actual18 fixtures, correct Galatasaray90% home mapping, exact
opponents/date/year and doubleheader rejection, unchanged numeric decisions,
locked bytes, fresh-source reuse, stale-retention failure reporting and
no-active-game/no-extra-request behavior. Focused UCL/generic split tests,
full model safety, TypeScript/lint, build, fresh-main protected publication and
normal source-job/member proof are required. Check the existing216 locked
records×40 fields again after deployment.
