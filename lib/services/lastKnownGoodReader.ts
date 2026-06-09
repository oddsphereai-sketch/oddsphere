/**
 * Phase 7I — Last Known Good reader.
 *
 * Single source of truth for the product rule:
 *
 *   "Latest valid data persists until newer valid data replaces it.
 *    'Unavailable' only means we truly never had valid data for that
 *    (game, market, side, field)."
 *
 * Read order per field:
 *   1. Current table (lines / sharp_signals) — newest non-null value
 *   2. History table (line_history / sharp_signals_history) — newest
 *      non-null value across all observations today
 *   3. null — genuinely never received
 *
 * Returns the value + the timestamp we observed it + an is_stale flag
 * (observed_at older than STALE_AGE_MINUTES). The DTO assembler attaches
 * those stamps so the UI can render subtle "Last updated H:MM PM" copy
 * when surfacing a stale-but-valid value.
 *
 * No fabrication. No null replaces a non-null value. Locked-game render
 * still uses the locked snapshot — this helper is for pre-lock and
 * unlocked games.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Stale display threshold for market/odds/splits data. */
export const STALE_AGE_MINUTES = 15;

export type LkgResult<T = number> = {
  value: T | null;
  /** ISO timestamp of when the value was observed. null when value is null. */
  observed_at: string | null;
  /** Source the value came from. null when value is null. */
  source: "current" | "history" | null;
  /** True when value is non-null AND older than STALE_AGE_MINUTES. */
  is_stale: boolean;
};

const NULL_RESULT: LkgResult = {
  value: null,
  observed_at: null,
  source: null,
  is_stale: false,
};

export function isStale(
  observedAtIso: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (observedAtIso === null) return false;
  const t = new Date(observedAtIso).getTime();
  if (!Number.isFinite(t)) return false;
  const ageMin = (nowMs - t) / 60_000;
  return ageMin > STALE_AGE_MINUTES;
}

// ─── Lines (odds_american, line_value) ─────────────────────────────────

type LinesRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
};

type LineHistoryRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  line_value: number | null;
  odds_american: number | null;
  recorded_at: string | null;
};

export type LkgLineOpts = {
  supabase: SupabaseClient;
  gameId: number;
  marketType: "moneyline" | "total" | "spread" | "first_inning_total";
  side: "home" | "away" | "over" | "under";
  field: "odds_american" | "line_value";
  /** Optional book scope. When omitted, returns the newest non-null across all books. */
  sportsbook?: string;
};

export async function getCurrentOrLastKnownLine(opts: LkgLineOpts): Promise<LkgResult> {
  const { supabase, gameId, marketType, side, field, sportsbook } = opts;

  let curQuery = supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american, fetched_at")
    .eq("game_id", gameId)
    .eq("market_type", marketType)
    .eq("side", side)
    .is("player_id", null);
  if (sportsbook !== undefined) curQuery = curQuery.eq("sportsbook", sportsbook);

  const { data: curRows } = await curQuery;
  const bestCurrent = newestNonNull<LinesRow>(curRows as LinesRow[] | null, field, "fetched_at");
  if (bestCurrent !== null) {
    return {
      value: bestCurrent.value,
      observed_at: bestCurrent.at,
      source: "current",
      is_stale: isStale(bestCurrent.at),
    };
  }

  let histQuery = supabase
    .from("line_history")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american, recorded_at")
    .eq("game_id", gameId)
    .eq("market_type", marketType)
    .eq("side", side)
    .is("player_id", null)
    .order("recorded_at", { ascending: false })
    .limit(50);
  if (sportsbook !== undefined) histQuery = histQuery.eq("sportsbook", sportsbook);

  const { data: histRows } = await histQuery;
  const bestHistory = newestNonNull<LineHistoryRow>(histRows as LineHistoryRow[] | null, field, "recorded_at");
  if (bestHistory !== null) {
    return {
      value: bestHistory.value,
      observed_at: bestHistory.at,
      source: "history",
      is_stale: isStale(bestHistory.at),
    };
  }
  return NULL_RESULT;
}

// ─── Sharp signals (public_money_pct, public_betting_pct) ─────────────

type SharpSignalsRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  public_money_pct: number | null;
  public_betting_pct: number | null;
  computed_at: string | null;
};

type SharpSignalsHistoryRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  public_money_pct: number | null;
  public_betting_pct: number | null;
  recorded_at: string | null;
};

export type LkgSplitOpts = {
  supabase: SupabaseClient;
  gameId: number;
  marketType: "moneyline" | "total" | "spread";
  side: "home" | "away" | "over" | "under";
  field: "public_money_pct" | "public_betting_pct";
};

export async function getCurrentOrLastKnownSplit(opts: LkgSplitOpts): Promise<LkgResult> {
  const { supabase, gameId, marketType, side, field } = opts;

  const { data: curRows } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side, public_money_pct, public_betting_pct, computed_at")
    .eq("game_id", gameId)
    .eq("market_type", marketType)
    .eq("side", side);
  const bestCurrent = newestNonNull<SharpSignalsRow>(curRows as SharpSignalsRow[] | null, field, "computed_at");
  if (bestCurrent !== null) {
    return {
      value: bestCurrent.value,
      observed_at: bestCurrent.at,
      source: "current",
      is_stale: isStale(bestCurrent.at),
    };
  }

  // Fallback to sharp_signals_history. v22 migration added this table;
  // when the table doesn't exist yet (older envs), the read errors and
  // we degrade gracefully to null — never raise.
  try {
    const { data: histRows, error } = await supabase
      .from("sharp_signals_history")
      .select("game_id, market_type, side, public_money_pct, public_betting_pct, recorded_at")
      .eq("game_id", gameId)
      .eq("market_type", marketType)
      .eq("side", side)
      .order("recorded_at", { ascending: false })
      .limit(50);
    if (error) return NULL_RESULT;
    const bestHistory = newestNonNull<SharpSignalsHistoryRow>(
      histRows as SharpSignalsHistoryRow[] | null,
      field,
      "recorded_at",
    );
    if (bestHistory !== null) {
      return {
        value: bestHistory.value,
        observed_at: bestHistory.at,
        source: "history",
        is_stale: isStale(bestHistory.at),
      };
    }
  } catch {
    return NULL_RESULT;
  }
  return NULL_RESULT;
}

// ─── Internal: pick newest non-null value across a set of rows ─────────

function newestNonNull<T extends Record<string, unknown>>(
  rows: T[] | null,
  field: string,
  timeField: string,
): { value: number; at: string } | null {
  if (rows === null || rows.length === 0) return null;
  let best: { value: number; at: string } | null = null;
  for (const r of rows) {
    const v = r[field];
    if (v === null || v === undefined || typeof v !== "number") continue;
    const at = r[timeField];
    if (at === null || at === undefined || typeof at !== "string") continue;
    if (best === null || at > best.at) best = { value: v, at };
  }
  return best;
}
