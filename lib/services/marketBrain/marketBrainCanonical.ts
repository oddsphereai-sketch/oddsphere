import { createHash } from "node:crypto";

export const MARKET_BRAIN_CANONICAL_JSON_RELEASE =
  "market_brain_canonical_json_2026_10_27_r2_utf16_finite_numbers" as const;

function compareUtf16CodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/**
 * Canonical JSON used for every Market Brain content address. PostgreSQL jsonb
 * is free to reorder object keys, so JSON.stringify must never define an
 * immutable research identity.
 */
export function marketBrainCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(marketBrainCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareUtf16CodeUnits(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${marketBrainCanonicalJson(item)}`)
      .join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Market Brain canonical JSON requires finite numbers.");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Market Brain canonical JSON cannot encode undefined.");
  return serialized;
}

export function marketBrainSha256(value: unknown): string {
  return createHash("sha256").update(marketBrainCanonicalJson(value)).digest("hex");
}

export function marketBrainCanonicalByteLength(value: unknown): number {
  return Buffer.byteLength(marketBrainCanonicalJson(value));
}
