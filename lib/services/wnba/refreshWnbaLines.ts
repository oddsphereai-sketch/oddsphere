/**
 * WNBA Phase 2 — Stage 1b: SharpAPI odds → DB (2026-06-23).
 *
 * Mirrors NBA's lines path. For each scheduled WNBA game it persists per-book
 * odds into `lines` (DELETE-then-INSERT per game/market/book), appends to
 * `line_history`, and writes consensus `sharp_signals` (de-vig fair prob) for
 * ML + total. RAW per-book rows are stored — the displayed/locked CONSENSUS
 * line is derived at read-time with the SAME picker MLB uses (selectMainTotalLine
 * etc.), so one outlier/alt line can never override consensus and the tracked
 * line always equals what users saw.
 *
 * Real tip time is mandatory for T-60 lock: SharpAPI `event_start_time` updates
 * `games.game_date` (BDL only gives a date). Validated odds path: cursor
 * pagination, 3 markets (moneyline/point_spread/total_points), trusted books
 * only, Fliff/Kalshi/Polymarket blocked, stale + alt-line filtered, mascot team
 * resolver, team-pair + date (±1) matching → no future-meeting mixing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { WNBA_TEAMS_BY_BDL_ID } from "./wnbaTeams";

const SHARP = "https://api.sharpapi.io/api/v1";
const BLOCKED = new Set(["fliff", "kalshi", "polymarket"]);
const SHARP_BOOKS = new Set(["circa", "betonline", "draftkings", "betmgm", "caesars", "bet365 us", "betrivers", "pinnacle"]);

const norm = (s: string) => String(s).replace(/[^a-z]/gi, "").toLowerCase();
const amProb = (o: number) => (o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100));
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null);
const r4 = (n: number) => Math.round(n * 10000) / 10000;

// Resolver: SharpAPI team name → BDL id (mascot = last word of franchise name).
const MASCOTS: Array<[string, number]> = Object.entries(WNBA_TEAMS_BY_BDL_ID).map(([id, m]) => {
  const mascot = norm(m.name.split(" ").pop() ?? m.abbr);
  return [mascot, Number(id)];
});
function resolveTeam(name: string): number | null {
  const n = norm(name);
  for (const [mascot, id] of MASCOTS) if (mascot.length >= 3 && n.includes(mascot)) return id;
  return null;
}

const MKT_MAP: Record<string, string> = { moneyline: "moneyline", point_spread: "spread", total_points: "total" };

type OddRow = {
  book: string; sharp: boolean; market: string; side: string;
  odds: number | null; line: number | null; startTime: string | null; h: number; a: number;
};

async function fetchSharpWnbaOdds(key: string): Promise<OddRow[]> {
  const perMarket = await Promise.all(
    ["moneyline", "point_spread", "total_points"].map(async (mkt) => {
      const rows: OddRow[] = [];
      let cursor: string | null = null;
      for (let p = 0; p < 10; p++) {
        const url = `${SHARP}/odds?league=wnba&market_type=${mkt}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
        if (!r.ok) break;
        const j = (await r.json()) as { data?: Record<string, unknown>[]; pagination?: { has_more?: boolean; next_cursor?: string } };
        for (const x of j.data ?? []) {
          const book = String(x.sportsbook ?? "").toLowerCase();
          if (BLOCKED.has(book) || x.is_main_line === false || x.is_stale_pregame_price === true) continue;
          const h = resolveTeam(String(x.home_team)), a = resolveTeam(String(x.away_team));
          if (!h || !a || h === a) continue;
          rows.push({
            book, sharp: SHARP_BOOKS.has(book), market: MKT_MAP[mkt]!, side: String(x.selection_type),
            odds: x.odds_american == null ? null : Number(x.odds_american),
            line: x.line == null ? null : Number(x.line),
            startTime: x.event_start_time ? String(x.event_start_time) : null,
            h, a,
          });
        }
        if (!j.pagination?.has_more || !j.pagination?.next_cursor) break;
        cursor = j.pagination.next_cursor;
      }
      return rows;
    }),
  );
  return perMarket.flat();
}

const pairKey = (a: number, b: number) => [a, b].sort((x, y) => x - y).join("|");

export type RefreshWnbaLinesResult = {
  apply: boolean;
  gamesScheduled: number;
  gamesMatched: number;
  oddsRows: number;
  unmatchedOddsRows: number;
  linesWritten: number;
  lineHistoryWritten: number;
  sharpSignalsWritten: number;
  tipTimesUpdated: number;
  missingTipTimes: string[];
  duplicatePairs: string[];
  perGame: Array<{ matchup: string; books: number; ml: number; spread: number; total: number; tip: string | null }>;
  errors: string[];
};

export async function refreshWnbaLines(opts: {
  supabase: SupabaseClient;
  apply: boolean;
  windowDays?: number; // how many days of scheduled games to cover (default 3)
  logger?: (m: string) => void;
}): Promise<RefreshWnbaLinesResult> {
  const { supabase, apply, windowDays = 3, logger = () => {} } = opts;
  const key = process.env.SHARPAPI_KEY;
  if (!key) throw new Error("missing SHARPAPI_KEY");
  const errors: string[] = [];

  // 1. Load scheduled WNBA games in the window + their team BDL ids.
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + windowDays * 86400000).toISOString().slice(0, 10);
  const { data: gameRows } = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, status, home_team_id, away_team_id")
    .eq("sport", "wnba")
    .eq("status", "scheduled")
    .gte("slate_date", today)
    .lte("slate_date", end);
  const games = gameRows ?? [];

  const { data: teamRows } = await supabase.from("teams").select("id, external_id").eq("sport", "wnba");
  const bdlByTeamId = new Map<number, number>();
  for (const t of teamRows ?? []) bdlByTeamId.set(t.id as number, t.external_id as number);

  type G = { id: number; slate: string; homeBdl: number; awayBdl: number };
  const byPair = new Map<string, G[]>();
  const duplicatePairs: string[] = [];
  for (const g of games) {
    const homeBdl = bdlByTeamId.get(g.home_team_id as number), awayBdl = bdlByTeamId.get(g.away_team_id as number);
    if (!homeBdl || !awayBdl) continue;
    const k = pairKey(homeBdl, awayBdl);
    const entry: G = { id: g.id as number, slate: g.slate_date as string, homeBdl, awayBdl };
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k)!.push(entry);
    if (byPair.get(k)!.length === 2) duplicatePairs.push(k);
  }

  // 2. Fetch + match odds to a game by team-pair + date (±1 day).
  const odds = await fetchSharpWnbaOdds(key);
  const oddsByGame = new Map<number, OddRow[]>();
  const tipByGame = new Map<number, string>();
  let unmatched = 0;
  const etDate = (iso: string): string | null => { try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); } catch { return null; } };
  const dayDiff = (a: string, b: string) => Math.abs(+new Date(`${a}T00:00:00Z`) - +new Date(`${b}T00:00:00Z`)) / 86400000;
  for (const o of odds) {
    const cands = byPair.get(pairKey(o.h, o.a));
    if (!cands || cands.length === 0) { unmatched++; continue; }
    // Match on the odds' ET slate date: exact hit first; else the CLOSEST
    // same-pair game within ±1 day. A genuine tie (two candidates equidistant)
    // stays ambiguous → SKIP (never mix meetings). This includes a real game
    // whose seeded slate is off-by-one while still withholding true duplicates.
    const oSlateEt = o.startTime ? etDate(o.startTime) : null;
    let g: G | undefined;
    if (oSlateEt) {
      g = cands.find((c) => c.slate === oSlateEt);
      if (!g) {
        const within = cands.map((c) => ({ c, d: dayDiff(c.slate, oSlateEt) })).filter((x) => x.d <= 1).sort((a, b) => a.d - b.d);
        if (within.length === 1) g = within[0]!.c;
        else if (within.length > 1 && within[0]!.d < within[1]!.d) g = within[0]!.c;
      }
    }
    if (!g && cands.length === 1) g = cands[0];
    if (!g) { unmatched++; continue; }
    if (!oddsByGame.has(g.id)) oddsByGame.set(g.id, []);
    oddsByGame.get(g.id)!.push(o);
    if (o.startTime && !tipByGame.has(g.id)) tipByGame.set(g.id, o.startTime);
  }

  // 3. Build rows per matched game.
  const fetchedAt = new Date().toISOString();
  const linesPayload: Record<string, unknown>[] = [];
  const historyPayload: Record<string, unknown>[] = [];
  const signalsPayload: Record<string, unknown>[] = [];
  const deleteKeys = new Set<string>(); // `${gameId}::${market}::${book}`
  const signalDeleteKeys = new Set<string>(); // `${gameId}::${market}::${side}`
  const perGame: RefreshWnbaLinesResult["perGame"] = [];
  const missingTipTimes: string[] = [];

  for (const [gameId, rows] of oddsByGame.entries()) {
    const books = new Set(rows.map((r) => r.book));
    const byMkt = (m: string) => rows.filter((r) => r.market === m);
    const tip = tipByGame.get(gameId) ?? null;
    const g = games.find((x) => x.id === gameId)!;
    const matchup = `${WNBA_TEAMS_BY_BDL_ID[bdlByTeamId.get(g.away_team_id as number)!]?.abbr}@${WNBA_TEAMS_BY_BDL_ID[bdlByTeamId.get(g.home_team_id as number)!]?.abbr}`;
    if (!tip) missingTipTimes.push(matchup);
    perGame.push({ matchup, books: books.size, ml: byMkt("moneyline").length, spread: byMkt("spread").length, total: byMkt("total").length, tip });

    for (const r of rows) {
      if (r.odds == null && r.line == null) continue;
      deleteKeys.add(`${gameId}::${r.market}::${r.book}`);
      // Column sets differ: `lines` has odds_decimal (no is_opener);
      // `line_history` has is_opener + recorded_at (no odds_decimal).
      const core = {
        game_id: gameId, market_type: r.market, player_id: null, sportsbook: r.book,
        side: r.side, line_value: r.line, odds_american: r.odds,
      };
      const oddsDecimal = r.odds == null ? null : r.odds > 0 ? r.odds / 100 + 1 : 100 / Math.abs(r.odds) + 1;
      linesPayload.push({ ...core, odds_decimal: oddsDecimal, fetched_at: fetchedAt });
      historyPayload.push({ ...core, is_opener: false, recorded_at: fetchedAt });
    }

    // Consensus de-vig fair prob → sharp_signals (ML + total).
    for (const market of ["moneyline", "total"]) {
      const mr = byMkt(market);
      const sideA = market === "moneyline" ? "home" : "over";
      const sideB = market === "moneyline" ? "away" : "under";
      const oddsA = mr.filter((x) => x.side === sideA && x.odds != null).map((x) => x.odds!);
      const oddsB = mr.filter((x) => x.side === sideB && x.odds != null).map((x) => x.odds!);
      if (!oddsA.length || !oddsB.length) continue;
      const pa = median(oddsA.map((o) => amProb(o)))!, pb = median(oddsB.map((o) => amProb(o)))!;
      const sum = pa + pb;
      for (const [side, p] of [[sideA, pa / sum], [sideB, pb / sum]] as [string, number][]) {
        signalDeleteKeys.add(`${gameId}::${market}::${side}`);
        signalsPayload.push({
          game_id: gameId, market_type: market, side,
          pinnacle_fair_probability: r4(p), is_plus_ev: false, ev_pct: null,
          has_steam_move: false, steam_detected_at: null, steam_books_count: null,
          has_reverse_line_movement: false, rlm_direction: null,
          public_betting_pct: null, public_money_pct: null, computed_at: fetchedAt,
        });
      }
    }
  }

  const result: RefreshWnbaLinesResult = {
    apply, gamesScheduled: games.length, gamesMatched: oddsByGame.size, oddsRows: odds.length,
    unmatchedOddsRows: unmatched, linesWritten: 0, lineHistoryWritten: 0, sharpSignalsWritten: 0,
    tipTimesUpdated: 0, missingTipTimes, duplicatePairs, perGame, errors,
  };

  if (!apply) {
    logger(`wnba lines DRY-RUN: ${oddsByGame.size}/${games.length} games matched, ${linesPayload.length} lines, ${signalsPayload.length} signals`);
    result.linesWritten = linesPayload.length;
    result.lineHistoryWritten = historyPayload.length;
    result.sharpSignalsWritten = signalsPayload.length;
    return result;
  }

  // 4. Apply. Full window refresh of `lines`: clear current rows for ALL window
  // scheduled games (removes stale / duplicate-meeting rows), then insert the
  // freshly matched set. `line_history` stays append-only (history preserved).
  void deleteKeys;
  const windowIds = games.map((g) => g.id as number);
  if (windowIds.length) {
    const { error } = await supabase.from("lines").delete().in("game_id", windowIds).is("player_id", null);
    if (error) errors.push(`lines window clear: ${error.message}`);
  }
  if (linesPayload.length) {
    const { error } = await supabase.from("lines").insert(linesPayload);
    if (error) errors.push(`lines insert: ${error.message}`); else result.linesWritten = linesPayload.length;
  }
  if (historyPayload.length) {
    const { error } = await supabase.from("line_history").insert(historyPayload);
    if (error) errors.push(`line_history insert: ${error.message}`); else result.lineHistoryWritten = historyPayload.length;
  }
  for (const sk of signalDeleteKeys) {
    const [gid, mkt, side] = sk.split("::");
    const { error } = await supabase.from("sharp_signals").delete()
      .eq("game_id", Number(gid)).eq("market_type", mkt).eq("side", side);
    if (error) errors.push(`signals delete ${sk}: ${error.message}`);
  }
  if (signalsPayload.length) {
    const { error } = await supabase.from("sharp_signals").insert(signalsPayload);
    if (error) errors.push(`sharp_signals insert: ${error.message}`); else result.sharpSignalsWritten = signalsPayload.length;
  }
  for (const [gameId, tip] of tipByGame.entries()) {
    const { error } = await supabase.from("games").update({ game_date: tip }).eq("id", gameId).eq("sport", "wnba");
    if (error) errors.push(`tip update ${gameId}: ${error.message}`); else result.tipTimesUpdated++;
  }
  logger(`wnba lines APPLY: lines ${result.linesWritten}, history ${result.lineHistoryWritten}, signals ${result.sharpSignalsWritten}, tips ${result.tipTimesUpdated}`);
  return result;
}
