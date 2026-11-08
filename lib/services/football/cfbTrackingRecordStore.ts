import type { SupabaseClient } from "@supabase/supabase-js";

const GAME_BATCH_SIZE = 200;
const PAGE_SIZE = 500;
export type CfbExistingTrackingRecord = { external_id: number; market: string };

/** Complete identity-only read. A season exceeds PostgREST's 1,000-row cap;
 * truncating it makes old immutable locks look missing and aborts new inserts. */
export async function readCfbExistingTrackingRecords(
  client: SupabaseClient,
  externalIds: readonly number[],
): Promise<CfbExistingTrackingRecord[]> {
  const ids = [...new Set(externalIds)].sort((a, b) => a - b);
  const records: CfbExistingTrackingRecord[] = [];
  for (let index = 0; index < ids.length; index += GAME_BATCH_SIZE) {
    const batch = ids.slice(index, index + GAME_BATCH_SIZE);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client.from("prediction_records")
        .select("id,external_id,market")
        .eq("sport", "cfb")
        .in("external_id", batch)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`CFB tracking record read failed: ${error.message}`);
      const page = (data ?? []) as Array<CfbExistingTrackingRecord & { id: number }>;
      records.push(...page.map(({ external_id, market }) => ({ external_id, market })));
      if (page.length < PAGE_SIZE) break;
    }
  }
  return records;
}
