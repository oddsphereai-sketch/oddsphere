# NFL player props opportunity-budget and distribution research predeclaration

Date: 2026-10-07
Starting production base: `c4e1217648acf54bad77228452fa8ceccfed2d72`

## Scope and current champion

This audit is limited to the NFL Player Props product. It may change the
independent opportunity/workload model, market-specific outcome distributions,
target-book-excluded market arbitration, probability calibration, and the
downstream grade policy only when the frozen gates below pass. It does not change
member copy, labels, layout, canonical one-line presentation, provider cadence,
refresh scheduling, the 3:00 a.m. ET board boundary, T-60 operational behavior,
injury or odds fallback ownership, stakes, settlement, the sole writer, or the
`prediction_pipeline:nfl` lease.

The active portable/model/calibration/decision/runtime/board/member/lifecycle/
writer/tracking family is r6/r15/r17/r20/r21/r24/r32/r15/r37/r20 as recorded in
`docs/current-model-releases.md`. The October 7 release permits a full
target-book-excluded market-side flip only for qualifying Receptions conflicts.
Every other market retains its preceding posterior behavior. Locked decisions
and their projection, side, probability, price, grade, evidence, and tracking
tuple remain immutable.

## Established evidence and failure modes

- The 2026-10-07 13:51Z Week 5 snapshot has 959 member rows across 687 canonical
  player/market scopes and no duplicate-line scope. The internal board has 24
  actionables: three Overs and 21 Unders. This is a diagnostic imbalance, not a
  quota or permission to promote Overs.
- Current r20 has no settled outcomes. Mixed-release archive results cannot be
  reported as current-model performance. The 151 resolved archive actions are
  77-74 overall; Receiving Yards Under is 12-19, which is a hypothesis target,
  not a tuning label.
- The existing full-family model already includes player history and role,
  team/opponent play mix and efficiency, pressure/sacks, explosive plays,
  air yards/YAC, environment, and official current-season overlays. The new
  candidate must improve the architecture rather than merely add these fields
  again.
- The rebuilt official 2016-2025 substrate has 138,860 player-game rows, 2,639
  games, and 99.2584% outcome/roster identity coverage. Upstream corrected
  source bytes produce a new feature checksum, so incumbent and candidate must
  be refit and compared on the same checksum-pinned bytes.

## Frozen hypotheses

1. Opportunity should be forecast before efficiency. Team pass, rush, target,
   and play budgets will be estimated first; active-player attempt/carry/target
   shares will then use partial pooling toward position and team-role priors.
   Player projections must reconcile to the applicable team budget rather than
   being independent unconstrained point heads.
2. Related markets should share latent workload. Passing Attempts supplies the
   quarterback opportunity budget for Completions and Passing Yards; targets
   supply Receptions and Receiving Yards; carries supply Rushing Yards. Each
   conditional efficiency remains market-specific and may retain a stronger
   direct-head component when chronology supports it.
3. Count markets will test overdispersed and hurdle-aware distributions against
   the incumbent empirical residual family. Yardage markets will test
   role/volume-conditioned residual scale and heavy-tail alternatives. A point
   gain may not be promoted if probability calibration worsens materially.
4. The independent model remains primary. Same-line, target-book-excluded
   evidence may confirm, adjust, or flip only under a predeclared market-specific
   rule. Circa, Pinnacle, and Bookmaker remain distinct higher-trust sources;
   fallback books cannot be assigned equal trust or crossed to fabricate a
   trail. Missing evidence is neutral.

## Chronology and frozen metrics

- Official settled box-score outcomes only. Training ends in 2022, 2023 is
  selection, 2024 is confirmation, and 2025 is an untouched holdout.
- Fit incumbent and candidate on the exact same checksum-pinned source bytes.
  Report MAE, RMSE, bias, direction at representative historical lines when
  available, distribution log loss/CRPS or Brier, central interval coverage,
  and game-clustered uncertainty by prop market.
- Market-reading and grade decisions use only release-pure, pregame captures,
  target-book exclusion, and strict chronology. Report direction, Brier/log
  loss, calibration gap, locked-price record/units, exact-price grade
  calibration, and market/source/timing cohorts. Do not infer historical sharp
  movement from terminal prices.
- Report provider coverage, supported/offered/modeled market counts, missing
  games and scopes, representative-line uniqueness, promotions, demotions,
  actionable counts, grade mix, market mix, and Over/Under mix on an identical
  current-board replay.

## Frozen acceptance gates

- A point head may advance only if both MAE and RMSE improve against the refit
  incumbent in selection and confirmation and do not regress either measure on
  the untouched holdout. A sub-0.25% holdout improvement is insufficient unless
  a game-clustered interval excludes zero and the distribution metrics also
  improve.
- A distribution may advance only if holdout log loss/CRPS or Brier improves,
  80%/90% interval coverage is not materially worse, and the displayed
  projection, side, and probability remain one coherent posterior.
- A market-arbitration rule may advance only after selection and confirmation
  both improve direction and Brier/log loss. It must not use the evaluated
  sportsbook, current outcome, or a cross-book fabricated movement trail.
- Every actionable demotion must be evaluated with the same symmetric promotion
  path. The identical-board candidate must retain at least 80% of incumbent
  actionables, preserve every genuinely offered eligible market/game, contain
  no nonpositive-EV actionable, and disclose all side/grade transitions. Counts
  are evidence, never quotas.
- The release must add no provider request, per-card loop, writer, schedule,
  lease, member copy, label, layout, or stake. It must preserve last-coherent
  publication on failure and byte-preserve every prior lock.

If the first candidate fails, diagnose the failed market and return to the
opportunity, role, matchup, distribution, market-reading, or grading layer with
a new falsifiable candidate. No live identifiers advance until one complete
candidate passes the chronology, same-board, lock, load, and verification gates.

## Reserved release family if and only if accepted

- portable/model/calibration/decision: r7/r16/r18/r21
- runtime/board/member/lifecycle: r22/r25/r33/r16
- writer/tracking: r38/r21

Publication additionally requires focused tests, `npm run verify:model-change`,
latest-main integration, a clean integration-safety proof, a protected pull
request, green required checks, deployed release/coverage/lease/reader proof,
and verification after the next scheduled writer and lock sweep.
