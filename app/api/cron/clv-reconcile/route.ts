/**
 * GET /api/cron/clv-reconcile?sport=mlb&date=YYYY-MM-DD[&dryRun=true]
 *
 * Post-game CLV reconcile: for each LOCKED prediction on a started/finished
 * game, approximate the closing line (last trusted pre-start tick for the
 * picked side from line_history) and write the ADDITIVE CLV columns
 * (bet_odds_american / closing_odds_american / clv_pct / beat_closing_line) to
 * game_predictions + mirror to prediction_records.
 *
 * Safety:
 *   • CRON_SECRET Bearer auth.
 *   • Gated OFF by default — writes require CLV_RECONCILE_ACTIVE=true. Without
 *     it (or with ?dryRun=true) the route computes + reports but writes nothing.
 *   • Touches ONLY the additive CLV columns — never picks/grades/confidences,
 *     never any non-CLV field on a locked row.
 */

import { supabase } from "@/lib/db/supabase";
import { validateCronAuth } from "@/lib/cron/auth";
import { currentSlateDate, isSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";
import {
  pickClosingLine,
  computeClvUpdate,
  type HistoryTick,
  type ClvRecord,
} from "@/lib/services/clvReconcile";

export const maxDuration = 60;

const MARKET_TO_HISTORY: Record<string, string> = {
  moneyline: "moneyline",
  total: "total",
  first_inning: "first_inning_total",
};

export async function GET(request: Request): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const sportParam = url.searchParams.get("sport") ?? "mlb";
  const dateParam = url.searchParams.get("date");
  const sport = sportParam as Sport;
  const date = isSlateDate(dateParam) ? (dateParam as string) : currentSlateDate(sport);
  const active = process.env.CLV_RECONCILE_ACTIVE === "true";
  const dryRun = !active || url.searchParams.get("dryRun") === "true";
  const nowMs = Date.now();

  // Locked predictions on this slate whose game has started/finished.
  const { data: recsData, error: recsErr } = await supabase
    .from("prediction_records")
    .select("game_prediction_id, game_id, market, pick, side, odds_american, locked_at, games!inner ( game_date, sport, slate_date )")
    .eq("sport", sport)
    .eq("slate_date", date)
    .not("locked_at", "is", null);
  if (recsErr) {
    return Response.json({ ok: false, error: recsErr.message }, { status: 500 });
  }
  type Rec = {
    game_prediction_id: number; game_id: number; market: string;
    pick: string | null; side: string | null; odds_american: number | null;
    games: { game_date: string };
  };
  const recs = ((recsData ?? []) as unknown as Rec[]).filter(
    (r) => Date.parse(r.games.game_date) < nowMs, // started/finished only
  );
  if (recs.length === 0) {
    return Response.json({ ok: true, sport, date, dryRun, scanned: 0, updated: 0, reason: "no started locked predictions" });
  }

  // Posted ("First Published") prices, when present, are the preferred bet price.
  const gpIds = [...new Set(recs.map((r) => r.game_prediction_id))];
  const { data: gpData } = await supabase
    .from("game_predictions")
    .select("id, sport_specific")
    .in("id", gpIds);
  const postedById = new Map<number, Record<string, { american?: number }>>();
  for (const g of ((gpData ?? []) as Array<{ id: number; sport_specific: Record<string, unknown> | null }>)) {
    const pl = g.sport_specific?.posted_lines;
    if (pl !== null && typeof pl === "object") postedById.set(g.id, pl as Record<string, { american?: number }>);
  }

  // line_history for the picked sides → closing approximation.
  //
  // PAGINATE past the Supabase 1000-row cap: a single slate's line_history runs
  // to tens of thousands of rows (hundreds per game × markets × books). An
  // un-paginated .in() silently truncates → most games would resolve null
  // closing. Chunk by game + range-paginate.
  type LhRow = { game_id: number; market_type: string; side: string | null; sportsbook: string; odds_american: number | null; recorded_at: string };
  const gameIds = [...new Set(recs.map((r) => r.game_id))];
  const lhByKey = new Map<string, HistoryTick[]>();
  for (let i = 0; i < gameIds.length; i += 30) {
    const chunk = gameIds.slice(i, i + 30);
    let from = 0;
    for (;;) {
      const { data: page } = await supabase
        .from("line_history")
        .select("game_id, market_type, side, sportsbook, odds_american, recorded_at")
        .in("game_id", chunk)
        .range(from, from + 999);
      const rows = (page ?? []) as LhRow[];
      for (const r of rows) {
        if (r.side === null) continue;
        const key = `${r.game_id}::${r.market_type}::${r.side}`;
        (lhByKey.get(key) ?? lhByKey.set(key, []).get(key)!).push({ sportsbook: r.sportsbook, odds_american: r.odds_american, recorded_at: r.recorded_at });
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
  }

  let updated = 0;
  const samples: unknown[] = [];
  for (const r of recs) {
    const side = r.side ?? mapFiSide(r.market, r.pick);
    if (side === null) continue;
    const histMarket = MARKET_TO_HISTORY[r.market] ?? r.market;
    const closing = pickClosingLine(lhByKey.get(`${r.game_id}::${histMarket}::${side}`) ?? [], Date.parse(r.games.game_date));
    const posted = postedById.get(r.game_prediction_id)?.[r.market]?.american ?? null;
    const record: ClvRecord = {
      gamePredictionId: r.game_prediction_id,
      gameId: r.game_id,
      market: r.market,
      betAmerican: posted ?? r.odds_american,
    };
    const update = computeClvUpdate(record, closing);
    if (update === null) continue;
    updated += 1;
    if (samples.length < 8) samples.push(update);
    if (!dryRun) {
      // Additive CLV columns only — never picks/grades.
      await supabase
        .from("game_predictions")
        .update({
          bet_odds_american: update.bet_odds_american,
          closing_odds_american: update.closing_odds_american,
          clv_pct: update.clv_pct,
          beat_closing_line: update.beat_closing_line,
        })
        .eq("id", update.gamePredictionId);
      await supabase
        .from("prediction_records")
        .update({
          bet_odds_american: update.bet_odds_american,
          closing_odds_american: update.closing_odds_american,
          clv_pct: update.clv_pct,
          beat_closing_line: update.beat_closing_line,
        })
        .eq("game_id", update.gameId)
        .eq("market", update.market)
        .eq("slate_date", date);
    }
  }

  return Response.json({ ok: true, sport, date, dryRun, active, scanned: recs.length, updated, samples });
}

/** FI pick → first_inning_total side ("NRFI"→under, "YRFI"→over). */
function mapFiSide(market: string, pick: string | null): string | null {
  if (market !== "first_inning") return null;
  if (pick === "NRFI") return "under";
  if (pick === "YRFI") return "over";
  return pick === "over" || pick === "under" ? pick : null;
}
