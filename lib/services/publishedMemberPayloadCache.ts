import { gzipSync, gunzipSync } from "node:zlib";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";

type CompressedMemberPayload = { encoding: "gzip-base64"; payload: string };
export type CachedPublishedMemberPayload = DailyEdgeResponse | CompressedMemberPayload;

/** Full CBB history exceeds the framework's 2 MiB cache-entry limit. Keep
 * exactly the same public record in a lossless, bounded server-only envelope. */
export function encodePublishedMemberPayload(payload: DailyEdgeResponse): CachedPublishedMemberPayload {
  return payload.sport === "cbb"
    ? { encoding: "gzip-base64", payload: gzipSync(JSON.stringify(payload)).toString("base64") }
    : payload;
}

export function decodePublishedMemberPayload(value: CachedPublishedMemberPayload): DailyEdgeResponse {
  if ("encoding" in value) {
    return JSON.parse(gunzipSync(Buffer.from(value.payload, "base64"), {
      maxOutputLength: 64 * 1024 * 1024,
    }).toString("utf8")) as DailyEdgeResponse;
  }
  return value;
}
