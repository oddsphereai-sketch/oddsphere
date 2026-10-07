# NHL complete multibook market ingestion r15

## Scope and authority

- Sport: NHL regular-season Daily Edge.
- Markets: full-game Moneyline, Total goals, and puck line.
- Authoritative writer: the existing NHL prediction writer under the existing
  `prediction_pipeline:nhl` lease.
- Model / calibration / decision:
  `nhl_regular_2026_r15_complete_multibook_market_ingestion`,
  `nhl_regular_calibration_2026_r15_complete_multibook_market_ingestion`, and
  `nhl_regular_decision_2026_r15_complete_multibook_market_ingestion`.
- Collector / refresh:
  `nhl_sharp_odds_collector_2026_10_07_r3_complete_market_scopes` and
  `nhl_daily_refresh_schedule_2026_10_07_r8_complete_multibook_market_ingestion`.
- Preceding release: r14 best-angle calibration. Its locked rows remain immutable.

## Confirmed defect

The generic SharpAPI event response was capped and interleaved with player
markets. It returned one Bally Bet Moneyline and Total pair, so the prior
presence check incorrectly treated those markets as complete and did not request
their exact scopes. Exact-event market endpoints proved that 18–20 coherent
named books were available for every full-game market.

## Repair

Each exact NHL event now performs three bounded, concurrent full-game requests:
Moneyline, puck line, and Total goals. Rows are deduplicated before the existing
canonical line-board logic. Canonicalization also requires a coherent two-way
implied-probability sum from 0.94 through 1.20; this excludes regulation/three-way
or malformed pairs mislabeled as a two-way full-game Moneyline without banning
valid sharp, retail, exchange, or large-favorite prices.

This is three requests per event. On the affected slate the preceding path also
used three requests—one generic request plus two missing-market recoveries—so the
repair restores completeness without increasing that slate's request count.

## Exact current-slate replay

Input date: 2026-10-07. Three games / nine markets.

| Game | Complete books | Canonical rows | Scores changed | Picks changed | Grades changed |
|---|---:|---:|---:|---:|---:|
| PIT @ WSH | 18 | 116 | 0 | 0 | 0 |
| COL @ WPG | 19 | 118 | 0 | 0 | 0 |
| EDM @ ANA | 19 | 112 | 0 | 0 | 0 |

The incoherent OneXBet WSH +106 / PIT +212 pair was excluded. The candidate
retains one Best Angle, four Leans, four Watchlists, and five actionables.
Promotions: zero. Demotions: zero. Scores, probabilities, prediction sides,
prices selected after canonicalization, grades, stakes, copy, labels, and layout
remain governed by the existing sport-specific model and grade policy.

## Verification and rollback

- `npm run test:nhl-regular-model`
- `npx tsx --env-file=.env.local scripts/operator/audit-nhl-complete-market-ingestion-r15.ts 2026-10-07`
- `npm run verify:model-change`
- latest-main integration-safety and protected-PR checks

Roll back collector/refresh/model publication identifiers to r2/r7/r14 if a
current event loses a market, a malformed pair survives, the three bounded
scopes exceed their request contract, the board count changes unexpectedly, or
writer/lease/reader/lock verification fails. Never rewrite a prior lock.
