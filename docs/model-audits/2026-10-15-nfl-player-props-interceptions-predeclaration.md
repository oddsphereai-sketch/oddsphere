# NFL player props: quarterback interceptions predeclaration

Date: 2026-10-15

Status: research only; production and public actionability unchanged

## Question and evidence boundary

Can an independent quarterback-interception count model improve current-season accuracy using quarterback decision/accuracy history, passing opportunity, opponent takeaway context, pressure, game state, and weather—without using sportsbook lines, prices, or movement?

The tournament uses the same chronology as Passing TD: fit on 2017-2024, select the architecture on 2025, refit through 2025, and score 2026 Weeks 2-5. The four quarterbacks from the two games in OddSphere's Week 5 private archive are reported separately.

OddSphere retained no interception offers in that private archive or market observer. This tournament can assess independent count and threshold-probability accuracy only; it cannot claim record, units, ROI, closing-line value, or market-reader value.

## Architectures

The foundation projects passing attempts from prior quarterback/team/opponent volume and multiplies by a partially pooled quarterback/team/opponent interception rate.

Candidate A is a regularized Poisson GLM. Candidate B is a shallow, strongly regularized Poisson boosted-tree model. Both may use only pregame variables:

- quarterback prior interceptions, attempts, completion/yardage efficiency, CPOE, intended air yards, aggressiveness, bad-throw rate, time to throw, and pressure history;
- team pass volume, dropback rate, pass rate over expectation, shotgun, no-huddle, air-yards, and scramble/sack context;
- opponent pass volume allowed, interception rate induced, pressure, quarterback hits, sacks, blitz context, and air-yards allowed;
- home, roof, wind, and temperature.

Actual attempts in the scored game are not features or eligibility inputs. Official participation is used only for settlement, analogous to excluding a voided nonparticipant.

## Metrics and gate

The count mean is scored with MAE, RMSE, mean Poisson deviance, and Poisson log score. Poisson probabilities over 0.5, 1.5, 2.5, and 3.5 interceptions are scored with Brier score and log loss.

The 2025 selection rule and 2026 point-estimate gate are identical to Passing TD: minimum 2025 deviance, then threshold Brier and MAE; on 2026 the winner must improve deviance, MAE, average threshold Brier, and at least three thresholds without a catastrophic four-QB archive error. A paired game-cluster bootstrap is reported as an uncertainty diagnostic but is not allowed to change the predeclared point-estimate selection after results are observed.

Even a passing accuracy gate cannot authorize production without prospective release-pure interception offers and exact prices. No production release, calibration, writer, grade, stake, or public page is changed.
