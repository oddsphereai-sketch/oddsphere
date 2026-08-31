import { createClient } from "@supabase/supabase-js";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import { fetchBalldontlieNcaafResultsForDates, type NcaafGame } from "../../lib/services/football/balldontlieNcaafSlate";
import {
  normalizeCfbPlaybookLine,
  normalizeCfbPlaybookSplits,
  resolveCfbPlaybookEvidence,
} from "../../lib/services/football/cfbPlaybookEvidence";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { planCfbPriorResultReads } from "../../lib/services/football/cfbForwardEvidenceWriter";
import { selectLatestCfbMemberEvidenceRows } from "../../lib/services/football/cfbMemberFixture";
import { resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import { applyCfbMarketSharpAwareGrades, buildCfbMarketSharpAwareForecast } from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { buildCfbV1DecisionBundle, getCfbV1ForecastForGame, type CfbV1ExactPriceDecision, type CfbV1Grade, type CfbV1Market } from "../../lib/services/football/cfbV1Decision";
import { isGameInCfbWeeklyWindow, resolveCfbForwardWindow } from "../../lib/services/football/cfbWeeklyWindow";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const playbookKey = process.env.PLAYBOOK_API_KEY;
const bdlKey = process.env.BALLDONTLIE_API_KEY;
if (!url || !key || !playbookKey || !bdlKey) throw new Error("Supabase read credentials, PLAYBOOK_API_KEY, and BALLDONTLIE_API_KEY are required.");

const now = new Date().toISOString();

async function main(): Promise<void> {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const [allRows, linesResult, splitsResult] = await Promise.all([
    readCfbForwardEvidence({ client, season: Number(now.slice(0, 4)) }),
    new PlaybookClient(playbookKey!).lines("ncaaf"),
    new PlaybookClient(playbookKey!).splits("ncaaf"),
  ]);
  const window = resolveCfbForwardWindow({ now, evidence: allRows, advanceWithoutNextEvidence: true });
  const selected = selectLatestCfbMemberEvidenceRows(
    allRows.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)),
    now,
  ).filter((row) => row.payload.game.away.fbs || row.payload.game.home.fbs);
  const lines = linesResult.body.data ?? [];
  const splits = splitsResult.body.data ?? [];
  const priorGames = await readPriorGames(allRows, window.boardStartDate);
  const reports = selected.map((row) => compareRow(row.payload.game, row.payload, row.stage, lines, splits, priorGames));
  const comparable = reports.flatMap((report) => report.markets).filter((market) => market.comparable);
  const changes = comparable.filter((market) => market.baseGrade !== market.candidateGrade || market.baseSide !== market.candidateSide);
  console.log(JSON.stringify({
    mode: "read_only_same_snapshot_playbook_identity_replay_zero_writes",
    now,
    window: { start: window.boardStartDate, end: window.boardEndDate },
    fbsInvolvedGames: selected.length,
    playbookRows: { lines: lines.length, splits: splits.length },
    legacyMatchedGames: reports.filter((report) => report.legacyMatched).length,
    candidateMatchedGames: reports.filter((report) => report.candidateMatched).length,
    recoveredGames: reports.filter((report) => !report.legacyMatched && report.candidateMatched).map((report) => report.matchup),
    stillUnpublishedGames: reports.filter((report) => !report.candidateMatched).map((report) => report.matchup),
    comparableMarkets: comparable.length,
    baseGrades: gradeCounts(comparable.map((market) => market.baseGrade)),
    candidateGrades: gradeCounts(comparable.map((market) => market.candidateGrade)),
    promotions: comparable.filter((market) => rank(market.candidateGrade) > rank(market.baseGrade)).length,
    demotions: comparable.filter((market) => rank(market.candidateGrade) < rank(market.baseGrade)).length,
    sideChanges: comparable.filter((market) => market.baseSide !== market.candidateSide).length,
    actionableBefore: comparable.filter((market) => actionable(market.baseGrade)).length,
    actionableAfter: comparable.filter((market) => actionable(market.candidateGrade)).length,
    changes,
  }, null, 2));
}

function compareRow(
  game: NcaafGame,
  payload: Awaited<ReturnType<typeof readCfbForwardEvidence>>[number]["payload"],
  stage: "opening" | "unlocked" | "t60",
  lines: readonly unknown[],
  splits: readonly unknown[],
  priorGames: NcaafGame[],
) {
  const matched = resolveCfbPlaybookEvidence({ game, lines, splits });
  const legacyMatched = lines.some((row) => legacyMatch(game, row)) && splits.some((row) => legacyMatch(game, row));
  if (!matched || stage === "t60" || Date.parse(game.scheduledStart) <= Date.parse(now)) {
    return { matchup: matchup(game), legacyMatched, candidateMatched: matched !== null, markets: [] };
  }
  const playbookLine = normalizeCfbPlaybookLine(matched.lineRow, now);
  const publicSplits = normalizeCfbPlaybookSplits(matched.splitRow, now);
  const anchor = resolveCfbCanonicalMarketAnchor({
    books: payload.market.currentBooks,
    contextLines: { homeSpread: playbookLine?.homeSpread ?? null, totalLine: playbookLine?.total ?? null },
  });
  if (!anchor) return { matchup: matchup(game), legacyMatched, candidateMatched: true, markets: [] };
  const independentForecast = getCfbV1ForecastForGame({ game, completedGames: priorGames }).forecast;
  const forecast = buildCfbMarketSharpAwareForecast({
    independentForecast,
    anchor,
    sharpSplits: payload.market.sharpApiSplits ?? [],
    playbookLine,
    publicSplits,
    evaluatedAt: now,
  });
  const candidate = applyCfbMarketSharpAwareGrades({
    homeTeam: game.home.abbreviation,
    bundle: buildCfbV1DecisionBundle({
      providerGameId: game.providerGameId,
      awayTeam: game.away.abbreviation,
      homeTeam: game.home.abbreviation,
      gameStartsAt: game.scheduledStart,
      comparableCurrentBooks: payload.market.currentBooks,
      stage: "unlocked",
      evaluatedAt: now,
      healthHolds: payload.coverage.healthHolds,
      forecast,
      contextLines: { homeSpread: playbookLine?.homeSpread ?? null, totalLine: playbookLine?.total ?? null },
      calibrationContract: "authoritative_pmf_identity",
    }),
    sharpSplits: payload.market.sharpApiSplits ?? [],
    playbookLine,
    publicSplits,
    operationalOpening: payload.market.operationalOpening,
  });
  const base = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
  const next = new Map(candidate.evaluatedBets.map((decision) => [decision.market, decision]));
  const markets = (["moneyline", "spread", "total"] as const).map((market) => comparison(market, base.get(market), next.get(market)));
  return { matchup: matchup(game), legacyMatched, candidateMatched: true, markets };
}

async function readPriorGames(
  rows: Awaited<ReturnType<typeof readCfbForwardEvidence>>,
  before: string,
): Promise<NcaafGame[]> {
  const games: NcaafGame[] = [];
  for (const read of planCfbPriorResultReads({ rows, before })) {
    const result = await fetchBalldontlieNcaafResultsForDates({
      gameIds: read.gameIds,
      dates: read.dates,
      apiKey: bdlKey!,
      pageBudget: 4,
    });
    games.push(...result.games.filter((game) => game.awayScore !== null && game.homeScore !== null));
  }
  return games;
}

function comparison(market: CfbV1Market, base?: CfbV1ExactPriceDecision, candidate?: CfbV1ExactPriceDecision) {
  if (!base || !candidate) return { market, comparable: false as const };
  return {
    market,
    comparable: true as const,
    baseSide: base.side,
    candidateSide: candidate.side,
    baseGrade: base.grade,
    candidateGrade: candidate.grade,
    probabilityChangePp: round(100 * (candidate.modelProbability - base.modelProbability)),
    candidateEdgePp: round(candidate.edgePercentagePoints),
    candidateEvPct: round(100 * candidate.expectedValue),
    publicDirection: candidate.gradeAdjustment?.publicDirection ?? "unknown",
  };
}

function legacyMatch(game: NcaafGame, value: unknown): boolean {
  const row = record(value);
  const start = String(row.startTime ?? row.startTimeEst ?? "");
  return normalize(row.homeTeamName ?? row.homeTeam) === normalize(game.home.name) &&
    normalize(row.awayTeamName ?? row.awayTeam) === normalize(game.away.name) &&
    Number.isFinite(Date.parse(start)) && Math.abs(Date.parse(start) - Date.parse(game.scheduledStart)) <= 3 * 60 * 60_000;
}

function matchup(game: NcaafGame): string { return `${game.away.abbreviation}@${game.home.abbreviation}`; }
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function normalize(value: unknown): string { return typeof value === "string" ? value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^hawai i\b/, "hawaii").replace(/^massachusetts\b/, "umass").replace(/^ualbany\b/, "albany") : ""; }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
function rank(grade: CfbV1Grade): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
function actionable(grade: CfbV1Grade): boolean { return grade === "Best Angle" || grade === "Lean"; }
function gradeCounts(grades: CfbV1Grade[]): Record<CfbV1Grade, number> {
  const counts: Record<CfbV1Grade, number> = { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 0 };
  for (const grade of grades) counts[grade] += 1;
  return counts;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
