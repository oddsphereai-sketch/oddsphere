# Daily Edge exact-date rollover continuity

Date: 2026-10-20
Scope: MLB and NHL member-slate publication only

## Incident

After the 03:00 America/New_York member-board boundary, the Daily Edge could
retain the prior day's published payload:

- NHL opened the 2026-10-19 four-game board even though the official 2026-10-20
  schedule contained 11 games.
- MLB retained the prior board until 07:00 ET on an official off-day because
  the lower-authority slate provider returned zero games and the generic
  minimum-count gate blocked the 03:05 ET rollover publication.
- The sport-activity endpoint queried the current date, so its empty result
  could disagree with the stale board reached by clicking the sport tab.

## Production evidence

The NHL `nhl_daily_refresh` runs from 00:48 through 06:18 ET all completed as
`partial`, leaving no current-date member artifact. A SELECT-only input audit
then proved 11 exact-date games, complete current lines, and 33 coherent
Moneyline/Total/Puck Line predictions with zero writer errors. The canonical
leased intraday writer was run once and published
`nhl::2026-10-20::current-only::live-copy` with 11 games. Live browser
verification showed the 2026-10-20 11-game board and `NHL Active`.

For MLB, the authoritative MLB Stats schedule returned `totalGames: 0` for
2026-10-20. The 03:05 ET rollover failed closed only because the BDL slate was
empty; the current-date empty artifact was not published until the 07:00 ET
split refresh. The correct member outcome is therefore zero current-date games,
not a prior-date fallback.

## Repair

1. `AutomationRunReport` exposes the already-fetched authoritative supported
   MLB schedule count.
2. The 03:05 ET rollover may take an official-empty fast path only when that
   count is exactly zero.
3. The normal response assembler is still used, and snapshot persistence now
   accepts an optional required slate state. The MLB fast path requires an
   independent second assembly to return `no_data`; disagreement or provider
   failure writes nothing.
4. NHL adds two bounded intraday retries at 06:48 and 07:18 ET. The existing
   07:45 full refresh, provider calls, prediction writer, sport-scoped
   `prediction_pipeline` lease, and readiness gate remain unchanged.

## Board impact

- Model sides changed: 0
- Probabilities changed: 0
- Scores changed: 0
- Grade promotions/demotions: 0 / 0
- Stakes changed: 0
- Existing locked records changed: 0
- NHL member availability: stale 4-game prior board -> current 11-game board
- MLB official off-day availability: stale prior board -> current 0-game board

The availability changes are exact-date publication corrections, not model
calibration changes or hidden board flattening.

## Release and rollback

- MLB schedule release:
  `mlb_daily_refresh_schedule_2026_10_20_r2_official_empty_slate_rollover`
- NHL schedule release:
  `nhl_daily_refresh_schedule_2026_10_20_r12_morning_rollover_retry`

Roll back if a non-empty official MLB slate is suppressed, an unverified empty
artifact is persisted, NHL retries bypass the shared lease, provider calls
escape the bounded cadence, any prediction tuple changes on the same inputs, or
any stored lock changes.
