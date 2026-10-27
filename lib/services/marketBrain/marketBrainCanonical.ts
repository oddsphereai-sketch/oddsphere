import { createHash } from "node:crypto";

export const MARKET_BRAIN_CANONICAL_JSON_RELEASE =
  "market_brain_canonical_json_2026_10_27_r3_strict_json_domain" as const;

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
  const active = new WeakSet<object>();

  function encode(item: unknown): string {
    if (Array.isArray(item)) {
      if (active.has(item)) throw new Error("Market Brain canonical JSON cannot encode cycles.");
      const ownKeys = Reflect.ownKeys(item);
      const indexKeys = ownKeys.filter((key): key is string => typeof key === "string" && key !== "length");
      if (indexKeys.length !== item.length || indexKeys.some((key, index) => key !== String(index))) {
        throw new Error("Market Brain canonical JSON requires dense arrays without custom properties.");
      }
      if (ownKeys.some((key) => typeof key === "symbol" &&
        Object.getOwnPropertyDescriptor(item, key)?.enumerable === true)) {
        throw new Error("Market Brain canonical JSON cannot encode symbol keys.");
      }
      active.add(item);
      try {
        return `[${item.map(encode).join(",")}]`;
      } finally {
        active.delete(item);
      }
    }
    if (item !== null && typeof item === "object") {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("Market Brain canonical JSON accepts only plain objects and arrays.");
      }
      if (active.has(item)) throw new Error("Market Brain canonical JSON cannot encode cycles.");
      const symbols = Object.getOwnPropertySymbols(item);
      if (symbols.some((symbol) => Object.getOwnPropertyDescriptor(item, symbol)?.enumerable === true)) {
        throw new Error("Market Brain canonical JSON cannot encode symbol keys.");
      }
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const entries = Object.entries(descriptors);
      if (entries.some(([, descriptor]) => !descriptor.enumerable || !("value" in descriptor))) {
        throw new Error("Market Brain canonical JSON requires enumerable data properties.");
      }
      active.add(item);
      try {
        return `{${entries
          .sort(([left], [right]) => compareUtf16CodeUnits(left, right))
          .map(([key, descriptor]) => `${JSON.stringify(key)}:${encode(descriptor.value)}`)
          .join(",")}}`;
      } finally {
        active.delete(item);
      }
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        throw new Error("Market Brain canonical JSON requires finite numbers.");
      }
      return Object.is(item, -0) ? "0" : JSON.stringify(item);
    }
    if (typeof item === "string" || typeof item === "boolean" || item === null) {
      return JSON.stringify(item);
    }
    throw new Error(`Market Brain canonical JSON cannot encode ${typeof item}.`);
  }

  return encode(value);
}

export function marketBrainSha256(value: unknown): string {
  return createHash("sha256").update(marketBrainCanonicalJson(value)).digest("hex");
}

export function marketBrainCanonicalByteLength(value: unknown): number {
  return Buffer.byteLength(marketBrainCanonicalJson(value));
}
