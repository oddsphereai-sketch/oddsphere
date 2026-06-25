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
import {
  classifyPickRelativeLineMove,
  lineMoveTone,
  lineMoveArrow,
} from "./lineMoveTone";
import { buildLineTrackerEvidence } from "./lineTracker";

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
 *   • "pinnacle_only"   → "market fair" (sharp_signals-only fallback)
 *   • real book         → the book name as-is (e.g. "ballybet")
 *   • unavailable/null  → null
 */
export function marketSourceLabel(
  quality: MarketEdgeDto["marketDataQuality"],
  source: string | null
): string | null {
  if (quality === "splits_consensus") return "splits consensus";
  if (quality === "pinnacle_only") return "market fair";
  return source;
}

function formatAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function splitForPick(
  marketData: MarketEdgeDto
): MarketEdgeDto["publicSplits"][number] | null {
  if (marketData.publicSplits.length === 0 || marketData.pick === null) {
    return null;
  }
  const pick = marketData.pick.toLowerCase();
  const exact = marketData.publicSplits.find((s) => pick === s.label.toLowerCase());
  if (exact) return exact;
  const contained = marketData.publicSplits.find((s) =>
    pick.includes(s.label.toLowerCase())
  );
  if (contained) return contained;
  if (pick.startsWith("over")) {
    return marketData.publicSplits.find((s) => s.side === "over") ?? null;
  }
  if (pick.startsWith("under")) {
    return marketData.publicSplits.find((s) => s.side === "under") ?? null;
  }
  // Some non-MLB moneyline picks are branded model/persona labels (for
  // example "Tempo") while their public split rows remain team labels. When
  // the legacy picked-side scalars are empty, the route/adapters order
  // publicSplits with the selected side first; use that visible row so the
  // Edge Stack matches the Market Pulse bars instead of saying unavailable.
  if (
    marketData.moneyPct === null &&
    marketData.betsPct === null &&
    marketData.publicSplits.length === 2
  ) {
    return marketData.publicSplits[0] ?? null;
  }
  return null;
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
 *     1. pinnacleEvPct present — preserve the market EV % (the
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
  marketData: MarketEdgeDto,
  // Sport-aware total unit: MLB "runs", NBA "points", NHL/soccer "goals".
  // Defaults to "runs" for back-compat with existing MLB-only call sites.
  totalUnit: string = "runs",
  isTrueFirstInningMarket: boolean = market === "first_inning"
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
      delta: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} ${totalUnit}`,
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
  // R-19 Phase 5j Fix 3 — honest label per branch. Pre-5j, the row was
  // always labeled "Market Value", which read as a quantified edge even
  // in the common branch where only marketImpliedPct is available (no
  // market EV %). Members on cards across the slate saw the same
  // "Market Value · Market price · ballybet · —" line and concluded the
  // row was broken. Now:
  //   • EV present → label stays "Market EV"; delta is the
  //     real EV percentage; tone reflects the magnitude
  //   • Only market-implied price exists → label becomes "Market Source"
  //     so the reader understands the row carries attribution, not edge
  //   • Nothing available → label "Market EV · unavailable"
  if (marketData.pinnacleEvPct !== null) {
    const ev = marketData.pinnacleEvPct;
    rows.push({
      label: "Market EV",
      evidence: "Fair price vs market price",
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
      label: "Market Source",
      evidence: sourceLabel
        ? `Reference price from ${sourceLabel}`
        : "Reference price available",
      delta: "—",
      tone: "gray",
    });
  } else {
    rows.push({
      label: "Market EV",
      evidence: "Fair price vs market price",
      delta: "unavailable",
      tone: "gray",
    });
  }

  // ── Money vs Bets ───────────────────────────────────────────────
  // R-19 Phase 5j Fix 5 — partial-data handling. SharpAPI's /splits
  // endpoint sometimes returns bets% but not money% (or vice-versa)
  // for an individual game — game-dependent, not a uniform outage.
  // Pre-5j the row required BOTH fields and threw away partial data,
  // rendering "unavailable" even when one side was present. Now we
  // surface whatever the provider gave us and label the missing field
  // honestly, so members don't lose visibility on real data.
  //
  // Phase 5i Fix C is preserved: when BOTH fields are missing AND
  // this is a true first-inning market, the row still says "not offered
  // for FI" because FI's full miss is an upstream limit, not a partial
  // gap. Other sports can reuse the `first_inning` DTO slot for spread
  // or puck line, so those must read from `publicSplits`.
  const pickedSplit = splitForPick(marketData);
  // Prefer the resolved two-sided display splits. MLB's Playbook/SharpAPI
  // overlay updates publicSplits after the legacy picked-side scalars are
  // built, so scalars can be stale while the Market Pulse bars are correct.
  // Supporting Evidence must match the bars users see.
  const moneyPct = pickedSplit?.moneyPct ?? marketData.moneyPct ?? null;
  const betsPct = pickedSplit?.betsPct ?? marketData.betsPct ?? null;
  const haveMoney = moneyPct !== null;
  const haveBets = betsPct !== null;
  if (haveMoney && haveBets) {
    const gap = moneyPct! - betsPct!;
    rows.push({
      label: "Money vs Bets",
      evidence: `Money ${moneyPct}% / Bets ${betsPct}%`,
      delta: `${gap >= 0 ? "+" : ""}${gap}`,
      tone: gap >= 3 ? "emerald" : gap <= -3 ? "amber" : "gray",
    });
  } else if (haveMoney) {
    // Money present, bets missing — show the half we have honestly.
    rows.push({
      label: "Money vs Bets",
      evidence: `Money ${moneyPct}% · bets split unavailable`,
      delta: "—",
      tone: "gray",
    });
  } else if (haveBets) {
    // Bets present, money missing — same treatment.
    rows.push({
      label: "Money vs Bets",
      evidence: `Bets ${betsPct}% · money split unavailable`,
      delta: "—",
      tone: "gray",
    });
  } else {
    // Both missing → genuinely unavailable. Phase 5i FI copy preserved.
    rows.push({
      label: "Money vs Bets",
      evidence:
        isTrueFirstInningMarket
          ? "Public split — not offered for FI"
          : "Public split",
      delta: "unavailable",
      tone: "gray",
    });
  }

  // ── Line Move ───────────────────────────────────────────────────
  // Phase 6B.13 — both the compact reader and the expanded Edge Stack
  // now share the same pick-relative tone helper. Pre-6B.13 the expanded
  // row used raw arrow direction (current > open → emerald) while the
  // compact reader correctly used implied-prob delta — so favorite
  // moves like -170 → -157 displayed amber compact / emerald expanded.
  // Both surfaces now consume classifyPickRelativeLineMove + lineMoveTone
  // so a future cron regenerating game_predictions cannot drift them apart.
  if (
    marketData.lineOpenAmerican === null ||
    marketData.priceAmerican === null
  ) {
    rows.push({
      label: "Line Move",
      evidence: "First seen → Current",
      delta: "unavailable",
      tone: "gray",
    });
  } else {
    // Tone + arrow stay pick-relative on First seen → Current (unchanged rule).
    const dir = classifyPickRelativeLineMove(
      marketData.lineOpenAmerican,
      marketData.priceAmerican
    );
    // 2026-06-16 — render the full stop chain (Open / First Published /
    // Current / Locked) when the streaming-era fields are present; otherwise
    // degrade to the original "First seen → Current" string. Additive: when no
    // posted/locked stops exist the displayed info is identical to before,
    // just with explicit labels.
    const tracker = buildLineTrackerEvidence({
      openAmerican: marketData.lineOpenAmerican,
      previousAmerican: marketData.lastMovePrevAmerican ?? null,
      currentAmerican: marketData.priceAmerican,
      lockedAmerican: marketData.lockedLineAmerican ?? null,
    });
    rows.push({
      label: "Line Move",
      evidence:
        tracker.evidence ??
        `${formatAmerican(marketData.lineOpenAmerican)} → ${formatAmerican(marketData.priceAmerican)}`,
      delta: lineMoveArrow(dir),
      tone: lineMoveTone(dir),
    });
  }

  // ── Line move (2026-06-16) — the actual betting NUMBER, e.g. total 8.5 → 9 ──
  // Distinct from the "Line Move" row above (which tracks the PRICE/odds). Members
  // asked to see the line itself move, not just price drift. Reader-only; renders
  // only when the point actually changed (null for moneyline / no move).
  if (
    marketData.lastMoveLinePrev != null &&
    marketData.lastMoveLineNext != null &&
    marketData.lastMoveLinePrev !== marketData.lastMoveLineNext
  ) {
    const up = marketData.lastMoveLineNext > marketData.lastMoveLinePrev;
    rows.push({
      label: "Line",
      evidence: `${marketData.lastMoveLinePrev} → ${marketData.lastMoveLineNext}`,
      delta: up ? "▲" : "▼",
      tone: "gray",
    });
  }

  // ── Market Read (2026-06-16) ────────────────────────────────────
  // The derived market-intelligence chip (toward/against/reverse/public read).
  // Display/audit only. Absent (null) until the live streaming tables populate,
  // so the row simply doesn't render then.
  if (marketData.marketInterpretation) {
    rows.push({
      label: "Market Read",
      evidence: marketData.marketInterpretation.chipLabel,
      delta: "",
      tone: marketData.marketInterpretation.chipTone,
    });
  }

  return rows;
}
