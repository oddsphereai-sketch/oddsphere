/**
 * Market comparison + de-vig for soccer — WC-3 pure math.
 *
 * Pure module. No DB. No HTTP. Inputs are model probabilities + already-
 * normalized soccer odds records; outputs are implied/de-vigged
 * probabilities + edges + agreement flags.
 *
 * BINDING CONTRACT (project-wc-model-standard §5):
 *   • Market comparison NEVER changes model probabilities.
 *   • Market comparison NEVER changes the model's pick.
 *   • It only produces edges + agreement flags that downstream code
 *     uses for confidence/grade derivation (see soccerConfidenceGrade.ts).
 */

import type { NormalizedSoccerOddsRecord } from "@/lib/providers/real_api/_soccerMarketNormalizer";
import type {
  BttsProbabilities,
  DoubleChanceProbabilities,
  MatchResultProbabilities,
  TotalProbabilities,
} from "./soccerMarketProbabilities";

/** Convert American odds to implied probability (with vig). */
export function americanToImpliedProbability(american: number | null): number | null {
  if (american === null || !Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

/**
 * De-vig a market group by normalizing implied probabilities to a
 * target sum. Each market has its own true target:
 *
 *   • match_result (3 mutually exclusive outcomes)  → sum = 1.0
 *   • total        (over/under)                     → sum = 1.0
 *   • btts         (yes/no)                         → sum = 1.0
 *   • double_chance (3 outcomes each covering 2 of  → sum = 2.0
 *                    3 mutually exclusive match results)
 *
 * Default is 1.0 — pass 2.0 explicitly for the double_chance group.
 *
 * Bug fix 2026-06-11: previously this always normalized to 1.0,
 * which silently halved every double_chance probability and inflated
 * DC edges by ~2x (e.g. tonight's CZE@KOR DC edges showed +29-36pp
 * when the honest math gives +0.9 to +1.7pp).
 */
export function devigImplied(
  implied: ReadonlyArray<number | null>,
  targetSum: number = 1.0,
): number[] {
  const cleaned = implied.map((p) => (p === null || !Number.isFinite(p) ? 0 : p));
  const total = cleaned.reduce((s, v) => s + v, 0);
  if (total <= 0) return cleaned.map(() => 0);
  return cleaned.map((p) => (p / total) * targetSum);
}

/**
 * Aggregate odds records per (market, selection) into a single
 * representative implied probability. Strategy: take median across
 * sportsbooks to dampen single-book outliers.
 */
function medianImpliedBySelection(rows: ReadonlyArray<NormalizedSoccerOddsRecord>): Map<string, number> {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    const key = row.market === "total"
      ? `${row.market}|${row.selection}|${row.line ?? "?"}`
      : `${row.market}|${row.selection}`;
    const implied = americanToImpliedProbability(row.odds_american);
    if (implied === null) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(implied);
    byKey.set(key, arr);
  }
  const out = new Map<string, number>();
  for (const [k, arr] of byKey.entries()) {
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const median = arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
    out.set(k, median);
  }
  return out;
}

export type MarketProbabilityBundle = {
  /** Implied probabilities (with vig) per selection, median across books. */
  implied: Record<string, number>;
  /** De-vigged probabilities per market. */
  devig: Record<string, number>;
  /** Number of distinct sportsbooks contributing to each market group. */
  book_counts: Record<string, number>;
};

/**
 * Take all normalized rows for a SINGLE fixture and reduce them to an
 * implied + de-vig probability bundle for every tracked market group.
 *
 * Groups:
 *   match_result   → keys "home", "draw", "away"
 *   double_chance  → keys "home_or_draw", "away_or_draw", "home_or_away"
 *   total          → keys "over@LINE", "under@LINE"
 *   btts           → keys "yes", "no"
 *
 * Caller supplies the total line for which to compute the bundle
 * (e.g., 2.5). Rows on other total lines are ignored for the bundle but
 * remain available for alt-line analysis upstream.
 */
export function buildMarketProbabilityBundle(
  rows: ReadonlyArray<NormalizedSoccerOddsRecord>,
  totalLine: number,
): MarketProbabilityBundle {
  const filtered = rows.filter((r) => r.market !== "total" || r.line === totalLine);
  const medians = medianImpliedBySelection(filtered);

  const implied: Record<string, number> = {};
  const devig: Record<string, number> = {};
  const book_counts: Record<string, number> = {};

  // Group keys.
  const matchResultKeys = ["match_result|home", "match_result|draw", "match_result|away"];
  const doubleChanceKeys = [
    "double_chance|home_or_draw",
    "double_chance|away_or_draw",
    "double_chance|home_or_away",
  ];
  const totalKeys = [`total|over|${totalLine}`, `total|under|${totalLine}`];
  const bttsKeys = ["btts|yes", "btts|no"];

  function devigGroup(
    keys: ReadonlyArray<string>,
    outPrefix: string,
    targetSum: number = 1.0,
  ): void {
    const groupImplied = keys.map((k) => medians.get(k) ?? null);
    const groupDevig = devigImplied(groupImplied, targetSum);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const selectionSuffix = k.split("|").slice(1).join("|");
      const outKey = `${outPrefix}|${selectionSuffix}`;
      if (medians.has(k)) implied[outKey] = medians.get(k) as number;
      devig[outKey] = groupDevig[i];
    }
  }
  devigGroup(matchResultKeys, "match_result");           // sum → 1.0
  devigGroup(doubleChanceKeys, "double_chance", 2.0);    // sum → 2.0  (bug fix)
  devigGroup(totalKeys, "total");                        // sum → 1.0
  devigGroup(bttsKeys, "btts");                          // sum → 1.0

  // Per-market book counts.
  function bookCountFor(prefix: string): number {
    const books = new Set<string>();
    for (const r of filtered) {
      if (r.market !== (prefix as never)) continue;
      if (r.sportsbook !== null) books.add(r.sportsbook);
    }
    return books.size;
  }
  book_counts["match_result"] = bookCountFor("match_result");
  book_counts["double_chance"] = bookCountFor("double_chance");
  book_counts["total"] = bookCountFor("total");
  book_counts["btts"] = bookCountFor("btts");

  return { implied, devig, book_counts };
}

// ─── Edge + agreement against model probabilities ─────────────────────

export type EdgeRow = {
  market: "match_result" | "double_chance" | "total" | "btts";
  selection: string;
  model_p: number;
  market_implied_p: number | null;
  market_devig_p: number | null;
  edge_pp: number | null;
  model_market_agreement: boolean;
};

/**
 * Compute per-selection edge against the model probabilities.
 * Outputs ONE row per (market, selection); the writer then picks the
 * argmax_model selection per market.
 *
 * model_market_agreement = |edge_pp| < AGREEMENT_BAND_PP — default 4 pp.
 */
const AGREEMENT_BAND_PP = 4;

export function computeEdges(opts: {
  modelMatchResult: MatchResultProbabilities;
  modelDoubleChance: DoubleChanceProbabilities;
  modelTotal: TotalProbabilities;
  modelBtts: BttsProbabilities;
  marketBundle: MarketProbabilityBundle;
}): EdgeRow[] {
  const out: EdgeRow[] = [];

  function push(
    market: EdgeRow["market"],
    selection: string,
    model_p: number,
    bundleKey: string,
  ): void {
    const market_implied_p = opts.marketBundle.implied[bundleKey] ?? null;
    const market_devig_p = opts.marketBundle.devig[bundleKey] ?? null;
    let edge_pp: number | null = null;
    let agreement = false;
    if (market_devig_p !== null && market_devig_p > 0) {
      edge_pp = (model_p - market_devig_p) * 100;
      agreement = Math.abs(edge_pp) < AGREEMENT_BAND_PP;
    }
    out.push({ market, selection, model_p, market_implied_p, market_devig_p, edge_pp, model_market_agreement: agreement });
  }

  push("match_result", "home", opts.modelMatchResult.home, "match_result|home");
  push("match_result", "draw", opts.modelMatchResult.draw, "match_result|draw");
  push("match_result", "away", opts.modelMatchResult.away, "match_result|away");

  push("double_chance", "home_or_draw", opts.modelDoubleChance.home_or_draw, "double_chance|home_or_draw");
  push("double_chance", "away_or_draw", opts.modelDoubleChance.away_or_draw, "double_chance|away_or_draw");
  push("double_chance", "home_or_away", opts.modelDoubleChance.home_or_away, "double_chance|home_or_away");

  const line = opts.modelTotal.line;
  push("total", "over", opts.modelTotal.over, `total|over|${line}`);
  push("total", "under", opts.modelTotal.under, `total|under|${line}`);

  push("btts", "yes", opts.modelBtts.yes, "btts|yes");
  push("btts", "no", opts.modelBtts.no, "btts|no");

  return out;
}

/** Pick the argmax-model selection per market. Returns one row per market. */
export function selectBestModelPicksPerMarket(edges: ReadonlyArray<EdgeRow>): EdgeRow[] {
  const byMarket = new Map<string, EdgeRow[]>();
  for (const e of edges) {
    const arr = byMarket.get(e.market) ?? [];
    arr.push(e);
    byMarket.set(e.market, arr);
  }
  const out: EdgeRow[] = [];
  for (const arr of byMarket.values()) {
    arr.sort((x, y) => y.model_p - x.model_p);
    out.push(arr[0]);
  }
  return out;
}

/**
 * WC-MODEL-2 (2026-06-12) — value-side selector. Returns one row per
 * market with the highest edge_pp among that market's selections. Used
 * alongside `selectBestModelPicksPerMarket` so the orchestrator can
 * detect (model_side, value_side) disagreement and downgrade the grade
 * without changing the customer-facing pick.
 *
 * Rows with edge_pp === null (no market data for that selection) are
 * skipped. If no row in the market has a non-null edge, that market
 * is absent from the output.
 */
export function selectBestValueSidePerMarket(edges: ReadonlyArray<EdgeRow>): EdgeRow[] {
  const byMarket = new Map<string, EdgeRow[]>();
  for (const e of edges) {
    if (e.edge_pp === null) continue;
    const arr = byMarket.get(e.market) ?? [];
    arr.push(e);
    byMarket.set(e.market, arr);
  }
  const out: EdgeRow[] = [];
  for (const arr of byMarket.values()) {
    arr.sort((x, y) => (y.edge_pp ?? Number.NEGATIVE_INFINITY) - (x.edge_pp ?? Number.NEGATIVE_INFINITY));
    out.push(arr[0]);
  }
  return out;
}
