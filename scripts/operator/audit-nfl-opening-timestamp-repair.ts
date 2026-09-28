/** Read-only current-board replay of the provider opening timestamp repair. */

import { supabase } from "../../lib/db/supabase";
import { fetchBalldontlieNflRegularSlate } from "../../lib/services/football/balldontlieNflPreviewSlate";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { buildNflR6ShadowMoneylineDecision } from "../../lib/services/football/nflR6MoneylineShadow";
import {
  buildNflMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
  NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
} from "../../lib/services/football/nflV1WeekOneOutcome";
import { resolveNflTargetExcludedProduction } from "../../lib/services/football/nflTargetExcludedMarketOutcome";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";

function latestByGame(rows: NflForwardStoredEvidence[]): NflForwardStoredEvidence[] {
  const latest = new Map<string, NflForwardStoredEvidence>();
  for (const row of rows) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }
  return [...latest.values()];
}

async function main(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY?.trim();
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  const season = 2026;
  const week = 3;
  const [stored, slate] = await Promise.all([
    readNflForwardEvidence({ client: supabase, season, week }),
    fetchBalldontlieNflRegularSlate({ season, week, apiKey }),
  ]);
  const now = Date.now();
  const rows = latestByGame(stored)
    .filter((row) => row.stage !== "t60" && Date.parse(row.gameStartAt) > now)
    .sort((a, b) => a.gameStartAt.localeCompare(b.gameStartAt));
  const report = rows.map((row) => {
    if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) {
      throw new Error(`Unexpected evidence release for ${row.providerGameId}.`);
    }
    const payload = row.payload as NflForwardEvidencePayload;
    const providerOpening = slate.openingOddsByGame[row.providerGameId] ?? null;
    if (!providerOpening) throw new Error(`Provider opening is unavailable for ${row.providerGameId}.`);
    const providerOpeningCandidate = {
      provenance: "provider_opening" as const,
      capturedAt: providerOpening.observedAt,
      quote: providerOpening,
    };
    // Match the production boundary: repaired provider openings are captured
    // internally but do not replace the established operational opening.
    const opening = payload.market.operationalOpening;
    const shadow = buildNflR6ShadowMoneylineDecision({
      game: payload.game,
      opening,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      startersAndDepth: payload.startersAndDepth,
      injuries: payload.injuries,
      stage: payload.stage,
      capturedAt: payload.capturedAt,
      t60LagMinutes: payload.t60LagMinutes,
      coverageHealthHolds: payload.coverage.healthHolds,
    });
    if (!shadow.footballProjection || !payload.market.current.total) {
      throw new Error(`Complete football projection is unavailable for ${row.providerGameId}.`);
    }
    const raw = payload.outcomeForecast.marketEvidence?.weeklyRawSignal;
    const weeklyRawSignal = raw ? {
      release: NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
      independentHomeMargin: raw.independentHomeMargin,
      directionHomeCoverProbability: raw.directionHomeCoverProbability,
      directionHomeMarginCorrection: raw.directionHomeMarginCorrection,
    } : undefined;
    const base = getNflV1WeekOneOutcomeForecast({
      providerGameId: row.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      weeklyFallback: {
        projectedHomeMargin: shadow.footballProjection.projectedHomeMargin,
        marketTotal: payload.market.current.total.line,
      },
    });
    const incumbent = buildNflMarketEvidenceOutcomeForecast({
      baseForecast: base,
      footballHomeMargin: shadow.footballProjection.projectedHomeMargin,
      current: payload.market.current,
      operationalOpening: opening,
      playbookLine: payload.market.playbookLine,
      playbookSplits: payload.market.playbookSplits,
      sharpSplits: payload.market.sharpApiSplits,
      spreadDirectionCandidate: true,
      movementCurrent: payload.market.current,
      weeklyRawSignal,
      evaluatedAt: payload.capturedAt,
    });
    const candidate = resolveNflTargetExcludedProduction({
      providerGameId: row.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      evaluatedAt: payload.capturedAt,
      baseOutcome: base,
      incumbentOutcome: incumbent,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      operationalOpening: opening,
      shadowMoneyline: shadow,
      playbookLine: payload.market.playbookLine,
      playbookSplits: payload.market.playbookSplits,
      sharpSplits: payload.market.sharpApiSplits,
      pricedNeutralTotalCandidate: true,
      weeklyRawSignal,
    });
    const before = payload.decisions.evaluatedBets;
    const after = candidate.production.evaluatedBets;
    return {
      providerGameId: row.providerGameId,
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      gameStartAt: row.gameStartAt,
      existingOpening: payload.market.operationalOpening,
      providerOpeningCandidate,
      productionOpening: opening,
      beforeScore: [payload.outcomeForecast.expectedAwayScore, payload.outcomeForecast.expectedHomeScore],
      afterScore: [candidate.outcome.expectedAwayScore, candidate.outcome.expectedHomeScore],
      before: before.map((decision) => ({ market: decision.market, side: decision.side, grade: decision.grade })),
      after: after.map((decision) => ({ market: decision.market, side: decision.side, grade: decision.grade })),
      movement: candidate.outcome.marketEvidence?.movement ?? null,
    };
  });
  const before = report.flatMap((game) => game.before);
  const after = report.flatMap((game) => game.after);
  console.log(JSON.stringify({
    release: "nfl_opening_timestamp_repair_current_board_audit_2026_09_28_r1",
    readOnly: true,
    productionChanged: false,
    providerRequests: slate.providerRequests,
    providerOpeningCoverage: Object.values(slate.openingOddsByGame).filter(Boolean).length,
    currentCoverage: Object.values(slate.currentOddsByGame).filter(Boolean).length,
    unlockedGames: report.length,
    sideChanges: after.filter((decision, index) => decision.side !== before[index]?.side).length,
    gradeChanges: after.filter((decision, index) => decision.grade !== before[index]?.grade).length,
    promotions: after.filter((decision, index) => decision.grade !== "No Play" && before[index]?.grade === "No Play").length,
    demotions: after.filter((decision, index) => decision.grade === "No Play" && before[index]?.grade !== "No Play").length,
    report,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
