# NFL Player Props independent-first Rushing Attempts predeclaration

Date: 2026-10-08
Starting production base: `0e7e6e056f9b7da64dc3f71920c908f577c7c5c5`
Active Rushing Attempts artifact SHA-256: `8ba171fe49c1ff87d50d3cc05fa52c2c77a4a7f84b8efc9f53766c8801249c02`
Historical feature SHA-256: `f80b1479ca27ddf91c256ff791bcd6dea1f435fd6248a95f1f63665b4c8cd8bd`

## Scope and diagnosis

This audit starts with Rushing Attempts only. It does not change another prop
market, grade threshold, stake, writer, lease, provider cadence, lock,
settlement rule, member copy, label, or layout.

The active point head is the settlement-aligned 25% incumbent / 75%
participation-eligible model released on October 7. It is a genuine independent
improvement and remains the fixed point-model input to this audit. The
downstream ordinary-market probability is not independent-first: production
computes

`logit(final) = logit(target-excluded market) + w * (logit(model) - logit(target-excluded market))`

with `w = 0.20` for Rushing Attempts. Thus the final probability is 20% model
and 80% target-excluded market in log-odds space. The displayed projection is
then reconstructed from that market-dominant posterior. Same-book movement may
slightly relax grade thresholds, but it does not have a separately validated
probability effect. This is the exact behavior under test.

## Frozen evidence and chronology

The independent head and residual distribution remain frozen from the prior
strict chronology: train through 2022, select on 2023, confirm on 2024, and
open 2025 once as holdout. This audit will not refit that point head.

Market-weight research will use the immutable 2025 BALLDONTLIE opening-price
snapshot joined to official settled player-game outcomes. One target book is
excluded from its own benchmark. The first chronological portion through
October 31 selects one predeclared weight; games on or after November 1 are the
untouched confirmation window. The exact 2026 Week 4 forward replay is an
opened product-impact diagnostic only, never the weight selector. A frozen
current board is outcome-free coverage and transition evidence only.

If the checksum-pinned 2025 opening snapshot is unavailable locally, the
existing bounded collector may recreate it once: at most four schedule pages,
285 exact-game opening calls at concurrency three, and bounded player-identity
pages. That local research acquisition is not a production loop and cannot be
added to a writer or cron.

## Candidate family

The current `w = 0.20` market-dominant blend is the incumbent. Predeclared
independent-first candidates are `w = 0.65`, `0.80`, and `1.00`; `w = 0.35`
and `0.50` are diagnostics only and cannot ship because the independent model
would not be primary. The target prop's evaluated sportsbook is excluded from
the market benchmark in every candidate. Exact evaluated price stays
downstream for EV and execution.

No candidate can use an Over quota, an Under quota, a board-size target, a
player outcome available after evaluation, a current-game participation
outcome, or a target-book line/price as an independent feature. Same-book
opening-to-current line and price movement will be reported separately by
direction, sportsbook, freshness, and outcome; it will not be assigned a new
probability coefficient without its own chronological selection and
confirmation evidence.

## Acceptance gates

A production candidate must satisfy all of the following:

1. On chronological selection and confirmation, improve both Brier score and
   log loss versus the active `w = 0.20` blend. It must not worsen direction
   accuracy or increase calibration gap by more than 0.005 on confirmation.
2. Preserve the active independent point/distribution metrics and artifact
   checksum; this audit cannot hide a weaker independent head behind a market
   blend.
3. On the exact same-input Week 4 replay, improve or preserve Rushing Attempts
   direction, Brier, and log loss; report every side, probability, projection,
   grade, promotion, demotion, actionable, and unit change. No nonpositive-EV
   actionable may be introduced.
4. Every actionable demotion must be paired with a tested promotion rule and
   its board-count impact. A candidate that only suppresses action or flattens
   the board fails.
5. The displayed projection, forecast side, probability, representative line,
   and exact-price grade must remain one coherent tuple. Existing locked rows
   retain exact stored precedence.
6. Provider calls and storage remain within the existing production budget;
   there is one writer under `prediction_pipeline:nfl` and no new polling path.

If no independent-first weight passes, the audit must identify whether the
failure is point accuracy, residual distribution, role/opportunity estimation,
matchup inputs, market-snapshot quality, or sample coverage. The next model
hypothesis must then be tested with the same chronology. Production cannot
retain a market-dominant blend merely by calling it a marriage, and it cannot
replace it with an unsupported independent-first coefficient merely to satisfy
that label.

## Publication boundary

Research is shadow/read-only until every gate passes. Any accepted change must
bump the complete affected model/calibration/decision/runtime/board/member/
writer/tracking family, preserve immutable locks, update the current-release
registry in the same commit, pass focused tests plus
`npm run verify:model-change`, integrate latest `origin/main`, pass
`scripts/verify-integration-safety.mjs`, and publish through a protected PR.
