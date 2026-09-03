import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { readLabResponseSnapshot, readLatestLabResponseSnapshot, upsertLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";
import { preserveLockedEplGames } from "@/lib/services/epl/eplLockedSnapshot";
import { eplEmergencySnapshotIsUsable } from "@/lib/services/epl/eplMemberSnapshotContinuity";

export const UCL_MEMBER_SNAPSHOT_KEY = "soccer::uefa_champions_league::current-week" as const;
export const UCL_MEMBER_SNAPSHOT_LIFECYCLE_RELEASE = "ucl_member_snapshot_lifecycle_2026_09_03_r4_et_midnight_matchweek_rollover" as const;
const TTL_MS = 20 * 60_000;
const STALE_MS = 24 * 60 * 60_000;

export async function readCurrentUclMemberSnapshot(): Promise<DailyEdgeResponse | null> {
  const fresh = await readLabResponseSnapshot<DailyEdgeResponse>(UCL_MEMBER_SNAPSHOT_KEY, "fresh");
  if (fresh) return fresh.payload;
  const stale = await readLabResponseSnapshot<DailyEdgeResponse>(UCL_MEMBER_SNAPSHOT_KEY, "stale");
  if (stale) return stale.payload;
  const latest = await readLatestLabResponseSnapshot<DailyEdgeResponse>(UCL_MEMBER_SNAPSHOT_KEY);
  return latest && eplEmergencySnapshotIsUsable(latest.payload, latest.generatedAt) ? latest.payload : null;
}

export async function writeCurrentUclMemberSnapshot(input: { response: DailyEdgeResponse; matchweek: number; boardDate: string; modelRelease: string; calibrationRelease: string }) {
  const lockSafe = preserveLockedEplGames(
    await readCurrentUclMemberSnapshot(),
    input.response,
    new Date(),
    { boardDate: input.boardDate },
  );
  const payload: DailyEdgeResponse = {
    ...lockSafe,
    slateState: "today_published",
    slate_status: "published",
    games: lockSafe.games.map((game) => ({ ...game, holdReason: null })),
  };
  return upsertLabResponseSnapshot({
    snapshotKey: UCL_MEMBER_SNAPSHOT_KEY,
    kind: "daily_edge",
    sport: "soccer",
    slateDate: payload.date,
    payload,
    ttlMs: TTL_MS,
    staleMs: STALE_MS,
    source: "ucl_daily_refresh",
    payloadVersion: `${input.modelRelease}::${input.calibrationRelease}::${UCL_MEMBER_SNAPSHOT_LIFECYCLE_RELEASE}::mw${input.matchweek}`,
  });
}
