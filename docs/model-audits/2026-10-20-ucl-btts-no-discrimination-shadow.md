# UCL BTTS No-discrimination audit and forward shadow declaration

Date: 2026-10-20

## Scope

This is a read-only audit. It does not change the live UCL model, probability,
pick, projection, grade, stake, writer, lock, or any stored member record.
The active releases remain the registry releases on `main`.

The question fixed before inspecting confirmation was whether the incumbent's
near-universal BTTS Yes direction could be corrected without degrading proper
probability scores or the coherent Match Result/Total/score projection.

## Incumbent defect

The frozen chronological blocks confirm a direction-selection defect:

| Block | Matches | Actual Yes | Predicted Yes | Accuracy | No recall | Brier | Log loss | AUC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Selection | 126 | 69 | 121 | 55.56% | 5.26% | 0.25069 | 0.69437 | 0.5652 |
| Confirmation | 63 | 37 | 61 | 58.73% | 3.85% | 0.23845 | 0.66943 | 0.6060 |

This is not evidence that the underlying event is usually No. It is evidence
that the incumbent barely discriminates which matches are No.

The candidate did **not** predict No in 34.62% of all matches. It predicted No
in 17/63 confirmation matches (26.98%). There were 26 actual No results
(41.27%), and 34.62% No recall means the candidate found 9 of those 26. The
remaining defect is therefore selection and calibration, not an excessive
share of No predictions.

## Rejected shortcuts

- Plain probability recalibration lowered numbers but did not improve No
  discrimination.
- Letting the existing public-Elo Match Result adjustment reshape BTTS did not
  improve No recall or proper scores.
- A simple team-scoring hurdle improved probability scores in selection but
  did not identify more No outcomes.
- No forced balance, fixed count of No picks, or blanket threshold shift is
  permitted.

## Independent candidate result

A dedicated team-to-score hurdle was trained only on prior-match evidence. Its
inputs are each team's/opponent's scoring and concession occurrence, xG, shots
on target, big chances, shots inside the box, the incumbent scoring rate, and
home/away state. The BTTS probability is the product of the two independently
estimated scoring-occurrence probabilities, reconciled into the existing score
PMF while preserving Match Result, Over 2.5, and expected total.

The candidate passed the selection gate and materially found No outcomes on
untouched confirmation:

| Confirmation metric | Incumbent | Candidate |
|---|---:|---:|
| Predicted Yes | 61/63 | 46/63 |
| Accuracy | 58.73% | 60.32% |
| No recall | 3.85% | 34.62% |
| Team-score MAE | 1.18598 | 1.17892 |
| Brier | 0.23845 | 0.24894 |
| Log loss | 0.66943 | 0.69440 |
| AUC | 0.6060 | 0.5780 |

Because Brier, log loss, and AUC regressed, this candidate is rejected for live
publication. It is a useful feature family, not a production model yet.

## Post-confirmation stability diagnosis

After the confirmation result was opened, additional work is exploratory and
cannot turn the same block into a fresh acceptance set. It isolated coefficient
drift as the main failure mode:

| Confirmation policy | Predicted No | Accuracy | No recall | Brier | Log loss | AUC |
|---|---:|---:|---:|---:|---:|---:|
| Incumbent | 2/63 | 58.73% | 3.85% | 0.23845 | 0.66943 | 0.6060 |
| Frozen selection fit | 4/63 | 58.73% | 7.69% | 0.23475 | 0.66137 | 0.6185 |
| 25% refit / 75% frozen diagnostic | 8/63 | 58.73% | 15.38% | 0.23687 | 0.66578 | 0.6040 |
| Full refit | 17/63 | 60.32% | 34.62% | 0.24894 | 0.69440 | 0.5780 |

The stable model improves probability quality and modestly reduces Yes bias;
the unconstrained refit finds many more No results but becomes poorly
calibrated. The next independent candidate should therefore regularize new
coefficients toward the frozen scorer rather than applying an arbitrary global
probability reduction. Its acceptance evidence must come from the forward
cohort declared below, not further reuse of this confirmation block.

## Expanded six-season tournament

The authenticated provider exposes complete UCL matches and team statistics
for 2020 through 2025. The expanded audit contains 878 matches: 494 forecast
rows from 2020-23 for training, 185 from 2024 for selection, and 189 from 2025
for confirmation.

Three data boundaries were tested:

1. A rolling two-season baseline and rolling two-season scoring features. This
   improves confirmation Brier/log loss but does not improve No direction.
2. An all-history baseline and all-history scoring features. The stacked scorer
   passes every BTTS selection and confirmation gate, but the wider baseline
   slightly degrades confirmation Match Result and Total direction. A wholesale
   foundation replacement is rejected.
3. The production-compatible rolling baseline with all-history features only
   in the scoring head. This preserves Match Result and Total exactly. On
   confirmation it improves BTTS accuracy from 56.61% to 58.20%, No recall from
   4.82% to 12.05%, Brier from 0.24661 to 0.24305, log loss from 0.68606 to
   0.67909, and team-score MAE from 1.13558 to 1.13501. AUC declines from
   0.5813 to 0.5640, so the hybrid remains shadow-only.

The release target is therefore the third boundary after improving its ranking
with domestic scoring/shot history and/or validated target-excluded BTTS market
evidence. Match Result and Total must remain owned by the current foundation;
the longer history is isolated to the team-scoring occurrence head.

## Market-reader evidence and forward declaration

Historical stored UCL line history currently has zero settled matches with a
qualifying multi-book BTTS snapshot at T-60, so a live BTTS market-reader flip
cannot yet satisfy the model-change safety gate.

For the current 18-match slate, the following shadow-only rule is declared
before settlement:

1. Require complete Yes/No prices from at least three named books.
2. Remove each book in turn and calculate a no-vig median from the remainder.
3. A market No exists only if every leave-one-book-out median has BTTS Yes below
   50%. No quota or board-balancing rule is used.

That rule identifies exactly two current shadow No candidates:

- Benfica at Roma: all six available books price Yes below 50%; full median
  Yes is approximately 47.51%.
- AEK Athens at Manchester City: all six available books price Yes below 50%;
  full median Yes is approximately 46.40%.

These are not live pick changes. Existing lock capture already stores the
book-level evidence required to settle this forward cohort; no second writer is
needed.

## Acceptance gate for a production repair

A future candidate must be frozen before outcomes and, on a sufficiently sized
forward cohort, improve all of the following versus the exact incumbent
release: BTTS accuracy, No recall, Brier, log loss, and discrimination/AUC. It
must also preserve or improve Match Result accuracy, Total accuracy, team-score
MAE, board count, and coherent score residuals. Evaluation is by exact release
and T-60 evidence only. Until that gate passes, the current live release stays
unchanged and the candidate remains shadow-only.

## Outcome-blind 2026 domestic-scoring confirmation declaration

Before loading any 2026 final score into the BTTS audit, the next and only
promotion candidate is frozen as follows:

- The current rolling-two-UCL-season score model remains the starting PMF and
  continues to own Match Result, Over 2.5, and expected total.
- A separate team-to-score head adds strictly prior domestic-league scoring,
  concession, goals, shots-on-target, and shot-volume rates to the already
  declared UCL scoring-occurrence, xG, and chance-quality features. Domestic
  values are normalized to their own league/date baseline, use the same
  365-day half-life, and shrink eight effective matches toward that baseline.
- The two team scoring probabilities are multiplied, then stacked with the
  incumbent BTTS logit. Ridge strength is selected only from
  `[1, 10, 25, 50, 100]` on the complete 2025 block after fitting 2020-24.
  The selected form is refit through 2025 exactly once before the 2026 read.
- The coherent solver may change only BTTS and the representative score. It
  must preserve the incumbent Match Result vector, Over 2.5 probability, and
  expected total within `1e-8`.
- The untouched confirmation block is every authenticated 2026 regulation
  final available at the first run. Acceptance requires simultaneous
  improvement over the exact incumbent in accuracy, No recall, Brier, log
  loss, and AUC; team-score MAE may not worsen. A tie does not pass.

If this exact candidate fails any gate, no feature, coefficient, threshold, or
regularization value may be changed after seeing the 2026 results. It remains
shadow-only and the live release stays unchanged.

The preceding six-season audit had already frozen one non-domestic comparator
before any 2026 outcome was loaded: `chance_quality_stacked` with ridge `10`,
the production-compatible rolling-two-season baseline, and all prior UCL
history restricted to the scoring head. It may receive one 2026 forward read
without changing that feature set, ridge, fit/refit policy, threshold, or
coherent solver. This is a previously frozen candidate, not a post-2026 retry.

## 2026 confirmation result

The first authenticated read returned 108 season rows, including 36 completed
regulation matches. The incumbent was already materially stronger in this new
block than in 2025: 23/36 correct (63.89%), 34/36 Yes directions, 7.69% No
recall, 0.22403 Brier, 0.63996 log loss, and 0.62542 AUC.

The frozen domestic scorer selected ridge `10` on 2025, where it improved
accuracy from 57.67% to 58.20%, No recall from 7.23% to 20.48%, Brier from
0.24649 to 0.24236, log loss from 0.68613 to 0.67752, and AUC from 0.55888 to
0.57013. On 2026 confirmation it produced 32/36 Yes directions and doubled No
recall to 15.38%, while improving coherent team-score MAE from 1.18076 to
1.16711. It nevertheless tied accuracy at 63.89% and worsened Brier to 0.22637,
log loss to 0.64483, and AUC to 0.60535. It therefore fails the predeclared
gate and is rejected for live publication.

The previously frozen non-domestic `chance_quality_stacked` ridge-10 candidate
was also ineligible before its 2026 scoring step: on the fixed 2025 selection
block it improved accuracy, No recall, Brier, and log loss but reduced AUC from
0.58127 to 0.56399. The script correctly stopped it at selection instead of
using the new season to rescue a rejected candidate.

No public model identifier, probability, pick, projection, grade, writer,
lock, or member snapshot is changed by this result. Shipping either candidate
would knowingly trade away probability quality and ranking for cosmetic board
variety, which the declaration and model-change safety gate prohibit.
