# MLB run-line forward evidence r2

Date: 2026-10-16
Status: behavior-neutral capture candidate; no run-line prediction release

## Purpose

The MLB foundational audit found that historical run-line percentages were not enough to validate
a model. The retained 825-game price cohort disproved the current Poisson selector, but the source
was the mutable last retained pregame row rather than an immutable lock snapshot. R2 closes that
evidence gap for future games without adding a run-line pick or changing the existing product.

## Contract

- Snapshot key remains `mlb_fullgame_market_evidence_v1` so legacy readers keep one evidence path.
- New contract/schema are
  `mlb_fullgame_market_evidence_capture_2026_10_16_r2_run_line_context` / `mlbfgme2`.
- The run-line context is stored once per game on the unlocked Moneyline record.
- Only a coherent same-book main run line is accepted: one home and one away side, exact
  complementary +1.5/-1.5 numbers, finite nonzero American prices, at most two minutes of side
  timestamp skew, and at most 90 minutes old at the model cycle.
- Synthetic/blocked books, alternative numbers, crossed-book pairs, stale/future observations,
  invalid prices, and incoherent side numbers are rejected with explicit counts.
- Up to four pairs are retained in deterministic sharp/retail/other and freshness order. Each pair
  preserves sportsbook identity, both exact numbers and prices, both timestamps, no-vig home-cover
  probability, and an exact-line same-book opener when available.
- `mode=capture_only` and `production_gate_enabled=false` are explicit. Missing evidence is neutral.

## Safety boundary

The existing sole prediction-record writer and `prediction_pipeline:mlb` lease remain authoritative.
R2 reuses the writer's existing bounded current-line, 24-hour history, and opener reads, widening
only their market filter to include `spread`. It adds no provider call, database query path, table,
migration, writer, upsert, route, cron, grade, or public tracking market.

Locked rows return by identity and are never augmented. Any exception or byte-cap failure returns
the original records by reference. The existing 12,288-byte per-market and 24,576-byte per-game
caps remain in force; only four run-line pairs can be added to the Moneyline artifact.

## Validation

- Focused capture suite: 59 assertions passed.
- The suite proves same-book ±1.5 identity, exact current/opening numbers and prices, one-copy
  placement, `production_gate_enabled=false`, capture-key strip equality, lock identity, deterministic
  pruning, byte caps, and failure isolation.
- TypeScript passed.
- Focused ESLint returned zero errors; the four pre-existing unused-variable warnings in
  `predictionRecordService.ts` remain unchanged.

## Acceptance after deployment

A natural writer cycle must show the r2 contract on future unlocked Moneyline snapshots, zero locked
row mutation, bounded payloads, and coherent run-line pairs. Future model work may consume only
release-separated immutable captures and must beat the paired always-underdog baseline on accuracy
and price-normalized return before any run-line public prediction is considered.
