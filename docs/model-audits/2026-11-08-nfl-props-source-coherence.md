# NFL props source coherence — November 8

Starting production base: `4a6a9c932bd3ce929fd2ed3ec41a9a07c27e9716`.

## Observed defect and scope

One completed whole-game review covered 38 players, not a global product cap.
The member reader could select an older NoVig row with nullable source player ID
while the headline used the accepted AI law. A verified same actor had already
been appended with its canonical source ID. Both rows were unlocked. Paid reviews
were paused during the repair; no additional paid tests are part of this change.

NFL source-decision R5 resolves nullable IDs only through a unique exact normalized
full name plus canonical team, opponent, game and start/lock clocks. Non-null IDs
must match exactly. Quotes also require the same book, provider, market, line,
side and event contract, a current non-live provider response, and the existing
15-minute receipt age. Current prices/probabilities/EV stay coherent. An active
reviewed event has one forecast authority; outdated unlocked native quotes and
same-quote duplicates cannot win a separate grade selection. They remain available
as captured raw market evidence. No fuzzy name guesses or new source collection.

R70 writer/R54 member/R36 lifecycle also fix book-agnostic pre-lock lookup. Future
locks use the same exact book/provider/event and unique player identity. All prior
locked board rows remain verbatim, including distinct books; stored locked member
fields take precedence even if a legacy audit board differs. The existing codec
embeds a differing member list rather than reconstructing it. Reader evidence
cleanup cannot erase a stored locked field. No historical correction is authorized.

Forecast R15, its accepted laws, familiar reader R4, wallet R4, schedule R2, native
model/calibration, sole sport lease, jobs, cadence, provider calls, thresholds and
spending authorization are unchanged. R5 stamps source binding, not a new AI law.

## Verification and board impact

Offline synthetic source/site tests cover nullable/canonical duplicates, exact
same-source economics, no-play promotion and wrong-side demotion, ambiguous actor,
wrong game/team/opponent/clock, stale/live receipt, milestone versus two-way event,
and immutable nullable-ID locks. Lifecycle tests cover distinct sportsbook prices
and projections at future lock, preservation after missing feeds, and exact stored
member precedence in both reconciliation and the public reader.

A private GET-only replay uses the saved historical review and its original saved
source clock; it is not represented as current quote execution or new inference.
The one-game quote board changes 696 to 589 rows; actionable book rows 164 to 161.
Matched rows have 6 promotions and 0 demotions; 9 obsolete/duplicate actionable
rows leave the quote board. The remaining row-count differences are removed
unreviewed/stale/duplicate quotes and newly covered exact source quotes. The source
report records 154 superseded rows, 22 duplicate reviewed rows and 0 ambiguous
identities. Counts are sportsbook rows, not distinct players. Forecasts already
using the same accepted law retain that law. All 424 prior locked board rows
remain exact in this replay; 236 stored locked member rows are privately frozen
for the post-deployment comparison. No private player export or spend receipt is
included in this public artifact.

Mandatory gates: focused source/site, NFL lifecycle/store/reader and shared codec
checks; TypeScript/lint/build; `npm run verify:model-change`; clean latest-main
integration and protected PR. After production deployment, inspect the ordinary
writer and live member output with paid runs still paused, compare frozen locks,
then resume only ordinary authorized reviews. Do not claim coverage or a healthy
cycle from a preview alone. No accuracy improvement is claimed by these checks.

Rollback affects future unlocked source binding only. Preserve every existing
lock and accepted review, and pause paid admission if coherence cannot be verified.
