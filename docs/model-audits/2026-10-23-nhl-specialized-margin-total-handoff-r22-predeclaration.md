# NHL specialized margin/Total handoff r22 predeclaration

Date: 2026-10-23

Status: predeclared, read-only architecture replay. No live authority.

## Diagnosis

The seven-game roster handoff improves winner probability and margin MAE, but
it also replaces the fast head's independent Total even though Total MAE and
direction do not improve. In the r20-only replay, that unnecessary ownership
change flips Winnipeg-Dallas from the correct Under to the incorrect Over.

Margin/winner strength and game scoring environment are distinct model axes.
They may be estimated by specialized independent heads and then reconciled into
one final home score, away score, margin, Total, and probability distribution.

## Fixed candidate

- Maximum team games 0-6: retain the complete fast-state head.
- Maximum team games 7-9: use the already-released roster head's independent
  home-win probability/margin, but retain the fast-state head's independent
  Total.
- Solve the roster home-win probability to a goal margin at the fast Total and
  rebuild the two team scores algebraically.
- At ten games and later, retain the mature statistical path unchanged.
- Run the existing qualified Moneyline reader and target-excluded Total reader
  downstream, then reconcile the final score so the reader-adjusted Total and
  winner probability remain mathematically coherent.
- Retain the released probability and exact-price grade policies for this first
  architecture test. The rejected flat puck calibration is not included.

This is not a weighted blend: one specialized head owns margin and one owns the
Total before a single score tuple is formed. No market number enters either
independent head.

## Gates

- 2025 opening-window Moneyline accuracy/Brier, puck-line direction, Total
  direction, and margin/Total MAE do not worsen versus the current fast boundary
  beyond the original handoff tolerances.
- Pre-r18 2026 Moneyline accuracy does not decline versus r20.
- r18 and r20 Moneyline accuracy each do not decline, combined-confirmation
  Moneyline Brier improves, and combined margin/Total MAE do not worsen by more
  than 0.10 goal.
- r18 and r20 Total direction each do not decline versus r20.
- Combined-confirmation puck-line direction loses no more than one win.
- Exact-price actionability on selection and combined confirmation improves or
  preserves accuracy and units; r20 loses no more than one net actionable win.
- Full board count does not exceed r20, full actionable Brier does not worsen,
  both promotions and demotions occur, exact-price coverage is complete, and
  locked payloads remain immutable.

Failure rejects the architecture. No axis weight, game-count cutoff, or grade
threshold may be tuned after the result.

