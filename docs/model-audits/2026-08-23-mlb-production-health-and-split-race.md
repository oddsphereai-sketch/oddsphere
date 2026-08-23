# MLB production health and Sharp history race — August 23, 2026

Status: current-production read-only audit plus a non-model ingestion hardening.
No prediction, probability, projection, side, grade, stake, price selection,
writer cadence, lease, lock, reader, or tracked record is changed.

## Production evidence

The audit was captured from the current 2026-08-23 MLB slate between
13:08:03Z and 13:08:56Z. It invoked no cron, prediction writer, lock, or
publication path.

- Slate: 15 scheduled games and exactly 45 `prediction_records`: 15 Moneyline,
  15 Total, and 15 First Inning.
- Release coherence: all 45 unlocked rows carried decision r67, calibration
  v27, rule bundle v55, grade policy v45, and the correct active per-market
  probability head.
- Price history: all 15 games had at least five distinct observation times,
  genuine openers, and current multi-book trails for Moneyline, Total, and
  First Inning.
- Splits: all 15 games had current Playbook public consensus and authentic
  SharpAPI money/ticket coverage. The 13:00Z split collector completed
  successfully with 1,837 updates; the 13:05Z slate cycle preserved complete
  current coverage while one of 30 optional history requests failed upstream.
- Stats: the 08:05Z bulk refresh stored 538 current-season batting rows and
  478 current-season pitching rows. The published board carried 29 of 30
  named probable starters with current 2026 statistics, weather for all 15
  games, and current bullpen/offense inputs.
- Fail-closed case: Detroit's starter was not yet available. DET@KC therefore
  remained Moneyline No Play, Total provisional/no-bet, and First Inning
  Toss-Up. No missing starter was presented as an ordinary actionable play.
- Lineups: no lineup was confirmed at the early 09:08 ET audit horizon. The
  writer accurately stamped lineup fallback/provisional context and the normal
  later lineup/lock cadence remained active.
- Availability: the member availability service returned 15/15 matchup
  reports from the current official MLB 40-man roster fallback. The stale or
  implausible Playbook injury response was not displayed.
- Scheduled health: tracking, Daily Edge health, feature coverage, pregame
  sweep, lineup watch, season-stat bulk refresh, and the current split cycle
  had zero failed runs in the inspected window.

## Genuine intermittent defect

One 12:30Z split collection completed partial after a second writer committed
the same SharpAPI history identity between this writer's state read and retry.
The database correctly rejected the duplicate under
`market_split_observations_v2_sharp_history_source_uidx`; current data coverage
was not lost, and the next natural run completed successfully. The existing
code reconciled one such race, but a second race inside that single retry could
still surface a false cron warning.

The correction performs at most three upsert attempts. Before each of the two
bounded retries it reloads committed SharpAPI history identities and removes
only rows already stored by the competing writer. It never fabricates,
rewrites, regrades, or adds a provider call. Non-race errors still fail exactly
as before.

## Total accuracy boundary

The separate frozen r68-r70 tournament remains the model authority for this
incident. The active raw baseball Total is overweighted, and market anchoring
improves point error, but the causal residual, coherent direct-probability, and
movement/splits candidates failed chronological proper-score, direction,
bootstrap, weekly-stability, or slate-balance gates. Applied Total promotions,
demotions, side changes, probability changes, projection changes, and stake
changes remain zero.

This ingestion retry cannot be represented as a Total-model fix: it preserves
the same successfully committed Sharp history rows and only eliminates a false
partial status when a bounded concurrent-write race repeats.

## Validation

- `npx tsx scripts/test-market-intelligence-v2-shadow-sync.ts`: 26 passed.
- Current release coherence: ready, zero blockers.
- Current member-data contract: ready, zero blockers.
- Production writes during the audit: zero.

Rollback is removal of the bounded repeated-race loop. Production model
rollback authority remains r67 / v27 / v55 / v45.
