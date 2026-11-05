import { gunzipSync, gzipSync } from "node:zlib";

// Matches the existing CBB captured-feed reader's decompression ceiling.
// Larger legacy feeds remain raw so this optimization cannot discard history.
const MAX_DECODED_BYTES = 32_000_000;
const MIN_COMPRESSION_BYTES = 64_000;

export function encodeCurrentSplitFeedTransport(feed: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(feed);
  const bytes = Buffer.byteLength(json);
  if (bytes < MIN_COMPRESSION_BYTES || bytes > MAX_DECODED_BYTES) return feed;
  const envelope = { encoding: "gzip-base64", payload: gzipSync(json).toString("base64") };
  return Buffer.byteLength(JSON.stringify(envelope)) < bytes ? envelope : feed;
}

export function decodeCurrentSplitFeedTransport(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.encoding !== "gzip-base64" || typeof envelope.payload !== "string") return null;
  try {
    return JSON.parse(gunzipSync(Buffer.from(envelope.payload, "base64"), {
      maxOutputLength: MAX_DECODED_BYTES,
    }).toString("utf8"));
  } catch {
    return null;
  }
}
