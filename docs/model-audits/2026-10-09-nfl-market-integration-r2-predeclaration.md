# NFL market integration r2 predeclaration

Status: predeclared replacement candidate; no production publication authorized.

Date: 2026-10-09

Starting production base: `41cb2fc88d6c601d77a4932dbb1adcd1aaebfd93`.

This revision follows the rejected first candidate documented in
`2026-10-09-nfl-evidence-calibrated-market-integration.md`. No outcome or grade threshold is changed.

## Newly confirmed defect

The shared movement reader correctly requires a chronological same-sportsbook opening/current pair.
The NFL Spread direction function does not consume that validated movement result. It independently
subtracts the real operational opening line from the synthetic target-excluded consensus line. Those
quotes have different sportsbook identities, so their difference is a cross-book comparison mislabeled
as movement. The Total path already consumes the validated same-book movement object.

## Frozen correction

- Qualified named-sequence authority retains first precedence.
- Otherwise a Spread move may select home only when the validated same-book home-margin delta is at
  least +0.5, or away only when it is at most -0.5.
- The synthetic target-excluded consensus line is never compared with an operational opening and never
  labeled movement.
- When no material validated move exists, the target-excluded current no-vig Spread price may choose the
  priced side and the reason remains `flat_price`; it cannot fabricate a movement trail.
- The first candidate's evidence-priced confidence correction, same-winner magnitude guard, independent
  model, qualified sequence rule, split thresholds, grade thresholds, exact-price economics, and all
  provider/lock/publication behavior otherwise remain frozen.

## Product-safety acceptance gate

The candidate must be rejected rather than published if the zero-write current-board replay:

- takes a market with existing actionables to zero actionables;
- removes more than half of all current actionables; or
- has no tested promotion path and no current promotion or retained actionable created by independently
  corroborated market evidence.

This gate does not authorize lowering a probability, EV, edge, sequence, split, or grade threshold to
hit a board-count target. A failed gate means the release is not ready, not that the board must be filled.

The full exact stored-decision replay, loss ledger, current-board replay, focused NFL suite, full model-
change verification, immutable-reader precedence test, clean latest-main integration test, protected PR,
explicit owner approval, and live verification remain mandatory.
