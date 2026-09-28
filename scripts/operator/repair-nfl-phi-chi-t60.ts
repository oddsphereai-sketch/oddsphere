#!/usr/bin/env tsx

/** Exact-game append-only repair for the invalid zero-decision PHI-CHI T-60 row. */

import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { isPublicallyTracked } from "../../lib/config/officialTrackingStart";
import { acquireCronJobLeaseWithRetry } from "../../lib/cron/leaseRetry";
import { acquireCronJobLease, cronJobName, releaseCronJobLease } from "../../lib/cron/leases";
import { computeSlateDate } from "../../lib/dates/slateDate";
import { supabase } from "../../lib/db/supabase";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "../../lib/services/football/nflForwardEvidence";
import { appendNflForwardEvidence, readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import {
  latestVerifiedInjuriesForGame,
  nflEvidenceCapturedAt,
  runNflForwardEvidenceWriter,
} from "../../lib/services/football/nflForwardEvidenceWriter";
import { buildNflR6ShadowMoneylineDecision } from "../../lib/services/football/nflR6MoneylineShadow";
import { nflForwardT60TrackingEligibility } from "../../lib/services/football/nflTrackingLifecycle";
import { buildNflV1ActionableGradeBundle } from "../../lib/services/football/nflV1ActionableGradeCandidate";

loadEnvConfig(process.cwd());

const TARGET_PROVIDER_GAME_ID = "1392263";
const SEASON = 2026;
const WEEK = 3;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const now = new Date();
  const runId = `nfl-phi-chi-t60-repair-${randomUUID()}`;
  const rows = await readNflForwardEvidence({ client: supabase, season: SEASON, week: WEEK });
  const targetRows = rows.filter((row) => row.providerGameId === TARGET_PROVIDER_GAME_ID);
  const bad = targetRows
    .filter((row) => row.stage === "t60" && row.payload.decisions.evaluatedBets.length === 0)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0];
  if (!bad) throw new Error("The exact PHI-CHI zero-decision T-60 row was not found.");
  const badPayload = bad.payload as NflForwardEvidencePayload;
  if (now.getTime() >= Date.parse(bad.gameStartAt)) throw new Error("PHI-CHI has started; pregame repair is closed.");
  if (bad.payload.t60LagMinutes === null || bad.payload.t60LagMinutes > 20) {
    throw new Error("The original PHI-CHI T-60 observation is outside the released lock boundary.");
  }
  const alreadyCorrected = targetRows.some((row) =>
    row.stage === "t60" &&
    row.payload.collectorRelease === NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE &&
    row.payload.decisions.evaluatedBets.length === 3);
  if (alreadyCorrected) throw new Error("A corrected PHI-CHI T-60 tuple already exists.");

  const injuries = latestVerifiedInjuriesForGame(rows, TARGET_PROVIDER_GAME_ID);
  if (!injuries) throw new Error("No verified same-game PHI-CHI injury report is available.");
  const capturedAt = nflEvidenceCapturedAt(
    new Date(Date.parse(bad.capturedAt) + 1).toISOString(),
    [bad.payload.market.current, ...bad.payload.market.currentBooks, ...bad.payload.market.comparableCurrentBooks],
  );
  const cutoffAt = bad.payload.cutoffAt;
  if (!cutoffAt) throw new Error("PHI-CHI T-60 cutoff is missing.");
  const t60LagMinutes = (Date.parse(capturedAt) - Date.parse(cutoffAt)) / 60_000;
  if (t60LagMinutes > 20) throw new Error(`Corrected PHI-CHI quote timestamp is outside T-60 (${t60LagMinutes}).`);
  const healthHolds = bad.payload.coverage.healthHolds.filter((reason) => reason !== "injury_report_unavailable");
  const shadowMoneyline = buildNflR6ShadowMoneylineDecision({
    game: bad.payload.game,
    opening: bad.payload.market.operationalOpening,
    comparableCurrentBooks: bad.payload.market.comparableCurrentBooks,
    startersAndDepth: bad.payload.startersAndDepth,
    injuries,
    stage: "t60",
    capturedAt,
    t60LagMinutes,
    coverageHealthHolds: healthHolds,
  });
  const production = buildNflV1ActionableGradeBundle({
    providerGameId: TARGET_PROVIDER_GAME_ID,
    awayTeam: bad.payload.game.away.abbreviation,
    homeTeam: bad.payload.game.home.abbreviation,
    gameStartsAt: bad.payload.game.scheduledStart,
    current: bad.payload.market.current,
    comparableCurrentBooks: bad.payload.market.comparableCurrentBooks,
    shadowMoneyline,
    outcomeForecast: badPayload.outcomeForecast,
  });
  if (production.evaluatedBets.length !== 3) {
    throw new Error(`Corrected PHI-CHI tuple is incomplete (${production.evaluatedBets.length}/3): ${JSON.stringify({
      grade: shadowMoneyline.grade,
      team: shadowMoneyline.team,
      reason: shadowMoneyline.reason,
      health: shadowMoneyline.health,
      footballProjection: shadowMoneyline.footballProjection,
    })}`);
  }
  const decisions = production.evaluatedBets;
  const requiredDirections = new Map([
    ["moneyline", "PHI"],
    ["spread", "PHI"],
    ["total", "Under 42.5"],
  ]);
  for (const decision of decisions) {
    if (decision.side !== requiredDirections.get(decision.market)) {
      throw new Error(`Unexpected corrected ${decision.market} direction: ${decision.side}.`);
    }
  }
  const tracking = nflForwardT60TrackingEligibility({
    stage: "t60",
    captureTiming: bad.payload.captureTiming,
    t60LagMinutes,
    capturedAt,
    providerGameId: TARGET_PROVIDER_GAME_ID,
    gameStartsAt: bad.payload.game.scheduledStart,
    decisions,
    outcomeConfidence: production.outcomeConfidence,
    publicationApproved: production.publicationEnabled,
    officialRegistryLaunched: isPublicallyTracked(
      "nfl",
      computeSlateDate("nfl", bad.payload.game.scheduledStart),
    ),
  });
  if (!tracking.eligible) throw new Error(`Corrected PHI-CHI tuple is not tracking eligible: ${tracking.reason}.`);

  const payload: NflForwardEvidencePayload = {
    ...structuredClone(badPayload),
    collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
    runId,
    capturedAt,
    t60LagMinutes,
    injuries,
    decisions: {
      evaluatedBets: decisions,
      outcomeConfidence: production.outcomeConfidence,
      modelPromotionStatus: production.modelPromotionStatus,
      publicationEnabled: production.publicationEnabled,
      trackingEnabled: true,
    },
    coverage: {
      ...bad.payload.coverage,
      injuries: true,
      healthHolds,
    },
  };
  const report = {
    apply,
    providerGameId: TARGET_PROVIDER_GAME_ID,
    sourceRowId: bad.id,
    sourceCapturedAt: bad.capturedAt,
    correctedCapturedAt: capturedAt,
    originalT60LagMinutes: bad.payload.t60LagMinutes,
    correctedT60LagMinutes: t60LagMinutes,
    expectedScores: {
      away: Math.round(payload.outcomeForecast.expectedAwayScore * 10) / 10,
      home: Math.round(payload.outcomeForecast.expectedHomeScore * 10) / 10,
    },
    decisions: decisions.map((decision) => ({
      market: decision.market,
      side: decision.side,
      line: decision.evaluatedQuote.line,
      price: decision.evaluatedQuote.price,
      sportsbook: decision.evaluatedQuote.sportsbook,
      grade: decision.grade,
    })),
    payloadSha256: hashNflForwardEvidencePayload(payload),
    healthHolds,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;

  const jobName = cronJobName("prediction_pipeline", "nfl");
  const acquired = await acquireCronJobLeaseWithRetry({
    jobName,
    runId,
    leaseSeconds: 5 * 60,
    maxWaitMs: 20_000,
    retryIntervalMs: 1_000,
  }, { acquire: acquireCronJobLease });
  if (acquired.lease.mode !== "acquired") {
    throw new Error(`Required NFL prediction-pipeline lease was not acquired (${acquired.lease.mode}).`);
  }
  try {
    const write = await appendNflForwardEvidence({ client: supabase, runId, payloads: [payload], apply: true });
    if (write.inserted !== 1) throw new Error(`Expected one corrected evidence row; inserted ${write.inserted}.`);
    await runNflForwardEvidenceWriter({
      client: supabase,
      season: SEASON,
      week: WEEK,
      runId,
      now: new Date().toISOString(),
      apply: true,
      balldontlieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
      playbookApiKey: requiredEnv("PLAYBOOK_API_KEY"),
      sharpApiKey: requiredEnv("SHARP_API_KEY"),
      weatherProvider: null,
    });
  } finally {
    await releaseCronJobLease({ jobName, runId });
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
