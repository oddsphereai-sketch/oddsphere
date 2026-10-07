# WNBA current-quote market-read coherence

Date: 2026-10-07

Release:
`wnba_daily_edge_reader_2026_10_07_r1_current_quote_market_read_coherence`

## Scope

This is a reader and audit correctness repair. It does not alter the WNBA
champion model, coherent distribution, calibration, target-excluded market
decision, exact-price grade policy, writer, lock, tracking, stake, provider
load, member copy, labels, or layout.

The production deep audit found eight findings on the two-game October 7 slate:

- three movement trails whose same-book terminal quote was compared with the
  separate evaluated grade price;
- two market reads whose current price used that evaluated grade price instead
  of the visible current same-book quote;
- one selected-side spread move from -2.5 to -1.5 that the generic audit sign
  interpreted backwards;
- one Lean whose reader-only confidence was capped to 40 against a different
  target-excluded denominator even though the writer had already produced a
  valid exact-price Lean; and
- the corresponding actionable-copy/strength mismatch.

## Contract

- Unlocked movement evidence ends at `currentPriceAmerican`, sourced from the
  same-book trail.
- `priceAmerican` and `gradePriceAmerican` remain the writer's evaluated quote
  and continue to control grade economics.
- Locked movement remains frozen at `lockedLineAmerican`/the locked evaluated
  quote; later live prices cannot rewrite it.
- Current v11 recommendation strength follows the released writer outcome
  confidence. Legacy releases retain their legacy reader cap.
- WNBA selected-side spread lines use the selected-side convention: moving
  from -2.5 to -1.5 is support; moving from -1.5 to -2.5 is resistance.

## Exact live-input replay

Input: the two-game 2026-10-07 production WNBA slate, six markets.

- games: 2 -> 2
- markets: 6 -> 6
- side changes: 0
- score changes: 0
- probability changes: 0
- grade changes: 0
- evaluated grade-price changes: 0
- promotions: 0
- demotions: 0
- actionable markets: 4 -> 4
- deep-audit critical findings: 8 -> 0
- deep-audit warnings: 0 -> 0

The only recommendation-strength correction is GS Moneyline 40 -> 59, matching
the released 58.6% model probability and existing Lean at the evaluated -124
quote. Its pick, probability, grade, evaluated price, and tracking tuple do not
change.

## Verification

- `scripts/test-wnba-incoherent-total-context.ts`
- `scripts/test-daily-edge-deep-audit.ts`
- `scripts/test-edge-stack-rows.ts`
- exact live-input reader replay followed by `auditDailyEdgeBoards`
- `npm run verify:model-change`
- current-main integration-safety verification before publication

## Rollback

Roll back the reader release if a locked quote changes, any score/side/grade or
board count changes, the visible movement endpoint differs from the current
same-book quote, the deep audit regresses, or the member board fails to render.
