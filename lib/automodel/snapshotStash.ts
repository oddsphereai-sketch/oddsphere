/**
 * Phase 4C — pure builder for `SnapshotStash`.
 *
 * Reads the 10 primitives Phase 4A stale rules need from a live
 * GameSnapshot and projects them into a bounded, JSONB-friendly
 * record. Persisted on every Phase 4C write to
 * `sport_specific.snapshot_stash` so the NEXT run has rich prior
 * data for stale comparison.
 *
 * Pure module. No DB. No env. No service imports.
 */

import type { GameSnapshot, SnapshotStash } from "./types";

/**
 * Project a GameSnapshot to the compact stash. Defensive null
 * handling: missing starters → `was_scratched=false` (consistent with
 * "no starter present" being a separate signal handled via hold logic,
 * not via stale-detection); missing sharp → all Pinnacle/public fields
 * null; injuries always materialize from `active_injuries` counts.
 *
 * Bounded: 10 primitives, no nested arrays/objects, ~120 bytes per row.
 * If new stale rules need more snapshot fields, add them here AND to
 * the SnapshotStash type definition in `lib/automodel/types.ts`.
 */
export function buildSnapshotStash(snap: GameSnapshot): SnapshotStash {
  return {
    home_starter_was_scratched: snap.home_starter?.is_scratched ?? false,
    away_starter_was_scratched: snap.away_starter?.is_scratched ?? false,
    home_top3_hitters_injured_count:
      snap.active_injuries.home_top3_hitters_injured_count,
    away_top3_hitters_injured_count:
      snap.active_injuries.away_top3_hitters_injured_count,
    pinnacle_ml_fair_prob_home: snap.sharp?.pinnacle_ml_fair_prob_home ?? null,
    pinnacle_ml_ev_pct: snap.sharp?.pinnacle_ml_ev_pct ?? null,
    public_betting_pct_home: snap.sharp?.public_betting_pct_home ?? null,
    public_money_pct_home: snap.sharp?.public_money_pct_home ?? null,
    public_betting_pct_over: snap.sharp?.public_betting_pct_over ?? null,
    public_money_pct_over: snap.sharp?.public_money_pct_over ?? null,
  };
}
