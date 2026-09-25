/** Exact read-only replay of the NFL raw-signal candidate on immutable 2026 T-60 rows. */

import { supabase } from "@/lib/db/supabase";
import { readNflForwardEvidence } from "@/lib/services/football/nflForwardEvidenceStore";
import { readNflPlayerPropsCurrentSeasonState } from "@/lib/services/football/nflPlayerPropsCurrentSeasonState";
import { buildNflWeeklyPossessionMargin } from "@/lib/services/football/nflWeeklyPossessionMargin";
import { buildNflR6ShadowMoneylineDecision } from "@/lib/services/football/nflR6MoneylineShadow";
import {
  buildNflMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
  NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
} from "@/lib/services/football/nflV1WeekOneOutcome";
import { resolveNflTargetExcludedProduction } from "@/lib/services/football/nflTargetExcludedMarketOutcome";
import type { NflForwardStoredEvidence } from "@/lib/services/football/nflForwardEvidence";
import type { NflRegularEvaluatedBetDecision } from "@/lib/services/football/nflRegularDecisionEvidence";
import type { NflV1WeekOneOutcomeForecast } from "@/lib/services/football/nflV1WeekOneOutcome";

const RELEASE = "nfl_2026_raw_signal_exact_replay_2026_09_25_r1";
const RAW_RELEASE = NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE;

type ReplayRow = {
  week: number;
  gameId: string;
  actualHome: number;
  actualAway: number;
  marketHomeMargin: number;
  marketTotal: number;
  publishedForecast: NflV1WeekOneOutcomeForecast;
  candidateForecast: NflV1WeekOneOutcomeForecast;
  publishedDecisions: NflRegularEvaluatedBetDecision[];
  candidateDecisions: NflRegularEvaluatedBetDecision[];
};

function latestT60(rows: NflForwardStoredEvidence[]): NflForwardStoredEvidence[] {
  const latest = new Map<string, NflForwardStoredEvidence>();
  for (const row of rows.filter((value) => value.stage === "t60")) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }
  return [...latest.values()];
}

function reconstructShadow(payload: NflForwardStoredEvidence["payload"]) {
  return buildNflR6ShadowMoneylineDecision({
    game: payload.game,
    opening: payload.market.operationalOpening,
    comparableCurrentBooks: payload.market.comparableCurrentBooks,
    startersAndDepth: payload.startersAndDepth,
    injuries: payload.injuries,
    stage: payload.stage,
    capturedAt: payload.capturedAt,
    t60LagMinutes: payload.t60LagMinutes,
    coverageHealthHolds: payload.coverage.healthHolds,
  });
}

function metric(rows: ReplayRow[], version: "published" | "candidate") {
  const forecast = (row: ReplayRow) => version === "published" ? row.publishedForecast : row.candidateForecast;
  const sideCorrect = (row: ReplayRow, market: "moneyline" | "spread" | "total") => {
    const actualMargin = row.actualHome - row.actualAway;
    const projected = forecast(row);
    if (market === "moneyline") {
      if (actualMargin === 0) return null;
      return (projected.homeWinProbability > projected.awayWinProbability) === (actualMargin > 0);
    }
    const lineProbabilities = nflV1WeekOneLineProbabilities({
      forecast: projected,
      homeSpread: -row.marketHomeMargin,
      totalLine: row.marketTotal,
    });
    if (market === "spread") {
      if (actualMargin === row.marketHomeMargin) return null;
      const homeCovered = actualMargin > row.marketHomeMargin;
      const projectedHome = lineProbabilities.spread.homeCoverProbability >= lineProbabilities.spread.awayCoverProbability;
      return projectedHome === homeCovered;
    }
    const actualTotal = row.actualHome + row.actualAway;
    if (actualTotal === row.marketTotal) return null;
    const over = actualTotal > row.marketTotal;
    const projectedOver = lineProbabilities.total.overProbability >= lineProbabilities.total.underProbability;
    return projectedOver === over;
  };
  const record = (market: "moneyline" | "spread" | "total") => {
    const values = rows.map((row) => sideCorrect(row, market)).filter((value): value is boolean => value !== null);
    return { resolved: values.length, correct: values.filter(Boolean).length, accuracy: values.filter(Boolean).length / values.length };
  };
  return {
    games: rows.length,
    moneyline: record("moneyline"),
    spread: record("spread"),
    total: record("total"),
    teamScoreMae: rows.reduce((sum, row) => sum + Math.abs(forecast(row).expectedHomeScore - row.actualHome) + Math.abs(forecast(row).expectedAwayScore - row.actualAway), 0) / (2 * rows.length),
    marginMae: rows.reduce((sum, row) => sum + Math.abs((forecast(row).expectedHomeScore - forecast(row).expectedAwayScore) - (row.actualHome - row.actualAway)), 0) / rows.length,
    totalMae: rows.reduce((sum, row) => sum + Math.abs((forecast(row).expectedHomeScore + forecast(row).expectedAwayScore) - (row.actualHome + row.actualAway)), 0) / rows.length,
  };
}

async function main() {
  const state = await readNflPlayerPropsCurrentSeasonState({ client: supabase, season: 2026 });
  if (!state || state.completeThroughWeek < 2) throw new Error("NFL replay state is incomplete through Week 2.");
  const finalByGame = new Map(state.games.map((game) => [game.gameId, game]));
  const allEvidence = (await Promise.all([1, 2].map((week) => readNflForwardEvidence({ client: supabase, season: 2026, week })))).flat();
  const rows: ReplayRow[] = [];
  for (const evidence of latestT60(allEvidence)) {
    const payload = evidence.payload;
    if (!("outcomeForecast" in payload) || !payload.market.current.spread || !payload.market.current.total) continue;
    const final = finalByGame.get(evidence.providerGameId);
    if (!final) continue;
    if (payload.week === 1) {
      rows.push({
        week: 1,
        gameId: evidence.providerGameId,
        actualHome: final.homeScore,
        actualAway: final.awayScore,
        marketHomeMargin: -payload.market.current.spread.homeLine,
        marketTotal: payload.market.current.total.line,
        publishedForecast: payload.outcomeForecast,
        candidateForecast: payload.outcomeForecast,
        publishedDecisions: payload.decisions.evaluatedBets,
        candidateDecisions: payload.decisions.evaluatedBets,
      });
      continue;
    }
    const shadow = reconstructShadow(payload);
    if (!shadow.footballProjection) continue;
    const priorState = {
      ...state,
      completeThroughWeek: payload.week - 1,
      games: state.games.filter((game) => game.week < payload.week),
      teamStats: state.teamStats.filter((team) => team.week < payload.week),
      stats: state.stats.filter((stat) => stat.week < payload.week),
    };
    const possession = buildNflWeeklyPossessionMargin({
      currentSeasonState: priorState,
      homeTeam: payload.game.home.abbreviation,
      awayTeam: payload.game.away.abbreviation,
      marketHomeMargin: -payload.market.current.spread.homeLine,
    });
    const rawSignal = { release: RAW_RELEASE, independentHomeMargin: possession.independentHomeMargin };
    const base = getNflV1WeekOneOutcomeForecast({
      providerGameId: evidence.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      weeklyFallback: { projectedHomeMargin: shadow.footballProjection.projectedHomeMargin, marketTotal: payload.market.current.total.line },
    });
    const candidateIncumbent = buildNflMarketEvidenceOutcomeForecast({
      baseForecast: base,
      footballHomeMargin: shadow.footballProjection.projectedHomeMargin,
      current: payload.market.current,
      operationalOpening: payload.market.operationalOpening,
      playbookLine: payload.market.playbookLine,
      playbookSplits: payload.market.playbookSplits,
      sharpSplits: payload.market.sharpApiSplits,
      spreadDirectionCandidate: true,
      movementCurrent: payload.market.current,
      weeklyRawSignal: rawSignal,
      evaluatedAt: payload.capturedAt,
    });
    const candidate = resolveNflTargetExcludedProduction({
      providerGameId: evidence.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      evaluatedAt: payload.capturedAt,
      baseOutcome: base,
      incumbentOutcome: candidateIncumbent,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      operationalOpening: payload.market.operationalOpening,
      shadowMoneyline: shadow,
      playbookLine: payload.market.playbookLine,
      playbookSplits: payload.market.playbookSplits,
      sharpSplits: payload.market.sharpApiSplits,
      pricedNeutralTotalCandidate: true,
      weeklyRawSignal: rawSignal,
    });
    rows.push({
      week: payload.week,
      gameId: evidence.providerGameId,
      actualHome: final.homeScore,
      actualAway: final.awayScore,
      marketHomeMargin: -payload.market.current.spread.homeLine,
      marketTotal: payload.market.current.total.line,
      publishedForecast: payload.outcomeForecast,
      candidateForecast: candidate.outcome,
      publishedDecisions: payload.decisions.evaluatedBets,
      candidateDecisions: candidate.production.evaluatedBets,
    });
  }
  const report = {
    release: RELEASE,
    readOnly: true,
    productionChanged: false,
    published: metric(rows, "published"),
    candidate: metric(rows, "candidate"),
    byWeek: Object.fromEntries([1, 2].map((week) => {
      const subset = rows.filter((row) => row.week === week);
      return [week, { published: metric(subset, "published"), candidate: metric(subset, "candidate") }];
    })),
  };
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
