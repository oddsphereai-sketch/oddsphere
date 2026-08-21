# EPL immutable odds-history reader repair — 2026-08-21

## Scope and release boundary

- Sport/markets: Premier League Match Result, Double Chance, Total, and BTTS.
- Writer/reader: the existing EPL 30-minute writer and member Daily Edge reader.
- Authoritative releases remain `epl_goals_coherent_2026_08_20_r16` and `epl_grade_policy_2026_08_20_v21`.
- The shared sport-scoped `prediction_pipeline` lease, provider calls, current-price selection, prediction inputs, locking, settlement, and tracking writers are unchanged.
- Board impact: 0 promotions, 0 demotions, and no change to any prediction, probability, projection, side, current price, evaluated price, grade, stake, or official record.

This is a historical-data and reader-integrity repair. It does not change model or calibration behavior under the existing identifiers.

## Failure proved on the live Arsenal record

For internal game `46550` (provider fixture `3818188`), append-only `line_history` retained:

- FanDuel `-700` at `2026-08-19T13:22:18.575948Z`;
- FanDuel `-650` later on August 19;
- Circa `-600` beginning at `2026-08-19T21:07:48.307Z`;
- Circa `-555` on August 21.

The member reader showed only Circa `-600 / -600 / -555`. The `-700` was not deleted; EPL's read path loaded only the newest 12,000 weekly history rows, and the UI exposed only the current sportsbook's trail. That combination made an earlier verified capture disappear from the reader.

The live table also contained legacy exact-duplicate rows and incorrect historical `is_opener` flags. This repair does not delete or rewrite immutable observations and does not trust those legacy flags to reconstruct history.

## Repair

1. EPL now loads `line_history` oldest-to-newest in bounded 1,000-row pages, matching the established WNBA Daily Edge contract. The weekly query remains scoped to current EPL game IDs and four supported markets; it adds no provider call and no per-member read.
2. Economic trails remain scoped to the exact sportsbook, outcome, and Total line. FanDuel-to-Circa is never presented as same-book movement.
3. Every soccer outcome also carries its earliest verified OddSphere capture across books. The member reader shows that capture separately only when it sits outside the displayed same-book trail.
4. Current selection and grading continue to use the coherent current price. Historical cross-book context cannot re-grade, promote, demote, or change a pick.

## Live read-only replay

The repaired reader loaded 631 compacted observations for Arsenal's four markets and returned:

- earliest Match Result home capture: FanDuel `-700` at `2026-08-19T13:22:18.575948Z`;
- current-book movement: Circa `-600`, verified flat `-600`, then `-555`;
- current quote: Circa `-555`.

The database contained 2,218 raw supported-market history rows for this fixture at audit time. Pagination is bounded per request and the slate is bounded to the active EPL gameweek. Existing compaction prevents exact duplicates and unchanged polls from expanding the response object.

## Verification

- `npx tsx scripts/test-epl-shadow-model.ts`
- `npx tsx scripts/test-daily-edge-experience.ts`
- `npm run verify:model-change`
- production build

Live deployment proof must confirm the exact production commit, r16/v21 identifiers, shared lease health, coherent current prices, the Arsenal earliest-capture label, and unchanged board counts before the repair is declared live.

## Rollback

Revert this reader/history commit. The immutable database rows, current EPL model, grades, locks, tracking records, and provider configuration are unaffected.
