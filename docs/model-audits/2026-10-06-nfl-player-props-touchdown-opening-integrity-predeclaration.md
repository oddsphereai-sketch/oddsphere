# NFL Player Props Touchdown Opening Integrity Predeclaration

Date: 2026-10-06  
Status: production candidate; implementation matches the frozen scope

## Defect

The NFL player-props reader can render an Anytime TD current quote at the canonical `0.5` line beside an opening quote captured from a different milestone ladder such as `2.0`. Those are different betting outcomes, so the resulting opening-to-current trail is not a comparable same-outcome movement trail.

## Frozen scope

- Suppress a displayed opening trail only when the current market is `anytime_td` and the opening line is not the current canonical line.
- Preserve cross-line opening movement for ordinary two-way volume and yardage markets, where the line change is part of the market evidence.
- Preserve the current exact price, prediction, probability, projection, grade, stake, lock, tracking row, provider cadence, writer, and `prediction_pipeline:nfl` lease byte-for-byte.
- Add no member-facing copy, labels, warnings, or layout changes.

## Acceptance and rollback

The production-contract test must prove that a `2.0` touchdown ladder opening cannot be shown as the opening for a `0.5` Anytime TD quote, while a genuine `0.5` opening remains eligible and an ordinary cross-line yardage opening remains eligible. The full NFL player-props focused suite and integration-safety checks must pass. Roll back if any board row, grade, model release, price, lock, or tracking tuple changes.

## Validation result

- The production-contract regression rejects the `2.0` to `0.5` touchdown pairing, retains a genuine `0.5` opening, and retains ordinary `247.5` to `249.5` yardage movement.
- The NFL player-props production-contract, exact-market-board, and cross-market-movement suites pass.
- `npm run verify:model-change` passes in full, including the NFL player-props, CFB, NFL Daily Edge, WNBA, MLB, EPL, UCL, official tracking, and shared presentation contracts.
- Targeted ESLint passes for the changed presentation and contract-test files.
- Board impact is exactly zero promotions, zero demotions, zero side/projection/probability/price changes, and zero tracking changes. Only the invalid cross-ladder trail is suppressed.
