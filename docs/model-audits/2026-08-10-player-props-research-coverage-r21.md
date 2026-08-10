# MLB Player Props research-coverage release r21

Date: 2026-08-10
Status: private launch candidate passed; not deployed

## Scope

- Sport/model: MLB Player Props, complete member board.
- Affected inputs: game-time weather for venues outside NWS coverage and
  official current-year Statcast park factors for new venues absent from the
  established three-year table.
- Affected model families: pitcher strikeouts and pitcher outs, which already
  consume the shared environment bundle.
- Reader-only improvements: incremental direct batter/pitcher history,
  changed-starter research refresh, renamed-venue resolution, and official
  park-factor matching by home team.
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard`.
- Lease: existing MLB-scoped `prediction_pipeline` lease. No writer or timer
  was added.

## Immutable versions

- Candidate bundle: `mlb_props_2026_08_10_r21`
- Rollback bundle: `mlb_props_2026_07_31_r20`
- Pitcher strikeouts: `pitcher_strikeouts_distribution_v5_global_weather_context`
- Pitcher outs: `pitcher_outs_peer_consensus_compact_core_v5_global_weather_context`

## Behavior

The National Weather Service remains primary. When it cannot resolve a
scheduled non-dome venue, the bounded global fallback requests the same
game-time hourly fields from Open-Meteo. This principally covers Rogers Centre
and does not replace an available NWS forecast.

Baseball Savant's three-year table remains primary for established parks. A
second cached current-year request contributes only teams/venues missing from
that table, which supplies Sutter Health Park without replacing any existing
multi-year factor.

Fast price refreshes now also fetch the next prioritized batch of missing
official batter/pitcher histories and rebuild only newly posted research keys
or games whose probable starter changed. Complete prior research remains
reused; the fast path does not become a second full-slate writer.

## Safety requirements before promotion

1. Run the complete model-change verification and focused props tests.
2. Compare r20 persisted rows with an r21 read-only current-slate dry run and
   report grade/side/board-count changes.
3. Keep public props flags off while the refresh, tracking, and settlement
   jobs produce three consecutive valid r21 snapshots.
4. Verify snapshot freshness, provider request budgets, research coverage,
   settlement health, and member reader coherence before public activation.
5. Roll back to r20 if the current slate mixes release ids, provider timeouts
   increase materially, or the actionable board changes outside the audited
   weather-affected rows.

## Current-slate comparison

The 2026-08-10 r20 persisted fast snapshot was compared with an r21 read-only
full-contract rebuild using exact row identity:

- 457 exact rows matched across releases.
- 0 selected-side changes occurred among the matched rows.
- 2 matched rows changed grade: Jac Caglianone home runs moved from Watchlist
  to Lean, and Noah Cameron pitcher outs moved from Watchlist to No Play.
- The r20 fast snapshot contained 1,848 rows and 4 actionable rows. The r21
  complete rebuild contained 3,835 rows and 82 actionable rows. The row-count
  recovery is attributable to newly posted offers not being hydrated by the
  stale fast-refresh research path; it is not a general threshold loosening.
- The r21 provider run used 43 BALLDONTLIE calls, below the configured budget.
- Recent-form, weather, and park-factor coverage were complete after bounded
  fallbacks. Eighteen direct batter/pitcher history pairs remained queued after
  the first 60-pair batch and are expected to converge on the next fast cycle.

These results authorize continued private shadow validation only. They do not
authorize public display or a live route switch.

## Private snapshot gate

The bounded hydration snapshot at `2026-08-10T12:04:36Z` correctly failed the
consecutive-valid gate while direct matchup research was still converging. It
was not treated as launch-ready. Subsequent fast cycles reused the completed
research and produced three consecutive valid r21 snapshots spanning more than
15 minutes:

- `2026-08-10T12:11:11Z`
- `2026-08-10T12:19:53Z`
- `2026-08-10T12:26:33Z`

The final snapshot contains 3,834 prop rows across 10 games, 6 books, and 16
markets. All 14,886 source rows mapped, stale-odds count is zero, provider use
was 14 BALLDONTLIE calls, tracking completed without error, and every critical
launch-readiness check passed. Public display, API, and publish flags remained
explicitly closed throughout.

Projected/posted lineup context remains the sole non-critical warning. That is
an expected time-of-day state: official posted lineups continue to refresh the
same authoritative board when clubs release them and are not fabricated early.
