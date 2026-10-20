# NBA Player Props: Historical Pilot and Reader Design

Date: 2026-10-20  
Status: offline research only; not approved for production

## Scope

This package designs the NBA player-props ingestion, point-in-time independent
model, market-evidence seam, chronological replay, and member-reader contract.
It does not add an NBA navigation pill, route, cron, database writer, lock job,
grade, stake, or member-facing row.

## Genuine historical pilot

The bounded 2025-season pilot used:

- 60 evenly spaced evaluation games across a 360-game span;
- 240 warmup games and every intervening game, so histories remain complete;
- 60 of 60 games with archived opening props;
- 60,655 archived opening observations from ten sportsbooks;
- 21,195 official player box-score rows and 15,762 advanced-stat rows;
- 1,174 chronological development rows and 150 later untouched confirmation rows;
- 459 total provider requests, below the hard 500-request ceiling;
- zero database, member, grade, stake, lock, or production writes.

The confirmation window was April 2 through April 13, 2026. Results are
release-pure and are not blended with current production performance.

| Market | Gradable sides | Projection MAE | Direction hit rate | Opening-market diagnostic |
|---|---:|---:|---:|---:|
| Points | 128 | 6.21 | 52.3% | 53.9% |
| Rebounds | 119 | 1.94 | 62.2% | 54.6% |
| Assists | 89 | 1.81 | 47.2% | 59.6% |
| Threes | 95 | 1.05 | 50.5% | 53.7% |
| Points + rebounds + assists | 145 | 8.45 | 49.0% | 51.7% |
| Points + rebounds | 135 | 7.43 | 54.8% | 45.9% |
| Points + assists | 126 | 7.27 | 46.8% | 61.1% |
| Rebounds + assists | 125 | 3.06 | 54.4% | 52.8% |

The matchup-context release improved projection error for seven of eight
markets and improved rebound direction from 60.5% to 62.2%. It did not make
points, assists, threes, PRA, or PA sufficiently reliable for launch. The
correct conclusion is to retain the stronger feature foundation and continue
model development, not to publish weak grades or flatten a member board.

The archived opening-market baseline also materially outperformed the current
independent side for assists and points+assists. That is evidence for a
market-specific arbitration layer; it is not evidence for copying the market or
anchoring every projection to the line. Opening observations cannot validate
same-book movement, so flips, confirmations, promotions, demotions, and grades
remain unfit until point-in-time current snapshots are replayed on a later
untouched window.

## Reader contract

The proposed reader uses the existing `PlayerPropReaderDialog` shell and visual
language. It does not introduce a separate NBA-looking product.

Every market keeps the same decision hierarchy:

1. exact selection, canonical line, best genuine price, sportsbook, and grade;
2. one coherent projection versus that line;
3. independent-model, market-consensus, and final-decision comparison;
4. market-specific role, production, and opponent inputs actually used;
5. exact-price ladder at the same line;
6. same-book opening/prior/current movement only when stored;
7. decision status and lock provenance.

Evidence changes by market:

- Points: minutes, usage, points/FGA/3PA/FTA per minute, true shooting, pace,
  team offense, opponent defense, and opponent eFG allowed.
- Rebounds: minutes, rebounds and rebound chances per minute, pace, team
  offensive-rebound rate, opponent defensive-rebound rate, and opponent rebound
  chances.
- Assists: minutes, assists/touches/passes per minute, assist rate, pace, team
  assist environment, opponent deflections, and opponent defense.
- Threes: minutes, threes and attempts per minute, shooting efficiency, pace,
  team three-point attempt share, and opponent perimeter context.
- Combination markets: the relevant component sections are combined and
  deduplicated; the forecast uses the empirical joint residual distribution.

The contract omits missing values. It never fabricates a matchup statistic,
opening quote, movement trail, price, grade, or probability merely to fill a
panel.

## Required next validation before release

1. Retain timestamped opening, prior, current, and lock snapshots for a bounded
   historical subset using the same source hierarchy intended for production.
2. Split development, arbitration selection, calibration, and confirmation by
   game time, not by random prop rows.
3. Improve the weak market-specific independent models, especially minutes,
   assists, threes, and combination dependence.
4. Select market-reading candidates only on the arbitration window, then test
   nudges, confirmations, resistance, and flips on untouched confirmation.
5. Calibrate play grades by market and price; pair every demotion with tested
   promotions and report board counts.
6. Exercise mobile and desktop reader states with genuine payloads, including
   missing movement and locked legacy records.
7. Only after those gates pass: create the one authoritative writer/lease,
   release identifiers, lock tests, health checks, and an explicit deployment
   PR.

