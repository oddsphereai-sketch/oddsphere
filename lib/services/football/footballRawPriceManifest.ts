import { createHash } from "node:crypto";

export type FootballRawPriceMarket = "moneyline" | "spread" | "total";
export type FootballRawPriceSelection = "away" | "home" | "over" | "under";
export type FootballRawPricePhase = "provider_opening" | "current";
export type FootballRawPriceStatus = "observed" | "incomplete" | "duplicate" | "unsupported";

export const FOOTBALL_RAW_PRICE_PARSER_INPUT_SCHEMA_RELEASE =
  "football_raw_price_parser_input_2026_10_27_r2_schema_bound_key" as const;

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
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

  function visit(item: unknown, depth: number): void {
    if (depth > 64) throw new Error("football_raw_price_parser_input_exceeds_safe_json_depth");
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number") {
      const serialized = JSON.stringify(item);
      if (serialized === undefined) throw new Error("football_raw_price_parser_input_contains_non_json_value");
      add(Buffer.byteLength(serialized, "utf8"));
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
          visit(item[index], depth + 1);
        }
      } else {
        const entries = Object.entries(item);
        for (let index = 0; index < entries.length; index += 1) {
          if (index > 0) add(1);
          const [key, child] = entries[index]!;
          add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
          visit(child, depth + 1);
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
