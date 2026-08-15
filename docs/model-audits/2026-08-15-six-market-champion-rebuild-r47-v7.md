# Six-market champion rebuild — MLB r47 / WNBA v7

## Decision

Release the qualifying MLB Moneyline, MLB Total probability, WNBA Moneyline,
and WNBA Spread changes. Retain the current MLB First Inning and WNBA Total
systems. Do not ship an opposite-side flip in any market.

This conclusion comes from a clean-slate, read-only tournament over immutable
locked records. It imported no prior research candidate or threshold. Families
were fitted on earlier dates and judged on later validation, latest, and
rolling-origin folds. Action policies used actual locked prices; an opposite
side required its own locked price. Prospective forward shadowing is not a
release requirement.

## Released market decisions

| Market | Probability decision | Action decision | Validation board | Latest board |
|---|---|---|---:|---:|
| MLB Moneyline | Retain incumbent | Retain all actions; add positive-EV favorites | 39/+5.090u → 54/+9.082u | 37/-6.129u → 44/-3.547u |
| MLB Total | Price-aware side-floored calibration | Retain current action selection | No change | No change |
| MLB First Inning | Retain incumbent | Retain current action selection | No change | No change |
| WNBA Moneyline | Retain incumbent | Retain all actions; add positive-EV sides | 9/-3.275u → 12/-1.716u | 7/+2.185u → 11/+2.671u |
| WNBA Total | Retain incumbent | Retain current action selection | No change | No change |
| WNBA Spread | Price-aware side-floored calibration | Replace with p ≥ break-even +2pp | 0/0u → 8/+3.073u | 4/-2.130u → 8/+1.142u |

Board counts are not flattened. Across the two released additive Moneyline
policies and the Spread replacement, validation adds 26 actions with no
demotions; the latest partition adds 16 actions and demotes one. MLB Total's
probability improves without altering its action board.

The read-only August 15 current-slate comparison covered 54 stored records:
15 rows in each MLB market and three in each WNBA market. MLB Moneyline stayed
7→7, MLB Total 7→7, First Inning 9→9, WNBA Moneyline 2→2, and WNBA Total 0→0.
WNBA Spread moved 0→2 through two promotions and no demotions. No current
market was flattened.

## Probability evidence

MLB Total's calibrated selected-side probability improved combined Brier/log
loss from `0.2487/0.6905` to `0.2481/0.6894` and latest from
`0.2544/0.7020` to `0.2510/0.6951`. It improved both scores in three of four
rolling folds and retains a 50% selected-side floor.

WNBA Spread improved combined Brier/log loss from `0.2483/0.6898` to
`0.2356/0.6618` and latest from `0.2473/0.6876` to `0.2329/0.6546`. It improved
both scores in three of four rolling folds. The exact formula is versioned in
`lib/automodel/immediateMarketChampion.ts`; the record writer reevaluates it at
the actual locked price.

No probability challenger qualified for MLB Moneyline, MLB First Inning, or
WNBA Moneyline. WNBA Total's side-preserving fit became a constant 50% control,
so it fails the non-degenerate probability requirement. Its unconstrained
projection fit scored better but repeatedly assigned the displayed side below
50%; that is opposite-side diagnostic evidence, not an actionable model.

## Action robustness

- MLB Moneyline promotions were 10–5 (+3.992u) in validation and 5–2
  (+2.582u) latest. Paired improvement excluding the best date was +2.149u and
  +1.621u. The policy was positive in two of four rolling folds, totaled
  +0.896u across folds, and its worst fold was -4.641u, inside the registered
  -5u floor.
- WNBA Moneyline promotions were 3–0 (+1.559u) in validation and 3–1
  (+0.486u) latest. Best-date-removed paired gains were +0.598u and +0.051u;
  three of four rolling folds were positive.
- WNBA Spread's latest replacement retained three, demoted one losing action,
  and promoted five that went 4–1 (+2.272u). Best-date-removed paired gains
  were +1.295u validation and +0.633u latest; three of four rolling folds were
  positive.

## Odds and market-reading boundaries

There is no global `-120` action ceiling and no hard `-200` ceiling. MLB
Moneyline evaluates every negative price against its actual break-even
probability. WNBA Moneyline evaluates all prices the same way. A short price is
not rejected merely for being short; it must be supported by correspondingly
higher probability.

Market movement, money/ticket splits, and market consensus remain diagnostic
signals. They can support existing released action rules, but they do not
automatically mean bet, fade, or flip. No specific opposite-side cohort cleared
the locked-price and robustness gates. WNBA historical opposite prices are
absent; MLB First Inning has 586 paired prices but zero usable paired movement
and split histories. Missing evidence is not reconstructed after lock.

## Release and rollback

New MLB identifiers: decision r47, rule bundle v46, grade policy v37, public
calibration v20. Roll back together to r46/v45/v36/v19.

New WNBA identifiers: model v1.2, distribution v4, calibration schema v2, grade
policy v7. Roll back together to model v1.1, distribution v3, calibration
schema v1, and grade policy v6.

The authoritative MLB and WNBA writers and their sport-scoped shared
`prediction_pipeline` leases are unchanged. Locked historical rows are never
rewritten.
