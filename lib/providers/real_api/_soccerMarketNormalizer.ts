/**
 * Soccer (WC) market normalizer — WC-2.
 *
 * Pure module. No DB. No HTTP. Caller-supplies raw provider rows; this
 * module emits canonical normalized records keyed by the four WC-1
 * official launch markets:
 *
 *   match_result  | double_chance | total | btts
 *
 * Why a single normalizer for both providers:
 *   BDL and SharpAPI use different field shapes, market_type strings,
 *   and selection labels for the same underlying market. A single source
 *   of truth for "what counts as match_result" prevents the writers,
 *   reconciler, and auditor from drifting apart.
 *
 * Hard rule: unsupported markets (point_spread, draw_no_bet,
 * team_total_*, total_cards, anytime_goal_scorer, etc.) MUST return null.
 * The whitelist enforced by `normalizeSoccerMarket` is the public-tracking
 * contract from [[project-wc-launch-contract]] — never widen it without a
 * deliberate product decision.
 *
 * Selection canonicalization:
 *   match_result:  "home" | "draw" | "away"
 *   double_chance: "home_or_draw" | "away_or_draw" | "home_or_away"
 *   total:         "over" | "under"
 *   btts:          "yes" | "no"
 *
 * ──────────────────────────────────────────────────────────────────────
 * WC MODEL STANDARD — scope boundary for this file (2026-06-11).
 * See [[project-wc-model-standard]] for the binding contract.
 *
 * This module deliberately does ZERO model work. It normalizes shapes;
 * the WC-3 writer is responsible for:
 *   • producing its OWN model probabilities from soccer-native inputs
 *     before consulting market lines;
 *   • comparing model_prob vs market_implied_prob vs de-vigged market;
 *   • applying conservative confidence caps from soccerGrading.ts;
 *   • emitting hold/no-play when market data is missing/stale/thin.
 *
 * The normalizer must NOT short-circuit any of that by stamping a row
 * "best", "sharp-supported", or "high confidence" based on odds alone.
 * Provenance fields (provider, provider_endpoint, fetched_at) flow
 * through unchanged so the WC-5 auditor can answer the binding questions
 * about which data drove which pick.
 * ──────────────────────────────────────────────────────────────────────
 */

import type { TrackedMarketV17 } from "@/lib/types/domain/Tracking";

/** Whitelist of WC-1 official launch tracked markets. */
export const OFFICIAL_SOCCER_MARKETS = ["match_result", "double_chance", "total", "btts"] as const;
export type OfficialSoccerMarket = (typeof OFFICIAL_SOCCER_MARKETS)[number];

/** Compile-time guarantee that OfficialSoccerMarket is a subset of TrackedMarketV17. */
const _trackedMarketSubset: ReadonlyArray<TrackedMarketV17> = OFFICIAL_SOCCER_MARKETS;
void _trackedMarketSubset;

export type MatchResultSelection = "home" | "draw" | "away";
export type DoubleChanceSelection = "home_or_draw" | "away_or_draw" | "home_or_away";
export type TotalSelection = "over" | "under";
export type BttsSelection = "yes" | "no";

export type SoccerSelection =
  | { market: "match_result"; selection: MatchResultSelection }
  | { market: "double_chance"; selection: DoubleChanceSelection }
  | { market: "total"; selection: TotalSelection; line: number }
  | { market: "btts"; selection: BttsSelection };

export type ProviderSource = "bdl" | "sharpapi";

/**
 * Normalized soccer-odds record emitted by the providers. Single shape so
 * the reconciler can dedupe across providers and the writer (WC-3) can
 * read uniformly without per-provider branching.
 */
export type NormalizedSoccerOddsRecord = {
  /** Canonical market — always one of the four official launch markets. */
  market: OfficialSoccerMarket;
  /** Canonical selection within the market. */
  selection: MatchResultSelection | DoubleChanceSelection | TotalSelection | BttsSelection;
  /** Numeric line (only relevant for `total`; null for everything else). */
  line: number | null;
  /** American odds when present. */
  odds_american: number | null;
  /** Decimal odds when present. */
  odds_decimal: number | null;
  /** Sportsbook label as reported by the provider ("fanduel", "bovada", "consensus", etc.). */
  sportsbook: string | null;
  /** Source provider. */
  provider: ProviderSource;
  /** Endpoint or sub-source for audit ("/fifa/worldcup/v1/odds", "/odds?league=fifa_world_cup_matches", etc.). */
  provider_endpoint: string;
  /** ISO timestamp when the row was fetched. Useful for staleness. */
  fetched_at: string;
  /** Provider-native event_id, kept for reconciliation/audit. */
  provider_event_id: string | null;
};

// ─── Market-type normalization ────────────────────────────────────────
//
// SharpAPI ships market_type as a snake_case slug.
// BDL ships `markets[].type` as a coarser bucket ("total", "moneyline",
// "spread", "both_teams_to_score", "double_chance", "correct_score",
// "result_combo", "margin", "team_total", "timing", "other") plus a
// human-readable `name`. We must consult BOTH because BDL "total"
// covers both match totals AND alt totals AND team totals — we need
// scope/period to disambiguate.

/** SharpAPI market_type → official soccer market, or null if out of scope. */
export function normalizeSharpApiMarketType(rawMarketType: string): OfficialSoccerMarket | null {
  switch (rawMarketType) {
    case "moneyline": return "match_result";
    case "double_chance": return "double_chance";
    case "total_goals": return "total";
    case "both_teams_to_score": return "btts";
    default: return null;
  }
}

export type BdlMarketShape = {
  type: string;
  period?: string | null;
  scope?: string | null;
  team_side?: string | null;
  line_value?: string | number | null;
  name?: string | null;
};

/**
 * BDL `markets[]` row → official soccer market, or null if out of scope.
 *
 * Discrimination rules:
 *   • type="moneyline"        → match_result (BDL exposes 3-way for soccer
 *                                  via moneyline_*_odds top-level fields)
 *   • type="total" AND        → total (the canonical match O/U)
 *     period="match" AND
 *     scope="match"
 *   • type="total" with       → null (team total goals — not tracked)
 *     scope="home_team"|"away_team"
 *   • type="total" with       → null (1st-half total — not tracked)
 *     period!="match"
 *   • type="both_teams_to_score" → btts (when period+scope are match-level
 *                                       or absent; reject if 1st-half)
 *   • type="double_chance"    → double_chance (match-level only)
 *   • everything else         → null
 *
 * Note: BDL nested-market shapes for soccer aren't yet fully documented
 * vendor-side. Any future BDL shape that doesn't fit the above patterns
 * returns null — the caller will see "market not normalized" and decide
 * whether to extend this function (deliberate product decision).
 */
export function normalizeBdlMarket(market: BdlMarketShape): OfficialSoccerMarket | null {
  const type = String(market.type ?? "").toLowerCase();
  const period = market.period === null || market.period === undefined ? null : String(market.period).toLowerCase();
  const scope = market.scope === null || market.scope === undefined ? null : String(market.scope).toLowerCase();
  const nameLower = String(market.name ?? "").toLowerCase();

  // Reject anything explicitly first-half / 1st half / half-time.
  if (period === "1st_half" || period === "first_half" || period === "ht") return null;
  if (nameLower.includes("1st half") || nameLower.includes("first half") || nameLower.includes("half-time")) return null;

  // Reject anything tied to a single team side ("home_team", "away_team").
  if (scope === "home_team" || scope === "away_team") return null;
  if (market.team_side === "home" || market.team_side === "away") return null;

  switch (type) {
    case "moneyline":
      return "match_result";
    case "total":
      // Only match-scope match-period totals count.
      if ((period === null || period === "match") && (scope === null || scope === "match")) {
        return "total";
      }
      return null;
    case "both_teams_to_score":
      // Match-level BTTS only; halves/combos already rejected above.
      return "btts";
    case "double_chance":
      return "double_chance";
    default:
      return null;
  }
}

// ─── Selection normalization ──────────────────────────────────────────
//
// Provider selection strings are inconsistent and team-name-specific.
// The normalizer needs the (home_team_name, away_team_name) for the
// fixture so it can map "Mexico" → "home" or "South Africa" → "away".

export type TeamNameCtx = {
  home_team: string;
  away_team: string;
};

/**
 * Strip diacritics + lowercase + collapse whitespace. Soccer team names
 * (Curaçao, São Tomé) survive both providers; ASCII-fold for matching.
 */
function asciiFold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `selection` plausibly matches the team name (case/diacritic insensitive). */
function selectionMatchesTeam(selection: string, team: string): boolean {
  const s = asciiFold(selection);
  const t = asciiFold(team);
  if (s === t) return true;
  // SharpAPI sometimes prefixes/suffixes (e.g., "Mexico (MEX)"). Allow
  // selection to be a prefix of team or team to be a prefix of selection.
  if (s.startsWith(t) || t.startsWith(s)) return true;
  // Allow "{team} win" / "{team} to win" phrasing.
  if (s === `${t} win` || s === `${t} to win` || s === `${t} wins`) return true;
  return false;
}

/** Normalize a match_result selection string. Returns null if not parseable. */
export function normalizeMatchResultSelection(
  rawSelection: string,
  ctx: TeamNameCtx,
): MatchResultSelection | null {
  const lower = asciiFold(rawSelection);
  if (lower === "draw" || lower === "tie" || lower === "x") return "draw";
  if (selectionMatchesTeam(rawSelection, ctx.home_team)) return "home";
  if (selectionMatchesTeam(rawSelection, ctx.away_team)) return "away";
  if (lower === "home" || lower === "1") return "home";
  if (lower === "away" || lower === "2") return "away";
  return null;
}

/** Normalize a double_chance selection string. */
export function normalizeDoubleChanceSelection(
  rawSelection: string,
  ctx: TeamNameCtx,
): DoubleChanceSelection | null {
  const folded = asciiFold(rawSelection);
  // Try canonical codes first.
  if (folded === "1x" || folded === "home/draw" || folded === "home or draw") return "home_or_draw";
  if (folded === "x2" || folded === "draw/away" || folded === "draw or away") return "away_or_draw";
  if (folded === "12" || folded === "home/away" || folded === "home or away") return "home_or_away";

  // SharpAPI emits "{home} / Draw", "{away} / Draw", "{home} / {away}" with various separators.
  const homeF = asciiFold(ctx.home_team);
  const awayF = asciiFold(ctx.away_team);
  const includesDraw = folded.includes("draw") || folded.includes("tie");
  const includesHome = folded.includes(homeF);
  const includesAway = folded.includes(awayF);

  if (includesHome && includesDraw && !includesAway) return "home_or_draw";
  if (includesAway && includesDraw && !includesHome) return "away_or_draw";
  if (includesHome && includesAway && !includesDraw) return "home_or_away";

  return null;
}

/** Normalize an over/under total selection. Optionally pass a line if known. */
export function normalizeTotalSelection(rawSelection: string): TotalSelection | null {
  const lower = asciiFold(rawSelection);
  if (lower === "over" || lower.startsWith("over ")) return "over";
  if (lower === "under" || lower.startsWith("under ")) return "under";
  return null;
}

/** Normalize a BTTS selection. */
export function normalizeBttsSelection(rawSelection: string): BttsSelection | null {
  const lower = asciiFold(rawSelection);
  if (lower === "yes" || lower === "y") return "yes";
  if (lower === "no" || lower === "n") return "no";
  return null;
}

/**
 * Validate that a normalized record is structurally sound. Used by the
 * providers + tests as the last guard before emitting a row downstream.
 * Returns the validated record, or null if anything is off.
 */
export function validateNormalizedRecord(
  record: NormalizedSoccerOddsRecord,
): NormalizedSoccerOddsRecord | null {
  if (!OFFICIAL_SOCCER_MARKETS.includes(record.market)) return null;
  if (record.market === "total") {
    if (record.line === null || !Number.isFinite(record.line)) return null;
  }
  if (record.odds_american === null && record.odds_decimal === null) return null;
  if (record.provider !== "bdl" && record.provider !== "sharpapi") return null;
  return record;
}

/**
 * Returns true iff the given raw market_type from EITHER provider would
 * be a "context-only" / non-tracked market we intentionally drop. Used by
 * tests to lock the whitelist.
 */
export function isNonTrackedSoccerMarketType(rawMarketType: string): boolean {
  const t = rawMarketType.toLowerCase();
  const nonTracked = [
    "point_spread",
    "spread",
    "draw_no_bet",
    "team_total_goals",
    "team_total_corners",
    "team_total_cards",
    "team_total_shots",
    "team_total_shots_on_target",
    "team_total_offsides",
    "team_total_tackles",
    "total_cards",
    "total_corners",
    "total_shots",
    "total_shots_on_target",
    "total_offsides",
    "total_tackles",
    "total_goals_odd_even",
    "first_team_to_score",
    "to_win_either_half",
    "team_clean_sheet",
    "correct_score",
    "match_result_both_teams_to_score",
    "result_combo",
    "margin",
    "timing",
    "anytime_goal_scorer",
    "anytime_goal_scorer_by_header",
    "anytime_goal_scorer_outside_box",
    "player_goals",
    "player_to_score_or_assist",
    "championship_winner",
    "tournament_winner",
    "outright",
    "futures",
    "to_lift_trophy",
    "to_win_outright",
    "group_winner",
    "group_qualification",
    "stage_of_elimination",
    "to_reach_final",
    "to_reach_semifinal",
    "golden_boot",
    "golden_ball",
    "top_goalscorer",
    "will_there_be_a_penalty",
  ];
  if (nonTracked.includes(t)) return true;
  // First-half / second-half family.
  if (t.startsWith("1st_half_") || t.startsWith("2nd_half_")) return true;
  return false;
}
