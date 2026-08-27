# NFL Daily Edge compact member snapshot latency release

Status: behavior-neutral production candidate. This release changes no forecast, probability, score, side, line, price, grade, promotion/demotion, lock, tracking, or settlement rule.

## Predeclared boundary

- Keep `nfl_forward_evidence_snapshots` append-only and authoritative.
- Keep the existing `prediction_pipeline:nfl` lease, cron, provider plan, and single writer.
- After the existing writer has assembled a coherent current release, store the exact already-built member fixture in the existing service-role-only `lab_response_snapshots` table under a release-keyed primary key.
- Read that one compact row first. Reject a mismatched evidence/member/decision/fixture release or source checksum and fall back to the unchanged raw evidence builder.
- Cache the private server read for only 15 seconds and prefetch the canonical sport URL on pointer intent or keyboard focus. Prefetch must not select a sport, change URL state, close a reader, or bypass the normal member route.
- Snapshot publication failure is operationally visible in the existing cron result and cannot suppress or rewrite raw evidence or official tracking.

## Read-only production baseline

Measured 2026-08-27 against current NFL Week 1 storage without calling a provider, cron, writer, or mutation:

- 864 checksum-validated current-release evidence rows.
- Raw serialized read volume: 39,147,153 bytes.
- Raw evidence database read: 3,748.4 ms.
- Fixture assembly after the read: 145.6 ms.
- Exact compact fixture size: 331,973 bytes, a 99.15% reduction from raw serialized evidence volume.
- Five exact-primary-key reads of an existing service-role NFL response row: 732.3, 394.6, 314.7, 319.0, and 256.5 ms (204,418-byte comparison payload). The new fixture is larger, so final production switch timing must still be measured after its first natural writer publication.
- Prior signed-in live sport-switch samples on the raw path were 3.75-5.38 seconds for NFL, versus 0.57-1.08 seconds for MLB and 0.39-1.42 seconds for WNBA.

These measurements establish the bottleneck and the expected order-of-magnitude I/O reduction; they do not claim final live latency before deployment.

## Releases and rollback

- Writer: `nfl_forward_evidence_writer_2026_08_27_r10_compact_member_snapshot`.
- Compact member snapshot: `nfl_forward_member_snapshot_2026_08_27_r1_compact`.
- Model, calibration, outcome distribution, decision, grade policy, fixture, T-60, tracking, score-ingest, and settlement releases remain unchanged.
- Rollback is to stop reading/writing the compact key and use the existing raw builder. Raw immutable evidence remains complete throughout.

## Acceptance gates

1. Serialized compact fixture equals the fixture supplied to the writer, byte for byte.
2. Wrong release or checksum returns no compact result and exercises the raw fallback.
3. Cadence-not-due natural cycles refresh the compact row with zero provider calls; dry runs never write it.
4. One snapshot upsert occurs inside the existing leased writer; no endpoint, lease, cron, or prediction writer is added.
5. The cron reports attempted/updated/key/error state and marks snapshot publication errors partial without changing prediction counts.
6. Pointer/focus prefetch uses the same canonical URL as click navigation and has no selection side effect.
7. Full NFL model/writer/T-60/tracking suites, shared Daily Edge tests, TypeScript, Webpack production build, diff check, and integration safety pass on current protected main.
8. After deployment and the next natural NFL cycle, verify the exact release-keyed row, live release/count parity, and cold/warm NFL switch timing against MLB/WNBA.
