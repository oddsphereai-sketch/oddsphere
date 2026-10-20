# UCL BTTS No-discrimination audit and forward shadow declaration

Date: 2026-10-20

> Historical audit only. The proposed production shadow was retired the same
> day under the owner-directed no-shadow rule. No new runtime or member snapshot
> persists this candidate; see
> `docs/model-audits/2026-10-20-ucl-no-shadow-runtime-correction.md`.

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

## Independent dynamic-score architecture declaration

The failed candidates above are discriminative overlays on the same score
foundation. They do not establish that a dynamic scoring architecture cannot
improve the model. Before requesting or inspecting any pre-2020 UCL result,
the following independent tournament is frozen:

- Request only authenticated seasons 2011 through 2019 and fail closed if any
  requested season lacks regulation-final coverage.
- Use 2011-16 for fitting/warm-up, 2017-18 for selecting one domestic-strength
  weight, and 2019 once as the untouched confirmation season.
- For each club and kickoff, construct strictly prior, exponentially weighted
  domestic attack and defence strengths from goals and shots on target. Convert
  shots on target to goal units using only that league's prior scoring rate,
  combine 70% observed goals with 30% shot-derived goals, use a 365-day
  half-life, and shrink eight effective matches toward the league/date mean.
- Generate a domestic home/away scoring intensity from the attacking club's
  attack ratio, its opponent's defence ratio, and the league's venue-specific
  scoring rate. Combine its BTTS logit with the incumbent UCL BTTS logit using
  exactly one of `[0.15, 0.25, 0.35]` domestic weight, selected on 2017-18 by
  lowest Brier followed by log loss. No other feature, coefficient, threshold,
  or candidate family is searched.
- Reconcile only the selected BTTS probability into the incumbent joint score
  distribution. Match Result, Over 2.5, and expected total must remain exact
  within `1e-8`; team-score MAE may not worsen.
- Promotion requires the selected weight to improve 2019 BTTS accuracy, No
  recall, Brier, log loss, and AUC simultaneously, with no regression in the
  structural constraints. After that one read, 2020-26 may be reported only as
  opened robustness evidence and cannot choose or modify the candidate.

This is an architecture test informed by dynamic attack/defence and dependent
score-distribution research. It is not another global threshold or forced-No
rule. Failure leaves the live model unchanged; success advances to a complete
current-board and release-safety rehearsal before any publication.

### Dynamic-score result

The authenticated cohort contained 1,128 UCL matches and 24,502 usable
domestic matches. The selected 35% domestic-strength blend improved the sealed
2019 block from 46.73% to 52.34% accuracy, Brier from 0.26443 to 0.25736, log
loss from 0.72409 to 0.70861, AUC from 0.46281 to 0.47123, and coherent
team-score MAE from 1.03295 to 1.03188. It nevertheless reduced No recall from
18% to 14% and increased Yes directions from 82/107 to 92/107. It therefore
fails the complete gate and is rejected. The result isolates the missing
mechanism: generic domestic strength helps ranking and calibration but ordinary
Poisson scoring intensities understate team-specific zero-goal risk.

## Independent zero-risk architecture declaration

Before requesting or inspecting any 2001-10 UCL result, one final structurally
different candidate is frozen:

- Request authenticated UCL seasons 2001 through 2010. Use 2001-06 for
  warm-up, 2007-09 for weight selection, and 2010 once as untouched
  confirmation. Any incomplete UCL season fails closed.
- Use strictly prior domestic goals to estimate each club's scoring-occurrence
  rate and each opponent's concession-occurrence rate with a 365-day half-life
  and eight-match league-mean shrinkage. Shots are deliberately excluded so
  older leagues with no shot schema remain honest rather than zero-filled.
- A team's probability of scoring is the mean of its shrunk scoring rate and
  its opponent's shrunk concession rate. Their product is the domestic
  zero-risk BTTS estimate. Blend its logit with the incumbent BTTS logit using
  only `[0.15, 0.25, 0.35]`, selected on 2007-09 by Brier then log loss.
- Reconcile only BTTS into the incumbent PMF and retain the same exact
  Match Result, Over 2.5, expected-total, score-MAE, and simultaneous BTTS
  accuracy/No-recall/Brier/log-loss/AUC promotion gates.
- If 2010 passes, the already opened 2011-26 blocks are robustness checks only.
  The candidate must improve their pooled proper scores, AUC, and No recall
  without reducing accuracy before it can reach current-board rehearsal.

This candidate directly models the low-score/zero-inflation weakness isolated
by the preceding test. It is neither a threshold shift nor a forced side mix.

### Provider-availability amendment before outcome access

The provider-only row-count probe returned no regulation-final rows for
2001-09 and exactly 125 for 2010. The declared multi-season tournament therefore
failed closed before producing any metric. No unavailable year is silently
dropped and no outcome was inspected.

Before loading the 2010 scores, the same frozen zero-risk candidate is assigned
an exact within-season chronology: the first 70 regulation finals are warm-up,
the next 25 select among the already declared three weights, and the remaining
30 are untouched confirmation. Match order is provider kickoff then provider
ID. The feature set, shrinkage, half-life, weights, solver, and all acceptance
gates remain unchanged. The small confirmation size cannot alone authorize
production; a passing result must also improve the already opened pooled
2011-26 robustness cohort before current-board rehearsal.

### Zero-risk result

The 2010 provider cohort contained 125 matches and the domestic source supplied
36,494 prior rows. The selected 35% zero-risk blend improved its 25-match
selection block, but failed on the sealed final 30 matches: accuracy declined
from 60.00% to 56.67%, No recall from 53.33% to 46.67%, Brier worsened from
0.24293 to 0.24343, and log loss from 0.68028 to 0.68045. AUC improved slightly
from 0.62667 to 0.63111 and coherent team-score MAE improved from 0.94145 to
0.93747, but partial improvement cannot pass the simultaneous gate.

The result rejects a simple downward/zero-risk correction. Together with the
recent-season domestic scorer and dynamic-Poisson test, it shows that the small
UCL-only scorer is not stable enough to estimate the interaction between
attacking scoring occurrence and opponent clean-sheet risk. The next candidate
must learn that relationship on a substantially larger domestic match sample,
seal it on a domestic chronological holdout, and transport the frozen scorer to
UCL without fitting or selecting on UCL outcomes. Until that external model
exists, another UCL-only coefficient or threshold search would be repeated
testing rather than evidence of improvement.

## Cross-league gated specialist declaration

Before calculating any candidate metric on the 2024-25 domestic season, the
replacement development path is frozen:

- Source: Football-Data full-time goals and shots-on-target from `E0`, `D1`,
  `I1`, `SP1`, `F1`, `N1`, `P1`, `B1`, `T1`, `G1`, and `SC0`. Rows lacking
  the declared columns are excluded rather than zero-filled.
- Chronology: 2014-15 through 2022-23 train the team-scoring specialist;
  2023-24 trains the gate from genuinely out-of-training specialist outputs;
  2024-25 is opened once as untouched confirmation. No random split is used.
- Baseline: a league/date-local, venue-aware dynamic Poisson score model with
  a 365-day half-life and eight-match shrinkage. It supplies the starting BTTS
  probability and score distribution.
- Specialist: one ridge-25 logistic scoring-occurrence model shared by home
  and away sides. Its inputs are baseline scoring logit, prior scoring and
  concession occurrence, league-normalized goals and shots-on-target for the
  attack and opposing defence, effective prior-match weight, and venue.
- Gate: one ridge-25 logistic model trained only on 2023-24. It receives the
  baseline BTTS logit, the specialist-minus-baseline logit residual, the signed
  squared residual, the smaller specialist team-scoring probability, baseline
  scoring-intensity mismatch, and the weaker team's evidence weight. This
  allows conditional authority while shrinking ordinary games toward the
  baseline; there is no hand-authored No quota or threshold.
- The frozen 2024-25 confirmation must simultaneously improve BTTS accuracy,
  No recall, Brier, log loss, and AUC. Reconciliation must preserve Match
  Result, Over 2.5, and expected total within `1e-8`, and team-score MAE may
  not worsen.
- A passing domestic result is necessary but not sufficient. The scorer and
  gate are then frozen and transported to UCL without UCL coefficient fitting.
  They must improve pooled opened UCL robustness metrics, retain current Match
  Result/Total exactly, and pass a complete current-board impact rehearsal
  before a versioned future-unlocked release can be proposed.

This structure is the explicit “best of both worlds” test: the incumbent-style
score distribution remains the default expert, while a separately validated
scoreless-risk specialist receives authority only through an out-of-training
gate.

### Cross-league gated-specialist result

The external chronology contained 34,067 eligible matches: 27,064 scorer
training rows, 3,524 out-of-training gate rows, and 3,479 untouched 2024-25
confirmation rows. The gate slightly improved confirmation accuracy from
54.12% to 54.99%, Brier from 0.24695 to 0.24660, log loss from 0.68697 to
0.68628, and coherent team-score MAE from 0.90300 to 0.90250. It failed the
actual discrimination objective: AUC declined from 0.54751 to 0.54635,
predicted Yes directions rose from 2,411 to 2,993, and No recall collapsed
from 33.48% to 16.21%. Match Result, Total, and BTTS reconciliation residuals
remained below `1e-8`, so structural coherence was not the failure.

The candidate is rejected and is not transported to UCL or production. The
result shows that a separately calibrated side-scoring product still inherits
the population Yes prevalence and does not identify the conditional pockets
where either side fails to score. The next candidate must directly learn
match-level nonlinear zero-risk interactions and recent clean-sheet/
failed-to-score state; another side-product calibration is not justified.

## Direct interaction specialist declaration

Development used only the already opened 2023-24 and 2024-25 domestic seasons,
with each season predicted by a model trained strictly on earlier seasons. The
candidate directly models match BTTS rather than multiplying separately fitted
side probabilities. Its 64 inputs include the dynamic-Poisson baseline; home,
away, total, minimum, product, and mismatch scoring intensities; shrunk scoring,
concession, goals, and shots-on-target state; five- and ten-match scoring,
concession, goals, and shots-on-target form; explicit attack-versus-opposing-
defence products and minima; evidence weight; venue; and league scoring rate.

The opened development grid tested ridge values `[1, 5, 25, 100]`, specialist
logit authorities `[0.25, 0.5, 0.75, 1]`, calibration slopes
`[1, 1.15, 1.3, 1.45]`, and declared logit offsets. The selected configuration
is now frozen before requesting any 2025-26 outcome:

- ridge `1`;
- 25% specialist logit plus 75% dynamic-Poisson baseline logit;
- calibration slope `1` and logit offset `-0.02`;
- train on all eligible 2014-15 through 2024-25 rows, then open 2025-26 once as
  untouched confirmation.

This was the highest-margin configuration that improved accuracy, No recall,
Brier, log loss, and AUC on both development folds. On 2023-24 it moved
accuracy 54.71%→54.74%, No recall 33.14%→34.09%, Brier
0.246158→0.246089, log loss 0.685448→0.685291, and AUC
0.551590→0.553048. On 2024-25 it moved accuracy 54.12%→54.35%, No
recall 33.48%→34.86%, Brier 0.246949→0.246448, log loss
0.686972→0.685955, and AUC 0.547507→0.551079.

The untouched 2025-26 season must again improve all five metrics, preserve
Match Result, Over 2.5, and expected total within `1e-8` after coherent
reconciliation, and not worsen team-score MAE. Failure rejects the candidate;
success permits frozen transport to UCL but still does not authorize production
until UCL robustness and current-board gates pass.

### Direct-interaction confirmation result

The untouched 2025-26 confirmation contained 3,445 matches. The candidate
improved No recall from 33.35% to 34.48%, Brier from 0.246750 to 0.246430,
log loss from 0.686667 to 0.685988, AUC from 0.555555 to 0.557227, and
coherent team-score MAE from 0.896683 to 0.896564. It lost exactly one correct
direction: accuracy moved from 54.804% (1,888/3,445) to 54.775%
(1,887/3,445). Reconciliation residuals remained below `1e-8`.

Because the frozen gate required strict improvement on every metric, this is a
rejection and not a production candidate. The near-pass across every
probability, ranking, No-recall, and score-structure metric isolates the next
change: specialist authority should be conditional on residual strength rather
than applied globally to marginal matches.

## Residual-authority gate declaration

The three opened chronological development folds (2023-24, 2024-25, and
2025-26) were used to compare symmetric and downward-only authority gates.
Twenty-eight configurations improved pooled accuracy, No recall, Brier, log
loss, and AUC while keeping each fold's accuracy within one result of the
baseline. The frozen configuration is chosen for cross-fold consistency rather
than the largest pooled gain:

- train the same 64-feature ridge-1 direct interaction model on every eligible
  completed season before the prediction season;
- calculate `residual = specialist_logit - baseline_logit`;
- preserve the incumbent probability exactly when `abs(residual) < 0.05`;
- otherwise use `baseline_logit + 0.25 * residual - 0.02`;
- no outcome-, league-, side-, or board-count quota is used.

This `0.05 / 0.25 / -0.02` gate was the strongest configuration that improved
No recall, Brier, log loss, and AUC in every development fold while never
reducing fold accuracy (one fold tied, two improved). Across 10,448 predictions
it improved accuracy 54.55%→54.74%, No recall 33.33%→33.89%, Brier
0.246617→0.246275, log loss 0.686358→0.685650, and AUC
0.551542→0.553997.

Before reading any 2026-27 result, this configuration is frozen for one current-
season confirmation using every published eligible match in the 11 declared
leagues through the source's latest row. The candidate must have at least 500
confirmation matches and strictly improve accuracy, No recall, Brier, log loss,
and AUC; reconciliation must retain Match Result, Over 2.5, and expected total
within `1e-8`, with no team-score-MAE regression. A passing result permits UCL
transport testing, not direct production deployment.

### Residual-authority confirmation result

The untouched current-season confirmation contained 744 matches, satisfying
the declared minimum. The candidate improved Brier from 0.244600 to 0.244212,
log loss from 0.682212 to 0.681407, and AUC from 0.551093 to 0.554948. It
failed the direction and structural gates: accuracy fell from 56.85% to 56.32%
(four fewer correct results), No recall fell from 28.40% to 27.79%, and
team-score MAE moved from 0.975450 to 0.975550. Reconciliation remained within
`1e-8`.

The gate is rejected for live authority and is not transported as a pick-
changing UCL model. Across four chronological confirmations, the direct
interaction specialist has repeatable probability-ranking value but unstable
0.5-threshold direction value. The justified next use is a versioned UCL
shadow reader that records its probability alongside—never over—the incumbent
locked and live projection. Future UCL finals can then evaluate exact-
competition promotion criteria without altering current picks or reconstructing
locked rows.

## Prospective UCL BTTS market shadow

A credential-backed zero-write read of the October 20 UCL board found 18
fixtures and 18 independent Yes forecasts. Target-book-excluded, complete
multi-book BTTS vectors were available on 17 fixtures; two had a robust No
consensus under every leave-one-out median: Benfica at Roma (47.13% median Yes)
and AEK at Manchester City (46.40% median Yes). This proves that the current
market feed contains the missing directional disagreement; it does not prove
those two No sides will win.

The prospective shadow release
`ucl_btts_market_shadow_2026_10_20_r1_target_excluded_consensus` therefore:

- accepts only complete named-book Yes/No vectors for the exact provider event,
  captured strictly before both decision time and kickoff;
- excludes the evaluated BTTS book plus Polymarket and Kalshi;
- requires at least three eligible alternatives, leave-one-out directional
  stability, and mean absolute dispersion no greater than six percentage
  points;
- logs a candidate probability with at most 30% authority, scaled by book
  agreement and dispersion;
- stores `productionAuthority=false` plus model, consensus, and candidate
  probabilities/sides in future UCL snapshot provenance under lifecycle
  `ucl_member_snapshot_lifecycle_2026_10_20_r8_btts_shadow_provenance`;
- does not alter the coherent PMF, displayed BTTS probability or side, grade,
  stake, score, writer, lock tuple, tracking record, or any existing locked
  payload.

Promotion requires settled prospective UCL evidence showing better accuracy,
No recall, Brier, and log loss without degrading Match Result, Total, expected
goals, board actionability, or immutable-lock behavior. Until that evidence
exists, r8u/r4 remains the live champion and the shadow is measurement only.

## Outcome-blind three-lane market-reader declaration

This declaration was frozen on October 20 before any fixture on the 18-match
board kicked off. The production base is merge commit
`c1b5ab5a0998874cb311275cbd6a4bee6f1ff060`. Scope is UCL BTTS shadow
provenance only. The incumbent coherent PMF, public BTTS side/probability,
grade, score, stake, sole UCL writer, `prediction_pipeline:soccer` lease,
refresh/lock cadence, member copy/layout, tracking and every locked payload are
unchanged.

The frozen candidate release is
`ucl_btts_market_shadow_2026_10_20_r2_three_lane_target_excluded`. It extends
the r1 target-excluded consensus without using any result:

1. Current level retains the r1 requirements: at least three complete named
   books, exact event identity, evaluated-book exclusion, prediction-market
   exclusion, stable leave-one-out direction and no more than six percentage
   points of mean absolute dispersion.
2. Movement is constructed only from the same eligible target-excluded books.
   Each book requires complete Yes/No pairs at two or more strictly predecision
   capture times. Per-book opening and current prices are separately de-vigged;
   the reader uses the median Yes-probability change. At least two books are
   required, and a movement direction exists only at an absolute one-point
   change.
3. Model evidence quality is `strong` only when each club has at least five
   provider stat matches and three xG matches with no promoted proxy; `medium`
   requires three stat matches and two xG matches per club; everything else is
   `thin`.
4. The r1 reliability authority is multiplied by movement support (`1.25`
   when target-excluded movement corroborates the consensus, `0.75` when it
   resists, otherwise `1.00`) and model-evidence quality (`1.25` thin, `1.10`
   medium, `1.00` strong), then capped at `0.45`. Missing movement changes no
   direction and grants no bonus.
5. The candidate probability remains a logit pool of the independent model and
   target-excluded consensus. Its lane is `aligned` when their directions
   agree, `corrected` only when the pooled probability crosses 50%, and
   `conflicted` when disagreement shrinks confidence without crossing 50%.
6. The shadow grade uses the candidate side's exact quote and the frozen UCL
   53% Watchlist / 55% positive-EV Lean ladder. A conflicted candidate whose
   target-excluded movement corroborates the opposing consensus is capped at
   Watchlist. An aligned candidate may promote through the same symmetric
   probability/price gates. A corrected candidate is capped at Watchlist until
   settled confirmation authorizes direction changes.

The exact current-board audit must report lane counts, side changes,
promotions, demotions, actionable count and market mix. The candidate cannot
receive production authority from the current board. Promotion still requires
release-pure settled evidence improving BTTS accuracy, No recall, Brier and log
loss, with no regression in Match Result, Total, team-score error, lock
immutability, coverage or board actionability.

### Outcome-blind current-board result

At 11:32 EDT, before the first kickoff, the zero-write audit read all 18
fixtures and 21,970 stored price observations. Seventeen fixtures had an
eligible target-excluded consensus and same-book movement read. The frozen
candidate produced 15 aligned, two conflicted, zero corrected and one
unavailable lane. Six movements corroborated the current consensus, three
resisted it and eight were directionally stable. Both target-excluded No
levels remained confidence-only conflicts rather than automatic flips:

- Slovan Bratislava at Roma stayed Yes (74.82% model, 47.14% consensus,
  66.52% pooled). The six-book movement was -0.96 percentage point, below the
  predeclared one-point directional threshold.
- AEK at Manchester City stayed Yes (68.37% model, 47.64% consensus, 64.67%
  pooled) because the six-book movement was +8.67 points toward Yes and thus
  resisted the current No level.

There were zero side changes and zero promotions. One symmetric exact-price
demotion occurred: Viking at Aston Villa moved from Lean to Watchlist because
the 61.92% independent Yes estimate pooled to 60.12%, below the break-even
probability of the evaluated -152 quote. Board actionability changed from
seven Leans and eleven Watchlists to six Leans and twelve Watchlists; no No
Play was created and BTTS remained the only affected market. This is a
measured, bounded change rather than a blanket Yes-to-No flip. It remains
shadow-only pending release-pure settled confirmation.
