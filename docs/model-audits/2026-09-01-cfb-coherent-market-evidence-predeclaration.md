# CFB coherent market-evidence predeclaration

Date: 2026-09-01
Starting production base: `3c114e3c0b696cdafbbd831f3fef8d2746a0a507`
Owner authorization: production CFB Moneyline, Spread, and Total model change explicitly authorized before implementation

## Problem and invariants

The current CFB authoritative forecast already combines the independent football model, the canonical current market, Circa split evidence when strictly matched, public split evidence, weather, and exact-price economics. It does not include the stored opening-to-current quote trail in the authoritative PMF. The owner requires those inputs to resolve as one forecast before the final decimal score, side, probability, and grade.

The change must preserve the existing weekly FBS-involved slate, one authoritative writer and sport-scoped `prediction_pipeline` lease, quarterback and kickoff-weather behavior, immediate adverse safety holds, T-60 lock and tracking semantics, reader precedence for immutable historical payloads, and all existing product copy. It must not invent splits or add transparency text. Circa remains the primary split authority; public evidence never substitutes for Circa, and missing or stale split evidence is neutral.

## Frozen candidate semantics

- Compare opening and current quotes only when they are from the same normalized sportsbook and their market-specific timestamps form a valid pre-evaluation trail.
- Interpret spread/total line movement and de-vigged price movement as a bounded complement to the current market anchor. The current line already owns 75% of the market-informed forecast, so movement is capped at 0.75 score points and receives only a 25% complement weight.
- Combine Circa, same-book movement, and public split shifts before the authoritative PMF. Secondary evidence can strengthen, weaken, or neutralize a nonzero Circa direction, but cannot reverse it.
- Missing, mismatched-book, post-evaluation, or invalid-timestamp movement contributes exactly zero and never holds or flattens the board.
- Derive expected scores, sides, probabilities, exact-price EV, and grades downstream from the resulting PMF. Preserve natural decimal precision.
- Permit evidence-based promotions and demotions through the existing grade vocabulary. Exact-price economics remain required and immediate resistance safety rules remain authoritative.

## Success criteria

- PMF mass, expected points, selected side, displayed probability, and exact-price decision remain coherent for all three markets.
- Tests prove same-book movement changes the projection, mismatched-book movement is neutral, missing split evidence is neutral, Circa retains directional priority, and both promotion and demotion paths remain reachable.
- The current weekly replay reports board counts by market, promotions, demotions, side changes, exact-quote changes, projection impact, and data availability.
- The candidate must not produce a hidden flatter board. A small balanced transition with both promotions and demotions is acceptable without waiting for completed-game backtests.
- Focused CFB tests, typecheck, `npm run verify:model-change`, clean integration-safety verification on the latest protected main, protected PR checks, deployment, natural writer refresh, locked-row preservation, and signed-in live QA are required before production completion.
