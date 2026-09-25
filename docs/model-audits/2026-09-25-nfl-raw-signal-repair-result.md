# NFL raw-signal repair result

Date: 2026-09-25

Release: `nfl_weekly_raw_signal_2026_09_25_r2_current_season_possession`

## Exact Weeks 1-2 diagnostic

The read-only replay used the latest immutable T-60 row for all 32 games and
only information available before each forecast week. Week 1 remains unchanged.
Week 2 receives final Week 1 team state.

| Metric | Published | Candidate |
| --- | ---: | ---: |
| Moneyline | 22/32 (68.75%) | 22/32 (68.75%) |
| Spread | 12/32 (37.50%) | 15/32 (46.88%) |
| Total | 13/32 (40.63%) | 15/32 (46.88%) |
| Team-score MAE | 8.4735 | 8.3959 |
| Margin MAE | 11.6612 | 11.5769 |
| Total MAE | 11.4566 | 11.3437 |

Week 2 alone moves Spread from 7/16 to 10/16 and Total from 6/16 to
8/16 while Moneyline remains 11/16. Pushes are excluded from resolved records.
The replay is diagnostic because these outcomes were already opened; prospective
tracking remains release- and lock-time separated.

## Exact Week 3 board replay

- Coverage remains 16 games / 48 markets.
- The one existing immutable T-60 game is preserved unchanged.
- Grade counts move 5 Best Angles / 7 Leans / 7 Watchlists / 29 No Plays to
  5 / 8 / 9 / 26.
- Actionables move 12 to 13.
- There are five tier promotions and two demotions.
- Side changes are Moneyline 0, Spread 0, Total 5.
- Total direction moves from 2 Over / 14 Under to 5 Over / 11 Under.
- Target exclusion is stable for 14 games; two games truthfully preserve the
  incumbent fallback.

This is not a quota-based board change. Every decision remains derived from the
single coherent distribution, target-excluded current market, exact-price gates,
and the existing grade policy.

## Runtime and rollback

The current-season state is one existing database read per writer cycle, with no
new provider request, per-game request, writer, cron, lease, stake, member copy,
label, or layout. A Week 2+ run fails before publication when the state is absent
or incomplete through the prior week, preserving the last coherent member
snapshot. Locked rows are never recomputed.

Roll back to the immediately preceding r19/r21/r28/r20 publication family on any
mixed current-slate release, current-season-state gap, locked-row mutation,
coherence failure, unexpected actionable collapse, timeout growth, or reader
failure. Retain all already-locked evidence unchanged.
