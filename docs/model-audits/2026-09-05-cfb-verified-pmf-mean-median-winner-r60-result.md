# CFB verified-PMF mean/median winner publication r60 result

Date: 2026-09-05

Status: production candidate; live acceptance pending protected merge and leased-writer proof

## Result

The shared validator now applies an explicitly supplied score-direction tolerance to the
top-level winner/expected-margin comparison only when a joint PMF is present. The same audit
still verifies PMF mass, PMF-derived expected scores, and PMF-derived winner probability, so a
fabricated or malformed distribution cannot use the tolerance. The existing representative
winner check remains exact.

The focused regression preserves default rejection of a +0.1757-point mean / 49.4488% home-win
crossover, then proves that the same internally verified PMF is accepted only when CFB explicitly
supplies its established 0.5-point tolerance. The live incident is narrower: UCLA at California
crosses by 0.0489 points with UCLA at 51.4531% win probability.

## Impact

There are zero formula or tuple changes: no probability, projection, side, exact quote, EV,
grade, actionability, execution, stake, provider-call, lock, tracking, or reader change. The
only intended impact is allowing the sole atomic writer to publish otherwise coherent CFB rows
instead of preserving the prior last-known-good snapshot because one valid PMF has different
mean and median directions inside the already released CFB boundary.

Verification and live acceptance evidence are recorded in the protected PR and release handoff.
Rollback is validator r7 plus writer r52; immutable evidence and locks are never rewritten.
