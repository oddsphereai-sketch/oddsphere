import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { NflForwardEvidencePayload } from "./nflForwardEvidence";
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

type StoredPriorArtifactRow = {
  provider_game_id: string;
  prior_artifact_sha256: string;
};

type StoredShadowRow = {
  id: string;
  provider_game_id: string;
  shadow: NflMarketBrainCaptureResult;
  shadow_sha256: string;
  prior_artifact_sha256: string | null;
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
  for (let from = 0; from < NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK; from += NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE) {
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
      .range(from, from + NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE - 1);
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query;
    if (error) throw new Error(`NFL Market Brain prior-artifact index read failed: ${error.message}`);
    const page = (data ?? []) as StoredPriorArtifactRow[];
    rows.push(...page);
    if (page.length < NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE) {
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
        artifact_payload: JSON.stringify(artifactPayload),
      });
    }
    return [{
      shadow_release: shadow.release,
      contract_release: "case" in shadow ? shadow.case.release : MARKET_BRAIN_CONTRACT_RELEASE,
      run_id: args.runId,
      season: payload.season,
      week: payload.week,
      provider_game_id: payload.game.providerGameId,
      stage: payload.stage,
      captured_at: payload.capturedAt,
      shadow,
      shadow_sha256: shadowSha256,
      prior_artifact_sha256: priorArtifactSha256,
    }];
  });
  const hashes = rows.map((row) => row.shadow_sha256);
  if (!args.apply || rows.length === 0) return { proposed: rows.length, inserted: 0, existing: 0, hashes };
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
      onConflict: "shadow_release,provider_game_id,stage,captured_at,shadow_sha256",
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
  for (let from = 0; from < NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK; from += NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE) {
    let query = args.client.from("nfl_market_brain_shadow_snapshots")
      .select("id,provider_game_id,shadow,shadow_sha256,prior_artifact_sha256")
      .eq("season", args.season).eq("week", args.week)
      .eq("shadow_release", NFL_MARKET_BRAIN_SHADOW_RELEASE)
      .eq("contract_release", MARKET_BRAIN_CONTRACT_RELEASE)
      .gt("expires_at", new Date().toISOString())
      .order("captured_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE - 1);
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query;
    if (error) throw new Error(`NFL Market Brain shadow read failed: ${error.message}`);
    const page = (data ?? []) as StoredShadowRow[];
    rows.push(...page);
    if (page.length < NFL_MARKET_BRAIN_SHADOW_PAGE_SIZE) break;
    if (rows.length >= NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK) {
      throw new Error(`NFL Market Brain shadow read exceeded ${NFL_MARKET_BRAIN_SHADOW_MAX_ROWS_PER_WEEK} rows.`);
    }
  }
  for (const row of rows) {
    if (hashNflMarketBrainShadow(row.shadow) !== row.shadow_sha256) {
      throw new Error(`NFL Market Brain stored shadow checksum mismatch: ${row.id}`);
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
  return createHash("sha256").update(stableJson(shadow)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
