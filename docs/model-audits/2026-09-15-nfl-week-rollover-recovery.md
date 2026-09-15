# NFL weekly rollover and complete-board recovery

Date: 2026-09-15

## Incident and scope

The production NFL reader, health route, and sole leased writer all read
`NFL_FORWARD_WEEK=1` as a permanent week identity. At the Tuesday Eastern
reader rollover, all 16 Week 1 games correctly became historical, but the
pipeline continued refreshing the Week 1 compact snapshot and never requested
Week 2. The live member board therefore showed zero games.

A read-only production audit found 16 stored Week 1 games, zero future Week 1
games, and no Week 2 evidence or compact snapshot. A no-write Week 2 provider
probe returned all 16 verified games and current named-book odds for all 16.
The existing no-write writer replay produced 15 games / 45 predictions and
isolated provider game `1392236`: its Total PMF selected Under 41.5 while the
mean of that same skewed distribution was 41.750312, 0.250312 points above the
line. The default 0.25-point mean/median tolerance missed it by 0.000312 and
caused the complete-slate publisher to reject all 16 games.

Affected scope is NFL Moneyline, Spread, and Total schedule selection and the
shared cross-market publication gate. The member reader, health route, and the
existing `/api/cron/nfl-forward-evidence` writer are affected. The writer
remains the sole authority under `prediction_pipeline:nfl`; no timer, provider,
table, stake path, or independent writer is added.

## Release contract

- New week selector:
  `nfl_forward_week_selection_2026_09_15_r1_tuesday_et_rollover`.
- Sole writer:
  `nfl_forward_evidence_writer_2026_09_15_r26_week_rollover_coherence`.
- Shared coherence gate:
  `football_cross_market_coherence_2026_09_15_r9_nfl_half_point_mean_median`.
- Existing NFL member/model/calibration/decision/grade releases remain
  `nfl_v1_member_release_2026_09_14_r13_prediction_owned_side`,
  `nfl_v1_daily_edge_model_2026_09_14_r10_prediction_owned_side`,
  `nfl_v1_daily_edge_calibration_2026_09_14_r10_prediction_owned_side`,
  `nfl_v1_daily_edge_decision_2026_09_14_r16_prediction_owned_side`, and
  `nfl_v1_grade_policy_2026_09_14_r16_prediction_owned_side` because their
  same-input forecast, probability, side, and grade behavior is unchanged.
  Later-week forecasts continue to stamp the existing target-excluded weekly
  outcome release.

The 2026 regular-season calendar advances at Tuesday 00:00 Eastern. The
configured week remains an operator-controlled floor, and undeclared future
seasons fail closed to that configured value. The reader, writer, and health
route call the same selector, preventing reader/writer identity drift.

The NFL writer opts into a 0.5-point public-score direction tolerance only
when the selected side is already proved by the released PMF. This matches one
half-point football line increment and the existing CFB bound. A PMF-side
disagreement or a mean disagreement beyond 0.5 remains fatal. This changes no
forecast distribution, expected score, selected side, probability, exact
price, grade, actionability, stake, T-60 rule, tracking record, or settlement.
For identical inputs, promotions and demotions are both zero.

## Verification and rollback

Required proof is the focused selector, coherence, NFL writer, publication,
snapshot, tracking, TypeScript, lint, model-change, build, and integration
safety suite. The post-change no-write Week 2 replay produced all 16 games and
48 predictions: **0 Best Angles / 0 Leans / 8 Watchlists / 40 No Plays / 0
held games**. Relative to the identical input before the gate repair, the
complete output moves from 15 games / 45 predictions / 1 held game to 16 / 48
/ 0 while the 45 matching predictions have zero side, probability, grade, or
actionability changes. Production acceptance requires one successful natural or explicitly
triggered run under the existing lease, a coherent Week 2 compact snapshot,
an empty released lease, and a responsive authenticated 16-game / 48-prediction
member board.

Roll back the r26 writer, r9 coherence gate, and r1 selector together if the
week advances before Tuesday Eastern, any game disappears, a PMF-opposed side
passes, same-input grades change, the writer overlaps another lease holder, or
the reader and writer resolve different weeks. Preserve all immutable evidence
and locked tracking rows during rollback.
