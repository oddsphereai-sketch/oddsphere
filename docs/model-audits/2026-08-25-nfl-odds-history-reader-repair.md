# NFL same-book odds history reader repair

Date: 2026-08-25

## Scope

This release repairs two member-reader evidence defects without changing an NFL
forecast, probability, side, exact evaluated quote, grade, stake, writer,
collection cadence, lock, or tracking rule.

The production append-only table already contained 144 valid current-schema
rows: nine complete 16-game Week 1 waves. The member adapter selected the latest
row for each game correctly, but then constructed the visible odds trail from
only that row's operational Opening and current quote. When the exact evaluated
sportsbook differed from the operational-Opening book, it reduced the trail to
one current quote and discarded the earlier same-book observations.

Separately, NFL Playbook split rows declare a 360-minute early-week freshness
window matching the documented six-hour collection cadence. The shared reader
ignored that field and marked every split stale after 75 minutes.

## Repair

- The latest row remains the sole authority for the published decision tuple.
- Movement history now consumes every immutable current-schema row for the game
  up to that latest row and selects only the exact displayed/evaluated book.
- Provider-native openings are used only when they belong to that same book.
  Otherwise the earliest OddSphere capture for that book is labeled `First`.
- Both selected and opposing sides retain the same-book capture sequence.
- Consecutive flat captures are compacted to a first/current verification pair;
  every economic price or point-line change remains visible between them.
- The member source checksum now covers every evidence row consumed by the
  movement adapter, not only the latest 16 rows.
- Split freshness uses each source row's declared `staleAfterMinutes`, retaining
  the established 75-minute default only when a source supplies no contract.

## Production replay

Bounded SELECT-only replay at `2026-08-25T15:36:33.686Z`:

- 16 games / 48 markets
- 144 immutable rows / nine complete waves
- 48/48 selected trails scoped to one exact sportsbook
- minimum 2 and maximum 5 compact observations per selected market
- 19/48 markets contain a real same-book price or point-line change
- 3 Best Angles / 12 Leans / 5 Watchlists / 28 No Plays
- zero promotions and zero demotions
- no additional provider calls or database writes

Verified examples include Seattle -3.5 at DraftKings moving from -110 to -105,
Houston +1 to +1.5 at BetRivers, Chicago-Carolina Over 47.5 at FanDuel moving
from -114 to -105, and Tennessee moneyline at FanDuel moving from -142 to -138.

## Validation and rollback

Focused fixture tests cover multi-wave selected and opposing trails, exact-book
coherence, latest terminal identity, and checksum sensitivity. Daily Edge tests
cover the NFL six-hour freshness boundary and the default stale behavior.

Rollback is the prior member fixture
`nfl_week_one_member_fixture_2026_08_25_r7_actionable_grades`. The evidence
table and authoritative writer remain unchanged.
