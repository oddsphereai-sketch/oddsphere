import type { SupabaseClient } from "@supabase/supabase-js";

import type { NflForwardEvidencePayload } from "./nflForwardEvidence";
import { rawPriceSha256 } from "./footballRawPriceManifest";
import {
  NFL_MARKET_BRAIN_SHADOW_RELEASE,
  type NflMarketBrainCaptureResult,
} from "./nflMarketBrainShadow";
import { MARKET_BRAIN_CONTRACT_RELEASE } from "@/lib/services/marketBrain/marketBrainContract";
import {
  assertMarketBrainPrior,
  marketBrainPriorArtifactSha256,
  type MarketBrainMarginTotalArtifact,
} from "@/lib/services/marketBrain/marketBrainContract";
import {
  marketBrainCanonicalJson,
  marketBrainSha256,
} from "@/lib/services/marketBrain/marketBrainCanonical";

type StoredPriorArtifactRow = {
  provider_game_id: string;
  prior_artifact_sha256: string;
};

type StoredShadowRow = {
  id: string;
  run_id?: string;
  capture_attempt_id?: string;
  season?: number;
  week?: number;
  provider_game_id: string;
  stage?: "opening" | "unlocked" | "t60";
  captured_at?: string;
  created_at?: string;
  shadow: NflMarketBrainCaptureResult;
  shadow_sha256: string;
  shadow_payload: string;
  prior_artifact_sha256: string | null;
};

export type NflMarketBrainStoredShadowCapture = {
  recordId: string;
  runId: string;
  season: number;
  week: number;
  providerGameId: string;
  stage: "opening" | "unlocked" | "t60";
  capturedAt: string;
  serverCreatedAt: string;
  shadowSha256: string;
  captureResult: NflMarketBrainCaptureResult;
};

type StoredArtifactRow = {
  artifact_sha256: string;
  prior_artifact: MarketBrainMarginTotalArtifact;
};

export const NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE = 250 as const;
export const NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK = 5_000 as const;

export async function readNflMarketBrainPriorArtifactIndex(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  signal?: AbortSignal;
}): Promise<Array<{ providerGameId: string; priorArtifactSha256: string }>> {
  const rows: StoredPriorArtifactRow[] = [];
  for (let from = 0; from <= NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK;
    from += NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE) {
    const pageSize = from === NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK
      ? 1 : NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE;
    let query = args.client
      .from("nfl_market_brain_shadow_snapshots")
      .select("provider_game_id,prior_artifact_sha256")
      .eq("season", args.season)
      .eq("week", args.week)
      .eq("shadow_release", NFL_MARKET_BRAIN_SHADOW_RELEASE)
      .eq("contract_release", MARKET_BRAIN_CONTRACT_RELEASE)
      .gt("expires_at", new Date().toISOString())
      .not("prior_artifact_sha256", "is", null)
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query;
    if (error) throw new Error(`NFL Market Brain prior-artifact index read failed: ${error.message}`);
    const page = (data ?? []) as StoredPriorArtifactRow[];
    if (from === NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK && page.length > 0) {
      throw new Error(
        `NFL Market Brain prior-artifact index read exceeded its bounded ${NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK}-row weekly limit.`,
      );
    }
    rows.push(...page);
    if (page.length < pageSize) {
      return rows.map((row) => {
        if (!/^[a-f0-9]{64}$/.test(row.prior_artifact_sha256)) {
          throw new Error("NFL Market Brain prior-artifact index contains an invalid checksum.");
        }
        return { providerGameId: row.provider_game_id, priorArtifactSha256: row.prior_artifact_sha256 };
      });
    }
  }
  throw new Error(
    `NFL Market Brain prior-artifact index read exceeded its bounded ${NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK}-row weekly limit.`,
  );
}

export async function appendNflMarketBrainShadows(args: {
  client: SupabaseClient;
  runId: string;
  payloads: NflForwardEvidencePayload[];
  apply: boolean;
  signal?: AbortSignal;
}): Promise<{ proposed: number; inserted: number; existing: number; hashes: string[] }> {
  const rawParserInputs = new Map<string, {
    parser_input_sha256: string;
    schema_release: string;
    parser_input: unknown[];
    parser_input_payload: string;
  }>();
  for (const payload of args.payloads) {
    for (const input of payload.marketBrainRawParserInputs ?? []) {
      if (rawPriceSha256(input.payload) !== input.sha256 ||
        Buffer.byteLength(JSON.stringify(input.payload), "utf8") !== input.bytes) {
        throw new Error("NFL Market Brain raw parser input checksum or byte count is invalid.");
      }
      rawParserInputs.set(`${input.schema}\u0000${input.sha256}`, {
        parser_input_sha256: input.sha256,
        schema_release: input.schema,
        parser_input: input.payload,
        parser_input_payload: JSON.stringify(input.payload),
      });
    }
  }
  const artifacts = new Map<string, {
    artifact_sha256: string;
    shadow_release: string;
    contract_release: string;
    provider_game_id: string;
    prior_artifact: MarketBrainMarginTotalArtifact;
    artifact_payload: string;
  }>();
  const rows = args.payloads.flatMap((payload) => {
    const shadow = payload.marketBrainShadow;
    if (!shadow) return [];
    const shadowSha256 = hashNflMarketBrainShadow(shadow);
    const priorArtifactSha256 = "case" in shadow ? marketBrainPriorArtifactSha256(shadow.case.prior) : null;
    if ("case" in shadow && shadow.case.prior.kind === "margin_total_distribution") {
      const { sha256: artifactSha256, ...artifactPayload } = shadow.case.prior.artifact;
      artifacts.set(shadow.case.prior.artifact.sha256, {
        artifact_sha256: artifactSha256,
        shadow_release: shadow.release,
        contract_release: shadow.case.release,
        provider_game_id: payload.game.providerGameId,
        prior_artifact: shadow.case.prior.artifact,
        artifact_payload: marketBrainCanonicalJson(artifactPayload),
      });
    }
    return [{
      shadow_release: shadow.release,
      contract_release: "case" in shadow ? shadow.case.release : MARKET_BRAIN_CONTRACT_RELEASE,
      run_id: args.runId,
      capture_attempt_id: requireCaptureAttemptId(payload),
      season: payload.season,
      week: payload.week,
      provider_game_id: payload.game.providerGameId,
      stage: payload.stage,
      captured_at: payload.capturedAt,
      shadow,
      shadow_sha256: shadowSha256,
      shadow_payload: marketBrainCanonicalJson(shadow),
      prior_artifact_sha256: priorArtifactSha256,
    }];
  });
  const hashes = rows.map((row) => row.shadow_sha256);
  if (!args.apply || rows.length === 0) return { proposed: rows.length, inserted: 0, existing: 0, hashes };
  if (rawParserInputs.size > 0) {
    let rawQuery = args.client.from("nfl_market_brain_raw_parser_inputs")
      .upsert([...rawParserInputs.values()], {
        onConflict: "schema_release,parser_input_sha256",
        ignoreDuplicates: true,
      });
    if (args.signal) rawQuery = rawQuery.abortSignal(args.signal);
    const { error: rawError } = await rawQuery;
    if (rawError) throw new Error(`NFL Market Brain raw parser-input archive failed: ${rawError.message}`);
  }
  if (artifacts.size > 0) {
    let artifactQuery = args.client.from("nfl_market_brain_prior_artifacts")
      .upsert([...artifacts.values()], { onConflict: "artifact_sha256", ignoreDuplicates: true });
    if (args.signal) artifactQuery = artifactQuery.abortSignal(args.signal);
    const { error: artifactError } = await artifactQuery;
    if (artifactError) throw new Error(`NFL Market Brain prior-artifact append failed: ${artifactError.message}`);
  }
  let query = args.client
    .from("nfl_market_brain_shadow_snapshots")
    .upsert(rows, {
      onConflict: "shadow_release,provider_game_id,capture_attempt_id",
      ignoreDuplicates: true,
    });
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`NFL Market Brain shadow append failed: ${error.message}`);
  const inserted = data?.length ?? 0;
  return { proposed: rows.length, inserted, existing: rows.length - inserted, hashes };
}

export async function readNflMarketBrainShadows(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  signal?: AbortSignal;
}): Promise<NflMarketBrainCaptureResult[]> {
  const rows: StoredShadowRow[] = [];
  for (let from = 0; from <= NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK;
    from += NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE) {
    const pageSize = from === NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK
      ? 1 : NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE;
    let query = args.client.from("nfl_market_brain_shadow_snapshots")
      .select("id,provider_game_id,shadow,shadow_sha256,shadow_payload,prior_artifact_sha256")
      .eq("season", args.season).eq("week", args.week)
      .eq("shadow_release", NFL_MARKET_BRAIN_SHADOW_RELEASE)
      .eq("contract_release", MARKET_BRAIN_CONTRACT_RELEASE)
      .gt("expires_at", new Date().toISOString())
      .order("captured_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query;
    if (error) throw new Error(`NFL Market Brain shadow read failed: ${error.message}`);
    const page = (data ?? []) as StoredShadowRow[];
    if (from === NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK && page.length > 0) {
      throw new Error(`NFL Market Brain shadow read exceeded ${NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK} rows.`);
    }
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  for (const row of rows) {
    if (marketBrainCanonicalJson(row.shadow) !== row.shadow_payload ||
      hashNflMarketBrainShadow(row.shadow) !== row.shadow_sha256 ||
      marketBrainSha256(JSON.parse(row.shadow_payload)) !== row.shadow_sha256) {
      throw new Error(`NFL Market Brain stored shadow checksum mismatch: ${row.id}`);
    }
    const embeddedPrior = "case" in row.shadow
      ? row.shadow.case.prior.kind === "margin_total_distribution"
        ? row.shadow.case.prior.artifact.sha256
        : row.shadow.case.prior.kind === "margin_total_distribution_ref"
        ? row.shadow.case.prior.artifactSha256
        : null
      : null;
    if (embeddedPrior !== row.prior_artifact_sha256) {
      throw new Error(`NFL Market Brain stored shadow prior reference mismatch: ${row.id}`);
    }
  }
  const needed = [...new Set(rows.flatMap((row) => row.prior_artifact_sha256 ? [row.prior_artifact_sha256] : []))];
  const artifactMap = new Map<string, MarketBrainMarginTotalArtifact>();
  if (needed.length > 0) {
    let query = args.client.from("nfl_market_brain_prior_artifacts")
      .select("artifact_sha256,prior_artifact")
      .in("artifact_sha256", needed)
      .gt("expires_at", new Date().toISOString());
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query;
    if (error) throw new Error(`NFL Market Brain prior-artifact read failed: ${error.message}`);
    for (const row of (data ?? []) as StoredArtifactRow[]) artifactMap.set(row.artifact_sha256, row.prior_artifact);
  }
  return rows.map((row) => {
    const shadow = structuredClone(row.shadow);
    if (!("case" in shadow) || shadow.case.prior.kind !== "margin_total_distribution_ref") return shadow;
    const reference = shadow.case.prior;
    const artifact = artifactMap.get(reference.artifactSha256);
    if (!artifact) throw new Error(`NFL Market Brain prior artifact is missing: ${reference.artifactSha256}`);
    shadow.case.prior = {
      kind: "margin_total_distribution",
      release: reference.release,
      marginMean: reference.marginMean,
      totalMean: reference.totalMean,
      marginDistributionSha256: reference.marginDistributionSha256,
      totalDistributionSha256: reference.totalDistributionSha256,
      artifact,
    };
    assertMarketBrainPrior(shadow.case.prior, shadow.case.eventId, shadow.case.evaluatedAt);
    return shadow;
  });
}

/**
 * Reads the complete bounded database membership for one frozen event window.
 * Unlike the broad offline reader, this includes storage identities, run
 * attempts, failures, and server receipt times needed to attest completeness.
 */
export async function readNflMarketBrainStoredShadowCaptures(args: {
  client: SupabaseClient;
  eventId: string;
  windowOpensAt: string;
  windowClosesAt: string;
  maximumRows?: number;
  signal?: AbortSignal;
}): Promise<NflMarketBrainStoredShadowCapture[]> {
  const maximumRows = args.maximumRows ?? 1_000;
  if (!Number.isInteger(maximumRows) || maximumRows < 1 || maximumRows > 1_000) {
    throw new Error("NFL Market Brain capture-set row limit must be between 1 and 1000.");
  }
  const opens = new Date(args.windowOpensAt);
  const closes = new Date(args.windowClosesAt);
  if (!Number.isFinite(opens.getTime()) || !Number.isFinite(closes.getTime()) || opens > closes) {
    throw new Error("NFL Market Brain capture-set window is invalid.");
  }
  let query = args.client.from("nfl_market_brain_shadow_snapshots")
    .select("id,run_id,capture_attempt_id,season,week,provider_game_id,stage,captured_at,created_at,shadow,shadow_sha256,shadow_payload,prior_artifact_sha256")
    .eq("provider_game_id", args.eventId)
    .eq("shadow_release", NFL_MARKET_BRAIN_SHADOW_RELEASE)
    .eq("contract_release", MARKET_BRAIN_CONTRACT_RELEASE)
    .gte("captured_at", opens.toISOString())
    .lte("captured_at", closes.toISOString())
    .order("captured_at", { ascending: true })
    .order("id", { ascending: true })
    .range(0, maximumRows);
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query;
  if (error) throw new Error(`NFL Market Brain capture-set read failed: ${error.message}`);
  const rows = (data ?? []) as StoredShadowRow[];
  if (rows.length > maximumRows) {
    throw new Error(`NFL Market Brain capture set exceeded its bounded ${maximumRows}-row limit.`);
  }
  verifyStoredRows(rows);
  const hydrated = await hydrateStoredRows({ client: args.client, rows, signal: args.signal });
  return rows.map((row, index) => {
    if (!row.capture_attempt_id || !row.stage || row.season === undefined || row.week === undefined ||
      !row.captured_at || !row.created_at) {
      throw new Error(`NFL Market Brain capture-set row is missing server metadata: ${row.id}`);
    }
    return {
      recordId: row.id,
      runId: row.capture_attempt_id,
      season: row.season,
      week: row.week,
      providerGameId: row.provider_game_id,
      stage: row.stage,
      capturedAt: new Date(row.captured_at).toISOString(),
      serverCreatedAt: new Date(row.created_at).toISOString(),
      shadowSha256: row.shadow_sha256,
      captureResult: hydrated[index]!,
    };
  });
}

function verifyStoredRows(rows: StoredShadowRow[]): void {
  for (const row of rows) {
    if (marketBrainCanonicalJson(row.shadow) !== row.shadow_payload ||
      hashNflMarketBrainShadow(row.shadow) !== row.shadow_sha256 ||
      marketBrainSha256(JSON.parse(row.shadow_payload)) !== row.shadow_sha256) {
      throw new Error(`NFL Market Brain stored shadow checksum mismatch: ${row.id}`);
    }
    const embeddedPrior = "case" in row.shadow
      ? row.shadow.case.prior.kind === "margin_total_distribution"
        ? row.shadow.case.prior.artifact.sha256
        : row.shadow.case.prior.kind === "margin_total_distribution_ref"
        ? row.shadow.case.prior.artifactSha256
        : null
      : null;
    if (embeddedPrior !== row.prior_artifact_sha256) {
      throw new Error(`NFL Market Brain stored shadow prior reference mismatch: ${row.id}`);
    }
  }
}

async function hydrateStoredRows(args: {
  client: SupabaseClient;
  rows: StoredShadowRow[];
  signal?: AbortSignal;
}): Promise<NflMarketBrainCaptureResult[]> {
  const needed = [...new Set(args.rows.flatMap((row) =>
    row.prior_artifact_sha256 ? [row.prior_artifact_sha256] : []))];
  const artifactMap = new Map<string, MarketBrainMarginTotalArtifact>();
  if (needed.length > 0) {
    let query = args.client.from("nfl_market_brain_prior_artifacts")
      .select("artifact_sha256,prior_artifact")
      .in("artifact_sha256", needed)
      .gt("expires_at", new Date().toISOString());
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query;
    if (error) throw new Error(`NFL Market Brain prior-artifact read failed: ${error.message}`);
    for (const row of (data ?? []) as StoredArtifactRow[]) artifactMap.set(row.artifact_sha256, row.prior_artifact);
  }
  return args.rows.map((row) => {
    const shadow = structuredClone(row.shadow);
    if (!("case" in shadow) || shadow.case.prior.kind !== "margin_total_distribution_ref") return shadow;
    const reference = shadow.case.prior;
    const artifact = artifactMap.get(reference.artifactSha256);
    if (!artifact) throw new Error(`NFL Market Brain prior artifact is missing: ${reference.artifactSha256}`);
    shadow.case.prior = {
      kind: "margin_total_distribution",
      release: reference.release,
      marginMean: reference.marginMean,
      totalMean: reference.totalMean,
      marginDistributionSha256: reference.marginDistributionSha256,
      totalDistributionSha256: reference.totalDistributionSha256,
      artifact,
    };
    assertMarketBrainPrior(shadow.case.prior, shadow.case.eventId, shadow.case.evaluatedAt);
    return shadow;
  });
}

export async function purgeExpiredNflMarketBrainResearch(args: {
  client: SupabaseClient;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ shadowsDeleted: number; artifactsDeleted: number }> {
  const limit = args.limit ?? 5_000;
  let query = args.client.rpc("purge_expired_nfl_market_brain_research", { p_limit: limit });
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query;
  if (error) throw new Error(`NFL Market Brain retention purge failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    shadowsDeleted: Number(row?.shadows_deleted ?? 0),
    artifactsDeleted: Number(row?.artifacts_deleted ?? 0),
  };
}

export function hashNflMarketBrainShadow(shadow: NflMarketBrainCaptureResult): string {
  return marketBrainSha256(shadow);
}

function requireCaptureAttemptId(payload: NflForwardEvidencePayload): string {
  const attemptId = payload.marketBrainCaptureAttemptId;
  if (!attemptId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw new Error("NFL Market Brain shadow append requires a predeclared capture-attempt UUID.");
  }
  return attemptId;
}
