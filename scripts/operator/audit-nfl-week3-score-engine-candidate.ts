/** Read-only current-board replay for the bounded NFL raw-signal candidate. */

import { supabase } from "@/lib/db/supabase";
import { readNflForwardEvidence } from "@/lib/services/football/nflForwardEvidenceStore";
import { readNflPlayerPropsCurrentSeasonState } from "@/lib/services/football/nflPlayerPropsCurrentSeasonState";
import { buildNflWeeklyPossessionMargin } from "@/lib/services/football/nflWeeklyPossessionMargin";
import { buildNflR6ShadowMoneylineDecision } from "@/lib/services/football/nflR6MoneylineShadow";
import {
  buildNflMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
  NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
} from "@/lib/services/football/nflV1WeekOneOutcome";
import { resolveNflTargetExcludedProduction } from "@/lib/services/football/nflTargetExcludedMarketOutcome";
import type { NflRegularEvaluatedBetDecision } from "@/lib/services/football/nflRegularDecisionEvidence";
import type { NflV1WeekOneOutcomeForecast } from "@/lib/services/football/nflV1WeekOneOutcome";

const RAW_RELEASE = NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE;
type Market = "moneyline" | "spread" | "total";
type Grade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
type AuditRow = {
  gameId: string;
  matchup: string;
  stage: "opening" | "unlocked" | "t60";
  lockedPreserved: boolean;
  incumbent: NflRegularEvaluatedBetDecision[];
  candidate: NflRegularEvaluatedBetDecision[];
  incumbentForecast: NflV1WeekOneOutcomeForecast;
  candidateForecast: NflV1WeekOneOutcomeForecast;
  targetExclusion: string | null;
};

async function main() {
  const summaryOnly = process.argv.includes("--summary");
  const state = await readNflPlayerPropsCurrentSeasonState({ client: supabase, season: 2026 });
  if (!state || state.completeThroughWeek < 2) throw new Error("NFL current-season team state is incomplete through Week 2.");
  const evidence = await readNflForwardEvidence({ client: supabase, season: 2026, week: 3 });
  const latest = new Map<string, (typeof evidence)[number]>();
  for (const row of evidence) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }
  const rows = [...latest.values()].flatMap<AuditRow>((row): AuditRow[] => {
    const payload = row.payload;
    if (!("outcomeForecast" in payload) || !payload.market.current.spread || !payload.market.current.total) return [];
    const incumbentDecisions = payload.decisions.evaluatedBets;
    if (row.stage === "t60") return [{
      gameId: row.providerGameId,
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      stage: row.stage,
      lockedPreserved: true,
      incumbent: incumbentDecisions,
      candidate: incumbentDecisions,
      incumbentForecast: payload.outcomeForecast,
      candidateForecast: payload.outcomeForecast,
      targetExclusion: payload.outcomeForecast.targetExclusion?.status ?? null,
    }];
    const shadowMoneyline = buildNflR6ShadowMoneylineDecision({
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
    if (!shadowMoneyline.footballProjection) return [];
    const possession = buildNflWeeklyPossessionMargin({
      currentSeasonState: state,
      homeTeam: payload.game.home.abbreviation,
      awayTeam: payload.game.away.abbreviation,
      marketHomeMargin: -payload.market.current.spread.homeLine,
    });
    const rawSignal = { release: RAW_RELEASE, independentHomeMargin: possession.independentHomeMargin };
    const baseOutcome = getNflV1WeekOneOutcomeForecast({
      providerGameId: row.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      weeklyFallback: {
        projectedHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
        marketTotal: payload.market.current.total.line,
      },
    });
    const incumbentOutcome = buildNflMarketEvidenceOutcomeForecast({
      baseForecast: baseOutcome,
      footballHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
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
    const resolved = resolveNflTargetExcludedProduction({
      providerGameId: row.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      evaluatedAt: payload.capturedAt,
      baseOutcome,
      incumbentOutcome,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      operationalOpening: payload.market.operationalOpening,
      shadowMoneyline,
      playbookLine: payload.market.playbookLine,
      playbookSplits: payload.market.playbookSplits,
      sharpSplits: payload.market.sharpApiSplits,
      pricedNeutralTotalCandidate: true,
      weeklyRawSignal: rawSignal,
    });
    return [{
      gameId: row.providerGameId,
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      stage: row.stage,
      lockedPreserved: false,
      incumbent: incumbentDecisions,
      candidate: resolved.production.evaluatedBets,
      incumbentForecast: payload.outcomeForecast,
      candidateForecast: resolved.outcome,
      targetExclusion: resolved.targetExclusion.status,
    }];
  }).sort((a, b) => a.matchup.localeCompare(b.matchup));

  const side = (row: (typeof rows)[number], version: "incumbent" | "candidate", market: Market) =>
    row[version].find((decision) => decision.market === market)?.side ?? null;
  const grade = (row: (typeof rows)[number], version: "incumbent" | "candidate", market: Market) =>
    row[version].find((decision) => decision.market === market)?.grade as Grade | undefined;
  const gradeCounts = (version: "incumbent" | "candidate") => Object.fromEntries(
    (["Best Angle", "Lean", "Watchlist", "No Play"] satisfies Grade[]).map((value) => [
      value,
      rows.flatMap((row) => row[version]).filter((decision) => decision.grade === value).length,
    ]),
  );
  const rank = (value: Grade | undefined) => value === "Best Angle" ? 3 : value === "Lean" ? 2 : value === "Watchlist" ? 1 : 0;
  const changes = rows.flatMap((row) => (["moneyline", "spread", "total"] satisfies Market[]).map((market) => ({
    matchup: row.matchup,
    market,
    sideChanged: side(row, "incumbent", market) !== side(row, "candidate", market),
    incumbentGrade: grade(row, "incumbent", market),
    candidateGrade: grade(row, "candidate", market),
  })));
  const directionCounts = (version: "incumbent" | "candidate", market: Market) => {
    const values = rows.map((row) => side(row, version, market)).filter((value): value is string => value !== null);
    if (market === "total") return { over: values.filter((value) => value.startsWith("Over")).length, under: values.filter((value) => value.startsWith("Under")).length };
    return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
  };
  const summary = {
    readOnly: true,
    productionChanged: false,
    games: rows.length,
    lockedPreserved: rows.filter((row) => row.lockedPreserved).length,
    completeThroughWeek: state.completeThroughWeek,
    gradeCounts: { incumbent: gradeCounts("incumbent"), candidate: gradeCounts("candidate") },
    actionableCounts: {
      incumbent: rows.flatMap((row) => row.incumbent).filter((decision) => decision.grade === "Best Angle" || decision.grade === "Lean").length,
      candidate: rows.flatMap((row) => row.candidate).filter((decision) => decision.grade === "Best Angle" || decision.grade === "Lean").length,
    },
    promotions: changes.filter((change) => rank(change.candidateGrade) > rank(change.incumbentGrade)).length,
    demotions: changes.filter((change) => rank(change.candidateGrade) < rank(change.incumbentGrade)).length,
    sideChanges: Object.fromEntries(([
      "moneyline", "spread", "total",
    ] satisfies Market[]).map((market) => [market, changes.filter((change) => change.market === market && change.sideChanged).length])),
    directionCounts: {
      incumbent: Object.fromEntries(([
        "moneyline", "spread", "total",
      ] satisfies Market[]).map((market) => [market, directionCounts("incumbent", market)])),
      candidate: Object.fromEntries(([
        "moneyline", "spread", "total",
      ] satisfies Market[]).map((market) => [market, directionCounts("candidate", market)])),
    },
    targetExclusion: Object.fromEntries([...new Set(rows.map((row) => row.targetExclusion))].map((status) => [status ?? "none", rows.filter((row) => row.targetExclusion === status).length])),
    ...(summaryOnly ? {} : { rows }),
  };
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
