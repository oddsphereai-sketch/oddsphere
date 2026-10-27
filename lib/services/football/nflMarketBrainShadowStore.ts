import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { NflForwardEvidencePayload } from "./nflForwardEvidence";
import {
  NFL_MARKET_BRAIN_SHADOW_RELEASE,
  type NflMarketBrainCaptureResult,
} from "./nflMarketBrainShadow";
import { MARKET_BRAIN_CONTRACT_RELEASE } from "@/lib/services/marketBrain/marketBrainContract";
import { marketBrainPriorArtifactSha256 } from "@/lib/services/marketBrain/marketBrainContract";

type StoredPriorArtifactRow = {
  provider_game_id: string;
  prior_artifact_sha256: string;
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
}): Promise<{ proposed: number; inserted: number; hashes: string[] }> {
  const rows = args.payloads.flatMap((payload) => {
    const shadow = payload.marketBrainShadow;
    if (!shadow) return [];
    const shadowSha256 = hashNflMarketBrainShadow(shadow);
    const priorArtifactSha256 = "case" in shadow ? marketBrainPriorArtifactSha256(shadow.case.prior) : null;
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
      bytes: Buffer.byteLength(JSON.stringify(shadow)),
    }];
  });
  const hashes = rows.map((row) => row.shadow_sha256);
  if (!args.apply || rows.length === 0) return { proposed: rows.length, inserted: 0, hashes };
  let query = args.client
    .from("nfl_market_brain_shadow_snapshots")
    .insert(rows);
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`NFL Market Brain shadow append failed: ${error.message}`);
  return { proposed: rows.length, inserted: data?.length ?? rows.length, hashes };
}

export function hashNflMarketBrainShadow(shadow: NflMarketBrainCaptureResult): string {
  return createHash("sha256").update(JSON.stringify(shadow)).digest("hex");
}
