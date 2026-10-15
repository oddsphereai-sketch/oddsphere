# NBA rolling seven-day member schedule — 2026-10-15

## Scope

This release opens only the official NBA schedule layer before the October 20
regular-season opener. It does not publish an early prediction card and does
not change the NBA model, calibration, market marriage, price selection,
grade, stake, lock, settlement, or tracking contract.

## Member lifecycle

- The default NBA board carries the current ET board date through six
  additional ET calendar dates.
- The member navigation changes from offseason to schedule-live exactly one
  week before opening night, on October 14, 2026.
- Before opening night, only regular-season games on or after October 20 may
  appear.
- Schedule-only cards contain matchup, official start time, status, and venue
  identity. They contain no projection, probability, pick, price, grade, or
  stake.
- A manually selected future date remains schedule-only. The analyzed Daily
  Edge path runs only for an official NBA date that is not in the future.
- When an analyzed game card is available for the current date, its matching
  schedule-only card is removed by external game ID, so the card advances in
  place instead of appearing twice.
- Final and canceled games are excluded from the schedule-only layer.
  Scheduled, in-progress, and postponed games remain visible with their true
  status. An analyzed current-day card follows the existing board lifecycle
  through the normal ET rollover, so a completed pick does not disappear early.

## Writer and refresh ownership

`/api/cron/nba-daily-refresh` remains the sole NBA game/line/snapshot writer
and retains the shared `prediction_pipeline:nba` lease. The daily full cycle
seeds all seven dates from ESPN. Intraday cycles update the current date for
status changes and the far edge of the window so one new date enters as the
window advances. Lines, ratings, model execution, prediction records, and
locks retain their existing ownership.

The versioned schedule is embedded in the existing date-keyed Daily Edge
snapshot. A cached payload that predates this schedule contract is rejected
and rebuilt; a partial seven-day seed cycle cannot replace the prior complete
member snapshot.

## Frozen safety claims

1. Schedule rows never create or update `prediction_records`, grades, locks,
   or tracking rows.
2. Future dates cannot execute the member prediction pipeline.
3. Existing locked NBA payloads are never read, rewritten, or reconstructed
   by the schedule layer.
4. For identical eligible current-day input, the model outputs, sides,
   probabilities, prices, grades, stakes, promotions, demotions, and
   actionable count are unchanged.
5. The rolling calendar uses ET slate-date labels and calendar-day arithmetic,
   so daylight-saving transitions cannot shorten or lengthen the seven-date
   window.

## Release identifiers

- Member schedule: `nba_rolling_member_schedule_2026_10_15_r1_schedule_only`
- Operational refresh: `nba_daily_refresh_schedule_2026_10_15_r4_rolling_seven_day_slate`
- Model / prediction record remains: `nba_v2_independent_first_2026_10_06_r1`

## Rollback

Restore the r3 NBA refresh and omit `nbaRollingSchedule` from the member
response. Do not delete seeded `games` rows: they are ordinary provider-owned
schedule records and carry no member prediction semantics. No locked record or
tracking row requires migration or repair.
