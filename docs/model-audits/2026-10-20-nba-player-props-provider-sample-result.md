# NBA player props provider sample — result

Date: 2026-10-20
Mode: read-only aggregate coverage
Production writes: none

## Result

A bounded two-request BALLDONTLIE audit fetched the October 20 regular-season
schedule and one game's complete current player-prop response. The schedule had
three games. The sampled game returned:

- 2,364 raw provider offers;
- 2,659 normalized sides;
- 21 provider player identities;
- 15 recognized market families;
- eight sportsbooks;
- 380 complete same-book, same-player, same-market, same-line Over/Under pairs;
- 2,048 normalized rows in the eight-market foundation family; and
- zero invalid provider timestamps.

The eight books were Bally Bet, BetParx, BetRivers, Betway, Caesars, DraftKings,
Fanatics and FanDuel. The sample included Points, Rebounds, Assists, Threes,
Points + Rebounds, Points + Assists, Rebounds + Assists, PRA, Blocks, Steals,
Double-Double, Triple-Double and first-quarter variants.

## Interpretation

The existing BALLDONTLIE NBA subscription is sufficient to establish a broad
current-board primary source without buying another provider. One response per
game is materially more efficient than a player- or market-scoped collector.

The sample does not validate model accuracy, canonical player names, opening
coverage, late-scratch handling, historical replay, sharp-book authority, or
all-slate continuity. Those remain explicit launch gates. The Odds API remains
a bounded reference/gap and historical source, not a replacement full-board
poller.
