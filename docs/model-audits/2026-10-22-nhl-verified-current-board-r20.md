# NHL verified current-board repair — r20/r16

Date: 2026-10-22
Scope: NHL current odds ingestion, movement reads, unlocked predictions, member reader
Production releases: `nhl_regular_2026_r20_verified_current_board`,
`nhl_regular_calibration_2026_r20_verified_current_board`,
`nhl_regular_decision_2026_r20_verified_current_board`,
`nhl_daily_edge_reader_2026_10_22_r16_verified_current_board`, and
`nhl_daily_refresh_schedule_2026_10_22_r13_verified_current_board`

## Pre-declared claim

Repair current-quote authority without changing the independent score model,
market-reader rules, price-aware thresholds, picks, or board shape. A successful
complete provider poll must establish a fresh verified current tuple even when
the price is flat. Economic history must record only actual line or price
changes. Partial pairs, failed provider calls, blocked books, and split feeds
must never advance current-price verification.

Expected same-input board impact: zero score, side, probability, pick, grade,
stake, promotion, demotion, and actionable-count changes. Prices/books may
advance only where the previously rendered current tuple was stale or where a
newer complete provider tuple exists. Locked payloads remain immutable and win
unconditionally in the reader.

## Incident evidence

- The 2026-10-22 deep audit found one critical:
  `DET@VAN / spread / current_quote_not_recently_verified`, with the displayed
  endpoint observed at `2026-10-22T09:35:17.778339Z` and more than 180 minutes
  old.
- The NHL refresh log was successful, and a live SharpAPI dry-run returned all
  12 scheduled games, 3,357 raw odds rows, and 1,164 canonical complete current
  rows. This excluded a provider outage or missing-game explanation.
- The database held 46 spread rows per sportsbook for Detroit-Vancouver instead
  of one complete two-row tuple. Repeated current generations extended from
  approximately 04:18Z through 12:48Z.
- Root cause: current-board change detection used one unpaginated PostgREST
  query. Once the slate exceeded the default 1,000-row ceiling, later groups
  were absent from comparison and cleanup. Independently, an identical
  successfully polled tuple skipped every write, preserving an old
  `fetched_at` value.

## Repair contract

1. Read the entire bounded current NHL board with stable pagination and fail
   closed on truncation or cap exhaustion.
2. Replace complete game/market/book groups with bounded insert-before-delete
   batches. The first production cycle collapses legacy generations; later
   cycles retain one complete current generation.
3. Treat an unchanged complete active/non-live/non-stale provider tuple as
   freshly verified current data. Do not append it to `line_history`.
4. Append `line_history` only for a semantic line or price change and only after
   a complete current-board replacement succeeds.
5. Paginate both current rows and movement history in the model and member
   reader. A partial bounded read is an error, never a smaller market board.
6. Preserve last-known-good groups when the provider omits a book, while the
   refresh remains partial and no fresh snapshot is published.
7. Preserve every locked projection, price, grade, evidence payload, and reader
   precedence exactly.

Public/sharp split providers remain distinct evidence channels. Their fallback
hierarchy and authority weights are unchanged, and a split observation cannot
refresh or replace an exact sportsbook price.

## Candidate audit

The read-only r20/r16 candidate rebuilt the exact 2026-10-22 12-game / 36-market
board from the complete paginated current and history sets:

- Best Angle: 1
- Lean: 19
- Watchlist: 16
- Actionable (Best Angle + Lean): 20
- Picks changed: 0
- Grades changed: 0
- Promotions: 0
- Demotions: 0
- Actionable-count change: 0
- Projected-score changes: 0

Detroit-Vancouver remains `DET ML`, `UNDER 6.5`, and `VAN +1.5`; the spread
price resolves to a current complete two-sided provider tuple instead of the
stale endpoint.

## Validation and rollback

Required before merge: TypeScript, NHL model/reader safety suite, current-line
pagination and replacement tests, refresh-cycle release tests,
`npm run verify:model-change`, clean integration-safety proof, and protected PR
checks. After deployment, trigger the sole NHL daily refresh, confirm the r20
three-market unlocked tuple and r16 response snapshot, verify one current pair
per game/market/book, rerun the deep audit, and confirm zero NHL stale-current
criticals.

Rollback is the prior r19/r15/r12 release set. Do not restore the old
unpaginated current-board reader; if rollback is required, retain the complete
pagination and duplicate cleanup as an operational data-integrity repair.
