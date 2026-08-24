# EPL same-day board retention

## Scope

Reader/writer lifecycle only. This change does not alter an EPL prediction,
probability, projection, market side, price, grade, stake, lock tuple, result,
tracking settlement, provider request budget, or model release.

## Production defect

On August 24, the provider marked Chelsea at Fulham final. The default EPL
round selector immediately advanced from Round 1 to the next unfinished round,
so the single `current-week` member snapshot was replaced before the existing
2 a.m. Eastern soccer-board rollover. The reader correctly filtered its input,
but today's locked fixture was no longer present to retain.

## Fix

- Prefer the round containing the current member-facing soccer board date,
  including when its fixture is final.
- Advance to the next unfinished round only after the existing 2 a.m. Eastern
  rollover.
- Preserve a same-day locked game defensively when an incoming snapshot omits
  it, while continuing to freeze its complete betting tuple.
- Keep final-result settlement independent and immediate.

The weekly reader lifecycle identifier advances to
`daily_edge_weekly_reader_lifecycle_2026_08_24_r2`.

## Verification

A bounded provider read reconstructed Round 1 with all ten completed fixtures,
including `CHE@FUL` at `2026-08-24T19:00:00Z`, final `3-2`. Deterministic tests
prove that Round 1 remains selected before rollover, Round 2 becomes eligible
after rollover, locked projections remain immutable, and the board date follows
the retained fixture. Focused EPL and Daily Edge tests, TypeScript, ESLint, the
full model-change suite, production Webpack build, and diff checks pass.
