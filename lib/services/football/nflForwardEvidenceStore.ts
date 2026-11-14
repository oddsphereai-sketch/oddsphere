import type { SupabaseClient } from "@supabase/supabase-js";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE,
  NFL_FORWARD_EVIDENCE_PRIOR_SCHEMA_RELEASE,
  NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  hashNflForwardEvidencePayload,
  normalizeNflForwardEvidenceForStorage,
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

export const NFL_FORWARD_EVIDENCE_READ_RELEASE =
  "nfl_forward_evidence_read_2026_11_14_r1_lossless_bounded_history" as const;
// A complete week can exceed 5k observations before Sunday. Keep every row in
// its original order without retaining the entire decoded JSON history.
export const NFL_FORWARD_EVIDENCE_PAGE_SIZE = 50 as const;
export const NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE = 12_000 as const;
export const NFL_FORWARD_EVIDENCE_MAX_PAYLOAD_JSON_BYTES = 2_000_000 as const;
export const NFL_FORWARD_EVIDENCE_MAX_HOT_JSON_BYTES = 96_000_000 as const;
export const NFL_FORWARD_EVIDENCE_MAX_COMPRESSED_BYTES = 256_000_000 as const;
export const NFL_FORWARD_EVIDENCE_MAX_DECODED_GROUPS = 64 as const;
export const NFL_FORWARD_EVIDENCE_MAX_DECODED_JSON_BYTES = 8_000_000 as const;

type JsonObject = Record<string, unknown>;
type CompressedGroup = { bytes: Buffer; jsonBytes: number };

/** One read owns its archive/cache. Hydration has no database or provider I/O. */
function createPayloadArchive() {
  const decoded = new Map<number, { value: JsonObject; jsonBytes: number }>();
  let compressedBytes = 0;
  let hotJsonBytes = 0;
  let decodedJsonBytes = 0;
  let nextGroupId = 0;

  function retainHotBytes(bytes: number) {
    hotJsonBytes += bytes;
    if (hotJsonBytes > NFL_FORWARD_EVIDENCE_MAX_HOT_JSON_BYTES) {
      throw new Error("NFL forward evidence read exceeded its bounded hot JSON byte limit.");
    }
  }

  function readGroup(id: number, group: CompressedGroup): JsonObject {
    const cached = decoded.get(id);
    if (cached) {
      decoded.delete(id);
      decoded.set(id, cached);
      return cached.value;
    }
    const value = JSON.parse(gunzipSync(group.bytes, {
      maxOutputLength: NFL_FORWARD_EVIDENCE_MAX_PAYLOAD_JSON_BYTES,
    }).toString("utf8")) as JsonObject;
    decoded.set(id, { value, jsonBytes: group.jsonBytes });
    decodedJsonBytes += group.jsonBytes;
    while (decoded.size > NFL_FORWARD_EVIDENCE_MAX_DECODED_GROUPS ||
      decodedJsonBytes > NFL_FORWARD_EVIDENCE_MAX_DECODED_JSON_BYTES) {
      const oldest = decoded.keys().next().value!;
      decodedJsonBytes -= decoded.get(oldest)!.jsonBytes;
      decoded.delete(oldest);
    }
    return value;
  }

  return (payload: NflForwardAnyEvidencePayload): NflForwardAnyEvidencePayload => {
    // These small values serve complete chronology/lock/context scans. Large
    // market history is separate from depth/forecast evidence so reading a
    // quote does not repeatedly decode an unrelated complete roster.
    const view: JsonObject = {};
    const cold: [JsonObject, JsonObject] = [{}, {}];
    for (const [key, value] of Object.entries(payload)) {
      retainHotBytes(Buffer.byteLength(JSON.stringify(key)));
      const hot = value === null || typeof value !== "object" ||
        key === "game" || key === "decisions" || key === "coverage" || key === "injuries";
      if (hot) {
        const json = JSON.stringify(value);
        retainHotBytes(json === undefined ? 0 : Buffer.byteLength(json));
        // Clone independently for each row; mock/input aliases cannot become
        // aliases between distinct immutable stored observations.
        Object.defineProperty(view, key, { enumerable: true, configurable: true, writable: true,
          value: value !== null && typeof value === "object" ? JSON.parse(json!) : value });
      } else {
        const group = key === "market" || key === "contextualEvidenceCapture" ? 0 : 1;
        Object.defineProperty(cold[group], key, { enumerable: true, value });
        // Define in source-key order, even though compressed groups differ.
        Object.defineProperty(view, key, { enumerable: true, get: () => readGroup(
          groups[group].id, groups[group].packed,
        )[key] });
      }
    }
    const groups = cold.map((fields) => {
      const json = JSON.stringify(fields);
      // Copy out of zlib's chunk allocation; retaining each small chunk's
      // unused backing capacity would defeat the compressed byte budget.
      const bytes = Buffer.from(gzipSync(json, { level: 1 }));
      compressedBytes += bytes.byteLength;
      if (compressedBytes > NFL_FORWARD_EVIDENCE_MAX_COMPRESSED_BYTES) {
        throw new Error("NFL forward evidence read exceeded its bounded compressed byte limit.");
      }
      return { id: nextGroupId++, packed: { bytes, jsonBytes: Buffer.byteLength(json) } };
    });
    return view as unknown as NflForwardAnyEvidencePayload;
  };
}

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
  const rows: NflForwardStoredEvidence[] = [];
  const archive = createPayloadArchive();
  for (let from = 0; from <= NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE; from += NFL_FORWARD_EVIDENCE_PAGE_SIZE) {
    const { data, error } = await args.client
      .from("nfl_forward_evidence_snapshots")
      .select("id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload")
      .eq("evidence_release", args.evidenceRelease)
      .eq("season", args.season)
      .eq("week", args.week)
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      // A one-row terminal probe distinguishes a complete exact-boundary read
      // from overflow. Never silently return an incomplete release.
      .range(from, from === NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE
        ? from : from + NFL_FORWARD_EVIDENCE_PAGE_SIZE - 1);
    if (error) throw new Error(`NFL forward evidence read failed: ${error.message}`);
    const page = (data ?? []) as StoredRow[];
    if (from === NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE) {
      if (page.length === 0) return rows;
      break;
    }
    if (page.length > NFL_FORWARD_EVIDENCE_PAGE_SIZE) {
      throw new Error("NFL forward evidence read returned an oversized page.");
    }
    for (const row of page) {
      const json = JSON.stringify(row.payload);
      if (json !== undefined && Buffer.byteLength(json) > NFL_FORWARD_EVIDENCE_MAX_PAYLOAD_JSON_BYTES) {
        throw new Error(`NFL evidence ${row.id} exceeded its bounded payload JSON byte limit.`);
      }
      // Verify the original payload and original stored digest before retaining
      // any compressed representation. The legacy hash exception stays exact.
      const original = normalizeStoredRow(row, args.evidenceRelease);
      rows.push({ ...original, payload: archive(original.payload) });
    }
    if (page.length < NFL_FORWARD_EVIDENCE_PAGE_SIZE) {
      return rows;
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
    if (("marketBrainShadow" in payload && payload.marketBrainShadow !== undefined) ||
      ("marketBrainCaptureAttemptId" in payload && payload.marketBrainCaptureAttemptId !== undefined) ||
      ("marketBrainRawParserInputs" in payload && payload.marketBrainRawParserInputs !== undefined)) {
      throw new Error("Research Market Brain sidecars are forbidden from authoritative NFL evidence writes.");
    }
    // Hash precisely what JSON transport stores. Optional undefined object
    // keys are omitted by transport but were encoded as null by stableJson.
    // Never change historical hashing or mutate the caller's forecast object.
    const storedPayload = normalizeNflForwardEvidenceForStorage(payload);
    const payloadSha256 = hashNflForwardEvidencePayload(storedPayload);
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
      payload: storedPayload,
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
  if (!nflForwardEvidenceStoredHashMatches(payload, row.payload_sha256)) {
    throw new Error(`NFL evidence ${row.id} checksum mismatch.`);
  }
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

/** Verify the exact r101 transport defect without changing a stored field. */
export function nflForwardEvidenceStoredHashMatches(
  payload: NflForwardAnyEvidencePayload,
  storedHash: string,
): boolean {
  if (hashNflForwardEvidencePayload(payload) === storedHash) return true;
  // The first r101 publication applied ML-only scores to two unlocked games
  // whose upstream forecast lacked these OPTIONAL fields. The writer hashed
  // undefined as null, then JSON transport omitted both keys. Matching the
  // original digest with exactly these two null slots attests that defect;
  // this is not permission to accept arbitrary corruption or reconstruct data.
  if (!("outcomeForecast" in payload) || payload.stage !== "unlocked" ||
      payload.decisions.modelPromotionStatus !== "nfl_v1_member_release_2026_11_01_r50_independent_market_axes" ||
      payload.fullGameEvidenceInterpretation?.arbiterRelease !==
        "nfl_full_game_evidence_arbiter_candidate_2026_11_01_r26_independent_market_axes" ||
      payload.fullGameEvidenceInterpretation?.runtimeRelease !==
        "nfl_full_game_evidence_runtime_2026_11_01_r11_independent_market_axes" ||
      payload.decisions.evaluatedBets.length !== 3 ||
      !payload.decisions.evaluatedBets.every((bet) =>
        bet.calibrationRelease === "nfl_v1_daily_edge_calibration_2026_11_01_r44_independent_market_axes" &&
        bet.decisionRelease === "nfl_v1_daily_edge_decision_2026_11_01_r53_independent_market_axes") ||
      Object.hasOwn(payload.outcomeForecast, "marketEvidence") ||
      Object.hasOwn(payload.outcomeForecast, "noWeightMarketReader")) return false;
  const hashOnlyCopy = { ...payload, outcomeForecast: {
    ...payload.outcomeForecast, marketEvidence: null, noWeightMarketReader: null,
  } } as unknown as NflForwardAnyEvidencePayload;
  return hashNflForwardEvidencePayload(hashOnlyCopy) === storedHash;
}
