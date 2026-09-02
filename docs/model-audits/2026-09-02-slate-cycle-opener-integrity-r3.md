# Slate-cycle opener integrity and partial lifecycle repair

**Date:** 2026-09-02
**Classification:** behavior-neutral operational repair
**Scope:** game-line history opener integrity and truthful slate-cycle lifecycle telemetry

## Production finding

The first natural cycle after the current-line batching release completed at
the top level, but S7 was only partial. The current-line generation timestamp
was `2026-09-02T17:06:28.499Z`; current replacement completed near
`17:08:45.984Z`; history append completed near `17:08:46.8Z`. The baseline
check then rejected all 1,071 rows because the exact explicit-opener count was
22,490, above its 10,000-row cap. A later natural lineup cycle repeated the
same failure at 23,556 rows.

The explicit opener corpus was polluted by the older
`flagOpenersInHistoryPayload` implementation. It queried matching games and
markets without an explicit range or exact count. PostgREST returned only its
first page, so exact sportsbook/side identities outside that page were
incorrectly treated as unseen and stamped as new openers. Separately, the S7
orchestrator adapter copied only record/API totals and discarded the line
service's `partial`, error, and detailed history telemetry. The route therefore
closed a partial cycle as successful.

## Repair

- Opener identity reads now request an exact count and page in deterministic
  `id` order. Count absence, count drift, page truncation, duplicate/non-numeric
  IDs, read failure, or a 50,000-row cap breach makes opener stamping fail safe:
  every incoming history row is appended with `is_opener=false`.
- Compact game/market database filters are restored to exact
  game/market/side/sportsbook/player identities client-side, preventing
  cross-product overfetch from satisfying an unrelated identity.
- The explicit baseline reader retains its existing exact-count,
  deterministic pagination and cross-product filtering. Its bounded cap rises
  from 10,000 to 50,000 so the observed 23,556-row legacy corpus can be read
  truthfully without cleanup or backfill.
- A service-reported S7 partial result is now an explicit `partial` step. Its
  committed rows, API calls, detailed telemetry, and exact error are retained.
  Later orchestrator stages continue. Overall core status is degraded, and the
  cron lifecycle closes as partial rather than success or fabricated failure.

At the observed 26,570 matching game-line history rows and 23,556 explicit
opener rows, the two integrity checks require approximately 27 and 24 bounded
read pages respectively. Each reader is capped at 50 pages of 1,000 rows. This
adds bounded verification reads while removing the false one-page assumption;
it does not add provider calls, writers, tables, schedules, leases, or model
queries.

## Non-goals and safety boundary

This change does not delete, rewrite, deduplicate, or backfill the polluted
history. Existing valid explicit openers remain untouched. It does not alter
current-line selection/replacement, history row contents other than preventing
new false opener flags, forecast inputs, probabilities, projections, sides,
grades, stakes, locks, or member rendering. The line provider call count and
core writer topology are unchanged.

The repair also does not introduce a hard deadline or cancel an in-flight
database request. If bounded verification fails, current lines and already
appended history remain preserved and the exact S7 partial state is surfaced.

## Verification contract

Focused executable tests cover:

- more than 1,000 history rows and the observed greater-than-23,556 baseline;
- exact player identity and cross-product exclusion;
- first-row-only opener behavior for a genuinely unseen tuple;
- read error, missing exact count, truncation, count drift, duplicate IDs, and
  cap overflow producing no invented opener;
- partial S7 mode, exact telemetry/error retention, committed write/API count
  accounting, and warning-only degraded runs remaining non-partial;
- the previously accepted current-line batch safety, group integrity,
  last-known-good, history, and baseline regressions.

Production acceptance requires a later natural slate cycle to show S7 complete
with zero opener/baseline/history failures, downstream prediction/record/member
snapshot completion, closed lifecycle, released shared lease, and a healthy
current board. One cycle is operational evidence, not a forecast-quality or
long-run latency claim.
