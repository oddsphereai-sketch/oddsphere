import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE,
  NFL_FORWARD_EVIDENCE_PRIOR_SCHEMA_RELEASE,
  NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  hashNflForwardEvidencePayload,
  type NflForwardAnyEvidencePayload,
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

export const NFL_FORWARD_EVIDENCE_PAGE_SIZE = 1_000 as const;
export const NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE = 5_000 as const;

export async function readNflForwardEvidence(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflForwardStoredEvidence[]> {
  return readNflForwardEvidenceRelease({ ...args, evidenceRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE });
}

export async function readLegacyNflForwardEvidence(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflForwardStoredEvidence[]> {
  return readNflForwardEvidenceRelease({ ...args, evidenceRelease: NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE });
}

export async function readPriorNflForwardEvidence(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflForwardStoredEvidence[]> {
  return readNflForwardEvidenceRelease({ ...args, evidenceRelease: NFL_FORWARD_EVIDENCE_PRIOR_SCHEMA_RELEASE });
}

export async function readPreviousNflForwardEvidence(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflForwardStoredEvidence[]> {
  return readNflForwardEvidenceRelease({ ...args, evidenceRelease: NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE });
}

async function readNflForwardEvidenceRelease(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  evidenceRelease:
    | typeof NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE
    | typeof NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE
    | typeof NFL_FORWARD_EVIDENCE_PRIOR_SCHEMA_RELEASE
    | typeof NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE;
}): Promise<NflForwardStoredEvidence[]> {
  const rows: StoredRow[] = [];
  for (let from = 0; from < NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE; from += NFL_FORWARD_EVIDENCE_PAGE_SIZE) {
    const { data, error } = await args.client
      .from("nfl_forward_evidence_snapshots")
      .select("id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload")
      .eq("evidence_release", args.evidenceRelease)
      .eq("season", args.season)
      .eq("week", args.week)
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + NFL_FORWARD_EVIDENCE_PAGE_SIZE - 1);
    if (error) throw new Error(`NFL forward evidence read failed: ${error.message}`);
    const page = (data ?? []) as StoredRow[];
    rows.push(...page);
    if (page.length < NFL_FORWARD_EVIDENCE_PAGE_SIZE) {
      return rows.map((row) => normalizeStoredRow(row, args.evidenceRelease));
    }
  }
  throw new Error(
    `NFL forward evidence read exceeded its bounded ${NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE}-row release limit.`,
  );
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

function normalizeStoredRow(
  row: StoredRow,
  expectedRelease:
    | typeof NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE
    | typeof NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE
    | typeof NFL_FORWARD_EVIDENCE_PRIOR_SCHEMA_RELEASE
    | typeof NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE,
): NflForwardStoredEvidence {
  if (row.payload === null || typeof row.payload !== "object") throw new Error(`NFL evidence ${row.id} has no payload.`);
  const payload = row.payload as NflForwardAnyEvidencePayload;
  if (
    payload.schemaRelease !== expectedRelease ||
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
