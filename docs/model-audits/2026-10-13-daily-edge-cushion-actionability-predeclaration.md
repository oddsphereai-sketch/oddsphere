# Daily Edge cushion and actionability audit — 2026-10-13

## Objective

Use the newly available alternate-line result curves to diagnose forecast error across every Daily Edge sport without treating a favorable cushion as a winning main-line bet. Separately repair two exact-price presentation defects discovered on the current football boards.

## External benchmark supplied by the owner

The competitor screenshots are a competitive floor, not a directly comparable backtest. Before a comparison is called valid, OddSphere and the external sheet must use the same date range, market definition, push treatment, locked-time line, selection denominator, and price convention.

| Sport | Main ML | Main spread/run/puck | First cushion | Second cushion | Main total | First cushion | Second cushion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| NFL | 41/64 (64.1%) | 37/62 (59.7%) | +3: 41/63 (65.1%) | +6: 46/63 (73.0%) | 32/64 (50.0%) | +3: 36/64 (56.3%) | +6: 39/64 (60.9%) |
| CFB | 372/448 (83.0%) | 221/440 (50.2%) | +3: 251/445 (56.4%) | +6: 285/445 (64.0%) | 213/448 (47.5%) | +3: 245/448 (54.7%) | +6: 282/448 (62.9%) |
| MLB | 1366/2447 (56%) | 1330/2447 (54%) | +1: 1626/2447 (66%) | +2: 1762/2447 (72%) | 1192/2375 (50%) | +1: 1406/2361 (60%) | +2: 1635/2382 (69%) |
| NHL | 52/86 (60.5%) | 49/86 (57.0%) | +1: 61/86 (70.9%) | +2: 75/86 (87.2%) | 44/86 (51.2%) | +1: 64/86 (74.4%) | +2: 70/86 (81.4%) |

Accuracy and exact-price ROI remain separate acceptance axes. A model may beat an accuracy percentage while losing money through price, or show a strong cushion curve while missing the main line too often.

## Release-separated audit contract

`scripts/operator/audit-daily-edge-cushion-curves.ts` is SELECT-only and applies the public tracking eligibility, deduplication, and complete-UCL-cohort rules. It reports, by exact model/calibration release and market:

- main-line W-L-push, calibration, units and ROI;
- actionable labels versus executable bets (`no_bet` rows are separated);
- exact-price bands and negative-EV exposure;
- signed line error, first/second cushion recovery, and hard misses;
- final versus independent score MAE and bias where the locked payload stores both.

The cushion curve is diagnostic. It may justify investigating a projection center, uncertainty distribution, or grade boundary; it cannot by itself authorize a production threshold change.

## Football candidate declared before publication

### CFB

- Scope: future unlocked grades only. Forecast sides, probabilities, expected scores, prices, market reading, stakes, locks, and tracking outcomes are unchanged.
- Rule: a Lean or Best Angle requires positive model-minus-target-excluded-market probability and nonnegative expected value at the evaluated exact price, whether the quote is currently labeled Bet or Shop.
- Missing injury reports, absent public/sharp splits, and partial contextual feeds remain neutral. They do not automatically force No Play.
- Paired promotion path: the existing positive-value, resistance-free Lean promotion and the positive-value market-confirmed favorite Lean remain available and are unit-tested.
- Current-board impact at 2026-10-13 12:09Z: visible actionable labels 91 to 55; Best Angle 18 to 16; Lean 73 to 39; Watchlist 58 to 94; No Play stays 148. All 36 changed labels were already `Shop / no_bet`; executable actionables remain 55 to 55. Side, probability, score, and price changes are zero.
- Immediate previous r49/r27/r37 locked payloads retain exact reader and recovery precedence.

### NFL

- Scope: future unlocked Moneyline grade tier only. Forecast sides, probabilities, expected scores, prices, market reading, stakes, locks, and tracking outcomes are unchanged.
- Rule: a Moneyline price below -200 cannot be Best Angle. A positive-value selection can remain Lean.
- Current-board impact at 2026-10-13 12:10Z: 22 Best Angles / 3 Leans becomes 20 / 5; total actionables remain 25. Baltimore -225 and Buffalo -275 move from Best Angle to Lean. Promotions, actionable demotions, side changes, probability changes, and score changes are zero.
- The existing r34 snapshot reader explicitly tries the new decision key and then the preceding r32 decision key; the live preceding snapshot remained readable during the candidate audit.

## Initial sport findings and gates

- NHL r17, 24 settled games: Moneyline 13-11; puck line 13-11; Total 14-10. The 15 actionable Totals are 7-8 and 12 carry negative stored exact-price EV. This is a model-specific price/grade defect candidate and requires an NHL replay before any live change.
- MLB v37: only four settled games (11 market rows) exist under the exact active calibration. No production inference is permitted from that sample.
- WNBA v1.7: no settled current-release rows yet. The immediately preceding v1.6 release has only four settled games (12 markets). No production inference is permitted from that sample.
- EPL r19/v25: nine settled games (36 markets); Match Result is 3-6 with zero actionables, Total and BTTS actionables are each 2-1. This is too small for a release change and remains an explicit loss/board audit.
- UCL r7 has no settled rows admitted by the current release-pure tracking query in this run; the existing documented locked-forward audit remains the evidence until the data boundary is reconciled.

## Publication gates

The football candidate may ship only after focused tests, the full model-change verification suite, clean latest-main integration, immutable-reader tests, current-board impact reproduction, and live release/cron/reader verification. NHL, MLB, WNBA, EPL, and UCL remain audit-only unless their own sport-specific chronological replay passes the same gates.
