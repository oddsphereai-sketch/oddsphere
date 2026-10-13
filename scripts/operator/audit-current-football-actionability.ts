/** Read-only current NFL/CFB board economics audit. */
import { supabase } from "@/lib/db/supabase";
import { readCfbForwardMemberSnapshot } from "@/lib/services/football/cfbForwardMemberSnapshotStore";
import { readNflForwardMemberSnapshot } from "@/lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "@/lib/services/football/nflForwardWeekSelection";
import type { DailyEdgeGameDto, MarketEdgeDto } from "@/app/lab/lib/labTypes";

type MarketRow = {
  sport: "nfl" | "cfb";
  matchup: string;
  gameStartAt: string | null;
  market: "moneyline" | "spread" | "total";
  pick: string | null;
  grade: string;
  price: number | null;
  modelProbability: number | null;
  marketFairProbability: number | null;
  expectedValuePct: number | null;
  marketRead: string | null;
  reviewFlags: string[];
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function canonicalGrade(market: MarketEdgeDto): string {
  return String(market?.verdict?.label ?? market?.actionabilityLabel ?? market?.grade ?? "Missing");
}

function row(sport: "nfl" | "cfb", game: DailyEdgeGameDto, key: "moneyline" | "total" | "first_inning"): MarketRow {
  const market = game.markets[key];
  return {
    sport,
    matchup: `${game.awayTeam} @ ${game.homeTeam}`,
    gameStartAt: game.gameStartAt ?? null,
    market: key === "first_inning" ? "spread" : key,
    pick: market.pick ?? null,
    grade: canonicalGrade(market),
    price: finite(market.gradePriceAmerican) ?? finite(market.currentPriceAmerican) ?? finite(market.priceAmerican),
    modelProbability: finite(market.modelProb) ?? finite(market.confidence),
    marketFairProbability: finite(market.marketFairProb),
    expectedValuePct: finite(market.pinnacleEvPct),
    marketRead: market.recommendationDecision?.resolvedMarketRead?.status ?? null,
    reviewFlags: Array.isArray(market.reviewFlags) ? market.reviewFlags.map(String) : [],
  };
}

function summarize(rows: MarketRow[]) {
  const actionable = rows.filter((item) => item.grade === "Best Angle" || item.grade === "Lean");
  const noPlays = rows.filter((item) => item.grade === "No Play");
  const negativeEvActionables = actionable.filter((item) => (item.expectedValuePct ?? 0) < 0);
  const heavyFavoriteActionables = actionable.filter((item) => (item.price ?? 0) <= -200);
  const heavyBestAngles = actionable.filter((item) => item.grade === "Best Angle" && (item.price ?? 0) <= -200);
  const shopActionables = actionable.filter((item) => item.reviewFlags.includes("displayed_quote_shop"));
  const favoriteLeanPromotions = actionable.filter((item) => item.reviewFlags.includes("moneyline_market_confirmed_favorite_lean"));
  const injuryUnavailable = (item: MarketRow) => item.reviewFlags.some((flag) => flag.includes("injury") && flag.includes("unavailable"));
  const splitUnavailable = (item: MarketRow) => item.reviewFlags.some((flag) => flag.includes("split") && (flag.includes("unavailable") || flag.includes("not_published")));
  const grades = Object.fromEntries([...new Set(rows.map((item) => item.grade))].sort().map((grade) => [grade, rows.filter((item) => item.grade === grade).length]));
  return {
    rows: rows.length,
    grades,
    actionable: actionable.length,
    actionableRate: rows.length ? +(actionable.length / rows.length).toFixed(4) : null,
    negativeEvActionableCount: negativeEvActionables.length,
    negativeEvActionableExamples: negativeEvActionables.slice(0, 12),
    heavyFavoriteActionableCount: heavyFavoriteActionables.length,
    heavyFavoriteActionableExamples: heavyFavoriteActionables.slice(0, 12),
    bestAnglePriceAtOrBelowMinus200Count: heavyBestAngles.length,
    shopActionableCount: shopActionables.length,
    marketConfirmedFavoriteLeanCount: favoriteLeanPromotions.length,
    actionableWithInjuryUnavailableCount: actionable.filter(injuryUnavailable).length,
    actionableWithSplitUnavailableCount: actionable.filter(splitUnavailable).length,
    noPlayWithNoPriceCount: noPlays.filter((item) => item.price === null).length,
    noPlayWithPositiveExactValueCount: noPlays.filter((item) => item.price !== null && (item.expectedValuePct ?? Number.NEGATIVE_INFINITY) > 0).length,
    noPlayCount: noPlays.length,
    noPlayExamples: noPlays.slice(0, 12),
    bestAnglePriceAtOrBelowMinus200Examples: heavyBestAngles.slice(0, 12),
  };
}

function compact(summary: ReturnType<typeof summarize>) {
  return {
    rows: summary.rows,
    grades: summary.grades,
    actionable: summary.actionable,
    actionableRate: summary.actionableRate,
    negativeEvActionableCount: summary.negativeEvActionableCount,
    heavyFavoriteActionableCount: summary.heavyFavoriteActionableCount,
    bestAnglePriceAtOrBelowMinus200Count: summary.bestAnglePriceAtOrBelowMinus200Count,
    shopActionableCount: summary.shopActionableCount,
    marketConfirmedFavoriteLeanCount: summary.marketConfirmedFavoriteLeanCount,
    actionableWithInjuryUnavailableCount: summary.actionableWithInjuryUnavailableCount,
    actionableWithSplitUnavailableCount: summary.actionableWithSplitUnavailableCount,
    noPlayWithNoPriceCount: summary.noPlayWithNoPriceCount,
    noPlayWithPositiveExactValueCount: summary.noPlayWithPositiveExactValueCount,
    noPlayCount: summary.noPlayCount,
    noPlayExamples: summary.noPlayExamples.slice(0, 6),
    negativeEvActionableExamples: summary.negativeEvActionableExamples.slice(0, 3),
    bestAnglePriceAtOrBelowMinus200Examples: summary.bestAnglePriceAtOrBelowMinus200Examples.slice(0, 3),
  };
}

function candidateGrade(row: MarketRow): string {
  const negativeExactValue = row.expectedValuePct !== null && row.expectedValuePct < 0;
  const nonpositiveExactGap = row.modelProbability !== null && row.marketFairProbability !== null &&
    row.modelProbability <= row.marketFairProbability;
  if (
    row.sport === "cfb" &&
    (row.grade === "Best Angle" || row.grade === "Lean") &&
    (negativeExactValue || nonpositiveExactGap)
  ) return "Watchlist";
  if (row.sport === "nfl" && row.market === "moneyline" && row.grade === "Best Angle" && (row.price ?? 0) < -200) {
    return "Lean";
  }
  return row.grade;
}

function candidateImpact(rows: MarketRow[]) {
  const changed = rows.flatMap((row) => {
    const next = candidateGrade(row);
    return next === row.grade ? [] : [{ ...row, before: row.grade, after: next }];
  });
  const candidateRows = rows.map((row) => ({ ...row, grade: candidateGrade(row) }));
  return {
    before: compact(summarize(rows)),
    after: compact(summarize(candidateRows)),
    changes: changed.length,
    actionablePromotions: changed.filter((row) => !["Best Angle", "Lean"].includes(row.before) && ["Best Angle", "Lean"].includes(row.after)).length,
    actionableDemotions: changed.filter((row) => ["Best Angle", "Lean"].includes(row.before) && !["Best Angle", "Lean"].includes(row.after)).length,
    withinActionableTierDemotions: changed.filter((row) => row.before === "Best Angle" && row.after === "Lean").length,
    examples: changed.slice(0, 8),
  };
}

async function main() {
  const cfb = await readCfbForwardMemberSnapshot({ client: supabase, season: 2026 });
  const nflSeason = Number(process.env.NFL_FORWARD_SEASON ?? "2026");
  const nflWeek = resolveNflForwardWeek({
    season: nflSeason,
    configuredWeek: Number(process.env.NFL_FORWARD_WEEK ?? "1"),
  });
  const nfl = await readNflForwardMemberSnapshot({ client: supabase, season: nflSeason, week: nflWeek });
  const rows: MarketRow[] = [];
  for (const game of cfb?.fixture.snapshot.games ?? []) {
    rows.push(row("cfb", game, "moneyline"), row("cfb", game, "first_inning"), row("cfb", game, "total"));
  }
  for (const game of nfl?.fixture.snapshot.games ?? []) {
    rows.push(row("nfl", game, "moneyline"), row("nfl", game, "first_inning"), row("nfl", game, "total"));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    releases: {
      cfb: cfb ? { snapshot: cfb.snapshotRelease, member: cfb.memberRelease, publishedAt: cfb.publishedAt } : null,
      nfl: nfl ? { snapshot: nfl.snapshotRelease, member: nfl.memberRelease, publishedAt: nfl.publishedAt, week: nflWeek } : null,
    },
    bySport: {
      cfb: compact(summarize(rows.filter((item) => item.sport === "cfb"))),
      nfl: compact(summarize(rows.filter((item) => item.sport === "nfl"))),
    },
    bySportMarket: Object.fromEntries(["cfb", "nfl"].flatMap((sport) => ["moneyline", "spread", "total"].map((market) => [
      `${sport}::${market}`,
      compact(summarize(rows.filter((item) => item.sport === sport && item.market === market))),
    ]))),
    candidateImpact: {
      cfb: candidateImpact(rows.filter((item) => item.sport === "cfb")),
      nfl: candidateImpact(rows.filter((item) => item.sport === "nfl")),
    },
  };
  console.log(JSON.stringify(process.argv.includes("--candidate-only") ? {
    generatedAt: report.generatedAt,
    releases: report.releases,
    candidateImpact: report.candidateImpact,
  } : report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
