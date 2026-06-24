/**
 * Dual-source public splits — Phase 2 DISPLAY overlay (MLB), additive.
 *
 * Loads provider-separated observations and produces, per game, the resolved
 * public-split DISPLAY for moneyline + total:
 *   - Playbook preferred when fresh+complete;
 *   - SharpAPI fallback when Playbook missing/stale;
 *   - STALE-BUT-VALID: when neither is fresh, show the freshest complete
 *     observation with isStale=true so bars NEVER disappear (LKG behavior);
 *   - never blends two providers into one number.
 *
 * `overlayResolvedPublicSplits` replaces ONLY game.markets.{moneyline,total}
 * .publicSplits on the DTO. It touches NO grade/prediction/model field — grades
 * are unchanged by construction. FI/spread untouched (FI has no public splits).
 *
 * Gated by the caller (flag); MLB only for now.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketEdgeDto, DailyEdgeGameDto } from "../../app/lab/lib/labTypes";
import { STALE_AGE_MINUTES } from "./lastKnownGoodReader";

type Market = "moneyline" | "total";
type Side = "home" | "away" | "over" | "under";
type PublicSplit = MarketEdgeDto["publicSplits"][number];

type ObsRow = {
  provider: "playbook" | "sharpapi";
  game_id: number; market_type: string; side: string;
  public_betting_pct: number | null; public_money_pct: number | null;
  books_used: number | null; observed_at: string | null;
};

const SIDES: Record<Market, Side[]> = { moneyline: ["home", "away"], total: ["over", "under"] };

function isPct(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}
function complete(o: ObsRow | undefined): o is ObsRow {
  return Boolean(o && (isPct(o.public_betting_pct) || isPct(o.public_money_pct)));
}
function ageMin(iso: string | null, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 60000 : Infinity;
}
function fresh(o: ObsRow | undefined, now: number): boolean {
  return Boolean(o && ageMin(o.observed_at, now) <= STALE_AGE_MINUTES);
}

/** Display pick: fresh Playbook > fresh SharpAPI > freshest-complete (stale). */
function pickDisplay(playbook: ObsRow | undefined, sharpapi: ObsRow | undefined, now: number):
  { betsPct: number | null; moneyPct: number | null; observedAt: string | null; isStale: boolean } | null {
  const mk = (o: ObsRow, stale: boolean) => ({
    betsPct: o.public_betting_pct, moneyPct: o.public_money_pct, observedAt: o.observed_at, isStale: stale,
  });
  if (complete(playbook) && fresh(playbook, now)) return mk(playbook, false);
  if (complete(sharpapi) && fresh(sharpapi, now)) return mk(sharpapi, false);
  // stale-but-valid: freshest complete observation (never blank an available bar).
  const cands = [playbook, sharpapi].filter(complete) as ObsRow[];
  if (cands.length === 0) return null;
  cands.sort((a, b) => ageMin(a.observed_at, now) - ageMin(b.observed_at, now));
  return mk(cands[0]!, true);
}

export type ResolvedDisplayByExtId = Map<number, Partial<Record<Market, Partial<Record<Side, NonNullable<ReturnType<typeof pickDisplay>>>>>>>;

/** Load + resolve the slate's public-split DISPLAY, keyed by game external_id. */
export async function loadResolvedPublicSplitsForDisplay(opts: {
  supabase: SupabaseClient; sport: string; slateDate: string; now?: Date;
}): Promise<ResolvedDisplayByExtId> {
  const { supabase, sport, slateDate, now = new Date() } = opts;
  const result: ResolvedDisplayByExtId = new Map();

  const { data: games } = await supabase.from("games").select("id, external_id").eq("sport", sport).eq("slate_date", slateDate);
  const extByGameId = new Map<number, number>();
  const ids: number[] = [];
  for (const g of games ?? []) { const ext = (g.external_id as number) ?? null; if (ext != null) { extByGameId.set(g.id as number, ext); ids.push(g.id as number); } }
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from("public_splits_observations")
    .select("provider, game_id, market_type, side, public_betting_pct, public_money_pct, books_used, observed_at")
    .in("game_id", ids).in("market_type", ["moneyline", "total"]);
  if (error || !data) return result;

  const byKeyProvider = new Map<string, ObsRow>();
  for (const r of data as ObsRow[]) byKeyProvider.set(`${r.game_id}:${r.market_type}:${r.side}:${r.provider}`, r);

  const nowMs = now.getTime();
  for (const [gameId, ext] of extByGameId) {
    for (const market of ["moneyline", "total"] as Market[]) {
      for (const side of SIDES[market]) {
        const pick = pickDisplay(
          byKeyProvider.get(`${gameId}:${market}:${side}:playbook`),
          byKeyProvider.get(`${gameId}:${market}:${side}:sharpapi`),
          nowMs,
        );
        if (!pick) continue;
        if (!result.has(ext)) result.set(ext, {});
        const g = result.get(ext)!;
        (g[market] ??= {})[side] = pick;
      }
    }
  }
  return result;
}

function labelFor(market: Market, side: Side, homeAbbr: string, awayAbbr: string): string {
  if (market === "total") return side === "over" ? "Over" : "Under";
  return side === "home" ? homeAbbr : awayAbbr;
}

/**
 * Overlay resolved DISPLAY onto the DTO games' moneyline/total publicSplits.
 * Only replaces a market's publicSplits when resolved data exists for it; else
 * leaves the existing (current-source) array untouched. Mutates + returns games.
 */
export function overlayResolvedPublicSplits(
  games: DailyEdgeGameDto[],
  resolved: ResolvedDisplayByExtId,
): DailyEdgeGameDto[] {
  for (const game of games) {
    const r = resolved.get(game.external_id);
    if (!r) continue;
    for (const market of ["moneyline", "total"] as Market[]) {
      const sides = r[market];
      if (!sides) continue;
      const dto = (game.markets as Record<string, MarketEdgeDto | undefined>)[market];
      if (!dto) continue;
      const out: PublicSplit[] = [];
      for (const side of SIDES[market]) {
        const d = sides[side];
        if (!d) continue;
        out.push({
          side, label: labelFor(market, side, game.homeTeam, game.awayTeam),
          moneyPct: d.moneyPct, betsPct: d.betsPct, observedAt: d.observedAt, isStale: d.isStale,
        });
      }
      if (out.length > 0) dto.publicSplits = out;
    }
  }
  return games;
}
