/**
 * Phase 4.2.C.1.R-16F-B — pure helper for Edge Stack row construction.
 *
 * Pulled out of `app/lab/components/daily-edge/DailyEdgeShell.tsx` so the
 * row-build logic can be unit-tested without a React renderer. The
 * component renders these rows as JSX with tone-driven colors; nothing
 * about the row data itself is React-specific.
 *
 * Why this exists (R-16F-B):
 *   The Model vs Market strip (added in R-14C1, extended in R-16E)
 *   reads `marketImpliedPct` / `marketDataQuality` / `marketSource` and
 *   shows the right thing for splits_consensus games. The original
 *   Edge Stack "Model Edge" and "Market Value" rows still read legacy
 *   fields (`marketFairProb`, `pinnacleEvPct`) sourced from
 *   `sharp_signals` and would say "market unavailable" /
 *   "Sharper price check unavailable" on splits_consensus games where
 *   `marketImpliedPct` was actually populated. R-16F-B migrates those
 *   two rows to the R-16E-aware path with legacy fallback.
 *
 * Pure / no DB / no React.
 */

import type { MarketEdgeDto } from "./labTypes";

export type EdgeStackRowTone = "emerald" | "amber" | "gray";

export type EdgeStackRow = {
  label: string;
  evidence: string;
  delta: string;
  tone: EdgeStackRowTone;
};

export type EdgeStackMarket = "moneyline" | "total" | "first_inning";

/**
 * Resolve the human-facing market source label. Shared with the Model
 * vs Market strip so both sections always render the same string for
 * any (quality, source) pair.
 *
 *   • "splits_consensus" → "splits consensus" (R-16E synthesized pair —
 *     never impersonates a real book)
 *   • "pinnacle_only"   → "Pinnacle fair" (sharp_signals-only fallback)
 *   • real book         → the book name as-is (e.g. "ballybet")
 *   • unavailable/null  → null
 */
export function marketSourceLabel(
  quality: MarketEdgeDto["marketDataQuality"],
  source: string | null
): string | null {
  if (quality === "splits_consensus") return "splits consensus";
  if (quality === "pinnacle_only") return "Pinnacle fair";
  return source;
}

function moveDirection(
  open: number,
  current: number
): "toward" | "against" | "flat" {
  if (open === current) return "flat";
  // Higher American odds = better for backer of that side; we just need
  // the direction here, not whether it favors the pick.
  return current > open ? "toward" : "against";
}

function formatAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Build the 4 Edge Stack rows for one (game × market) tile.
 *
 * Row precedence within each section:
 *
 *   Model Edge:
 *     1. totals path (when market === "total" and both modelTotal +
 *        marketTotal exist) — unchanged from pre-R-16F-B
 *     2. R-16E-aware path: when marketImpliedPct is non-null (covers
 *        real-book two-sided pairs AND splits_consensus pairs)
 *     3. Legacy sharp-signal path: marketFairProb fallback for any
 *        backwards-compat case the R-16E path didn't cover
 *     4. Truly no market context — "market unavailable"
 *
 *   Market Value:
 *     1. pinnacleEvPct present — preserve the Pinnacle EV % (the
 *        strongest signal); evidence label = "Market price check"
 *        (renamed from "Sharper price check")
 *     2. marketImpliedPct present but no pinnacleEvPct — show
 *        "Market price · <source label>" without faking an EV %
 *     3. Truly no market context — "Market price check / unavailable"
 *
 *   Money vs Bets, Line Move — unchanged from pre-R-16F-B.
 */
export function buildEdgeStackRows(
  market: EdgeStackMarket,
  marketData: MarketEdgeDto
): EdgeStackRow[] {
  const rows: EdgeStackRow[] = [];

  // ── Model Edge ─────────────────────────────────────────────────
  if (
    market === "total" &&
    marketData.modelTotal !== null &&
    marketData.marketTotal !== null
  ) {
    const diff = marketData.modelTotal - marketData.marketTotal;
    const isOver = (marketData.pick ?? "").toUpperCase().startsWith("OVER");
    const supports = (isOver && diff > 0) || (!isOver && diff < 0);
    const mag = Math.abs(diff);
    const tone: EdgeStackRowTone =
      mag < 0.2 ? "gray" : supports ? "emerald" : "amber";
    rows.push({
      label: "Model Edge",
      evidence: `Model ${marketData.modelTotal.toFixed(1)} vs market ${marketData.marketTotal.toFixed(1)}`,
      delta: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} runs`,
      tone,
    });
  } else if (marketData.marketImpliedPct !== null) {
    // R-16F-B — primary path for ML/FI. Splits_consensus AND real-book
    // pairs both land here because the route's computeMarketImplied
    // returns a non-null marketImpliedPct for either.
    const modelPct =
      marketData.modelTrustPct !== null
        ? marketData.modelTrustPct
        : marketData.modelProb !== null
          ? marketData.modelProb * 100
          : null;
    const marketPct = marketData.marketImpliedPct;
    const gap =
      marketData.modelMarketGapPct !== null
        ? marketData.modelMarketGapPct
        : modelPct !== null
          ? modelPct - marketPct
          : 0;
    const sourceLabel = marketSourceLabel(
      marketData.marketDataQuality,
      marketData.marketSource
    );
    const modelLabel = modelPct !== null ? `${Math.round(modelPct)}%` : "—";
    const evidence = sourceLabel
      ? `Model ${modelLabel} · Market ${Math.round(marketPct)}% · ${sourceLabel}`
      : `Model ${modelLabel} · Market ${Math.round(marketPct)}%`;
    rows.push({
      label: "Model Edge",
      evidence,
      delta: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pt`,
      tone: gap >= 1 ? "emerald" : gap <= -1 ? "amber" : "gray",
    });
  } else if (marketData.marketFairProb !== null) {
    // Legacy sharp-signal fallback. Preserves pre-R-16F-B wording for
    // any DTO state where marketImpliedPct didn't fire.
    const gap =
      (marketData.modelProb !== null
        ? marketData.modelProb - marketData.marketFairProb
        : 0) * 100;
    rows.push({
      label: "Model Edge",
      evidence: `${(((marketData.modelProb ?? 0) * 100)).toFixed(0)}% vs market ${(marketData.marketFairProb * 100).toFixed(0)}%`,
      delta: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`,
      tone: gap >= 1 ? "emerald" : gap <= -1 ? "amber" : "gray",
    });
  } else {
    rows.push({
      label: "Model Edge",
      evidence: `${(((marketData.modelProb ?? 0) * 100)).toFixed(0)}% · market unavailable`,
      delta: "—",
      tone: "gray",
    });
  }

  // ── Market Value ────────────────────────────────────────────────
  if (marketData.pinnacleEvPct !== null) {
    const ev = marketData.pinnacleEvPct;
    rows.push({
      label: "Market Value",
      evidence: "Market price check",
      delta: `${ev >= 0 ? "+" : ""}${ev.toFixed(1)}%`,
      tone: ev >= 0.3 ? "emerald" : ev <= -1 ? "amber" : "gray",
    });
  } else if (marketData.marketImpliedPct !== null) {
    // Market price exists (real book or splits_consensus) but no EV %
    // is available — surface the source so the reader knows the price
    // is real; do NOT fabricate an EV value.
    const sourceLabel = marketSourceLabel(
      marketData.marketDataQuality,
      marketData.marketSource
    );
    rows.push({
      label: "Market Value",
      evidence: sourceLabel
        ? `Market price · ${sourceLabel}`
        : "Market price · available",
      delta: "—",
      tone: "gray",
    });
  } else {
    rows.push({
      label: "Market Value",
      evidence: "Market price check",
      delta: "unavailable",
      tone: "gray",
    });
  }

  // ── Money vs Bets ───────────────────────────────────────────────
  if (marketData.moneyPct === null || marketData.betsPct === null) {
    // R-19 Phase 5i Fix C — FI distinction. SharpAPI's /splits endpoint
    // doesn't return first_inning_total data (documented in Phase
    // 4.1.9.C-1c.ix), so FI's null moneyPct/betsPct is an upstream
    // provider limitation — not a transient outage. Generic "unavailable"
    // reads as "we couldn't fetch it"; FI gets a clearer label so members
    // understand the data isn't offered for this market.
    rows.push({
      label: "Money vs Bets",
      evidence:
        market === "first_inning"
          ? "Public split — not offered for FI"
          : "Public split",
      delta: "unavailable",
      tone: "gray",
    });
  } else {
    const gap = marketData.moneyPct - marketData.betsPct;
    rows.push({
      label: "Money vs Bets",
      evidence: `Money ${marketData.moneyPct}% / Bets ${marketData.betsPct}%`,
      delta: `${gap >= 0 ? "+" : ""}${gap}`,
      tone: gap >= 3 ? "emerald" : gap <= -3 ? "amber" : "gray",
    });
  }

  // ── Line Move — unchanged ───────────────────────────────────────
  if (
    marketData.lineOpenAmerican === null ||
    marketData.priceAmerican === null
  ) {
    rows.push({
      label: "Line Move",
      evidence: "Open → Current",
      delta: "unavailable",
      tone: "gray",
    });
  } else {
    const dir = moveDirection(
      marketData.lineOpenAmerican,
      marketData.priceAmerican
    );
    const arrow = dir === "toward" ? "↗" : dir === "against" ? "↘" : "→";
    rows.push({
      label: "Line Move",
      evidence: `${formatAmerican(marketData.lineOpenAmerican)} → ${formatAmerican(marketData.priceAmerican)}`,
      delta: arrow,
      tone: dir === "toward" ? "emerald" : dir === "against" ? "amber" : "gray",
    });
  }

  return rows;
}
