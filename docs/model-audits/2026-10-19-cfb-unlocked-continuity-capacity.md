# CFB unlocked-continuity capacity repair

Date: 2026-10-19  
Scope: CFB sole-writer operational continuity only

## Production failure

The scheduled `cfb_forward_evidence` job was failing on most five-minute
cycles with:

`CFB forward recent unlocked metadata read exceeded its bounded 12000-row continuity limit.`

A SELECT-only production count at 2026-10-19T12:38:26Z found 11,990 unlocked
rows in the required trailing 48-hour window. The next ordinary capture could
therefore fill the final page and trigger the explicit fail-closed ceiling.
Recent logs showed repeated failures at 12:00, 12:10, 12:15, 12:25, 12:30,
and 12:35 UTC; full provider cycles at 12:05 and 12:20 UTC still published a
partial board. The member snapshot was valid but could not maintain its
intended continuous refresh cadence.

## Repair

The payload-free unlocked-metadata ceiling advances from 12,000 to 30,000
rows. A 96-game slate captured every 15 minutes can produce 18,432 rows in 48
hours; 30,000 preserves the existing continuity horizon and leaves headroom
for larger FBS + FCS boards. Reads remain paginated in stable
`captured_at, id` order and continue to fail explicitly rather than truncate.
Historical JSON payloads are not added to the scan.

The sole writer release advances from
`cfb_forward_evidence_writer_2026_10_17_r127_release_aware_availability_seed`
to `cfb_forward_evidence_writer_2026_10_19_r128_unlocked_continuity_capacity`.

## Model and locked-record impact

- No model, distribution, calibration, grade, decision, evidence-schema,
  member, fixture, reader, tracking, or lock release changes.
- No forecast, probability, projected score, pick, price, grade, or stake
  logic changes.
- No locked row is updated, reconstructed, or reinterpreted.
- No new writer, lease, or refresh route is introduced.
- Promotion/demotion and board-count impact: 0/0; this restores scheduled
  publication of the already-authoritative payloads.

## Validation gates

- `npm run verify:model-change`
- `npx tsx scripts/test-cfb-v1-production.ts`
- SELECT-only live writer rehearsal after deployment must clear the 12,000-row
  production state without truncation.
- Post-deploy refresh logs must show successful cycles and a fresh member
  snapshot under the unchanged hourly freshness contract.

## Rollback

Revert the writer release and metadata ceiling together. Rollback restores the
known fail-closed capacity error and is not safe while the 48-hour row count is
at or above 12,000.
