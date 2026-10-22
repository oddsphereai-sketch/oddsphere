import { createHash } from "node:crypto";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
interface JsonArray extends ReadonlyArray<JsonValue> {}
interface JsonObject { readonly [key: string]: JsonValue }

/**
 * Bundlers may not preserve JSON source-object key insertion order. Artifact
 * integrity therefore hashes a recursive canonical key ordering while
 * preserving array order and ordinary JSON value semantics.
 */
export function canonicalNbaPlayerPropsArtifactJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalNbaPlayerPropsArtifactJson(item)).join(",")}]`;
  }
  const object = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalNbaPlayerPropsArtifactJson(object[key]!)}`)
    .join(",")}}`;
}

export function nbaPlayerPropsArtifactSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalNbaPlayerPropsArtifactJson(value as JsonValue))
    .digest("hex");
}
