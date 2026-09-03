# MLB props locked-evidence member publication repair

Date: 2026-09-02  
Scope: member snapshot publication and display-lock evidence reconciliation only

## Incident

After MLB props r41 deployed, the natural 01:17Z and 01:47Z fast writers each
published a healthy canonical r41 snapshot but retained the prior r40 compact
member snapshot. The caught Vercel warning was exact:

`MLB props evidence required identities exceed 1048576 bytes.`

The failure occurred before the compact member upsert. Fifteen games were
already locked across eight immutable historical board snapshots. Display-lock
reconciliation first formed one union for all 5,775 locked rows and incorrectly
applied the 1 MiB stored-canonical cap to that transient in-memory union. The
600-row compact board itself referenced only 246 locked identities. Its measured
identity/reference footprint was approximately 112 KiB, and the reconstructed
complete evidence addition remained below the existing 256 KiB member cap.

## Repair

Display-lock reconciliation now has a separate 8 MiB hard cap for its transient
in-memory union. The union is never stored directly. The existing member writer
continues to subset evidence independently for the compact board and for each
game/player shard, and every persisted member payload retains the existing
240 KiB target and 256 KiB hard cap. Canonical capture still retains its 960 KiB
target and 1 MiB hard cap.

The change does not alter model release r41, forecasts, probabilities,
projections, sides, exact-price economics, grades, stakes, category coverage,
provider calls, query topology, database write count, cron cadence, lease,
tracking, or lock values. It makes the already-required immutable locked rows
and their evidence available to the existing member publication path instead
of failing before the first upsert. The prior coherent compact snapshot remains
the last-known-good fallback if reconciliation or any persisted-payload cap
still fails.

## Verification contract

- Default capture merging still fails above the 1 MiB canonical hard cap.
- Only the display-lock caller opts into the bounded transient allowance.
- A synthetic multi-snapshot locked union exceeds 1 MiB, reconciles under the
  transient cap, then subsets below 256 KiB without dropping a selected locked
  evidence reference.
- Production proof must show the next natural writer advances the version-aware
  compact member snapshot to r41 with the same canonical snapshot id, zero
  unlocked ordinary actionable projection/side contradictions, intact Home Run
  milestone exceptions, and unchanged provider/write topology. Any pre-r41
  contradictory row already frozen at T-60 remains byte/value immutable and is
  reported separately; this operational repair cannot reinterpret that record.
