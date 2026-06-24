/**
 * Dual-source public splits — Phase 2 resolved READ (additive, read-only).
 *
 * Reads provider-separated rows from `public_splits_observations` (Phase 1)
 * and resolves each (game, market, side) into ONE product read via Codex's
 * pure `resolvePublicSplit` (lib/services/publicSplitsResolver.ts):
 *   - display = fresh+complete Playbook, else SharpAPI fallback (never blended);
 *   - agreementState + modelConfidence from provider gap.
 *
 * Pure-ish: reads the observation table only. Writes NOTHING. Not yet wired
 * into the DTO/UI — the daily-edge display wiring is a separate gated step
 * (route is a coordination hot file). This service is the Phase 2 foundation +
 * what the read-only verify exercises end-to-end.
 *
 * Freshness note: resolvePublicSplit requires observations <= staleAfterMinutes
 * (default 15) to display. So the resolved display is only as fresh as the
 * observation sync — the cron-wire freshness follow-up keeps it live.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolvePublicSplit,
  type PublicSplitObservation,
  type ResolvedPublicSplit,
} from "./publicSplitsResolver";
import { STALE_AGE_MINUTES } from "./lastKnownGoodReader";

export type ResolvedCell = {
  gameId: number;
  market: "moneyline" | "total" | "spread";
  side: "home" | "away" | "over" | "under";
  resolved: ResolvedPublicSplit;
};

type ObsRow = {
  provider: "playbook" | "sharpapi";
  game_id: number;
  market_type: string;
  side: string;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  books_used: number | null;
  observed_at: string | null;
};

function obs(row: ObsRow | undefined): PublicSplitObservation | null {
  if (!row) return null;
  return {
    provider: row.provider,
    public_betting_pct: row.public_betting_pct,
    public_money_pct: row.public_money_pct,
    books_used: row.books_used,
    observed_at: row.observed_at,
  };
}

/**
 * Resolve every (game, market, side) on the slate. Returns [] gracefully if the
 * observation table is absent (Phase 1 not applied) — never throws.
 */
export async function resolveSlatePublicSplits(opts: {
  supabase: SupabaseClient;
  sport: string;
  slateDate: string;
  now?: Date;
  staleAfterMinutes?: number;
}): Promise<ResolvedCell[]> {
  const { supabase, sport, slateDate, now = new Date(), staleAfterMinutes = STALE_AGE_MINUTES } = opts;

  const { data: games } = await supabase.from("games").select("id").eq("sport", sport).eq("slate_date", slateDate);
  const ids = (games ?? []).map((g) => g.id as number);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("public_splits_observations")
    .select("provider, game_id, market_type, side, public_betting_pct, public_money_pct, books_used, observed_at")
    .in("game_id", ids);
  if (error || !data) return [];

  // Index by game:market:side:provider.
  const byKeyProvider = new Map<string, ObsRow>();
  for (const r of data as ObsRow[]) byKeyProvider.set(`${r.game_id}:${r.market_type}:${r.side}:${r.provider}`, r);

  // Cells present in either provider.
  const cellKeys = new Set<string>();
  for (const r of data as ObsRow[]) cellKeys.add(`${r.game_id}:${r.market_type}:${r.side}`);

  const out: ResolvedCell[] = [];
  for (const key of cellKeys) {
    const [gid, market, side] = key.split(":");
    const resolved = resolvePublicSplit({
      playbook: obs(byKeyProvider.get(`${key}:playbook`)),
      sharpapi: obs(byKeyProvider.get(`${key}:sharpapi`)),
      now,
      staleAfterMinutes,
    });
    out.push({
      gameId: Number(gid),
      market: market as ResolvedCell["market"],
      side: side as ResolvedCell["side"],
      resolved,
    });
  }
  return out;
}
