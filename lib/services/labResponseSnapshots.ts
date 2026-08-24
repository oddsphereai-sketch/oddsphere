import { supabase } from "@/lib/db/supabase";
import type { DailyEdgeResponse, TrackingResponse } from "@/app/lab/lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export type LabResponseSnapshotKind = "daily_edge" | "tracking" | "mlb_props_board" | "mlb_props_player";
export type LabResponseSnapshotPayload = DailyEdgeResponse | TrackingResponse | Record<string, unknown>;
export type LabResponseSnapshotCacheState = "DB_SNAPSHOT" | "DB_SNAPSHOT_STALE";

export type DailyEdgeSnapshotKeyInput = {
  sport: Sport;
  requestedDate: string;
  allowStale: boolean;
  copyPreview: boolean;
};

export type LabResponseSnapshotReadResult<T extends LabResponseSnapshotPayload> = {
  payload: T;
  cacheState: LabResponseSnapshotCacheState;
  generatedAt: string;
  expiresAt: string;
  staleUntil: string;
};

const TABLE_MISSING_RE = /relation .*lab_response_snapshots.* does not exist|schema cache/i;

export function dailyEdgeSnapshotKey(input: DailyEdgeSnapshotKeyInput): string {
  return [
    input.sport,
    input.requestedDate,
    input.allowStale ? "allow-stale" : "current-only",
    input.copyPreview ? "copy-preview" : "live-copy",
  ].join("::");
}

export function trackingSnapshotKey(): string {
  return "tracking::all";
}

export function trackingFoundationSnapshotKey(input: {
  sport?: string | null;
  date: string;
}): string {
  return ["tracking-foundation", input.sport ?? "all", input.date].join("::");
}

export async function readLabResponseSnapshot<T extends LabResponseSnapshotPayload>(
  snapshotKey: string,
  mode: "fresh" | "stale" = "fresh",
): Promise<LabResponseSnapshotReadResult<T> | null> {
  const nowIso = new Date().toISOString();
  const expiryColumn = mode === "fresh" ? "expires_at" : "stale_until";
  const { data, error } = await supabase
    .from("lab_response_snapshots")
    .select("payload, generated_at, expires_at, stale_until")
    .eq("snapshot_key", snapshotKey)
    .gt(expiryColumn, nowIso)
    .maybeSingle();

  if (error) {
    if (TABLE_MISSING_RE.test(error.message)) return null;
    console.warn(`lab_response_snapshots read failed for ${snapshotKey}: ${error.message}`);
    return null;
  }
  if (!data) return null;

  const fresh = new Date(String(data.expires_at)).getTime() > Date.now();
  return {
    payload: data.payload as T,
    cacheState: fresh ? "DB_SNAPSHOT" : "DB_SNAPSHOT_STALE",
    generatedAt: String(data.generated_at),
    expiresAt: String(data.expires_at),
    staleUntil: String(data.stale_until),
  };
}

/**
 * Reads the newest stored value without treating its cache deadline as a
 * truth deadline. Callers must apply their own narrow domain guard before
 * exposing it. This is for continuity fallbacks only; normal reads should use
 * the fresh/stale modes above.
 */
export async function readLatestLabResponseSnapshot<T extends LabResponseSnapshotPayload>(
  snapshotKey: string,
): Promise<LabResponseSnapshotReadResult<T> | null> {
  const { data, error } = await supabase
    .from("lab_response_snapshots")
    .select("payload, generated_at, expires_at, stale_until")
    .eq("snapshot_key", snapshotKey)
    .maybeSingle();

  if (error) {
    if (TABLE_MISSING_RE.test(error.message)) return null;
    console.warn(`lab_response_snapshots latest read failed for ${snapshotKey}: ${error.message}`);
    return null;
  }
  if (!data) return null;

  return {
    payload: data.payload as T,
    cacheState: "DB_SNAPSHOT_STALE",
    generatedAt: String(data.generated_at),
    expiresAt: String(data.expires_at),
    staleUntil: String(data.stale_until),
  };
}

export async function upsertLabResponseSnapshot(input: {
  snapshotKey: string;
  kind: LabResponseSnapshotKind;
  payload: LabResponseSnapshotPayload;
  ttlMs: number;
  staleMs: number;
  sport?: Sport | null;
  slateDate?: string | null;
  source?: string;
  payloadVersion?: string;
}): Promise<{ ok: true; snapshotKey: string; expiresAt: string; staleUntil: string } | { ok: false; snapshotKey: string; error: string }> {
  const now = Date.now();
  const expiresAt = new Date(now + input.ttlMs).toISOString();
  const staleUntil = new Date(now + input.staleMs).toISOString();
  const { error } = await supabase
    .from("lab_response_snapshots")
    .upsert(
      {
        snapshot_key: input.snapshotKey,
        kind: input.kind,
        sport: input.sport ?? null,
        slate_date: input.slateDate ?? null,
        payload: input.payload,
        payload_version: input.payloadVersion ?? "v1",
        source: input.source ?? "cron",
        generated_at: new Date(now).toISOString(),
        expires_at: expiresAt,
        stale_until: staleUntil,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "snapshot_key" },
    );

  if (error) {
    if (!TABLE_MISSING_RE.test(error.message)) {
      console.warn(`lab_response_snapshots upsert failed for ${input.snapshotKey}: ${error.message}`);
    }
    return { ok: false, snapshotKey: input.snapshotKey, error: error.message };
  }

  return { ok: true, snapshotKey: input.snapshotKey, expiresAt, staleUntil };
}
