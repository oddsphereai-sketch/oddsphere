# NBA ESPN season identity correction

Date: 2026-10-15

Operational release: `nba_daily_refresh_schedule_2026_10_15_r5_espn_season_identity`

## Defect

The NBA seed writer derived `games.season` from the event's calendar year and
classified every game without a postseason note as `regular`. Production rows
for October 15 and 16 therefore described 2026-27 preseason games as season
2026 regular season.

ESPN supplies the missing authoritative fields on every inspected event:

- October 15 preseason: `{ year: 2027, type: 1, slug: "preseason" }`
- October 20 opening night: `{ year: 2027, type: 2, slug: "regular-season" }`

## Correction

The scoreboard adapter now retains ESPN's season end-year and normalizes type
1/2/3 (or the corresponding slug) to preseason/regular/postseason. The sole NBA
seed writer persists those values. If ESPN omits or changes the season object,
the existing calendar-year and postseason-note fallback remains available; an
unknown provider phase is never guessed inside the adapter.

The next ordinary idempotent seed corrects existing rows for each date. No
separate backfill writer, timer, database migration, or destructive update is
introduced.

## Model and member impact

The active NBA member/tracking boundary already excludes all dates through
October 19, and early-season game counts also require both `regular` and a
tracking-eligible slate date. Therefore the October 15 board comparison is:

- prediction changes: 0
- projected-score changes: 0
- probability changes: 0
- grade changes: 0
- promotions/demotions: 0/0
- actionable-count change: 0
- locked-record changes: 0

The correction prevents incorrect phase/year metadata from entering future
research exports, operational audits, or downstream code that does not have the
extra date boundary.

## Rollback

Rollback is r4. Hold or roll back if a verified ESPN season object maps to the
wrong phase/year, the parser drops a valid game, a current regular-season event
is classified preseason/postseason, the existing postseason fallback regresses,
or any prediction/grade/lock changes on identical inputs.
