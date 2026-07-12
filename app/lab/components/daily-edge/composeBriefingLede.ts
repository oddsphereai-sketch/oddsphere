/**
 * Phase 4.1.8.C-final (B+C Hybrid) — briefing editorial lede composer.
 *
 * Pure helper. Maps the night's verdict-grouped distribution + best-of
 * results into a 1–2 sentence editorial lede for the Tonight's MLB Edge
 * module. The lede is the briefing's prose voice — it sets the tone for
 * the slate before the user scrolls.
 *
 * Templates per slate shape:
 *   • Multiple top angles, no cautions → confident framing
 *   • 1-2 top angles + cautions → moderate framing
 *   • 0 top angles, mostly watchlist → "quiet slate" framing
 *   • Mostly no-play → honest "thin night" framing
 *
 * No editorialization about specific picks within the lede — the Best-of
 * row below shows the actual picks. The lede provides the shape of the
 * night, not the picks themselves.
 */

import type { DailyEdgeGameDto } from "../../lib/labTypes";
import { headlinePrimaryMarket } from "../../lib/perPickHeadline";

type Grouped = {
  topAngles: DailyEdgeGameDto[]; // best_angle + lean
  watchlist: DailyEdgeGameDto[];
  caution: DailyEdgeGameDto[];
  no_play: DailyEdgeGameDto[];
};

export function composeBriefingLede(grouped: Grouped): string {
  const { topAngles, watchlist, caution, no_play } = grouped;

  // Edge case: no games at all.
  if (
    topAngles.length === 0 &&
    watchlist.length === 0 &&
    caution.length === 0 &&
    no_play.length === 0
  ) {
    return "No games scheduled for tonight.";
  }

  // Mostly no-play (or empty save for no_play).
  if (
    topAngles.length === 0 &&
    watchlist.length === 0 &&
    caution.length === 0 &&
    no_play.length > 0
  ) {
    return "Tonight is mostly No Play — the model and sharp picture don't create enough separation for a clean angle.";
  }

  // Quiet slate: 0 top angles, no cautions, but watchlist + maybe no_play.
  if (topAngles.length === 0 && caution.length === 0) {
    return "Tonight is mostly watchlist. The model has leans, but the sharp picture doesn't tighten any spot into a clean angle yet.";
  }

  // Caution-heavy slate.
  if (topAngles.length === 0 && caution.length > 0) {
    const cWord = caution.length === 1 ? "matchup" : "matchups";
    return `No clean angle stands out tonight — ${caution.length} ${cWord} carry sharp-vs-model conflict worth a careful look.`;
  }

  // Top angles exist. Compose based on count + market clustering.
  const marketCounts = countMarketsAmongTopAngles(topAngles);
  const dominantMarket = pickDominantMarket(marketCounts);

  const firstPart = describeTopAngleCount(topAngles.length, dominantMarket);
  const secondPart = describeRemainder(watchlist.length, caution.length);

  return secondPart ? `${firstPart} ${secondPart}` : firstPart;
}

// ─── Internal composition helpers ────────────────────────────────────

function countMarketsAmongTopAngles(
  topAngles: DailyEdgeGameDto[]
): { moneyline: number; total: number; nrfi: number } {
  const counts = { moneyline: 0, total: 0, nrfi: 0 };
  for (const g of topAngles) {
    const m = headlinePrimaryMarket(g);
    if (m === "moneyline") counts.moneyline++;
    else if (m === "total") counts.total++;
    else if (m === "first_inning_total") counts.nrfi++;
  }
  return counts;
}

function pickDominantMarket(counts: {
  moneyline: number;
  total: number;
  nrfi: number;
}): "moneyline" | "total" | "first_inning_total" | null {
  const total = counts.moneyline + counts.total + counts.nrfi;
  if (total === 0) return null;
  // Dominant only when one market holds ≥ 60% of top angles AND has ≥ 2.
  if (counts.moneyline >= 2 && counts.moneyline / total >= 0.6) return "moneyline";
  if (counts.total >= 2 && counts.total / total >= 0.6) return "total";
  if (counts.nrfi >= 2 && counts.nrfi / total >= 0.6) return "first_inning_total";
  return null;
}

function describeTopAngleCount(
  count: number,
  dominantMarket: "moneyline" | "total" | "first_inning_total" | null
): string {
  if (count === 1) {
    return "One clean angle stands out tonight.";
  }
  // 2+ top angles. Mention market clustering if one dominates.
  if (dominantMarket === "moneyline") {
    return `${count} clean angles tonight, clustered on the moneyline.`;
  }
  if (dominantMarket === "total") {
    return `${count} clean angles tonight, mostly on the total.`;
  }
  if (dominantMarket === "first_inning_total") {
    return `${count} clean angles tonight, mostly in the first inning.`;
  }
  return `${count} clean angles tonight, spread across the moneyline, total, and first inning.`;
}

function describeRemainder(watchlistCount: number, cautionCount: number): string {
  if (cautionCount > 0 && watchlistCount > 0) {
    const cWord = cautionCount === 1 ? "matchup" : "matchups";
    return `${watchlistCount} more games sit on the watchlist, with ${cautionCount} caution ${cWord} worth a closer look.`;
  }
  if (cautionCount > 0) {
    const cWord = cautionCount === 1 ? "matchup" : "matchups";
    return `${cautionCount} caution ${cWord} worth a closer look.`;
  }
  if (watchlistCount > 0) {
    return `${watchlistCount} more games sit on the watchlist.`;
  }
  return "";
}
