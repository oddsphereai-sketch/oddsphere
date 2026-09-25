# NFL raw-signal repair predeclaration

Date: 2026-09-25

Candidate: `nfl_weekly_raw_signal_2026_09_25_r2_current_season_possession`

Scope: NFL regular-season Daily Edge Moneyline, Spread, and Total forecasts;
the sole NFL writer and existing `prediction_pipeline:nfl` lease only.

## Problem

After Week 1 the production score path does not ingest current-season team
performance. It uses the market-led R6 margin and market total as its centers,
then permits split evidence to move those centers. On the immutable 2026 Week
1-2 cohort, the calibrated Total core was 16/31 (51.61%), but the published
post-overlay Total was 13/32 (40.63%). The applied Total shifts agreed with the
result in 8/21 games.

The owner has directed that the raw prediction signal—not thresholds, hidden
No Plays, or board quotas—be repaired and made more accurate. No member copy,
label, badge, layout, stake, second writer, new schedule, or per-card provider
request is authorized.

## Frozen candidate

1. Build one current-season matchup margin from the already-captured weekly
   team state: points, plays, sacks, turnovers, and red-zone conversion, using
   the historically selected slow possession/efficiency recipe.
2. Blend that independent margin 10% with the target-excluded market margin
   90%. Recompute it inside each target-exclusion iteration so the evaluated
   sportsbook cannot become its own model input.
3. Preserve the existing price-neutral calibrated Total core.
4. Only valid same-book opening-to-current Total movement from a sportsbook
   outside the evaluated Total family may alter the score mean. Money/ticket
   splits remain captured and available to the decision layer but cannot
   directly rewrite the raw Total mean.
5. Derive the coherent home/away scores, winner, Spread, Total probabilities,
   decisions, and grades from the one resulting joint distribution.

The current-season state is read once per writer cycle. If it is unavailable or
incomplete through the prior week, the writer fails before publication and the
last coherent member snapshot remains in place.

## Evidence and release gates

The already-open 32-game Week 1-2 replay is diagnostic, not a pristine
holdout. It must report candidate versus published direction and point error.
The current Week 3 board must report exact side changes, promotions, demotions,
grade counts, actionable counts, direction mix, target-exclusion stability,
and locked-game preservation. A flatter board, incomplete price tuple, mixed
release, T-60 rewrite, failed coherence assertion, or load expansion blocks
the release.

Every affected model, distribution, probability, calibration, decision,
grade, member, evidence, writer, fixture, snapshot, and tracking identifier
must advance together. Required verification is the focused NFL suite,
`npm run verify:model-change`, TypeScript, lint, build, latest-main integration
safety, protected PR checks, and live release/reader/database proof.
