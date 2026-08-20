import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { readLabResponseSnapshot, upsertLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";
import { preserveLockedEplGames } from "./eplLockedSnapshot";

const CURRENT_KEY = "soccer::english_premier_league::current-week";
const SNAPSHOT_TTL_MS = 20 * 60 * 1000;
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * EPL member reads use one prebuilt weekly snapshot. They never invoke paid
 * fixture, stats, or odds providers from a user request.
 */
export async function readCurrentEplMemberSnapshot(): Promise<DailyEdgeResponse | null> {
  const fresh = await readLabResponseSnapshot<DailyEdgeResponse>(CURRENT_KEY, "fresh");
  if (fresh) return fresh.payload;
  return (await readLabResponseSnapshot<DailyEdgeResponse>(CURRENT_KEY, "stale"))?.payload ?? null;
}

export async function writeCurrentEplMemberSnapshot(input: {
  response: DailyEdgeResponse;
  round: number;
  modelRelease: string;
  calibrationRelease: string;
}) {
  const lockSafeResponse = preserveLockedEplGames(await readCurrentEplMemberSnapshot(), input.response);
  const payload: DailyEdgeResponse = {
    ...lockSafeResponse,
    slateState: "today_published",
    slate_status: "published",
    games: lockSafeResponse.games.map((game) => ({ ...game, holdReason: null })),
  };
  return upsertLabResponseSnapshot({
    snapshotKey: CURRENT_KEY,
    kind: "daily_edge",
    sport: "soccer",
    slateDate: payload.date,
    payload,
    ttlMs: SNAPSHOT_TTL_MS,
    staleMs: SNAPSHOT_STALE_MS,
    source: "epl_daily_refresh",
    payloadVersion: `${input.modelRelease}::${input.calibrationRelease}::gw${input.round}`,
  });
}
