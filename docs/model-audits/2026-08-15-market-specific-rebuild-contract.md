# MLB and WNBA market-specific rebuild contract

Status: pre-registered research and release-safety contract
Date: 2026-08-15
Production effect at creation: none

## Objective

Rebuild the MLB and WNBA prediction and actionable-selection evidence from raw,
immutable, point-in-time observations. Previous research conclusions, selected
thresholds, historical cohort claims, and proposed sleeves are not candidates or
evidence in this program. Existing code may be inspected only to identify the
current production interface, authoritative writer, immutable release stamp, and
raw field provenance.

The program must give an evidence-backed disposition for:

- MLB moneyline;
- MLB full-game total;
- MLB first inning, reported separately for NRFI and YRFI;
- WNBA moneyline;
- WNBA full-game total;
- WNBA spread.

For each market it must separately evaluate the projection or probability head,
calibration, market interpretation, side selection, execution price, and
actionable grade. A market is not declared healthy because another layer or an
older era performed well.

## Immutable decision unit

The unit of evaluation is one market decision at its persisted decision or lock
timestamp. Every input must have been observable at or before that timestamp.
The dataset must retain:

- sport, slate date, game identity, scheduled start, and lock timestamp;
- selected side and opposite side;
- model, calibration, decision, rule-bundle, grade-policy, and writer releases;
- model probability or distribution and independent projection when available;
- selected and opposite offered prices from the same decision clock;
- paired no-vig reference probability when both prices exist;
- line value for totals and spreads;
- source-aware price path, splits, lineup/starter/context, and their timestamps;
- final outcome, actual score, and first-inning runs where applicable;
- public grade, action rule, no-bet/hold reason, and stake metadata.

Unavailable evidence remains null with a reason. A different provider, later
observation, inferred complement, repaired field, or current database value may
not silently replace unavailable point-in-time evidence.

## Leakage controls

1. Sort and split by slate date, never randomly by row.
2. Fit every learned transform only on dates strictly earlier than its evaluation
   date.
3. Treat observations from the same game and date as correlated for uncertainty.
4. Do not use closing prices as predictive features at an earlier decision time.
5. Do not infer the opposite-side return without its actual locked price.
6. Do not reconstruct a historical feature from a value first observed after
   lock.
7. Keep release eras explicit. A release may be replayed on a common snapshot
   only when its required inputs are actually reconstructable.
8. Count every searched model, feature family, threshold family, and interaction.
9. The final evaluation partition is scored once after candidates and parameters
   are frozen. Because aggregate recent results were known before this contract,
   it is described as a locked final evaluation, not a discovery-blind holdout.
10. A production behavior change additionally requires untouched forward shadow
    evidence unless an independently pre-existing external or prior-season cohort
    supplies a genuinely discovery-blind test.

## Chronological evaluation

The audit chooses date boundaries mechanically from the eligible date sequence:

- earliest 55% of dates: model development;
- next 15%: probability calibration and parameter selection;
- next 15%: validation and candidate-family selection;
- latest 15%: locked final evaluation, scored once.

In addition, expanding-window rolling-origin folds evaluate stability through the
complete eligible history. Boundaries are shared across candidates within a
sport/market. A row never moves to an earlier partition to satisfy a sample-size
target.

If a market lacks enough dates or point-in-time coverage for this design, its
disposition is `insufficient_evidence_shadow`; the audit must not compensate by
mixing sports, markets, release eras, or repaired future data.

## Fresh candidate families

The following families are allowed. Their parameters must be learned only inside
development/calibration partitions.

### Probability and projection

- current persisted model probability as the incumbent;
- paired no-vig market probability as the market baseline;
- independent projection probability when genuinely market-independent;
- regularized logistic recalibration of the incumbent;
- regularized combination of incumbent and market probability;
- side-conditional calibration only when the sample supports separate fits;
- a market-specific mixture only when its pregame gating features improve
  rolling-origin proper scores.

No unrestricted feature search, outcome-derived rule list, or opaque language
model decision is allowed.

### Market diagnosis

Market evidence is descriptive until validated. The permitted diagnoses are:

- `model_market_confirmed`;
- `model_led_contrarian`;
- `validated_public_fade`;
- `market_resistance_stand_down`;
- `opposite_side_independently_qualified`;
- `mixed_or_noisy_market`;
- `stale_or_incomplete_evidence`;
- `no_price_adjusted_edge`.

Movement and splits may modify probability, uncertainty, or actionability only
through a source-aware, time-aware candidate evaluated out of sample. Neither a
move nor a ticket/money percentage directly selects or flips a side.

### Actionability

Actionability is a second-stage decision over a frozen prediction. Candidate
features may include calibrated probability, paired market probability, offered
break-even probability, expected value, price, evidence quality, and a validated
market diagnosis. The selected side cannot change inside the grade model.

A stand-down removes the original candidate only. A flip is evaluated as a new
opposite-side candidate and requires its own probability, locked price, positive
expected value, data-quality eligibility, and out-of-sample evidence.

Before inspecting any flip results, the audit was amended to evaluate both
`original` and `opposite` directions at the same five predeclared EV margins.
For the opposite direction, probability is the complement of the frozen
selected-side probability, the outcome is inverted, and profit uses the paired
opposite-side price captured in the same locked snapshot. A flip cohort must
contain at least 20 validation observations across at least 10 dates before it
can be considered, in addition to every actionable acceptance gate below. This
is an anti-signal test, not permission to invert a losing cohort after the fact.

Before inspecting cohort-flip output, the audit was further amended to search
mechanically defined, interpretable strata rather than only a whole-market
opposite policy. Single dimensions are side; fixed American-odds bands
(`<=-151`, `-150..-121`, `-120..-101`, `+100..+129`, `>=+130`); fixed
model-minus-market bands (`<=-5pp`, `-5..-2pp`, `within 2pp`, `+2..+5pp`,
`>=+5pp`); ticket-share bands (`<35%`, `35-49%`, `50-64%`, `>=65%`);
money-minus-ticket gap (`<=-10pp`, within 10pp, `>=+10pp`); paired movement
(`<=-2pp`, within 2pp, `>=+2pp`); and the predeclared market diagnosis.
The only two-way families are side×odds, odds×model-market gap,
odds×money-ticket gap, diagnosis×odds, diagnosis×money-ticket gap, and
diagnosis×movement. All use the same five EV margins and the same 20-row,
10-date minimum. Because this adds multiple hypotheses, validation bootstrap
positivity must reach 99% (plus positive best-day removal), followed by the
ordinary locked-final robustness gates. Any survivor is forward-shadow only;
the locked final sample is not discovery-blind.

## Metrics

Report for every market, partition, rolling fold, side, grade, and material price
or evidence stratum:

- rows, independent games, and dates;
- wins, losses, pushes, accuracy, and confidence interval;
- mean predicted probability and calibration gap;
- Brier score, log loss, reliability bins, and ranking lift;
- locked-price units, ROI, maximum drawdown, and price coverage;
- closing-line value only where a defined point-in-time reference exists;
- actionable versus eligible-pool lift;
- promotions, demotions, retained actions, and net board-count change;
- market mix and same-game/date concentration;
- date-cluster bootstrap probability of positive units;
- missingness and exclusion reasons;
- number of candidate families and variants searched.

Accuracy is never used without price context. ROI is never used without
calibration, sample, stability, and search-count context.

## Champion and production acceptance

### Probability or projection component

A challenger may become champion only when it:

- improves or preserves both Brier score and log loss versus the incumbent and
  paired market baseline in the locked final evaluation;
- shows non-negative paired improvement in a majority of rolling-origin folds;
- does not create a materially worse calibration gap in any supported side;
- remains stable under source ablation and reasonable regularization changes;
- has complete release and input provenance.

### Market diagnosis component

A diagnosis may affect actionability only when:

- the required price and split paths are complete and point-in-time valid;
- the effect is stable across chronological partitions and nearby model
  regularization;
- it adds value beyond the paired market probability and independent model;
- confirm, contrarian, resistance, and mixed states are evaluated symmetrically;
- missing evidence produces a data-health state, not a fabricated neutral signal.

### Actionable component

A changed action cohort must:

- have positive locked-price units in validation and locked final evaluation;
- show positive actionable lift over an eligible, price-comparable pool;
- have date-cluster bootstrap probability of positive units of at least 95%;
- remain positive after removing its single best date;
- have no unexplained side, price, source, or release concentration;
- evaluate a balanced replacement pool for every proposed demotion;
- report net board count rather than target a quota.

Failure of a production gate results in a shadow/audit disposition. It does not
authorize a weaker threshold to preserve board size.

## Required market disposition

Each market ends with exactly one disposition for every layer:

- `retain_current_champion`;
- `promote_new_champion`;
- `shadow_challenger`;
- `rebuild_required`;
- `insufficient_evidence_shadow`.

The report must explain what the layer does correctly, what it does incorrectly,
what evidence is missing, and the next falsifiable requirement. There are no
undocumented judgment calls.

## Release safety

Any qualified production change must:

- receive new immutable model/calibration/decision/rule/grade identifiers as
  applicable;
- update `docs/current-model-releases.md` in the same commit;
- preserve the authoritative writer and sport-scoped `prediction_pipeline` lease;
- preserve immutable locked records and release-separated reporting;
- include focused tests, common-snapshot paired replay, current-board impact,
  rollback identifiers, and `npm run verify:model-change` results;
- deploy only from the clean intentional commit requested for this program.

Until all gates pass, the program is read-only with respect to live predictions,
grades, stakes, and tracking results.
