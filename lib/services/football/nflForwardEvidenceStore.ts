import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "./nflForwardEvidence";

type StoredRow = {
  id: string;
  provider_game_id: string;
  stage: string;
  captured_at: string;
  game_start_at: string;
  payload_sha256: string;
  payload: unknown;
};

export async function readNflForwardEvidence(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflForwardStoredEvidence[]> {
  const { data, error } = await args.client
    .from("nfl_forward_evidence_snapshots")
    .select("id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload")
    .eq("evidence_release", NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE)
    .eq("season", args.season)
    .eq("week", args.week)
    .order("captured_at", { ascending: true });
  if (error) throw new Error(`NFL forward evidence read failed: ${error.message}`);
  return ((data ?? []) as StoredRow[]).map(normalizeStoredRow);
}

export async function appendNflForwardEvidence(args: {
  client: SupabaseClient;
  runId: string;
  payloads: NflForwardEvidencePayload[];
  apply: boolean;
}): Promise<{ proposed: number; inserted: number; hashes: string[] }> {
  const rows = args.payloads.map((payload) => {
    const payloadSha256 = hashNflForwardEvidencePayload(payload);
    return {
      evidence_release: payload.schemaRelease,
      collector_release: payload.collectorRelease,
      run_id: args.runId,
      season: payload.season,
      week: payload.week,
      provider_game_id: payload.game.providerGameId,
      away_team: payload.game.away.abbreviation,
      home_team: payload.game.home.abbreviation,
      game_start_at: payload.game.scheduledStart,
      stage: payload.stage,
      captured_at: payload.capturedAt,
      cutoff_at: payload.cutoffAt,
      payload,
      payload_sha256: payloadSha256,
      coverage: payload.coverage,
    };
  });
  const hashes = rows.map((row) => row.payload_sha256);
  if (!args.apply || rows.length === 0) return { proposed: rows.length, inserted: 0, hashes };
  const { data, error } = await args.client
    .from("nfl_forward_evidence_snapshots")
    .insert(rows)
    .select("id");
  if (error) throw new Error(`NFL forward evidence append failed: ${error.message}`);
  return { proposed: rows.length, inserted: data?.length ?? rows.length, hashes };
}

function normalizeStoredRow(row: StoredRow): NflForwardStoredEvidence {
  if (row.payload === null || typeof row.payload !== "object") throw new Error(`NFL evidence ${row.id} has no payload.`);
  const payload = row.payload as NflForwardEvidencePayload;
  if (
    payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
    payload.game.providerGameId !== row.provider_game_id ||
    payload.stage !== row.stage ||
    payload.capturedAt !== new Date(row.captured_at).toISOString()
  ) {
    throw new Error(`NFL evidence ${row.id} violates the immutable payload contract.`);
  }
  const expectedHash = hashNflForwardEvidencePayload(payload);
  if (expectedHash !== row.payload_sha256) throw new Error(`NFL evidence ${row.id} checksum mismatch.`);
  return {
    id: row.id,
    providerGameId: row.provider_game_id,
    stage: payload.stage,
    capturedAt: payload.capturedAt,
    gameStartAt: new Date(row.game_start_at).toISOString(),
    payloadSha256: row.payload_sha256,
    payload,
  };
}
