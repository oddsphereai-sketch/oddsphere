import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import type { PlayerPropsDashboardData } from "@/app/mlb/props/components/PlayerPropsDashboard";
import type { RealPitcherSeasonStat } from "./realScoring";
import type { PropOddsSnapshot } from "./providers";

export const MLB_PROPS_BOARD_SNAPSHOT_KIND = "member_board_snapshot_v1";
export const DEFAULT_MLB_PROPS_MAX_SNAPSHOT_JSON_BYTES = 16_000_000;
export const DEFAULT_MLB_PROPS_MAX_SNAPSHOT_GZIP_BYTES = 1_250_000;

export type MlbPropsBoardValidation = {
  publishable: boolean;
  actionableRows: number;
  researchRows: number;
  mappedRows: number;
  sourceRows: number;
  staleOddsRows: number;
  providerCoverage?: {
    rawOffers: number;
    normalizedOffers: number;
    droppedOffers: number;
    normalizedPriceRows: number;
    marketTypes: string[];
    unmappedMarketTypes: string[];
    vendors: string[];
  };
  errors: string[];
  warnings: string[];
};

export type MlbPropsBoardMovement = {
  comparedWith: string | null;
  changedPrices: number;
  changedLines: number;
  addedRows: number;
  removedRows: number;
};

export type MlbPropsBoardSnapshot = {
  schemaVersion: 1;
  snapshotId: string;
  slateDate: string;
  asOfTimestamp: string;
  refreshMode: "fast" | "full";
  data: PlayerPropsDashboardData;
  validation: MlbPropsBoardValidation;
  movement: MlbPropsBoardMovement;
  modelContext?: {
    probablePitcherSeasonStats: Array<[string, RealPitcherSeasonStat]>;
    openingPropOdds?: PropOddsSnapshot[];
  };
};

type SnapshotEnvelope = {
  kind: typeof MLB_PROPS_BOARD_SNAPSHOT_KIND;
  encoding: "gzip-base64";
  checksum: string;
  snapshot_id: string;
  slate_date: string;
  as_of_timestamp: string;
  payload: string;
  validation: MlbPropsBoardValidation;
  movement: MlbPropsBoardMovement;
};

export type MlbPropsBoardSnapshotSize = {
  jsonBytes: number;
  gzipBytes: number;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MLB props snapshots require Supabase service-role credentials.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function encodeMlbPropsBoardSnapshot(snapshot: MlbPropsBoardSnapshot): SnapshotEnvelope {
  const json = JSON.stringify(snapshot);
  const compressed = gzipSync(Buffer.from(json));
  assertSnapshotSizeWithinLimits({ jsonBytes: Buffer.byteLength(json), gzipBytes: compressed.byteLength });
  const checksum = createHash("sha256").update(json).digest("hex");
  return {
    kind: MLB_PROPS_BOARD_SNAPSHOT_KIND,
    encoding: "gzip-base64",
    checksum,
    snapshot_id: snapshot.snapshotId,
    slate_date: snapshot.slateDate,
    as_of_timestamp: snapshot.asOfTimestamp,
    payload: compressed.toString("base64"),
    validation: snapshot.validation,
    movement: snapshot.movement,
  };
}

export function decodeMlbPropsBoardSnapshot(value: unknown): MlbPropsBoardSnapshot | null {
  if (!isRecord(value) || value.kind !== MLB_PROPS_BOARD_SNAPSHOT_KIND || value.encoding !== "gzip-base64") return null;
  if (typeof value.payload !== "string" || typeof value.checksum !== "string") return null;
  try {
    const json = gunzipSync(Buffer.from(value.payload, "base64")).toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    const snapshot = JSON.parse(json) as MlbPropsBoardSnapshot;
    if (snapshot.schemaVersion !== 1 || !snapshot.snapshotId || !snapshot.slateDate || !snapshot.validation?.publishable) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export async function loadLatestMlbPropsBoardSnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  return (await loadRecentMlbPropsBoardSnapshots(slateDate, 1))[0] ?? null;
}

export async function loadRecentMlbPropsBoardSnapshots(slateDate: string, limit = 3): Promise<MlbPropsBoardSnapshot[]> {
  const { data, error } = await getSupabase()
    .from("prop_scoring_runs")
    .select("metadata_json")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .eq("status", "completed")
    .eq("metadata_json->>kind", MLB_PROPS_BOARD_SNAPSHOT_KIND)
    .order("created_at", { ascending: false })
    .limit(Math.max(5, Math.min(limit * 2, 20)));
  if (error) throw error;
  const snapshots: MlbPropsBoardSnapshot[] = [];
  for (const row of data ?? []) {
    const decoded = decodeMlbPropsBoardSnapshot(row.metadata_json);
    if (decoded) snapshots.push(decoded);
    if (snapshots.length >= limit) break;
  }
  return snapshots;
}

const loadCachedSnapshot = unstable_cache(
  async (slateDate: string) => loadLatestMlbPropsBoardSnapshot(slateDate),
  ["mlb-props-member-board-latest-v1"],
  { revalidate: 60, tags: ["mlb-props-member-board"] },
);

export async function loadCachedLatestMlbPropsBoardSnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  return loadCachedSnapshot(slateDate);
}

export function measureMlbPropsBoardSnapshot(snapshot: MlbPropsBoardSnapshot): MlbPropsBoardSnapshotSize {
  const json = JSON.stringify(snapshot);
  return {
    jsonBytes: Buffer.byteLength(json),
    gzipBytes: gzipSync(Buffer.from(json)).byteLength,
  };
}

export function assertSnapshotSizeWithinLimits(size: MlbPropsBoardSnapshotSize): void {
  const maxJsonBytes = envPositiveInteger("ODDSPHERE_PROPS_MAX_SNAPSHOT_JSON_BYTES", DEFAULT_MLB_PROPS_MAX_SNAPSHOT_JSON_BYTES);
  const maxGzipBytes = envPositiveInteger("ODDSPHERE_PROPS_MAX_SNAPSHOT_GZIP_BYTES", DEFAULT_MLB_PROPS_MAX_SNAPSHOT_GZIP_BYTES);
  if (size.jsonBytes > maxJsonBytes || size.gzipBytes > maxGzipBytes) {
    throw new Error(`MLB props snapshot payload limit exceeded: json=${size.jsonBytes}/${maxJsonBytes}, gzip=${size.gzipBytes}/${maxGzipBytes}.`);
  }
}

export async function publishMlbPropsBoardSnapshot(snapshot: MlbPropsBoardSnapshot): Promise<string> {
  if (!snapshot.validation.publishable) throw new Error("Refusing to publish an invalid MLB props board snapshot.");
  const metadata = encodeMlbPropsBoardSnapshot(snapshot);
  const { data, error } = await getSupabase()
    .from("prop_scoring_runs")
    .insert({
      sport: "mlb",
      slate_date: snapshot.slateDate,
      provider_mode: "real",
      odds_provider: "balldontlie",
      stats_provider: "mlb_stats_api+balldontlie",
      context_provider: "nws+baseball_savant+balldontlie",
      mlb_provider: "real",
      started_at: snapshot.asOfTimestamp,
      completed_at: new Date().toISOString(),
      status: "completed",
      dry_run: false,
      persisted: true,
      publish_enabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
      display_enabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
      games_seen: snapshot.data.summary.gamesWithProps,
      markets_seen: snapshot.data.summary.marketsAvailable,
      odds_snapshots_seen: snapshot.validation.sourceRows,
      feature_snapshots_written: snapshot.data.props.length,
      predictions_written: snapshot.data.props.filter((row) => row.finalProbability !== null).length,
      edges_written: snapshot.data.props.filter((row) => row.modelEdge !== null).length,
      recommendations_written: snapshot.validation.actionableRows,
      metadata_json: metadata,
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envPositiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
