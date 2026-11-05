import { createHash } from "node:crypto";
import type { supabase } from "@/lib/db/supabase";
import type { SharpApiCurrentSplitFeed } from "./sharpApiCurrentSplits";

type Json = Record<string, unknown>;
type Client = typeof supabase;
export const CURRENT_SPLIT_ARCHIVE_PROTOCOL = "current_split_observation_archive_v1" as const;
const BATCH_BYTES = 240_000;
const PAGE_ROWS = 100;
export type ArchivedCurrentSplitFeed = SharpApiCurrentSplitFeed & {
  observationArchive?: { protocol: typeof CURRENT_SPLIT_ARCHIVE_PROTOCOL; hotFromDate: string };
};

// Object key order is not evidence; array order and all JSON values are.
export function canonicalSplitJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSplitJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .filter((key) => (value as Json)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalSplitJson((value as Json)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const easternDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
export function currentSplitEventDate(row: Json): string | null {
  const start = typeof row.event_start_time === "string" ? row.event_start_time : null;
  if (start && Number.isFinite(Date.parse(start))) {
    const parts = easternDay.formatToParts(new Date(start));
    const part = (kind: string) => parts.find((entry) => entry.type === kind)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  const id = typeof row.event_id === "string" ? row.event_id : "";
  const dashed = id.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1];
  const compact = id.match(/-(\d{4})(\d{2})(\d{2})(?:$|[-_])/);
  const date = dashed ?? (compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : null);
  const parsed = date ? new Date(`${date}T00:00:00Z`) : null;
  return parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function splitArchiveState(feed: SharpApiCurrentSplitFeed): ArchivedCurrentSplitFeed["observationArchive"] {
  const value = (feed as ArchivedCurrentSplitFeed).observationArchive;
  if (!value) return undefined;
  if (value.protocol !== CURRENT_SPLIT_ARCHIVE_PROTOCOL || !/^\d{4}-\d{2}-\d{2}$/.test(value.hotFromDate)) {
    throw new Error("Current split archive receipt is invalid; refusing to omit historical evidence");
  }
  return value;
}

export function currentSplitHotFromDate(fetchedAt: string): string {
  return new Date(Date.parse(fetchedAt) - 3 * 86_400_000).toISOString().slice(0, 10);
}

export function splitArchiveBatches(feed: SharpApiCurrentSplitFeed, rows: readonly Json[]): Json[][] {
  const unique = new Map<string, Json>();
  for (const payload of rows) {
    const payloadText = canonicalSplitJson(payload);
    const observationSha256 = createHash("sha256").update(payloadText).digest("hex");
    unique.set(observationSha256, { sport: feed.sport, feed_release: feed.release, source: feed.source,
      observation_sha256: observationSha256, event_date: currentSplitEventDate(payload), payload, payload_text: payloadText });
  }
  const batches: Json[][] = [];
  let batch: Json[] = [], bytes = 2;
  for (const row of unique.values()) {
    const size = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (size > 900_000) throw new Error("An individual split observation exceeds the archive transport limit; current cache is preserved");
    if (batch.length && bytes + size > BATCH_BYTES) { batches.push(batch); batch = []; bytes = 2; }
    batch.push(row); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function missingArchive(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42P01" || error?.code === "42883";
}

/** The existing collector owns this call. Never prune until every batch is acknowledged. */
export async function archiveCurrentSplitRows(client: Client, feed: SharpApiCurrentSplitFeed, rows: readonly Json[]): Promise<boolean> {
  for (const batch of splitArchiveBatches(feed, rows)) {
    const { data, error } = await client.rpc("archive_current_split_observations", { observations: batch });
    if (error) {
      if (missingArchive(error)) return false; // Rolling deployment: retain the full legacy cache.
      throw new Error(`Current split archive did not acknowledge evidence: ${error.message}`);
    }
    if (Number(data?.acknowledged) !== batch.length) throw new Error("Current split archive acknowledgement is incomplete; current cache is preserved");
  }
  return true;
}

/** Save the baseline once, and every newly captured provider observation before the existing trim. */
export async function prepareArchivedCurrentSplitFeed(args: {
  client: Client; previous: SharpApiCurrentSplitFeed | null; current: SharpApiCurrentSplitFeed; merged: SharpApiCurrentSplitFeed;
}): Promise<SharpApiCurrentSplitFeed> {
  const initialized = args.previous ? splitArchiveState(args.previous) : undefined;
  if (!initialized && args.previous && !await archiveCurrentSplitRows(args.client, args.previous, args.previous.rows)) return args.merged;
  const acknowledged = await archiveCurrentSplitRows(args.client, args.current, args.current.rows);
  if (!acknowledged) {
    if (initialized) throw new Error("Existing split archive is unavailable; refusing to replace its current cache");
    return args.merged;
  }
  const hotFromDate = currentSplitHotFromDate(args.current.fetchedAt);
  return { ...args.merged, rows: args.merged.rows.filter((row) => {
    const date = currentSplitEventDate(row);
    return date === null || date >= hotFromDate;
  }), observationArchive: { protocol: CURRENT_SPLIT_ARCHIVE_PROTOCOL, hotFromDate } } as ArchivedCurrentSplitFeed;
}

/** Keyset pages preserve every stored version. Research exports can consume this iterator without loading all history. */
export async function* iterateCurrentSplitObservations(client: Client, feed: SharpApiCurrentSplitFeed,
  eventDates?: readonly string[]): AsyncGenerator<{ id: number; payload: Json }> {
  let cursor = 0;
  if (eventDates && eventDates.length === 0) return;
  if (eventDates?.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new Error("Invalid split archive date scope");
  for (;;) {
    let query = client.from("current_split_observation_archive").select("id,payload")
      .eq("sport", feed.sport).eq("feed_release", feed.release).gt("id", cursor).order("id", { ascending: true }).limit(PAGE_ROWS);
    if (eventDates) query = query.in("event_date", [...new Set(eventDates)]);
    const { data, error } = await query;
    if (error) throw new Error(`Historical split evidence unavailable: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      const id = Number(row.id);
      if (!Number.isSafeInteger(id) || id <= cursor || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) {
        throw new Error("Historical split archive page is invalid or out of order");
      }
      cursor = id;
      yield { id, payload: row.payload as Json };
    }
    if (rows.length < PAGE_ROWS) break;
  }
}
