# NBA/NHL scheduled refresh recovery result

Date: 2026-09-21

## Outcome

The candidate restores one bounded daily invocation for each existing offseason-safe refresh route:

- NBA: `/api/cron/nba-daily-refresh` at `30 13 * * *`, stamped `nba_daily_refresh_schedule_2026_09_21_r1`.
- NHL: `/api/cron/nhl-daily-refresh` at `45 13 * * *`, stamped `nhl_daily_refresh_schedule_2026_09_21_r1`.

Both routes remain fail closed behind their existing exact environment gates. On the September 21 slate, the production-backed readiness audit found zero NBA games and zero NHL games. The routes therefore exit after public schedule discovery before paid odds retrieval or prediction work. There are zero promotions, zero demotions, zero model-output changes, and zero board-count changes.

This is an operational continuity repair only. It is not evidence that the NBA or NHL model changed, and it is not part of the cross-sport model-plus-market accuracy audit.

## Verification

- `npm run test:refresh-cycle-crons`: passed.
- `npm run verify:model-change`: passed, including all current MLB, WNBA, NFL, CFB, UCL, player-prop, tracking, lease, and reader contracts.
- `npx tsc --noEmit`: passed.
- Focused ESLint on both routes and the schedule contract: passed.
- `npx next build --webpack`: passed under Next.js 16.2.6.
- Production-backed site-stability candidate audit: MLB, NBA, and NHL `TRUSTED`; no high-severity or warning findings.
- `audit-all-model-readiness --date=2026-09-21`: NBA and NHL each reported zero games and zero predictions; MLB remained complete at 9/9 expected predictions and WNBA remained complete at 6/6.

## Load and rollback

The schedule adds at most two public schedule-discovery requests per day. With no games, it performs no SharpAPI odds request and writes no predictions. When a season resumes, the existing gates, bounded route, and established writer/lease behavior remain authoritative.

Rollback removes the two `vercel.json` schedule entries. No historical prediction or tracking row is rewritten.
