import { createClient } from "@supabase/supabase-js";
import {
  annotateCfbCrossMarketGradeCoherence,
  buildCfbMarketEvidenceGradeShadow,
  buildCfbMarketSharpAwareShadowForecast,
  CFB_MARKET_SHARP_AWARE_SHADOW_RELEASE,
  type CfbMarketEvidenceGradeShadow,
} from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import {
  buildCfbV1DecisionBundle,
  getCfbV1Forecast,
  type CfbV1ExactPriceDecision,
  type CfbV1Grade,
  type CfbV1Market,
} from "../../lib/services/football/cfbV1Decision";

const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length) ?? "2026-08-29";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

async function main(): Promise<void> {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const rows = await readCfbForwardEvidence({ client, season: Number(date.slice(0, 4)) });
  const latest = [...new Map(rows
  .filter((row) => localDate(row.gameStartAt) === date)
  .filter((row) => row.payload.game.away.fbs || row.payload.game.home.fbs)
  .sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt))
  .map((row) => [row.providerGameId, row] as const)).values()];

const games = latest.map((row) => {
  const payload = row.payload;
  const independent = getCfbV1Forecast(row.providerGameId);
  const anchor = resolveCfbCanonicalMarketAnchor({
    books: payload.market.currentBooks,
    contextLines: {
      homeSpread: payload.market.playbookLine?.homeSpread ?? null,
      totalLine: payload.market.playbookLine?.total ?? null,
    },
  });
  if (!anchor) {
    return {
      providerGameId: row.providerGameId,
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      status: "market_anchor_unavailable",
      baseDecisions: payload.decisions.evaluatedBets.length,
    };
  }
  const forecast = buildCfbMarketSharpAwareShadowForecast({
    independentForecast: independent,
    anchor,
    current: payload.market.current,
    operationalOpening: payload.market.operationalOpening,
    sharpSplits: payload.market.sharpApiSplits ?? [],
    playbookLine: payload.market.playbookLine,
    publicSplits: payload.market.playbookSplits,
    evaluatedAt: row.capturedAt,
  });
  assertPmf(forecast);
  const candidateBundle = buildCfbV1DecisionBundle({
    providerGameId: row.providerGameId,
    awayTeam: payload.game.away.abbreviation,
    homeTeam: payload.game.home.abbreviation,
    gameStartsAt: payload.game.scheduledStart,
    comparableCurrentBooks: payload.market.currentBooks,
    stage: "unlocked",
    evaluatedAt: row.capturedAt,
    healthHolds: payload.coverage.healthHolds,
    forecast,
    contextLines: {
      homeSpread: payload.market.playbookLine?.homeSpread ?? null,
      totalLine: payload.market.playbookLine?.total ?? null,
    },
  });
  const baseByMarket = byMarket(payload.decisions.evaluatedBets);
  const candidateByMarket = byMarket(candidateBundle.evaluatedBets);
  const evidenceByMarket = new Map(annotateCfbCrossMarketGradeCoherence(candidateBundle.evaluatedBets.map((decision) =>
    buildCfbMarketEvidenceGradeShadow({
      decision,
      selectedSide: canonicalSide(payload.game.home.abbreviation, decision),
      sharpSplits: payload.market.sharpApiSplits ?? [],
      playbookLine: payload.market.playbookLine,
      publicSplits: payload.market.playbookSplits,
      operationalOpening: payload.market.operationalOpening,
    }))).map((row) => [row.market, row] as const));
  const marketRows = (["moneyline", "spread", "total"] as const).map((market) => {
    const base = baseByMarket.get(market) ?? null;
    const candidate = candidateByMarket.get(market) ?? null;
    if (!candidate) return { market, status: "candidate_unavailable", baseGrade: base?.grade ?? null };
    const overlay = evidenceByMarket.get(market)!;
    return {
      market,
      status: "evaluated",
      baseSide: base?.side ?? null,
      candidateSide: candidate.side,
      baseGrade: base?.grade ?? null,
      probabilityGrade: candidate.grade,
      candidateGrade: overlay.finalGrade,
      baseProbability: base?.modelProbability ?? null,
      candidateProbability: candidate.modelProbability,
      probabilityChangePp: base ? round(100 * (candidate.modelProbability - base.modelProbability)) : null,
      baseEdgePp: base?.edgePercentagePoints ?? null,
      candidateEdgePp: candidate.edgePercentagePoints,
      candidateEvPct: 100 * candidate.expectedValue,
      baseQuote: base ? quoteKey(base) : null,
      candidateQuote: quoteKey(candidate),
      sharpDirection: overlay.sharpDirection,
      sharpGapPp: overlay.sharpGapPp,
      movementDirection: overlay.movementDirection,
      gradeChange: gradeDelta(base?.grade ?? "No Play", overlay.finalGrade),
      reasonCodes: overlay.reasonCodes,
    };
  });
  return {
    providerGameId: row.providerGameId,
    matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
    status: "evaluated",
    capturedAt: row.capturedAt,
    baseScore: [round(independent.expectedAwayPoints), round(independent.expectedHomePoints)],
    candidateScore: [round(forecast.expectedAwayPoints), round(forecast.expectedHomePoints)],
    scoreChange: [round(forecast.expectedAwayPoints - independent.expectedAwayPoints), round(forecast.expectedHomePoints - independent.expectedHomePoints)],
    baseHomeWinPct: round(100 * independent.homeWinProbability),
    candidateHomeWinPct: round(100 * forecast.homeWinProbability),
    homeWinChangePp: round(100 * (forecast.homeWinProbability - independent.homeWinProbability)),
    marketAnchor: anchor,
    sharpAdjustment: forecast.sharpAdjustment,
    markets: marketRows,
  };
});

type EvaluatedMarketReport = {
  status: "evaluated";
  baseSide: string | null;
  candidateSide: string;
  baseGrade: CfbV1Grade | null;
  probabilityGrade: CfbV1Grade;
  candidateGrade: CfbV1Grade;
  baseQuote: string | null;
  candidateQuote: string;
  sharpDirection: CfbMarketEvidenceGradeShadow["sharpDirection"];
  movementDirection: CfbMarketEvidenceGradeShadow["movementDirection"];
  probabilityChangePp: number | null;
  gradeChange: "promotion" | "demotion" | "unchanged";
};
const evaluatedMarkets = games.flatMap((game) => "markets" in game ? game.markets : [])
  .filter((market): market is NonNullable<typeof market> & EvaluatedMarketReport => market?.status === "evaluated");
const summary = {
  release: CFB_MARKET_SHARP_AWARE_SHADOW_RELEASE,
  mode: "select_only_zero_writes_zero_provider_calls",
  date,
  games: games.length,
  markets: evaluatedMarkets.length,
  baseGrades: gradeCounts(evaluatedMarkets.map((market) => market.baseGrade ?? "No Play")),
  probabilityGrades: gradeCounts(evaluatedMarkets.map((market) => market.probabilityGrade)),
  finalShadowGrades: gradeCounts(evaluatedMarkets.map((market) => market.candidateGrade)),
  promotions: evaluatedMarkets.filter((market) => market.gradeChange === "promotion").length,
  demotions: evaluatedMarkets.filter((market) => market.gradeChange === "demotion").length,
  netActionableChange: actionable(evaluatedMarkets.map((market) => market.candidateGrade)) -
    actionable(evaluatedMarkets.map((market) => market.baseGrade ?? "No Play")),
  sideChanges: evaluatedMarkets.filter((market) => market.baseSide !== null && market.baseSide !== market.candidateSide).length,
  exactQuoteChanges: evaluatedMarkets.filter((market) => market.baseQuote !== null && market.baseQuote !== market.candidateQuote).length,
  strictSharpMarkets: evaluatedMarkets.filter((market) => market.sharpDirection !== "unknown").length,
  sameBookMovementMarkets: evaluatedMarkets.filter((market) => market.movementDirection !== "unknown").length,
  maxAbsProbabilityChangePp: Math.max(0, ...evaluatedMarkets.map((market) => Math.abs(market.probabilityChangePp ?? 0))),
};

  console.log(JSON.stringify({ summary, games }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function byMarket(decisions: CfbV1ExactPriceDecision[]): Map<CfbV1Market, CfbV1ExactPriceDecision> {
  return new Map(decisions.map((decision) => [decision.market, decision]));
}

function canonicalSide(home: string, decision: CfbV1ExactPriceDecision): "home" | "away" | "over" | "under" {
  if (decision.market === "total") return /^over\b/i.test(decision.side) ? "over" : "under";
  return decision.side.startsWith(home) ? "home" : "away";
}

function quoteKey(decision: CfbV1ExactPriceDecision): string {
  return [decision.evaluatedQuote.sportsbook, decision.evaluatedQuote.line, decision.evaluatedQuote.price].join("|");
}

function gradeCounts(grades: CfbV1Grade[]): Record<CfbV1Grade, number> {
  const output: Record<CfbV1Grade, number> = { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0 };
  for (const grade of grades) output[grade]++;
  return output;
}

function gradeDelta(before: CfbV1Grade, after: CfbV1Grade): "promotion" | "demotion" | "unchanged" {
  const rank: Record<CfbV1Grade, number> = { "No Play": 0, Watchlist: 1, Lean: 2, "Best Angle": 3 };
  return rank[after] > rank[before] ? "promotion" : rank[after] < rank[before] ? "demotion" : "unchanged";
}

function actionable(grades: CfbV1Grade[]): number {
  return grades.filter((grade) => grade === "Best Angle" || grade === "Lean").length;
}

function assertPmf(forecast: ReturnType<typeof buildCfbMarketSharpAwareShadowForecast>): void {
  const mass = forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0);
  const home = forecast.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  const away = forecast.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  if (Math.abs(mass - 1) > 1e-9 || Math.abs(home - forecast.expectedHomePoints) > 1e-9 || Math.abs(away - forecast.expectedAwayPoints) > 1e-9) {
    throw new Error(`${forecast.providerGameId} shadow PMF coherence failed.`);
  }
}

function localDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
