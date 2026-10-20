import type { DailyEdgeResponse, TrackingResponse } from "@/app/lab/lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";
import {
  dailyEdgeSnapshotKey,
  readLatestLabResponseSnapshot,
  trackingFoundationSnapshotKey,
  trackingSnapshotKey,
  upsertLabResponseSnapshot,
} from "@/lib/services/labResponseSnapshots";
import {
  applyNbaPublishedLockMetadata,
  NBA_MEMBER_LOCK_PUBLICATION_RELEASE,
} from "@/lib/services/nba/nbaPublishedLockMetadata";
import { supabase } from "@/lib/db/supabase";

const DAILY_EDGE_SNAPSHOT_TTL_MS = Number(
  // The lightest regular publisher runs every 15 minutes. Keep a five-minute
  // scheduling buffer so a healthy board does not appear stale between runs.
  process.env.DAILY_EDGE_DB_SNAPSHOT_TTL_MS ?? 20 * 60 * 1000,
);
const DAILY_EDGE_SNAPSHOT_STALE_MS = Number(
  process.env.DAILY_EDGE_DB_SNAPSHOT_STALE_MS ?? 24 * 60 * 60 * 1000,
);
const TRACKING_SNAPSHOT_TTL_MS = Number(
  // Tracking publishes hourly at :33. Keep a ten-minute scheduling buffer so
  // a healthy hourly publisher is not labeled stale for half of every hour.
  process.env.TRACKING_DB_SNAPSHOT_TTL_MS ?? 70 * 60 * 1000,
);
const TRACKING_SNAPSHOT_STALE_MS = Number(
  process.env.TRACKING_DB_SNAPSHOT_STALE_MS ?? 7 * 24 * 60 * 60 * 1000,
);

type SnapshotWriteResult = {
  ok: boolean;
  snapshotKey: string;
  status?: number;
  games?: number;
  slateState?: DailyEdgeResponse["slateState"];
  error?: string;
  expiresAt?: string;
  staleUntil?: string;
  lockedGames?: number;
  changedGames?: number;
};

/**
 * Publish authoritative NBA lock metadata without recomputing the rolling
 * model board. This is intentionally a metadata-only post-lock operation:
 * every prediction, score, side, price, grade, and evidence field comes from
 * the already coherent snapshot and remains unchanged.
 */
export async function refreshNbaPublishedLockMetadata(input: {
  date: string;
  source?: string;
}): Promise<SnapshotWriteResult> {
  const snapshotKey = dailyEdgeSnapshotKey({
    sport: "nba",
    requestedDate: input.date,
    allowStale: false,
    copyPreview: false,
  });

  try {
    const snapshot = await readLatestLabResponseSnapshot<DailyEdgeResponse>(snapshotKey);
    if (!snapshot) {
      return { ok: false, snapshotKey, error: "NBA Daily Edge snapshot is unavailable for lock publication" };
    }
    const externalIds = snapshot.payload.games.map((game) => game.external_id);
    if (externalIds.length === 0) {
      return { ok: false, snapshotKey, error: "NBA Daily Edge snapshot has no games for lock publication" };
    }

    const gameLookup = await supabase
      .from("games")
      .select("id,external_id")
      .eq("sport", "nba")
      .in("external_id", externalIds);
    if (gameLookup.error) {
      return { ok: false, snapshotKey, error: `NBA lock game lookup failed: ${gameLookup.error.message}` };
    }
    const dbIdByExternalId = new Map<number, number>();
    for (const row of gameLookup.data ?? []) {
      dbIdByExternalId.set(Number(row.external_id), Number(row.id));
    }
    if (dbIdByExternalId.size !== new Set(externalIds).size) {
      return {
        ok: false,
        snapshotKey,
        error: `NBA lock game lookup covered ${dbIdByExternalId.size}/${new Set(externalIds).size} snapshot games`,
      };
    }
    const gameIds = [...dbIdByExternalId.values()];
    const lockLookup = await supabase
      .from("prediction_records")
      .select("game_id,market,locked_at")
      .eq("sport", "nba")
      .in("game_id", gameIds)
      .not("locked_at", "is", null);
    if (lockLookup.error) {
      return { ok: false, snapshotKey, error: `NBA lock tuple lookup failed: ${lockLookup.error.message}` };
    }

    const patched = applyNbaPublishedLockMetadata({
      payload: snapshot.payload,
      dbIdByExternalId,
      rows: lockLookup.data ?? [],
    });
    if (patched.lockedGames === 0) {
      return { ok: false, snapshotKey, error: "NBA lock publication found no complete locked games" };
    }

    const write = await upsertLabResponseSnapshot({
      snapshotKey,
      kind: "daily_edge",
      sport: "nba",
      slateDate: patched.payload.date ?? input.date,
      payload: patched.payload,
      ttlMs: DAILY_EDGE_SNAPSHOT_TTL_MS,
      staleMs: DAILY_EDGE_SNAPSHOT_STALE_MS,
      source: input.source ?? "pregame_sweep_lock",
      payloadVersion: NBA_MEMBER_LOCK_PUBLICATION_RELEASE,
    });
    if (!write.ok) {
      return { ok: false, snapshotKey, error: write.error, lockedGames: patched.lockedGames, changedGames: patched.changedGames };
    }
    return {
      ok: true,
      snapshotKey,
      games: patched.payload.games.length,
      slateState: patched.payload.slateState,
      expiresAt: write.expiresAt,
      staleUntil: write.staleUntil,
      lockedGames: patched.lockedGames,
      changedGames: patched.changedGames,
    };
  } catch (error) {
    return { ok: false, snapshotKey, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function refreshDailyEdgeResponseSnapshot(input: {
  sport: Sport;
  date: string;
  allowStale?: boolean;
  copyPreview?: boolean;
  source?: string;
  /** Fail closed before persistence when a caller requires an exact slate state. */
  requiredSlateState?: DailyEdgeResponse["slateState"];
}): Promise<SnapshotWriteResult> {
  const allowStale = input.allowStale ?? false;
  const copyPreview = input.copyPreview ?? false;
  const snapshotKey = dailyEdgeSnapshotKey({
    sport: input.sport,
    requestedDate: input.date,
    allowStale,
    copyPreview,
  });

  try {
    const { GET } = await import("@/app/api/lab/daily-edge/route");
    const url = new URL("https://oddsphere.internal/api/lab/daily-edge");
    url.searchParams.set("sport", input.sport);
    url.searchParams.set("date", input.date);
    url.searchParams.set("snapshotBypass", "true");
    if (allowStale) url.searchParams.set("allowStale", "true");
    if (copyPreview) url.searchParams.set("copyPreview", "1");

    const response = await GET(new Request(url));
    const body = (await response.json()) as DailyEdgeResponse & { error?: string };
    if (!response.ok) {
      return {
        ok: false,
        snapshotKey,
        status: response.status,
        error: body.error ?? `daily-edge snapshot build returned HTTP ${response.status}`,
      };
    }
    if (input.requiredSlateState && body.slateState !== input.requiredSlateState) {
      return {
        ok: false,
        snapshotKey,
        games: body.games?.length ?? 0,
        slateState: body.slateState,
        error: `daily-edge snapshot state ${body.slateState ?? "unknown"} did not match required ${input.requiredSlateState}`,
      };
    }

    const write = await upsertLabResponseSnapshot({
      snapshotKey,
      kind: "daily_edge",
      sport: input.sport,
      slateDate: body.date ?? input.date,
      payload: body,
      ttlMs: DAILY_EDGE_SNAPSHOT_TTL_MS,
      staleMs: DAILY_EDGE_SNAPSHOT_STALE_MS,
      source: input.source ?? "cron",
    });

    if (!write.ok) return { ok: false, snapshotKey, games: body.games?.length ?? 0, error: write.error };
    return {
      ok: true,
      snapshotKey,
      games: body.games?.length ?? 0,
      slateState: body.slateState,
      expiresAt: write.expiresAt,
      staleUntil: write.staleUntil,
    };
  } catch (e) {
    return { ok: false, snapshotKey, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function refreshTrackingResponseSnapshot(input: {
  source?: string;
} = {}): Promise<SnapshotWriteResult> {
  const snapshotKey = trackingSnapshotKey();
  try {
    const { GET } = await import("@/app/api/lab/tracking/route");
    const url = new URL("https://oddsphere.internal/api/lab/tracking");
    url.searchParams.set("snapshotBypass", "true");

    const response = await GET(new Request(url));
    const body = (await response.json()) as TrackingResponse & { error?: string };
    if (!response.ok) {
      return {
        ok: false,
        snapshotKey,
        status: response.status,
        error: body.error ?? `tracking snapshot build returned HTTP ${response.status}`,
      };
    }

    const write = await upsertLabResponseSnapshot({
      snapshotKey,
      kind: "tracking",
      payload: body,
      ttlMs: TRACKING_SNAPSHOT_TTL_MS,
      staleMs: TRACKING_SNAPSHOT_STALE_MS,
      source: input.source ?? "cron",
    });

    if (!write.ok) return { ok: false, snapshotKey, error: write.error };
    return {
      ok: true,
      snapshotKey,
      expiresAt: write.expiresAt,
      staleUntil: write.staleUntil,
    };
  } catch (e) {
    return { ok: false, snapshotKey, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function refreshTrackingFoundationResponseSnapshot(input: {
  source?: string;
} = {}): Promise<SnapshotWriteResult> {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const snapshotKey = trackingFoundationSnapshotKey({ date });
  try {
    const { buildTrackingFoundationSnapshotBody } = await import("@/lib/services/trackingFoundationSnapshot");
    const body = await buildTrackingFoundationSnapshotBody();
    const write = await upsertLabResponseSnapshot({
      snapshotKey,
      kind: "tracking",
      payload: body,
      ttlMs: TRACKING_SNAPSHOT_TTL_MS,
      staleMs: TRACKING_SNAPSHOT_STALE_MS,
      source: input.source ?? "cron",
      payloadVersion: "tracking-foundation-v7-alternate-line-evidence-backed",
    });
    if (!write.ok) return { ok: false, snapshotKey, error: write.error };
    return {
      ok: true,
      snapshotKey,
      expiresAt: write.expiresAt,
      staleUntil: write.staleUntil,
    };
  } catch (error) {
    return { ok: false, snapshotKey, error: error instanceof Error ? error.message : String(error) };
  }
}
