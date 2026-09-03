# WNBA authoritative structural market predeclaration

Date frozen: 2026-09-02
Protected-main base: `4f84cf57d8e664ac78897f1fcd7820bc639efdf4`
Base tree: `ee9c46523c50e71c1923ae9859a20cb9d40afe02`

This declaration is frozen before implementation or any outcome query. It is a
structural correction, not an outcome-tuned calibration.

## Current release and writer

- Model: `wnba_v1_1_team_identity`
- Distribution: `wnba_market_heads_value_calibrated_2026_08_02_v3`
- Calibration: `wnba_core_calibration_v1`
- Grade: `wnba_grade_policy_v6_authoritative_reader_grade_2026_08_13`
- Decision tuple: `wnba_decision_tuple_v1_exact_evaluated_price_2026_08_21`
- Prediction record: `wnba_prediction_record_contract_v3_exact_decision_tuple_2026_08_21`
- Sole writer: `lib/services/wnba/runWnbaModel.ts`
- Tracking writer: `lib/services/wnba/buildWnbaPredictionRecords.ts`
- Lease: `prediction_pipeline:wnba`

## Frozen structural defects

1. Spread consensus accepts unpaired home rows and Total consensus counts both
   sides of one book as separate observations. Both can include the sportsbook
   whose exact quote is later evaluated.
2. Spread's fixed market anchor can therefore validate a forecast against its own
   evaluated quote. Total's grade calibration can do the same even though its
   displayed forecast remains independent.
3. Blanket Spread and Total Watchlist caps suppress both legitimate promotions
   and evidence-driven demotions. Two later Spread exceptions can promote without
   proving positive expected value at the exact quote.
4. The published Moneyline probability and expected score margin are separate
   heads. A normal margin distribution cannot simultaneously preserve the exact
   Moneyline probability and a different score-margin center. Winner-sign guards
   hide, but do not solve, that mathematical incompatibility.
5. Moneyline's consensus and its cross-market dispersion reliability input can
   include the sportsbook whose exact Moneyline quote is later evaluated.
6. Current tuple validation binds locked tuples to current release constants, so
   a release bump can make an otherwise valid immutable legacy locked tuple lose
   reader precedence.

## Frozen candidate

Moneyline current rows must also be finite, fresh, predecision/prestart, two-sided
same-book pairs. For every possible evaluated sportsbook, the candidate excludes
that book, requires at least two distinct alternative books, rebuilds the no-vig
all-book and sharp consensus, and applies the incumbent cold-start, dynamic
35--75% market weight, stability and conflict logic. Cross-market dispersion used
by that incumbent reliability formula is computed after excluding the same target
book. The stable candidate is selected by the incumbent upper-median exact-price
rule after its side is known. If no stable qualified target exists, the market
inputs are absent and the model uses its independent path; the evaluated quote is
still downstream economics when a complete exact pair exists.

The desired margin mean is the existing independent pre-calibration margin unless
a Spread evaluated target has a unique exact-line mode supported by at least two
distinct target-excluded complete pairs. Only then may the established 25%
independent / 75% market-center formula set the mean. Total keeps the independent
total center and existing total sigma.

One maximum-entropy margin distribution must preserve the desired expected margin
`mu`, incumbent variance `sigma^2`, and target-excluded final Moneyline probability
`p = P(M > 0)`. The frozen family is the information projection

`f(x) proportional to exp(a + b*x + c*x^2 + d*I[x>0])`.

Equivalently it is a mixture with weight `1-p` on a normal distribution truncated
to `x <= 0` and weight `p` on the same underlying normal truncated to `x > 0`.
Its two underlying normal parameters are solved deterministically by bisection so
the mixture mean and variance equal `mu` and `sigma^2`; no learned coefficient is
introduced. The solver must reproduce all three constraints within `1e-9`. The
Cantelli feasibility conditions are checked first (`mu > 0` requires
`mu^2/sigma^2 < p/(1-p)` and the symmetric condition for `mu < 0`). If infeasible,
ill-conditioned, or not converged, the exact fallback is the independent normal
margin distribution; its own `P(M>0)` becomes the final coherent Moneyline
probability. No winner-only safeguard or cosmetic score inversion is permitted.

Expected scores are the algebraic decomposition of the final distribution means:

`home = (total + margin) / 2`, `away = (total - margin) / 2`.

Consequently the same joint construction generates Moneyline, Spread and Total
probabilities and sides. Spread cover probabilities come from the maximum-entropy
margin CDF at the exact evaluated line. Total probabilities come from the
independent total normal CDF. No probability head is rounded before tuple storage.

Spread and Total market rows are eligible only as exact, complementary same-book
pairs: home `x` with away `-x`, or over `x` with under `x`. Both observations must
be finite, nonzero-price, no later than the decision or game start, no older than
15 minutes at decision time, and no more than 30 seconds apart. Deterministic
nearest-skew then newest matching yields at most one pair per sportsbook.

The evaluated sportsbook is excluded from every alternative consensus. A unique
modal exact line must have at least two distinct target-excluded sportsbooks to
be called corroborating market evidence. Ties, singletons, repeated rows from one
book, stale/future rows, and incomplete pairs are unavailable. They contribute
zero and do not move or flatten the forecast.

Each market's exact evaluated quote is used only after its distribution is fixed. Its
break-even probability and expected return are computed directly. Target-excluded
same-line no-vig probabilities are retained as corroboration, never as a required
substitute for a missing source. Missing alternatives therefore leave the model
forecast and exact-price economics unchanged.

Spread and Total grades remove the blanket caps. The candidate reuses the existing
point-strength/dispersion/sharp/public-resistance rules and the existing Moneyline
numeric value thresholds (four/two percentage points and two percent expected
return), applied to the final distribution probability versus the exact quote's
break-even probability. Positive exact-price EV is mandatory. Qualified
target-excluded breadth can corroborate an action; absent optional alternatives
cannot demote an independently strong exact-price play. The existing two Spread
promotion exceptions are retained only when the same exact-price value gate passes.
There are no quotas, new fit coefficients, synthetic splits, stakes, or Hold/0.5
fallbacks.

## Candidate release identifiers

The identifiers skip the unpublished held v1.2/v2/v7/v2/v4 candidate so the two
trees can never be confused:

- Model: `wnba_v1_3_target_excluded_complete_pairs`
- Distribution: `wnba_complete_pair_target_excluded_2026_09_02_v5`
- Calibration: `wnba_core_calibration_v3_complete_pair_target_exclusion`
- Grade: `wnba_grade_policy_v8_complete_pair_exact_value_2026_09_02`
- Spread formula: `wnba_spread_ml_coherent_target_excluded_evaluation_2026_09_02_v3`
- Total formula: `wnba_total_independent_complete_pair_target_excluded_value_2026_09_02_v3`
- Decision: `wnba_target_excluded_market_decision_v2_2026_09_02`
- Tuple: `wnba_decision_tuple_v3_complete_pair_exact_value_2026_09_02`
- Record: `wnba_prediction_record_contract_v5_complete_pair_exact_value_2026_09_02`
- Forward action evidence: `wnba_action_promotion_evidence_v2_release_pure_2026_09_02`
- Forward capture stays behavior-neutral v1; it embeds the new release identifiers.

## Frozen gates

- Deterministic fixtures prove complete pairing, nonzero allowed skew, stale/future
  rejection, one-pair-per-book independence, evaluated-book exclusion, tied/noisy
  unavailability, and exact independent/unchanged fallback.
- Deterministic Moneyline fixtures prove evaluated-target exclusion, the incumbent
  dynamic-weight calculation on alternatives, stable target selection and exact
  independent fallback. No evaluated Moneyline quote may enter forecast evidence.
- Maximum-entropy fixtures prove mean, variance and win-probability constraints,
  Spread CDF derivation, infeasible independent fallback, and natural precision.
- Distribution tests prove the decimal score sum/difference and normal-CDF
  Moneyline/Spread/Total probabilities are internally identical within floating
  tolerance, with no output quantization.
- Grade fixtures prove both promotion and demotion paths, positive exact-price EV,
  public resistance, and optional-evidence identity.
- Tuple/record/reader tests prove exact evaluated-price binding, current unlocked
  release coherence, immutable legacy locked precedence, and locked-writer skips.
- Release-pure historical rows are opened diagnostics only. Any current natural
  slate reports complete board counts, market mix, projections, probabilities,
  side changes, promotions, demotions, exact-price coverage, pair coverage and
  singleton influence. A zero slate is reported as zero, never invented.
- Required commands: focused WNBA suites, TypeScript, ESLint on affected files,
  `npm run verify:model-change`, production build, and integration safety against
  freshly resolved protected main.

Production remains held if the same eligible board cannot demonstrate both a
promotion and a demotion path, if Moneyline identity or distribution coherence
fails, if locked precedence fails, or if protected main advances before final
integration review.
