# NHL foundational reset predeclaration — 2026-10-15

## Objective and immutable boundary

Prediction accuracy is the primary objective. Exact-price value and actionability
remain downstream decision evidence; they cannot substitute for selecting the
correct winner, puck side, or Total side. Existing locked predictions, grades,
prices, snapshots, and release identities remain byte-for-byte immutable.

The sole writer remains `writeNhlPredictionRecords` under
`prediction_pipeline:nhl`. Any production candidate must advance the complete
model/calibration/decision family and the release registry, preserve one coherent
joint score distribution, and publish only through the latest-main clean-worktree
pull-request process.

## Authoritative before-board

The SELECT-only production audit through the October 14 slate contains 107
complete settled regular-season locks and 321 official market decisions.

| lane | OddSphere | competitor | difference |
| --- | ---: | ---: | ---: |
| Moneyline | 62-45, 57.94% | 52-34, 60.5% | -2.56 pp |
| puck line | 62-45, 57.94% | 49-37, 57.0% | +0.94 pp |
| puck line +1 | 80-27, 74.77% | 61-25, 70.9% | +3.87 pp |
| puck line +2 | 96-11, 89.72% | 75-11, 87.2% | +2.52 pp |
| Total | 51-55-1, 48.11% | 44-42, 51.2% | -3.09 pp |
| Total +1 | 77-28-2, 73.33% | 64-22, 74.4% | -1.07 pp |
| Total +2 | 88-18-1, 83.02% | 70-16, 81.4% | +1.62 pp |

The denominators differ. These figures establish directional product gaps; they
are not a matched-game head-to-head test.

The active r17-only forward record covers 42 games from October 9 through
October 14: Moneyline 21-21, puck line 26-16, Total 24-18, puck +1 33-9,
puck +2 39-3, Total +1 33-9, and Total +2 38-4. Its independent Total was
24-18. R17 changed twelve settled Total outcomes, making six corrections and
six harms. It also worsened Total MAE from 1.63346 to 1.67081 and reduced Total
correlation from 0.11704 to 0.00948 on this opened forward sample.

## Structural defects established before candidate testing

1. MoneyPuck's 2026 team-game CSV removed the redundant `season` column. The
   loader already knows the requested season from the URL but treats that column
   as mandatory. The resulting `header is incomplete` error makes the
   opponent-adjusted state fail closed. Only the first five opening-day locks
   contain that layer; all 42 r17 locks and 102 of 107 season locks do not.
2. The feature snapshot collects a named goalie and `goalie_xgsaa_per_60` for
   both teams, but `scoreFeatures` never consumes the goalie field. The stored
   `goalie_advantage_goals` explanation instead uses the opponent goals-versus-xG
   residual feature and is therefore mislabeled.
3. The scheduled writer does not ingest or verify a pregame starting goalie.
   It chooses the current-roster goalie with the most games played and labels
   the source `default_most_playoff_gp`. Manual overrides exist only in an
   operator path. NHL injury/availability evidence is not an input.
4. The active score coefficients were fit on the prior MoneyPuck xG definition.
   MoneyPuck states that its shot/xG model was rebuilt for 2026-27. Runtime
   feature-distribution drift must therefore be measured before refitting or
   trusting a coefficient transplant.
5. Current grades are not ordered by accuracy: across all 321 decisions,
   Best Angle is 17-16 (51.52%), Lean is 103-82-1 (55.68%), and Watchlist is
   55-47 (53.92%). Threshold-only retuning cannot repair the underlying score,
   but grade reliability must be revalidated after any score candidate.

## Candidate families fixed before outcome review

### A. Input-contract parity

Accept both historical MoneyPuck CSVs that contain `season` and current CSVs
that omit it. When omitted, derive the season only from the already validated
request path. Reject an explicitly present mismatched season. Replay only
complete paired games strictly earlier than the target slate. Measure the
restored opponent-adjusted Total on the exact historical production locks and
the unlocked current board before it can ship.

### B. Independent score architecture

Re-run the frozen chronological research architecture with only pregame inputs:
longer-history regularized scoring chances, opponent-adjusted attack/defense,
home/rest, special teams, shooting-talent/finishing evidence, and goalie-pool
quality. Moneyline, puck line, and Total must derive from one coherent
settlement-aware distribution. A feature is eligible only if it has runtime
parity and improves later untouched evidence, not merely the 107 opened games.

### C. Goalie and availability correctness

Separate three states: verified starter, probabilistic goalie pool, and unknown.
The current most-games-played proxy may not be represented as confirmed. Goalie
quality can enter a production score only after a timestamped pregame identity
or a validated pregame mixture is available, with a neutral fail-closed path.
Retrospectively known starters remain diagnostic upper bounds. Injury or roster
absence must never be silently interpreted as healthy.

### D. Market reconciliation

Preserve the validated discrete Moneyline correction unless later evidence
supports a replacement. Re-estimate the r17 Total authority on chronological
selection and later confirmation rather than turning it off from six forward
harms or keeping full authority from its initial 65-game audit. Test continuous
authority, named/broad sequence disagreement, target exclusion, and independent
uncertainty. Report every correction and harm. Public splits remain non-moving
until append-only T-60 provenance exists.

## Evaluation protocol

1. Keep the immutable 107-game public record separate from every counterfactual.
2. Report the current r17 release separately; never label a release blend as
   current-model performance.
3. Use 2022 warm-up, 2023 training, 2024 family/regularization selection, the
   first 70% of priced 2025 for reconciliation selection, and the last 30% as
   untouched confirmation for reproducible historical architecture tests.
4. Treat reconstructed 2026 source rows as opened validation and state the
   timestamp/provenance limitation. They may reject a candidate but cannot by
   themselves prove production readiness.
5. Report all seven lanes, team-score/margin/Total MAE, Brier/log loss,
   calibration, favorites/underdogs, upset recall, corrections/harms, exact-price
   return, grades, promotions/demotions, and board counts.
6. Review every current-release loss and every candidate harm. Distinguish
   independent-model error, goalie/availability uncertainty, missing input,
   false market read, cross-market disagreement, and irreducible variance.
7. Reject any candidate that improves one lane by materially damaging another,
   flattens the board, uses post-lock evidence, or cannot be reproduced by the
   production writer.

## Production gates

A candidate may be proposed for owner approval only after it has a positive
multi-metric result on later evidence, paired promotion/demotion reporting,
writer and reader lock-precedence tests, one authoritative release/version path,
focused NHL tests, TypeScript, `npm run verify:model-change`, latest-main
integration safety, and an exact current-board rehearsal. Merge and live
activation require explicit owner approval and post-deploy verification of the
release tuple, natural refresh, coverage, lease, immutable locks, tracking, and
member-reader coherence.
