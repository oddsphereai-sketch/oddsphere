# NFL Daily Edge member integration — r12

Date: 2026-08-20  
Scope: local signed-in Daily Edge NFL path, current preseason rehearsal, and 2026 Regular Week 1 forward snapshot  
Production deployment, database writes, official grades, stakes, settlement, and lifetime tracking changed: **no**

## Completed vertical

The NFL product now has one end-to-end local path rather than a separate visual
prototype:

1. The checksum-frozen BALLDONTLIE schedule, two-sided FanDuel prices, injuries,
   and 32-team depth bundle remain the provider input.
2. `score_current_nfl_daily_edge.py` scores Regular Week 1 with the accepted
   market-reference architecture. Moneyline and spread stay at the no-vig
   reference because no independent margin challenger cleared its gate. Total
   alone receives the historically accepted capped quarterback/player-value
   residual.
3. `build-current-nfl-daily-edge-snapshot.ts` writes a checksum-pinned
   `DailyEdgeResponse` bundle containing all 16 games and all 48 markets.
4. `/lab/daily-edge?sport=nfl` reads that stored bundle locally and renders it
   through the existing signed-in Lab header and `ActualDailyEdgePreview`
   component. The dev-only football page is no longer required to judge the
   product.

## Verified current boards

- Current member pointer: real 2026 Preseason Week 2, LV at HOU through SEA at
  TEN, 16 games, 48 predictions.
- Current dry-run grade distribution: 5 Lean, 9 Watchlist, 34 No Play, 0
  Caution, 0 Best Angle.
- Same-book stored Opening trail: 16/16 games with at least three observations
  per game.
- Current preseason injuries render in the reader; HOU quarterback Graham
  Mertz is correctly shown as Out in the opening game snapshot.
- Regular Week 1: 16 games, 48 predictions, all 32 expected QB1 identities
  matched historical state.
- Regular total correction: -0.216 to +0.528 points, 0.204 mean absolute
  adjustment. Margin, moneyline, and spread receive zero model correction.

## Interaction verification

The signed-in local member route was opened in the product browser. The
existing Oddsphere Lab header remained intact. Expanding LV at HOU created the
canonical URL with `game=nfl-1393564&market=moneyline`; switching Total and
Spread updated the URL and retained odds movement, market price, key stats, and
injuries. Selecting CAR at JAX changed the game id while keeping the full reader
open.

## Evidence boundary

Playbook still provides complete 2026 regular-season consensus lines and public
splits, but no preseason rows. SharpAPI supplies named-book current prices and
no NFL split rows. Those lanes are not fabricated or mislabeled. The current
preseason reader therefore states that public/source-book splits are
unavailable. Their eventual regular-season grade impact remains separately
gated.

## Tracking boundary

Preseason remains permanently excluded. The stored Regular Week 1 board is
also non-actionable and non-tracking until an explicit launch-approved decision
release is locked before kickoff. When that occurs, settlement must append to
the existing NFL lifetime record; it must not create a new baseline.
