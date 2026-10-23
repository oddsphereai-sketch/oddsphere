# NHL seven-game handoff puck-line calibration r21 predeclaration

Date: 2026-10-23

Status: predeclared, SELECT-only. No live authority.

## Reason for this bounded follow-up

The fixed seven-game head handoff passed its score and directional gates but,
under the incumbent puck-line verdict boundary, moved 15 historical actionable
puck lines down and only four up. Puck-line direction remained 104-61, yet the
new actionable subset discarded eleven net winners. Publishing that uncalibrated
grade transfer would be misleading.

## Fixed rule

For the seven-game handoff only, retain the existing Best Angle boundary. A
future unlocked puck-line Watchlist may become Lean when its coherent handoff
distribution gives the selected side at least 56% cover probability and at
least 1.5 percentage points of edge over the exact locked/current price. The
existing `edge >= 5pp` Lean route remains unchanged.

This is a two-point probability relaxation of the existing 58%/1.5pp Lean
boundary. It changes no side, score, probability, price, stake, Moneyline,
Total, reader input, writer, lease, or locked payload.

## Gates

- Pre-r18 selection puck-line actionable accuracy and units may not decline
  versus both the uncalibrated handoff and the current fast-head baseline.
- r18 and r20 confirmation puck-line actionable accuracy may not decline versus
  the uncalibrated handoff; combined-confirmation units must improve.
- Full-cohort puck-line actionable Brier score may not worsen versus the current
  fast-head baseline by more than 0.005.
- The full all-market handoff board must still contain at least one actionable
  promotion and one demotion versus the current fast-head baseline, and may not
  exceed that baseline's actionable count.
- Exact-price coverage must remain complete.

Failure of any gate rejects the rule and blocks publication of an uncalibrated
handoff. No threshold grid may replace this fixed test after results are seen.
