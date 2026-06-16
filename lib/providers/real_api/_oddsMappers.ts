/**
 * Pure SharpAPI value mappers — extracted (2026-06-16) from
 * SharpAPIOddsProvider.ts so BOTH the REST provider and the new WebSocket
 * adapter (lib/providers/real_api/ws/sharpApiWsAdapter.ts) share one source
 * of truth for market/side/sportsbook normalization. This module is PURE
 * (no fetch, no DB, no env, no Next) so it is safe to import from the
 * standalone streaming worker without pulling in the HTTP client.
 *
 * SharpAPIOddsProvider.ts re-exports every symbol here unchanged, so all
 * existing importers keep working with no behavior change.
 */

import type { MarketType, Side, Sportsbook } from "../../types/domain/Lines";

export function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

/**
 * Map SharpAPI market_type strings to our internal MarketType union.
 *
 * Phase 1.5 correction (Task #162): SharpAPI returns specific names
 * observed in the live data:
 *   - "moneyline" / "h2h"          → moneyline
 *   - "total_runs" / "total"       → total
 *   - "run_line" / "runline"       → spread
 *   - "first_inning_total"         → first_inning_total (true 1-inning O/U)
 *
 * Intentionally NOT mapped:
 *   - "1st_5_innings_total_runs" / "f5" — that's the FIRST 5 INNINGS market,
 *     not the first inning. Different market; would mis-grade NRFI picks.
 *   - team_total, player props, alternate lines, futures, championships →
 *     return null; caller drops the row.
 */
export function mapMarketType(raw: string | null): MarketType | null {
  if (raw === null) return null;
  const v = raw.toLowerCase().trim();
  if (v === "h2h" || v === "moneyline" || v === "ml") return "moneyline";
  if (v === "total" || v === "totals" || v === "total_runs" || v === "over_under" || v === "ou") {
    return "total";
  }
  if (v === "spread" || v === "spreads" || v === "runline" || v === "run_line") {
    return "spread";
  }
  // R-16F-C — accept SharpAPI's live emission "1st_inning_total_runs"
  // alongside the previously-recognized short forms. SharpAPI's /odds
  // endpoint returns the long form per audit; the short forms are kept
  // for back-compat / defensive coverage.
  //
  // Intentionally NOT mapped to first_inning_total:
  //   - "1st_inning_moneyline_3-way" — a 3-way ML at the END of the 1st
  //     (home/away/tie). Different market than NRFI/YRFI.
  //   - "1st_3_innings_total_runs" / "1st_5_innings_total_runs" — F3/F5
  //     totals; different windows than first-inning. Would mis-grade
  //     NRFI picks.
  if (
    v === "first_inning_total" ||
    v === "1st_inning_total" ||
    v === "1st_inning_total_runs"
  ) {
    return "first_inning_total";
  }
  return null;
}

export function mapSportsbook(raw: string | null): Sportsbook | null {
  const s = asStringOrNull(raw);
  if (s === null) return null;
  return s.toLowerCase() as Sportsbook;
}

/**
 * Map SharpAPI's `selection_type` field directly to our Side enum.
 * Phase 1.5 (Task #162): /odds rows include selection_type as a clean
 * enum-like field ("home" / "away" / "over" / "under" / "yes" / "no"),
 * eliminating the need for team-string parsing. Returns null when the
 * value isn't recognized — caller skips the row.
 */
export function mapSide(rawSelectionType: unknown): Side | null {
  const s = asStringOrNull(rawSelectionType);
  if (s === null) return null;
  const v = s.toLowerCase();
  if (
    v === "home" ||
    v === "away" ||
    v === "over" ||
    v === "under" ||
    v === "yes" ||
    v === "no"
  ) {
    return v;
  }
  return null;
}
