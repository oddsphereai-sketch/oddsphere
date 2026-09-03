# MLB props r41 post-calibration action coherence

Status: qualified production candidate pending protected publication and natural-cycle proof.

Release: `mlb_props_2026_09_02_r41`. Rollback is the complete r40 release.

R40 correctly forms one target-excluded posterior, selects a forecast side, derives a decimal
expected-count projection, and grades the exact evaluated quote downstream. Its final display
projection calibration intentionally runs after grade selection. A later RBI value-portfolio
promotion could therefore remain actionable even when that final calibrated expected count
pointed through the evaluated line in the opposite direction. Joshua Baez Over 0.5 RBIs at +281
was the live reproduction: Lean with a final displayed projection of 0.42369049.

R41 adds one final fail-closed actionability pass after display calibration and after all portfolio
promotions. An unlocked ordinary two-way Best Angle or Lean whose final projection opposes its
selected side becomes Watchlist with zero units and the existing
`PROJECTION_SIDE_CONTRADICTION` reason. Probability, posterior side, projection, exact named-book
price, fair price, EV, market edge, and all evidence remain unchanged. A coherent actionable row
remains actionable, so the existing validated promotion paths remain available without a quota or
replacement action. Intentional one-sided 1+ Home Run milestone offers retain their event-value
semantics. Locked rows remain byte-precedent.

The target-excluded comparator gate, missing-evidence neutrality, category priors/caps, grade
thresholds, provider calls, database query/write counts, writer, cron, member DTO/UI, and shared
`prediction_pipeline:mlb` lease are unchanged.

## Equal-input production replay

The SELECT-only replay used production snapshot
`b4b2d36c-433c-4452-ba00-892890cd86de` (r40, `2026-09-02T21:47:20.468Z`, 4,144 rows).
R41 changed exactly one grade/action tuple: Joshua Baez RBI Over 0.5 at DraftKings +281 moved
from Lean/1 unit to Watchlist/0 units because its final calibrated projection was
0.4236904897838468. The row's side, model probability (0.345374), projection, exact price, fair
price, EV, market edge, evidence, and release-independent health fields were identical. No exact
DraftKings Under 0.5 quote existed in the same cycle, so the model correctly retained its forecast
and declined to manufacture a complementary bet.

- Grades: `19/52/1354/1316/1078/325` Best Angle/Lean/Watchlist/No Play/Research/Pending became
  `19/51/1355/1316/1078/325`; actionability moved `71 -> 70`.
- Promotions/demotions: `0/1`. Ordinary actionable projection contradictions moved `1 -> 0`.
  Intentional Home Run milestone actions remained `4 -> 4`.
- Forecast/economics changes: zero probability, projection, side, line, price, EV, fair-price, or
  market-edge changes. Health-held rows remained `1,403`; locked rows were zero and lock changes
  were zero.
- RBI remained a populated 395-row category (`177 -> 178` Watchlist). Its sole prior action was
  the contradictory Baez row, so RBI actionability moved `1 -> 0` as a fail-closed safety result.
  Every other category and action count was identical. The focused regression proves a coherent
  RBI Lean remains actionable, preserving the promotion path without inventing a replacement.

The later natural r40 snapshot `af289653-3186-4048-b152-8105507666cd`
(`2026-09-03T00:17:20.507Z`, 3,534 rows) reproduced the same invariant on Kaelen Culpepper RBI
Over 0.5 at FanDuel +300: one Lean became Watchlist (`53 -> 52` total actions), ordinary
actionable contradictions moved `1 -> 0`, all forecast/economic tuples and 1,158 health-held rows
were identical, and five Home Run milestone actions were preserved.

The full frozen 5,269-row r38-to-r41 replay remains release-pure and target-excluded: 4,521 decimal
projections, 4,704 probabilities, and 209 forecast sides change from r38 through the already-live
r40 structural correction; r41 adds no forecast delta. It reports four promotions, 25 demotions,
105 actions, zero actionable side crossings without an exact complementary same-book/cycle quote,
zero actionable projection contradictions, and zero lock changes. Audit budgets remain two or
three SELECTs depending on replay mode, zero provider calls, and zero writes; production retains
its existing provider/query/write budgets, sole writer, cron, and lease.

The post-calibration audit treats a category becoming action-empty as acceptable only when every
removed action is an actual ordinary projection-side contradiction. Any unexplained newly flat
category is a hard failure. This preserves no-flat monitoring without weakening the safety gate or
manufacturing an action.

## Qualification gates

- Focused display-calibration, 393-case props engine, launch, market ownership, and MLB pipeline
  safety suites pass.
- Scoped ESLint and `tsc --noEmit` pass.
- `npm run verify:model-change` passes in full, including release ordering, target-excluded market
  ownership, writer/lease, lock, tracking, member-reader, and cross-sport safety suites.
- The production Next.js 16 webpack build passes after reading the repository's bundled Next 16
  guidance.
- `git diff --check` passes. Fresh-main ancestry/tree/overlap checks and protected remote checks
  are required again immediately before merge.
