# NBA Boston-Detroit legacy locked-evidence recovery

## Owner approval and scope

On 2026-10-20 Daniel Mengel explicitly approved repairing the locked
Boston-Detroit member card after the complete-card capture incident was
diagnosed. The approval is limited to NBA external event `401909088`, matchup
`BOS @ DET`, and the atomic lock at `2026-10-20T18:00:59.937Z`.

This is a read-only reader recovery. It does not update, replace, suppress, or
reinterpret any prediction record. No prediction, projection, probability,
side, line, price, grade, stake, tracking denominator, result, writer, cadence,
provider call, or `prediction_pipeline:nba` lease changes.

## Immutable authority

The three production rows remain byte-for-byte immutable:

- Moneyline `450907`:
  `534da4220f52d0422cd55c558214be4007593596df1a28024b83a469cd24cdb8e`
- Spread `450908`:
  `463d35c045eee3e69c3371d1cc6a52f1a44f2c891ea90739792baadccc9664a4`
- Total `450909`:
  `94b67e21885b2614e5c839542d913a758fae580395b9bb31cc42bc8b8e4edfd1`

Each row contains the same exact `nba_game_dto_at_capture` and an `as_of` of
`2026-10-20T18:00:59.148Z`, 789 milliseconds before the authoritative lock.
Each market row also stores its own complete two-sided public split payload.

## Recovered evidence

The reader may restore only these stored public splits:

- Moneyline: BOS 86% bets / 91% money; DET 14% / 9%.
- Spread: BOS 86% bets / 90% money; DET 14% / 10%.
- Total: Over 69% bets / 80% money; Under 31% / 20%.

Selected and opposing odds movement may be rendered only from the existing
append-only `market_price_observations_v2` rows for this exact event where both
the provider observation timestamp and ingestion timestamp are no later than
the lock. The selected terminal remains the stored locked current price. A
post-lock row can never enter either side's trail.

The recovery is stamped internally as
`nba_legacy_locked_evidence_recovery_2026_10_20_r1_bos_det` and the response
coherence metadata identifies it as a legacy locked-evidence recovery. The
legacy capture did not retain a complete sharp-book display section, so the
repair does not reconstruct one from later provider state.

## Failure behavior

The recovery activates only when event identity, matchup, the complete
Moneyline/Spread/Total tuple, one shared capture timestamp, the exact approved
lock timestamp, complete stored split pairs, and coherent 100% complements all
match. An incomplete or inconsistent approved tuple fails closed. Every other
legacy NBA lock remains unchanged and unreconstructed. Future locks continue
to use the r2 complete-card authority.

## Verification and rollback

Focused tests must prove:

- the three input snapshots are not mutated;
- all three exact stored public split pairs are retained;
- selected and opposing movement stops at the lock;
- injected post-lock observations are rejected;
- the stored locked selected prices remain terminal authority;
- a different event receives no recovery; and
- an incomplete approved tuple fails closed.

Publication also requires TypeScript, the NBA-focused suites,
`npm run verify:model-change`, latest-main integration safety, protected pull
request checks, unchanged production row hashes, and a live member response
showing the recovered evidence. Rollback removes only the read-time exception;
it must never write or rewrite a locked record.
