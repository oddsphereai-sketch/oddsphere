# MLB persisted split clear r72 predeclaration

Date: 2026-08-28
Base: production `5aac14b2c65e` (MLB r71)
Mode: shadow candidate; no production behavior activated by this document.

## Natural-cycle finding

The first normal post-r71 split cycle at 2026-08-28T16:01:15Z proved that
new canonical SharpAPI rows correctly withheld unsupported exact 0%/100%
fields, but the provider-separated `public_splits_observations` mirror skipped
an observation when both scrubbed fields were null. That preserved 16 older
endpoint rows in the upsert table instead of explicitly clearing them.

The r71 member reader already fails those stored endpoints closed, so no
member prediction, price, grade, stake, or tracking tuple is exposed to the
invalid values. The remaining defect is persisted ingestion hygiene and stale
last-known-good cleanup.

## Frozen candidate

For MLB only, the authoritative split mirror must persist an exact matched
provider/game/market/side observation even when both verified percentage
fields are null. The normal upsert then replaces any older unsupported
endpoint values with null. Other sports retain the existing behavior of
skipping a completely empty row.

No provider call, writer, timer, schema, sportsbook selector, projection,
probability, side, price, grade threshold, lock, tracking, settlement, or
stake behavior changes. No replacement percentage is synthesized.

## Activation gates

1. Pure tests prove MLB null/null rows persist for cleanup while non-MLB empty
   rows remain skipped.
2. The frozen current 45-market replay remains byte-stable against r71 with
   zero promotions and zero demotions.
3. Focused tests, `npm run verify:model-change`, TypeScript, webpack,
   integration safety, protected PR checks, a natural cycle, and signed-in
   live QA pass.
4. The natural cycle must make current provider-separated endpoint rows zero;
   historical append-only source rows may remain but must continue to fail
   closed at every decision and reader boundary.

Rollback is r71/v59/v49. If r72 is rolled back, the r71 read-side endpoint
guard must remain active.
