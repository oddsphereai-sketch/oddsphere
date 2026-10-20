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

## Validation-path audit

The original 45-game/15-game replay was necessary but not sufficient because it
did not select competing models on a window separate from confirmation. The
reproducible tournament now uses the same immutable source capture with:

- 36 chronological development games;
- 12 later candidate-selection games;
- 12 still-later untouched confirmation games;
- eight independent candidates spanning the research ridge, a two-stage
  conditional-minutes regression, three minutes horizons, and three
  partial-pooling variants;
- zero provider calls on a cached rerun and the same immutable-input SHA.

The first simple recent-form and partial-pooling alternatives did not pass
confirmation. A later structural candidate replaced the weighted-average
minutes estimate with a chronological conditional-minutes regression using
recent/season minutes, role volatility, participation, rest, home/away,
back-to-back state, player history, and team-change context while leaving the
stat-rate engine unchanged.

That two-stage candidate produced the first repeatable improvement across both
selection and untouched confirmation:

| Market | Selection: ridge → candidate | Confirmation: ridge → candidate | Status |
|---|---|---|---|
| Points | MAE 6.77 → 6.32; hit 48.4% → 51.6% | MAE 5.95 → 5.52; hit 52.9% → 56.3% | Promising; second window required |
| PRA | MAE 8.89 → 8.15; hit 46.2% → 54.5% | MAE 8.15 → 7.31; hit 51.0% → 51.9% | Promising; second window required |
| Points + rebounds | MAE 8.16 → 7.55; hit 47.4% → 53.8% | MAE 7.20 → 6.48; hit 53.2% → 56.4% | Promising; second window required |
| Points + assists | MAE 7.43 → 6.85; hit 48.9% → 56.0% | MAE 7.02 → 6.44; hit 43.8% → 42.7% | Projection gain only; direction not qualified |

It failed confirmation for Assists and Rebounds + Assists. The selected simple
Rebounds candidate improved MAE by 5.0% but reduced direction by 6.4 points, and
the selected Threes candidate worsened MAE without a direction gain. Therefore
no model is accepted for production yet. The two-stage architecture is retained
as the next candidate rather than discarded, while each weak market continues
through its own structural model.

The same two-stage minutes candidate was then replayed across five rolling
chronological blocks. It beat the ridge on MAE without losing more than two
direction points in 4/5 Points blocks, 4/5 Points + Assists blocks, 3/5 PRA
blocks, and 3/5 Points + Rebounds blocks. Points direction improved in every
block, including 50.6% to 60.2%, 52.0% to 53.3%, 46.9% to 50.0%, 53.5% to
56.3%, and 43.8% to 50.0%. This is meaningful stability evidence for the
two-stage architecture, but it still comes from one late-season cached span and
does not contain the early-season role changes needed for launch qualification.

Five rolling-origin blocks also show that the current independent model is not
stable enough to validate:

| Market | Direction range | Projection-MAE range |
|---|---:|---:|
| Points | 43.8%–53.5% | 4.64–6.93 |
| Rebounds | 52.0%–80.0% | 1.78–2.43 |
| Assists | 39.5%–66.1% | 1.25–2.09 |
| Threes | 45.0%–52.9% | 0.85–1.18 |
| Points + rebounds + assists | 42.0%–52.0% | 6.45–8.95 |
| Points + rebounds | 39.5%–58.2% | 5.65–8.18 |
| Points + assists | 41.1%–57.4% | 5.42–7.63 |
| Rebounds + assists | 44.4%–56.9% | 2.66–3.47 |

The error decomposition identifies two separate independent-model defects. The
conditional-minutes forecast misses by 5.44 minutes on average. Perfect minutes
would reduce Points MAE from 5.70 to 4.48 and PRA MAE from 7.74 to 5.55, so
availability and role are material. But those remaining errors are still too
large: the stat-rate models also require replacement rather than cosmetic
calibration.

Opening-market evidence is not a stable substitute. On untouched confirmation,
the de-vigged opening market beat the independent side for Assists (67.9% versus
42.9%) and Points + Assists (58.4% versus 43.8%). On the immediately preceding
selection window, however, the same opening evidence lost to the independent
side for Assists (52.9% versus 55.5%) and was essentially tied for Points +
Assists (48.2% versus 48.9%). A rule chosen from the confirmation result would
be hindsight leakage. Timestamped movement and lock-time evidence are still
required before a market-reader rule can qualify.

## Expanded weak-market qualification

The weak-market audit was expanded without another provider request. The same
immutable cache now emits a 360-game conditional-on-appearance projection
population with 5,581 point-in-time player rows. Selection uses 72 later games
and 1,164 rows; confirmation remains untouched until candidate choice and uses
72 still-later games and 1,018 rows. A player enters this projection population
only from pregame history: at least three prior appearances and at least 12
recent minutes. The closing box score supplies the target and participant
identity only; it is never a feature.

The structural fix adds 20-game and season-to-date component rates. Rebounds
are estimated from minutes, rebound opportunities, capture, pace, and team and
opponent rebounding context. Assists retain the stronger two-stage minutes/rate
forecast and use market arbitration after the independent center. Threes use
attempt volume, stabilized conversion, team shot mix, and opponent perimeter
context. Rebounds + Assists is the sum of the component forecasts rather than
an independently fitted shortcut.

Market arbitration is downstream. It never averages the projection toward the
line. When qualified evidence disagrees, it may reflect the independent
distance across the canonical line so the final center and side remain
coherent. Opening-only candidates are selected on the earlier selection window
and six rolling pre-confirmation blocks; the untouched confirmation result is
reported afterward.

| Market | Pre-confirmation candidate | Selection hit | Untouched confirmation hit | Rolling support | Projection result |
|---|---|---:|---:|---:|---|
| Rebounds | opportunity model + 5 pp market disagreement | 52.7% (131) | 63.8% (69) | 4/6 before confirmation; 5/5 full rolling blocks | Confirmation MAE 2.13 versus 2.18 ridge |
| Assists | two-stage model + 2 pp market disagreement | 56.0% (100) | 60.8% (51) | 5/6 before confirmation; 4/5 full rolling blocks | Confirmation MAE 1.65 versus 1.65 ridge; direction is the material gain |
| Threes | long-horizon opportunity model + 5 pp market disagreement | 56.0% (100) | 53.3% (60) | 6/6 before confirmation; 3/5 full rolling blocks | Selection MAE 0.954 versus 0.970 ridge; confirmation MAE is effectively tied |
| Rebounds + Assists | component sum + opening-market arbitration | 53.8% (119) | 55.0% (80) | 4/5 full rolling blocks | Confirmation MAE 3.06 versus 3.14 ridge |

These four candidates are qualified for the next market-path and grade stage;
they are not production-qualified releases. Threes is the narrowest pass and
must not receive broad actionability merely because it cleared 50%. The
remaining launch gates are timestamped movement, predictive-distribution
calibration, price/ROI grades, board-count impact, settlement, and live
operational validation. No route, member row, prediction, grade, stake, lock,
writer, or schedule changed during this work.

### Current pathway status

| Gate | Status | What remains |
|---|---|---|
| Immutable historical dataset | Passed for the pilot | Add independent early-, mid-, and late-season windows |
| Reproducible offline replay | Passed | Retain cache SHA and release identity for every future run |
| Independent model tournament | Passed for Rebounds; provisional for Assists, Threes, and Rebounds + Assists | Preserve the pre-confirmation choices and add an independent season/window |
| Projection stability | Passed for the expanded target-market candidates | Threes remains the narrowest pass and needs the movement/grade gate |
| Distribution calibration | Not tested | Fit predictive distributions and test interval coverage/Brier/log loss |
| Market-reading marriage | Opening-only candidates passed | Capture target-excluded T-180/T-60/T-15/lock snapshots and validate movement |
| Grade/ROI calibration | Not tested | Run only after the final forecast qualifies; report board counts and prices |
| Settlement/private tracking | Private append-only contract built; runtime capture not yet enabled | Connect it only to the future sole authoritative observer, then prove DNP, void, overtime, and stat-correction handling |
| Production launch | Blocked | All preceding gates must pass on one release-pure candidate |

The next independent-model candidate must therefore be structural, not another
single coefficient change: participation and minutes by lineup/availability
state; Points from shot and free-throw opportunity plus efficiency; Rebounds
from rebound chances and expected misses; Assists from touches, passes,
potential assists and teammate conversion; Threes from attempt volume and make
probability; and combination markets from one correlated simulation. That model
is selected without seeing confirmation, after which the market reader and
grades receive their own later windows.

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

## Private forward scorecard

The research branch now contains an internal-only, append-only NBA player-prop
tracking contract. It retains the first exact locked game/player/market/line/
side/book tuple and rejects later attempts to reinterpret it. Each row stores
the independent projection and probability separately from the final married
projection and probability, plus the canonical line, real price, grade,
movement classification, and complete release tuple. Official outcomes can be
scored through the existing private player-prop diagnostics to report point
error, hit rate, probability calibration, exact-price ROI, favorable-line
cushions, and Market Reader corrections versus harms by market and release.

This does not add a public route, Tracking-page row, member copy, scheduled
job, provider request, grade, or prediction. Runtime capture remains disabled
until one authoritative NBA props observer exists; attaching a second writer
just to collect research would violate the single-writer safety boundary.
