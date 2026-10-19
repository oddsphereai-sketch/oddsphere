# MLB market-scoped prediction-record overlay — r26

## Scope

- Sport: MLB
- Surface: Daily Edge member reader and response snapshot
- Writer: unchanged `lib/services/predictionRecordService.ts`
- Lease: unchanged `prediction_pipeline:mlb`
- Member response release:
  `daily_edge_member_presentation_2026_10_19_r26_mlb_market_scoped_record_overlay`
- Starting production commit: `819ccedebd00194852610bf77c356b88d4f40f7d`

## Production reproduction

For CLE at TB on October 19, the 22:29 UTC writer stored a complete Total
evaluation:

- pick/line: Over 6.5
- evaluated sportsbook/price: Pinnacle -122
- complementary same-book price: Under +109
- model probability: 52.3482%
- market probability: 53.4572%
- edge: -1.1 percentage points
- public grade: No Play (`market_aligned`, `no_bet=true`)
- market-input release:
  `mlb_market_input_snapshot_v4_trusted_total_scope_recovery_2026_10_19`

The response snapshot incorrectly exposed the Total as an operational exception
with no evaluated price. The reader's unlocked Moneyline calibration overlay
merged the complete `snapshot_json` from the older 22:21 UTC Moneyline record
over the current 22:29 UTC game prediction. That older snapshot truthfully
recorded the earlier Total price outage, but it was not authoritative for the
newer Total market. Its stale `mlb_data_completeness` value reintroduced
`over_price` and `under_price` as missing and caused the final presentation
boundary to suppress the newer verified Total tuple.

## Correction

The unlocked Moneyline overlay now carries only the applied
`pick_calibration` audit needed to prevent read-time Moneyline recalculation.
Moneyline pick, confidence, probability, grade, and price continue to come from
their existing market-scoped record columns. Current game-wide completeness,
posted lines, Total audit, and first-inning audit remain owned by the current
game prediction and their own records.

Locked records do not enter this code path. Their exact stored payload and
existing reader precedence remain unchanged.

## Board impact

On the exact production input:

- Total operational exceptions: 1 -> 0
- Total evaluated No Plays: 0 -> 1
- actionable promotions: 0
- actionable demotions: 0
- actionable count: unchanged
- Total side/probability/line/price/grade changes: 0
- restored reader tuple: Pinnacle Over 6.5 at -122, No Play, -1.1pp edge
- Moneyline calibration: unchanged
- first-inning market: unchanged
- provider calls/database writes: unchanged

This is a reader-authority correction, not a price invention, grade relaxation,
or model change.

## Verification

- `npm run verify:model-change`: passed
- `npm run test:lab-daily-edge`: 252 passed, 0 failed
- `npm run test:daily-edge-experience`: 219 passed, 0 failed
- `npx tsc --noEmit`: passed
- changed-file ESLint: passed with no errors; one pre-existing unused-constant
  warning remains in `scripts/test-daily-edge-experience.ts`
- full-repository `npm run lint`: remains red on the repository's pre-existing
  lint backlog outside this change; the changed files introduce no lint error
- read-only production replay: Over 6.5, evaluated Pinnacle price -122,
  current quote -118, 52.3482% model probability, 53.4572% market probability,
  -1.1 percentage-point edge, No Play, and no operational hold

## Rollback

Restore member presentation r25 and the prior full-snapshot Moneyline overlay
only for future unlocked reads. Do not rewrite or reconstruct any locked row.
Rollback is required for a cross-market overwrite, a displayed tuple that does
not exactly match its market record, changed actionability, mixed response
release, reader/writer disagreement, or lock mutation.
