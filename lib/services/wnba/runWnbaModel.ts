/**
 * WNBA Phase 2 — Stage 1c: DB-backed model run (2026-06-23).
 *
 * Reads scheduled WNBA games + odds FROM THE DB (written by seedWnbaGames +
 * refreshWnbaLines), runs the single-sourced validated model (computeWnbaPrediction
 * — Elo+Platt independent, market as calibrator, sharp-preferred decision layer,
 * modal displayed line, cold-start), and upserts `game_predictions` (ML/O/U + spread
 * in sport_specific, full audit). Locked rows (locked_at != null) are NEVER
 * overwritten; pre-lock rows update. Elo comes from getModel (BDL history, cached).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToSlate, currentSlateDate } from "../../dates/slateDate";
import { getModel, computeWnbaPrediction, SHARP_BOOKS, type OddRow, type WnbaPublicMarketSignals } from "./buildWnbaDailyEdgePreview";
import {
  assertWnbaChampionRuntime,
  EXPECTED_WNBA_DISTRIBUTION_VERSION,
  EXPECTED_WNBA_MODEL_VERSION,
} from "../../automodel/wnbaChampionRuntime";

// DB market_type → the SharpAPI-style key computeWnbaPrediction expects.
const MKT_TO_MODEL: Record<string, string> = { moneyline: "moneyline", spread: "point_spread", total: "total_points" };
const LOCK_WINDOW_MS = 60 * 60 * 1000;

function isBeforeLockWindow(gameDate: unknown, nowMs: number): boolean {
  if (typeof gameDate !== "string") return false;
  const startMs = Date.parse(gameDate);
  return Number.isFinite(startMs) && startMs - nowMs > LOCK_WINDOW_MS;
}

export type RunWnbaModelResult = {
  apply: boolean;
  gamesScheduled: number;
  gamesWithOdds: number;
  gamesPredicted: number;
  skippedLocked: number;
  written: number;
  missingMarkets: Array<{ matchup: string; missing: string[] }>;
  predictions: Array<{
    matchup: string; ml: string; ou: string | null; spread: string | null;
    grades: string; books: number; trusted: number; consensus: string;
    proj: string; coldStart: boolean; flags: string[];
  }>;
  errors: string[];
};

export async function runWnbaModel(opts: {
  supabase: SupabaseClient;
  apply: boolean;
  windowDays?: number;
  logger?: (m: string) => void;
}): Promise<RunWnbaModelResult> {
  const { supabase, apply, windowDays = 3, logger = () => {} } = opts;
  if (apply) assertWnbaChampionRuntime();
  const errors: string[] = [];
  const M = await getModel();

  const today = currentSlateDate("wnba");
  const end = addDaysToSlate(today, windowDays);
  const { data: gameRows } = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, home_team_id, away_team_id")
    .eq("sport", "wnba").eq("status", "scheduled").gte("slate_date", today).lte("slate_date", end);
  const nowMs = Date.now();
  const games = (gameRows ?? []).filter((g) => isBeforeLockWindow(g.game_date, nowMs));

  const { data: teamRows } = await supabase.from("teams").select("id, external_id").eq("sport", "wnba");
  const bdlByTeamId = new Map<number, number>();
  for (const t of teamRows ?? []) bdlByTeamId.set(t.id as number, t.external_id as number);

  const gameIds = games.map((g) => g.id as number);
  const { data: lineRows } = gameIds.length
    ? await supabase.from("lines").select("game_id, market_type, side, sportsbook, line_value, odds_american").in("game_id", gameIds).is("player_id", null)
    : { data: [] as Record<string, unknown>[] };
  const { data: historyRows } = gameIds.length
    ? await supabase
        .from("line_history")
        .select("game_id, market_type, side, sportsbook, line_value, odds_american, recorded_at")
        .in("game_id", gameIds)
        .in("market_type", ["moneyline", "total", "spread"])
        .not("odds_american", "is", null)
        .order("recorded_at", { ascending: false })
    : { data: [] as Record<string, unknown>[] };
  const { data: publicSignalRows } = gameIds.length
    ? await supabase
        .from("sharp_signals")
        .select("game_id, market_type, side, public_betting_pct, public_money_pct")
        .in("game_id", gameIds)
        .in("market_type", ["moneyline", "total", "spread"])
    : { data: [] as Record<string, unknown>[] };
  const linesByGame = new Map<number, Record<string, unknown>[]>();
  for (const l of lineRows ?? []) {
    const gid = l.game_id as number;
    if (!linesByGame.has(gid)) linesByGame.set(gid, []);
    linesByGame.get(gid)!.push(l);
  }
  const historyByGame = new Map<number, Record<string, unknown>[]>();
  const seenHistory = new Set<string>();
  for (const h of historyRows ?? []) {
    const gid = h.game_id as number;
    const key = `${gid}::${h.market_type}::${h.side}::${h.line_value ?? ""}::${h.sportsbook ?? ""}`;
    if (seenHistory.has(key)) continue;
    seenHistory.add(key);
    if (!historyByGame.has(gid)) historyByGame.set(gid, []);
    historyByGame.get(gid)!.push(h);
  }

  const hydrateLineOnlyRows = (gid: number, currentRows: Record<string, unknown>[]): Record<string, unknown>[] => {
    const hydrated = [...currentRows];
    const hasPricedExact = new Set(
      currentRows
        .filter((r) => r.odds_american !== null && r.odds_american !== undefined)
        .map((r) => `${r.market_type}::${r.side}::${r.line_value ?? ""}`)
    );
    const needsPrice = new Set(
      currentRows
        .filter((r) => r.odds_american === null || r.odds_american === undefined)
        .map((r) => `${r.market_type}::${r.side}::${r.line_value ?? ""}`)
    );
    for (const h of historyByGame.get(gid) ?? []) {
      const k = `${h.market_type}::${h.side}::${h.line_value ?? ""}`;
      if (!needsPrice.has(k) || hasPricedExact.has(k)) continue;
      hydrated.push(h);
    }
    return hydrated;
  };

  const publicByGame = new Map<number, WnbaPublicMarketSignals>();
  for (const s of publicSignalRows ?? []) {
    const gid = s.game_id as number;
    const market = s.market_type as "moneyline" | "total" | "spread";
    const side = s.side as string;
    if (!publicByGame.has(gid)) publicByGame.set(gid, {});
    const byMarket = publicByGame.get(gid)!;
    byMarket[market] = {
      ...(byMarket[market] ?? {}),
      [side]: {
        public_betting_pct: s.public_betting_pct as number | null,
        public_money_pct: s.public_money_pct as number | null,
      },
    };
  }

  // Locked-row guard: never overwrite a game_predictions row that's already locked.
  const { data: lockedRows } = gameIds.length
    ? await supabase.from("game_predictions").select("game_id, locked_at").in("game_id", gameIds)
    : { data: [] as Record<string, unknown>[] };
  const lockedSet = new Set((lockedRows ?? []).filter((r) => r.locked_at != null).map((r) => r.game_id as number));

  const computedAt = new Date().toISOString();
  const payloads: Record<string, unknown>[] = [];
  const result: RunWnbaModelResult = {
    apply, gamesScheduled: games.length, gamesWithOdds: 0, gamesPredicted: 0, skippedLocked: 0,
    written: 0, missingMarkets: [], predictions: [], errors,
  };

  for (const g of games) {
    const homeBdl = bdlByTeamId.get(g.home_team_id as number), awayBdl = bdlByTeamId.get(g.away_team_id as number);
    if (!homeBdl || !awayBdl) continue;
    const dbLines = hydrateLineOnlyRows(g.id as number, linesByGame.get(g.id as number) ?? []);
    if (!dbLines.length) continue;
    result.gamesWithOdds++;

    const oddRows: OddRow[] = dbLines.map((l) => ({
      book: l.sportsbook as string, sharp: SHARP_BOOKS.has(l.sportsbook as string),
      mkt: MKT_TO_MODEL[l.market_type as string] ?? (l.market_type as string), selType: l.side as string,
      odds: l.odds_american as number | null, line: l.line_value as number | null,
      date: g.slate_date as string, h: homeBdl, a: awayBdl,
    }));
    const p = computeWnbaPrediction(M, { id: g.id as number, date: g.slate_date as string, h: homeBdl, a: awayBdl }, oddRows, publicByGame.get(g.id as number) ?? {});
    result.gamesPredicted++;
    const matchup = `${p.away_abbr}@${p.home_abbr}`;

    const missing: string[] = [];
    if (!p.moneyline.side) missing.push("ml");
    if (!p.total.side) missing.push("total");
    if (!p.spread.side) missing.push("spread");
    if (missing.length) result.missingMarkets.push({ matchup, missing });

    result.predictions.push({
      matchup,
      ml: `${p.moneyline.side} ${p.moneyline.confidence}% (${p.moneyline.grade})`,
      ou: p.total.side ? `${p.total.side} ${p.total.confidence}% (${p.total.grade})` : null,
      spread: p.spread.side ? `${p.spread.side} ${p.spread.confidence}% (${p.spread.grade})` : null,
      grades: `${p.moneyline.grade}/${p.total.grade ?? "—"}/${p.spread.grade ?? "—"}`,
      books: p.data_quality.ml_books, trusted: p.data_quality.trusted_books, consensus: p.consensus_source,
      proj: `${p.projected_score.away}-${p.projected_score.home}`, coldStart: !!p.cold_start, flags: p.data_quality.flags,
    });

    if (lockedSet.has(g.id as number)) { result.skippedLocked++; continue; }

    payloads.push({
      game_id: g.id, prediction_source: "auto_v1_wnba", source_type: "real_api", is_override: false,
      model_version: EXPECTED_WNBA_MODEL_VERSION, computed_at: computedAt,
      predicted_ml_winner: p.moneyline.side === p.home ? "home" : "away",
      ml_confidence: p.moneyline.confidence,
      predicted_ou_side: p.total.side ? (p.total.side.startsWith("Over") ? "over" : "under") : null,
      ou_confidence: p.total.confidence,
      predicted_home_score: p.projected_score.home, predicted_away_score: p.projected_score.away, predicted_total: Math.round((p.projected_score.home + p.projected_score.away) * 10) / 10,
      // Grades live in sport_specific (avoid any CHECK constraint on the MLB-shaped grade columns).
      sport_specific: {
        model_version: EXPECTED_WNBA_MODEL_VERSION,
        distribution_version: EXPECTED_WNBA_DISTRIBUTION_VERSION,
        model: p.model, market: p.market, trusted: p.trusted, sharp: p.sharp,
        consensus_source: p.consensus_source, dynamic_market_weight: p.dynamic_market_weight,
        cold_start: p.cold_start, data_quality: p.data_quality,
        wnba_core_model_calibration: p.wnba_core_model_calibration,
        public_market_context: p.public_market_context,
        moneyline: { side: p.moneyline.side, confidence: p.moneyline.confidence, grade: p.moneyline.grade, price: p.moneyline.price },
        total: { side: p.total.side, line: p.total.line, confidence: p.total.confidence, grade: p.total.grade },
        spread: { side: p.spread.side, line: p.spread.line, confidence: p.spread.confidence, grade: p.spread.grade },
        projected_score: p.projected_score,
      },
    });
  }

  if (!apply) {
    logger(`runWnbaModel DRY-RUN: ${result.gamesPredicted} predicted, ${result.skippedLocked} locked-skipped, ${payloads.length} would write`);
    return result;
  }

  if (payloads.length) {
    const { error } = await supabase.from("game_predictions").upsert(payloads, { onConflict: "game_id" });
    if (error) errors.push(`game_predictions upsert: ${error.message}`);
    else result.written = payloads.length;
  }
  logger(`runWnbaModel APPLY: ${result.written} written, ${result.skippedLocked} locked-skipped`);
  return result;
}
