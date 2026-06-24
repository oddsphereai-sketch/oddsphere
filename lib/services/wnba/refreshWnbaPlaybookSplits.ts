/**
 * WNBA Playbook public-splits ingest (ticket o-wnba-playbook-splits, Step A).
 *
 * Fills `sharp_signals.public_betting_pct` / `public_money_pct` / `computed_at`
 * for PREGAME WNBA games from Playbook public splits, so the existing Daily
 * Edge UI can render truthful bet% / money% / freshness. WNBA-ONLY.
 *
 * Safety contract (display-context only):
 *   - Uses Codex's shared mapper (mapPlaybookSplitsToSharpSignalRecords), which
 *     hard-nulls pinnacle_fair_probability / +EV / steam / RLM / CLV.
 *   - Writes ONLY the public_* columns + computed_at. Existing fair-prob signal
 *     rows (written by refreshWnbaLines) are UPDATED in place, never clobbered.
 *   - Scoped to status='scheduled' (pregame) games on the target ET slate.
 *   - Playbook rows are bucketed to the slate by ET(startTime) so a back-to-back
 *     series (same matchup, different days) maps to the right game.
 *   - The WNBA model/grade path does NOT read public_*; this cannot move grades.
 *
 * NOT for MLB (separate provenance/parity promotion path) and NOT for soccer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSlateDate } from "../../dates/slateDate";
import { PlaybookClient } from "../../providers/playbook/playbookClient";
import { mapPlaybookSplitsToSharpSignalRecords } from "../../providers/playbook/playbookPublicSplitsMapper";
import type { PlaybookSplitGame } from "../../providers/playbook/types";

// Only the markets the WNBA card surfaces public splits for.
const DISPLAY_MARKETS = new Set(["moneyline", "total"]);

export type RefreshWnbaPlaybookSplitsResult = {
  apply: boolean;
  slateDate: string;
  pregameGames: number;
  playbookRowsForSlate: number;
  recordsMapped: number;
  rowsUpdated: number;
  rowsInserted: number;
  skippedUnmatched: number;
  perGame: Array<{ matchup: string; markets: string[] }>;
  errors: string[];
};

export async function refreshWnbaPlaybookSplits(opts: {
  supabase: SupabaseClient;
  slateDate: string;
  apply: boolean;
  logger?: (m: string) => void;
}): Promise<RefreshWnbaPlaybookSplitsResult> {
  const { supabase, slateDate, apply, logger = () => {} } = opts;
  const key = process.env.PLAYBOOK_API_KEY;
  if (!key) throw new Error("missing PLAYBOOK_API_KEY");
  const errors: string[] = [];

  // 1. Pregame WNBA games on the target ET slate → key (away@home abbr) maps.
  const { data: teams } = await supabase.from("teams").select("id, abbreviation").eq("sport", "wnba");
  const abbrById = new Map<number, string>();
  for (const t of teams ?? []) abbrById.set(t.id as number, (t.abbreviation as string) ?? "");
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id")
    .eq("sport", "wnba").eq("status", "scheduled").eq("slate_date", slateDate);
  const extIdByKey = new Map<string, number>();
  const idByExt = new Map<number, number>();
  for (const g of games ?? []) {
    const away = abbrById.get(g.away_team_id as number);
    const home = abbrById.get(g.home_team_id as number);
    const ext = (g.external_id as number) ?? null;
    if (!away || !home || ext == null) continue;
    extIdByKey.set(`${away}@${home}`, ext);
    idByExt.set(ext, g.id as number);
  }
  if (extIdByKey.size === 0) {
    logger(`wnba playbook splits ${slateDate}: no pregame games`);
    return { apply, slateDate, pregameGames: 0, playbookRowsForSlate: 0, recordsMapped: 0, rowsUpdated: 0, rowsInserted: 0, skippedUnmatched: 0, perGame: [], errors };
  }

  // 2. Fetch Playbook WNBA splits; keep rows whose ET(startTime) == this slate.
  const client = new PlaybookClient(key);
  let allRows: PlaybookSplitGame[] = [];
  try {
    const res = await client.splits("wnba");
    allRows = res.body.data ?? [];
  } catch (e) {
    errors.push(`playbook fetch: ${(e as Error).message}`);
    return { apply, slateDate, pregameGames: extIdByKey.size, playbookRowsForSlate: 0, recordsMapped: 0, rowsUpdated: 0, rowsInserted: 0, skippedUnmatched: 0, perGame: [], errors };
  }
  const rows = allRows.filter((r) => r.startTime && computeSlateDate("wnba", r.startTime) === slateDate);

  // 3. Map via the shared mapper (public-split fields only).
  const computedAt = new Date().toISOString();
  const { records } = mapPlaybookSplitsToSharpSignalRecords({
    sport: "wnba", rows, gameExternalIdByKey: extIdByKey, computedAt,
  });
  const displayRecords = records.filter((r) => DISPLAY_MARKETS.has(r.market_type));

  // 4. Partition into UPDATE (existing fair-prob row) vs INSERT (new public row).
  const gameIds = [...idByExt.values()];
  const { data: existing } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"]);
  const existingKeys = new Set((existing ?? []).map((r) => `${r.game_id}::${r.market_type}::${r.side}`));

  type Write = { gameId: number; market: string; side: string; betting: number | null; money: number | null };
  const updates: Write[] = [];
  const inserts: Write[] = [];
  const perGameMarkets = new Map<number, Set<string>>();
  let skippedUnmatched = 0;
  for (const rec of displayRecords) {
    const gameId = idByExt.get(rec.game_external_id);
    if (gameId == null) { skippedUnmatched++; continue; }
    const w: Write = { gameId, market: rec.market_type, side: rec.side, betting: rec.public_betting_pct, money: rec.public_money_pct };
    (existingKeys.has(`${gameId}::${rec.market_type}::${rec.side}`) ? updates : inserts).push(w);
    if (!perGameMarkets.has(gameId)) perGameMarkets.set(gameId, new Set());
    perGameMarkets.get(gameId)!.add(rec.market_type);
  }

  const result: RefreshWnbaPlaybookSplitsResult = {
    apply, slateDate, pregameGames: extIdByKey.size, playbookRowsForSlate: rows.length,
    recordsMapped: displayRecords.length, rowsUpdated: 0, rowsInserted: 0, skippedUnmatched,
    perGame: [...perGameMarkets.entries()].map(([gid, mkts]) => ({
      matchup: matchupFor(gid, games ?? [], abbrById), markets: [...mkts],
    })),
    errors,
  };

  if (!apply) {
    logger(`wnba playbook splits DRY-RUN ${slateDate}: ${updates.length} updates, ${inserts.length} inserts (${rows.length} playbook rows)`);
    result.rowsUpdated = updates.length;
    result.rowsInserted = inserts.length;
    return result;
  }

  // 5. Apply: UPDATE preserves fair-prob; INSERT mirrors refreshWnbaLines shape.
  for (const u of updates) {
    const { error } = await supabase
      .from("sharp_signals")
      .update({ public_betting_pct: u.betting, public_money_pct: u.money, computed_at: computedAt })
      .eq("game_id", u.gameId).eq("market_type", u.market).eq("side", u.side);
    if (error) errors.push(`update ${u.gameId}/${u.market}/${u.side}: ${error.message}`); else result.rowsUpdated++;
  }
  if (inserts.length) {
    const payload = inserts.map((i) => ({
      game_id: i.gameId, market_type: i.market, side: i.side,
      pinnacle_fair_probability: null, is_plus_ev: false, ev_pct: null,
      has_steam_move: false, steam_detected_at: null, steam_books_count: null,
      has_reverse_line_movement: false, rlm_direction: null,
      public_betting_pct: i.betting, public_money_pct: i.money, computed_at: computedAt,
    }));
    const { error } = await supabase.from("sharp_signals").insert(payload);
    if (error) errors.push(`insert: ${error.message}`); else result.rowsInserted = inserts.length;
  }
  logger(`wnba playbook splits APPLY ${slateDate}: updated ${result.rowsUpdated}, inserted ${result.rowsInserted}`);
  return result;
}

function matchupFor(gameId: number, games: Array<Record<string, unknown>>, abbrById: Map<number, string>): string {
  const g = games.find((x) => x.id === gameId);
  if (!g) return String(gameId);
  return `${abbrById.get(g.away_team_id as number)}@${abbrById.get(g.home_team_id as number)}`;
}
