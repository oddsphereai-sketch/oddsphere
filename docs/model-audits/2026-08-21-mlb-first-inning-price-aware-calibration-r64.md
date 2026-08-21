# MLB first-inning price-aware calibration r64

Date: 2026-08-21
Status: release candidate
Audit mode: read-only; no production rows were written

## Scope and champion

This audit covers MLB first-inning probability calibration and public action
classification only. The incumbent is the r63 production line with the r61
first-inning bridge: a 25% independent matchup probability / 75% same-book
two-sided no-vig market blend, directional NRFI at 52% or higher, YRFI at 48%
or lower, and a nonnegative selected-side no-vig edge for a Lean.

The authoritative writer remains `lib/services/predictionRecordService.ts`
under the shared sport-scoped `prediction_pipeline` lease. No independent
writer, refresh, provider call, database mutation, or lock-path change is added.
Moneyline and Total behavior is unchanged.

## Question and method

The operational symptom was a board dominated by NRFI Leans without enough
separation between strong NRFI, marginal NRFI, and Toss-Up. The audit therefore
tested whether the probability head had drifted, whether starter features
needed recalibration, and whether offered price or market movement could safely
identify weak marginal NRFI calls.

The source query returned 924 locked prediction rows from 2026-06-07 through
2026-08-20. They represented 922 unique `game_id|locked_at` observations. Two
duplicate lock rows—record IDs 63066/63661 for game 25653 and 71827/71872 for
game 27139—were collapsed before scoring, so release-era duplicates could not
receive extra weight. One of the 922 unique observations lacked a complete
required model/outcome tuple; 921 entered the metrics:

| Split | Dates | Games | Observed NRFI |
| --- | --- | ---: | ---: |
| Train | Jun 7-Jul 10 | 441 | 49.2% |
| Development | Jul 11-Jul 31 | 218 | 55.0% |
| Validation | Aug 1-Aug 10 | 129 | 47.3% |
| Latest diagnostic | Aug 11-Aug 20 | 133 | 55.6% |

All policies were replayed at the stored locked price. The audit reports
accuracy, one-unit returns, Brier score, log loss, board count, directional mix,
and paired promotions/demotions. The latest window is diagnostic rather than a
second tuning set.

## Selected policy

The probability head remains unchanged. The r64 decision policy is:

1. Preserve every existing data-quality, starter, lineup, and freshness hold,
   and preserve the existing provisional grade cap.
2. If the incumbent decision is NRFI with posterior below 54%, require the
   posterior to equal or exceed the actual offered NRFI break-even probability.
   Otherwise classify it as Toss-Up.
3. As the paired promotion route, reconsider only an ordinary probability-band
   Toss-Up whose posterior favors NRFI. Promote it to NRFI only when the NRFI
   posterior clears its actual offered break-even probability.
4. Never flip an existing directional pick to the opposite side.

The analogous YRFI exception is deliberately disabled. Only one YRFI row
qualified across the full history and none qualified in the latest window,
which is insufficient held-out evidence for a new live route. The existing
validated YRFI decision at posterior NRFI of 48% or lower is unchanged.

This deliberately distinguishes forecast direction from bet quality. A 53%
NRFI forecast can remain directionally NRFI while being a Toss-Up at a price
that requires 55% to break even.

## Results

| Split | Incumbent actions | Incumbent record / units | r64 actions | r64 record / units | NRFI share old -> new |
| --- | ---: | --- | ---: | --- | --- |
| Train | 204 | 125-79 / +20.898 | 176 | 107-69 / +17.282 | 71.1% -> 66.5% |
| Development | 88 | 52-36 / +4.103 | 79 | 47-32 / +4.988 | 70.5% -> 67.1% |
| Validation | 66 | 36-30 / -2.758 | 58 | 35-23 / +3.818 | 63.6% -> 58.6% |
| Latest diagnostic | 66 | 37-29 / -0.259 | 51 | 29-22 / +0.050 | 71.2% -> 62.7% |
| Combined | 424 | 250-174 / +21.984 | 364 | 218-146 / +26.138 | 69.8% -> 64.8% |

Combined accuracy rises from 59.0% to 59.9%. The replay loses 60 of 424 actions
(14.2%). Because the probability head is unchanged, Brier
and log loss are identical by construction; this is an action-calibration
release, not a claim of improved raw probabilities.

### Paired board impact

| Split | Promotions | Promotion result | Demotions | Demoted result |
| --- | ---: | --- | ---: | --- |
| Train | 12 | 7-5, +1.744u | 40 | 25-15, +5.360u |
| Development | 7 | 4-3, +1.250u | 16 | 9-7, +0.364u |
| Validation | 4 | 3-1, +1.976u | 12 | 4-8, -4.600u |
| Latest diagnostic | 0 | 0-0, 0.000u | 15 | 8-7, -0.309u |
| Combined | 23 | 14-9, +4.970u | 83 | 46-37, +0.815u |

The live promotion exception is NRFI-only because its 23 historical qualifiers
were 14-9, +4.970u, including 3-1 on validation. The single analogous YRFI
qualifier is explicitly rejected as insufficient evidence. No promotion
bypasses price or availability gates.

## Exact current-slate comparison

The operator reran the policy without writes against the 15 unique August 21
records at `2026-08-21T14:23:52.314Z`; all were still unlocked.

| Decision | r63 | r64 |
| --- | ---: | ---: |
| NRFI | 10 | 5 |
| YRFI | 0 | 0 |
| Toss-Up | 5 | 10 |
| Held | 0 | 0 |

There were zero promotions and five demotions:

| Matchup | Posterior NRFI | NRFI price | YRFI price | r63 -> r64 |
| --- | ---: | ---: | ---: | --- |
| WSH@MIA | 52.99% | -120 | -110 | NRFI -> Toss-Up |
| NYM@CWS | 53.70% | -130 | -103 | NRFI -> Toss-Up |
| LAA@TEX | 53.88% | -130 | +100 | NRFI -> Toss-Up |
| CHC@SEA | 53.38% | -125 | -107 | NRFI -> Toss-Up |
| PIT@LAD | 53.52% | -125 | -105 | NRFI -> Toss-Up |

This exact slate is a larger reduction than the 14.2% historical average, but
it is the intended transparent effect on a board containing many 52%-54% NRFI
forecasts at expensive prices. It leaves five stronger NRFI calls, does not
manufacture a YRFI, and matches the product requirement that half-slate
Toss-Ups are acceptable when the evidence is marginal. A subsequent price
refresh can still change an unlocked decision through the one authoritative
writer; locked records remain immutable.

## Rejected alternatives

- Market-movement override: only 50 latest rows had usable movement history and
  zero train/development/validation rows did. The seven incumbent NRFI actions
  moving at least 0.5 percentage points toward YRFI were 3-4, -1.463u, but that
  sample cannot support a live rule.
- Train-only logistic market-residual recalibration: latest accuracy was 46.0%
  with -13.598u and materially worse probability scores.
- Independent-model weights from 0% through 35%: lower weights sometimes helped
  a window but supplied no tested promotion path; higher weights added losing
  actions and did not solve NRFI concentration reliably.
- Asymmetric NRFI/YRFI weights: held-out promotions were unstable or negative
  and the probability changes lacked consistent calibration gains.
- Empirical-Bayes shrinkage of starter first-inning ERA and WHIP additions:
  later-window gains did not replicate chronologically; some variants made the
  board more NRFI-heavy.
- Full posted-price EV gate: removed too much of the board and nearly eliminated
  the YRFI lane.

## Release identifiers and rollback

- Calibration: `mlb_public_calibration_v24_first_inning_price_aware_2026_08_21`
- Decision: `mlb_daily_edge_decision_2026_08_21_r64`
- Rule bundle: `mlb_daily_edge_rule_bundle_v52_2026_08_21`
- FI probability head (unchanged): `mlb_first_inning_fi_v4_market_backed_weight25_2026_08_20`
- Grade policy: `mlb_public_grade_policy_v42_first_inning_price_aware_2026_08_21`
- Correction: `mlb_prediction_corrections_v16_first_inning_marginal_price_gate_2026_08_21`

Rollback is the r63 registry with calibration v23, rule bundle v51,
grade policy v41, and correction v15. Locked rows remain immutable. Hold or
rollback if production shows mixed release identifiers, missing offered prices
presented as ordinary Toss-Ups, an unexpected board collapse, writer overlap,
or disagreement between stored and member-visible decisions.

## Evidence and verification

- Reproducible audit: `scripts/operator/audit-mlb-first-inning-calibration-r64.ts`
- Focused FI tests: `scripts/test-mlb-first-inning-v2.ts`
- Pipeline version/lease tests: `scripts/test-mlb-pipeline-safety.ts`
- Record and lock tests: `scripts/test-prediction-record-service.ts`
- Mandatory gate: `npm run verify:model-change`

External methodological references: Kull et al., *Beta calibration: a
well-founded and easily implemented improvement on logistic calibration*
(AISTATS 2017), and MLB Baseball Savant expected-stat documentation. The audit
used simple structured candidates and chronological partitions rather than a
high-variance nonparametric calibrator because the available sample is modest.
