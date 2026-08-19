# MLB Player Props Display Projection Calibration — r37

Date: 2026-08-19
Candidate release: `mlb_props_2026_08_19_r37`
Rollback release: `mlb_props_2026_08_19_r36`

## Decision

Qualify a post-decision expected-count calibration for six markets:

- Batter Hits + Runs + RBI
- Batter Strikeouts
- Batter Total Bases
- Pitcher Earned Runs
- Pitcher Hits Allowed
- Pitcher Strikeouts

The calibration changes only the member-facing `projection`. It is applied
after probability, side, grade, actionability, and stake selection. It cannot
be used as an input to those decisions. A non-regression guard retains the
prior projection whenever calibration would introduce a new selected-side
contradiction. No other market is changed.

This release does **not** qualify the attempted all-market betting selector.
That selector lost 32.43 units over 451 qualification-window bets and remains
out of production. R37 is a projection-accuracy improvement, not evidence for
a new betting sleeve.

## Evidence contract

- Source: cached immutable locked player-prop snapshots
- Provider calls during analysis: zero
- Production writes during analysis: zero
- Settled, exact-context rows: 46,656 of 47,563 eligible rows
- Open dates: 2026-07-22 through 2026-08-17
- Training: 2026-07-22 through 2026-08-03
- Validation and market selection: 2026-08-04 through 2026-08-10
- Untouched holdout: 2026-08-11 through 2026-08-17

For each market, the candidate fit was:

`projection_new = max(0, line + intercept + slope * (projection_old - line))`

A market could advance only if validation MAE and RMSE both improved and both
metrics improved on at least two-thirds of validation dates. Selected markets
were refit on training plus validation without holdout outcomes, then evaluated
once on the holdout.

## Unopened holdout results

| Market | Rows | Current MAE | r37 MAE | Current RMSE | r37 RMSE |
|---|---:|---:|---:|---:|---:|
| Batter Hits + Runs + RBI | 1,513 | 1.50688 | 1.46882 | 1.90658 | 1.88853 |
| Batter Strikeouts | 430 | 0.66798 | 0.66195 | 0.83687 | 0.81365 |
| Batter Total Bases | 1,378 | 1.30536 | 1.25264 | 1.73894 | 1.71194 |
| Pitcher Earned Runs | 184 | 1.57190 | 1.51477 | 1.95870 | 1.88705 |
| Pitcher Hits Allowed | 174 | 1.84029 | 1.83084 | 2.31829 | 2.29279 |
| Pitcher Strikeouts | 171 | 1.92738 | 1.60054 | 2.96336 | 1.93799 |
| All markets, with unselected markets unchanged | 13,166 | 0.80415 | 0.78889 | 1.22134 | 1.18411 |

All six selected markets improved both metrics. Aggregate deltas were
-0.01526 MAE and -0.03723 RMSE.

Robustness checks used 20,000 resamples:

- Date-clustered P(MAE improves) = 1.0000; 95% delta interval
  [-0.02263, -0.01049].
- Date-clustered P(RMSE improves) = 1.0000; 95% delta interval
  [-0.08668, -0.01022].
- Player-game-clustered P(MAE improves) = 1.0000; 95% delta interval
  [-0.02052, -0.01087].
- Player-game-clustered P(RMSE improves) = 1.0000; 95% delta interval
  [-0.07577, -0.01176].

## Production coefficients

The production fits use all 27 open dates after the selection and holdout
decision was complete.

| Market key | Intercept | Slope | Rows |
|---|---:|---:|---:|
| `batter_hits_runs_rbis` | 0.17051119 | 0.43587647 | 5,516 |
| `batter_strikeouts` | 0.10021862 | 0.42435101 | 1,531 |
| `batter_total_bases` | 0.26006330 | 0.40019654 | 4,984 |
| `pitcher_earned_runs` | 0.04061897 | 0.19426630 | 651 |
| `pitcher_hits_allowed` | 0.00915025 | -0.06016587 | 621 |
| `pitcher_strikeouts` | -0.06107332 | 0.01324540 | 643 |

## Safety and board impact

- Authoritative writer remains `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard`.
- The shared sport-scoped `prediction_pipeline` lease is unchanged.
- No new refresh, provider request, writer, database lane, or cron is added.
- The transform runs after all decision and portfolio-promotion functions.
- The non-regression guard cannot introduce a new projection/side
  contradiction on a previously coherent row.
- A focused invariant test verifies that only `projection` can change.
- Promotions: 0
- Demotions: 0
- Grades changed: 0
- Stakes changed: 0
- Actionable-count change: 0

The read-only paired replay on the latest stored August 19 r36 board covered
5,885 rows. R37 changed 1,407 projections and zero other fields. Actionables
remained 134 before and after; grades, sides, probabilities, and stakes had
zero changes. Total projection/side contradictions fell from 3,361 to 3,150,
while actionable contradictions remained 17 before and after. The replay made
zero provider calls and zero production writes.

## Limitation

The target here is realized-count error, not bet-side classification. On the
aggregate holdout, line-direction accuracy moved slightly from 0.61135 to
0.61059 while coherence with the historically tracked side improved from
0.73804 to 0.74123. The guard prevents a newly incoherent selected-side display,
but a more accurate expected count is still not proof that the selected side
or action policy is better. Any future probability or actionability change
requires its own chronological, release-qualified test.
