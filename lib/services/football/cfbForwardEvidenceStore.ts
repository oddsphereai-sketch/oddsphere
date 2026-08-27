import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE,
  hashCfbForwardEvidencePayload,
  type CfbForwardEvidencePayload,
  type CfbForwardStoredEvidence,
} from "./cfbForwardEvidence";

type StoredRow = {
  id: string;
  provider_game_id: string;
  stage: string;
  captured_at: string;
  game_start_at: string;
  payload_sha256: string;
  payload: unknown;
};

export async function readCfbForwardEvidence(args: { client: SupabaseClient; season: number }): Promise<CfbForwardStoredEvidence[]> {
  const { data, error } = await args.client
    .from("cfb_forward_evidence_snapshots")
    .select("id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload")
    .in("evidence_release", [CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE])
    .eq("season", args.season)
    .order("captured_at", { ascending: true });
  if (error) throw new Error(`CFB forward evidence read failed: ${error.message}`);
  return ((data ?? []) as StoredRow[]).map(normalizeStoredRow);
}

export async function appendCfbForwardEvidence(args: {
  client: SupabaseClient;
  runId: string;
  payloads: CfbForwardEvidencePayload[];
  apply: boolean;
}): Promise<{ proposed: number; inserted: number; hashes: string[] }> {
  const rows = args.payloads.map((payload) => {
    const payloadSha256 = hashCfbForwardEvidencePayload(payload);
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
  const { data, error } = await args.client.from("cfb_forward_evidence_snapshots").insert(rows).select("id");
  if (error) throw new Error(`CFB forward evidence append failed: ${error.message}`);
  return { proposed: rows.length, inserted: data?.length ?? rows.length, hashes };
}

function normalizeStoredRow(row: StoredRow): CfbForwardStoredEvidence {
  if (row.payload === null || typeof row.payload !== "object") throw new Error(`CFB evidence ${row.id} has no payload.`);
  const payload = row.payload as CfbForwardEvidencePayload;
  if (![CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE].includes(payload.schemaRelease as typeof CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE) || payload.game.providerGameId !== row.provider_game_id || payload.stage !== row.stage || payload.capturedAt !== new Date(row.captured_at).toISOString()) {
    throw new Error(`CFB evidence ${row.id} violates the immutable payload contract.`);
  }
  if (hashCfbForwardEvidencePayload(payload) !== row.payload_sha256) throw new Error(`CFB evidence ${row.id} checksum mismatch.`);
  return { id: row.id, providerGameId: row.provider_game_id, stage: payload.stage, capturedAt: payload.capturedAt, gameStartAt: new Date(row.game_start_at).toISOString(), payloadSha256: row.payload_sha256, payload };
}
