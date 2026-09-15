# NFL weekly PMF boundary recovery predeclaration

Date: 2026-09-15

## Incident and frozen change

The live Week 2 board is complete, but a read-only replay of the next ordinary
unlocked writer cycle exposed a repeat of the September 15 game-isolation
failure. Two otherwise complete games were rejected because the authoritative
discrete PMF selected Under while the mean of that same distribution sat only
`0.577775` and `0.500003` points above the exact Total line. The existing NFL
allowance was 0.5 point, so the next natural refresh would have proposed only
14 games / 42 predictions and isolated games `1392238` and `1392239`.

Before inspecting a candidate replay, freeze the NFL-only PMF/mean boundary at
one point. The decision must still match the exact released PMF side at the
evaluated line. A disagreement wider than one point remains fatal. CFB retains
its existing 0.5-point boundary and the shared default remains 0.25 point.

Because this changes whether a forecast may publish, release it as a new NFL
model/calibration/decision/grade/member family even though it does not alter a
forecast, probability, side, exact price, grade, or stake for any matching row.
Retain the single `prediction_pipeline:nfl` lease, sole writer, append-only
evidence, T-60 precedence, official tracking boundary, and zero-stake policy.

## Acceptance gates

- The identical due-cycle input publishes 16 games / 48 predictions and zero
  held games.
- The 42 previously valid rows have zero side, probability, exact-price, grade,
  or actionability changes.
- Both isolated games publish the PMF-selected side; a synthetic disagreement
  wider than one point still fails closed.
- Actionable promotions and demotions are both zero on identical rows. The two
  repaired games may add only their already-computed non-held dispositions.
- The health cron reports a zero-actionable warning as a partial run so the
  state pages operators without manufacturing a play or withholding the slate.
- Focused NFL tests, TypeScript, `npm run verify:model-change`, production build,
  integration safety, protected PR checks, and post-merge live verification all
  pass.

Rollback the complete release family if any matching prediction changes, any
PMF-opposed decision publishes, a wider contradiction passes, the weekly slate
is incomplete, or writer/lease health regresses. Preserve immutable evidence
and locked tracking records during rollback.
