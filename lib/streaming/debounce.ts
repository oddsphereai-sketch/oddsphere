/**
 * Recompute debounce/cooldown (2026-06-16). PURE — time is injected via `now`
 * (ms epoch) so it is deterministic and unit-testable; no timers, no DB, no Next.
 *
 * Two jobs:
 *   1. Per-(game,market) COOLDOWN — after a recompute fires for a market, block
 *      further recomputes for that market for `cooldownMs` so a flapping book
 *      can't trigger a storm.
 *   2. COALESCE window — collect games whose triggers fired within a short
 *      window into ONE recompute batch, so simultaneous moves across the slate
 *      become a single internal call.
 *
 * The worker calls `register(...)` on every fired trigger, then periodically
 * calls `drainBatch(now)` to get the games to recompute (which also stamps
 * their cooldown).
 */

export type DebounceConfig = {
  /** Per-(game,market) cooldown after a fire (default 90s). */
  cooldownMs: number;
  /** Coalesce window — a pending game waits this long for siblings (default 7s). */
  coalesceWindowMs: number;
};

export const DEFAULT_DEBOUNCE_CONFIG: DebounceConfig = {
  cooldownMs: 90_000,
  coalesceWindowMs: 7_000,
};

type Pending = { gameExternalId: number; market: string; reason: string; firstSeen: number };

export class MovementDebouncer {
  private readonly cfg: DebounceConfig;
  /** key `${gameExternalId}::${market}` → last fire time (ms). */
  private readonly lastFire = new Map<string, number>();
  /** key `${gameExternalId}::${market}` → pending trigger awaiting the coalesce window. */
  private readonly pending = new Map<string, Pending>();

  constructor(cfg: DebounceConfig = DEFAULT_DEBOUNCE_CONFIG) {
    this.cfg = cfg;
  }

  private key(gameExternalId: number, market: string): string {
    return `${gameExternalId}::${market}`;
  }

  /**
   * Record a fired trigger for (game, market). Returns true if it was accepted
   * into the pending set, false if it was suppressed by an active cooldown.
   */
  register(gameExternalId: number, market: string, reason: string, now: number): boolean {
    const k = this.key(gameExternalId, market);
    const last = this.lastFire.get(k);
    if (last !== undefined && now - last < this.cfg.cooldownMs) {
      return false; // still cooling down
    }
    if (!this.pending.has(k)) {
      this.pending.set(k, { gameExternalId, market, reason, firstSeen: now });
    }
    return true;
  }

  /**
   * Coalesce-and-flush: the window is anchored to the OLDEST pending trigger.
   * Once that has waited >= coalesceWindowMs, flush ALL pending triggers as one
   * batch (stamping each drained (game,market) with a fresh cooldown) so moves
   * that arrived close together become a single recompute call. Returns empty
   * while the oldest pending trigger is still inside the window.
   */
  drainBatch(now: number): { gameExternalIds: number[]; reasons: string[] } {
    if (this.pending.size === 0) return { gameExternalIds: [], reasons: [] };
    let oldest = Infinity;
    for (const p of this.pending.values()) oldest = Math.min(oldest, p.firstSeen);
    if (now - oldest < this.cfg.coalesceWindowMs) {
      return { gameExternalIds: [], reasons: [] };
    }
    const games = new Set<number>();
    const reasons = new Set<string>();
    for (const [k, p] of this.pending) {
      games.add(p.gameExternalId);
      reasons.add(p.reason);
      this.lastFire.set(k, now);
      this.pending.delete(k);
    }
    return { gameExternalIds: [...games], reasons: [...reasons] };
  }

  /** Count of triggers still waiting in the coalesce window (for health/metrics). */
  pendingCount(): number {
    return this.pending.size;
  }
}
