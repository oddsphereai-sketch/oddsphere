# NBA complete line-board pagination

Date: 2026-10-19
Status: candidate replay verified; production verification pending
Base: `77add5e8bb69fc4f370539cf99ad15cc3643f9b8`

## Scope and frozen correction

- Candidate model: `nba_professional_unified_2026_10_19_r8_complete_line_board`.
- Candidate market marriage: `nba_market_marriage_2026_10_19_r8_complete_line_board`.
- Candidate refresh: `nba_daily_refresh_schedule_2026_10_19_r9_complete_line_board`.
- Grade policy, point projection, categorical market-reader qualification, exact executable-line
  selection, stake policy, sole writer, lease, cadence, tracking boundary, and locks are unchanged.
- Both NBA current-line reads must use `loadCompleteCurrentGameLines`, ordered by stable row ID in
  500-row pages, restricted to game-level Moneyline, Spread, and Total rows, with an explicit 10,000-row
  fail-closed cap.

## Production finding

After r7 deployed, the authoritative 23:22Z intraday refresh completed successfully at 23:25Z with
2,680 records updated. Current storage then held complete prices for all three target games:

- Utah-Memphis: 118 rows (40 Moneyline, 38 Spread, 40 Total).
- Phoenix-Portland: 118 rows (40 Moneyline, 38 Spread, 40 Total).
- Sacramento-LA Clippers: 96 rows (32 per market).

The live 7:25 PM member snapshot nevertheless showed all six Phoenix and Sacramento market decisions
without a line or price. A same-input direct pipeline replay reproduced the omission. Both
`featureSnapshot.ts` and `buildNbaDailyEdgeAdapted.ts` issued one unpaginated `lines` query across the
slate; the response stopped at 1,000 rows, before the final two game IDs. This is a reader completeness
failure, not provider or ingestion unavailability.

## Baseline

- October 21: 11 games / 33 markets; 4 Best Angles, 1 Lean, 22 Watchlists, and 6 No Market.
- The six No-Market rows were exactly Phoenix-Portland and Sacramento-Clippers Moneyline, Spread, and
  Total.
- The rolling seven-day member board showed 43 games / 129 predictions; 4 Best Angles, 2 Leans,
  16 Watchlists, 2 Cautions, and 27 No Plays.

## Required result evidence

- Same-input October 21 and rolling-board counts, newly visible exact price tuples, pick changes,
  promotions, demotions, and expected-return checks.
- Pagination regression covering more than 1,000 current rows plus a saturation test proving that the
  reader fails closed instead of publishing a partial board.
- Focused NBA model, market-reader, site-wiring, lock, T-60, and rolling-board tests; TypeScript;
  `npm run verify:model-change`; latest-main integration safety; and protected PR checks.
- Post-deploy live proof of r8/r9 coherence, complete prices for Phoenix-Portland and
  Sacramento-Clippers, a healthy authoritative refresh, and unchanged locked payload precedence.

## Candidate result

The deployed r7 reader and the r8 candidate were replayed against the same completed 23:25Z current
line board. R7 produced 4 Best Angles, 1 Lean, 22 Watchlists, and 6 No Market rows. R8 produced 5 Best
Angles, 2 Leans, 26 Watchlists, and zero No Market rows. The complete promotion ledger is:

- Phoenix +3.5 at -101 (SX Bet): No Market to Best Angle. The 60% line-specific probability clears
  both the exact-price break-even point and the existing Spread lane; no threshold changed.
- LA Clippers Moneyline at -163 (Novig): No Market to Lean. The independent winner probability is
  63.9%, above the 62.0% exact-price break-even point; no threshold changed.

The other four recovered rows are Watchlists: Portland Moneyline -153, Phoenix-Portland Under 233.5
at -101, Clippers -4.5 at -102, and Sacramento-Clippers Over 228.5 at -104. Complete pagination also
changes Utah-Memphis Moneyline and Spread from MEM to UTAH at Watchlist because r7 had evaluated a
partial sportsbook set; the Total remains Under 242.5. There are two actionable promotions, zero
actionable demotions, and zero nonpositive-EV promotions. No game outside the rows whose price input
was absent or partial changes actionable status.

The generic pagination regression retrieves 1,329 rows across three deterministic pages and rejects
a saturated 1,000-row cap. NBA site-wiring tests prove that both the feature snapshot and member
intelligence paths call that tested complete reader. Feature, site-wiring, rolling-board, and strict
TypeScript checks pass before the full release gate.
