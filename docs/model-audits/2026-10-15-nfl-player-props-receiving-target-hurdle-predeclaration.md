# NFL player props receiving target-hurdle predeclaration

Date: 2026-10-15
Status: frozen before results

## Question

The rejected recent-workload blend lowered MAE but worsened RMSE and negative bias. This tournament
tests a different architecture: separate whether a player receives any target from the amount of
team opportunity allocated conditional on a target. The hypothesis is that target-specific role
survival, rather than another recent-target coefficient, reduces zero-role and tail errors for
Receptions and Receiving Yards.

## Information boundary

The challenger may use only strictly pregame, target-free inputs already present in the production
feature artifact: shifted player/team/opponent statistics; depth and starter evidence; pre-lock
availability and teammate-vacated role; team pace, dropback rate, xpass/pass rate over expectation;
QB pressure/accuracy history; position matchup; NGS receiver cushion, separation, intended air
yards and YAC history; weather and venue. Sportsbook lines, prices, books, consensus, movement,
current-game outcomes, and target-prop availability are forbidden.

Public tracking research supports treating target selection and completion as separate stages and
using receiver separation, formation, passer distance/pressure, route and coverage information.
The available artifact has honest shifted proxies for several of those variables but no pregame
route-participation or defender-assignment feed; missing route/coverage evidence remains missing.

## Frozen architecture

For each chronological season and complete RB/FB/WR/TE team roster:

1. fit a binary target-participation classifier on prior seasons (`targets > 0`);
2. fit conditional target-share models on prior-season targeted players;
3. multiply participation probability by conditional share and normalize within the team;
4. multiply by an independently fitted team-target budget;
5. reuse the released catch-rate and yards-per-target efficiency components so the test isolates
   opportunity and role survival.

The candidate center is evaluated at fixed `25%`, `50%`, `75%`, and `100%` blends with the exact
released family center. Position authority will be evaluated separately; a pooled win cannot hide
a losing RB, WR, or TE cohort.

## Frozen gates

1. Training ends before 2024; 2024 selects the lowest-weight candidate improving both MAE and RMSE.
2. Untouched 2025 must not regress MAE or RMSE, must have a game-clustered 95% MAE-delta interval
   below zero, and must not regress any nonempty chronological segment.
3. Each authorized position cohort must improve both 2024 and 2025 MAE/RMSE or retain the exact
   predecessor.
4. Only a confirmed candidate opens the immutable 2026 offered replay; MAE/RMSE and exact-line
   direction must not regress.
5. Probability CRPS/Brier/log loss, calibration, promotions, demotions, board size and market mix
   are separate required gates before any runtime authority.

Failure retains production and triggers the next distinct root-cause hypothesis; coefficients or
state definitions will not be retuned after results open.
