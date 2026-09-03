import type { EplTrainingMatch } from "@/lib/services/epl/eplShadowModel";
import type { BdlUclMatch, BdlUclTeamMatchStats } from "@/lib/providers/real_api/BallDontLieUclProvider";
import { readLabResponseSnapshot, upsertLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";

const SNAPSHOT_KEY = "soccer::uefa_champions_league::historical-foundation::through-2025";

export type UclHistoricalFoundation = {
  schemaVersion: 2;
  historyMatches: BdlUclMatch[];
  trainingMatches: EplTrainingMatch[];
  teamStats: BdlUclTeamMatchStats[];
};

export async function readUclHistoricalFoundation(): Promise<UclHistoricalFoundation | null> {
  return (await readLabResponseSnapshot<UclHistoricalFoundation>(SNAPSHOT_KEY, "fresh"))?.payload ?? null;
}

export async function writeUclHistoricalFoundation(payload: UclHistoricalFoundation) {
  return upsertLabResponseSnapshot({
    snapshotKey: SNAPSHOT_KEY,
    kind: "daily_edge",
    sport: "soccer",
    slateDate: "2025-12-31",
    payload,
    ttlMs: 365 * 24 * 60 * 60 * 1000,
    staleMs: 365 * 24 * 60 * 60 * 1000,
    source: "balldontlie_ucl_v1",
    payloadVersion: "ucl_historical_foundation_2026_09_03_r2_raw_history_cached",
  });
}
