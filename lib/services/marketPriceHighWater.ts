import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpcFunction } from "../db/missingRpcFunction";

/** Same high-water value and error semantics; full history paging stays caller-owned. */
export async function readMarketPriceHighWater(
  client: SupabaseClient,
  league: string,
  eventIds: string[],
): Promise<{ id: number; error: PostgrestError | null }> {
  const functionName = "market_price_observation_high_water";
  const result = await client.rpc(functionName, { p_league: league, p_event_ids: eventIds });
  if (!isMissingRpcFunction(result.error, functionName)) {
    return { id: Number(result.data ?? 0), error: result.error };
  }
  // Safe during deploy-before-migration and after a reviewed migration rollback.
  const legacy = await client.from("market_price_observations_v2")
    .select("id").eq("league", league).in("canonical_event_id", eventIds)
    .order("id", { ascending: false }).limit(1).maybeSingle();
  return { id: Number(legacy.data?.id ?? 0), error: legacy.error };
}
