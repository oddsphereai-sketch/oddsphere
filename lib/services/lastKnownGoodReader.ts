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

// ─── Batched slate-level hydration ─────────────────────────────────────
//
// Single-query helpers that fetch newest non-null values across a whole
// slate. Used by the Daily Edge route to avoid N+1 queries: one pull from
// each history table for every game on the slate.

export type SplitsHistoryHit = {
  game_id: number;
  market_type: "moneyline" | "total" | "spread";
  side: "home" | "away" | "over" | "under";
  public_money_pct: number | null;
  public_money_pct_observed_at: string | null;
  public_betting_pct: number | null;
  public_betting_pct_observed_at: string | null;
};

/**
 * For every (game_id, market_type, side) in the slate, return the newest
 * non-null public_money_pct + public_betting_pct from sharp_signals_history.
 * Each field's observed_at is independent (a history row might be the
 * newest for one but not the other). Result is intended to be merged
 * into the live `sharp_signals` rows at slate-fetch time.
 *
 * Defensive: missing-table error → returns empty array, caller proceeds
 * with no LKG augmentation (no crash, no regression).
 */
export async function loadSplitsHistoryForSlate(
  supabase: SupabaseClient,
  gameIds: number[],
): Promise<SplitsHistoryHit[]> {
  if (gameIds.length === 0) return [];
  const { data, error } = await supabase
    .from("sharp_signals_history")
    .select("game_id, market_type, side, public_money_pct, public_betting_pct, recorded_at")
    .in("game_id", gameIds)
    .order("recorded_at", { ascending: false });
  if (error || data === null) return [];

  type Row = {
    game_id: number;
    market_type: string;
    side: string | null;
    public_money_pct: number | null;
    public_betting_pct: number | null;
    recorded_at: string | null;
  };

  // Group by (game_id, market_type, side); pick newest non-null per field.
  const out = new Map<string, SplitsHistoryHit>();
  for (const r of data as Row[]) {
    if (r.side === null) continue;
    const sideToken = r.side as "home" | "away" | "over" | "under";
    if (sideToken !== "home" && sideToken !== "away" && sideToken !== "over" && sideToken !== "under") continue;
    const mkt = r.market_type as "moneyline" | "total" | "spread";
    if (mkt !== "moneyline" && mkt !== "total" && mkt !== "spread") continue;
    const key = `${r.game_id}::${mkt}::${sideToken}`;
    const existing = out.get(key) ?? {
      game_id: r.game_id,
      market_type: mkt,
      side: sideToken,
      public_money_pct: null,
      public_money_pct_observed_at: null,
      public_betting_pct: null,
      public_betting_pct_observed_at: null,
    };
    if (existing.public_money_pct === null && r.public_money_pct !== null) {
      existing.public_money_pct = r.public_money_pct;
      existing.public_money_pct_observed_at = r.recorded_at;
    }
    if (existing.public_betting_pct === null && r.public_betting_pct !== null) {
      existing.public_betting_pct = r.public_betting_pct;
      existing.public_betting_pct_observed_at = r.recorded_at;
    }
    out.set(key, existing);
  }
  return Array.from(out.values());
}

export type LinesHistoryHit = {
  game_id: number;
  market_type: string;
  side: "home" | "away" | "over" | "under";
  sportsbook: string;
  odds_american: number | null;
  odds_american_observed_at: string | null;
  line_value: number | null;
  line_value_observed_at: string | null;
};

/**
 * Same shape for line_history. One row per (game_id, market_type,
 * sportsbook, side) carrying the newest non-null odds + line_value.
 * Used to hydrate the lines.current snapshot.
 */
export async function loadLinesHistoryForSlate(
  supabase: SupabaseClient,
  gameIds: number[],
): Promise<LinesHistoryHit[]> {
  if (gameIds.length === 0) return [];
  // 2026-06-16 P0 — PER-GAME parallel. A multi-game `.in(game_id) + ORDER BY`
  // degenerates on the bloated line_history table (statement timeout), which
  // contributed to slate-cycle cron overruns + the daily-edge route hang. We
  // only need the NEWEST rows per key, so a per-game DESC + LIMIT is bounded and
  // index-friendly. Errored games are skipped (LKG hydration is best-effort).
  type Row = {
    game_id: number;
    market_type: string;
    sportsbook: string;
    side: string | null;
    line_value: number | null;
    odds_american: number | null;
    recorded_at: string | null;
  };
  const perGame = await Promise.all(
    gameIds.map((gid) =>
      supabase
        .from("line_history")
        .select("game_id, market_type, sportsbook, side, line_value, odds_american, recorded_at")
        .eq("game_id", gid)
        .in("market_type", ["moneyline", "total", "first_inning_total"])
        .is("player_id", null)
        .order("recorded_at", { ascending: false })
        .limit(600)
        .then((r) => (r.data ?? []) as Row[], () => [] as Row[]),
    ),
  );
  const data = perGame.flat();

  const out = new Map<string, LinesHistoryHit>();
  for (const r of data) {
    if (r.side === null) continue;
    const sideToken = r.side as "home" | "away" | "over" | "under";
    if (sideToken !== "home" && sideToken !== "away" && sideToken !== "over" && sideToken !== "under") continue;
    const key = `${r.game_id}::${r.market_type}::${r.sportsbook}::${sideToken}`;
    const existing = out.get(key) ?? {
      game_id: r.game_id,
      market_type: r.market_type,
      side: sideToken,
      sportsbook: r.sportsbook,
      odds_american: null,
      odds_american_observed_at: null,
      line_value: null,
      line_value_observed_at: null,
    };
    if (existing.odds_american === null && r.odds_american !== null) {
      existing.odds_american = r.odds_american;
      existing.odds_american_observed_at = r.recorded_at;
    }
    if (existing.line_value === null && r.line_value !== null) {
      existing.line_value = r.line_value;
      existing.line_value_observed_at = r.recorded_at;
    }
    out.set(key, existing);
  }
  return Array.from(out.values());
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
