# Daily Edge lock and monitor health correction

Date: 2026-09-05

## Evidence

- Every September 4 CFB prediction record inspected had an authoritative T-60 lock. The generic
  pregame sweep nevertheless emitted repeated `game_started_without_lock` events because it read
  the legacy `game_predictions.locked_at` field instead of CFB's forward-evidence/prediction-record
  authority.
- MLB games 61193 and 61195 genuinely missed their locks. From T-60 through first pitch, the final
  model and stored member rows matched on pick, side, quote, confidence, probabilities and edge.
  The stored member row was deliberately finalized as No Play by exact-price economics, while the
  second dry-run proposal contained its underlying Lean. The coherence exception compared the two
  independently generated `published_at` timestamps, which can never be identical, so every
  otherwise coherent minute retry was rejected.
- The Daily Edge health monitor compared FI r85's scoped probability head with the older base FI
  identifier, producing a false model-layer mismatch.

## Correction

- The generic sweep now owns only MLB/NBA/NHL plus explicit WNBA opt-in. CFB, NFL, CBB, and
  soccer/UCL remain with their sport-specific writers and lock monitors.
- MLB lock coherence r4 continues to require identical pick, side, price, confidence, probability,
  market probability, edge, release identity, exact evaluated quote, canonical identity, and final
  public decision. It no longer requires two sequential writer calls to invent the same
  `published_at`. Pending-promotion and failed-economics No Play tuples can therefore lock while
  every material mismatch remains fail-closed.
- The health monitor now constructs the expected market-scoped MLB layer stamp, so current FI r85
  is accepted and a superseded base FI head is still rejected.

No forecast, grade, stake, price, writer ownership, or historical lock was changed.
