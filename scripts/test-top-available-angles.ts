/**
 * Phase 6B.7 — unit tests for selectTopAvailableAngles + the related
 * findBestOfMarket fallback path + the Edge Row pick-relative price
 * move tone.
 *
 * Run: npx tsx scripts/test-top-available-angles.ts
 * Pure fixtures; no DB; no env reads.
 *
 * Coverage:
 *   1. Strict mode short-circuit — when best_angle/lean exist, the
 *      selector returns isFallback=false + games=[] (caller uses strict).
 *   2. Fallback selection — when strict is empty, top 3 are ranked by
 *      modelMarketGapPct desc, with actionability bars enforced.
 *   3. Hard exclusions — no_play, caution, held headline, null grade,
 *      null modelProb are never promoted, even if they "look" strong.
 *   4. Actionability bar — neither edge nor recConf clears → omitted.
 *   5. findBestOfMarket fallback — when strict empty, falls back to
 *      the supplied pool, restricted to games whose headline market
 *      matches.
 */

import type { DailyEdgeGameDto, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { Verdict } from "@/lib/services/verdictDerivation";
import { selectTopAvailableAngles } from "@/app/lab/components/daily-edge/selectTopAvailableAngles";
import { findBestOfMarket } from "@/app/lab/components/daily-edge/findBestOfMarket";

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
    failed++;
  }
}
function truthy(name: string, got: unknown): void {
  if (got) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name} — got falsy`);
    failed++;
  }
}

// ─── Fixture helpers ─────────────────────────────────────────────────

function mkMarket(overrides: Partial<MarketEdgeDto> = {}): MarketEdgeDto {
  return {
    pick: "HOME",
    confidence: 0.6,
    grade: "market_watch",
    signalType: null,
    marketSignal: null,
    sharpStatus: "neutral",
    held: false,
    verdict: { key: "watchlist", label: "Watchlist" },
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
    modelProb: 0.55,
    marketFairProb: 0.5,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican: null,
    lineOpenAmerican: null,
    modelTotal: null,
    marketTotal: null,
    line: null,
    keyStats: [],
    modelTrustPct: 55,
    marketImpliedPct: 50,
    modelMarketGapPct: 5.0,
    recommendationConfidence: 60,
    marketSource: null,
    marketDataQuality: null,
    reviewFlags: [],
    reviewActionSummary: null,
    ...overrides,
  } as unknown as MarketEdgeDto;
}

let nextId = 1;
function mkGame(opts: {
  verdict: Verdict;
  ml?: Partial<MarketEdgeDto>;
  total?: Partial<MarketEdgeDto>;
  nrfi?: Partial<MarketEdgeDto>;
  headline?: "moneyline" | "total" | "first_inning_total";
  gameStartMinutes?: number;
}): DailyEdgeGameDto {
  const id = nextId++;
  return {
    id,
    external_id: `g${id}`,
    sport: "mlb",
    awayTeam: "AWY",
    homeTeam: "HME",
    gameTime: "7:10 PM",
    gameStartMinutes: opts.gameStartMinutes ?? id,
    holdReason: null,
    breakdown: {
      verdict: { key: opts.verdict, label: opts.verdict },
      sharpRead: { key: "no_data", sentence: "" },
      modelBreakdown: null,
    },
    predictions: {
      ml: mkMarket(opts.ml),
      total: mkMarket({ pick: "OVER", ...opts.total }),
      nrfi: mkMarket({ pick: "NRFI", ...opts.nrfi }),
    },
    markets: {
      moneyline: mkMarket(opts.ml),
      total: mkMarket({ pick: "OVER", ...opts.total }),
      first_inning: mkMarket({ pick: "NRFI", ...opts.nrfi }),
    },
    // headlinePrimaryMarket consults this field via the live helper —
    // for these fixtures we don't need it to exercise; the helper
    // defaults to "moneyline" when other fields are unset. Tests rely
    // on default headline = ML unless overridden via individual market
    // values.
    primaryMarket: opts.headline ?? "moneyline",
  } as unknown as DailyEdgeGameDto;
}

// ─── Tests ───────────────────────────────────────────────────────────

console.log("━━━ selectTopAvailableAngles ━━━");

console.log("\n1. Strict mode short-circuit");
{
  const strict = mkGame({ verdict: "best_angle" });
  const watch = mkGame({ verdict: "watchlist", ml: { modelMarketGapPct: 8 } });
  const out = selectTopAvailableAngles([strict, watch], 3);
  eq("strict best_angle present → isFallback=false", out.isFallback, false);
  eq("strict best_angle present → games=[]", out.games.length, 0);
}

console.log("\n2. Fallback selection (no strict)");
{
  const a = mkGame({ verdict: "watchlist", ml: { modelMarketGapPct: 2.0, recommendationConfidence: 55 } });
  const b = mkGame({ verdict: "watchlist", ml: { modelMarketGapPct: 6.5, recommendationConfidence: 70 } });
  const c = mkGame({ verdict: "watchlist", ml: { modelMarketGapPct: 4.0, recommendationConfidence: 60 } });
  const out = selectTopAvailableAngles([a, b, c], 3);
  truthy("strict empty → isFallback=true", out.isFallback === true);
  eq("returns up to 3", out.games.length, 3);
  eq("ranked by edgePp DESC", out.games.map((g) => g.id), [b.id, c.id, a.id]);
}

console.log("\n3. Hard exclusions");
{
  const noPlay = mkGame({ verdict: "no_play", ml: { modelMarketGapPct: 99 } });
  const caution = mkGame({ verdict: "caution", ml: { modelMarketGapPct: 99 } });
  // All-held game (every market held/null) — headlinePrimaryMarket
  // still picks SOMETHING but every market fails the actionability
  // gate, so the selector must drop the row.
  const heldHeadline = mkGame({
    verdict: "watchlist",
    ml: { modelMarketGapPct: 99, held: true, pick: null, modelProb: null, grade: null },
    total: { held: true, pick: null, modelProb: null, grade: null },
    nrfi: { held: true, pick: null, modelProb: null, grade: null },
  });
  // All-null-grade game — same shape.
  const nullGrade = mkGame({
    verdict: "watchlist",
    ml: { modelMarketGapPct: 99, grade: null },
    total: { grade: null },
    nrfi: { grade: null },
  });
  // All-null-modelProb game.
  const nullProb = mkGame({
    verdict: "watchlist",
    ml: { modelMarketGapPct: 99, modelProb: null },
    total: { modelProb: null },
    nrfi: { modelProb: null },
  });
  const out = selectTopAvailableAngles([noPlay, caution, heldHeadline, nullGrade, nullProb], 3);
  eq("no_play excluded", out.games.find((g) => g.id === noPlay.id) ?? null, null);
  eq("caution excluded", out.games.find((g) => g.id === caution.id) ?? null, null);
  eq("held headline excluded", out.games.find((g) => g.id === heldHeadline.id) ?? null, null);
  eq("null grade excluded", out.games.find((g) => g.id === nullGrade.id) ?? null, null);
  eq("null modelProb excluded", out.games.find((g) => g.id === nullProb.id) ?? null, null);
}

console.log("\n4. Actionability bar enforcement");
{
  // Below edge floor AND below rec conf floor → excluded
  const weak = mkGame({
    verdict: "watchlist",
    ml: { modelMarketGapPct: 0.5, recommendationConfidence: 40 },
  });
  // High rec conf saves it (edge unknown is OK)
  const recOnly = mkGame({
    verdict: "watchlist",
    ml: { modelMarketGapPct: null, recommendationConfidence: 70 },
  });
  // High edge alone is enough
  const edgeOnly = mkGame({
    verdict: "watchlist",
    ml: { modelMarketGapPct: 3.5, recommendationConfidence: null },
  });
  // BUG: high rec conf but NEGATIVE edge → rejected
  const negEdgeButRec = mkGame({
    verdict: "watchlist",
    ml: { modelMarketGapPct: -2, recommendationConfidence: 75 },
  });
  const out = selectTopAvailableAngles([weak, recOnly, edgeOnly, negEdgeButRec], 3);
  truthy("weak (edge<floor & rec<floor) excluded", !out.games.some((g) => g.id === weak.id));
  truthy("recOnly (high rec, null edge) included", out.games.some((g) => g.id === recOnly.id));
  truthy("edgeOnly included", out.games.some((g) => g.id === edgeOnly.id));
  truthy("negEdgeButRec excluded (rec OK but edge negative)", !out.games.some((g) => g.id === negEdgeButRec.id));
}

console.log("\n5. findBestOfMarket fallback wiring");
{
  // No strict candidates anywhere; fallback pool has a ML pick that
  // qualifies. findBestOfMarket should surface it for moneyline cell.
  const watchMl = mkGame({ verdict: "watchlist", ml: { modelMarketGapPct: 5 } });
  const noFallback = findBestOfMarket([watchMl], "moneyline");
  eq("no fallbackPool → null even when watchlist exists", noFallback, null);

  const withFallback = findBestOfMarket([watchMl], "moneyline", { fallbackPool: [watchMl] });
  eq("with fallbackPool → returns the watchlist pick", withFallback?.id ?? null, watchMl.id);

  // Fallback pool for moneyline shouldn't surface a game whose headline
  // market is total (perPickHeadline defaults to moneyline here so
  // fixtures behave as if all are ML headlines — this test confirms
  // that path is exercised).
  const withWrongMarket = findBestOfMarket([watchMl], "total", { fallbackPool: [watchMl] });
  truthy("fallback respects market gating", withWrongMarket === null);
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log("\n" + "━".repeat(60));
console.log(`  result: ${passed}/${passed + failed} pass`);
if (failed > 0) process.exit(1);
