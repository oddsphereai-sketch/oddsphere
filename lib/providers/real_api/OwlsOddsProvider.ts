import type { Sport } from "../../types/domain/Sport";
import type { LineRecord, IOddsProvider } from "../interfaces/IOddsProvider";
import { OwlsInsightClient } from "../owls/owlsInsightClient";
import type {
  RawOwlsOddsEvent,
  RawOwlsOddsResponse,
} from "../owls/owlsSharpBookOdds";
import {
  normalizeMlbTeamName,
  type MlbTeamAbbrev,
} from "./_teamNameNormalizer";
import type {
  SharpApiGameResolver,
  SharpApiSlateGame,
  V2DiscoveryPerGame,
  V2DiscoveryReport,
} from "./SharpAPIOddsProvider";

type Market = "moneyline" | "spread" | "total";
type Side = "home" | "away" | "over" | "under";

type Candidate = {
  gameExternalId: number;
  providerEventId: string;
  home: MlbTeamAbbrev;
  away: MlbTeamAbbrev;
  observedAt: string;
  market: Market;
  side: Side;
  sportsbook: string;
  line: number | null;
  american: number;
};

type RawOwlsOpeningRow = {
  book?: unknown;
  market?: unknown;
  side?: unknown;
  price?: unknown;
  point?: unknown;
  pointValue?: unknown;
  recordedAt?: unknown;
  recordedAtUtc?: unknown;
  inPlay?: unknown;
};

type RawOwlsOpeningResponse = {
  data?: Record<string, RawOwlsOpeningRow[] | null> | RawOwlsOpeningRow[] | null;
};

const MARKET: Record<string, Market | undefined> = {
  h2h: "moneyline",
  spreads: "spread",
  totals: "total",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

function americanToDecimal(price: number): number {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function probabilityToAmerican(probability: number): number {
  return probability >= 0.5
    ? Math.round((-100 * probability) / (1 - probability))
    : Math.round((100 * (1 - probability)) / probability);
}

function easternDate(iso: string | null): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function eventRows(response: RawOwlsOddsResponse): RawOwlsOddsEvent[] {
  if (Array.isArray(response.data)) return response.data;
  if (!response.data || typeof response.data !== "object") return [];
  return Object.values(response.data).flatMap((rows) => Array.isArray(rows) ? rows : []);
}

export type OwlsMlbOddsInspection = {
  events: RawOwlsOddsEvent[];
  pairs: Array<{ home: MlbTeamAbbrev; away: MlbTeamAbbrev }>;
  stats: {
    totalRows: number;
    matchedDate: number;
    wrongDate: number;
    dateUnparseable: number;
    nonMlb: number;
    teamUnresolved: number;
  };
};

/** Pure preflight used by the cron and the writer against the same payload. */
export function inspectOwlsMlbOddsResponse(
  response: RawOwlsOddsResponse,
  expectedDate: string,
): OwlsMlbOddsInspection {
  const rawRows = eventRows(response);
  // Owls may bucket one event into multiple response arrays (commonly one
  // bucket per book). Coalesce those fragments before identity, coverage, or
  // slate-alignment decisions so one game can never masquerade as N games.
  const byEventId = new Map<string, RawOwlsOddsEvent>();
  for (const row of rawRows) {
    const id = text(row.eventId) ?? (row.id == null ? null : String(row.id));
    const fallback = `${text(row.away_team) ?? "?"}@${text(row.home_team) ?? "?"}|${timestamp(row.commence_time) ?? "?"}`;
    const key = id ?? fallback;
    const current = byEventId.get(key);
    if (!current) {
      byEventId.set(key, { ...row, bookmakers: [...(row.bookmakers ?? [])] });
      continue;
    }
    current.bookmakers = [...(current.bookmakers ?? []), ...(row.bookmakers ?? [])];
  }
  const rows = [...byEventId.values()];
  const events: RawOwlsOddsEvent[] = [];
  const pairs: OwlsMlbOddsInspection["pairs"] = [];
  const stats: OwlsMlbOddsInspection["stats"] = {
    totalRows: rows.length,
    matchedDate: 0,
    wrongDate: 0,
    dateUnparseable: 0,
    nonMlb: 0,
    teamUnresolved: 0,
  };
  for (const event of rows) {
    if (normalized(event.sport ?? event.league) !== "mlb") {
      stats.nonMlb++;
      continue;
    }
    const start = timestamp(event.commence_time);
    const eventDate = easternDate(start);
    if (!eventDate) {
      stats.dateUnparseable++;
      continue;
    }
    if (eventDate !== expectedDate) {
      stats.wrongDate++;
      continue;
    }
    stats.matchedDate++;
    const home = normalizeMlbTeamName(event.home_team);
    const away = normalizeMlbTeamName(event.away_team);
    if (!home || !away) {
      stats.teamUnresolved++;
      continue;
    }
    events.push(event);
    pairs.push({ home, away });
  }
  return { events, pairs, stats };
}

function outcomeSide(market: Market, name: string, homeTeam: string, awayTeam: string): Side | null {
  if (market === "total") {
    const value = normalized(name);
    return value === "over" ? "over" : value === "under" ? "under" : null;
  }
  const value = normalized(name);
  if (value === normalized(homeTeam)) return "home";
  if (value === normalized(awayTeam)) return "away";
  return null;
}

function pairKey(value: Pick<Candidate, "providerEventId" | "sportsbook" | "market" | "line">): string {
  const pairLine = value.market === "spread" && value.line !== null
    ? Math.abs(value.line)
    : value.line;
  return `${value.providerEventId}|${value.sportsbook}|${value.market}|${pairLine ?? "null"}`;
}

function fairKey(value: Pick<Candidate, "providerEventId" | "market" | "side" | "line">): string {
  return `${value.providerEventId}|${value.market}|${value.side}|${value.line ?? "null"}`;
}

function openingRows(response: RawOwlsOpeningResponse): RawOwlsOpeningRow[] {
  if (Array.isArray(response.data)) return response.data;
  if (!response.data || typeof response.data !== "object") return [];
  return Object.values(response.data).flatMap((rows) => Array.isArray(rows) ? rows : []);
}

function openingLineRecords(
  response: RawOwlsOpeningResponse,
  event: { gameExternalId: number; providerEventId: string; home: MlbTeamAbbrev; away: MlbTeamAbbrev },
): LineRecord[] {
  const candidates = openingRows(response).flatMap<Candidate>((row) => {
    if (row.inPlay === true) return [];
    const market = MARKET[normalized(row.market)];
    const sideValue = normalized(row.side);
    const side: Side | null = sideValue === "home" || sideValue === "away" || sideValue === "over" || sideValue === "under"
      ? sideValue
      : null;
    const sportsbook = normalized(row.book);
    const observedAt = timestamp(row.recordedAtUtc ?? row.recordedAt);
    const american = finite(row.price);
    const line = market === "moneyline" ? null : finite(row.pointValue ?? row.point);
    return market && side && sportsbook && observedAt && american !== null && american !== 0 && (market === "moneyline" || line !== null)
      ? [{ ...event, observedAt, market, side, sportsbook, line, american }]
      : [];
  });
  const accepted = candidates.filter((candidate) => {
    const pair = candidates.filter((row) => pairKey(row) === pairKey(candidate));
    if (pair.length !== 2) return false;
    const expected: Side[] = candidate.market === "total" ? ["over", "under"] : ["home", "away"];
    return expected.every((side) => pair.filter((row) => row.side === side).length === 1)
      && (candidate.market !== "spread" || Math.abs((pair[0]?.line ?? 0) + (pair[1]?.line ?? 0)) <= 0.001)
      && (candidate.market !== "total" || Math.abs((pair[0]?.line ?? 0) - (pair[1]?.line ?? 0)) <= 0.001);
  });
  return accepted.map((row) => {
    const decimal = americanToDecimal(row.american);
    return {
      game_external_id: row.gameExternalId,
      market_type: row.market,
      player_external_id: null,
      sportsbook: row.sportsbook,
      side: row.side,
      line_value: row.line,
      odds_american: row.american,
      odds_decimal: decimal,
      implied_probability: 1 / decimal,
      ev_percent: null,
      fair_odds: null,
      is_ev_positive: null,
      fetched_at: row.observedAt,
    } satisfies LineRecord;
  });
}

function emptyDiscovery(): V2DiscoveryReport {
  return {
    discoverySource: "owls_current_odds",
    discoveryStats: {
      totalRows: 0,
      keptEvents: 0,
      skippedNonMlb: 0,
      skippedMissingEventId: 0,
      skippedPlayerProp: 0,
      skippedAlternateLine: 0,
      skippedDateUnparseable: 0,
      skippedWrongDate: 0,
      skippedTeamUnresolved: 0,
      dedupedRows: 0,
      multiBucketEvents: [],
    },
    eventsDiscovered: 0,
    eventsResolvedToGame: 0,
    eventsUnresolvedTeamPair: [],
    eventsWithSuffixedId: 0,
    eventsWithSplitsIdOnly: 0,
    opportunitiesUnavailable: false,
    apiCallsMade: 1,
    perGame: [],
  };
}

/**
 * Owls replacement for the retired SharpAPI MLB game-line provider.
 *
 * The adapter admits only complete, coherent same-book main-market pairs.
 * Pinnacle's pair supplies the no-vig fair probability for every matching
 * book/side/line; when no matching Pinnacle pair exists the EV fields remain
 * null instead of manufacturing a sharp reference.
 */
export class OwlsOddsProvider implements IOddsProvider {
  private readonly client: OwlsInsightClient;

  constructor(
    apiKey: string,
    private readonly resolveGame: SharpApiGameResolver,
    opts: { client?: OwlsInsightClient } = {},
  ) {
    this.client = opts.client ?? new OwlsInsightClient(apiKey);
  }

  async getGameLines(date: string, sport?: Sport): Promise<LineRecord[]> {
    return (await this.getGameLinesV2(date, sport)).records;
  }

  async getPlayerProps(_date: string, _sport?: Sport): Promise<LineRecord[]> {
    return [];
  }

  async getGameLinesV2(
    date: string,
    sport?: Sport,
    opts?: {
      externalIdsFilter?: readonly number[];
      slateGames?: readonly SharpApiSlateGame[];
      signal?: AbortSignal;
      openingExternalIds?: readonly number[];
    },
  ): Promise<{ records: LineRecord[]; openingRecords: LineRecord[]; discovery: V2DiscoveryReport }> {
    void opts?.signal;
    if ((sport ?? "mlb") !== "mlb") return { records: [], openingRecords: [], discovery: emptyDiscovery() };

    const response = await this.client.odds<RawOwlsOddsResponse>("mlb");
    const discovery = emptyDiscovery();
    const allowed = opts?.externalIdsFilter ? new Set(opts.externalIdsFilter) : null;
    const slateByPair = new Map<string, SharpApiSlateGame[]>();
    for (const game of opts?.slateGames ?? []) {
      const key = `${game.away}|${game.home}`;
      const rows = slateByPair.get(key) ?? [];
      rows.push(game);
      slateByPair.set(key, rows);
    }

    const inspected = inspectOwlsMlbOddsResponse(response.body, date);
    const events = inspected.events;
    discovery.eventsDiscovered = events.length;
    discovery.discoveryStats.totalRows = inspected.stats.totalRows;
    discovery.discoveryStats.skippedNonMlb = inspected.stats.nonMlb;
    discovery.discoveryStats.skippedWrongDate = inspected.stats.wrongDate;
    discovery.discoveryStats.skippedDateUnparseable = inspected.stats.dateUnparseable;
    discovery.discoveryStats.skippedTeamUnresolved = inspected.stats.teamUnresolved;

    const orderedByPair = new Map<string, RawOwlsOddsEvent[]>();
    for (const event of events) {
      const home = normalizeMlbTeamName(event.home_team);
      const away = normalizeMlbTeamName(event.away_team);
      if (!home || !away) {
        discovery.discoveryStats.skippedTeamUnresolved++;
        continue;
      }
      const key = `${away}|${home}`;
      const rows = orderedByPair.get(key) ?? [];
      rows.push(event);
      orderedByPair.set(key, rows);
    }
    for (const rows of orderedByPair.values()) {
      rows.sort((a, b) => Date.parse(timestamp(a.commence_time) ?? "") - Date.parse(timestamp(b.commence_time) ?? ""));
    }

    const candidates: Candidate[] = [];
    const resolvedEvents: Array<{ gameExternalId: number; providerEventId: string; home: MlbTeamAbbrev; away: MlbTeamAbbrev }> = [];
    for (const [pair, pairEvents] of orderedByPair.entries()) {
      const [away, home] = pair.split("|") as [MlbTeamAbbrev, MlbTeamAbbrev];
      for (let index = 0; index < pairEvents.length; index++) {
        const event = pairEvents[index]!;
        const providerEventId = text(event.eventId) ?? (event.id == null ? null : String(event.id));
        const start = timestamp(event.commence_time);
        if (!providerEventId || !start) continue;
        const slateMatch = slateByPair.get(pair)?.[index];
        const gameExternalId = slateMatch?.externalId ?? await this.resolveGame(
          "mlb",
          date,
          home,
          away,
          start,
          index + 1,
        );
        if (gameExternalId === null || (allowed && !allowed.has(gameExternalId))) {
          discovery.eventsUnresolvedTeamPair.push({ home, away });
          continue;
        }
        discovery.eventsResolvedToGame++;
        resolvedEvents.push({ gameExternalId, providerEventId, home, away });
        const eventCandidates: Candidate[] = [];
        for (const bookmaker of event.bookmakers ?? []) {
          const sportsbook = normalized(bookmaker.key ?? bookmaker.title);
          const observedAt = timestamp(bookmaker.last_update);
          if (!sportsbook || !observedAt) continue;
          for (const rawMarket of bookmaker.markets ?? []) {
            const market = MARKET[normalized(rawMarket.key)];
            if (!market) continue;
            const rows = (rawMarket.outcomes ?? []).flatMap((outcome) => {
              const name = text(outcome.name);
              const side = name ? outcomeSide(market, name, String(event.home_team), String(event.away_team)) : null;
              const american = finite(outcome.price);
              const line = market === "moneyline" ? null : finite(outcome.point);
              return side && american !== null && american !== 0 && (market === "moneyline" || line !== null)
                ? [{ gameExternalId, providerEventId, home, away, observedAt, market, side, sportsbook, line, american }]
                : [];
            });
            const expected: Side[] = market === "total" ? ["over", "under"] : ["home", "away"];
            const coherent = rows.length === 2
              && expected.every((side) => rows.filter((row) => row.side === side).length === 1)
              && (market !== "spread" || Math.abs((rows[0]?.line ?? 0) + (rows[1]?.line ?? 0)) <= 0.001)
              && (market !== "total" || Math.abs((rows[0]?.line ?? 0) - (rows[1]?.line ?? 0)) <= 0.001);
            if (coherent) eventCandidates.push(...rows);
          }
        }
        candidates.push(...eventCandidates);

        const books = [...new Set(eventCandidates.map((row) => row.sportsbook))].sort();
        const perGame: V2DiscoveryPerGame = {
          gameExternalId,
          home,
          away,
          splitsEventId: providerEventId,
          effectiveEventId: providerEventId,
          effectiveEventIds: [providerEventId],
          bucketsObserved: [providerEventId],
          bucketsFetched: [providerEventId],
          bucketsCallCapped: [],
          dedupedAcrossBuckets: 0,
          speculativeBucketsAttempted: [],
          speculativeBucketsWithRows: [],
          speculativeBucketsCallCapped: [],
          speculativeBooksRecovered: [],
          speculativeRowsRecovered: 0,
          eventIdSource: "owls_exact_match",
          oddsCallStatus: eventCandidates.length > 0 ? "ok" : "empty",
          mlRows: eventCandidates.filter((row) => row.market === "moneyline").length,
          totalRows: eventCandidates.filter((row) => row.market === "total").length,
          spreadRows: eventCandidates.filter((row) => row.market === "spread").length,
          otherRows: 0,
          books,
          mlRowsFromOdds: eventCandidates.filter((row) => row.market === "moneyline").length,
          totalRowsFromOdds: eventCandidates.filter((row) => row.market === "total").length,
          spreadRowsFromOdds: eventCandidates.filter((row) => row.market === "spread").length,
          mlRowsFromSplits: 0,
          totalRowsFromSplits: 0,
          spreadRowsFromSplits: 0,
        };
        discovery.perGame.push(perGame);
      }
    }
    discovery.discoveryStats.keptEvents = discovery.eventsResolvedToGame;

    const completePairs = new Set<string>();
    for (const candidate of candidates) {
      const pair = candidates.filter((row) => pairKey(row) === pairKey(candidate));
      if (pair.length === 2) completePairs.add(pairKey(candidate));
    }
    const accepted = candidates.filter((row) => completePairs.has(pairKey(row)));
    const pinnacleFair = new Map<string, number>();
    const pinnaclePairs = new Map<string, Candidate[]>();
    for (const row of accepted.filter((candidate) => candidate.sportsbook === "pinnacle")) {
      const key = pairKey(row);
      const pair = pinnaclePairs.get(key) ?? [];
      pair.push(row);
      pinnaclePairs.set(key, pair);
    }
    for (const pair of pinnaclePairs.values()) {
      if (pair.length !== 2) continue;
      const implied = pair.map((row) => 1 / americanToDecimal(row.american));
      const total = implied[0]! + implied[1]!;
      if (!Number.isFinite(total) || total <= 0) continue;
      pair.forEach((row, index) => pinnacleFair.set(fairKey(row), implied[index]! / total));
    }

    const records = accepted.map<LineRecord>((row) => {
      const decimal = americanToDecimal(row.american);
      const fair = pinnacleFair.get(fairKey(row)) ?? null;
      const ev = fair === null ? null : (decimal * fair - 1) * 100;
      return {
        game_external_id: row.gameExternalId,
        market_type: row.market,
        player_external_id: null,
        sportsbook: row.sportsbook,
        side: row.side,
        line_value: row.line,
        odds_american: row.american,
        odds_decimal: decimal,
        implied_probability: 1 / decimal,
        ev_percent: ev,
        fair_odds: fair === null ? null : probabilityToAmerican(fair),
        is_ev_positive: ev === null ? null : ev > 0,
        fetched_at: row.observedAt,
      };
    });
    const openingIds = new Set(opts?.openingExternalIds ?? []);
    const openingRecords: LineRecord[] = [];
    const openingEvents = resolvedEvents.filter((event) => openingIds.has(event.gameExternalId));
    discovery.apiCallsMade += openingEvents.length;
    const openingResults = await Promise.allSettled(openingEvents.map(async (event) => {
      const opening = await this.client.openingOdds<RawOwlsOpeningResponse>(event.providerEventId);
      return openingLineRecords(opening.body, event);
    }));
    openingResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        openingRecords.push(...result.value);
        return;
      }
      const event = openingEvents[index]!;
      console.warn(`Owls opening odds unavailable for ${event.providerEventId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });
    if (opts?.signal?.aborted) {
      throw opts.signal.reason ?? new Error("Owls odds refresh aborted");
    }
    return { records, openingRecords, discovery };
  }
}
