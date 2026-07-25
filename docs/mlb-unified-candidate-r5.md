# MLB unified Daily Edge r5 release decision

Decision release: `mlb_daily_edge_decision_2026_07_25_r5`

This release preserves the r4 projection and probability heads and repairs one
moneyline grade-path contradiction: a generic Lean must have non-negative
expected value at its stored price. It does not apply that gate to separately
validated promotion sleeves.

## Authoritative path

1. `auto_v2.2_mlb_full_game_projection`
2. `mlb_projection_core_v2_2_baseline_2026_07_08`
3. Market-specific probability head:
   - Moneyline: `mlb_moneyline_regularized_k01_cap6_champion_guardrails_2026_07_11`
   - Total: `mlb_total_market_read_k04_cap8_thin_gap_guard_2026_07_11`
4. `predictionRecordService` as the only final decision writer
5. `member_facing_lock_v2_writer_authority` as the immutable reader/tracking contract
6. The shared sport-scoped `prediction_pipeline` lease for every prediction-writing job

## Release policy

`r4` remains the rollback baseline. `r5` changes only generic moneyline Lean
eligibility and its audit stamp. Projection, probability, side-selection,
totals, first-inning, writer, lease, and reader behavior are unchanged.

### Moneyline

- Keep the current probability head.
- Generic Leans require non-negative expected value at their stored price and
  receive rule stamp `ml_generic_lean_positive_ev_v1_2026_07_25`.
- Evaluate genuine final-side inversions, tight-market-price Best Angles, and
  ordinary Moneyline grades as three separate rule families.
- The 60%+ probability band remains a shadow recalibration target; it must not
  be changed under this release identifier.

### Totals

- Keep the current probability head.
- A correction trigger is `NO_PLAY`; it is not permission to bet the opposite
  side.
- Keep the released validated-Lean behavior frozen, but do not infer current
  profitability from its name or from rows lacking a decision-release stamp.
- Keep the current Total Best Angle behavior frozen while exact-release
  evidence accumulates. The broader historical sleeve was positive, but the
  current-head and clean-confirmed subsets are not yet independently decisive.
  Do not widen it, and do not demote it without a tested paired promotion and
  board-count report.
- Generic Total Leans and automatic flips are excluded from the official card.
- The 55%+ probability band and every flip family remain separate shadow
  candidates.

## Evidence interpretation

- Exact `r5` performance begins at zero and is reported only from rows stamped
  `r5`. Historical r4 results are never relabeled.
- Broader probability-head evidence may include earlier decision releases only
  when the active probability-head stamp is identical; it is labeled
  current-head evidence, never exact-current evidence.
- Historical flip and grade cohorts are supporting rule evidence only.
- Unit tests prove implementation behavior, not predictive profitability.
- Promotion requires an untouched chronological holdout and prospective shadow
  evidence at real locked prices.
- A release-level win/loss result cannot validate its component rules. Every
  action rule must also be evaluated against its no-rule/original-side
  counterfactual and stratified by probability head, decision release, and
  chronological period.

## Rule-by-rule evidence through July 24

These cohorts use the current probability heads unless explicitly labeled
historical. They are evidence about the individual rule, not proof of the
entire `r4` bundle.

| Rule family | Settled | Record | ROI | Qualification |
| --- | ---: | ---: | ---: | --- |
| ML tight-market-price Best Angle | 9 | 7-2 | +30.8% | Promising; sample is too small for independent validation |
| Genuine final-side ML inversion actionable under current rules | 1 | 1-0 | +76.9% | Insufficient current-head evidence; older 19-bet history is supporting only |
| Unattributed ML actionables | 14 | 7-7 | -9.6% | Not valid current-rule evidence |
| Negative-EV generic ML Leans removed by r5 | 7 | 3-4 | -27.3% | Current-head forward evidence; arithmetic coherence repair |
| Total validated-Lean marker | 13 | 8-5 | +19.1% | Promising; rows predate decision-release stamping and are not exact-r4 proof |
| Total clean-confirmed Best Angle | 8 | 4-4 | -6.2% | No demonstrated advantage |
| Unattributed Total actionables | 15 | 6-9 | -19.0% | Not valid current-rule evidence |

Totals flip rules are not pooled. The current shipped history shows strong
regime instability:

- Market-aware total correction: +10.172 paired units in the week of July 13,
  then -9.573 paired units in the week of July 20.
- Mid-edge inversion: 2-5 and -5.430 paired units versus the original side.
- Market-opposed public-conflict correction: positive in its first three rows,
  then -2.388 paired units in the week of July 20.
- Mean-side selector: mixed and small in the current-head period.

Accordingly, no totals flip family is authorized as an automatic bet in `r5`.
Correction triggers remain stand-down evidence only.

## Paired board impact

The demotion is paired with the retained tight-market-price Best Angle
promotion rather than a new data-mined promotion:

- Current-head generic negative-EV Lean cohort removed: 7 bets, 3-4,
  -1.912 units, -27.3% ROI.
- Current-head actionable moneylines before: 24 bets, 15-9, +2.205 units,
  +9.2% ROI.
- Current-head actionable moneylines retained: 17 bets, 12-5, +4.117 units,
  +24.2% ROI.
- Current live-slate dry run: 3 moneyline actions become 2; one negative-EV
  generic Lean is demoted and two tight-price Best Angles remain.
- Totals board count and every totals decision are unchanged.

## Required audit

Run:

```bash
npx tsx --env-file=.env.local scripts/operator/audit-mlb-unified-candidate.ts
```

The audit reports release coherence, exact-current results, current-head
calibration, actionable grades, moneyline inversions, totals corrections, and
released totals sleeves without blending those evidence classes.

## Validation status

- Implementation and reader/writer coherence tests pass.
- r5 has no settled exact-release sample before deployment; it must never be
  presented as a statistically certain profitability guarantee.
- The changed rule is supported by current-head forward evidence, improves the
  locked-price counterfactual, and restores the model's own negative-EV gate.
- Unchanged rules retain their separate evidence classifications; r5 does not
  claim that every rule is independently proven.
- Unattributed historical rows are excluded from current-rule validation.
- Probability recalibration and new promotions remain shadow-only.

## Promotion gate

Any new probability, side, grade, or stake behavior requires:

1. a new immutable release identifier;
2. chronological development, calibration, and untouched holdout results;
3. prospective shadow evidence;
4. locked-price ROI, Brier, log loss, calibration gap, and sample size;
5. paired promotions and demotions with net board-count impact;
6. `npm run verify:model-change` plus focused tests;
7. deployment from a clean intentional commit and live release verification.
