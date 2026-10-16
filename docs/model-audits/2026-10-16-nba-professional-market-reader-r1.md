# NBA professional market reader r1 — observation-only audit

Date: 2026-10-16

Release: `nba_professional_market_reader_2026_10_16_r1_observation_only`

## Scope and authority

This release adds an internal NBA market-evidence reader to the prediction pipeline. It is not the member-facing card reader and it does not alter the current forecast, pick, probability, grade, price, or stake.

- Internal reader: interprets same-book two-sided price/number chronology, source-specific splits, persistence, reversal/buyback, resistance, and cross-book disagreement.
- Display adapter: renders the writer-owned result and cannot execute or reinterpret internal reader logic.
- Authority: `observation_only` until point-in-time evidence can be joined to settled NBA outcomes without leakage.
- Board impact: 0 promotions, 0 demotions, 0 side changes, and 0 score changes.
- Locked records: no locked writer or locked reader path changes; existing locked payload precedence remains unchanged.

## Evidence contract

- Price rows come from `market_price_observations_v2` and must form coherent same-sportsbook, two-sided snapshots.
- Spread sides must have opposite numbers and Total sides must have the same number.
- Movement requires at least two authentic captures from the same sportsbook.
- The sportsbook offering the independent model's best execution price is excluded from evidence for that market.
- Prices are converted to two-sided no-vig probability before directional comparison.
- Splits remain source-specific; rows from different providers, books, or observation times are not combined into synthetic evidence.
- Missing, truncated, changing-count, stale, conflicting, reversed, or incomplete evidence fails closed to `unavailable`.
- No numeric consensus blend is part of this reader.

## Live rehearsal

The read-only production-data rehearsal covered the 2026-10-20 through 2026-10-22 slates:

- 16 games and 48 markets entered the internal reader.
- All games returned `evidenceStatus=complete` with no query or pagination errors.
- Real public-consensus and DraftKings split rows were retained where fresh and line-compatible.
- Execution-book exclusions were populated independently by market.
- Zero market reads qualified because only one authentic price capture existed at rehearsal time, so there was no same-book movement sequence to interpret.
- The reader correctly refused to treat splits alone as proof of sharp movement.

## Validation

- `npx tsx scripts/test-nba-professional-market-reader.ts` — pass.
- `npx tsx scripts/test-nba-market-reader-display-separation.ts` — pass.
- `env NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — pass.
- `npm run verify:model-change` — pass, including pre-verification.

## Promotion boundary

No reader rule may modify the final forecast until authentic pregame chronology has accumulated and a release-pure, locked-timestamp evaluation demonstrates improvement or safe correction behavior for Moneyline, Spread, and Total separately. Promotion must report side changes, corrections versus harms, score error, direction accuracy, calibration, alternate-line results, grade counts, and board-count impact. A generic projection-to-consensus blend is not a substitute for this validation.
