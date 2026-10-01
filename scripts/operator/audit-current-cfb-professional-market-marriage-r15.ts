#!/usr/bin/env tsx

/** Read-only, exact-input current-board replay for the CFB professional model release. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { fetchCfbCurrentAdvancedState } from "../../lib/services/football/cfbCurrentAdvancedState";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import {
  buildCfbV1DecisionBundle,
  type CfbV1ExactPriceDecision,
  type CfbV1Grade,
  type CfbV1Market,
} from "../../lib/services/football/cfbV1Decision";
import { getCfbV1WeeklyForecasts } from "../../lib/services/football/cfbV1WeeklyForecast";
import { resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import {
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketSharpAwareForecast,
} from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { preferredCfbTargetBook } from "../../lib/services/football/cfbSharpApiOdds";
import {
  cfbMarketAnchorHealthHolds,
  publishCfbForwardDecisionBundle,
} from "../../lib/services/football/cfbForwardEvidenceWriter";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

const MARKETS: CfbV1Market[] = ["moneyline", "spread", "total"];
type AuditRow = {
  game: string;
  providerGameId: string;
  week: number;
  market: CfbV1Market;
  previous: ReturnType<typeof compact>;
  candidate: ReturnType<typeof compact>;
  result: "win" | "loss" | "push" | null;
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const settledMode = process.argv.includes("--settled");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const [rows, advanced] = await Promise.all([
    readCfbForwardEvidence({ client, season: 2026 }),
    fetchCfbCurrentAdvancedState({ season: 2026, now }),
  ]);
  const window = activeCfbWeeklyWindow(now);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (settledMode) {
      if (Date.parse(row.capturedAt) >= Date.parse(row.gameStartAt) || !findOutcome(row.payload.game, advanced.games)) continue;
    } else if (!isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)) continue;
    const previous = latest.get(row.providerGameId);
    const rowT60 = row.stage === "t60";
    const previousT60 = previous?.stage === "t60";
    if (!previous || (rowT60 && !previousT60) || (rowT60 === previousT60 && Date.parse(row.capturedAt) > Date.parse(previous.capturedAt))) latest.set(row.providerGameId, row);
  }
  const selected = [...latest.values()].sort((a, b) => a.gameStartAt.localeCompare(b.gameStartAt));
  const forecasts = getCfbV1WeeklyForecasts({ games: selected.map((row) => row.payload.game), advancedGames: advanced.games });
  const comparisons: AuditRow[] = [];
  const coherenceFailures: string[] = [];

  for (const row of selected) {
    const payload = row.payload;
    const weekly = forecasts.get(payload.game.providerGameId);
    if (!weekly) throw new Error(`Missing forecast ${payload.game.providerGameId}.`);
    const current = preferredCfbTargetBook(payload.market.currentBooks);
    const anchor = resolveCfbCanonicalMarketAnchor({
      books: payload.market.currentBooks,
      contextLines: {
        homeSpread: payload.market.playbookLine?.homeSpread ?? null,
        totalLine: payload.market.playbookLine?.total ?? null,
      },
    });
    const sharpSplits = payload.market.sharpApiSplits ?? [];
    const publicSplits = payload.market.playbookSplits;
    const operationalOpening = payload.market.operationalOpening;
    const weather = payload.availability.weather ?? null;
    const baseForecast = anchor ? buildCfbMarketSharpAwareForecast({
      independentForecast: weekly.forecast,
      anchor,
      current,
      operationalOpening,
      sharpSplits,
      playbookLine: payload.market.playbookLine,
      publicSplits,
      evaluatedAt: payload.capturedAt,
    }) : weekly.forecast;
    const forecast = anchor && weather && weather.independentTotalAdjustmentPoints < 0
      ? buildCfbMarketSharpAwareForecast({
          independentForecast: weekly.forecast,
          anchor,
          current,
          operationalOpening,
          sharpSplits,
          playbookLine: payload.market.playbookLine,
          publicSplits,
          kickoffWeather: weather,
          evaluatedAt: payload.capturedAt,
        })
      : baseForecast;
    const healthHolds = [
      ...(weekly.featureHealth.awayProfile === "neutral_imputation" ? ["away_model_team_profile_unavailable"] : []),
      ...(weekly.featureHealth.homeProfile === "neutral_imputation" ? ["home_model_team_profile_unavailable"] : []),
      ...cfbMarketAnchorHealthHolds(anchor),
    ];
    const fixedEvaluatedSportsbookByMarket = anchor && weather && weather.independentTotalAdjustmentPoints < 0
      ? Object.fromEntries(applyCfbMarketSharpAwareGrades({
          bundle: buildCfbV1DecisionBundle({
            providerGameId: payload.game.providerGameId,
            awayTeam: payload.game.away.abbreviation,
            homeTeam: payload.game.home.abbreviation,
            gameStartsAt: payload.game.scheduledStart,
            comparableCurrentBooks: payload.market.currentBooks,
            evaluatedAt: payload.capturedAt,
            healthHolds,
            forecast: baseForecast,
            contextLines: { homeSpread: payload.market.playbookLine?.homeSpread ?? null, totalLine: payload.market.playbookLine?.total ?? null },
          }),
          homeTeam: payload.game.home.abbreviation,
          sharpSplits,
          playbookLine: payload.market.playbookLine,
          publicSplits,
          operationalOpening,
          current,
        }).evaluatedBets.map((decision) => [decision.market, decision.evaluatedQuote.sportsbook]))
      : undefined;
    const rawBundle = buildCfbV1DecisionBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      comparableCurrentBooks: payload.market.currentBooks,
      evaluatedAt: payload.capturedAt,
      healthHolds,
      forecast,
      contextLines: { homeSpread: payload.market.playbookLine?.homeSpread ?? null, totalLine: payload.market.playbookLine?.total ?? null },
      fixedEvaluatedSportsbookByMarket,
    });
    const candidate = publishCfbForwardDecisionBundle(anchor ? applyCfbMarketSharpAwareGrades({
      bundle: rawBundle,
      homeTeam: payload.game.home.abbreviation,
      sharpSplits,
      playbookLine: payload.market.playbookLine,
      publicSplits,
      operationalOpening,
      current,
    }) : rawBundle, payload.market.playbookLine, payload.market.espnReferenceLine ?? null);
    if (Math.abs(candidate.forecast.expectedHomePoints + candidate.forecast.expectedAwayPoints - forecast.expectedTotal) > 1e-8) {
      coherenceFailures.push(payload.game.providerGameId);
    }
    const previous = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
    const currentDecisions = new Map(candidate.evaluatedBets.map((decision) => [decision.market, decision]));
    for (const market of MARKETS) comparisons.push({
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      providerGameId: payload.game.providerGameId,
      week: payload.game.providerWeek,
      market,
      previous: compact(previous.get(market)),
      candidate: compact(currentDecisions.get(market)),
      result: settle(currentDecisions.get(market), payload.game.home.abbreviation, findOutcome(payload.game, advanced.games)),
    });
  }

  const promotions = comparisons.filter((row) => rank(row.candidate?.grade) > rank(row.previous?.grade));
  const demotions = comparisons.filter((row) => rank(row.candidate?.grade) < rank(row.previous?.grade));
  const sideChanges = comparisons.filter((row) => row.previous?.side && row.candidate?.side && row.previous.side !== row.candidate.side);
  const priorActionable = comparisons.filter((row) => actionable(row.previous?.grade)).length;
  const candidateActionable = comparisons.filter((row) => actionable(row.candidate?.grade)).length;
  const resultSummary = summarizeResults(comparisons);
  console.log(JSON.stringify({
    release: "cfb_professional_market_marriage_current_board_audit_2026_10_01_r15",
    readOnly: true,
    providerRequests: 6,
    writes: 0,
    games: selected.length,
    markets: comparisons.length,
    advancedGames: advanced.games.length,
    previousGradeCounts: gradeCounts(comparisons.map((row) => row.previous?.grade)),
    candidateGradeCounts: gradeCounts(comparisons.map((row) => row.candidate?.grade)),
    priorActionable,
    candidateActionable,
    actionableDelta: candidateActionable - priorActionable,
    promotions: promotions.length,
    demotions: demotions.length,
    sideChanges: sideChanges.length,
    coherenceFailures,
    ...(settledMode ? {
      resultSummary,
      selectionWeeks1to2: summarizeResults(comparisons.filter((row) => row.week <= 2)),
      confirmationWeeks3to4: summarizeResults(comparisons.filter((row) => row.week >= 3 && row.week <= 4)),
    } : {
      promotionRows: promotions,
      demotionRows: demotions,
      sideChangeRows: sideChanges,
    }),
  }, null, 2));
}

function compact(decision: CfbV1ExactPriceDecision | undefined) {
  return decision ? { side: decision.side, grade: decision.grade, line: decision.evaluatedQuote.line, price: decision.evaluatedQuote.price, book: decision.evaluatedQuote.sportsbook } : null;
}

function rank(grade: CfbV1Grade | undefined): number { return grade === "Best Angle" ? 4 : grade === "Lean" ? 3 : grade === "Watchlist" ? 2 : grade === "No Play" ? 1 : 0; }
function actionable(grade: CfbV1Grade | undefined): boolean { return grade === "Best Angle" || grade === "Lean"; }
function gradeCounts(grades: Array<CfbV1Grade | undefined>) {
  return grades.reduce<Record<string, number>>((counts, grade) => {
    const key = grade ?? "Held";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function findOutcome(game: { scheduledStart: string; home: { name: string }; away: { name: string } }, outcomes: Awaited<ReturnType<typeof fetchCfbCurrentAdvancedState>>["games"]) {
  const home = normalizeName(game.home.name);
  const away = normalizeName(game.away.name);
  return outcomes.find((outcome) =>
    normalizeName(outcome.homeTeam) === home && normalizeName(outcome.awayTeam) === away &&
    Math.abs(Date.parse(outcome.scheduledStart) - Date.parse(game.scheduledStart)) <= 18 * 3_600_000) ?? null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll("'", "").replaceAll(".", "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function settle(decision: CfbV1ExactPriceDecision | undefined, homeTeam: string, outcome: Awaited<ReturnType<typeof fetchCfbCurrentAdvancedState>>["games"][number] | null): "win" | "loss" | "push" | null {
  if (!decision || !outcome) return null;
  let value: number;
  if (decision.market === "moneyline") value = decision.side === homeTeam ? outcome.homeScore - outcome.awayScore : outcome.awayScore - outcome.homeScore;
  else if (decision.market === "spread") {
    if (decision.evaluatedQuote.line === null) return null;
    value = decision.side.startsWith(homeTeam)
      ? outcome.homeScore + decision.evaluatedQuote.line - outcome.awayScore
      : outcome.awayScore + decision.evaluatedQuote.line - outcome.homeScore;
  } else {
    if (decision.evaluatedQuote.line === null) return null;
    const delta = outcome.homeScore + outcome.awayScore - decision.evaluatedQuote.line;
    value = /^over\b/i.test(decision.side) ? delta : -delta;
  }
  return Math.abs(value) < 1e-9 ? "push" : value > 0 ? "win" : "loss";
}

function summarizeResults(rows: AuditRow[]) {
  const summarize = (subset: AuditRow[]) => {
    const wins = subset.filter((row) => row.result === "win").length;
    const losses = subset.filter((row) => row.result === "loss").length;
    const pushes = subset.filter((row) => row.result === "push").length;
    return { rows: subset.length, wins, losses, pushes, decided: wins + losses, accuracy: wins + losses > 0 ? wins / (wins + losses) : null };
  };
  return {
    all: summarize(rows.filter((row) => row.result !== null)),
    actionable: summarize(rows.filter((row) => actionable(row.candidate?.grade) && row.result !== null)),
    bestAngle: summarize(rows.filter((row) => row.candidate?.grade === "Best Angle" && row.result !== null)),
    lean: summarize(rows.filter((row) => row.candidate?.grade === "Lean" && row.result !== null)),
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(rows.filter((row) => row.market === market && row.result !== null))])),
    actionableByMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(rows.filter((row) => row.market === market && actionable(row.candidate?.grade) && row.result !== null))])),
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
