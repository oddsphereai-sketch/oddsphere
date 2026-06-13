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

function medianOf(values: ReadonlyArray<number>): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Robust per-book consensus de-vig for one market group (WC-MODEL-6).
 *
 * Each BOOK that quotes EVERY selection in the group is de-vigged on its
 * OWN prices (selection implied / group implied sum × targetSum); we then
 * take the MEDIAN of the per-book de-vigged probabilities per selection.
 *
 * Why per-book (vs the old de-vig-of-separate-medians): it is
 *   • outlier-resistant — a single skewed book (e.g. a DraftKings BTTS
 *     price of +200 when Bovada/FanDuel are +100) is just one value the
 *     median steps over, instead of dragging the consensus; and
 *   • book-consistent — "yes" and "no" come from the SAME book, never a
 *     mix of two independently-computed medians (which can distort the vig
 *     and manufacture a fake edge, as on the 2026-06-12 BTTS slate).
 * Books quoting only part of the group can't be de-vigged and are excluded
 * from bookCount, so a thin/partial feed reports honest low coverage.
 */
function consensusDevigForGroup(
  rows: ReadonlyArray<NormalizedSoccerOddsRecord>,
  market: string,
  selections: ReadonlyArray<string>,
  totalLine: number | null,
  targetSum: number,
): { devig: Map<string, number>; impliedMedian: Map<string, number>; bookCount: number } {
  const perBook = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    if (r.market !== market) continue;
    if (market === "total" && r.line !== totalLine) continue;
    if (r.sportsbook === null) continue;
    const sel = String(r.selection);
    if (!selections.includes(sel)) continue;
    const impl = americanToImpliedProbability(r.odds_american);
    if (impl === null) continue;
    let m = perBook.get(r.sportsbook);
    if (m === undefined) { m = new Map(); perBook.set(r.sportsbook, m); }
    const arr = m.get(sel) ?? [];
    arr.push(impl);
    m.set(sel, arr);
  }
  const perBookDevig: Array<Map<string, number>> = [];
  const perBookImplied: Array<Map<string, number>> = [];
  for (const selMap of perBook.values()) {
    const impl: Record<string, number> = {};
    let complete = true;
    for (const sel of selections) {
      const a = selMap.get(sel);
      if (a === undefined || a.length === 0) { complete = false; break; }
      impl[sel] = medianOf(a); // collapse duplicate timestamps per (book, selection)
    }
    if (!complete) continue;
    const sum = selections.reduce((s, sel) => s + impl[sel], 0);
    if (sum <= 0) continue;
    const dv = new Map<string, number>();
    const im = new Map<string, number>();
    for (const sel of selections) { dv.set(sel, (impl[sel] / sum) * targetSum); im.set(sel, impl[sel]); }
    perBookDevig.push(dv);
    perBookImplied.push(im);
  }
  const devig = new Map<string, number>();
  const impliedMedian = new Map<string, number>();
  for (const sel of selections) {
    const dvs = perBookDevig.map((m) => m.get(sel)).filter((x): x is number => x !== undefined);
    const ims = perBookImplied.map((m) => m.get(sel)).filter((x): x is number => x !== undefined);
    if (dvs.length > 0) devig.set(sel, medianOf(dvs));
    if (ims.length > 0) impliedMedian.set(sel, medianOf(ims));
  }
  return { devig, impliedMedian, bookCount: perBookDevig.length };
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
  const implied: Record<string, number> = {};
  const devig: Record<string, number> = {};
  const book_counts: Record<string, number> = {};

  const groups: ReadonlyArray<{
    market: string;
    selections: ReadonlyArray<string>;
    targetSum: number;
    lineSuffix: boolean;
  }> = [
    { market: "match_result", selections: ["home", "draw", "away"], targetSum: 1.0, lineSuffix: false },
    // double_chance de-vigs to 2.0 (each DC covers 2 of 3 outcomes).
    { market: "double_chance", selections: ["home_or_draw", "away_or_draw", "home_or_away"], targetSum: 2.0, lineSuffix: false },
    { market: "total", selections: ["over", "under"], targetSum: 1.0, lineSuffix: true },
    { market: "btts", selections: ["yes", "no"], targetSum: 1.0, lineSuffix: false },
  ];

  for (const g of groups) {
    const res = consensusDevigForGroup(
      rows,
      g.market,
      g.selections,
      g.market === "total" ? totalLine : null,
      g.targetSum,
    );
    book_counts[g.market] = res.bookCount;
    for (const sel of g.selections) {
      const outKey = g.lineSuffix ? `${g.market}|${sel}|${totalLine}` : `${g.market}|${sel}`;
      const im = res.impliedMedian.get(sel);
      const dv = res.devig.get(sel);
      if (im !== undefined) implied[outKey] = im;
      if (dv !== undefined) devig[outKey] = dv;
    }
  }

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
