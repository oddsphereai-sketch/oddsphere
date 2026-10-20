# NBA extreme-margin calibration predeclaration

Date: 2026-10-20

Status: outcome-blind candidate contract; no production authority before all gates pass

## Scope and current authority

This audit addresses whether the NBA independent score model compresses large
expected margins and whether its residual distribution correctly represents a
game finishing with an absolute margin of at least 20 points. It does not treat
the realized frequency of 20-point outcomes as the required frequency of
20-point conditional means: ordinary game variance can create a blowout even
when the best pregame expected margin is materially smaller.

Current production authorities are:

- model / prediction record:
  `nba_professional_unified_2026_10_20_r10_minimum_coherent_crossing`;
- independent artifact:
  `nba_professional_deployment_candidate_2026_10_15_r15_comparable_benchmark_gates`;
- market marriage:
  `nba_market_marriage_2026_10_20_r10_minimum_coherent_crossing`;
- unified point projection:
  `nba_unified_final_projection_2026_10_20_r4_minimum_coherent_crossing`;
- professional reader:
  `nba_professional_market_reader_2026_10_20_r6_structural_qualification`;
- grade policy: `nba_grade_policy_2026_10_16_r5_market_specific_accuracy`;
- lock coherence: `nba_lock_coherence_2026_10_15_r2_unified_score_tuple`; and
- sole writer: `/api/cron/nba-daily-refresh`, under
  `prediction_pipeline:nba`.

Any accepted change is limited to the independent margin mean and/or its
margin-residual distribution. The independent Total, Total distribution,
market-reader qualification, exact quote selection, prices, grades, stakes,
provider collection, writer, cadence, lease, tracking boundary, and stored
locked payloads remain unchanged unless the audit explicitly reports a
necessary coherent downstream release bump. No market line, price, movement,
or split may enter the independent calibration.

## Chronology and endpoints

- Build the frozen base independent model on seasons strictly before 2024.
- Fit or select every calibration candidate on 2024 only.
- Open 2025 once after the recipe is frozen for confirmation.
- Report 2024 selection and 2025 confirmation separately.
- Treat prior reports that opened 2025 as disclosed development history; no
  result is described as a pristine future holdout.

The audit must report:

1. team-score, margin, and Total MAE;
2. winner accuracy, Brier score, and log loss;
3. Spread and Total direction, selected-underdog accuracy, and +3/+6 Spread
   accuracy;
4. expected-margin distribution at 10, 15, and 20 points;
5. actual 20-plus outcome frequency and forecast probability calibration,
   including Brier, log loss, calibration-in-the-large, and reliability bins;
6. the same metrics for closing-spread bands 0-2.5, 3-5.5, 6-8.5, 9-11.5,
   12-plus, and the combined 10-plus cohort; and
7. favorite/underdog selection balance and accuracy inside the 10-plus cohort.

Closing market values are evaluation-only segmentation fields. They may not be
features, anchors, targets, or calibration inputs for the independent model.

## Frozen bounded candidate family

The incumbent is the unmodified r15 ridge mean with its released normal
residual distribution. Candidates are limited to:

1. a selection-season affine recalibration of the independent margin;
2. a zero-centered, sign-preserving monotone piecewise-linear calibration of
   absolute independent margin, with fixed knots at 3, 6, 9, and 12 points and
   ridge penalties 10, 100, or 1,000;
3. a magnitude-conditioned normal residual scale using the fixed absolute-mean
   bands 0-3, 3-6, 6-9, and 9-plus, with each band shrunk toward the released
   global scale by fixed pseudo-counts 25, 50, or 100; and
4. the Cartesian combination of the selected mean calibration and selected
   residual-scale calibration; and
5. a symmetric, zero-mean two-component normal residual mixture. The bounded
   grid uses core-scale multipliers 0.75, 0.85, or 0.95, tail weights 0.05,
   0.10, 0.15, or 0.20, and tail-scale multipliers 1.5, 2.0, or 2.5, all
   relative to the released global residual scale. This family may change
   probability calibration but may not move the independent or final score
   mean.

All transformations are fitted on selection outcomes only. The mean mapping
must be continuous, monotone, sign-preserving, and exactly zero at a zero base
margin. Candidate selection is lexicographic: pass every selection gate, then
minimize 20-plus Brier, margin MAE, team-score MAE, and recipe complexity.

The mixture family was predeclared after the original single-normal candidate
family produced zero selection-eligible candidates and before any mixture was
scored. That first-stage rejection showed the exact anticipated diagnostic
pattern: widening a single normal could improve 20-plus calibration while
worsening winner probability calibration. The extension tests the narrower
hypothesis that the released residual distribution has a sharp center and
heavier tails; it does not authorize arbitrary score widening or a search on
the confirmation season.

## Required confirmation gates

An accepted candidate must, on 2025 confirmation:

1. improve 20-plus Brier and log loss;
2. reduce absolute 20-plus calibration-in-the-large error;
3. not worsen overall team-score, margin, or Total MAE;
4. not worsen winner accuracy, winner Brier, or winner log loss;
5. not worsen main Spread, Total, selected-underdog, +3, or +6 direction;
6. not worsen Spread accuracy in the combined 10-plus closing-spread cohort;
7. preserve finite coherent home score, away score, margin, Total, and
   probabilities for every game; and
8. remain completely market-free before the existing qualified reader.

If no candidate clears every gate, the incumbent remains live. A failed audit
must still distinguish normal outcome variance from a genuine expected-margin
or distribution-calibration defect; it may not justify arbitrary widening.

## Production gates if accepted

Before publication, advance every affected immutable release identifier,
export one portable runtime artifact, update the current-release registry,
report exact current-board score/pick/probability/grade promotions and
demotions, preserve locked-reader precedence, and retain the sole writer and
lease. Run focused NBA model/distribution/reader/writer/lock tests, TypeScript,
`npm run verify:model-change`, latest-main integration safety, protected pull
request checks, and post-deploy release, snapshot, writer, lease, coverage,
coherence, and lock verification.

## Rollback

Roll back future unlocked computation to r10/r15/r4 if the candidate produces
mixed releases, worsens a frozen confirmation gate, changes Total without a
coherent margin-only reason, contracts the actionable board without balanced
and tested replacements, changes a locked payload, creates writer overlap, or
causes reader/member disagreement.
