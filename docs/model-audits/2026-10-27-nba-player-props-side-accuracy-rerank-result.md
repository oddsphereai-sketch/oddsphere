# NBA player-props side-accuracy rerank result

Date: 2026-10-27

## Result

The confirmed market-specific rerank qualifies for future-unlocked Points,
Assists, and Points + Assists rows. It changes grade selection only. Rebounds
was rejected because it fell from 34-17 to 25-26 on confirmation; no rejected
market receives runtime authority.

Across the independent confirmation block, affected-market actionables improve
from 603-546 (52.48%) to 658-491 (57.27%) at the same 1,149 actionable slots.
The selected rules are:

- Points: average of raw model and target-excluded market probability, with a
  -0.05 Over offset;
- Assists: final calibrated probability, with a -0.025 Over offset;
- Points + Assists: final calibrated probability, with a +0.025 Over offset.

These offsets are ranking terms selected before confirmation, not side quotas
or forecast thresholds. They cannot flip a prediction.

The exact stored-lock forward audit for the current r12 release preserves 30
actionables and improves 15-15 (50.0%) to 21-9 (70.0%). Best Angles preserve
five slots and improve 4-1 to 5-0; Leans preserve 25 slots and improve 11-14 to
16-9. There are 18 promotions paired with 18 demotions. The preceding r8
release keeps 69 slots and improves 33-36 to 35-34; r6 keeps 11 slots and its
10-1 record. Across all stored releases in the audit window, 110 actionables
improve from 58-52 (52.73%) to 66-44 (60.0%).

The winning result is more Under-heavy, not less: current-release selected
actionables move from 13 Overs / 17 Unders to 7 Overs / 23 Unders, while the
selected Overs still finish 4-3 and selected Unders 17-6. A cosmetic balancing
candidate was rejected because it made accuracy worse. The broad board remains
unchanged and two-sided; this release repairs which rows are promoted rather
than manufacturing direction.

## Invariants and rollback

Projection, side, probability, market reader, exact price, stake, provider
calls, writer, cadence, copy, layout, and all existing locks remain unchanged.
Future eligible promotions require target-book-excluded evidence and a price of
-200 or better. Roll back future unlocked evaluation to r11/r12/r13 by removing
the `accuracyRerank` policies; never rewrite an existing locked row.

