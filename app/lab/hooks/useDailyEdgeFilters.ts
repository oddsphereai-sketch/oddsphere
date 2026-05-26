"use client";

/**
 * useDailyEdgeFilters — URL-driven filter + sort state for the Daily Edge page.
 *
 * Persists the active filter chip set + sort key in the URL so:
 *   • Filter state survives a page reload
 *   • Members can share direct links: /lab/daily-edge?filter=best_signals,unders&sort=signal_strength
 *   • Browser back/forward replays state via the normal history mechanism
 *
 * URL contract:
 *   • Filters: comma-separated value set in `?filter=...`. Empty / missing
 *     means no filter (show all).
 *   • Sort: single string in `?sort=...`. Missing or "start_time" omits the
 *     param so the default URL stays clean.
 *
 * Filter chip semantics (V2.1 Part 11 + 6.4d founder hybrid decision):
 *   • Grade chips (8 keys): OR within group. "All" clears the group.
 *   • Market chips (Moneyline / Totals / 1st Inning): card-filter against
 *     DailyEdgeGameDto.primaryMarket — surfaced server-side via the same
 *     precedence (ML → OU → NRFI) marketSignalDerivationService uses.
 *   • Side sub-group Overs / Unders: filter by predictions.total.pick value.
 *   • Side sub-group NRFI / YRFI: filter by predictions.nrfi.pick value.
 *   • Across groups: AND.
 *
 * Sort options per V2.1:
 *   • start_time (default) — ascending gameStartMinutes
 *   • signal_strength — ascending grade rank (best_signal first), ML
 *                       confidence tiebreaker
 *   • confidence — descending ML confidence
 */

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Grade } from "@/lib/types/domain/Grade";
import type { DailyEdgeGameDto } from "../lib/labTypes";
import {
  headlineGrade,
  headlinePrimaryMarket,
} from "../lib/perPickHeadline";

// ─── Filter / sort vocabulary ─────────────────────────────────────────────

export type DailyEdgeSortKey =
  | "start_time"
  | "signal_strength"
  | "confidence";

export const SORT_KEYS: readonly DailyEdgeSortKey[] = [
  "start_time",
  "signal_strength",
  "confidence",
];
export const DEFAULT_SORT: DailyEdgeSortKey = "start_time";

export type GradeFilter =
  | "best_signal"
  | "sharp_confirmed"
  | "market_led"
  | "model_only"
  | "market_watch"
  | "public_smoke"
  | "sharp_conflict";

export type MarketFilter = "moneyline" | "totals" | "first_inning";
export type SideFilter = "nrfi" | "yrfi" | "overs" | "unders";

export type FilterKey = GradeFilter | MarketFilter | SideFilter;

export const GRADE_FILTER_KEYS: readonly GradeFilter[] = [
  "best_signal",
  "sharp_confirmed",
  "market_led",
  "model_only",
  "market_watch",
  "public_smoke",
  "sharp_conflict",
];
export const MARKET_FILTER_KEYS: readonly MarketFilter[] = [
  "moneyline",
  "totals",
  "first_inning",
];
export const SIDE_FILTER_KEYS: readonly SideFilter[] = [
  "nrfi",
  "yrfi",
  "overs",
  "unders",
];
const ALL_FILTER_KEYS: readonly FilterKey[] = [
  ...GRADE_FILTER_KEYS,
  ...MARKET_FILTER_KEYS,
  ...SIDE_FILTER_KEYS,
];

function isFilterKey(k: string): k is FilterKey {
  return (ALL_FILTER_KEYS as readonly string[]).includes(k);
}

function isSortKey(k: string): k is DailyEdgeSortKey {
  return (SORT_KEYS as readonly string[]).includes(k);
}

// ─── State ────────────────────────────────────────────────────────────────

export type DailyEdgeFilterState = {
  filters: Set<FilterKey>;
  sort: DailyEdgeSortKey;
};

function parseFromUrl(searchParams: URLSearchParams): DailyEdgeFilterState {
  const filters = new Set<FilterKey>();
  const raw = searchParams.get("filter") ?? "";
  for (const part of raw.split(",")) {
    const key = part.trim();
    if (key && isFilterKey(key)) filters.add(key);
  }
  const sortRaw = searchParams.get("sort") ?? "";
  const sort: DailyEdgeSortKey = isSortKey(sortRaw) ? sortRaw : DEFAULT_SORT;
  return { filters, sort };
}

function serializeToUrl(
  state: DailyEdgeFilterState,
  existing: URLSearchParams
): URLSearchParams {
  const next = new URLSearchParams(existing);
  // Always strip our own params first, then re-add only the non-default
  // ones — keeps the URL clean when state returns to defaults.
  next.delete("filter");
  next.delete("sort");
  if (state.filters.size > 0) {
    next.set("filter", Array.from(state.filters).join(","));
  }
  if (state.sort !== DEFAULT_SORT) {
    next.set("sort", state.sort);
  }
  return next;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useDailyEdgeFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parseFromUrl(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  const updateUrl = useCallback(
    (nextState: DailyEdgeFilterState) => {
      const params = serializeToUrl(
        nextState,
        new URLSearchParams(searchParams.toString())
      );
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams]
  );

  const toggleFilter = useCallback(
    (key: FilterKey) => {
      const next = new Set(state.filters);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      updateUrl({ filters: next, sort: state.sort });
    },
    [state, updateUrl]
  );

  const clearGradeFilters = useCallback(() => {
    const next = new Set(state.filters);
    for (const g of GRADE_FILTER_KEYS) next.delete(g);
    updateUrl({ filters: next, sort: state.sort });
  }, [state, updateUrl]);

  const setSort = useCallback(
    (sort: DailyEdgeSortKey) => {
      updateUrl({ filters: state.filters, sort });
    },
    [state.filters, updateUrl]
  );

  return {
    filters: state.filters,
    sort: state.sort,
    toggleFilter,
    clearGradeFilters,
    setSort,
  };
}

// ─── Pure transform ───────────────────────────────────────────────────────

const GRADE_RANK: Record<Grade, number> = {
  best_signal: 0,
  sharp_confirmed: 1,
  market_led: 2,
  model_only: 3,
  market_watch: 4,
  public_smoke: 5,
  sharp_conflict: 6,
};

/**
 * Sort rank for the headline grade. Null = no model pick on any market;
 * those games sort LAST per Fix 1.3 Flag F1 (rank below sharp_conflict).
 *
 * Note: this rank order treats sharp_conflict as low-strength signal
 * (rank 6), but perPickHeadline.GRADE_RANK places sharp_conflict at
 * rank 50 (above market_led=40) for headline prominence. The discrepancy
 * is pre-existing and intentional — sort by "signal strength" puts caution
 * last; headline selection puts caution prominently so members see it.
 * If a future fix unifies the two rank tables, null-grade handling moves
 * with it.
 */
function gradeSortRank(g: Grade | null): number {
  if (g === null) return Number.POSITIVE_INFINITY;
  return GRADE_RANK[g];
}

function gradeFromGame(g: DailyEdgeGameDto): Grade | null {
  // Headline grade for SORT — strongest per-pick grade across ML/OU/NRFI
  // (perPickHeadline.headlineGrade). Fix 1.3 (Gap-21): returns Grade | null
  // — null when the model didn't pick any market. Sort path treats null
  // as worst-rank so no-pick games surface at the end.
  return headlineGrade(g);
}

/**
 * V2.1.1 per-pick filter predicate (Phase 6.3.5d core).
 *
 * Returns the non-null per-pick grades on the game across ml/total/nrfi.
 * Used by the Grade filter chip predicate so a chip matches whenever ANY
 * pick on the card carries the grade — not just the row's primary pick.
 * Pre-6.3.5d the filter matched on g.grade (row-level legacy), which
 * collapsed nuance: a card with sharp_confirmed on the total but
 * market_watch on the ML wouldn't match a "Sharp Confirmed" filter
 * because the row's headline was market_watch.
 */
function gamePickGrades(g: DailyEdgeGameDto): Grade[] {
  const out: Grade[] = [];
  if (g.predictions.ml.grade !== null) out.push(g.predictions.ml.grade);
  if (g.predictions.total.grade !== null) out.push(g.predictions.total.grade);
  if (g.predictions.nrfi.grade !== null) out.push(g.predictions.nrfi.grade);
  return out;
}

function gamePassesFilters(
  g: DailyEdgeGameDto,
  filters: Set<FilterKey>
): boolean {
  // ── Grade group — match when ANY pick has the grade (V2.1.1 / 6.3.5d) ──
  const gradeActive = GRADE_FILTER_KEYS.filter((k) => filters.has(k));
  if (gradeActive.length > 0) {
    const pickGrades = gamePickGrades(g);
    const matched = pickGrades.some((pg) =>
      (gradeActive as string[]).includes(pg)
    );
    if (!matched) return false;
  }

  // ── Market group — OR within. 6.3.5e: derives primary market client-
  // side from per-pick grades (headlinePrimaryMarket) instead of reading
  // the dropped g.primaryMarket DTO field. Same ML → OU → NRFI precedence.
  const marketActive = MARKET_FILTER_KEYS.filter((k) => filters.has(k));
  if (marketActive.length > 0) {
    const market = headlinePrimaryMarket(g);
    if (market === null) return false;
    let matched = false;
    for (const m of marketActive) {
      if (m === "moneyline" && market === "moneyline") matched = true;
      else if (m === "totals" && market === "total") matched = true;
      else if (m === "first_inning" && market === "first_inning_total") {
        matched = true;
      }
    }
    if (!matched) return false;
  }

  // ── Totals side sub-group — OR within. Filters by predictions.total.pick
  // value regardless of primaryMarket (per 6.4d Daniel clarification: side
  // chips filter by pick value across all cards, not narrowed to primary). ─
  const totalsSide = (["overs", "unders"] as const).filter((k) =>
    filters.has(k)
  );
  if (totalsSide.length > 0) {
    // Set<string> rather than Set<"Over" | "Under"> because the DTO types
    // predictions.total.pick as plain string — keep the .has() check loose.
    const wants = new Set<string>(
      totalsSide.map((s) => (s === "overs" ? "Over" : "Under"))
    );
    if (!wants.has(g.predictions.total.pick)) return false;
  }

  // ── 1st-inning side sub-group — OR within. Filters by predictions.nrfi.pick. ──
  const innSide = (["nrfi", "yrfi"] as const).filter((k) => filters.has(k));
  if (innSide.length > 0) {
    const wants = new Set<string>(innSide.map((s) => s.toUpperCase()));
    if (!wants.has(g.predictions.nrfi.pick)) return false;
  }

  return true;
}

function sortGames(
  games: DailyEdgeGameDto[],
  sort: DailyEdgeSortKey
): DailyEdgeGameDto[] {
  const sorted = [...games];
  if (sort === "start_time") {
    sorted.sort((a, b) => a.gameStartMinutes - b.gameStartMinutes);
  } else if (sort === "signal_strength") {
    sorted.sort((a, b) => {
      const aR = gradeSortRank(gradeFromGame(a));
      const bR = gradeSortRank(gradeFromGame(b));
      if (aR !== bR) return aR - bR;
      return b.predictions.ml.confidence - a.predictions.ml.confidence;
    });
  } else {
    // confidence — descending ML confidence
    sorted.sort(
      (a, b) => b.predictions.ml.confidence - a.predictions.ml.confidence
    );
  }
  return sorted;
}

/**
 * Pure transform: filter + sort the games array per the current state.
 * Used by DailyEdgeView to drive Board / TopReads / cards list in lockstep.
 */
export function applyFilterAndSort(
  games: DailyEdgeGameDto[],
  state: DailyEdgeFilterState
): DailyEdgeGameDto[] {
  const filtered =
    state.filters.size === 0
      ? games
      : games.filter((g) => gamePassesFilters(g, state.filters));
  return sortGames(filtered, state.sort);
}
