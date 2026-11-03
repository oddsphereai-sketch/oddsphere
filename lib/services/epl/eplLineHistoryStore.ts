import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import { supabase } from "@/lib/db/supabase";
import { EPL_EXTERNAL_ID_OFFSET } from "./eplProductionPipeline";
import { canonicalEplLineHistoryTimestamp, compactEplStoredPriceHistory, type EplStoredPriceObservation } from "./buildEplDailyEdgePreview";

type MarketName = EplStoredPriceObservation["market"];
type CurrentObservation = EplStoredPriceObservation & { gameId: number };
const HISTORY_PAGE_SIZE = 1000;

function markets(game: DailyEdgeResponse["games"][number]): Array<{ name: MarketName; value: MarketEdgeDto }> {
  return [
    { name: "match_result", value: game.markets.moneyline },
    ...(game.soccerDoubleChanceMarket ? [{ name: "double_chance" as const, value: game.soccerDoubleChanceMarket }] : []),
    { name: "total", value: game.markets.total },
    { name: "btts", value: game.markets.first_inning },
  ];
}

function identity(row: Pick<CurrentObservation, "gameId" | "market" | "side" | "sportsbook" | "line">, exactTotalContracts = false): string {
  const contract = exactTotalContracts && row.market === "total" ? `:line:${row.line ?? "missing"}` : "";
  return `${row.gameId}:${row.market}:${row.side}:${row.sportsbook ?? "unknown"}${contract}`;
}

function exactIdentity(row: CurrentObservation): string {
  return `${identity(row)}:${canonicalEplLineHistoryTimestamp(row.recordedAt)}:${row.american}:${row.line ?? "null"}:${row.sportsbook ?? "unknown"}`;
}

async function gameMaps(providerIds: number[], externalIdOffset = EPL_EXTERNAL_ID_OFFSET, label = "EPL", client = supabase) {
  const externalIds = providerIds.map((id) => externalIdOffset + id);
  const { data, error } = await client
    .from("games")
    .select("id,external_id")
    .eq("sport", "soccer")
    .in("external_id", externalIds);
  if (error) throw new Error(`load ${label} games for line history: ${error.message}`);
  const gameIdByProvider = new Map<number, number>();
  const providerByGameId = new Map<number, number>();
  for (const row of (data ?? []) as Array<{ id: number; external_id: number }>) {
    const providerId = row.external_id - externalIdOffset;
    gameIdByProvider.set(providerId, row.id);
    providerByGameId.set(row.id, providerId);
  }
  return { gameIdByProvider, providerByGameId };
}

export type EplLineHistoryOptions = { exactTotalContracts?: boolean; atomicMarketCaptures?: boolean; client?: SupabaseClient };

/** UCL native contracts occupy separate compaction trails. Existing EPL
 * compaction and every stored quote remain unchanged unless explicitly opted in. */
export function compactEplLineHistory(rows: EplStoredPriceObservation[], options: EplLineHistoryOptions = {}): EplStoredPriceObservation[] {
  if (options.atomicMarketCaptures) {
    // Preserve every real capture, including unchanged opposite sides and
    // genuine partial/conflicting legacy observations. Only exact duplicates
    // disappear; consumers must still require a complete same-clock family.
    const unique = new Map<string, EplStoredPriceObservation>();
    for (const row of rows) {
      const key = JSON.stringify([row.providerId, row.market, row.side, row.sportsbook, row.line,
        canonicalEplLineHistoryTimestamp(row.recordedAt), row.american, row.isOpener]);
      if (!unique.has(key)) unique.set(key, row);
    }
    return [...unique.values()].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  }
  if (!options.exactTotalContracts) return compactEplStoredPriceHistory(rows);
  const groups = new Map<string, EplStoredPriceObservation[]>();
  for (const row of rows) {
    const contract = row.market === "total" ? String(row.line ?? "missing") : "main";
    const key = `${row.providerId}:${row.market}:${row.side}:${row.sportsbook ?? "unknown"}:${contract}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].flatMap(group => compactEplStoredPriceHistory(group))
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}

export async function readEplStoredPriceHistory(providerIds: number[], externalIdOffset = EPL_EXTERNAL_ID_OFFSET, label = "EPL", options: EplLineHistoryOptions = {}): Promise<EplStoredPriceObservation[]> {
  if (providerIds.length === 0) return [];
  const client = options.client ?? supabase;
  const { providerByGameId } = await gameMaps(providerIds, externalIdOffset, label, client);
  const gameIds = [...providerByGameId.keys()];
  if (gameIds.length === 0) return [];
  // Match the established WNBA Daily Edge contract: immutable history is
  // loaded oldest-to-newest in bounded pages. A single newest-N cap can evict
  // a real opening capture as the week accumulates observations.
  const storedRows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data, error } = await client
      .from("line_history")
      .select("game_id,market_type,sportsbook,side,line_value,odds_american,is_opener,recorded_at")
      .in("game_id", gameIds)
      .in("market_type", ["match_result", "double_chance", "total", "btts"])
      .order("recorded_at", { ascending: true })
      .range(from, from + HISTORY_PAGE_SIZE - 1);
    if (error) throw new Error(`read ${label} line history: ${error.message}`);
    const page = (data ?? []) as Array<Record<string, unknown>>;
    storedRows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) break;
  }
  const parsed = storedRows.flatMap((row) => {
    const providerId = providerByGameId.get(Number(row.game_id));
    const american = Number(row.odds_american);
    if (providerId === undefined || !Number.isFinite(american) || typeof row.side !== "string") return [];
    return [{
      providerId,
      market: row.market_type as MarketName,
      side: row.side,
      line: row.line_value === null ? null : Number(row.line_value),
      american,
      sportsbook: typeof row.sportsbook === "string" ? row.sportsbook : null,
      recordedAt: String(row.recorded_at),
      isOpener: row.is_opener === true,
    }];
  });
  return compactEplLineHistory(parsed, options);
}

export async function persistEplLineHistory(input: { response: DailyEdgeResponse; allBookPrices?: EplStoredPriceObservation[]; apply: boolean; externalIdOffset?: number; label?: string; exactTotalContracts?: boolean; atomicMarketCaptures?: boolean; client?: SupabaseClient }) {
  const providerIds = input.response.games.map((game) => Number(game.external_id)).filter(Number.isFinite);
  if (!input.apply || providerIds.length === 0) return { proposed: 0, written: 0, errors: [] as string[] };
  const externalIdOffset = input.externalIdOffset ?? EPL_EXTERNAL_ID_OFFSET;
  const label = input.label ?? "EPL";
  const client = input.client ?? supabase;
  const { gameIdByProvider } = await gameMaps(providerIds, externalIdOffset, label, client);
  const existing = await readEplStoredPriceHistory(providerIds, externalIdOffset, label, { exactTotalContracts: input.exactTotalContracts, atomicMarketCaptures: input.atomicMarketCaptures, client });
  const exactExisting = new Set<string>();
  const earliestBySide = new Map<string, number>();
  const latestByTrail = new Map<string, { american: number; line: number | null; recordedAt: number }>();
  const terminalQuoteCountByTrail = new Map<string, number>();
  for (const row of existing) {
    const gameId = gameIdByProvider.get(row.providerId);
    if (gameId === undefined) continue;
    const stored = { ...row, gameId };
    exactExisting.add(exactIdentity(stored));
    const key = identity(stored, input.exactTotalContracts);
    earliestBySide.set(key, Math.min(earliestBySide.get(key) ?? Number.POSITIVE_INFINITY, Date.parse(row.recordedAt)));
    const recordedAt = Date.parse(row.recordedAt);
    const latest = latestByTrail.get(key);
    if (recordedAt >= (latest?.recordedAt ?? Number.NEGATIVE_INFINITY)) {
      const sameQuote = latest?.american === row.american && latest.line === row.line;
      latestByTrail.set(key, { american: row.american, line: row.line, recordedAt });
      terminalQuoteCountByTrail.set(key, sameQuote ? Math.min(2, (terminalQuoteCountByTrail.get(key) ?? 1) + 1) : 1);
    }
  }
  const proposed: CurrentObservation[] = [];
  const consider = (current: CurrentObservation) => {
    const exact = exactIdentity(current);
    if (exactExisting.has(exact)) return;
    const key = identity(current, input.exactTotalContracts);
    const observedMs = Date.parse(current.recordedAt);
    const latest = latestByTrail.get(key);
    const sameAsLatest = latest && observedMs >= latest.recordedAt && latest.american === current.american && latest.line === current.line;
    if (!input.atomicMarketCaptures && sameAsLatest && (terminalQuoteCountByTrail.get(key) ?? 1) >= 2) return;
    // UCL current-source bundles already state whether this was a provider
    // opener. An unchanged opposite/first-seen side must not be relabeled as
    // an opener and thereby removed from the complete current capture.
    if (!input.atomicMarketCaptures) current.isOpener = observedMs < (earliestBySide.get(key) ?? Number.POSITIVE_INFINITY);
    proposed.push(current);
    exactExisting.add(exact);
    earliestBySide.set(key, Math.min(earliestBySide.get(key) ?? Number.POSITIVE_INFINITY, observedMs));
    if (!latest || observedMs >= latest.recordedAt) {
      latestByTrail.set(key, { american: current.american, line: current.line, recordedAt: observedMs });
      terminalQuoteCountByTrail.set(key, sameAsLatest ? Math.min(2, (terminalQuoteCountByTrail.get(key) ?? 1) + 1) : 1);
    }
  };
  const considerSourceBundles = () => {
    for (const row of input.allBookPrices ?? []) {
      const gameId = gameIdByProvider.get(row.providerId);
      if (gameId !== undefined) consider({ ...row, gameId });
    }
  };
  // Actual source captures precede display-derived trail copies. This keeps
  // exact source flags/clocks authoritative when the same quote is in both.
  if (input.atomicMarketCaptures) considerSourceBundles();
  for (const game of input.response.games) {
    const providerId = Number(game.external_id);
    const gameId = gameIdByProvider.get(providerId);
    if (gameId === undefined) continue;
    for (const { name, value } of markets(game)) {
      for (const row of value.soccerPriceBoard?.rows ?? []) {
        if (row.price_american === null) continue;
        const stops = row.odds_trail?.length
          ? row.odds_trail
          : value.currentPriceObservedAt
            ? [{ american: row.price_american, line: name === "total" ? value.line : null, sportsbook: value.currentPriceSportsbook ?? null, observedAt: value.currentPriceObservedAt }]
            : [];
        for (const stop of stops) {
          if (!stop.observedAt) continue;
          const providerOpening = "source" in stop && stop.source === "provider_opening";
          if (input.atomicMarketCaptures && input.allBookPrices !== undefined && !providerOpening) continue;
          const current: CurrentObservation = {
            gameId,
            providerId,
            market: name,
            side: row.side,
            line: stop.line ?? (name === "total" ? value.line : null),
            american: stop.american,
            sportsbook: stop.sportsbook ?? value.currentPriceSportsbook ?? null,
            recordedAt: stop.observedAt,
            isOpener: input.atomicMarketCaptures === true && providerOpening,
          };
          consider(current);
        }
      }
    }
  }
  if (!input.atomicMarketCaptures) considerSourceBundles();
  if (proposed.length === 0) return { proposed: 0, written: 0, errors: [] as string[] };
  // A first deployment can discover a trail stop earlier than the current-only
  // seed. Move the opener marker back without deleting immutable observations.
  const backfilledOpeners = new Map<string, CurrentObservation>();
  for (const row of proposed.filter((item) => item.isOpener)) backfilledOpeners.set(identity(row, input.exactTotalContracts), row);
  for (const row of backfilledOpeners.values()) {
    let query = client.from("line_history").update({ is_opener: false })
      .eq("game_id", row.gameId).eq("market_type", row.market).eq("side", row.side)
      .eq("sportsbook", row.sportsbook ?? "unknown");
    if (input.exactTotalContracts && row.market === "total") {
      query = row.line === null ? query.is("line_value", null) : query.eq("line_value", row.line);
    }
    const { error } = await query;
    if (error) return { proposed: proposed.length, written: 0, errors: [`repair EPL line-history opener: ${error.message}`] };
  }
  const { error } = await client.from("line_history").insert(proposed.map((row) => ({
    game_id: row.gameId,
    market_type: row.market,
    sportsbook: row.sportsbook ?? "unknown",
    side: row.side,
    line_value: row.line,
    odds_american: row.american,
    is_opener: row.isOpener,
    recorded_at: row.recordedAt,
  })));
  return error
    ? { proposed: proposed.length, written: 0, errors: [`persist EPL line history: ${error.message}`] }
    : { proposed: proposed.length, written: proposed.length, errors: [] as string[] };
}
