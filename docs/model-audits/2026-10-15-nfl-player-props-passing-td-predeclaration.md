# NFL player props: passing touchdowns predeclaration

Date: 2026-10-15

Status: research only; production and public actionability unchanged

## Question

Can an independent, football-structured quarterback passing-touchdown model improve count and threshold-probability accuracy without using any sportsbook line, price, consensus, movement, or market-derived feature?

## Evidence boundary

The fitted model may use 2016-2025 official nflverse player stats, play-by-play, snap/roster-derived features, and the already-retained external football features. Model selection is performed on 2025 only. The frozen winner is then evaluated on 2026 Weeks 2-5, with the four quarterbacks from the two games present in OddSphere's Week 5 private archive reported separately.

The OddSphere Week 5 private archive and market observer contain zero passing-touchdown offers. Therefore this tournament cannot produce exact-line record, units, ROI, closing-line value, or market-reader evidence. Any selected model remains research-only until release-pure prices are captured prospectively.

## Outcome and eligible rows

The outcome is official quarterback passing touchdowns in a game. Eligible rows are pregame quarterback rows with a prior workload consistent with a starter or material passer, determined only from prior-game passing attempts and the pregame depth signal. Actual attempts in the scored game are never an eligibility input.

Week 1 is excluded from the primary current-season score because within-season rolling role/team/defense history does not yet exist. It may be listed only as a cold-start diagnostic.

## Independent architectures

### Foundation

A leakage-safe empirical-Bayes opportunity model:

1. project attempts from prior quarterback, team, and opponent attempt volume;
2. estimate a shrunk quarterback/team passing-touchdown rate per attempt from prior games;
3. multiply opportunity by rate to produce the Poisson mean.

### Candidate A: regularized Poisson GLM

A transparent log-link model using only pregame variables:

- quarterback attempt, completion, yardage, and touchdown-rate history;
- team pass volume, pass rate over expectation, neutral pass rate, air-yards and YAC context;
- offensive red-zone pass attempts, red-zone pass rate, and red-zone pass-TD efficiency;
- opponent pass volume allowed, red-zone passing-TD allowance, pressure, hit, and sack context;
- quarterback time-to-throw, air-yards, completion-over-expectation, and pressure history when present;
- home/roof/weather context.

### Candidate B: regularized Poisson gradient boosting

The same feature boundary with shallow trees, large leaves, shrinkage, and L2 regularization. This tests nonlinear opportunity/efficiency/matchup interactions without introducing market inputs.

## Distribution and metrics

Each architecture outputs a nonnegative expected count. The count is scored using mean absolute error, root mean squared error, mean Poisson deviance, and Poisson log score. The mean also produces probabilities for over 0.5, 1.5, 2.5, and 3.5 touchdowns; those are scored using Brier score and log loss.

Dispersion is audited. If the current-season residual variance materially exceeds the predicted mean, a negative-binomial sensitivity may be reported, but it cannot replace the predeclared primary Poisson comparison after results are seen.

## Selection and advancement gate

Candidate selection is fixed by 2025 mean Poisson deviance, with average threshold Brier as the first tiebreaker and MAE as the second. The selected candidate then advances on 2026 only if it beats the foundation on:

1. mean Poisson deviance;
2. MAE;
3. average threshold Brier;
4. at least three of the four threshold Brier scores;
5. no catastrophic error on the four archived-game quarterbacks.

Even if all accuracy gates pass, the absence of release-pure passing-TD prices means the result cannot alter production grades, stakes, or public actionability. The next required step would be prospective exact-offer capture, not market blending.

## Research basis

The architecture follows three externally supported ideas: passing touchdowns are discrete counts for which a Poisson distribution is a defensible baseline; play selection is highly conditional on field position, down/distance, time, score, and related state; and repeated quarterback/defense observations warrant partial pooling or strong regularization rather than raw recent-rate extrapolation. nflfastR's published modeling work also supports season-held-out validation and nonlinear tree models for football-state calibration.

No model release, calibration release, production writer, reader, grade, stake, or public-site behavior is changed by this tournament.
