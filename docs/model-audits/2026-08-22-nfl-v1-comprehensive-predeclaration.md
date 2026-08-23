# NFL v1 comprehensive shadow tournament predeclaration

Date: 2026-08-22

Status: frozen shadow-research protocol; no member-facing release, grade, stake, tracking, writer, cron, or deployment change is authorized by this document.

## Objective

Build the strongest defensible independent NFL pregame forecast available from football information already owned by OddSphere. The independent forecast must produce home/away scores, margin, total, win probability, and calibrated uncertainty without using any sportsbook line, price, fair probability, betting split, odds movement, or market-derived feature. A separately identified market blend and exact-price betting policy may be evaluated only after the independent head is frozen and reported on its own.

The tournament addresses two demonstrated defects rather than optimizing presentation:

- prior score forecasts were too tightly clustered;
- prior total-side selection produced an implausible all-Over board while failing market-relative accuracy and return tests.

## Information boundary

Every historical feature must be reconstructible from information available before the prediction horizon. The research builder freezes team, quarterback-room, player-continuity, coaching, and venue state before updating it with the target game.

Allowed inputs include:

- rolling and opponent-adjusted offense/defense EPA and success rate;
- dropback, rush, early-down, explosive-play, pressure/sack, turnover-regression, pace, no-huddle, pass-over-expected, red-zone, special-teams, penalty, and scoring signals from completed games only;
- pregame schedule context: home/away/neutral, division, season/week, scheduled rest, known surface/venue capability, and distance/time-zone travel estimates;
- rolling Elo/strength and scoring-differential state updated only after completed games;
- the team’s last completed-game primary-quarterback identity and that quarterback’s pre-update, experience-shrunk rolling performance as a quarterback-room proxy;
- roster and snap continuity lagged through the last completed week, so a week N forecast may use week N-1 versus N-2 continuity but never the finalized week N roster or snaps;
- coach continuity only when the schedule record identifies the coach for the target game as a pregame-known assignment.

Forbidden inputs include:

- all market lines, prices, fair probabilities, splits, movements, consensus, or book identifiers in the independent head;
- the target game’s eventual starter identity, final injury report, inactive list, snap share, final roster, result, play-by-play, or postgame field;
- target-game realized weather or retractable-roof state;
- any rolling value updated with a target-game or later observation;
- current projected/confirmed quarterback status unless a historically comparable timestamped status exists for every evaluation row.

If a required historical as-of field cannot be proven, the feature is omitted or the affected path fails closed. Current projected-quarterback status remains health context outside the independent model until comparable historical evidence exists.

## Frozen chronology

- 2016-2020: minimum-history accumulation and expanding training where eligible.
- 2021-2022: architecture and hyperparameter selection using expanding, season-forward folds only.
- 2023: calibration, ensemble-weight, market-blend, and exact-price-policy selection. Nothing selected after this boundary may be retuned on later results.
- 2024 and 2025: repeated confirmation, not pristine holdout, because these seasons have already been examined in prior NFL research. They remain mandatory season-by-season stability checks.
- 2026: immutable opening, unlocked, T-60, and settlement evidence is the true prospective holdout. No 2026 result may tune the candidate.

Preprocessing, imputation, scaling, feature selection, calibration, and ensemble fitting must be trained inside each expanding fold. Test-season rows may not determine any fitted transform or model choice.

## Candidate families

The tournament will compare genuinely different football-only families:

1. Baselines: home/base rate, rolling point-differential/SRS, and pregame Elo.
2. Regularized generalized models: Ridge/Elastic Net margin and total heads; partially pooled team offense/defense effects; and regularized Poisson home/away score heads where numerically stable.
3. Nonlinear trees: histogram gradient boosting and at least one bagged/boosted tree family supported by the frozen local environment.
4. Calibrated ensembles: convex or stacked combinations selected only through the 2023 boundary.
5. Win-probability heads: direct regularized logistic and nonlinear classifiers plus the joint-score distribution’s implied win probability. Calibration is fitted without confirmation-season outcomes.

No family may receive a market feature. Materially distinct feature subsets may be compared only within the frozen selection window.

## Metrics

Report every season separately and pooled where useful:

- home/away team-score MAE and RMSE;
- margin and total MAE/RMSE versus football baselines and the opening-market benchmark;
- win probability Brier score, log loss, ECE, accuracy, market correlation, and winner flips;
- joint-distribution log score, empirical CRPS/energy score where implemented, 50%/80% interval coverage, and PIT/calibration summaries;
- forecast dispersion across the current 16-game Week 1 board and historical season-week boards;
- for a market blend: the same proper scores plus the selected independent contribution;
- for exact-price decisions: actions, wins/losses/pushes, units, ROI, price distribution, diagnostic CLV where source-comparable, largest-win-independent result, and game-week cluster bootstrap uncertainty.

Opening-market comparisons are benchmarks only and may not leak into the independent fit. Cross-source or non-same-book closing prices are labeled diagnostic and cannot satisfy a same-book CLV gate.

## Frozen promotion gates

### Independent football forecast

The independent candidate must satisfy all of the following:

- beat the strongest simple football-only baseline on both Brier and log loss in 2023, 2024, and 2025;
- beat that baseline on a composite of team-score, margin, and total MAE in each confirmation season, with no confirmation season more than 0.10 points worse on any one headline MAE;
- achieve ECE at or below 0.08 in each of 2024 and 2025;
- keep empirical 80% margin and total interval coverage between 0.75 and 0.85 in each confirmation season;
- on the current 16-game Week 1 board, avoid collapsed forecasts: team-score standard deviation at least 2.0 points, margin standard deviation at least 3.0, and total standard deviation at least 2.0;
- preserve nontrivial independent disagreement with the market: at least two projected-winner flips or an absolute opening-market win-probability correlation below 0.98 on a full 16-game slate;
- contain no unresolved information-boundary violation.

The opening market remains the stronger benchmark. Failure to beat it does not automatically invalidate an honestly labeled independent outcome forecast, but the result must be disclosed and the candidate cannot be described as market-superior.

### Market blend

A market blend may advance only if its weight is selected before confirmation and the football-only contribution is at least 20%. It must improve both Brier and log loss against the opening market in 2023 and may not be worse by more than 0.001 Brier or 0.003 log loss in either 2024 or 2025. The pooled game-week cluster bootstrap probability of Brier improvement must be at least 0.75. A blend that selects less than 20% football weight is classified as market replication, not an OddSphere forecast.

### Exact-price Bet grade

The policy is uncapped: no weekly minimum, maximum, quota, or best-bet requirement. All and only qualifying exact-price edges surface. Candidate thresholds are selected on 2023 from a small predeclared grid: minimum model win probability 0.52 or 0.55; minimum expected value 0.03, 0.05, or 0.075; American price between -300 and +300. Only one side per game/market may qualify.

To advance, the frozen policy must have at least 30 actions in 2023 and 20 in each of 2024 and 2025; positive units and ROI in each season; positive diagnostic CLV frequency above 50% in each season when comparable; positive units after removing the largest win in each season; and a game-week cluster-bootstrap probability of positive ROI at least 0.75 in each confirmation season. Production publication additionally requires same-book forward CLV and return evidence from the immutable 2026 collection path. Therefore this tournament alone cannot authorize a public Bet grade.

## Release and product boundary

Any passing artifact is shadow-only until consolidation review and a separate production release. Outcome confidence, likely winner, projected score, and Bet grade are distinct fields. A publishable outcome forecast does not create an actionable wager. The existing leased NFL forward-evidence writer remains the sole authoritative writer; this tournament must not create or call another writer.

All failures and negative evidence will be preserved. Gates will not be lowered, action will not be forced, and a slate change will not be presented as a model fix.

## Frozen r3 market-correction and threshold-calibration experiment

The r2 independent score/win architecture is retained because it passed the
football-baseline, calibration, and structural-dispersion gates. Its fixed
convex market blend selected zero independent weight, and its own exact-price
policy failed 2025. Neither failed component may be promoted or rescued by
loosening a threshold.

The next material experiment is frozen before its confirmation rerun:

1. The independent r2 forecast remains unchanged and contains no market input.
2. A separate market-correction tournament fits only on 2021-2022 and selects
   on 2023. Candidate families are regularized logit stacking and shallow
   gradient boosting over the opening no-vig probability, independent
   probability, their logit disagreement, absolute disagreement, and both
   confidence distances from 50%. A market-only beta calibrator is an explicit
   ablation comparator.
3. A candidate is eligible only when it beats both the raw opening market and
   the market-only calibrator on 2023 Brier and log loss, moves at least 10% of
   probabilities by two percentage points, changes at least five forecast
   winners, and worsens 2023 ECE by no more than two percentage points.
4. On repeated-confirmation 2024 and 2025, the frozen correction must improve
   pooled Brier and log loss, stay within 0.002 Brier and 0.005 log loss of the
   opening market in each season, and have at least 75% weekly-cluster bootstrap
   probability of pooled Brier improvement. Its market-only ablation must be
   worse by at least 0.0001 pooled Brier so the independent signal is material.
5. Spread and total threshold probabilities are derived from the independent
   joint score law, then beta calibrated on 2023 without prices, splits, or
   movement. On each of 2024 and 2025, push-excluded spread and total forecasts
   must have ECE at most 0.08, beat a 50% football baseline on Brier and log
   loss, and avoid a greater than 0.01 Brier regression versus the opening
   market fair probability. These are forecast gates, not Bet-grade gates.
6. The failed r2 exact-price policy is not reused. The separate frozen r6
   leave-one-book-out moneyline lane remains the only betting candidate: it
   must retain its existing release identifiers, uncapped policy, one-writer
   tuple/lock contract, historical evidence, and 2026 health holds. Spread and
   total Bet grades remain Held until their own exact-price policies pass.

The r3 rerun remains shadow/audit-only. A passing forecast package plus r6 may
be prepared for consolidation review, but this task does not publish, track,
deploy, merge, or change the member board.

## Frozen r4 direct market-residual probability experiment

The r3 nonlinear moneyline correction and distribution-derived spread/total
threshold heads failed their frozen gates. The former could not beat the raw
opening market in 2023; the latter were calibrated but did not show stable skill
over a neutral 50% ATS/total baseline in 2024-2025. Those results remain
negative evidence and are not retuned.

The r4 experiment changes the target and architecture materially:

1. The passing r2 football-only score and moneyline outcome heads remain frozen
   and independently visible. They still contain no market input.
2. The already-frozen r6 leave-one-book-out moneyline correction is the market
   blend and exact-price Lean candidate. It is not refit here and retains its
   existing releases, uncapped rule, writer, locks, and health holds.
3. Separate direct spread-cover and total-Over heads fit on 2021-2022. Inputs
   are restricted to post-forecast evaluation fields: the frozen independent
   margin/total/win outputs, opening spread/total/no-vig fair probabilities,
   residuals between independent projections and opening thresholds, line
   magnitude, and confidence/disagreement transforms. They are explicitly
   market-assisted probability heads, never described as independent.
4. Candidate families are regularized logistic, shallow gradient boosting, and
   histogram gradient boosting. Raw family selection uses 2023 only and
   requires Brier and log loss better than both neutral 50% and opening-market
   fair probability, ECE at most 0.10, and probability standard deviation at
   least 0.015. A beta calibrator is then fitted on 2023 for frozen 2024-2025
   confirmation; the confirmation seasons are not used to choose a family or
   calibrator.
5. Each frozen spread/total head must pass the existing confirmation gates in
   both 2024 and 2025: ECE at most 0.08, Brier and log loss better than neutral,
   and no greater than 0.01 Brier regression versus opening-market fair
   probability. Failure leaves that market's forecast probability and Bet grade
   Held; it cannot inherit the moneyline lane.
6. No r4 spread/total exact-price Bet policy is authorized unless the probability
   head first passes. Bet count remains an output, with no quota or forced play.

The r4 rerun is shadow/audit-only and does not alter the member board, tracking,
stakes, the provider cadence, or the single authoritative writer.

## Frozen r5 full-state market-residual experiment

The r4 summarized direct heads failed confirmation: no spread family qualified
on 2023, and the selected total family regressed versus neutral in both 2024
and 2025. The next experiment broadens information and changes the target/model
family without relaxing any gate.

1. The independent r2 forecast and r6 moneyline lane remain frozen and
   separately reported.
2. The r5 spread and total heads receive the complete leakage-free compact and
   balanced football feature sets already frozen above, plus the r4-allowed
   opening threshold/evaluation fields. They still receive no splits, movement,
   terminal/closing price, final starter, final injury, or target-game result.
3. The tournament compares direct regularized logistic, histogram boosting,
   and random-forest classification with continuous residual Ridge, Huber
   gradient boosting, histogram boosting, and Extra Trees. Residual models
   predict actual margin minus opening spread or actual total minus opening
   total; probabilities come from the 2023-frozen empirical residual law.
4. Training is 2021-2022 and family selection/calibration is 2023. Confirmation
   remains repeated 2024-2025. Candidate selection and confirmation gates are
   identical to r4, including the neutral and market comparisons; no gate is
   weakened after r4.
5. The r5 experiment cannot create a spread/total Bet grade. A passing forecast
   head would require a later exact-price policy under the uncapped decision
   contract. A failure identifies the next required information family rather
   than authorizing another coefficient/threshold tweak.

The r5 rerun remains shadow/audit-only and production is untouched.

## Frozen r6 rolling market-memory experiment

The r5 full-state heads also failed without ambiguity: no spread candidate was
eligible on 2023, and the one eligible total residual candidate regressed below
the neutral baseline in both 2024 and 2025. The independent score/outcome head
and the separate r6 moneyline lane remain frozen; this experiment does not
retune either one.

The remaining leakage-safe historical information family already owned by
OddSphere is how each team performed against the opening threshold before the
target game. The r6 threshold experiment therefore adds only chronological
market-memory state to the r5 inputs:

1. Before each game-week, compute fast and slow exponentially weighted team
   residuals versus the opening spread and total, plus prior residual
   volatility and observation counts. A home ATS residual updates the home team
   with its sign and the away team with the opposite sign; a total residual
   updates both teams with the same sign. Every game in a week receives the
   state frozen before that week, then the full week updates together.
2. Regress all residual means toward zero and volatility toward the league
   prior at a season boundary. No target-game result, terminal line, closing
   price, split, movement, final starter, or final injury field can enter the
   state.
3. Append those frozen residual-memory fields to the r5 full-state matrix and
   rerun the same predeclared classifier and continuous-residual families.
   Training remains 2021-2022, selection/calibration remains 2023, and 2024 and
   2025 remain repeated confirmation.
4. The r4/r5 eligibility and confirmation gates are unchanged. A market may
   pass independently; failure leaves that market probability and Bet grade
   Held. Passing a probability head still cannot create a spread/total Bet
   grade without a separate uncapped exact-price policy.

This is a new information family, not a looser threshold. It remains
shadow/audit-only and does not alter publication, tracking, stakes, cadence, or
the single leased writer.
