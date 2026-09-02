# MLB full-game forward evidence capture result

Date: 2026-09-02

Status: local behavior-neutral candidate; unpublished

## Disposition

The forward-capture implementation satisfies its local contract and is ready
for source review. It is not a forecast or grade release and does not resolve
the previously documented full-game target-self-reference or opposite-side
forecast questions by itself. Those questions remain blocked on authentic
release-separated evidence rather than another retrospective coefficient.

The branch must remain unpublished while the separately owned S7 contention
correction is unresolved.

## Exact behavior boundary

The existing MLB prediction-record builder attaches one additive
`mlb_fullgame_market_evidence_v1` key after the final Moneyline and Total
ranking. Removing only that key restores the complete original records. The
capture does not modify the authoritative decimal scores, winner, Total side,
probabilities, grade, exact evaluated price, stake-equivalent actionability,
tracking identity, publication time, or lock state.

The artifact records, separately:

- current complete named-book pairs as of the prediction cycle;
- exact same-book and exact-line opening/current movement;
- normalized source class and evaluated-book identity;
- the target-excluded cohort and incumbent r76 breadth status;
- genuine source-aware split and legacy sharp-signal provenance already loaded
  by the writer;
- authoritative independent scores, final scores/sides, coherent-map output,
  and final public record tuple;
- legacy publication-correction provenance, including whether the published
  side agrees with the score-derived side.

It copies no raw line-history arrays and performs no inference from missing
evidence.

## Bounds and failure proof

- Maximum market artifact: 12,288 serialized bytes.
- Maximum combined Moneyline plus Total artifact: 24,576 serialized bytes per
  game.
- Maximum retained named books: 16 per market.
- Retention order and omission counts are deterministic.
- A 40-book stress fixture pruned to the byte cap, retained plus omitted every
  input pair exactly once, and produced identical output when input order was
  reversed.
- The stored `payload_bytes` value equals the artifact's self-inclusive UTF-8
  serialized size.
- Synthetic exception and one-byte-cap tests returned the original input array
  and record objects by reference.
- Locked input returned the original array and records by reference.

## Runtime topology

Static source checks preserved the pre-change topology in
`predictionRecordService`: 16 `.from(` query sites, one `.upsert(` site, and one
`.insert(` site. The pure capture module has zero database reads and zero
provider calls. There is no new table, migration, route, cron, provider call,
writer, upsert, or reader path.

## Validation

- Focused capture suite: 39/39 passed.
- Existing prediction-record service suite: 374/374 passed.
- Complete `npm run verify:model-change`: passed.
- TypeScript with `--noEmit --incremental false`: passed.
- Focused ESLint: zero new errors; the four existing
  `predictionRecordService.ts` unused-variable warnings remain unchanged.
- `git diff --check`: passed.

The focused suite explicitly proves capture-key strip equality, target
exclusion, same-book opener identity, cross-market isolation, publication-side
provenance, locked identity, deterministic cap behavior, and unchanged
query/write/provider topology.

## Production baseline

A SELECT-only audit at `2026-09-02T14:33:42.044Z` inspected the latest 30 MLB
Moneyline/Total rows from the September 2 slate. It found zero capture artifacts,
which is the expected predeployment baseline. The audit made zero provider
calls, writer calls, or writes. Therefore this checkpoint makes no claim of
natural-cycle production capture, coverage, or forecast improvement.

After any future authorized deployment, acceptance still requires a natural
writer cycle and SELECT-only proof of contract identity, target-excluded
breadth, cap compliance, lock exclusion, tuple strip equality, and
release-separated score-side/publication-side provenance.
