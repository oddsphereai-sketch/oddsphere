import type { SupabaseClient } from "@supabase/supabase-js";

import {
  numericFeature,
  type MarketBrainAvailability,
  type MarketBrainExpectedInput,
  type MarketBrainObservation,
  type MarketBrainSourceManifest,
} from "@/lib/services/marketBrain/marketBrainContract";
import { marketBrainSha256 } from "@/lib/services/marketBrain/marketBrainCanonical";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";

export const NFL_OWLS_MARKET_BRAIN_SPLIT_EVIDENCE_RELEASE =
  "nfl_owls_market_brain_split_evidence_2026_10_27_r1_canonical_named_books" as const;

const SOURCE_BOOKS = ["circa", "draftkings", "betmgm"] as const;
const MARKETS = ["moneyline", "spread", "total"] as const;
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_ROWS = 5_000;

type SourceBook = typeof SOURCE_BOOKS[number];
type Market = typeof MARKETS[number];
type Side = "away" | "home" | "over" | "under";

export type NflOwlsMarketBrainSplitRow = {
  id: number;
  canonical_event_id: string;
  market_type: string;
  selection_key: string;
  source_book: string;
  bets_pct: number | null;
  money_pct: number | null;
  market_line: number | null;
  market_price: number | null;
  provider_event_id: string | null;
  source_observed_at: string | null;
  fetched_at: string;
  raw_payload_hash: string;
  inserted_at: string;
};

export type NflOwlsMarketBrainSplitEvidence = {
  observations: MarketBrainObservation[];
  expectedInputs: MarketBrainExpectedInput[];
  sourceManifests: MarketBrainSourceManifest[];
};

export async function readNflOwlsMarketBrainSplitEvidence(args: {
  client: SupabaseClient;
  games: readonly NflPreviewGame[];
  evaluatedAt: string;
  signal?: AbortSignal;
}): Promise<Record<string, NflOwlsMarketBrainSplitEvidence>> {
  const gameIds = [...new Set(args.games.map((game) => game.providerGameId))];
  if (gameIds.length === 0) return {};
  const earliest = new Date(Date.parse(args.evaluatedAt) - HISTORY_WINDOW_MS).toISOString();
  let query = args.client
    .from("market_split_observations_v2")
    .select("id,canonical_event_id,market_type,selection_key,source_book,bets_pct,money_pct,market_line,market_price,provider_event_id,source_observed_at,fetched_at,raw_payload_hash,inserted_at")
    .eq("league", "nfl")
    .eq("provider", "owls")
    .in("canonical_event_id", gameIds)
    .gte("fetched_at", earliest)
    .lte("fetched_at", args.evaluatedAt)
    .lte("inserted_at", args.evaluatedAt)
    .order("id", { ascending: true })
    .limit(MAX_ROWS + 1);
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query;
  if (error) throw new Error(`NFL Owls Market Brain split read failed: ${error.message}`);
  const rows = (data ?? []) as NflOwlsMarketBrainSplitRow[];
  if (rows.length > MAX_ROWS) {
    throw new Error(`NFL Owls Market Brain split read exceeded ${MAX_ROWS} normalized rows.`);
  }
  return Object.fromEntries(gameIds.map((gameId) => [gameId, buildNflOwlsMarketBrainSplitEvidence({
    gameId,
    evaluatedAt: args.evaluatedAt,
    rows: rows.filter((row) => row.canonical_event_id === gameId),
  })]));
}

export function buildNflOwlsMarketBrainSplitEvidence(args: {
  gameId: string;
  evaluatedAt: string;
  rows: readonly NflOwlsMarketBrainSplitRow[];
}): NflOwlsMarketBrainSplitEvidence {
  const evaluatedMs = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) throw new Error("NFL Owls Market Brain evaluation time is invalid.");
  const latestRows = new Map<string, NflOwlsMarketBrainSplitRow>();
  for (const row of args.rows) {
    const side = selectionSide(row.selection_key);
    if (!SOURCE_BOOKS.includes(row.source_book as SourceBook) ||
      !MARKETS.includes(row.market_type as Market) || side === null ||
      row.source_observed_at === null || !validAtOrBefore(row.source_observed_at, evaluatedMs) ||
      !validAtOrBefore(row.fetched_at, evaluatedMs) || !validAtOrBefore(row.inserted_at, evaluatedMs) ||
      !/^[a-f0-9]{64}$/.test(row.raw_payload_hash)) continue;
    const key = [row.source_book, row.market_type, row.source_observed_at, side].join("\u0000");
    const prior = latestRows.get(key);
    if (!prior || row.id > prior.id) latestRows.set(key, row);
  }

  const groups = new Map<string, NflOwlsMarketBrainSplitRow[]>();
  for (const row of latestRows.values()) {
    const key = [row.source_book, row.market_type, row.source_observed_at].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const observations: MarketBrainObservation[] = [];
  const manifestRows: MarketBrainSourceManifest["rows"] = [];
  const sortedGroups = [...groups.values()].sort((a, b) =>
    a[0]!.source_observed_at!.localeCompare(b[0]!.source_observed_at!) ||
    a[0]!.source_book.localeCompare(b[0]!.source_book) ||
    a[0]!.market_type.localeCompare(b[0]!.market_type));
  for (const rows of sortedGroups) {
    const sourceBook = rows[0]!.source_book as SourceBook;
    const market = rows[0]!.market_type as Market;
    const expectedSides = market === "total" ? ["over", "under"] as const : ["away", "home"] as const;
    const pair = expectedSides.map((side) => rows.find((row) => selectionSide(row.selection_key) === side));
    if (pair.some((row) => !row || row.bets_pct === null || row.money_pct === null)) continue;
    const first = pair[0]!;
    const second = pair[1]!;
    const observedAt = first.source_observed_at!;
    const availableAt = latestTimestamp([first.fetched_at, second.fetched_at, first.inserted_at, second.inserted_at]);
    const availability: MarketBrainAvailability = evaluatedMs - Date.parse(observedAt) > MAX_AGE_MS
      ? "stale" : "observed";
    const id = `split:owls:${sourceBook}:${market}:${observedAt}`;
    observations.push({
      id,
      eventId: args.gameId,
      sport: "nfl",
      market,
      modality: "identified_book_split",
      source: { provider: "owls", feed: "named_book_splits_canonical", participant: sourceBook },
      sourcePrior: sourceBook === "circa" ? "professional_book" : "retail_book",
      observedRole: "unknown",
      observedAt,
      timing: {
        providerObservedAt: observedAt,
        providerFetchedAt: latestTimestamp([first.fetched_at, second.fetched_at]),
        ingestedAt: latestTimestamp([first.inserted_at, second.inserted_at]),
        availableAt,
      },
      availability,
      targetRelation: "unknown",
      values: {
        books_used: numericFeature(null),
        first_money_pct: numericFeature(first.money_pct! * 100),
        first_bets_pct: numericFeature(first.bets_pct! * 100),
        second_money_pct: numericFeature(second.money_pct! * 100),
        second_bets_pct: numericFeature(second.bets_pct! * 100),
        first_money_minus_bets_pp: numericFeature((first.money_pct! - first.bets_pct!) * 100),
        first_line: numericFeature(first.market_line),
        second_line: numericFeature(second.market_line),
        first_price: numericFeature(first.market_price),
        second_price: numericFeature(second.market_price),
      },
      categorical: {
        firstSelection: expectedSides[0],
        secondSelection: expectedSides[1],
        denominatorKnown: false,
        exactLineMatched: null,
      },
      audit: {
        sourceRelease: NFL_OWLS_MARKET_BRAIN_SPLIT_EVIDENCE_RELEASE,
        sourceObservationId: `${first.provider_event_id ?? args.gameId}:${sourceBook}:${market}:${observedAt}`,
        notes: ["normalized canonical evidence; provider raw response archive not yet linked"],
      },
    });
    manifestRows.push({
      rowIndex: manifestRows.length,
      rawRowSha256: marketBrainSha256({ first, second }),
      disposition: "matched",
      providerGameId: args.gameId,
      participant: sourceBook,
      retainedObservationIds: [id],
    });
  }

  const expectedInputs = MARKETS.flatMap((market) => SOURCE_BOOKS.map((sourceBook) => {
    const ids = observations.filter((row) => row.market === market && row.source.participant === sourceBook)
      .map((row) => row.id);
    const available = observations.filter((row) => ids.includes(row.id));
    const hasObserved = available.some((row) => row.availability === "observed");
    const availability: MarketBrainAvailability = hasObserved ? "observed"
      : available.length > 0 ? "stale" : "unavailable";
    return {
      id: `identified_book_split:${market}:owls:${sourceBook}`,
      market,
      modality: "identified_book_split" as const,
      provider: "owls",
      participant: sourceBook,
      expectation: "required" as const,
      availability,
      observationIds: ids,
      reason: availability === "observed" ? null
        : availability === "stale" ? "source_stale" : "provider_row_unavailable",
    } satisfies MarketBrainExpectedInput;
  }));

  const sourceManifests: MarketBrainSourceManifest[] = manifestRows.length === 0 ? [] : [{
    id: `source:owls:named_book_splits_canonical:${args.gameId}`,
    release: NFL_OWLS_MARKET_BRAIN_SPLIT_EVIDENCE_RELEASE,
    provider: "owls",
    feed: "named_book_splits_canonical",
    participant: null,
    providerFetchedAt: latestTimestamp(observations.map((row) => row.timing.providerFetchedAt!)),
    receivedAt: args.evaluatedAt,
    rawResponseSha256: marketBrainSha256(args.rows),
    rawParserInputSchemaRelease: null,
    rawParserInputSha256: null,
    returnedRows: manifestRows.length,
    matchedRows: manifestRows.length,
    unmatchedRows: 0,
    ambiguousRows: 0,
    ledgerScope: "full_response",
    ledgerRows: manifestRows.length,
    omittedRows: 0,
    rows: manifestRows,
    retainedObservationIds: manifestRows.flatMap((row) => row.retainedObservationIds),
    status: "observed",
    failureReason: null,
  }];
  return { observations, expectedInputs, sourceManifests };
}

function selectionSide(selectionKey: string): Side | null {
  const side = selectionKey.split(":").at(-1);
  return side === "away" || side === "home" || side === "over" || side === "under" ? side : null;
}

function validAtOrBefore(value: string, cutoffMs: number): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= cutoffMs;
}

function latestTimestamp(values: readonly string[]): string {
  return values.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}
