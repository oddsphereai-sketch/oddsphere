import { createHash } from "node:crypto";
import type { supabase } from "@/lib/db/supabase";
import type { SharpApiCurrentSplitFeed } from "./sharpApiCurrentSplits";
import { encodeCurrentSplitFeedTransport } from "./currentSplitFeedTransport";
import { gzipSync, gunzipSync } from "node:zlib";

type Json = Record<string, unknown>;
type Client = typeof supabase;
export const CURRENT_SPLIT_ARCHIVE_PROTOCOL = "current_split_observation_archive_v1" as const;
const BATCH_BYTES = 240_000;
const PAGE_ROWS = 500;
export type ArchivedCurrentSplitFeed = SharpApiCurrentSplitFeed & {
  observationArchive?: { protocol: typeof CURRENT_SPLIT_ARCHIVE_PROTOCOL; hotFromDate: string;
    groupOrders: Record<string, number>; coldGroups: string[] };
};

/** Same authoritative event/book identity used by the unchanged display trim. */
export function currentSplitGroupKey(row: Json): string {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : "";
  return `${text(row.event_id)}::${text(row.sportsbook).toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

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
  if (value.protocol !== CURRENT_SPLIT_ARCHIVE_PROTOCOL || !/^\d{4}-\d{2}-\d{2}$/.test(value.hotFromDate)
    || !value.groupOrders || typeof value.groupOrders !== "object" || Array.isArray(value.groupOrders)
    || Object.values(value.groupOrders).some((order) => !Number.isSafeInteger(order) || order <= 0)
    || !Array.isArray(value.coldGroups) || value.coldGroups.some((key) => typeof key !== "string")) {
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
      observation_sha256: observationSha256, event_book_key: currentSplitGroupKey(payload),
      event_date: currentSplitEventDate(payload), payload, payload_text: payloadText });
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

/** Exact original capture receipts preserve array ordering and duplicates, in
 * addition to the indexed immutable observation versions. Never stored in the
 * hot feed or loaded by ordinary site readers. */
export async function archiveCurrentSplitCapture(client: Client, feed: SharpApiCurrentSplitFeed,
  kind: "baseline" | "capture"): Promise<boolean> {
  const json = JSON.stringify(feed), raw = Buffer.from(json);
  const captureSha = createHash("sha256").update(raw).digest("hex");
  const compressed = gzipSync(raw);
  if (!gunzipSync(compressed).equals(raw)) throw new Error("Capture compression did not preserve its original bytes");
  const encoded = compressed.toString("base64"), parts = Math.max(1, Math.ceil(encoded.length / 180_000));
  for (let part = 0; part < parts; part++) {
    const payload = encoded.slice(part * 180_000, (part + 1) * 180_000);
    const item = { capture_sha256: captureSha, part, parts, sport: feed.sport, feed_release: feed.release,
      source: feed.source, capture_kind: kind, fetched_at: feed.fetchedAt, decoded_bytes: raw.length,
      row_count: feed.rows.length, payload, part_sha256: createHash("sha256").update(payload).digest("hex") };
    const { data, error } = await client.rpc("archive_current_split_capture_part", { receipt: item });
    if (error) { if (missingArchive(error)) return false; throw new Error(`Original split capture was not archived: ${error.message}`); }
    if (data?.acknowledged !== true) throw new Error("Original split capture acknowledgement is incomplete; current cache is preserved");
  }
  return true;
}

export async function readOriginalCurrentSplitCapture(client: Client, captureSha256: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(captureSha256)) throw new Error("Invalid original capture checksum");
  let parts = 1, decodedBytes = 0;
  const chunks: string[] = [];
  for (let part = 0; part < parts; part++) {
    const { data, error } = await client.from("current_split_capture_archive").select("part,parts,decoded_bytes,payload,part_sha256")
      .eq("capture_sha256", captureSha256).eq("part", part).single();
    if (error || !data) throw new Error(`Original split capture part unavailable: ${error?.message ?? part}`);
    if (Number(data.part) !== part || createHash("sha256").update(data.payload).digest("hex") !== data.part_sha256) throw new Error("Original capture part checksum differs");
    if (part === 0) { parts = Number(data.parts); decodedBytes = Number(data.decoded_bytes); }
    if (!Number.isSafeInteger(parts) || parts < 1 || parts > 10000 || !Number.isSafeInteger(decodedBytes) || decodedBytes < 0 || decodedBytes > 128_000_000
      || Number(data.parts) !== parts || Number(data.decoded_bytes) !== decodedBytes) throw new Error("Original capture manifest is invalid or exceeds this reader's capacity");
    chunks.push(data.payload);
  }
  const raw = gunzipSync(Buffer.from(chunks.join(""), "base64"), { maxOutputLength: decodedBytes + 1 });
  if (raw.length !== decodedBytes || createHash("sha256").update(raw).digest("hex") !== captureSha256) throw new Error("Original capture checksum differs");
  return raw.toString("utf8");
}

/** The existing collector owns this call. Never prune until every batch is acknowledged. */
export async function archiveCurrentSplitRows(client: Client, feed: SharpApiCurrentSplitFeed, rows: readonly Json[]): Promise<{ available: boolean; groupOrders: Record<string, number> }> {
  const groupOrders: Record<string, number> = {};
  for (const batch of splitArchiveBatches(feed, rows)) {
    const { data, error } = await client.rpc("archive_current_split_observations", { observations: batch });
    if (error) {
      if (missingArchive(error)) return { available: false, groupOrders }; // Rolling deployment: retain the full legacy cache.
      throw new Error(`Current split archive did not acknowledge evidence: ${error.message}`);
    }
    if (Number(data?.acknowledged) !== batch.length) throw new Error("Current split archive acknowledgement is incomplete; current cache is preserved");
    for (const row of batch) {
      const key = String(row.event_book_key), order = Number(data?.group_orders?.[key]);
      if (!Number.isSafeInteger(order) || order <= 0) throw new Error("Split archive group order is incomplete; current cache is preserved");
      groupOrders[key] = Math.min(groupOrders[key] ?? order, order);
    }
  }
  return { available: true, groupOrders };
}

/** Save the baseline once, and every newly captured provider observation before the existing trim. */
export async function prepareArchivedCurrentSplitFeed(args: {
  client: Client; previous: SharpApiCurrentSplitFeed | null; current: SharpApiCurrentSplitFeed; merged: SharpApiCurrentSplitFeed;
}): Promise<SharpApiCurrentSplitFeed> {
  const initialized = args.previous ? splitArchiveState(args.previous) : undefined;
  let groupOrders = { ...initialized?.groupOrders };
  if (!initialized && args.previous) {
    if (!await archiveCurrentSplitCapture(args.client, args.previous, "baseline")) return args.merged;
    const baseline = await archiveCurrentSplitRows(args.client, args.previous, args.previous.rows);
    if (!baseline.available) return args.merged;
    groupOrders = { ...groupOrders, ...baseline.groupOrders };
  }
  if (!await archiveCurrentSplitCapture(args.client, args.current, "capture")) {
    if (initialized) throw new Error("Existing original capture archive is unavailable; current cache is preserved");
    return args.merged;
  }
  const acknowledged = await archiveCurrentSplitRows(args.client, args.current, args.current.rows);
  if (!acknowledged.available) {
    if (initialized) throw new Error("Existing split archive is unavailable; refusing to replace its current cache");
    return args.merged;
  }
  groupOrders = { ...groupOrders, ...acknowledged.groupOrders };
  const hotFromDate = currentSplitHotFromDate(args.current.fetchedAt);
  const groups = new Map<string, Json[]>();
  for (const row of args.merged.rows) {
    const key = currentSplitGroupKey(row); groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const coldGroups = new Set(initialized?.coldGroups ?? []);
  const historyItems: Json[] = [];
  for (const [key, rows] of groups) {
    if (!coldGroups.has(key) && !rows.some((row) => { const date = currentSplitEventDate(row); return date !== null && date < hotFromDate; })) continue;
    const payload = encodeCurrentSplitFeedTransport({ source: args.current.source, release: args.current.release,
      sport: args.current.sport, fetchedAt: args.current.fetchedAt, rows });
    const payloadText = canonicalSplitJson(payload);
    const item = { sport: args.current.sport, feed_release: args.current.release, source: args.current.source,
      group_key: key, event_dates: [...new Set(rows.map(currentSplitEventDate).filter((date) => date !== null))],
      first_observation_id: groupOrders[key], fetched_at: args.current.fetchedAt, payload, payload_text: payloadText,
      observation_sha256s: rows.map((row) => createHash("sha256").update(canonicalSplitJson(row)).digest("hex")),
      payload_sha256: createHash("sha256").update(payloadText).digest("hex") };
    if (!Number.isSafeInteger(groupOrders[key]) || Buffer.byteLength(JSON.stringify(item)) > 900_000) {
      throw new Error("Retained split history index exceeds its verified transport; current cache is preserved");
    }
    historyItems.push(item);
    coldGroups.add(key);
  }
  let historyBatch: Json[] = [], historyBytes = 2;
  async function flushHistory() {
    if (!historyBatch.length) return;
    const { data, error } = await args.client.rpc("save_current_split_group_history", { history: historyBatch });
    if (error || Number(data?.acknowledged) !== historyBatch.length) throw new Error(`Retained split history was not acknowledged: ${error?.message ?? "incomplete response"}`);
    historyBatch = []; historyBytes = 2;
  }
  for (const item of historyItems) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (historyBatch.length && historyBytes + size > BATCH_BYTES) await flushHistory();
    historyBatch.push(item); historyBytes += size;
  }
  await flushHistory();
  const rows = args.merged.rows.filter((row) => {
    const date = currentSplitEventDate(row);
    return date === null || date >= hotFromDate;
  });
  const hotKeys = new Set(rows.map(currentSplitGroupKey));
  return { ...args.merged, rows, observationArchive: { protocol: CURRENT_SPLIT_ARCHIVE_PROTOCOL, hotFromDate,
    groupOrders: Object.fromEntries([...hotKeys].map((key) => [key, groupOrders[key]])),
    coldGroups: [...coldGroups].filter((key) => hotKeys.has(key)) } } as ArchivedCurrentSplitFeed;
}

/** Derived retained-display index only; raw immutable observations remain the research authority. */
export async function* iterateCurrentSplitGroupHistory(client: Client, feed: SharpApiCurrentSplitFeed,
  eventDates?: readonly string[], groupKeys?: readonly string[]): AsyncGenerator<{ group_key: string; first_observation_id: number; payload: unknown; observation_sha256s: string[] }> {
  if (eventDates?.length === 0 || groupKeys?.length === 0) return;
  let cursor = 0;
  for (;;) {
    const { data, error } = await client.rpc("read_current_split_group_history", {
      p_sport: feed.sport, p_release: feed.release, p_event_dates: eventDates ?? null,
      p_group_keys: groupKeys ?? null, p_after_order: cursor,
    });
    if (error) throw new Error(`Retained historical split evidence unavailable: ${error.message}`);
    const rows = (data ?? []) as Array<{ group_key: string; first_observation_id: number; payload: unknown; observation_sha256s: string[] }>;
    for (const row of rows) {
      const order = Number(row.first_observation_id);
      if (!Number.isSafeInteger(order) || order <= cursor) throw new Error("Retained history page has invalid order");
      cursor = order; yield { ...row, first_observation_id: order };
    }
    if (rows.length < 5) break;
  }
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
