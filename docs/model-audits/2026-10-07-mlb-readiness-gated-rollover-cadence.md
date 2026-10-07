# MLB readiness-gated rollover and cadence

## Predeclared scope

This is an operational continuity and load repair. It does not change an MLB
projection, probability, side, price selection, grade, stake, lock, tracking
tuple, member copy, label, or layout. The active MLB champion release family
remains authoritative.

## Candidate

- Route the default MLB member board through the shared 03:00 ET board-date
  boundary already used by the other North American daily models.
- If the new date does not yet have a current-presentation snapshot, retain the
  exact preceding complete date-keyed snapshot. Explicit `?date=` reads never
  receive that fallback.
- Give the sole existing MLB slate writer a DST-safe 03:05 ET seed. Vercel
  invokes it at both 07:05Z and 08:05Z; the route admits only the invocation
  whose New York hour is 03. The other invocation returns before any provider
  or database work.
- Preserve the existing once-per-slate-day successful markers for season
  pitching and batting. Later full and intraday cycles continue using the same
  writer, sport-scoped `prediction_pipeline` lease, and provider gates.
- Do not publish a member response snapshot after partial/failed core work,
  failed Market Intelligence, an unsafe/absent slate (except a verified empty
  provider slate), or a failed snapshot write.

## Acceptance gates

- Summer and winter timestamps both admit exactly one 03:05 ET seed.
- The skipped UTC opportunity makes zero provider calls.
- MLB defaults roll at 03:00 ET and may retain only the prior date's current
  presentation snapshot; explicit-date behavior is unchanged.
- Existing full/intraday/lineup/splits/lock schedules remain staggered.
- Focused cadence, rollover, pipeline-safety, TypeScript, lint, build, and the
  full model-change suite pass from a clean latest-main branch.
- Production publication requires a protected PR, current-main ancestor and
  overlap verification, successful deployment, and live release/schedule
  verification.

## Board/model impact

Same-input prediction and grade impact is exactly zero. Promotions: zero.
Demotions: zero. Actionable count change: zero. The candidate changes when a
complete next-date board may replace the prior board and prevents an incomplete
cycle from publishing over it.
