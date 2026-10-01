# NHL r13 price-aware grades and empty-slate recovery — 2026-10-01

## Decision

Release `nhl_regular_2026_r13_price_aware_grades`, calibration
`nhl_regular_calibration_2026_r13_price_aware_grades`, and decision
`nhl_regular_decision_2026_r13_price_aware_exact_price` preserve the complete
r12 forecast and market-reading path. Only downstream exact-price actionability
changes.

- A Best Angle at -200 or shorter becomes a Lean, remaining actionable.
- A selected price at -900 or shorter becomes a No Play.
- The paired promotion moves a puck-line Watchlist to Lean only at the existing
  validated 58% selected-side probability and 5-percentage-point exact-price
  edge band.
- Missing exact prices remain No Play.

The puck-line promotion band returned +2.56% in 2024 selection and +8.76% in
untouched 2025 confirmation in the r8 release audit. It is reused unchanged and
does not generalize to Moneylines or Totals. The policy separates outcome
confidence from wager quality: a likely but expensive favorite is no longer
called the board's best wager, but it stays actionable as a Lean.

## Measured board impact

The exact October 1 production tuple contains 8 games and 24 markets. Applying
r13 to the stored selected prices changes 10 Best Angles / 6 Leans / 8
Watchlists to 8 / 8 / 8. UTA Moneyline at -213 and EDM Moneyline at -208 move
from Best Angle to Lean. There are zero prediction-side changes, zero score or
probability changes, zero No Plays, zero actionable promotions, zero actionable
demotions, and all 16 actionables remain. No current quote reaches the extreme
price safety boundary and no current Watchlist qualifies for the puck-line
promotion.

## Empty-slate recovery

The server-rendered member page already refreshes every 60 seconds and on
focus, visibility, reconnect, and back-forward restore. An already-open page
could nevertheless keep its cold zero-game server payload after the writer had
published a valid slate. The r13 UI repair passes only the initial game count to
the existing refresh component and performs one immediate server refresh when
that count is zero. It adds no provider call, database writer, model path,
polling loop, copy, label, or layout.

## Release gates

Before publication, run the focused NHL model test, Daily Edge experience test,
TypeScript, `npm run verify:model-change`, current-board release comparison,
latest-main integration safety, and protected pull-request checks. Verify in
production that all unlocked games use one coherent r13 tuple, locked r12/r10/
r9/r7 tuples remain immutable and tracking-eligible, every game retains all
three markets, scores and sides are byte-identical to r12 for equal inputs, and
an empty already-open board adopts a newly published slate without a reload.

Hold or roll back r13 on any score, probability, side, stake, lock, or tracking
change; missing game or market; action-count collapse; mixed unlocked release;
writer overlap; or repeated empty-state refresh.
