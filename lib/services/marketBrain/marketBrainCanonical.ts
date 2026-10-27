import { createHash } from "node:crypto";

/**
 * Canonical JSON used for every Market Brain content address. PostgreSQL jsonb
 * is free to reorder object keys, so JSON.stringify must never define an
 * immutable research identity.
 */
export function marketBrainCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(marketBrainCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${marketBrainCanonicalJson(item)}`)
      .join(",")}}`;
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
