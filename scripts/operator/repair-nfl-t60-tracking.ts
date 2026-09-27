#!/usr/bin/env tsx

/**
 * Inserts official NFL tracking rows from exact immutable T-60 evidence.
 * It never recollects, recomputes, updates, or deletes a prediction.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { isPublicallyTracked } from "../../lib/config/officialTrackingStart";
import { computeSlateDate } from "../../lib/dates/slateDate";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { writeOfficialTrackingFromPayloads } from "../../lib/services/football/nflForwardEvidenceWriter";
import {
  buildNflImmutableT60RecoveryRecords,
  buildNflOfficialTrackingRecords,
  nflProviderIntegerId,
} from "../../lib/services/football/nflOfficialTrackingRecord";
import { nflForwardT60TrackingEligibility } from "../../lib/services/football/nflTrackingLifecycle";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";

loadEnvConfig(process.cwd());

const TARGET_PROVIDER_IDS = new Set(["1392258", "1392259", "1392260", "1392261"]);

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const client = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const now = new Date();
  const season = 2026;
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now });
  const evidence = await readNflForwardEvidence({ client, season, week });
  const payloads: NflForwardEvidencePayload[] = evidence
    .filter((row) => row.stage === "t60" && TARGET_PROVIDER_IDS.has(row.providerGameId))
    .map((row) => {
      if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) {
        throw new Error(`Target T-60 payload ${row.providerGameId} is not on the current evidence schema.`);
      }
      return row.payload as NflForwardEvidencePayload;
    })
    .sort((left, right) => left.game.providerGameId.localeCompare(right.game.providerGameId));
  if (payloads.length !== TARGET_PROVIDER_IDS.size) {
    throw new Error(`Expected ${TARGET_PROVIDER_IDS.size} exact T-60 payloads; received ${payloads.length}.`);
  }

  const candidates = payloads.flatMap((payload, index) => {
    assertEligible(payload);
    try {
      return buildNflOfficialTrackingRecords({
        payload,
        gameId: -(index + 1),
        trackingBoundaryRevalidated: true,
      });
    } catch {
      return buildNflImmutableT60RecoveryRecords({
        payload,
        gameId: -(index + 1),
        trackingBoundaryRevalidated: true,
      });
    }
  });
  if (candidates.length !== payloads.length * 3) {
    throw new Error(`Expected ${payloads.length * 3} candidate records; received ${candidates.length}.`);
  }
  const candidateKeys = new Set(candidates.map((record) => `${record.external_id}:${record.market}`));
  if (candidateKeys.size !== candidates.length) throw new Error("Candidate tracking keys are not unique.");

  const write = await writeOfficialTrackingFromPayloads({ client, payloads, apply });
  const externalIds = payloads.map((payload) => nflProviderIntegerId(payload.game.providerGameId, "game"));
  const { data: storedRows, error } = await client
    .from("prediction_records")
    .select("id,external_id,market,pick,line_value,odds_american,play_grade,locked_at,model_version,snapshot_json")
    .eq("sport", "nfl")
    .in("external_id", externalIds)
    .order("external_id", { ascending: true })
    .order("market", { ascending: true });
  if (error) throw new Error(`NFL tracking verification read failed: ${error.message}`);

  const rows = (storedRows ?? []).filter((row) => candidateKeys.has(`${row.external_id}:${row.market}`));
  if (apply) {
    if (rows.length !== candidates.length) {
      throw new Error(`Expected ${candidates.length} stored records after repair; received ${rows.length}.`);
    }
    for (const payload of payloads) {
      const externalId = nflProviderIntegerId(payload.game.providerGameId, "game");
      const expectedHash = hashNflForwardEvidencePayload(payload);
      const expectedLockedAt = new Set(payload.decisions.evaluatedBets.map((decision) => {
        if (!decision.lockedAt) throw new Error(`Immutable decision ${externalId}:${decision.market} has no lock timestamp.`);
        return Date.parse(decision.lockedAt);
      }));
      const gameRows = rows.filter((row) => row.external_id === externalId);
      if (gameRows.length !== 3) throw new Error(`Expected three stored markets for ${externalId}.`);
      for (const row of gameRows) {
        const snapshot = row.snapshot_json as Record<string, unknown> | null;
        if (snapshot?.evidence_payload_sha256 !== expectedHash) {
          throw new Error(`Stored evidence hash mismatch for ${externalId}:${row.market}.`);
        }
        if (!row.locked_at || !expectedLockedAt.has(Date.parse(row.locked_at))) {
          throw new Error(`Stored lock timestamp mismatch for ${externalId}:${row.market}.`);
        }
      }
    }
  }

  console.log(JSON.stringify({
    release: "nfl_t60_tracking_repair_2026_09_27_r1",
    apply,
    season,
    week,
    payloads: payloads.map((payload) => ({
      externalId: payload.game.providerGameId,
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      capturedAt: payload.capturedAt,
      startsAt: payload.game.scheduledStart,
      evidenceSha256: hashNflForwardEvidencePayload(payload),
    })),
    candidateRecords: candidates.length,
    storedRecords: rows.length,
    write,
  }, null, 2));
}

function assertEligible(payload: NflForwardEvidencePayload): void {
  const boundary = nflForwardT60TrackingEligibility({
    stage: payload.stage,
    captureTiming: payload.captureTiming,
    t60LagMinutes: payload.t60LagMinutes,
    capturedAt: payload.capturedAt,
    providerGameId: payload.game.providerGameId,
    gameStartsAt: payload.game.scheduledStart,
    decisions: payload.decisions.evaluatedBets,
    outcomeConfidence: payload.decisions.outcomeConfidence,
    publicationApproved: payload.decisions.publicationEnabled,
    officialRegistryLaunched: isPublicallyTracked(
      "nfl",
      computeSlateDate("nfl", payload.game.scheduledStart),
    ),
  });
  if (!boundary.eligible) {
    throw new Error(`Immutable T-60 payload ${payload.game.providerGameId} is ineligible: ${boundary.reason}.`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
