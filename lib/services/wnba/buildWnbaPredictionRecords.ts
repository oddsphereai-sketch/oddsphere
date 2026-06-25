/**
 * WNBA Phase 2 — Stage 2: prediction_records writer (2026-06-23).
 *
 * Creates FIRST-CLASS records for WNBA ML / O-U / Spread from the DB-backed
 * game_predictions + lines. Each record freezes the EXACT displayed recommendation
 * (side / market / line / price / confidence / grade / projected score + full audit
 * in snapshot_json). The price is derived from the DB lines AT THE DISPLAYED
 * (modal-consensus) line, so displayed line === record line === (later) graded line.
 *
 * WITHHELD ≠ SKIPPED: ambiguous duplicate-pair games (and games without a
 * confirmed real tip) are temporarily WITHHELD with a reason and queued for
 * resolution — never permanently dropped. Every real game must eventually record.
 *
 * Spread is a real `market='spread'` row (gradeable as WNBA Spread), NOT buried
 * in a context-only field. locked_at stays null here; pregame-sweep sets it at T-60.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToSlate, currentSlateDate } from "../../dates/slateDate";
import { isPublicallyTracked } from "../../config/officialTrackingStart";

const PLAY_GRADE: Record<string, string> = { "Best Angle": "best_angle", "Lean": "lean", "Watchlist": "watchlist", "Caution": "caution" };
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null);
const toDecimal = (o: number | null) => (o == null ? null : o > 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1);
const HISTORY_PAGE_SIZE = 1000;

export type WnbaRecordsResult = {
  apply: boolean;
  eligibleGames: number;
  withheld: Array<{ matchup: string; slate: string; reason: string }>;
  counts: { moneyline: number; total: number; spread: number };
  missingTip: string[];
  missingLinePrice: string[];
  ambiguous: string[];
  written: number;
  lockedSkipped: number;
  records: Record<string, unknown>[];
  errors: string[];
};

export async function buildWnbaPredictionRecords(opts: {
  supabase: SupabaseClient;
  apply: boolean;
  slateDate?: string;
  windowDays?: number;
  logger?: (m: string) => void;
}): Promise<WnbaRecordsResult> {
  const { supabase, apply, slateDate, windowDays = 0, logger = () => {} } = opts;
  const errors: string[] = [];
  const today = slateDate ?? currentSlateDate("wnba");
  const end = addDaysToSlate(today, windowDays);
  const nowIso = new Date().toISOString();
  const result: WnbaRecordsResult = { apply, eligibleGames: 0, withheld: [], counts: { moneyline: 0, total: 0, spread: 0 }, missingTip: [], missingLinePrice: [], ambiguous: [], written: 0, lockedSkipped: 0, records: [], errors };

  if (!isPublicallyTracked("wnba", today)) {
    logger(`wnba records ${today}: before official public-tracking start — no records written`);
    return result;
  }

  const { data: games } = await supabase
    .from("games").select("id, external_id, slate_date, game_date, home_team_id, away_team_id")
    .eq("sport", "wnba").eq("status", "scheduled").gte("slate_date", today).lte("slate_date", end);
  const allGames = games ?? [];
  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name").eq("sport", "wnba");
  const tById = new Map((teams ?? []).map((t) => [t.id as number, t]));
  const ab = (id: number) => (tById.get(id)?.abbreviation as string) ?? "?";

  const ids = allGames.map((g) => g.id as number);
  const { data: gps } = ids.length ? await supabase.from("game_predictions").select("id, game_id, locked_at, sport_specific").in("game_id", ids) : { data: [] as Record<string, unknown>[] };
  const gpByGame = new Map((gps ?? []).map((r) => [r.game_id as number, r]));
  const { data: lineRows } = ids.length ? await supabase.from("lines").select("game_id, market_type, side, line_value, odds_american").in("game_id", ids).is("player_id", null) : { data: [] as Record<string, unknown>[] };
  const historyRows: Record<string, unknown>[] = [];
  if (ids.length) {
    for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
      const { data: page, error } = await supabase
        .from("line_history")
        .select("game_id, market_type, side, line_value, odds_american, recorded_at")
        .in("game_id", ids)
        .in("market_type", ["moneyline", "total", "spread"])
        .not("odds_american", "is", null)
        .order("recorded_at", { ascending: false })
        .range(from, from + HISTORY_PAGE_SIZE - 1);
      if (error) {
        errors.push(`line_history read: ${error.message}`);
        break;
      }
      historyRows.push(...(page ?? []));
      if ((page ?? []).length < HISTORY_PAGE_SIZE) break;
    }
  }
  const linesByGame = new Map<number, Record<string, unknown>[]>();
  for (const l of lineRows ?? []) { const gid = l.game_id as number; if (!linesByGame.has(gid)) linesByGame.set(gid, []); linesByGame.get(gid)!.push(l); }
  const historyByGame = new Map<number, Record<string, unknown>[]>();
  const seenHistory = new Set<string>();
  for (const h of historyRows ?? []) {
    const gid = h.game_id as number;
    const key = `${gid}::${h.market_type}::${h.side}::${h.line_value ?? ""}::${h.recorded_at}`;
    if (seenHistory.has(key)) continue;
    seenHistory.add(key);
    if (!historyByGame.has(gid)) historyByGame.set(gid, []);
    historyByGame.get(gid)!.push(h);
  }

  // Duplicate detection: a team-pair with >1 scheduled meeting in the window.
  const pairCount = new Map<string, number>();
  for (const g of allGames) { const k = [g.home_team_id, g.away_team_id].sort((a, b) => (a as number) - (b as number)).join("|"); pairCount.set(k, (pairCount.get(k) ?? 0) + 1); }
  const isDupPair = (g: { home_team_id: number; away_team_id: number }) => (pairCount.get([g.home_team_id, g.away_team_id].sort((a, b) => a - b).join("|")) ?? 0) > 1;

  const priceAt = (gid: number, market: string, side: string, line: number | null) => {
    const sideRows = (linesByGame.get(gid) ?? []).filter((r) => r.market_type === market && r.side === side && r.odds_american != null);
    const rows = line === null
      ? sideRows
      : (() => {
          const exact = sideRows.filter((r) => r.line_value === line);
          if (exact.length > 0) return exact;
          const nearest = sideRows
            .filter((r) => r.line_value != null)
            .sort((a, b) => Math.abs((a.line_value as number) - line) - Math.abs((b.line_value as number) - line))[0];
          return nearest ? sideRows.filter((r) => r.line_value === nearest.line_value) : [];
        })();
    const currentPrice = median(rows.map((r) => r.odds_american as number));
    if (currentPrice !== null) return currentPrice;

    const historySideRows = (historyByGame.get(gid) ?? []).filter((r) => r.market_type === market && r.side === side && r.odds_american != null);
    const historyMatches = line === null
      ? historySideRows
      : (() => {
          const exact = historySideRows.filter((r) => r.line_value === line);
          if (exact.length > 0) return exact;
          const nearest = historySideRows
            .filter((r) => r.line_value != null)
            .sort((a, b) => Math.abs((a.line_value as number) - line) - Math.abs((b.line_value as number) - line))[0];
          return nearest ? historySideRows.filter((r) => r.line_value === nearest.line_value) : [];
        })();
    const latestAt = historyMatches
      .map((r) => new Date(r.recorded_at as string).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (latestAt === undefined) return null;
    return median(historyMatches
      .filter((r) => new Date(r.recorded_at as string).getTime() === latestAt)
      .map((r) => r.odds_american as number));
  };

  for (const g of allGames) {
    const matchup = `${ab(g.away_team_id as number)}@${ab(g.home_team_id as number)}`;
    const gp = gpByGame.get(g.id as number) as { id: number; locked_at: string | null; sport_specific?: Record<string, unknown> } | undefined;
    const slate = g.slate_date as string;

    // ── eligibility (WITHHOLD, not skip) ──
    if (!gp || !gp.sport_specific?.moneyline) {
      const reason = isDupPair(g as { home_team_id: number; away_team_id: number }) ? "ambiguous duplicate pairing (awaiting clean match)" : "no DB prediction yet (will retry next refresh)";
      if (isDupPair(g as { home_team_id: number; away_team_id: number })) result.ambiguous.push(matchup);
      result.withheld.push({ matchup, slate, reason });
      continue;
    }
    // Real-tip / clean-match signal: a matched game HAS current lines (written
    // by refreshWnbaLines along with its real SharpAPI tip). A prediction with
    // no current lines is stale → withhold. (A value-based midnight-placeholder
    // check false-positives on real 8 PM ET tips that land at T00:00:00Z.)
    if ((linesByGame.get(g.id as number) ?? []).length === 0) {
      result.missingTip.push(matchup);
      result.withheld.push({ matchup, slate, reason: "no current market/odds (stale) — withheld" });
      continue;
    }
    // A duplicate-pair game that reaches here HAS a clean prediction + current
    // lines → it is the cleanly-matched meeting, so INCLUDE it. Only the
    // unmatched twin (no prediction) was withheld above.

    const ss = gp.sport_specific as Record<string, unknown>;
    const ml = ss.moneyline as { side: string; confidence: number; grade: string; price: number | null };
    const tot = ss.total as { side: string | null; line: number | null; confidence: number | null; grade: string | null };
    const spr = ss.spread as { side: string | null; line: number | null; confidence: number | null; grade: string | null };
    const model = ss.model as { home_win_prob: number; margin: number; total: number };
    const market = ss.market as { home_win_prob: number | null };
    const trusted = ss.trusted as { home_win_prob: number | null };
    const dq = ss.data_quality as { flags: string[]; ml_books: number };
    const homeName = tById.get(g.home_team_id as number)?.name as string;
    const mlSideHome = ml.side === homeName;
    const mlPrice = ml.price ?? priceAt(g.id as number, "moneyline", mlSideHome ? "home" : "away", null);

    // ML must have side + price to be eligible.
    if (!ml.side || mlPrice == null) {
      result.missingLinePrice.push(`${matchup} (ML price)`);
      result.withheld.push({ matchup, slate, reason: "no ML price — withheld" });
      continue;
    }
    result.eligibleGames++;

    const baseRec = (market_type: string, side: string, pick: string, line_value: number | null, odds: number | null, confidence: number | null, gradeStr: string | null, modelProb: number | null, mktProb: number | null) => ({
      game_prediction_id: gp.id, game_id: g.id, external_id: g.external_id, sport: "wnba",
      slate_date: slate, game_date: g.game_date, matchup, market: market_type, pick, side,
      line_value, odds_american: odds, odds_decimal: toDecimal(odds),
      model_used: "wnba_v1", model_version: "wnba_v1", prediction_source: "auto_v1_wnba",
      confidence, model_probability: modelProb, market_probability: mktProb,
      edge: modelProb != null && mktProb != null ? Math.round((modelProb - mktProb) * 1000) / 10 : null,
      play_grade: gradeStr ? PLAY_GRADE[gradeStr] ?? "watchlist" : null,
      best_angle: gradeStr === "Best Angle", no_bet: false,
      market_aligned: gradeStr === "Watchlist" || gradeStr === "Caution",
      data_quality_tier: (dq.flags ?? []).length === 0 ? "high" : "standard", source_quality: null,
      provisional: false, held: false, launch_day: false, locked_at: null, published_at: nowIso,
      snapshot_json: {
        market: market_type, side, line: line_value, price: odds, confidence, grade: gradeStr,
        projected_score: ss.projected_score, model, market_consensus: market, trusted_consensus: trusted,
        sharp_consensus: ss.sharp, consensus_source: ss.consensus_source, dynamic_market_weight: ss.dynamic_market_weight,
        data_quality: ss.data_quality, cold_start: ss.cold_start,
      },
    });

    // ── ML record ──
    const mlModelProb = mlSideHome ? model.home_win_prob : 1 - model.home_win_prob;
    const mlMktProb = (trusted.home_win_prob ?? market.home_win_prob) != null ? (mlSideHome ? (trusted.home_win_prob ?? market.home_win_prob)! : 1 - (trusted.home_win_prob ?? market.home_win_prob)!) : null;
    result.records.push(baseRec("moneyline", mlSideHome ? "home" : "away", ab(mlSideHome ? (g.home_team_id as number) : (g.away_team_id as number)), null, mlPrice, ml.confidence, ml.grade, mlModelProb, mlMktProb));
    result.counts.moneyline++;

    // ── O/U record (if available) ──
    if (tot.side && tot.line != null) {
      const ouSide = tot.side.startsWith("Over") ? "over" : "under";
      const ouPrice = priceAt(g.id as number, "total", ouSide, tot.line);
      if (ouPrice == null) result.missingLinePrice.push(`${matchup} (O/U price@${tot.line})`);
      result.records.push(baseRec("total", ouSide, tot.side, tot.line, ouPrice, tot.confidence, tot.grade, tot.confidence != null ? tot.confidence / 100 : null, null));
      result.counts.total++;
    }

    // ── Spread record (if available) — first-class market='spread' ──
    if (spr.side && spr.line != null) {
      const sprSideHome = spr.side.startsWith(homeName);
      const sprLine = sprSideHome ? spr.line : -spr.line;
      const sprPrice = priceAt(g.id as number, "spread", sprSideHome ? "home" : "away", sprLine);
      if (sprPrice == null) result.missingLinePrice.push(`${matchup} (Spread price@${sprLine})`);
      result.records.push(baseRec("spread", sprSideHome ? "home" : "away", spr.side, sprLine, sprPrice, spr.confidence, spr.grade, spr.confidence != null ? spr.confidence / 100 : null, null));
      result.counts.spread++;
    }
  }

  if (!apply) {
    logger(`wnba records DRY-RUN: ${result.eligibleGames} eligible, ${result.withheld.length} withheld, records ML ${result.counts.moneyline}/OU ${result.counts.total}/SPR ${result.counts.spread}`);
    return result;
  }

  // Apply: upsert records; NEVER overwrite a locked record (locked_at != null).
  const { data: existing } = ids.length
    ? await supabase.from("prediction_records").select("game_id, market, locked_at").eq("sport", "wnba").in("game_id", ids)
    : { data: [] as Record<string, unknown>[] };
  const lockedRec = new Set((existing ?? []).filter((r) => r.locked_at != null).map((r) => `${r.game_id}::${r.market}`));
  const toWrite = result.records.filter((r) => !lockedRec.has(`${r.game_id}::${r.market}`));
  result.lockedSkipped = result.records.length - toWrite.length;
  if (toWrite.length) {
    const { error } = await supabase.from("prediction_records").upsert(toWrite, { onConflict: "game_id,market,model_version,slate_date" });
    if (error) errors.push(`prediction_records upsert: ${error.message}`);
    else result.written = toWrite.length;
  }
  logger(`wnba records APPLY: ${result.written} written, ${result.lockedSkipped} locked-skipped`);
  return result;
}
