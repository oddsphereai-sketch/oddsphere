# NBA rolling Daily Edge activation — 2026-10-16

## Owner direction and defect

Daniel Mengel reported that the live NBA tab did not look or behave like Daily Edge: it was labeled
`Schedule live`, rendered bespoke schedule placeholders, exposed no reader, and had no clickable
predictions. He explicitly directed Oddsphere to make NBA active and operational rather than leave the
already validated model hidden until game day.

## Declared scope

- Sport and markets: NBA Moneyline, Spread, and Total.
- Champion model: `nba_professional_unified_2026_10_15_r2_portable_ridge` (unchanged).
- Market marriage: `nba_market_marriage_2026_10_15_r2_unified_25_75` (unchanged).
- Grade policy: `nba_grade_policy_2026_10_15_r2_calibrated_residual_exact_price` (unchanged).
- Member board: `nba_rolling_member_board_2026_10_16_r2_analyzed_predictions`.
- Eligibility: `nba_member_board_window_2026_10_16_r3_rolling_analysis`.
- Operational refresh: `nba_daily_refresh_schedule_2026_10_16_r7_rolling_predictions`.
- Sole writer and lease: the existing `nba-daily-refresh` path under `prediction_pipeline:nba`.
- Lock and official record boundary: unchanged T-60 atomic three-market lock, no official row before
  October 20, and no historical Spread backfill.

## Change contract

The date-keyed current NBA snapshot now analyzes every officially eligible game in its seven-day
schedule window and combines those games into the existing shared `DailyEdgeResponse`. The normal Daily
Edge card, collapsed reader, full reader, market strip, score projection, model/market comparison, and
price evidence therefore work without an NBA-only duplicate UI.

The schedule remains authoritative for event identity and lifecycle. Final and canceled games are not
resurrected. A partial analyzed board is forbidden: if an eligible official schedule game does not
produce one champion-pipeline game, the incoming snapshot fails and the last coherent published board
remains authoritative. Preseason/offseason dates and dates outside the seven-day window remain
ineligible.

The read path performs no prediction-record write and cannot lock, settle, backfill, or mutate a public
record. Existing locked payload precedence is unchanged. Full daily refreshes collect lines for every
seeded date containing games; intraday line work is bounded to the two nearest active game dates while
schedule seeding retains its existing current/far-edge scope. No new cron, writer, provider, or lease is
introduced.

## Pre-publication evidence required

- Credential-backed zero-write assembly of the live rolling window, with exact game and market counts,
  one coherent r2 release, complete schedule-to-analysis identity coverage, and page-reader interaction.
- Before/after board report. The predecessor has zero analyzed NBA cards. Promotions are the analyzed
  markets newly exposed by the owner-directed activation; demotions and removed games must be zero.
- Focused NBA rolling, tracking-boundary, card/reader, cron, lock, immutable-snapshot, and professional
  runtime tests plus `npm run verify:model-change`.
- Latest-main integration safety, protected pull request checks, exact-commit deployment, production
  snapshot refresh, and live proof that NBA is Active and predictions open the shared reader.

## Rollback

Revert the member-board, eligibility, and r7 refresh release together if coverage is partial, the page
mixes model releases, the reader disagrees with the generated game tuple, request time exceeds the
bounded publication budget, a second writer or lease appears, or any stored locked payload changes.
Rollback restores the October 15 schedule-only member board without altering model r2 or historical
records.
