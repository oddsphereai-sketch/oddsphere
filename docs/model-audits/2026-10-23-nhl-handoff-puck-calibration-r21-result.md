# NHL seven-game handoff puck-line calibration r21 result

Date: 2026-10-23

## Decision

Reject the fixed 56% / 1.5pp exact-price candidate. It changed zero grades in
selection, r18 confirmation, r20 confirmation, and the full cohort. Because it
did not repair the handoff's puck-line transfer, the predeclared publication
gate failed and no live release changed.

## Why it had no effect

The removed puck-line actionables were not clustered just below the proposed
56% probability threshold with positive exact-price value. Most became
Watchlists because the handoff's coherent cover probability fell below the
break-even probability of the selected quote. Examples include probabilities
of 63.3% at -213, 63.7% at -203, and 60.9% at -174; each has negative exact-price
edge even though the individual play later won.

Promoting those known winners after settlement would be outcome leakage. The
candidate correctly refuses to call a negative-model-EV quote actionable, even
when the realized game happened to cover.

## Gate result

- Selection spread actionables remained 69 at 46-23 and +1.49 units.
- r18 confirmation remained 15 at 8-7 and -2.13 units.
- r20 confirmation remained 4 at 2-2 and -0.85 units.
- Full cohort remained 88 at 56-32 and -1.49 units.
- There were zero promotions and zero demotions versus the uncalibrated
  handoff.

The fixed candidate therefore failed its purpose and is permanently rejected.
No threshold grid was run after seeing this result.

