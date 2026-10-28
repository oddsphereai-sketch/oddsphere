# CBB continued accuracy research: r3/r4 and opening-Total benchmark

## Decision

Continue using the private r2 preview. Do not activate CBB, change the preview
to r3, or change any live sport. New experiments and a real-line comparison
are retained, not presented as a major predictive breakthrough.

## Independent score experiments

The existing r2 was 4,112–1,609 (71.88%) across 5,721 already-opened 2025-season
games, with margin MAE 9.2789 and Total MAE 13.6378. The r3 shot-profile
experiment added two-point accuracy, three-point accuracy/share, free throws,
opponent shooting/rebounding/turnovers, recent form and variation. Eight
predeclared heads were trained on 2023 and selected on 2024. The selected
Huber/10 head gave 4,136–1,585 (72.30%), margin 9.2314 and Total 13.6016 on
the opened diagnostic. Winner corrections were 188 versus 164 harms.

This is weak incremental evidence, not a proven improvement: paired
calendar-date bootstrap 95% intervals all include zero (margin MAE delta
[-0.0955, +0.0017], Total [-0.0948, +0.0174], winner accuracy
[-0.00247, +0.01074]). The 2025 cohort is not an untouched holdout.

The r4 experiment fixed the r3 head and tested rating memories of 30, 60 and
120 days. None passed the predeclared simultaneous selection criteria. The
120-day option improved margin MAE but slightly worsened Total MAE on selection;
it was not opened on 2025 or selected after seeing those outcomes.

Full candidate metrics: `lib/cbb/artifacts/research-r3-r4.json`.

## A real betting-line comparison, not just score error

The earlier four-date provider probe recovered 78 opening quotes across ten
games and zero historical current quotes. The next capture selected eight
Saturdays by calendar before inspecting results: February 7/14/21/28 and
March 7/14/21/28, 2026 (UTC game dates). It returned 4,619 rows in 47 requests.
Subsequent replays use the saved cache and make zero further provider calls.

One complete two-sided Total was selected per accepted game using a fixed
DraftKings, FanDuel, BetMGM, Caesars preference, without choosing the most
favorable line. Exact game IDs, half-point/integer line validity, paired prices,
plausible hold and provider-reported pregame opening timestamps were required.
Ten post-start/invalid-time quotes and nine incomplete pairs were rejected.
Non-selected books and unmatched accepted games were also excluded and counted.
Total is invariant to the home/away orientation issue, so this does not certify
historical Moneyline/Spread orientation.

Ratings and all matchup inputs were recomputed at each selected opening
timestamp. No current-season result starting less than six hours before that
timestamp could enter. Previous-season ratings and learned heads remained
strictly earlier-season. We did not compare later-informed forecasts with an
earlier opening line.

| Exact same 635 games | Opening sportsbook Total | Private r2 | Experimental r3 |
| --- | ---: | ---: | ---: |
| Total MAE | 13.5291 | 13.4474 | 13.4543 |
| Over/under W–L–P | Not a directional pick | 341–294–0 | 329–306–0 |
| Direction accuracy | — | 53.70% | 51.81% |
| Hypothetical one-unit-risked replay | — | +14.94u | -8.04u |

These are opening prices, not closing lines or a market-movement reader.
The replay forces a direction on every game, not the site's eventual grades,
stakes or Best Angles. Units use each selected offer's actual side price and
are hypothetical, not live locked tracking or a promised return. Eight dates
and an already-opened season do not establish a durable betting edge.

The experimental r3 Total flips corrected 68 r2 losses but harmed 80 r2 wins.
That is why slightly better full-season score averages do not qualify r3 for
the preview. This also answers the owner's central concern: score error must
be tested alongside exact-line consequences, not optimized in isolation.

All 635 selected quote IDs, prices, timestamps, predictions and results remain
in `/private/tmp/oddsphere-cbb-data/opening-total-benchmark-report.json`.
The committed summary records its SHA-256 and the original raw-capture hash:
`lib/cbb/artifacts/opening-total-benchmark.json`.

## Interpretation and remaining work

The measured 13–14 point Total MAE alone does not establish a broken model:
the actual sportsbook openers missed by approximately the same amount on this
matched sample. It also does not establish that we beat closing markets.
The requested under-6 margin / under-10 Total remain aspirations, not promises.
A different, much older peer-reviewed sample reports closing-spread MAE 8.36
over 25,574 games; it is context, not a same-cohort benchmark or a lower bound.
Source: https://www.jvlone.com/sportsdocs/GamblingBasketbal2013.pdf, Table 3.

The product is still prelaunch. Actual current-market interpretation,
availability/roster qualification, grade calibration and eventual member
presentation remain separate uncompleted activation requirements. Opening
snapshots do not prove intermediate movement, leadership or sharp money, and
no such information was invented for these tests. Larger gains require useful
new pregame information or a better learned representation, not an insistence
that the same outcome be predictable within an arbitrary point target.

## Verification and operational impact

All three focused CBB suites passed, including six-hour chronology, exclusion
of current/future box scores, shot-profile sensitivity, serialization, common
score/probability/Spread identity, immutable existing artifacts and disabled
publication. TypeScript and lint passed. Full `npm run verify:model-change`
passed; optional PostgreSQL proof remained skipped because its test URL was
unset. It is not needed for these database-free research scripts.

Production writes, cron changes, lease changes, promotions/demotions, live
board-count changes, locked-record mutations and preview changes are all zero.
