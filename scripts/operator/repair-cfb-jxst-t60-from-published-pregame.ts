#!/usr/bin/env tsx

/**
 * One-game recovery for FIU @ Jacksonville State on 2026-10-13.
 *
 * The provider temporarily reported the 8 PM ET kickoff as 7 PM ET during the
 * normal T-60 cycle. The authoritative writer therefore skipped the boundary,
 * then correctly rejected the first later observation as too late. This repair
 * freezes the exact last member-published payload from before the real 7 PM ET
 * cutoff. It does not recompute a forecast, select a new quote, or change any
 * prediction, price, grade, or market evidence.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  hashCfbForwardEvidencePayload,
  isCfbPreT60PublishedPayloadRecovery,
  type CfbForwardEvidencePayload,
} from "../../lib/services/football/cfbForwardEvidence";
import { CFB_V1_DECISION_RELEASE } from "../../lib/services/football/cfbV1Decision";

loadEnvConfig(process.cwd());

const PROVIDER_GAME_ID = "457759";
const REAL_START = "2026-10-14T00:00:00.000Z";
const REAL_CUTOFF = "2026-10-13T23:00:00.000Z";
const REPAIR_RUN_ID = "45775900-2026-4013-9000-000000000001";

type StoredRow = {
  id: string;
  evidence_release: string;
  provider_game_id: string;
  stage: "opening" | "unlocked" | "t60";
  captured_at: string;
  game_start_at: string;
  payload: CfbForwardEvidencePayload;
};

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await client
    .from("cfb_forward_evidence_snapshots")
    .select("id,evidence_release,provider_game_id,stage,captured_at,game_start_at,payload")
    .eq("provider_game_id", PROVIDER_GAME_ID)
    .eq("evidence_release", CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE)
    .order("captured_at", { ascending: true });
  if (error) throw new Error(`CFB evidence read failed: ${error.message}`);
  const rows = (data ?? []) as StoredRow[];
  if (rows.length === 0) throw new Error("Jacksonville State evidence is missing.");

  const existingRecovery = rows.find((row) => row.payload.runId === REPAIR_RUN_ID);
  if (existingRecovery) {
    console.log(JSON.stringify({ applied: true, alreadyPresent: true, id: existingRecovery.id }, null, 2));
    return;
  }
  const validExistingT60 = rows.find((row) =>
    row.stage === "t60" &&
    row.payload.captureTiming === "on_time" &&
    (row.payload.t60LagMinutes ?? Infinity) >= 0 &&
    (row.payload.t60LagMinutes ?? Infinity) <= 20 &&
    row.payload.coverage.healthHolds.length === 0 &&
    row.payload.decisions.trackingEnabled &&
    row.payload.decisions.evaluatedBets.length === 3
  );
  if (validExistingT60) throw new Error(`A valid T-60 row already exists: ${validExistingT60.id}`);
  const invalidExistingT60Rows = rows.filter((row) => row.stage === "t60");
  if (invalidExistingT60Rows.length > 1) throw new Error("More than one invalid T-60 row exists; refusing an ambiguous repair.");
  const invalidExistingT60 = invalidExistingT60Rows[0] ?? null;
  if (invalidExistingT60 && (
    !invalidExistingT60.payload.coverage.healthHolds.includes("t60_capture_late") ||
    invalidExistingT60.payload.decisions.evaluatedBets.length !== 0 ||
    invalidExistingT60.payload.decisions.trackingEnabled
  )) {
    throw new Error("The existing T-60 row is not the known empty late-capture failure.");
  }

  const source = rows
    .filter((row) => row.stage !== "t60" && Date.parse(row.captured_at) <= Date.parse(REAL_CUTOFF))
    .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at))[0];
  if (!source) throw new Error("No published pre-cutoff source payload exists.");
  if (
    source.payload.schemaRelease !== CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
    source.payload.memberRelease !== CFB_FORWARD_MEMBER_RELEASE ||
    source.payload.decisions.decisionRelease !== CFB_V1_DECISION_RELEASE ||
    source.payload.game.scheduledStart !== REAL_START ||
    source.payload.decisions.evaluatedBets.length !== 3 ||
    source.payload.coverage.healthHolds.length !== 0
  ) {
    throw new Error("The pre-cutoff source payload is not a complete current-release member publication.");
  }
  if (source.payload.decisions.evaluatedBets.some((decision) => Date.parse(decision.evaluatedQuote.observedAt) > Date.parse(REAL_CUTOFF))) {
    throw new Error("The source payload contains a quote observed after the real lock boundary.");
  }

  const repaired: CfbForwardEvidencePayload = {
    ...structuredClone(source.payload),
    runId: REPAIR_RUN_ID,
    stage: "unlocked",
    capturedAt: REAL_CUTOFF,
    cutoffAt: REAL_CUTOFF,
    captureTiming: "on_time",
    t60LagMinutes: 0,
    decisions: {
      ...structuredClone(source.payload.decisions),
      trackingEnabled: true,
      evaluatedBets: source.payload.decisions.evaluatedBets.map((decision) => ({
        ...structuredClone(decision),
        stage: "t60_locked",
        evaluatedAt: REAL_CUTOFF,
        lockedAt: REAL_CUTOFF,
      })),
    },
    coverage: {
      ...structuredClone(source.payload.coverage),
      healthHolds: [],
      availabilityWarnings: source.payload.coverage.availabilityWarnings,
    },
    lockRecovery: {
      release: "cfb_pre_t60_published_payload_recovery_2026_10_13_r1",
      sourcePayloadSha256: hashCfbForwardEvidencePayload(source.payload),
      sourceCapturedAt: source.payload.capturedAt,
      recoveredAt: new Date().toISOString(),
      reason: "provider_kickoff_time_changed_during_t60_cycle",
    },
  };
  const payloadSha256 = hashCfbForwardEvidencePayload(repaired);
  if (!isCfbPreT60PublishedPayloadRecovery(repaired)) throw new Error("The recovered payload does not satisfy the immutable T-60 recovery contract.");
  const report = {
    apply,
    providerGameId: PROVIDER_GAME_ID,
    matchup: `${repaired.game.away.abbreviation}@${repaired.game.home.abbreviation}`,
    sourceRowId: source.id,
    sourceCapturedAt: source.payload.capturedAt,
    frozenAt: REAL_CUTOFF,
    startAt: REAL_START,
    decisions: repaired.decisions.evaluatedBets.map((decision) => ({
      market: decision.market,
      side: decision.side,
      grade: decision.grade,
      line: decision.evaluatedQuote.line,
      price: decision.evaluatedQuote.price,
      quoteObservedAt: decision.evaluatedQuote.observedAt,
    })),
    payloadSha256,
  };
  if (!apply) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const stored = {
      evidence_release: repaired.schemaRelease,
      collector_release: repaired.collectorRelease,
      run_id: repaired.runId,
      season: repaired.season,
      week: repaired.week,
      provider_game_id: repaired.game.providerGameId,
      away_team: repaired.game.away.abbreviation,
      home_team: repaired.game.home.abbreviation,
      game_start_at: repaired.game.scheduledStart,
      stage: repaired.stage,
      captured_at: repaired.capturedAt,
      cutoff_at: repaired.cutoffAt,
      payload: repaired,
      payload_sha256: payloadSha256,
      coverage: repaired.coverage,
  };
  const write = await client.from("cfb_forward_evidence_snapshots").insert(stored).select("id").single();
  if (write.error) throw new Error(`CFB recovery write failed: ${write.error.message}`);
  console.log(JSON.stringify({ ...report, repairedRowId: write.data.id, preservedEmptyLateCapture: invalidExistingT60?.id ?? null }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
