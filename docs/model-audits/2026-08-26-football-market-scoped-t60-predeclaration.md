# Football market-scoped T-60 tracking predeclaration

Date: 2026-08-26

## Scope

This change is limited to the official NFL and CFB T-60 tracking boundary and the existing leased forward-evidence writers. It does not change any football forecast, probability, projected score, selected side, sportsbook quote, grade, threshold, stake, member-reader behavior, public board count, settlement formula, provider request, cron schedule, or database schema.

Current production boundaries before the change:

- NFL tracking lifecycle `nfl_tracking_lifecycle_2026_08_25_r3_regular_t60`, tuple boundary `nfl_evaluated_tuple_tracking_boundary_2026_08_21_r2`, official record `nfl_official_tracking_record_2026_08_25_r1_regular_t60`, and writer `nfl_forward_evidence_writer_2026_08_25_r8_release_refresh`.
- CFB official record `cfb_official_tracking_record_2026_08_25_r1_t60` and writer `cfb_forward_evidence_writer_2026_08_25_r3_weekly`.
- The authoritative write paths remain the existing NFL and CFB forward-evidence writers under their existing sport-scoped `prediction_pipeline` leases.

## Frozen correction

Official tracking is market-scoped. A valid immutable Moneyline, Spread, or Total decision tuple may enter official tracking even when a sibling market is Held and therefore absent. A Held market never receives a synthetic record and cannot suppress coherent sibling records.

The following gates remain mandatory for every inserted market:

1. the payload is a T-60 capture and the decision is stamped `t60_locked`;
2. the capture is on time and no more than 20 minutes late;
3. the exact decision tuple carries one provider game, market, side, named sportsbook, line where applicable, price, quote timestamp, model probability, market probability, grade, evaluated timestamp, lock timestamp, and release tuple;
4. the quote timestamp is not later than the immutable capture;
5. the sport/date is inside the approved official tracking registry;
6. markets are unique and limited to Moneyline, Spread, and Total;
7. global game-health failures still produce zero trackable decisions;
8. inserts remain append-only, idempotent by exact game/market/release, and are written in one batch by the existing writer;
9. later refreshes cannot modify a locked record.

Writer accounting must use the exact number of trackable market decisions, not `games * 3`. Existing-row accounting must intersect the desired game/market keys so an already stored sibling cannot inflate or suppress the current batch.

## Predeclared acceptance tests

- A complete three-market NFL or CFB T-60 payload still produces the identical three records.
- A two-market payload with Moneyline Held produces exactly Spread and Total records with their original exact tuples.
- A one-market payload produces exactly that market.
- Zero decisions, duplicate markets, unknown markets, mixed game/release/lock timestamps, a post-capture quote, non-T-60 stage, late capture, or an unlaunched official date fails closed.
- Retry sees only the desired market keys, inserts no duplicate, and reports proposed/existing counts accurately.
- Existing score ingestion and shared settlement tests remain green.
- Full `npm run verify:model-change`, focused football tracking tests, TypeScript, production build, diff check, and integration safety must pass before handoff.

## Release and rollback

Tracking lifecycle, official-record, and writer identifiers will be bumped. Existing records keep their original releases and are never rewritten. Rollback restores the prior tracking/writer identifiers and all-or-nothing boundary without deleting immutable evidence or previously inserted records.

## Completed evidence

- Full three-market NFL and CFB fixtures remain three records with the original evaluated decision tuples.
- Two-market fixtures produce only Spread and Total; a one-market fixture produces only Total. No synthetic Moneyline row is created.
- Zero decisions, duplicate markets, unsupported markets, global health holds, mixed release/lock timestamps, post-capture quotes, and captures more than 20 minutes late fail closed.
- Retry accounting intersects stored records with the desired game/market keys. A stored Moneyline sibling cannot make a desired Spread/Total batch look complete.
- Public forecast and grade output is byte-for-byte outside this change: **0 promotions, 0 demotions, 0 side changes, 0 probability changes, and 0 stake changes**. The only potential production impact occurs at a future valid T-60 boundary where a game has one or two coherent markets and a Held sibling.
- Focused NFL official-record, evaluated-tuple boundary, single-writer, and CFB production tests passed. `npm run verify:model-change`, `npx tsc --noEmit`, and `npm run build -- --webpack` passed.
