# NFL player props research offer-universe capture predeclaration

Date: 2026-10-16

Base: `a0780589b15d2388fcb10e02c72b29cab9d81dd0`

## Scope

Add a bounded, internal, release-pure offer-universe capture for the six research-only families whose independent models produced usable current-season foundations:

- Passing Touchdowns;
- Longest Pass;
- Longest Reception;
- Longest Rush;
- Field Goals Made; and
- Kicking Points.

The capture consumes only the retail and current-cycle source-aware exact-offer boards already built from the production collection payload. It never forces the conditional reference lane and may not use a retained stale reference cache, make provider calls, change pagination, add a cron, add a writer, alter the shared `prediction_pipeline:nfl` lease, expose a member row, score a projection, create a grade/stake, or change a lock/tracking/settlement record.

## Frozen design

- One isolated `lab_response_snapshots` key per season/week.
- Four pregame landmarks: provider opening, T-24, T-6, and the existing T-60 lock boundary.
- Each immutable row retains game/player/market/book/provider/line, all offered side prices including nulls, provider observation/fetch times, capture time, start/lock times, completeness, and health holds.
- First row at an exact landmark identity wins. Later replays are idempotent; a conflicting later value is counted and preserved without rewriting the first row.
- The store is failure-isolated and executes only after authoritative snapshot, lock/tracking, closing-price, and settlement work.
- Hard limits: 40,000 rows, 48 MB uncompressed JSON, 4 MB gzip, and 550-day retention.

## Acceptance gates

1. All six and only the six declared families are retained from mixed input.
2. Alternate lines, books, providers, and incomplete side sets remain distinguishable.
3. Provider opening/T-24/T-6/T-60 timing and T-60 freshness are enforced.
4. Same-input replay adds zero rows and performs zero writes.
5. A conflicting replay cannot alter the first immutable row.
6. Corrupt/checksum-invalid and over-limit payloads fail closed.
7. Store source contains no fetch/provider client or collector dependency.
8. Writer call ceilings, member decisions, predictions, grades, actions, stakes, locks, tracking, settlement, provider calls, cadence, and UI remain byte/behavior unchanged except the sole writer release and additive internal telemetry.

The candidate is not authorization to expose these markets. Exact-price outcomes, calibration, promotions/demotions, and board-size evidence must still pass their own future release gates.
