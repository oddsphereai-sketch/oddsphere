import { createHash } from "node:crypto";

export type FootballRawPriceMarket = "moneyline" | "spread" | "total";
export type FootballRawPriceSelection = "away" | "home" | "over" | "under";
export type FootballRawPricePhase = "provider_opening" | "current";
export type FootballRawPriceStatus = "observed" | "incomplete" | "duplicate" | "unsupported";

export const FOOTBALL_RAW_PRICE_PARSER_INPUT_SCHEMA_RELEASE =
  "football_raw_price_parser_input_2026_10_27_r4_streaming_response_hash" as const;

export type FootballRawPriceObservation = {
  sourceObservationId: string;
  rawRowSha256: string;
  provider: "balldontlie" | "sharpapi";
  feed: string;
  phase: FootballRawPricePhase;
  providerGameId: string;
  providerEventId: string | null;
  sportsbook: string | null;
  market: FootballRawPriceMarket;
  selection: FootballRawPriceSelection;
  line: number | null;
  price: number | null;
  providerObservedAt: string | null;
  providerFetchedAt: string;
  status: FootballRawPriceStatus;
  notes: string[];
};

export type FootballRawPriceRowManifest = {
  rowIndex: number;
  rawRowSha256: string;
  disposition: "matched" | "unmatched" | "ambiguous";
  providerGameId: string | null;
  sourceObservationIds: string[];
};

export type FootballRawPriceResponseManifest = {
  provider: "balldontlie" | "sharpapi";
  feed: string;
  participant: string | null;
  providerFetchedAt: string;
  rawResponseSha256: string | null;
  /** Exact rows handed to the parser, retained only by the bounded research sidecar. */
  rawParserInput: {
    /** Versioned parser contract; archive identity is this release plus sha256. */
    schema: string;
    sha256: string;
    payload: unknown[];
    bytes: number;
  } | null;
  /** Research-only archive failure; never a provider/parser failure. */
  rawParserInputFailureReason?: string | null;
  returnedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  rows: FootballRawPriceRowManifest[];
  failed: boolean;
  failureReason: string | null;
  observationsByGame: Record<string, FootballRawPriceObservation[]>;
};

export function rawPriceSha256(value: unknown): string {
  const hash = createHash("sha256");
  const active = new WeakSet<object>();

  function updateString(input: string): void {
    hash.update('"');
    let runStart = 0;
    for (let index = 0; index < input.length; index += 1) {
      const codeUnit = input.charCodeAt(index);
      let escaped: string | null = null;
      if (codeUnit === 0x22) escaped = '\\"';
      else if (codeUnit === 0x5c) escaped = "\\\\";
      else if (codeUnit === 0x08) escaped = "\\b";
      else if (codeUnit === 0x09) escaped = "\\t";
      else if (codeUnit === 0x0a) escaped = "\\n";
      else if (codeUnit === 0x0c) escaped = "\\f";
      else if (codeUnit === 0x0d) escaped = "\\r";
      else if (codeUnit <= 0x1f) escaped = `\\u${codeUnit.toString(16).padStart(4, "0")}`;
      else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = input.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          index += 1;
          continue;
        }
        escaped = `\\u${codeUnit.toString(16)}`;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        escaped = `\\u${codeUnit.toString(16)}`;
      }
      if (escaped !== null) {
        if (runStart < index) hash.update(input.slice(runStart, index));
        hash.update(escaped);
        runStart = index + 1;
      }
    }
    if (runStart < input.length) hash.update(input.slice(runStart));
    hash.update('"');
  }

  function updateJson(item: unknown, arrayElement = false): boolean {
    if (item !== null && typeof item === "object" &&
        typeof (item as { toJSON?: unknown }).toJSON === "function") {
      item = (item as { toJSON(): unknown }).toJSON();
    }
    if (item === undefined || typeof item === "function" || typeof item === "symbol") {
      if (arrayElement) hash.update("null");
      return arrayElement;
    }
    if (item === null) { hash.update("null"); return true; }
    if (typeof item === "string") { updateString(item); return true; }
    if (typeof item === "boolean") { hash.update(item ? "true" : "false"); return true; }
    if (typeof item === "number") {
      hash.update(Number.isFinite(item) ? String(Object.is(item, -0) ? 0 : item) : "null");
      return true;
    }
    if (typeof item === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
    if (typeof item !== "object") throw new TypeError("Raw price response is not JSON serializable");
    if (active.has(item)) throw new TypeError("Converting circular structure to JSON");
    active.add(item);
    try {
      if (Array.isArray(item)) {
        hash.update("[");
        for (let index = 0; index < item.length; index += 1) {
          if (index > 0) hash.update(",");
          updateJson(item[index], true);
        }
        hash.update("]");
        return true;
      }
      hash.update("{");
      let wrote = false;
      for (const key in item as Record<string, unknown>) {
        if (!Object.hasOwn(item, key)) continue;
        const child = (item as Record<string, unknown>)[key];
        if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
        if (wrote) hash.update(",");
        updateString(key);
        hash.update(":");
        updateJson(child);
        wrote = true;
      }
      hash.update("}");
      return true;
    } finally {
      active.delete(item);
    }
  }

  if (!updateJson(value)) throw new TypeError("Raw price response is not JSON serializable");
  return hash.digest("hex");
}

export function failedFootballRawPriceManifest(args: {
  provider: FootballRawPriceResponseManifest["provider"];
  feed: string;
  participant: string | null;
  providerFetchedAt: string;
  gameIds: string[];
  reason: string;
}): FootballRawPriceResponseManifest {
  return {
    provider: args.provider,
    feed: args.feed,
    participant: args.participant,
    providerFetchedAt: args.providerFetchedAt,
    rawResponseSha256: null,
    rawParserInput: null,
    returnedRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    ambiguousRows: 0,
    rows: [],
    failed: true,
    failureReason: args.reason,
    observationsByGame: Object.fromEntries(args.gameIds.map((gameId) => [gameId, []])),
  };
}

export function footballRawPriceParserInput(values: unknown[]): {
  input: NonNullable<FootballRawPriceResponseManifest["rawParserInput"]> | null;
  failureReason: string | null;
} {
  try {
    const maximumBytes = 2 * 1024 * 1024;
    assertBoundedRawParserJson(values, maximumBytes);
    const serialized = JSON.stringify(values);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes <= 0 || bytes > maximumBytes) {
      return {
        input: null,
        failureReason: "football_raw_price_parser_input_exceeds_2_mib_research_archive_limit",
      };
    }
    return {
      input: {
        schema: FOOTBALL_RAW_PRICE_PARSER_INPUT_SCHEMA_RELEASE,
        sha256: createHash("sha256").update(serialized).digest("hex"),
        payload: JSON.parse(serialized) as unknown[],
        bytes,
      },
      failureReason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return {
      input: null,
      failureReason: (message.startsWith("football_raw_price_parser_input_")
        ? message
        : `football_raw_price_parser_input_archive_failed:${message}`).slice(0, 512),
    };
  }
}

function assertBoundedRawParserJson(value: unknown, maximumBytes: number): void {
  let bytes = 0;
  const active = new WeakSet<object>();

  function add(amount: number): void {
    bytes += amount;
    if (bytes > maximumBytes) {
      throw new Error("football_raw_price_parser_input_exceeds_2_mib_research_archive_limit");
    }
  }

  function addJsonStringBytes(valueToMeasure: string): void {
    add(2); // opening and closing quotes
    for (let index = 0; index < valueToMeasure.length; index += 1) {
      const codeUnit = valueToMeasure.charCodeAt(index);
      if (codeUnit === 0x22 || codeUnit === 0x5c ||
          codeUnit === 0x08 || codeUnit === 0x09 || codeUnit === 0x0a ||
          codeUnit === 0x0c || codeUnit === 0x0d) {
        add(2);
      } else if (codeUnit <= 0x1f) {
        add(6);
      } else if (codeUnit <= 0x7f) {
        add(1);
      } else if (codeUnit <= 0x7ff) {
        add(2);
      } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = valueToMeasure.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          add(4);
          index += 1;
        } else {
          add(6); // JSON.stringify escapes an unpaired surrogate as \udxxx.
        }
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        add(6);
      } else {
        add(3);
      }
    }
  }

  function visit(item: unknown, depth: number): void {
    if (depth > 64) throw new Error("football_raw_price_parser_input_exceeds_safe_json_depth");
    if (item === null) {
      add(4);
      return;
    }
    if (typeof item === "string") {
      addJsonStringBytes(item);
      return;
    }
    if (typeof item === "boolean") {
      add(item ? 4 : 5);
      return;
    }
    if (typeof item === "number") {
      add(Number.isFinite(item) ? String(Object.is(item, -0) ? 0 : item).length : 4);
      return;
    }
    if (typeof item !== "object") {
      throw new Error("football_raw_price_parser_input_contains_non_json_value");
    }
    if (active.has(item)) throw new Error("football_raw_price_parser_input_contains_cycle");
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new Error("football_raw_price_parser_input_contains_non_json_object");
    }
    active.add(item);
    try {
      add(2);
      if (Array.isArray(item)) {
        for (let index = 0; index < item.length; index += 1) {
          if (index > 0) add(1);
          if (!Object.hasOwn(item, index)) throw new Error("football_raw_price_parser_input_contains_sparse_array");
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor)) {
            throw new Error("football_raw_price_parser_input_contains_accessor");
          }
          visit(descriptor.value, depth + 1);
        }
      } else {
        let index = 0;
        for (const key in item as Record<string, unknown>) {
          if (!Object.hasOwn(item, key)) continue;
          if (index > 0) add(1);
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || !("value" in descriptor)) {
            throw new Error("football_raw_price_parser_input_contains_accessor");
          }
          addJsonStringBytes(key);
          add(1);
          visit(descriptor.value, depth + 1);
          index += 1;
        }
      }
    } finally {
      active.delete(item);
    }
  }

  visit(value, 0);
}

export function markRawPriceDuplicates(
  observationsByGame: Record<string, FootballRawPriceObservation[]>,
): Record<string, FootballRawPriceObservation[]> {
  return Object.fromEntries(Object.entries(observationsByGame).map(([gameId, observations]) => {
    const counts = new Map<string, number>();
    for (const row of observations) {
      const key = [
        row.provider, row.feed, row.providerEventId, row.sportsbook, row.market, row.selection,
        row.line, row.price, row.providerObservedAt,
      ].join("|");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [gameId, observations.map((row) => {
      const key = [
        row.provider, row.feed, row.providerEventId, row.sportsbook, row.market, row.selection,
        row.line, row.price, row.providerObservedAt,
      ].join("|");
      return (counts.get(key) ?? 0) > 1
        ? { ...row, status: "duplicate" as const, notes: [...row.notes, "duplicate_provider_observation_identity"] }
        : row;
    })];
  }));
}
