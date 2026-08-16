import type { DailyEdgeResponse, TrackingResponse } from "@/app/lab/lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";
import {
  dailyEdgeSnapshotKey,
  trackingFoundationSnapshotKey,
  trackingSnapshotKey,
  upsertLabResponseSnapshot,
} from "@/lib/services/labResponseSnapshots";
import { TRACKING_SETTLEMENT_CONTRACT_VERSION } from "@/lib/services/trackingSettlementRepairService";

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
  error?: string;
  expiresAt?: string;
  staleUntil?: string;
};

export async function refreshDailyEdgeResponseSnapshot(input: {
  sport: Sport;
  date: string;
  allowStale?: boolean;
  copyPreview?: boolean;
  source?: string;
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
    const { buildTrackingFoundationSnapshotBody } = await import("@/app/api/lab/tracking-foundation/route");
    const body = await buildTrackingFoundationSnapshotBody();
    const write = await upsertLabResponseSnapshot({
      snapshotKey,
      kind: "tracking",
      payload: body,
      ttlMs: TRACKING_SNAPSHOT_TTL_MS,
      staleMs: TRACKING_SNAPSHOT_STALE_MS,
      source: input.source ?? "cron",
      payloadVersion: TRACKING_SETTLEMENT_CONTRACT_VERSION,
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
