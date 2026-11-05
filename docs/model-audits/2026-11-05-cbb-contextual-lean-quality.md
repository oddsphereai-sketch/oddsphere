# CBB recommendation quality repair

Starting production base: `66f92e47aa89b87c03b525ebc8b3345671743a17`.

The owner requested a live correction to excessively permissive Lean eligibility,
with whole-market interpretation, uncertainty and actual prices considered,
without a play-count target or arbitrary flat EV/odds cutoffs. The preceding
R7 decision/R6 grade admitted every numerically positive offered EV. The actual
22:02 source-epoch snapshot had 63 Leans across 42 new-model games, including
14 below 1% estimated EV and positive-value -100,000 favorites. This is a
recommendation-quality problem; nominal arithmetic was consistent.

## Declared recommendation policy

The initial full-standard-error assessment for every actionable tier was
rejected before deployment: it would remove all captured actionable moneylines
and spreads, applying a strong robustness requirement to the lower-conviction
Lean label. The revised ordinal policy below was then frozen before its next
impact audit: moderate sensitivity for Lean, stronger sensitivity for Best.
This is disclosed product iteration following an observed defect in tier
meaning, not blind validation or a search for a desired number of plays.

R8 decision / R7 grade / R43 publisher / R27 adapter / R30 tracking retain the
exact fitted model R1, covariance R1, selected side, final score, probabilities,
pushes, paired offer, nominal EV and factual interpretation. They introduce one
grade-only recommendation-risk assessment for positive-value candidates.

1. Derive margin and total location standard errors from each fitted forecast's
   source-location and GP-function posterior variances, transformed by the
   existing covariance calibration's axis scales. Remaining-game noise is
   excluded from these location radii.
2. Evaluate the selected contract and side under eight coordinate/corner
   location sensitivity scenarios, at half a marginal fitted location standard
   error for a cautious Lean, and a full standard error for Best Angle. These
   are explicit grade-risk preferences. Reuse the game's exact conditioned integer-score law
   calculations at each shifted location across all three markets. Keep the
   released predictive scales and correlation unchanged; these stress cases
   are conservative sensitivity scenarios, not a posterior confidence interval,
   a joint one-sigma ellipsoid or a certified continuous worst-case bound.
   The released predictive law already includes location uncertainty; this
   extra recommendation caution does not add another convolution or alter p.
3. Apply a declared one-additional-adverse-resolved-case stress using N unique
   model-bound, own-game-excluded calibration games: stressed unconditional
   value is `(N * scenarioEV - (pWin + pLose)) / (N + 1)`. Push mass remains
   refunded. The current exact model binding has N=137. This is a product risk
   preference, not an estimated rare-loss rate or an effective-independent
   sample count. It implies a data-sized conditional reserve of 1/N before
   location sensitivity; it must not be described as threshold-free.
4. A candidate whose offered advantage survives the moderate sensitivities
   remains Lean-eligible. A nominal Best candidate must additionally survive
   the stronger assessment; if only moderate support survives it is Lean.
   Existing outcome-confidence and Best-price boundaries still apply. Positive nominal value
   that does not survive is Watchlist, retaining the same forecast. If even a
   certain win cannot supply sufficient return under the declared adverse-case
   stress, the quote is a priced No Play with the positive nominal EV preserved.
   This implies a data-dependent extreme-price boundary, not a hand-set odds
   floor. Existing negative-value/fair-premium lanes remain unchanged.

No source-count rule, mandatory professional confirmation or opposing-book veto
is added. Qualified sources, native timing, paths, buybacks and compositions
already shape the fitted reference, mean and uncertainty. The assessment neither
blends forecasts nor changes scores to fill a grade category. The eight cases
are computational sensitivity scenarios, not eight market-signal requirements.

The general use of explicit ambiguity sets in betting decisions is described by
[Sun and Boyd, Distributional Robust Kelly Gambling](https://web.stanford.edu/~boyd/papers/robust_kelly).
   That work does not select or validate this product's half/full-standard-error or
one-adverse-case preferences. This release does not introduce Kelly stakes.

## Release and verification contract

The existing sole writer, `prediction_pipeline:cbb` lease, T-60 clocks, 540-second
route budget, schedules, provider budgets, private artifact and training data
remain unchanged. The current DraftKings display preference remains preserved.
No new bundle, bucket, model fit, backtest tournament or provider request is
needed for this repair.

The old R7-decision/R6-grade codec and pure board mapping must retain exact
stored values before new semantics apply. All locked DTOs and tracking tuples
remain immutable. The new current board requires its actual risk assessment;
an actionable stored decision cannot silently omit or fail it.

Report actual same-input counts and demotions openly. A stricter recommendation
quality policy cannot manufacture compensating promotions against the preceding
any-positive-value ladder. Paired promotion tests instead prove that improved
real price or reduced fitted uncertainty can promote a Watch to Lean, and that
a small stable edge can qualify while a larger fragile edge fails. These are
not claims of actual promotions in an unchanged captured board.

Required evidence: focused risk, forecast/price/push conservation, affordable
favorite and extreme-return cases; old codec/reader and writer-lock precedence;
same-input current-board effects; runtime and storage cost; full model gate;
fresh-main integration, protected PR checks; actual production writer, member
snapshot, coverage, grade reasons and unchanged locked-record hashes. Bounded
independent market reviews compare raw evidence before candidate grade exposure,
with prior exposure disclosed. Numerical consistency does not certify forecast
accuracy or complete knowledge of all market scenarios.
