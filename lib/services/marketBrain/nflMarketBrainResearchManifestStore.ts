import type { SupabaseClient } from "@supabase/supabase-js";

import {
  attestPersistedNflMarketBrainResearchManifest,
  type NflMarketBrainAttestedResearchManifest,
  type NflMarketBrainResearchManifest,
} from "./nflMarketBrainResearchEvaluator";

type PersistedManifestReceipt = {
  id: string;
  manifest_checksum: string;
  created_at: string;
};

/**
 * Persists the frozen chronology before training or prospective capture and returns
 * the only manifest shape accepted by the evaluator and artifact binder.
 */
export async function persistNflMarketBrainResearchManifest(args: {
  client: SupabaseClient;
  manifest: NflMarketBrainResearchManifest;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedResearchManifest> {
  let query = args.client
    .from("nfl_market_brain_research_manifests")
    .insert({
      id: args.manifest.storageId,
      manifest_release: args.manifest.release,
      candidate_release: args.manifest.candidateRelease,
      persisted_at: args.manifest.persistedAt,
      manifest_checksum: args.manifest.checksum,
      manifest: args.manifest,
    })
    .select("id,manifest_checksum,created_at");
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain research manifest persistence failed: ${error.message}`);
  const receipt = data as PersistedManifestReceipt | null;
  if (!receipt) throw new Error("NFL Market Brain research manifest persistence returned no receipt.");
  return attestPersistedNflMarketBrainResearchManifest({
    manifest: args.manifest,
    stored: {
      id: receipt.id,
      serverCreatedAt: receipt.created_at,
      manifestChecksum: receipt.manifest_checksum,
    },
  });
}
