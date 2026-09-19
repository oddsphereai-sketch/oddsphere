import { createClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import {
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketSharpAwareForecast,
} from "../../lib/services/football/cfbMarketSharpAwareShadow";
import {
  buildCfbV1DecisionBundle,
  getCfbV1ForecastForGame,
  type CfbV1DecisionBundle,
  type CfbV1ExactPriceDecision,
  type CfbV1Grade,
} from "../../lib/services/football/cfbV1Decision";

const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length) ?? "2026-09-19";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase read credentials are required.");

async function main(): Promise<void> {
  const rows = await readCfbForwardEvidence({
    client: createClient(url!, key!, { auth: { persistSession: false } }),
    season: Number(date.slice(0, 4)),
  });
  const latest = [...new Map(rows
    .filter((row) => localDate(row.gameStartAt) === date)
    .filter((row) => row.payload.game.away.fbs || row.payload.game.home.fbs)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
    .map((row) => [row.providerGameId, row] as const)).values()];

  const games = latest.flatMap((row) => {
    const payload = row.payload;
    const anchor = resolveCfbCanonicalMarketAnchor({
      books: payload.market.currentBooks,
      contextLines: {
        homeSpread: payload.market.playbookLine?.homeSpread ?? null,
        totalLine: payload.market.playbookLine?.total ?? null,
      },
    });
    if (!anchor || payload.coverage.healthHolds.length > 0) return [];
    const independent = getCfbV1ForecastForGame({ game: payload.game }).forecast;
    const forecast = buildCfbMarketSharpAwareForecast({
      independentForecast: independent,
      anchor,
      current: payload.market.current,
      operationalOpening: payload.market.operationalOpening,
      sharpSplits: payload.market.sharpApiSplits ?? [],
      playbookLine: payload.market.playbookLine,
      publicSplits: payload.market.playbookSplits,
      kickoffWeather: payload.availability.weather,
      evaluatedAt: row.capturedAt,
    });
    const shared = {
      providerGameId: row.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      comparableCurrentBooks: payload.market.currentBooks,
      evaluatedAt: row.capturedAt,
      forecast,
      contextLines: {
        homeSpread: payload.market.playbookLine?.homeSpread ?? null,
        totalLine: payload.market.playbookLine?.total ?? null,
      },
    };
    const incumbent = grade(buildCfbV1DecisionBundle({
      ...shared,
      calibrationContract: "authoritative_pmf_identity",
    }), payload);
    const candidate = grade(buildCfbV1DecisionBundle({
      ...shared,
      calibrationContract: "authoritative_pmf_spread_counter_signal",
    }), payload);
    const before = incumbent.evaluatedBets.find((decision) => decision.market === "spread") ?? null;
    const after = candidate.evaluatedBets.find((decision) => decision.market === "spread") ?? null;
    if (!before || !after) return [];
    return [{
      providerGameId: row.providerGameId,
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      incumbent: compact(before),
      candidate: compact(after),
      sideChanged: before.side !== after.side,
      quoteChanged: quoteKey(before) !== quoteKey(after),
      gradeChange: gradeDelta(before.grade, after.grade),
      actionableChange: Number(actionable(after.grade)) - Number(actionable(before.grade)),
    }];
  });

  const incumbentGrades = gradeCounts(games.map((game) => game.incumbent.grade));
  const candidateGrades = gradeCounts(games.map((game) => game.candidate.grade));
  console.log(JSON.stringify({
    summary: {
      mode: "select_only_zero_writes_zero_provider_calls",
      date,
      games: latest.length,
      evaluatedSpreads: games.length,
      incumbentGrades,
      candidateGrades,
      incumbentActionables: Object.entries(incumbentGrades).filter(([grade]) => actionable(grade as CfbV1Grade)).reduce((sum, [, count]) => sum + count, 0),
      candidateActionables: Object.entries(candidateGrades).filter(([grade]) => actionable(grade as CfbV1Grade)).reduce((sum, [, count]) => sum + count, 0),
      promotions: games.filter((game) => game.gradeChange === "promotion").length,
      demotions: games.filter((game) => game.gradeChange === "demotion").length,
      sideChanges: games.filter((game) => game.sideChanged).length,
      exactQuoteChanges: games.filter((game) => game.quoteChanged).length,
      netActionableChange: games.reduce((sum, game) => sum + game.actionableChange, 0),
    },
    changedGames: games.filter((game) => game.sideChanged || game.gradeChange !== "unchanged"),
  }, null, 2));
}

function grade(bundle: CfbV1DecisionBundle, payload: Awaited<ReturnType<typeof readCfbForwardEvidence>>[number]["payload"]): CfbV1DecisionBundle {
  return applyCfbMarketSharpAwareGrades({
    bundle,
    homeTeam: payload.game.home.abbreviation,
    sharpSplits: payload.market.sharpApiSplits ?? [],
    playbookLine: payload.market.playbookLine,
    publicSplits: payload.market.playbookSplits,
    operationalOpening: payload.market.operationalOpening,
    current: payload.market.current,
  });
}

function compact(decision: CfbV1ExactPriceDecision) {
  return {
    side: decision.side,
    grade: decision.grade,
    forecastProbability: decision.forecastProbability,
    modelProbability: decision.modelProbability,
    marketFairProbability: decision.marketFairProbability,
    expectedValue: decision.expectedValue,
    quote: quoteKey(decision),
    calibrationFamily: decision.calibrationFamily,
    gradeAdjustment: decision.gradeAdjustment,
  };
}

function gradeCounts(grades: CfbV1Grade[]): Record<CfbV1Grade, number> {
  const counts: Record<CfbV1Grade, number> = { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0 };
  for (const grade of grades) counts[grade]++;
  return counts;
}

function gradeDelta(before: CfbV1Grade, after: CfbV1Grade): "promotion" | "demotion" | "unchanged" {
  const rank: Record<CfbV1Grade, number> = { "No Play": 0, Watchlist: 1, Lean: 2, "Best Angle": 3 };
  return rank[after] > rank[before] ? "promotion" : rank[after] < rank[before] ? "demotion" : "unchanged";
}

function quoteKey(decision: CfbV1ExactPriceDecision): string {
  return `${decision.evaluatedQuote.sportsbook}|${decision.evaluatedQuote.line}|${decision.evaluatedQuote.price}`;
}

function actionable(grade: CfbV1Grade): boolean { return grade === "Best Angle" || grade === "Lean"; }

function localDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
