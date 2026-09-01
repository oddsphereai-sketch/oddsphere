import { createClient } from "@supabase/supabase-js";
import { fetchBalldontlieNcaafResultsForDates, type NcaafGame } from "../../lib/services/football/balldontlieNcaafSlate";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { planCfbPriorResultReads } from "../../lib/services/football/cfbForwardEvidenceWriter";
import { selectLatestCfbMemberEvidenceRows } from "../../lib/services/football/cfbMemberFixture";
import { resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import {
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketSharpAwareForecast,
  CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
} from "../../lib/services/football/cfbMarketSharpAwareShadow";
import {
  buildCfbV1DecisionBundle,
  getCfbV1ForecastForGame,
  type CfbV1ExactPriceDecision,
  type CfbV1Grade,
  type CfbV1Market,
} from "../../lib/services/football/cfbV1Decision";
import { isGameInCfbWeeklyWindow, resolveCfbForwardWindow } from "../../lib/services/football/cfbWeeklyWindow";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.BALLDONTLIE_API_KEY;
if (!url || !key || !apiKey) throw new Error("Supabase and BALLDONTLIE read credentials are required.");

const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
const full = process.argv.includes("--full");

async function main(): Promise<void> {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const allRows = await readCfbForwardEvidence({ client, season: Number(now.slice(0, 4)) });
  const window = resolveCfbForwardWindow({ now, evidence: allRows, advanceWithoutNextEvidence: true });
  const windowRows = allRows.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
  const selected = selectLatestCfbMemberEvidenceRows(windowRows, now)
    .filter((row) => row.payload.game.away.fbs || row.payload.game.home.fbs)
    .sort((first, second) => Date.parse(first.gameStartAt) - Date.parse(second.gameStartAt));
  const priorResults = await readPriorResults(allRows, window.boardStartDate);
  const reports = selected.map((row) => {
    const base = byMarket(row.payload.decisions.evaluatedBets);
    if (row.stage === "t60" || Date.parse(row.gameStartAt) <= Date.parse(now)) {
      return {
        matchup: matchup(row.payload.game),
        status: "immutable" as const,
        markets: [],
      };
    }
    const anchor = resolveCfbCanonicalMarketAnchor({
      books: row.payload.market.currentBooks,
      contextLines: {
        homeSpread: row.payload.market.playbookLine?.homeSpread ?? null,
        totalLine: row.payload.market.playbookLine?.total ?? null,
      },
    });
    if (!anchor) return { matchup: matchup(row.payload.game), status: "anchor_unavailable" as const, markets: [] };
    const independent = getCfbV1ForecastForGame({ game: row.payload.game, completedGames: priorResults.games }).forecast;
    const forecast = buildCfbMarketSharpAwareForecast({
      independentForecast: independent,
      anchor,
      current: row.payload.market.current,
      operationalOpening: row.payload.market.operationalOpening,
      sharpSplits: row.payload.market.sharpApiSplits ?? [],
      playbookLine: row.payload.market.playbookLine,
      publicSplits: row.payload.market.playbookSplits,
      evaluatedAt: row.capturedAt,
    });
    const candidate = applyCfbMarketSharpAwareGrades({
      homeTeam: row.payload.game.home.abbreviation,
      bundle: buildCfbV1DecisionBundle({
        providerGameId: row.providerGameId,
        awayTeam: row.payload.game.away.abbreviation,
        homeTeam: row.payload.game.home.abbreviation,
        gameStartsAt: row.payload.game.scheduledStart,
        comparableCurrentBooks: row.payload.market.currentBooks,
        stage: "unlocked",
        evaluatedAt: row.capturedAt,
        healthHolds: row.payload.coverage.healthHolds,
        forecast,
        contextLines: {
          homeSpread: row.payload.market.playbookLine?.homeSpread ?? null,
          totalLine: row.payload.market.playbookLine?.total ?? null,
        },
        calibrationContract: "authoritative_pmf_identity",
      }),
      sharpSplits: row.payload.market.sharpApiSplits ?? [],
      playbookLine: row.payload.market.playbookLine,
      publicSplits: row.payload.market.playbookSplits,
      operationalOpening: row.payload.market.operationalOpening,
    });
    const candidateByMarket = byMarket(candidate.evaluatedBets);
    const markets = (["moneyline", "spread", "total"] as const).map((market) => compare(market, base.get(market) ?? null, candidateByMarket.get(market) ?? null));
    return {
      matchup: matchup(row.payload.game),
      status: "evaluated" as const,
      capturedAt: row.capturedAt,
      baseScore: [round(row.payload.decisions.forecast.expectedAwayPoints), round(row.payload.decisions.forecast.expectedHomePoints)],
      candidateScore: [round(forecast.expectedAwayPoints), round(forecast.expectedHomePoints)],
      scoreChange: [round(forecast.expectedAwayPoints - row.payload.decisions.forecast.expectedAwayPoints), round(forecast.expectedHomePoints - row.payload.decisions.forecast.expectedHomePoints)],
      publicAdjustment: forecast.publicConsensusAdjustment,
      sharpAdjustment: forecast.sharpAdjustment,
      markets,
    };
  });

  const markets = reports.flatMap((report) => report.status === "evaluated" ? report.markets : []);
  const comparable = markets.filter((row) => row.status === "comparable");
  const evaluatedReports = reports.filter((report) => report.status === "evaluated");
  const summary = {
    release: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
    mode: "read_only_current_slate_replay_zero_writes",
    now,
    window: { start: window.boardStartDate, end: window.boardEndDate },
    fbsGames: selected.length,
    evaluatedGames: reports.filter((row) => row.status === "evaluated").length,
    immutableGames: reports.filter((row) => row.status === "immutable").length,
    anchorUnavailableGames: reports.filter((row) => row.status === "anchor_unavailable").length,
    comparableMarkets: comparable.length,
    comparableByMarket: countByMarket(comparable),
    gradesByMarket: gradesByMarket(comparable, "candidateGrade"),
    probabilityRangeByMarket: probabilityRangeByMarket(comparable),
    selectedDirectionByMarket: selectedDirectionByMarket(comparable, selected),
    baseGrades: gradeCounts(comparable.map((row) => row.baseGrade)),
    candidateGrades: gradeCounts(comparable.map((row) => row.candidateGrade)),
    baseActionable: actionable(comparable.map((row) => row.baseGrade)),
    candidateActionable: actionable(comparable.map((row) => row.candidateGrade)),
    baseActionableByMarket: actionableByMarket(comparable, "baseGrade"),
    candidateActionableByMarket: actionableByMarket(comparable, "candidateGrade"),
    promotions: comparable.filter((row) => gradeRank(row.candidateGrade) > gradeRank(row.baseGrade)).length,
    demotions: comparable.filter((row) => gradeRank(row.candidateGrade) < gradeRank(row.baseGrade)).length,
    sideChanges: comparable.filter((row) => row.baseSide !== row.candidateSide).length,
    publicSupport: comparable.filter((row) => row.publicDirection === "support").length,
    publicResistance: comparable.filter((row) => row.publicDirection === "resistance").length,
    publicNeutral: comparable.filter((row) => row.publicDirection === "neutral").length,
    publicUnknown: comparable.filter((row) => row.publicDirection === "unknown").length,
    exactQuoteChanges: comparable.filter((row) => row.baseQuote !== row.candidateQuote).length,
    unchangedTuples: comparable.filter((row) => row.baseSide === row.candidateSide && row.baseGrade === row.candidateGrade && row.baseQuote === row.candidateQuote).length,
    publicSplitForecastGames: evaluatedReports.filter((row) => row.publicAdjustment.source !== null).length,
    publicPointShiftGames: evaluatedReports.filter((row) => Math.abs(row.publicAdjustment.homeMarginShiftPoints) > 0 || Math.abs(row.publicAdjustment.totalShiftPoints) > 0).length,
    projectionChangedGames: evaluatedReports.filter((row) => row.scoreChange.some((value) => Math.abs(value) > 0.0001)).length,
    maxAbsExpectedTeamScoreChange: Math.max(0, ...evaluatedReports.flatMap((row) => row.scoreChange.map(Math.abs))),
    maxAbsMarketProbabilityChangePp: Math.max(0, ...comparable.map((row) => Math.abs(row.probabilityChangePp))),
    providerResultReads: priorResults.providerRequests,
  };
  const changes = reports.flatMap((report) => report.markets
    .filter((market) => market.status === "comparable" && (market.baseGrade !== market.candidateGrade || market.baseSide !== market.candidateSide))
    .map((market) => ({ matchup: report.matchup, ...market })));
  console.log(JSON.stringify({ summary, changes, ...(full ? { games: reports } : {}) }, null, 2));
}

function compare(market: CfbV1Market, base: CfbV1ExactPriceDecision | null, candidate: CfbV1ExactPriceDecision | null) {
  if (!base || !candidate) return { market, status: "not_comparable" as const, baseGrade: base?.grade ?? null, candidateGrade: candidate?.grade ?? null };
  return {
    market,
    status: "comparable" as const,
    baseSide: base.side,
    candidateSide: candidate.side,
    baseGrade: base.grade,
    candidateGrade: candidate.grade,
    probabilityGrade: candidate.probabilityGrade ?? candidate.grade,
    baseProbability: round(base.modelProbability),
    candidateProbability: round(candidate.modelProbability),
    probabilityChangePp: round(100 * (candidate.modelProbability - base.modelProbability)),
    baseEdgePp: round(base.edgePercentagePoints),
    candidateEdgePp: round(candidate.edgePercentagePoints),
    candidateEvPct: round(100 * candidate.expectedValue),
    publicDirection: candidate.gradeAdjustment?.publicDirection ?? "unknown",
    sharpDirection: candidate.gradeAdjustment?.sharpDirection ?? "unknown",
    movementDirection: candidate.gradeAdjustment?.movementDirection ?? "unknown",
    reasonCodes: candidate.gradeAdjustment?.reasonCodes ?? [],
    baseQuote: quote(base),
    candidateQuote: quote(candidate),
  };
}

async function readPriorResults(rows: Awaited<ReturnType<typeof readCfbForwardEvidence>>, before: string): Promise<{ games: NcaafGame[]; providerRequests: number }> {
  const games: NcaafGame[] = [];
  let providerRequests = 0;
  for (const read of planCfbPriorResultReads({ rows, before })) {
    const result = await fetchBalldontlieNcaafResultsForDates({ gameIds: read.gameIds, dates: read.dates, apiKey: apiKey!, pageBudget: 4 });
    providerRequests += result.providerRequests;
    games.push(...result.games.filter((game) => game.awayScore !== null && game.homeScore !== null));
  }
  return { games, providerRequests };
}

function byMarket(decisions: CfbV1ExactPriceDecision[]): Map<CfbV1Market, CfbV1ExactPriceDecision> {
  return new Map(decisions.map((decision) => [decision.market, decision]));
}
function matchup(game: NcaafGame): string { return `${game.away.abbreviation}@${game.home.abbreviation}`; }
function quote(decision: CfbV1ExactPriceDecision): string { return `${decision.evaluatedQuote.sportsbook}|${decision.evaluatedQuote.line ?? "ML"}|${decision.evaluatedQuote.price}`; }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
function gradeRank(grade: CfbV1Grade): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
function gradeCounts(grades: CfbV1Grade[]): Record<CfbV1Grade, number> {
  const counts: Record<CfbV1Grade, number> = { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0 };
  for (const grade of grades) counts[grade]++;
  return counts;
}
function actionable(grades: CfbV1Grade[]): number { return grades.filter((grade) => grade === "Best Angle" || grade === "Lean").length; }
function actionableByMarket(rows: Array<{ market: CfbV1Market; baseGrade: CfbV1Grade; candidateGrade: CfbV1Grade }>, field: "baseGrade" | "candidateGrade"): Record<CfbV1Market, number> {
  const counts: Record<CfbV1Market, number> = { moneyline: 0, spread: 0, total: 0 };
  for (const row of rows) if (row[field] === "Best Angle" || row[field] === "Lean") counts[row.market]++;
  return counts;
}

function countByMarket(rows: Array<{ market: CfbV1Market }>): Record<CfbV1Market, number> {
  return rows.reduce<Record<CfbV1Market, number>>((counts, row) => {
    counts[row.market] += 1;
    return counts;
  }, { moneyline: 0, spread: 0, total: 0 });
}

function gradesByMarket(
  rows: Array<{ market: CfbV1Market; baseGrade: CfbV1Grade; candidateGrade: CfbV1Grade }>,
  field: "baseGrade" | "candidateGrade",
): Record<CfbV1Market, Record<CfbV1Grade, number>> {
  const counts = {
    moneyline: gradeCounts([]), spread: gradeCounts([]), total: gradeCounts([]),
  };
  for (const row of rows) counts[row.market][row[field]] += 1;
  return counts;
}

function probabilityRangeByMarket(
  rows: Array<{ market: CfbV1Market; candidateProbability: number }>,
): Record<CfbV1Market, { minimum: number | null; maximum: number | null; spanPp: number | null }> {
  return Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => {
    const values = rows.filter((row) => row.market === market).map((row) => row.candidateProbability);
    const minimum = values.length > 0 ? Math.min(...values) : null;
    const maximum = values.length > 0 ? Math.max(...values) : null;
    return [market, { minimum, maximum, spanPp: minimum === null || maximum === null ? null : round(100 * (maximum - minimum)) }];
  })) as Record<CfbV1Market, { minimum: number | null; maximum: number | null; spanPp: number | null }>;
}

function selectedDirectionByMarket(
  rows: Array<{ market: CfbV1Market; candidateSide: string }>,
  selected: Array<{ payload: { game: NcaafGame } }>,
): Record<CfbV1Market, Record<string, number>> {
  const homeTeams = new Set(selected.map((row) => row.payload.game.home.abbreviation));
  const awayTeams = new Set(selected.map((row) => row.payload.game.away.abbreviation));
  const counts: Record<CfbV1Market, Record<string, number>> = {
    moneyline: { home: 0, away: 0 }, spread: { home: 0, away: 0 }, total: { over: 0, under: 0 },
  };
  for (const row of rows) {
    if (row.market === "total") counts.total[row.candidateSide.startsWith("Over") ? "over" : "under"] += 1;
    else if (homeTeams.has(row.candidateSide.split(" ")[0]!)) counts[row.market].home += 1;
    else if (awayTeams.has(row.candidateSide.split(" ")[0]!)) counts[row.market].away += 1;
  }
  return counts;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
