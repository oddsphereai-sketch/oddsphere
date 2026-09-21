import {
  NFL_PLAYER_PROPS_RESEARCH_MARKETS,
  type NflPlayerPropMarket,
  type NflPlayerPropPriceObservation,
  type NflPlayerPropsProviderNormalization,
} from "./nflPlayerPropsContract";

type Json = Record<string, unknown>;

const MARKET_SET = new Set<string>(NFL_PLAYER_PROPS_RESEARCH_MARKETS);

const MARKET_ALIASES: Record<string, NflPlayerPropMarket> = {
  pass_attempts: "passing_attempts",
  player_pass_attempts: "passing_attempts",
  player_passing_attempts: "passing_attempts",
  pass_completions: "passing_completions",
  player_pass_completions: "passing_completions",
  player_passing_completions: "passing_completions",
  player_pass_yards: "passing_yards",
  player_passing_yards: "passing_yards",
  rush_attempts: "rushing_attempts",
  player_rush_attempts: "rushing_attempts",
  player_rushing_attempts: "rushing_attempts",
  player_total_rush_attempts: "rushing_attempts",
  player_rush_yards: "rushing_yards",
  player_rushing_yards: "rushing_yards",
  player_receptions: "receptions",
  player_total_receptions: "receptions",
  player_receiving_yards: "receiving_yards",
  pass_touchdowns: "passing_tds",
  player_pass_touchdowns: "passing_tds",
  player_passing_touchdowns: "passing_tds",
  player_interceptions: "interceptions",
  player_rush_reception_yards: "rushing_receiving_yards",
  player_rushing_receiving_yards: "rushing_receiving_yards",
  "player_rushing_+_receiving_yards": "rushing_receiving_yards",
  player_touchdowns: "touchdowns",
  player_anytime_touchdown: "anytime_td",
  player_anytime_td: "anytime_td",
  player_first_touchdown: "first_td",
  player_first_td: "first_td",
  player_longest_pass: "longest_pass",
  player_longest_reception: "longest_reception",
  player_longest_rush: "longest_rush",
  player_field_goals_made: "fg_made",
  player_kicking_points: "kicking_points",
};

export function canonicalNflPlayerPropMarket(value: unknown): NflPlayerPropMarket | null {
  const normalized = text(value)?.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_") ?? null;
  if (!normalized) return null;
  if (MARKET_SET.has(normalized)) return normalized as NflPlayerPropMarket;
  return MARKET_ALIASES[normalized] ?? null;
}

export function normalizeBalldontlieNflPlayerProps(args: {
  values: unknown[];
  fetchedAt: string;
  opening?: boolean;
}): NflPlayerPropsProviderNormalization {
  const rows: NflPlayerPropPriceObservation[] = [];
  const unknownMarkets = new Map<string, number>();
  const semanticallyRejected = misclassifiedFanDuelReceivingRows(args.values);
  let rejectedRows = 0;
  for (const [index, value] of args.values.entries()) {
    if (semanticallyRejected.has(index)) {
      rejectedRows += 1;
      continue;
    }
    const row = object(value);
    const marketRaw = text(row.prop_type);
    const market = canonicalNflPlayerPropMarket(marketRaw);
    if (!market) {
      if (marketRaw) unknownMarkets.set(marketRaw, (unknownMarkets.get(marketRaw) ?? 0) + 1);
      rejectedRows += 1;
      continue;
    }
    const observationId = textOrNumber(row.id);
    const eventId = textOrNumber(row.game_id);
    const playerId = textOrNumber(row.player_id);
    const sportsbook = text(row.vendor)?.toLowerCase() ?? null;
    const line = number(row.line_value);
    const marketObject = object(row.market);
    const offerType = text(marketObject.type) === "milestone" ? "milestone" : "over_under";
    const observedAt = iso(args.opening ? row.opened_at : row.updated_at);
    if (!observationId || !eventId || !sportsbook || line === null || !observedAt) {
      rejectedRows += 1;
      continue;
    }
    if (offerType === "over_under") {
      const over = americanPrice(marketObject.over_odds);
      const under = americanPrice(marketObject.under_odds);
      if (over === null || under === null) {
        rejectedRows += 1;
        continue;
      }
      rows.push(
        baseBdlRow({ observationId, eventId, playerId, sportsbook, market, marketRaw: marketRaw!, line, observedAt, fetchedAt: args.fetchedAt, opening: args.opening === true, side: "over", price: over, offerType }),
        baseBdlRow({ observationId, eventId, playerId, sportsbook, market, marketRaw: marketRaw!, line, observedAt, fetchedAt: args.fetchedAt, opening: args.opening === true, side: "under", price: under, offerType }),
      );
    } else {
      const price = americanPrice(marketObject.odds);
      if (price === null) {
        rejectedRows += 1;
        continue;
      }
      rows.push(baseBdlRow({ observationId, eventId, playerId, sportsbook, market, marketRaw: marketRaw!, line, observedAt, fetchedAt: args.fetchedAt, opening: args.opening === true, side: "yes", price, offerType }));
    }
  }
  return result(args.values.length, rows, rejectedRows, unknownMarkets);
}

/**
 * BALLDONTLIE can expose FanDuel rushing-plus-receiving offers under the
 * ordinary receiving-yard provider label. Reject only rows whose target-
 * excluded cross-book family identity proves that mismatch. This operates on
 * the already-fetched payload and therefore adds no provider calls.
 */
function misclassifiedFanDuelReceivingRows(values: unknown[]): Set<number> {
  type IndexedLine = {
    index: number;
    eventId: string;
    playerId: string;
    sportsbook: string;
    market: NflPlayerPropMarket;
    line: number;
  };
  const indexed = values.flatMap((value, index): IndexedLine[] => {
    const row = object(value);
    const market = canonicalNflPlayerPropMarket(row.prop_type);
    const marketObject = object(row.market);
    const eventId = textOrNumber(row.game_id);
    const playerId = textOrNumber(row.player_id);
    const sportsbook = text(row.vendor)?.toLowerCase() ?? null;
    const line = number(row.line_value);
    if ((market !== "receiving_yards" && market !== "rushing_receiving_yards")
      || text(marketObject.type) !== "over_under"
      || !eventId || !playerId || !sportsbook || line === null) return [];
    return [{ index, eventId, playerId, sportsbook, market, line }];
  });
  const byPlayer = new Map<string, IndexedLine[]>();
  for (const row of indexed) {
    const key = `${row.eventId}|${row.playerId}`;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), row]);
  }
  const rejected = new Set<number>();
  for (const rows of byPlayer.values()) {
    for (const candidate of rows) {
      if (candidate.sportsbook !== "fanduel" || candidate.market !== "receiving_yards") continue;
      const receiving = sportsbookMedianLines(rows, candidate, "receiving_yards");
      const combined = sportsbookMedianLines(rows, candidate, "rushing_receiving_yards");
      if (receiving.length < 2 || combined.length < 1) continue;
      const receivingDistance = Math.abs(candidate.line - median(receiving));
      const combinedDistance = Math.abs(candidate.line - median(combined));
      if (receivingDistance >= 10 && combinedDistance <= 3 && receivingDistance >= combinedDistance + 7) {
        rejected.add(candidate.index);
      }
    }
  }
  return rejected;
}

function sportsbookMedianLines(
  rows: Array<{ sportsbook: string; market: NflPlayerPropMarket; line: number }>,
  candidate: { sportsbook: string },
  market: NflPlayerPropMarket,
): number[] {
  const bySportsbook = new Map<string, number[]>();
  for (const row of rows) {
    if (row.sportsbook === candidate.sportsbook || row.market !== market) continue;
    bySportsbook.set(row.sportsbook, [...(bySportsbook.get(row.sportsbook) ?? []), row.line]);
  }
  return [...bySportsbook.values()].map(median);
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

export function normalizeSharpNflPlayerProps(args: {
  values: unknown[];
  fetchedAt: string;
}): NflPlayerPropsProviderNormalization {
  const rows: NflPlayerPropPriceObservation[] = [];
  const unknownMarkets = new Map<string, number>();
  let rejectedRows = 0;
  for (const value of args.values) {
    const row = object(value);
    if ((text(row.league)?.toLowerCase() ?? "nfl") !== "nfl" || row.is_live === true) {
      rejectedRows += 1;
      continue;
    }
    const marketRaw = text(row.market_type);
    const market = canonicalNflPlayerPropMarket(marketRaw);
    if (!market) {
      if (marketRaw) unknownMarkets.set(marketRaw, (unknownMarkets.get(marketRaw) ?? 0) + 1);
      rejectedRows += 1;
      continue;
    }
    const observationId = textOrNumber(row.id);
    const eventId = textOrNumber(row.event_id);
    const sportsbook = text(row.sportsbook)?.toLowerCase() ?? null;
    const playerName = text(row.player_name);
    const playerId = textOrNumber(object(row.player_ref).id ?? row.player_id);
    const sideRaw = text(row.selection_type ?? row.selection)?.toLowerCase();
    const side = sideRaw === "over" || sideRaw === "under" || sideRaw === "yes" ? sideRaw : null;
    const line = number(row.line);
    const price = americanPrice(row.odds_american);
    const observedAt = iso(row.timestamp);
    if (!observationId || !eventId || !sportsbook || (!playerName && !playerId) || !side || line === null || price === null || !observedAt) {
      rejectedRows += 1;
      continue;
    }
    rows.push({
      provider: "sharpapi",
      providerObservationId: observationId,
      providerEventId: eventId,
      canonicalGameId: null,
      providerPlayerId: playerId,
      playerName,
      playerTeam: text(object(row.player_ref).team_abbreviation ?? row.player_team),
      sportsbook,
      market,
      providerMarket: marketRaw!,
      offerType: side === "yes" ? "milestone" : "over_under",
      side,
      line,
      americanPrice: price,
      observedAt,
      fetchedAt: args.fetchedAt,
      isOpening: false,
      isLive: false,
      homeTeam: text(row.home_team),
      awayTeam: text(row.away_team),
      scheduledStart: iso(row.event_start_time),
    });
  }
  return result(args.values.length, rows, rejectedRows, unknownMarkets);
}

function baseBdlRow(args: {
  observationId: string;
  eventId: string;
  playerId: string | null;
  sportsbook: string;
  market: NflPlayerPropMarket;
  marketRaw: string;
  line: number;
  observedAt: string;
  fetchedAt: string;
  opening: boolean;
  side: "over" | "under" | "yes";
  price: number;
  offerType: "over_under" | "milestone";
}): NflPlayerPropPriceObservation {
  return {
    provider: "balldontlie",
    providerObservationId: `${args.observationId}:${args.side}`,
    providerEventId: args.eventId,
    canonicalGameId: args.eventId,
    providerPlayerId: args.playerId,
    playerName: null,
    playerTeam: null,
    sportsbook: args.sportsbook,
    market: args.market,
    providerMarket: args.marketRaw,
    offerType: args.offerType,
    side: args.side,
    line: args.line,
    americanPrice: args.price,
    observedAt: args.observedAt,
    fetchedAt: args.fetchedAt,
    isOpening: args.opening,
    isLive: false,
    homeTeam: null,
    awayTeam: null,
    scheduledStart: null,
  };
}

function result(
  inputRows: number,
  rows: NflPlayerPropPriceObservation[],
  rejectedRows: number,
  unknownMarkets: Map<string, number>,
): NflPlayerPropsProviderNormalization {
  return {
    rows,
    inputRows,
    rejectedRows,
    unknownMarkets: Object.fromEntries([...unknownMarkets.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textOrNumber(value: unknown): string | null {
  return text(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : null);
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function americanPrice(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && parsed !== 0 && Number.isInteger(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export const __NFL_PLAYER_PROPS_PROVIDERS_TEST__ = {
  MARKET_ALIASES,
};
