import { createHash } from "node:crypto";

export type FootballRawPriceMarket = "moneyline" | "spread" | "total";
export type FootballRawPriceSelection = "away" | "home" | "over" | "under";
export type FootballRawPricePhase = "provider_opening" | "current";
export type FootballRawPriceStatus = "observed" | "incomplete" | "duplicate" | "unsupported";

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
    schema: "football_raw_price_parser_input_v1";
    sha256: string;
    payload: unknown[];
    bytes: number;
  } | null;
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

export function footballRawPriceParserInput(values: unknown[]) {
  const payload = structuredClone(values);
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes <= 0 || bytes > 2 * 1024 * 1024) {
    throw new Error("Football raw-price parser input exceeds the bounded 2 MiB research archive limit.");
  }
  return {
    schema: "football_raw_price_parser_input_v1" as const,
    sha256: rawPriceSha256(payload),
    payload,
    bytes,
  };
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
