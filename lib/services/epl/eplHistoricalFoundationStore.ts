import type { BdlEplTeamMatchStats } from "@/lib/providers/real_api/BallDontLieEplProvider";
import { readLabResponseSnapshot, upsertLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";
import type { EplTrainingMatch } from "./eplShadowModel";

const SNAPSHOT_KEY = "soccer::english_premier_league::historical-foundation::through-2025";

export type StoredEplHistoricalFoundation = {
  schemaVersion: 1;
  trainingMatches: EplTrainingMatch[];
  teamStats: BdlEplTeamMatchStats[];
};

function isFoundation(value: unknown): value is StoredEplHistoricalFoundation {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredEplHistoricalFoundation>;
  return row.schemaVersion === 1 && Array.isArray(row.trainingMatches) && row.trainingMatches.length >= 1_000 && Array.isArray(row.teamStats);
}

export async function readEplHistoricalFoundation(): Promise<StoredEplHistoricalFoundation | null> {
  const snapshot = await readLabResponseSnapshot<Record<string, unknown>>(SNAPSHOT_KEY, "stale");
  return snapshot && isFoundation(snapshot.payload) ? snapshot.payload : null;
}

export async function writeEplHistoricalFoundation(value: StoredEplHistoricalFoundation) {
  return upsertLabResponseSnapshot({
    snapshotKey: SNAPSHOT_KEY,
    kind: "daily_edge",
    sport: "soccer",
    payload: value as unknown as Record<string, unknown>,
    ttlMs: 365 * 24 * 60 * 60 * 1000,
    staleMs: 370 * 24 * 60 * 60 * 1000,
    source: "epl_foundation_cache",
    payloadVersion: "epl-historical-foundation-v1",
  });
}
