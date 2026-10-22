import { createHash } from "node:crypto";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
interface JsonArray extends ReadonlyArray<JsonValue> {}
interface JsonObject { readonly [key: string]: JsonValue }

function encodeString(value: string): string {
  return `s${Buffer.byteLength(value, "utf8")}:${value}`;
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("NBA props artifact contains a non-finite number.");
  }
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeDoubleBE(Object.is(value, -0) ? 0 : value, 0);
  return `d${bytes.toString("hex")}`;
}

/**
 * Artifact integrity uses an unambiguous, type-tagged encoding. Object keys
 * are sorted, array order is retained, strings are byte-length-prefixed, and
 * numbers use their IEEE-754 binary representation. This avoids depending on
 * bundler key insertion order or runtime-specific decimal number rendering.
 */
export function canonicalNbaPlayerPropsArtifactJson(value: JsonValue): string {
  if (value === null) return "z";
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "number") return encodeNumber(value);
  if (typeof value === "boolean") return value ? "t" : "f";
  if (Array.isArray(value)) {
    return `a${value.length}:${value.map((item) => canonicalNbaPlayerPropsArtifactJson(item)).join("")}`;
  }
  const object = value as Readonly<Record<string, JsonValue>>;
  const keys = Object.keys(object).sort();
  return `o${keys.length}:${keys
    .map((key) => `${encodeString(key)}${canonicalNbaPlayerPropsArtifactJson(object[key]!)}`)
    .join("")}`;
}

export function nbaPlayerPropsArtifactSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalNbaPlayerPropsArtifactJson(value as JsonValue))
    .digest("hex");
}
