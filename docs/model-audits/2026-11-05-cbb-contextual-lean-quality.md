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

Full- and half-standard-error worst-case assessments for Lean were rejected
before deployment. Both would remove all captured actionable moneylines and
spreads, applying a worst-case requirement to the lower-conviction Lean label.
The final policy below changes the decision principle, rather than searching
for a smaller radius or a desired count: Lean accounts continuously for the
expected downside of a working value-sensitivity model; Best additionally
requires stronger scenario stability. This is disclosed product iteration,
not blind validation or a statistical qualification claim.

R8 decision / R7 grade / R43 publisher / R27 adapter / R30 tracking retain the
exact fitted model R1, covariance R1, selected side, final score, probabilities,
pushes, paired offer, nominal EV and factual interpretation. They introduce one
grade-only recommendation-risk assessment for positive-value candidates.

1. Derive margin and total location standard errors from each fitted forecast's
   source-location and GP-function posterior variances, transformed by the
   existing covariance calibration's axis scales. Remaining-game noise is
   excluded from these location radii.
2. Evaluate the selected contract and side under eight coordinate/corner
   location sensitivity scenarios, at one marginal fitted location standard
   error. Reuse the game's exact conditioned integer-score law
   calculations at each shifted location across all three markets. Keep the
   released predictive scales and correlation unchanged; these stress cases
   are conservative sensitivity scenarios, not a posterior confidence interval,
   a joint one-sigma ellipsoid or a certified continuous worst-case bound.
   The released predictive law already includes location uncertainty; this
   extra recommendation caution does not add another convolution or alter p.
3. Derive axis value sensitivities from the exact EV difference at positive and
   negative axis scenarios divided by two. Their absolute sum is the scale of
   a declared linearized working Normal EV-sensitivity model with unidentified
   cross-axis dependence. It is an upper standard-deviation bound within that
   linearized working model, not a conservative bound for actual nonlinear EV.
   Store eight-scenario linearization residuals separately. For nominal value
   mu and working scale s, the expected negative excursion is
   `D = s*phi(mu/s) - mu*Phi(-mu/s)`, with its analytical zero-scale limit.
   Lean's value assessment is `mu-D`. This declared unit downside penalty is
   continuous and does not require every adverse scenario to remain profitable.
   It is neither the variance of a single bet's return nor a calibrated EV
   posterior or confidence guarantee. Stable-tail arithmetic is shared with
   the existing score-law mathematics; the public score law remains unchanged.
4. Apply a declared one-additional-adverse-resolved-case stress using N unique
   model-bound, own-game-excluded calibration games: stressed unconditional
   value is `(N * assessedEV - (pWin + pLose)) / (N + 1)`. For Lean, assessedEV
   is mu-D; for Best it is the minimum exact value across nominal and the eight
   scenarios. Push mass remains
   refunded. The current exact model binding has N=137. This is a product risk
   preference, not an estimated rare-loss rate or an effective-independent
   sample count. It implies a data-sized conditional reserve of 1/N before
   location sensitivity; it must not be described as threshold-free.
5. A candidate whose downside-adjusted value supports the declared risk
   remains Lean-eligible. A nominal Best candidate must additionally survive
   the stronger scenario assessment; if only Lean support survives it is Lean.
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
That work does not select or validate this product's downside penalty or
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

## Same-input effect and resource proof

The final expected-downside audit uses the already saved 22:02 source-epoch
packet, not later live-board counts and not settled outcomes. For 42 new-model
games /126 priced markets, the preceding ladder's 63 Leans and four Best become
29 Leans and four Best: moneyline8→2, spread23→9, total32→18. Thirty-four
actionables demote, zero promote; final counts are64 Watch,29 No Play,29 Lean
and4 Best. Scores, selections, pWin/pLose/pPush, offered prices and nominal EV
remain exact. This is an openly reported quality correction, not a concealed
board-count change or evidence that prediction accuracy improved.

Within the captured39 unlocked games,59 Leans become27, with three Best retained.
The three captured new-model locks retain their original grades and payloads.
Actual lock state at deployment may be later; these counterfactual counts must
not be presented as a promised live slate. The full82 priced-game comparison
changes103→59 Leans and retains six Best. All311 legacyR6 codec/JSONB/mapper
roundtrips remain exact. Risk-only computation adds3.905 seconds locally for
the82 games, with zero GP evaluations, fits, provider calls or writes.
Independent Python expected-downside arithmetic agrees within6.20e-17.
Private audit SHA256:
`6bfdd5b065574df04a24b8ee847678609c1869889bacb5d2bb1763263ff2b948`.
The actual production job's elapsed time and completed lifecycle remain required.
