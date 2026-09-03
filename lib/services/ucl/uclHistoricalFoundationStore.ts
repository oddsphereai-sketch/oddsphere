import {
  validateCompleteUclHistoryCohort,
  type BdlUclMatch,
  type BdlUclTeamMatchStats,
  type UclHistoryFetchTelemetry,
} from "@/lib/providers/real_api/BallDontLieUclProvider";
import { readLabResponseSnapshot, upsertLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";
import { assertFrozenUclHistoricalInputs } from "./uclChronologicalManifest";
import { joinUclMatchStats } from "./uclModel";

const SNAPSHOT_KEY = "soccer::uefa_champions_league::historical-foundation::through-2025";

export type UclHistoricalFoundationPayload = {
  schemaVersion: 6;
  seasons: number[];
  historyMatches: BdlUclMatch[];
  teamStats: BdlUclTeamMatchStats[];
  providerHistory: UclHistoryFetchTelemetry;
};

export type UclHistoricalFoundation = UclHistoricalFoundationPayload & {
  trainingMatches: ReturnType<typeof joinUclMatchStats>;
};

export function validateUclHistoricalFoundationPayload(payload: UclHistoricalFoundationPayload): UclHistoricalFoundation {
  if (payload.schemaVersion !== 6 || payload.seasons.join(",") !== "2024,2025") {
    throw new Error("UCL historical foundation schema or season mismatch");
  }
  validateCompleteUclHistoryCohort(payload.historyMatches, payload.seasons);
  assertFrozenUclHistoricalInputs({
    matches: payload.historyMatches,
    stats: payload.teamStats,
    telemetry: payload.providerHistory,
  });
  return {
    ...payload,
    // Joined rows are derived model input, never an unauthenticated cache
    // authority. Recompute them from authenticated raw match/stat fields.
    trainingMatches: joinUclMatchStats(payload.historyMatches, payload.teamStats),
  };
}

export async function readUclHistoricalFoundation(): Promise<UclHistoricalFoundation | null> {
  const payload = (await readLabResponseSnapshot<UclHistoricalFoundationPayload>(SNAPSHOT_KEY, "fresh"))?.payload ?? null;
  if (!payload) return null;
  try {
    return validateUclHistoricalFoundationPayload(payload);
  } catch {
    return null;
  }
}

export async function writeUclHistoricalFoundation(payload: UclHistoricalFoundationPayload) {
  return upsertLabResponseSnapshot({
    snapshotKey: SNAPSHOT_KEY,
    kind: "daily_edge",
    sport: "soccer",
    slateDate: "2025-12-31",
    payload,
    ttlMs: 365 * 24 * 60 * 60 * 1000,
    staleMs: 365 * 24 * 60 * 60 * 1000,
    source: "balldontlie_ucl_v1",
    payloadVersion: "ucl_historical_foundation_2026_09_03_r6_authenticated_raw_inputs",
  });
}
