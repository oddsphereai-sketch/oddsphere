# MLB FI r79 — evaluated-quote self-validation exclusion

## Scope

This release fixes only the case where the exact FI sportsbook selected for
evaluation is also the sole incumbent-accepted complete current named-book
pair. In that case, v5 used the same quote as both forecast authority and
exact-price economics. R79 retains that pair for its precise two-sided offered
price, no-vig fair probability, EV, and grade economics, but sets the
authoritative posterior to the existing independent FI probability before
expected-runs inversion and side classification.

An accepted complete pair from any other supported named book remains enough
to use the incumbent v5 consensus, movement residual, 25/75 posterior,
classification, and grade path unchanged. R79 neither estimates independent
book reliability nor changes multi-book market authority. Missing, stale,
future, invalid, one-sided, and skewed FI rows retain their incumbent neutral
or fail-closed behavior; they do not become holds because target-excluded
evidence is absent.

## Invariants

- A singleton exact price cannot validate the forecast that grades against it.
- A target-excluded accepted complete FI pair preserves v5 outputs exactly.
- No-current FI rows retain the independent-only, existing market-missing
  behavior.
- Exact selected-book odds and fair price remain downstream grade inputs only.
- No writer, lease, route, provider, database schema, or query path changes.
- Locked rows remain byte-immutable; r78 unlocked member tuple sync remains
  unchanged.

## Equal-input current-board comparison

The r78/v5 base and r79 candidate were run read-only and immediately
sequentially against the same September 2 board: 15 game snapshots and the
same current FI lines. Four rows had one or more accepted target-excluded
pairs and were byte-identical; three had no accepted current FI pair and were
also byte-identical. Eight rows were evaluation-only singletons and changed:

| Matchup | Exact book / price (NRFI, YRFI) | v5 NRFI | r79 NRFI | v5 → r79 side/grade |
| --- | --- | ---: | ---: | --- |
| STL@LAD | Bally, -132 / +102 | 53.622% | 56.435% | Toss-Up → Toss-Up |
| ATH@TEX | Bally, -127 / -105 | 53.269% | 56.460% | Toss-Up → NRFI Lean |
| SEA@BOS | Bally, -122 / -107 | 54.897% | 64.996% | NRFI Lean → NRFI Lean |
| TOR@CLE | Bally, -136 / +102 | 58.045% | 70.809% | NRFI Lean → NRFI Lean |
| SD@CIN | Bally, +110 / -148 | 46.931% | 54.583% | YRFI Lean → NRFI Lean |
| SF@PIT | Bally, -139 / +105 | 58.421% | 70.528% | NRFI Lean → NRFI Lean |
| MIA@KC | Bally, -107 / -122 | 53.757% | 69.619% | NRFI Lean → NRFI Lean |
| MIL@CHC | Bally, -130 / +100 | 56.942% | 68.584% | NRFI Lean → NRFI Lean |

Each changed expected-runs value is the natural-decimal inverse of its final
posterior, `-ln(P(NRFI))`; the precise paired values were retained in the
read-only run. The change produces one promotion (ATH@TEX), zero demotions,
and one forecast side change (SD@CIN). Board counts move from 5 NRFI / 2 YRFI
/ 5 Toss-Ups / 3 Held with six actionable Leans to 7 NRFI / 1 YRFI / 4
Toss-Ups / 3 Held with seven actionable Leans. These are forward candidate
effects, not a claim of outcome or profit improvement.

## Release and rollback

R79 stamps schema v12, calibration v30, decision r79, rule bundle v67,
first-inning probability head v6, and FI market-calibration policy v3. The
FI price-map, grade policy, member-tuple contract, full-game heads, and locks
are unchanged. Rollback is r78/v5/v29/v66; it restores only the prior
evaluation-only singleton forecast blend and must not rewrite r79 rows or
locked history.
