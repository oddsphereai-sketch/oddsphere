# NFL player props external-feature model predeclaration

Date: 2026-10-08
Starting production base: `0c4d31d21dd6aae08eb7b49cf89cc4d1ee8ddc6a`
Status: frozen shadow research; no production identifier reserved

## Scope and current champion

This audit is limited to the independent NFL Player Props point/distribution models for Passing
Attempts, Passing Completions, Passing Yards, Rushing Attempts, Rushing Yards, Receptions, and
Receiving Yards. It does not change Anytime Touchdown, member presentation, grades, stakes,
representative-line selection, market reading, provider cadence, refresh scheduling, the 3:00 a.m.
board boundary, T-60 behavior, injury/odds fallback, the sole writer, or the
`prediction_pipeline:nfl` lease.

The active production family at the starting base is r8/r17/r19/r22/r23/r26/r34/r17/r40/r22 as
recorded in `docs/current-model-releases.md`; only Rushing Attempts differs from the preceding
full-family/mean-quintile family. Every stored locked payload remains byte-authoritative.

## Frozen hypothesis

The current generic rolling player/team model omits public, research-supported separation between
play opportunity, opportunity quality, and player execution. Adding only strictly shifted public
features should improve conditional performance without using the prop market:

1. team neutral-state xPass, pass over expectation, pace, early-down pass rate, shotgun/no-huddle,
   and play-volume context for opportunity;
2. PFR pressure, on-target/drop, play-action, and RPO history for passing environment;
3. NGS CPOE, intended/completed air yards, time to throw, separation/cushion, expected YAC/YACOE,
   expected rushing yards/RYOE, box exposure, efficiency, and time to LOS for player skill and
   opportunity quality; and
4. FTN-charted motion, play action, RPO, screen, box, blitz/pass-rusher, catchable/contested/drop,
   quarterback-movement, and read-progression context; and
5. corrected actual-opponent team/position allowances, with no fabricated assignment-level CB/WR
   or OL/DL grade.

The candidate remains market-free. Prop lines and prices appear only in the later replay evaluator.

## Frozen candidate sequence

For every market, fit the exact released point head and these additive ablations on identical rows:

- `state`: corrected opponent identity plus xPass/pace/game-state features;
- `state_pressure`: state plus PFR pressure/play-design features;
- `state_ftn`: state plus FTN play-level charting features;
- `state_ngs`: state plus market-relevant shifted NGS features;
- `full_external`: state plus PFR, FTN, and NGS;
- 25%, 50%, and 75% blends of each candidate with the released head.

Count heads may test Poisson and squared-error boosting. Yardage heads may test squared-error,
absolute-error, and regularized tree ensembles. The same candidate name must be selected before the
2026 replay is opened. No 2026 outcome may choose a feature family, weight, hyperparameter, or rule.

## Chronology

- 2016-2023: training only, subject to source availability.
- 2024: candidate selection.
- 2025: confirmation. This season has been opened by prior OddSphere audits and is not described as
  a fresh holdout.
- 2026 Weeks 1-4: current-season replay holdout, opened once after the model and distribution
  candidate is frozen. Every feature must be reconstructible from data available before that game's
  stored lock timestamp; otherwise the row is excluded with an explicit data-health reason.

The 2026 replay, not prior-season aggregate performance, determines whether this work can advance
beyond shadow. Prior seasons support training and falsification only.

## Frozen metrics and acceptance gates

Report each market independently and report the aggregate only secondarily:

- row/game/player counts, played-only and offered/locked coverage;
- MAE, RMSE, mean bias, underprediction rate, and four chronological segment deltas;
- game-clustered paired 95% intervals for MAE delta;
- CRPS/NLL or Brier/log loss and 80%/90% interval coverage;
- representative-line direction hit rate and calibration;
- promotions, demotions, actionable count, market mix, Over/Under mix, and locked-price units where
  complete exact-price evidence exists.

A point head may advance only if:

1. 2024 selection improves both MAE and RMSE;
2. 2025 confirmation does not regress either metric and does not create a material bias failure;
3. 2026 Weeks 1-4 improves MAE and RMSE, has a game-clustered interval excluding zero or a material
   effect with consistent weekly direction, and does not hide a prop-family failure in the aggregate;
4. the matching distribution improves its proper score without materially worsening interval
   coverage; and
5. the exact replay preserves at least 80% of incumbent actionables, pairs every demotion with the
   tested symmetric promotion path, and creates no nonpositive-EV actionable.

If a market fails, its released head remains unchanged. A different market may advance only through
its own complete gate. No threshold relaxation, global upward shift, Over quota, or board suppression
may compensate for a failed point model.

## Data and runtime gates

- Cache every research source with URL, retrieval timestamp, byte count, and SHA-256.
- Shift every postgame source by at least one completed game.
- Treat missing NGS rows as unavailable; NGS minimum-volume publication may not be interpreted as a
  zero player skill value.
- Do not consume delayed 2023+ participation data in live inference.
- Do not add a provider call, timer, writer, or lease in this audit.
- Do not assign production release identifiers unless a candidate passes and the existing sole
  inference writer can populate the same feature contract.
- Preserve all prior locks and release-separated evaluation.
