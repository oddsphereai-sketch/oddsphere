# MLB player-props all-market feature tournament and HRR r30

Date: 2026-08-12
Active candidate release: `mlb_props_2026_08_12_r30`
Writes during research: none

## Question

Do the recent-form, opponent, pitch-arsenal, pitch-type matchup, direct matchup,
lineup, park, and weather fields already collected by the Player Props and Daily
Edge pipelines improve out-of-sample prop prediction? If a broad probability
replacement is not supported, does any validation-selected action sleeve improve
accuracy without silently shrinking the board?

## Frozen evidence and split

- 44,929 settled immutable T-60 tracking rows were collapsed across books into
  43,244 player/game/market/line observations in 16 markets.
- Official MLB logs were rebuilt for 629 player/family identities using only games
  strictly before each slate date.
- 40,669 compact feature contexts were recovered from the exact board snapshot ID
  referenced by tracking; 39,877 evaluated observations had that frozen context.
- Frozen fields included lineup/order, home/away, opponent K/BB/BA/OPS/HR rates,
  arsenal whiff/chase/zone/BA/xwOBA, pitch-mix matchup BA/SLG/xwOBA/whiff, prior
  batter-pitcher matchup, park factors, temperature, wind, and precipitation.
- Discovery ended 2026-07-23. Candidate and policy selection used 2026-07-24
  through 2026-07-31. The 2026-08-01 through 2026-08-11 window was untouched
  until the final comparison.

The reproducible read-only operators are
`scripts/operator/extract-mlb-props-locked-feature-context.ts` and
`scripts/operator/audit-mlb-props-all-market-feature-tournament.ts`.

## Broad probability result

No broad market-wide challenger cleared the predeclared requirement to beat both
the market and the then-current release on Brier score and log loss with at least
90% date-block bootstrap support. Rich context was tested and is useful as
selective evidence, but this sample does not justify replacing every market's
probability with one regularized context regression. Those challengers remain
audit-only.

## Validated action sleeve

The validation tournament selected an H+R+RBI Under rule using:

1. the player's prior-only, line-aware Under survival across at most 80 games,
   with a two-game neutral beta prior;
2. a 25% empirical / 75% target-market probability blend;
3. final probability at least 60%, final edge at least 1 percentage point, and
   expected value at the offered price at least 3%; and
4. the existing valid-price, research, best-book, identity, lineup, and lock gates.

Validation was 6-3 (+0.800 units, 8.9% flat-stake ROI). The untouched holdout was
15-2 (+7.378 units, 43.4% ROI), spread across nine of eleven holdout dates. A
5,000-iteration date-block bootstrap put the probability of hit rate above 50% at
99.92% and profitability at 99.44%. The previous release produced zero actionable
H+R+RBI rows in the same holdout, so all 17 decisions are additive promotions;
there is no hidden demotion. The latest August 12 r29 board has zero rows clearing
the new threshold, so the immediate board delta is 0 rather than a forced pick.

Because the all-row H+R+RBI challenger did not clear the broad probability bar,
r30 applies its probability only to qualifying Under promotions. All other H+R+RBI
rows retain the r29 probability path.

## Rejected production changes

- Batter doubles Under showed high raw accuracy (89-19) but only 68.9% bootstrap
  support for positive ROI because prices were typically -450; it was not added.
- RBI Under was 276-105 but only 53.6% bootstrap support for profitability; it was
  not added.
- Batter strikeouts Over was 27-14 but profitability bootstrap support was 52.9%
  and the last three decisions lost; it was not added.
- No pitcher challenger beat the market/current controls reliably. The r29 weak
  workload guard and the prospective pitcher shadow remain authoritative.

## Release behavior

r30 changes only qualifying `batter_hits_runs_rbis` Under rows. It stamps the
market version `actionability_v6_empirical_market_anchored_under_accuracy`, writes
the auditable independent and final probabilities used for the promotion, uses a
0.25-unit Best Angle stake, and records
`VALIDATED_HRR_UNDER_ACCURACY_BEST_ANGLE`. It does not create another writer or
lease; the shared sport-scoped `prediction_pipeline` path is unchanged.
