/**
 * Dual-source public splits — Phase 1 observation WRITER (additive).
 *
 * Ticket: o-dual-splits-observation-layer.
 *
 * Writes provider-separated rows into `public_splits_observations` ONLY. It
 * does NOT touch sharp_signals, grades, model, UI, lines, or crons — it reads
 * the already-written authoritative sources and mirrors them into the new lane:
 *
 *   provider=sharpapi : mirror sharp_signals public_* (MLB — SharpAPI is the
 *                       MLB public-splits source). books_used unknown (null).
 *   provider=playbook : fetch Playbook /splits (today) or /splits-history
 *                       (past) for MLB + WNBA — carries real books_used.
 *
 * Idempotent upsert on (provider, game_id, market_type, side). Degrades
 * gracefully (no throw) if the table has not been applied yet
 * (schema-migration-v25.sql) — so this is safe to deploy before/after apply.
 *
 * Zero behavior change to existing lanes. This data is NOT read by any UI or
 * grade path until Phase 2/3 wire the resolved read behind their own gates.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { PlaybookClient } from "../providers/playbook/playbookClient";
import type { PlaybookSplitGame } from "../providers/playbook/types";
import { normalizeMlbTeamName } from "../providers/real_api/_teamNameNormalizer";
import { normalizeTeamAbbr, type NormalizerSport } from "../providers/playbook/playbookTeamNormalizer";
import { publicSplitsCapability, shouldObservePlaybook } from "../config/publicSplitsCapability";

type Side = "home" | "away" | "over" | "under";
type Market = "moneyline" | "total" | "spread";

export type SyncResult = {
  apply: boolean;
  sport: string;
  slateDate: string;
  sharpapiRows: number;
  playbookRows: number;
  upserted: number;
  skippedTableMissing: boolean;
  errors: string[];
};

type ObsRow = {
  provider: "playbook" | "sharpapi";
  sport: string;
  game_id: number;
  market_type: Market;
  side: Side;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  books_used: number | null;
  observed_at: string;
};

function gameKey(sport: string, away: unknown, home: unknown): string | null {
  if (sport === "mlb") {
    const a = normalizeMlbTeamName(String(away ?? "")), h = normalizeMlbTeamName(String(home ?? ""));
    return a && h ? `${a}@${h}` : null;
  }
  const a = normalizeTeamAbbr(sport as NormalizerSport, away), h = normalizeTeamAbbr(sport as NormalizerSport, home);
  return a && h ? `${a}@${h}` : null;
}

function pbCells(pb: PlaybookSplitGame, market: Market, side: Side): { bet: number | null; money: number | null; books: number | null } {
  const s = pb.splits ?? {};
  const m = market === "moneyline" ? s.moneyline : market === "total" ? s.total : s.spread;
  if (!m) return { bet: null, money: null, books: null };
  const books = m.source?.booksUsed ?? null;
  if (market === "total") {
    return side === "over"
      ? { bet: m.bets?.overPercent ?? null, money: m.money?.overPercent ?? null, books }
      : { bet: m.bets?.underPercent ?? null, money: m.money?.underPercent ?? null, books };
  }
  return side === "home"
    ? { bet: m.bets?.homePercent ?? null, money: m.money?.homePercent ?? null, books }
    : { bet: m.bets?.awayPercent ?? null, money: m.money?.awayPercent ?? null, books };
}

const SIDES: Record<Market, Side[]> = { moneyline: ["home", "away"], spread: ["home", "away"], total: ["over", "under"] };

export async function syncPublicSplitsObservations(opts: {
  supabase: SupabaseClient;
  sport: string;
  slateDate: string;
  apply: boolean;
  todayUtc: string;
  logger?: (m: string) => void;
}): Promise<SyncResult> {
  const { supabase, sport, slateDate, apply, todayUtc, logger = () => {} } = opts;
  const res: SyncResult = { apply, sport, slateDate, sharpapiRows: 0, playbookRows: 0, upserted: 0, skippedTableMissing: false, errors: [] };

  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name").eq("sport", sport);
  const abbr = new Map<number, string>(), tname = new Map<number, string>();
  for (const t of teams ?? []) { abbr.set(t.id as number, (t.abbreviation as string) ?? ""); tname.set(t.id as number, (t.name as string) ?? ""); }
  const { data: games } = await supabase.from("games").select("id, home_team_id, away_team_id").eq("sport", sport).eq("slate_date", slateDate);
  const ids = (games ?? []).map((g) => g.id as number);
  if (ids.length === 0) { logger(`${sport} ${slateDate}: no games`); return res; }
  const keyById = new Map<number, string>();
  for (const g of games ?? []) {
    const k = sport === "mlb" ? `${abbr.get(g.away_team_id as number)}@${abbr.get(g.home_team_id as number)}` : gameKey(sport, tname.get(g.away_team_id as number), tname.get(g.home_team_id as number));
    if (k) keyById.set(g.id as number, k);
  }

  const rows: ObsRow[] = [];

  // ── SharpAPI observations: mirror sharp_signals (sports where it's SharpAPI) ──
  if (publicSplitsCapability(sport).sharpSignalsProvider === "sharpapi") {
    const { data: ss } = await supabase.from("sharp_signals")
      .select("game_id, market_type, side, public_betting_pct, public_money_pct, computed_at")
      .in("game_id", ids).in("market_type", ["moneyline", "total", "spread"]);
    for (const r of ss ?? []) {
      const bet = r.public_betting_pct as number | null, money = r.public_money_pct as number | null;
      if (bet === null && money === null) continue;
      rows.push({
        provider: "sharpapi", sport, game_id: r.game_id as number,
        market_type: r.market_type as Market, side: r.side as Side,
        public_betting_pct: bet, public_money_pct: money, books_used: null,
        observed_at: (r.computed_at as string) ?? new Date().toISOString(),
      });
      res.sharpapiRows++;
    }
  }

  // ── Playbook observations: fetch Playbook splits / splits-history ──
  // Observe for supported + audit_required sports (read-only data gathering);
  // unsupported sports (e.g. soccer/WC) are skipped — never fabricated.
  if (shouldObservePlaybook(sport) && process.env.PLAYBOOK_API_KEY) {
    const client = new PlaybookClient(process.env.PLAYBOOK_API_KEY);
    let pbRows: PlaybookSplitGame[] = [];
    try {
      const r = slateDate === todayUtc ? await client.splits(sport) : await client.splitsHistory(sport, slateDate);
      pbRows = ((r.body as { data?: PlaybookSplitGame[] }).data) ?? [];
    } catch (e) { res.errors.push(`playbook fetch: ${(e as Error).message}`); }
    const pbByKey = new Map<string, PlaybookSplitGame>();
    for (const r of pbRows) { const k = gameKey(sport, r.awayTeamName, r.homeTeamName); if (k) pbByKey.set(k, r); }
    const observedAt = new Date().toISOString();
    for (const [gid, gkey] of keyById) {
      const pb = pbByKey.get(gkey); if (!pb) continue;
      for (const market of ["moneyline", "total", "spread"] as Market[]) {
        for (const side of SIDES[market]) {
          const c = pbCells(pb, market, side);
          if (c.bet === null && c.money === null) continue;
          rows.push({ provider: "playbook", sport, game_id: gid, market_type: market, side, public_betting_pct: c.bet, public_money_pct: c.money, books_used: c.books, observed_at: observedAt });
          res.playbookRows++;
        }
      }
    }
  }

  logger(`${sport} ${slateDate}: sharpapi=${res.sharpapiRows} playbook=${res.playbookRows} (apply=${apply})`);
  if (!apply || rows.length === 0) return res;

  // ── Upsert (graceful if table not yet applied) ──
  const { error } = await supabase
    .from("public_splits_observations")
    .upsert(rows, { onConflict: "provider,game_id,market_type,side" });
  if (error) {
    if (/relation .* does not exist|Could not find the table/i.test(error.message)) {
      res.skippedTableMissing = true;
      logger(`  table not applied yet (schema-migration-v25.sql) — skipped ${rows.length} rows`);
    } else {
      res.errors.push(`upsert: ${error.message}`);
    }
    return res;
  }
  res.upserted = rows.length;
  return res;
}
