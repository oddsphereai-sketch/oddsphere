import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceNbaEvidencePage, nbaEvidenceHighWaterError } from "./nbaReaderPublication";

export const NBA_PRICE_EVIDENCE_READ_RELEASE = "nba_price_evidence_read_2026_11_20_r1_event_scoped_pages" as const;
export type NbaReaderPriceDbRow = {
  id: number; provider: string; provider_event_id: string | null; ingestion_run_id: string | null;
  canonical_event_id: string; sportsbook: string; sharp_book: boolean; market_type: string; selection_key: string;
  american_price: number | null; line: number | null; provider_timestamp: string | null; fetched_at: string;
};
const FIELDS = "id,provider,provider_event_id,ingestion_run_id,canonical_event_id,sportsbook,sharp_book,market_type,selection_key,american_price,line,provider_timestamp,fetched_at";
const PAGE_SIZE = 1000, MAX_EVENTS = 128, MAX_PAGES = 1024, MAX_ROWS = 200000;

/** Each exact event uses its canonical-event index rather than scanning the
 * global ID index until a rare member of a large IN-list appears. Freeze one
 * global frontier first, then prove each event's exact bounded row count. A
 * short page is never completion, and any failed event rejects the whole read.
 * No historical tail/window is truncated, resampled or inferred from prices. */
export async function readNbaPriceEvidence(args: { client: SupabaseClient; eventIds: readonly string[]; highWater: number }) {
  const events = [...new Set(args.eventIds)].sort();
  const frontierError = nbaEvidenceHighWaterError("price", args.highWater);
  const empty = (error: string | null) => ({ rows: [] as NbaReaderPriceDbRow[], error, highWater: args.highWater,
    lastRead: 0, pages: 0, events: events.length, release: NBA_PRICE_EVIDENCE_READ_RELEASE });
  if (frontierError) return empty(frontierError);
  if (events.length > MAX_EVENTS || events.some(id => !id || id.length > 128) || (!events.length && args.highWater > 0)) return empty("price_observation_coverage_incomplete");
  if (args.highWater === 0) return empty(null);
  let nextEvent = 0, pages = 0, rowCount = 0, error: string | null = null;
  const buckets: NbaReaderPriceDbRow[][] = Array.from({ length: events.length }, () => []);
  const fail = (code: string) => { error ??= code; };
  await Promise.all(Array.from({ length: Math.min(4, events.length) }, async () => {
    while (nextEvent < events.length && !error) {
      const index = nextEvent++, event = events[index]!;
      try {
        // No ORDER BY on an empty/future event: PostgreSQL otherwise may
        // walk the global primary-key index backwards to prove absence.
        const countRead = await args.client.from("market_price_observations_v2").select("id", { count: "exact", head: true }).eq("league", "nba")
          .eq("canonical_event_id", event).lte("id", args.highWater);
        if (countRead.error) { fail("price_observation_lookup_failed"); return; }
        const expected = countRead.count;
        if (!Number.isSafeInteger(expected) || expected === null || expected < 0 || expected > MAX_ROWS) { fail("price_observation_coverage_incomplete"); return; }
        let readCount = 0;
        let cursor = 0;
        while (readCount < expected && !error) {
          if (++pages > MAX_PAGES) { fail("price_observation_coverage_incomplete"); return; }
          const page = await args.client.from("market_price_observations_v2").select(FIELDS).eq("league", "nba")
            .eq("canonical_event_id", event).gt("id", cursor).lte("id", args.highWater).order("id", { ascending: true }).limit(PAGE_SIZE);
          if (page.error) { fail("price_observation_lookup_failed"); return; }
          const rows = (page.data ?? []) as NbaReaderPriceDbRow[];
          if (rows.some(row => row.canonical_event_id !== event)) { fail("price_observation_coverage_incomplete"); return; }
          const advance = advanceNbaEvidencePage({ family: "price", cursor, highWater: args.highWater, rows });
          if (advance.error) { fail(advance.error); return; }
          readCount += rows.length;
          if (readCount > expected) { fail("price_observation_coverage_incomplete"); return; }
          rowCount += rows.length;
          if (rowCount > MAX_ROWS) { fail("price_observation_coverage_incomplete"); return; }
          buckets[index]!.push(...rows); cursor = advance.cursor;
        }
        if (error) continue;
        // Independently prove exhaustion at this event, without asking the
        // planner for a global-ID sort. Never trust a silently capped page.
        const tail = await args.client.from("market_price_observations_v2").select("id").eq("league", "nba")
          .eq("canonical_event_id", event).gt("id", cursor).lte("id", args.highWater).limit(1).maybeSingle();
        if (tail.error) { fail("price_observation_lookup_failed"); return; }
        if (tail.data !== null) { fail("price_observation_coverage_incomplete"); return; }
      } catch { fail("price_observation_lookup_failed"); return; }
    }
  }));
  if (error) return { ...empty(error), pages };
  const rows = buckets.flat().sort((a, b) => a.id - b.id);
  const lastRead = rows.at(-1)?.id ?? 0;
  if (lastRead !== args.highWater || rows.some((row, i) => i > 0 && row.id <= rows[i - 1]!.id)) return { ...empty("price_observation_coverage_incomplete"), pages };
  return { rows, error: null, highWater: args.highWater, lastRead, pages, events: events.length, release: NBA_PRICE_EVIDENCE_READ_RELEASE };
}
