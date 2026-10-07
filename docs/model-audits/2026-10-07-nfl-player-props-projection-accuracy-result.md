# NFL player props projection-accuracy research result

Date: 2026-10-07
Starting production base: `ad49470ed05d8345bd785d0b2ccd9a094151364b`
Historical feature SHA-256: `f80b1479ca27ddf91c256ff791bcd6dea1f435fd6248a95f1f63665b4c8cd8bd`

## Decision

Advance only the settlement-aligned Rushing Attempts candidate to release
coordination. Do not advance Rushing Yards, Receiving Yards, Passing Attempts,
Passing Completions, Passing Yards, or Receptions. Do not change a threshold,
grade rule, alternate-line policy, target-excluded market rule, stake, member
surface, writer, lease, cadence, provider budget, lock, or settlement rule.

The candidate is a 75% point head fit on prior-role-eligible player-games with
an official participation and a 25% blend of the released point head. The
historical `participated` outcome defines the target population only; it is not
a pregame model input. The residual distribution is refit on the candidate's
out-of-sample 2023-2024 residuals. The exported research shard changes only the
Rushing Attempts point model and its matching empirical residual distribution.

No production artifact or release constant is changed by this research branch.
No release number is reserved. Publication remains blocked until the separately
coordinating NFL Player Props task receives the result and confirms that its
latest work does not overlap. The task-message safety review rejected the
coordination payload containing internal model metrics, so this branch must not
be published or merged as a workaround.

## Root cause of the Under-heavy forecast board

The live 15:36 capture contained 289 ordinary scopes: 90 forecast Overs and 199
forecast Unders (31.1% / 68.9%). That total does not have one cause.

- The released historical volume and yardage tournament includes eligible
  roster/game rows with `participated = 0`. In 2025 those rows are 53.06% of the
  QB-eligible population, 47.15% of the rushing population, and 31.46% of the
  receiving population.
- The production settlement path does not grade a player absent from the final
  exact-game stat response as a zero. Those rows do not belong in the settled
  wager target distribution. Training them as zero outcomes pulls point centers
  and residuals away from the population the product actually settles.
- On the archived 14:36 current snapshot, the independent point projection was
  above the line on 92 of 275 ordinary scopes, while the raw posterior median
  was above the line on only 71. Rushing Attempts was point-center Under (one of
  19 point centers above the line). For Receiving Yards, 42 of 78 independent
  point centers were above the line but only 22 posterior medians were; for
  Rushing Yards the counts were 21 of 44 versus nine. Those latter two skews
  primarily come from the residual posterior, not a universally low point head.
- The downstream target-excluded market reader was not the general source of
  the direction skew. Outside the existing Receptions arbitration, the final
  forecast direction followed the raw posterior on the audited snapshot.

This diagnosis rules out a global upward shift, an Over quota, a threshold
relaxation, or alternate-line exposure. It also explains why the only accepted
candidate is market-specific.

## Frozen chronology and target

The tournament used the checksum-pinned official 2016-2025 player-game history.
Models trained through 2022 for 2023 selection; the identical selected blend
had to improve both MAE and RMSE in 2024 confirmation; 2025 was then opened once
as the holdout. Paired uncertainty was clustered by game, and the holdout was
split into four chronological segments. Distribution selection used 2023,
calibration used 2023-2024 out-of-sample residuals, and 2025 remained the
distribution holdout.

The supported features remain prior player workload and role, snap and volume
shares, prior team opportunity, opponent allowance, leakage-safe matchup
efficiency and explosive-play context, venue, roof, weather, home field, and
week. Current participation, prop lines, evaluated-book prices, and unstamped
historical injury strings are excluded. No reproducible historical OL/DL or
coverage-grade source exists on the frozen substrate; no coefficient is claimed
for one.

## Rushing Attempts result

The 75% conditional blend was selected on 2023 and confirmed without changing
its weight on 2024.

| Cohort | Incumbent MAE / RMSE | Candidate MAE / RMSE |
| --- | ---: | ---: |
| 2023 selection, 1,883 rows | 3.18167 / 4.50339 | 3.12530 / 4.26295 |
| 2024 confirmation, 1,862 rows | 3.24579 / 4.51590 | 3.16508 / 4.29139 |
| 2025 holdout, 1,809 rows | 3.13553 / 4.37183 | 3.05408 / 4.14461 |

On the 2025 holdout, mean bias improves from -0.90974 attempts to -0.22787 and
the underprediction rate improves from 52.239% to 44.389%. The game-clustered
paired MAE delta is -0.08141 with a 95% interval of [-0.12807, -0.03601] over
272 games. The four chronological MAE deltas are -0.15113, -0.02548, -0.06362,
and -0.08541; no segment supplies a hidden failure.

The matching holdout distribution improves CRPS from 2.23959 to 2.16308 and NLL
from 2.68314 to 2.64071. Its 80% and 90% interval coverages are 0.82090 and
0.90381. Point and distribution gates both pass.

The research shard is
`football-research/cache/nfl-player-props-projection-accuracy/nflPlayerPropsRuntimeMarketRushingAttemptsCandidate.json`.
Its source shard SHA-256 is
`62d4106e2e026d593f767c7e9044e866eff087263e013a687783fec1d8452754` and
candidate SHA-256 is
`8ba171fe49c1ff87d50d3cc05fa52c2c77a4a7f84b8efc9f53766c8801249c02`.

## Exact-board evidence

The release-pure Week 4 replay used the same 720 decisions, 1,115 captured
offers, 249 feature rows, and zero provider calls or writes.

- Only the 124 Rushing Attempts decision rows changed. There were 13 forecast
  side changes, zero promotions, and one demotion.
- Rushing Attempts resolved direction improves from 38/62 to 41/62. Brier
  improves from 0.25649 to 0.25055, log loss from 0.73992 to 0.72426, and the
  calibration gap from 0.10442 to 0.07088.
- Across all 291 resolved ordinary scopes, direction improves from 162 to 165
  wins, Brier from 0.25609 to 0.25482, log loss from 0.71527 to 0.71194, and the
  calibration gap from 0.10197 to 0.09483.
- The sole demotion is Javonte Williams Under 15.5 at DraftKings, Lean to
  Watchlist. The official outcome was 19 attempts, so the removed action had
  lost. Total resolved actionables move from nine to eight, wins remain five,
  and units improve from +0.196 to +1.196. There are no nonpositive-EV
  actionables and no promotion-only board expansion.

The frozen 14:36 current-board A/B replay reconstructs both artifacts through
the identical stored-evidence path. Its reconstructed rows must not be compared
directly with the published snapshot because the current-season feature store
is mutable; the artifact-to-artifact delta is controlled.

- All 760 candidate rows match the control, and all 38 changed rows are Rushing
  Attempts (19 two-sided scopes).
- Forecast scopes move from one Over / 18 Under to seven Over / 12 Under. Six
  scopes flip from Under to Over without a direction quota.
- There are zero promotions and one demotion: Javonte Williams Under 17.5 at
  DraftKings moves from Lean to Watchlist. No other market or actionable changes.

## Rejected candidates

- Rushing Yards and Receiving Yards did not produce a settlement-aligned blend
  that improved both 2023 selection MAE and RMSE, so neither reached the
  holdout as a candidate. The direct Receiving Yards residual correction did
  lower 2025 MAE from 15.65236 to 15.42465, but its underprediction rate moved
  in the wrong direction (28.930% to 29.225%); it fails the frozen point gate.
- Conditional Passing Attempts, Passing Completions, and Passing Yards improved
  aggregate 2025 errors but each failed the fourth chronological segment. The
  conditional Receptions blend worsened 2025 MAE. None advances.
- A line-blind residual Passing Completions correction passed the statistical
  point/distribution tournament by a small margin (2025 MAE 4.01589 to 4.00081),
  but the exact-board product replay changed coupled Passing Attempts through
  the coherent QB market marriage. Overall Week 4 direction fell from 162/291
  to 161/291, Brier and log loss worsened, and three actions were promoted with
  no paired demotion. It is rejected rather than weakening cross-market
  coherence or accepting an unvalidated spillover.
- A line-blind Receptions residual correction also passed the statistical
  tournament (2025 MAE 1.19757 to 1.18937), but exact-board direction fell from
  162/291 to 161/291. It produced four promotions and two demotions, moved
  resolved actionables from nine to ten, and changed units from +0.196 to
  -2.336. It is rejected. A better average point error is not permission to
  worsen the released decision surface.

## Publication and rollback boundary

If coordination authorizes publication, the production change is limited to
the Rushing Attempts portable shard and the corresponding model/calibration/
runtime/board/decision/member release identifiers plus the current release
registry. Existing locked rows must retain their stored legacy projection,
probability, side, grade, price, evidence, and release tuple. The sole
`prediction_pipeline:nfl` lease and writer remain authoritative.

Before a pull request, resolve the latest remote `main`, integrate it into the
dedicated branch, rerun the focused runtime/production/lock tests and
`npm run verify:model-change`, rerun both exact-board controls, and run
`node scripts/verify-integration-safety.mjs --base-ref=<latest-main-ref>` from a
clean committed worktree. After merge, verify the deployed release tuple,
writer/lease health, current board coverage, reader coherence, and immutable
lock precedence. Roll back the complete new release family and Rushing Attempts
shard together; never reinterpret or overwrite an existing locked payload.

## Verification completed on the research branch

- Python compilation passed for the bias audit, both tournaments, Rushing
  Attempts exporter, and same-board comparator.
- `npx tsc --noEmit --pretty false` passed.
- `scripts/test-nfl-player-props-runtime.ts` passed portable parity and decision
  primitives.
- `scripts/test-nfl-player-props-production-contract.ts` passed sole-writer,
  T-60 freeze, tracking, and CLV invariants.
- `scripts/test-nfl-player-props-market-board.ts` passed exact pairing, no-vig,
  material-change, and lock checks.
- `scripts/test-nfl-player-props-market-evidence-capture.ts` passed bounded
  evidence retention.

Full `verify:model-change`, fresh-main integration safety, protected PR checks,
and live deployment verification were not run because no production release is
being published from this uncoordinated research branch.
