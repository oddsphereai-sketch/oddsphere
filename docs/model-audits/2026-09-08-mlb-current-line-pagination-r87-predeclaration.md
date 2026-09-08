# MLB current-line pagination r87 — predeclaration

Date: 2026-09-08

## Production defect

The September 5 r86 release paginated the MLB full-game feature snapshot, but two downstream
production consumers still read the complete slate from `lines` in one unpaginated PostgREST
response:

- the authoritative `predictionRecordService` price/snapshot read used to build and lock member
  records; and
- the `/api/lab/daily-edge` current-price reader used by the member board.

The September 8 slate has 15 games and more than the default 1,000 returned rows across Moneyline,
Total, and first-inning markets. The existing SELECT-only odds audit returned exactly 1,000 rows and
lost every current row for the final two games, STL@SF and CIN@LAD. Because the r86 feature snapshot
already reads beyond that boundary, the model, writer, and member reader can consume different price
sets from the same database state. Last-known-good and stored-record fallbacks may keep a price
visible, but they cannot prove that the displayed or evaluated quote is the newest complete current
tuple.

## Candidate fixed before outcome review

- Add one shared, stable `lines.id`-ordered, 500-row paginated current-line reader with a fail-closed
  10,000-row ceiling.
- Use that reader in the member Daily Edge route, the authoritative prediction-record price snapshot,
  and the SELECT-only MLB odds-health audit.
- Preserve every provider, query filter, book priority, two-sided coherence rule, price selector,
  model formula, probability, side rule, grade threshold, stake, writer, lease, cron cadence, lock,
  tracking, and settlement rule.
- Never rewrite an existing locked record. A future unlocked record may change only when the newly
  visible authentic current row changes its exact price/economic tuple under the existing policy.
- Stamp the behavior under a new MLB input/calibration/decision/rule/schema release family; FI model
  and probability-head identifiers remain unchanged.

## Acceptance gates

1. A deterministic 1,329-row fixture is read in three stable pages with no omissions or duplicates.
2. A saturated 10,000-row fixture fails closed instead of returning a partial slate.
3. A read-only September 8 production audit sees all 15 games and complete two-sided Moneyline,
   Total, and 0.5-run first-inning coverage where those rows exist in the database.
4. A same-input dry writer and member response comparison reports every price, grade, promotion,
   demotion, side, probability, and hold change. No model-owned probability or side may change.
5. Focused pagination/MLB response tests, `npm run verify:model-change`, TypeScript, production build,
   latest-main integration safety, protected PR checks, and post-deploy live acceptance all pass.

Rollback is the complete r87 pagination release family to r86. Existing locked rows remain immutable.
