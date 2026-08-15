# Immediate MLB rebuild release contract — 2026-08-15

## Operating constraint

Oddsphere does not use prospective forward-shadow operation as a release gate.
The replacement path is point-in-time historical replay, chronological
walk-forward validation, an exact downstream board comparison, a versioned
production release, and an explicit rollback. Perfection and universal
statistical significance are not requirements. The goal is to maximize the
supported improvement over the current production system.

## Scope

This phase evaluates MLB moneyline, full-game total, and first-inning plus WNBA
moneyline, total, and spread as six separate champion-model and action-selection
problems. Production changes may alter only a market whose complete champion
and board replay qualifies. It may not alter player props, staking, cron, lease,
or writer ownership behavior.

Current releases at entry:

- projection runtime: `v2_2`;
- public calibration: `mlb_public_calibration_v19_guarded_signed_market_evidence_2026_08_10`;
- decision release: `mlb_daily_edge_decision_2026_08_14_r46`;
- rule bundle: `mlb_daily_edge_rule_bundle_v45_2026_08_14`;
- grade policy: `mlb_public_grade_policy_v36_first_inning_board_endpoint_coherence_2026_08_14`;
- authoritative writer: `lib/services/predictionRecordService.ts` under the
  MLB-scoped shared `prediction_pipeline` lease.

WNBA releases at entry:

- model: `wnba_v1_1_team_identity`;
- distribution: `wnba_market_heads_value_calibrated_2026_08_02_v3`;
- calibration schema: `wnba_core_calibration_v1`;
- grade policy: `wnba_grade_policy_v6_authoritative_reader_grade_2026_08_13`;
- prediction-record contract: `wnba_prediction_record_contract_v3_paired_market_snapshot_2026_08_15`;
- authoritative model writer: `lib/services/wnba/runWnbaModel.ts`;
- tracking writer: `lib/services/wnba/buildWnbaPredictionRecords.ts` under the
  WNBA-scoped shared `prediction_pipeline` lease.

## Candidate discipline

Candidates use only immutable inputs available at the decision timestamp. They
are fitted on earlier dates and evaluated on later dates. Allowed families are
regularized probability calibration, model/market/projection combinations, and
interpretable action policies using offered break-even probability, side,
fixed odds bands, model-market gap, paired movement, and source-aware
money/ticket relationships. Opposite-side candidates require their actual
point-in-time opposite price and are evaluated as independent actions.

The locked de-vigged market consensus is included as a probability candidate,
not merely a benchmark. If it wins, it becomes the base probability anchor;
independent projection residuals and market-context evidence must then earn any
departure from that anchor and any actionable selection.

The probability search also permits an adaptive symmetric recalibrator. For
each chronological origin it fits only on the earlier 75% of available dates,
tests the recalibration against the incumbent on the trailing 25%, and applies
a zero-intercept logit compression to the next unseen block only when both
Brier score and log loss improved on at least 10 common trailing rows. Otherwise
it is exactly the incumbent (`coefficient = 1`). This is a deterministic
completed-outcome update rule, not an outcome-aware same-day switch.

Projection-edge candidates include a side-preserving specification with zero
intercept and a non-negative edge coefficient. For a projection-aligned picked
side, it cannot cross below 50%. Any unconstrained projection model that does
cross below 50% is classified as an opposite-side diagnostic and cannot create
an actionable flip without the exact locked opposite price.

Price-aware selected-side candidates are also replayed with a structural 50%
picked-side floor. This floor is not an action threshold; it prevents a
published recommendation from retaining one side while assigning that side a
sub-50 probability.

No candidate may be selected solely because the current rule lost. Thresholds
and interactions searched are counted, and the final implementation must be a
deterministic rule over fields already available to the authoritative writer.

Before inspecting scoped-policy results, the action tournament was amended to
permit only these fixed execution-price scopes: all prices, all favorites,
`-150..-101`, `-120..+129`, `+100..+129`, and `>=+130`. A scoped replacement
preserves the current production decision outside its scope. These are
structural sportsbook-price regions, not outcome-derived cut points.

No global `-120` or `-200` action ceiling is introduced. The MLB totals
`-120..+129` scope means the replacement decision runs only there and preserves
production decisions outside it. The MLB moneyline favorite promotion applies
at every negative price when the model clears that price's actual break-even
probability.

## Relative-improvement objective

Probability candidates are ranked by chronological out-of-sample Brier score
and log loss on common rows, with locked-price decision utility as a secondary
objective. A replacement does not need to beat every comparator in every fold,
but it must improve the incumbent's combined out-of-sample proper scores and
must not show a material latest-period collapse.

The probability champion is selected before action-policy optimization. To
qualify, a family must improve both combined validation-plus-latest Brier score
and log loss against production on common rows, improve both scores in at least
half of the rolling-origin folds, and limit any latest-partition regression to
at most `0.002` Brier and `0.005` log loss without regressing on both metrics.
It must also retain nontrivial discrimination: the standard deviation of its
validation-plus-latest probabilities must be at least `0.002`. A constant 50%
control may diagnose that the incumbent is harmful, but it is not a usable
probability champion.
Among qualifiers, the lowest combined log loss wins, with Brier score as the
tiebreaker. Market-baseline comparisons are reported independently. Action
thresholds, scoped exceptions, and flips are then evaluated only on that
probability champion; they may refine its decisions but may not substitute a
different probability family selected solely for historical units.

Action candidates are ranked by paired unit improvement over the current board
on the same evaluation dates. Accuracy is descriptive; price-adjusted units are
primary. The selected policy must:

- improve paired units over production in both validation and the locked latest
  partition, or produce a larger combined gain with no material latest-period
  regression;
- remain improved after removing its best date;
- avoid dependence on one release era, side, or isolated odds point;
- report retained, promoted, and demoted actions and total board change;
- test an eligible promotion pool alongside every demotion;
- retain at least 75% of the current actionable count unless the removed cohort
  has independently strong evidence of negative value and the user-visible
  board impact is explicitly accepted;
- preserve price, freshness, data-quality, hold, and correction safeguards.

For the stability floor, a candidate may not lose more than `5.0u` in any
rolling-origin fold. Across validation plus latest data, no side or fixed odds
band represented by at least five candidate/current actions may contribute a
paired loss worse than `-2.0u`. These thresholds operationalize the existing
anti-regime-dependence requirement; they are applied to every market and are
not used to invent new cut points.

Among candidates that clear those floors, choose the largest stable paired-unit
gain rather than the smallest possible change. A narrower cohort may ship when
the broad market replacement does not qualify. A validated flip may ship only
for its qualifying cohort; there is no blanket inversion.

## Release requirements

Any live change receives new immutable release identifiers, updates
`docs/current-model-releases.md`, preserves locked history, and includes the
exact old-versus-new board replay and rollback identifier. Run
`npm run verify:model-change` and focused suites before the intentional commit.
Deployment and post-release tracking are operational verification, not a
pre-release shadow requirement.
