#!/usr/bin/env tsx

/** Read-only same-snapshot CFB kickoff-weather replay. No writer or database mutation. */

import { createClient } from "@supabase/supabase-js";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import { OpenWeatherProvider } from "../../lib/providers/real_api/OpenWeatherProvider";
import { fetchBalldontlieNcaafResultsForDates, type NcaafGame } from "../../lib/services/football/balldontlieNcaafSlate";
import { collectCfbKickoffWeather } from "../../lib/services/football/cfbKickoffWeather";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { planCfbPriorResultReads } from "../../lib/services/football/cfbForwardEvidenceWriter";
import { selectLatestCfbMemberEvidenceRows } from "../../lib/services/football/cfbMemberFixture";
import { resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import { applyCfbMarketSharpAwareGrades, buildCfbMarketSharpAwareForecast } from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { normalizeCfbPlaybookLine, normalizeCfbPlaybookSplits, resolveCfbPlaybookEvidence } from "../../lib/services/football/cfbPlaybookEvidence";
import { buildCfbV1DecisionBundle, getCfbV1ForecastForGame, type CfbV1ExactPriceDecision, type CfbV1Grade, type CfbV1Market } from "../../lib/services/football/cfbV1Decision";
import { isGameInCfbWeeklyWindow, resolveCfbForwardWindow } from "../../lib/services/football/cfbWeeklyWindow";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const playbookKey = process.env.PLAYBOOK_API_KEY;
const bdlKey = process.env.BALLDONTLIE_API_KEY;
const weatherKey = process.env.OPENWEATHER_API_KEY;
if (!url || !serviceKey || !playbookKey || !bdlKey || !weatherKey) {
  throw new Error("Supabase read credentials and CFB/Playbook/OpenWeather provider keys are required.");
}

const now = new Date().toISOString();
const markets: CfbV1Market[] = ["moneyline", "spread", "total"];

async function main(): Promise<void> {
  const client = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const playbook = new PlaybookClient(playbookKey!);
  const [allRows, linesResult, splitsResult, venuesResult] = await Promise.all([
    readCfbForwardEvidence({ client, season: Number(now.slice(0, 4)) }),
    playbook.lines("ncaaf"),
    playbook.splits("ncaaf"),
    playbook.venueWeather("ncaaf"),
  ]);
  const window = resolveCfbForwardWindow({ now, evidence: allRows, advanceWithoutNextEvidence: true });
  const selected = selectLatestCfbMemberEvidenceRows(
    allRows.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)),
    now,
  ).filter((row) => row.payload.game.away.fbs || row.payload.game.home.fbs);
  const priorGames = await readPriorGames(allRows, window.boardStartDate);
  const weatherProvider = new OpenWeatherProvider(weatherKey!);
  const reports: Awaited<ReturnType<typeof replayGame>>[] = [];
  await mapWithConcurrency(selected, 6, async (row) => {
    reports.push(await replayGame({
      game: row.payload.game,
      payload: row.payload,
      priorGames,
      lines: linesResult.body.data ?? [],
      splits: splitsResult.body.data ?? [],
      venues: venuesResult.body.data ?? [],
      weatherProvider,
    }));
  });
  reports.sort((a, b) => a.matchup.localeCompare(b.matchup));
  const comparisons = reports.flatMap((report) => report.comparisons);
  const changes = comparisons.filter((row) => row.baseSide !== row.weatherSide || row.baseGrade !== row.weatherGrade);
  const totals = comparisons.filter((row) => row.market === "total");
  console.log(JSON.stringify({
    mode: "read_only_same_snapshot_cfb_kickoff_weather_replay_zero_writes",
    now,
    window: { start: window.boardStartDate, end: window.boardEndDate },
    games: reports.length,
    weather: {
      statusCounts: count(reports.map((row) => row.weatherStatus)),
      forecastsAvailable: reports.filter((row) => row.weatherStatus === "forecast_available").length,
      adjustedGames: reports.filter((row) => row.prescribedIndependentShift < 0).map((row) => ({
        matchup: row.matchup,
        prescribedIndependentShift: row.prescribedIndependentShift,
        appliedIndependentShift: row.appliedIndependentShift,
        authoritativeShift: row.authoritativeShift,
        reasons: row.weatherReasons,
      })),
      maxAbsoluteAuthoritativeShift: maximum(reports.map((row) => Math.abs(row.authoritativeShift))),
    },
    comparableMarkets: comparisons.length,
    baseGrades: gradeCounts(comparisons.map((row) => row.baseGrade)),
    weatherGrades: gradeCounts(comparisons.map((row) => row.weatherGrade)),
    actionableBefore: comparisons.filter((row) => actionable(row.baseGrade)).length,
    actionableAfter: comparisons.filter((row) => actionable(row.weatherGrade)).length,
    promotions: comparisons.filter((row) => rank(row.weatherGrade) > rank(row.baseGrade)).length,
    demotions: comparisons.filter((row) => rank(row.weatherGrade) < rank(row.baseGrade)).length,
    sideChanges: comparisons.filter((row) => row.baseSide !== row.weatherSide).length,
    totalSideChanges: totals.filter((row) => row.baseSide !== row.weatherSide).length,
    totalGradeChanges: totals.filter((row) => row.baseGrade !== row.weatherGrade).length,
    changes,
  }, null, 2));
}

async function replayGame(args: {
  game: NcaafGame;
  payload: Awaited<ReturnType<typeof readCfbForwardEvidence>>[number]["payload"];
  priorGames: NcaafGame[];
  lines: readonly unknown[];
  splits: readonly unknown[];
  venues: readonly unknown[];
  weatherProvider: OpenWeatherProvider;
}) {
  const matchup = `${args.game.away.abbreviation}@${args.game.home.abbreviation}`;
  const weather = await collectCfbKickoffWeather({
    game: args.game,
    stage: "unlocked",
    capturedAt: now,
    venueRows: args.venues,
    provider: args.weatherProvider,
  });
  const matched = resolveCfbPlaybookEvidence({ game: args.game, lines: args.lines, splits: args.splits });
  const playbookLine = matched ? normalizeCfbPlaybookLine(matched.lineRow, now) : null;
  const publicSplits = matched ? normalizeCfbPlaybookSplits(matched.splitRow, now) : null;
  const anchor = resolveCfbCanonicalMarketAnchor({
    books: args.payload.market.currentBooks,
    contextLines: { homeSpread: playbookLine?.homeSpread ?? null, totalLine: playbookLine?.total ?? null },
  });
  if (!anchor || Date.parse(args.game.scheduledStart) <= Date.parse(now)) {
    return {
      matchup,
      weatherStatus: weather.snapshot.status,
      prescribedIndependentShift: weather.snapshot.independentTotalAdjustmentPoints,
      appliedIndependentShift: 0,
      authoritativeShift: 0,
      weatherReasons: weather.snapshot.adjustmentReasons,
      comparisons: [] as Comparison[],
    };
  }
  const independent = getCfbV1ForecastForGame({ game: args.game, completedGames: args.priorGames }).forecast;
  const common = {
    independentForecast: independent,
    anchor,
    current: args.payload.market.current,
    operationalOpening: args.payload.market.operationalOpening,
    sharpSplits: args.payload.market.sharpApiSplits ?? [],
    playbookLine,
    publicSplits,
    evaluatedAt: now,
  };
  const baseForecast = buildCfbMarketSharpAwareForecast(common);
  const weatherForecast = buildCfbMarketSharpAwareForecast({ ...common, kickoffWeather: weather.snapshot });
  const base = decisions(args, baseForecast, playbookLine, publicSplits);
  const fixedEvaluatedSportsbookByMarket = Object.fromEntries([...base.entries()].map(([market, decision]) => [market, decision.evaluatedQuote.sportsbook]));
  const withWeather = decisions(args, weatherForecast, playbookLine, publicSplits, fixedEvaluatedSportsbookByMarket);
  const comparisons = markets.flatMap((market): Comparison[] => {
    const first = base.get(market);
    const second = withWeather.get(market);
    return first && second ? [{
      matchup,
      market,
      baseSide: first.side,
      weatherSide: second.side,
      baseGrade: first.grade,
      weatherGrade: second.grade,
      baseProbabilityGrade: first.probabilityGrade,
      weatherProbabilityGrade: second.probabilityGrade,
      baseProbability: first.modelProbability,
      weatherProbability: second.modelProbability,
      baseEdgePercentagePoints: first.edgePercentagePoints,
      weatherEdgePercentagePoints: second.edgePercentagePoints,
      baseExpectedValue: first.expectedValue,
      weatherExpectedValue: second.expectedValue,
      baseQuote: first.evaluatedQuote,
      weatherQuote: second.evaluatedQuote,
      baseEvidenceDirections: first.gradeAdjustment ? { sharp: first.gradeAdjustment.sharpDirection, public: first.gradeAdjustment.publicDirection, movement: first.gradeAdjustment.movementDirection } : null,
      weatherEvidenceDirections: second.gradeAdjustment ? { sharp: second.gradeAdjustment.sharpDirection, public: second.gradeAdjustment.publicDirection, movement: second.gradeAdjustment.movementDirection } : null,
      baseReasonCodes: first.gradeAdjustment?.reasonCodes ?? [],
      weatherReasonCodes: second.gradeAdjustment?.reasonCodes ?? [],
    }] : [];
  });
  return {
    matchup,
    weatherStatus: weather.snapshot.status,
    prescribedIndependentShift: weather.snapshot.independentTotalAdjustmentPoints,
    appliedIndependentShift: weatherForecast.weatherAdjustment.appliedIndependentTotalShiftPoints,
    authoritativeShift: weatherForecast.weatherAdjustment.authoritativeExpectedTotalShiftPoints,
    weatherReasons: weather.snapshot.adjustmentReasons,
    comparisons,
  };
}

function decisions(
  args: Parameters<typeof replayGame>[0],
  forecast: ReturnType<typeof buildCfbMarketSharpAwareForecast>,
  playbookLine: ReturnType<typeof normalizeCfbPlaybookLine>,
  publicSplits: ReturnType<typeof normalizeCfbPlaybookSplits>,
  fixedEvaluatedSportsbookByMarket?: Partial<Record<CfbV1Market, string>>,
): Map<CfbV1Market, CfbV1ExactPriceDecision> {
  const bundle = buildCfbV1DecisionBundle({
    providerGameId: args.game.providerGameId,
    awayTeam: args.game.away.abbreviation,
    homeTeam: args.game.home.abbreviation,
    gameStartsAt: args.game.scheduledStart,
    comparableCurrentBooks: args.payload.market.currentBooks,
    stage: "unlocked",
    evaluatedAt: now,
    lockedAt: null,
    healthHolds: args.payload.coverage.healthHolds,
    forecast,
    contextLines: { homeSpread: playbookLine?.homeSpread ?? null, totalLine: playbookLine?.total ?? null },
    calibrationContract: "authoritative_pmf_identity",
    fixedEvaluatedSportsbookByMarket,
  });
  const graded = applyCfbMarketSharpAwareGrades({
    homeTeam: args.game.home.abbreviation,
    bundle,
    sharpSplits: args.payload.market.sharpApiSplits ?? [],
    playbookLine,
    publicSplits,
    operationalOpening: args.payload.market.operationalOpening,
  });
  return new Map(graded.evaluatedBets.map((decision) => [decision.market, decision]));
}

type Comparison = {
  matchup: string;
  market: CfbV1Market;
  baseSide: string;
  weatherSide: string;
  baseGrade: CfbV1Grade;
  weatherGrade: CfbV1Grade;
  baseProbabilityGrade: CfbV1Grade;
  weatherProbabilityGrade: CfbV1Grade;
  baseProbability: number;
  weatherProbability: number;
  baseEdgePercentagePoints: number;
  weatherEdgePercentagePoints: number;
  baseExpectedValue: number;
  weatherExpectedValue: number;
  baseQuote: CfbV1ExactPriceDecision["evaluatedQuote"];
  weatherQuote: CfbV1ExactPriceDecision["evaluatedQuote"];
  baseEvidenceDirections: { sharp: string; public: string; movement: string } | null;
  weatherEvidenceDirections: { sharp: string; public: string; movement: string } | null;
  baseReasonCodes: string[];
  weatherReasonCodes: string[];
};

async function readPriorGames(rows: Awaited<ReturnType<typeof readCfbForwardEvidence>>, before: string): Promise<NcaafGame[]> {
  const games: NcaafGame[] = [];
  for (const read of planCfbPriorResultReads({ rows, before })) {
    const result = await fetchBalldontlieNcaafResultsForDates({ gameIds: read.gameIds, dates: read.dates, apiKey: bdlKey!, pageBudget: 4 });
    games.push(...result.games.filter((game) => game.awayScore !== null && game.homeScore !== null));
  }
  return games;
}

async function mapWithConcurrency<T>(values: T[], concurrency: number, run: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const value = values[cursor++];
      if (value !== undefined) await run(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
}

function count(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function gradeCounts(grades: CfbV1Grade[]): Record<CfbV1Grade, number> {
  const result: Record<CfbV1Grade, number> = { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0 };
  for (const grade of grades) result[grade] += 1;
  return result;
}

function actionable(grade: CfbV1Grade): boolean { return grade === "Best Angle" || grade === "Lean"; }
function rank(grade: CfbV1Grade): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
function maximum(values: number[]): number { return values.length ? Math.max(...values) : 0; }

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
