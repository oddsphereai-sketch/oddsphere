# CBB r6: structural fit experiment (private)

Declared before executing this experiment. R2 remains the private preview baseline;
no production activation, prediction writer, grade, stake, or locked record changes.

## Questions

1. Does the fixed 24-pass opponent/tempo fitting loop reach its own fixed point?
2. Does dating a previous-season fit at July 1 unnecessarily age observations
   during a period with no new basketball games? Compare with the latest accepted
   game's six-hour availability timestamp, retaining the existing 0.8 carry.
3. Does evaluating earlier performances against the *latest* league scoring/pace
   environment distort team strengths? Compare with a league environment estimated
   using only results available before that game's UTC day. Forecasts still use
   the current league environment.

The third hypothesis is motivated by the date-specific national efficiency
normalization described in Ken Pomeroy's additive-model methodology:
https://kenpom.com/blog/ratings-methodology-update/ . This is a testable local
implementation, not a reproduction or endorsement of proprietary KenPom ratings.

## Bounded design

Four candidates: converged fit alone; converged fit plus season-end priors;
converged fit plus date-aligned environment; all three together. Fixed ridge=1,
pace ridge=0.25, prior carry=0.8, recency=90 days. At most 400 refinement passes,
stopping when the maximum parameter change is below 1e-7; failure to converge is
reported, never silently called converged. Existing 19-feature matchup residual
head and its penalties are unchanged and refitted on the specified training data.

2022 is warm-up; 2023 trains uncertainty/head; 2024 selects. Eligibility requires
both margin and total MAE lower than R2, Brier no worse, and winner accuracy no more
than 0.5 percentage points worse. Rank eligible candidates by mean normalized MAE.
Do not open 2025 for all four and then choose a winner. Only the selected candidate
gets the already-opened 2025 diagnostic, including corrections/harms, monthly and
overtime breakdowns. 2025 is not an untouched holdout.

If a candidate qualifies, use cached exact-time opening quotes to audit real
ML/spread/total picks, retaining source and fixture-matching limitations. These
later diagnostics cannot change which structural candidate was selected. Report
regressions, not just aggregate improvements. No claim of achieving <6 margin MAE
or <10 total MAE is made in advance. No new paid data calls are required.
