import {
  NBA_PLAYER_PROPS_OBSERVATION_RELEASE,
  type NbaPlayerPropMarket,
  type NbaPlayerPropPriceObservation,
  type NbaPlayerPropsProviderNormalization,
} from "./nbaPlayerPropsContract";

const BALLDONTLIE_MARKETS: Record<string, NbaPlayerPropMarket> = {
  assists: "assists",
  assists_1q: "assists_q1",
  blocks: "blocks",
  double_double: "double_double",
  points: "points",
  points_1q: "points_q1",
  points_assists: "points_assists",
  points_rebounds: "points_rebounds",
  points_rebounds_assists: "points_rebounds_assists",
  rebounds: "rebounds",
  rebounds_1q: "rebounds_q1",
  rebounds_assists: "rebounds_assists",
  steals: "steals",
  threes: "threes",
  triple_double: "triple_double",
};

const THE_ODDS_API_MARKETS: Record<string, NbaPlayerPropMarket> = {
  player_points: "points",
  player_points_q1: "points_q1",
  player_rebounds: "rebounds",
  player_rebounds_q1: "rebounds_q1",
  player_assists: "assists",
  player_assists_q1: "assists_q1",
  player_threes: "threes",
  player_blocks: "blocks",
  player_steals: "steals",
  player_blocks_steals: "blocks_steals",
  player_turnovers: "turnovers",
  player_points_rebounds_assists: "points_rebounds_assists",
  player_points_rebounds: "points_rebounds",
  player_points_assists: "points_assists",
  player_rebounds_assists: "rebounds_assists",
  player_field_goals: "field_goals",
  player_frees_made: "free_throws_made",
  player_frees_attempts: "free_throws_attempted",
  player_double_double: "double_double",
  player_triple_double: "triple_double",
};

type EventIdentity = {
  canonicalGameId: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string;
};

export function normalizeBallDontLieNbaPlayerProps(args: {
  values: readonly unknown[];
  fetchedAt: string;
  opening?: boolean;
  events?: Readonly<Record<string, EventIdentity>>;
  canonicalPlayers?: Readonly<Record<string, string>>;
}): NbaPlayerPropsProviderNormalization {
  const rows: NbaPlayerPropPriceObservation[] = [];
  const unknownMarkets = new Map<string, number>();
  let rejectedRows = 0;
  for (const value of args.values) {
    const row = object(value);
    const providerMarket = string(row?.prop_type);
    const market = providerMarket ? BALLDONTLIE_MARKETS[providerMarket] : undefined;
    if (providerMarket && !market) unknownMarkets.set(providerMarket, (unknownMarkets.get(providerMarket) ?? 0) + 1);
    const providerEventId = id(row?.game_id);
    const providerPlayerId = id(row?.player_id);
    const player = object(row?.player);
    const playerTeam = object(player?.team);
    const playerName = [string(player?.first_name), string(player?.last_name)].filter(Boolean).join(" ") || null;
    const playerTeamIdentity = id(row?.team_id) ?? id(player?.team_id) ?? id(playerTeam?.id);
    const sportsbook = string(row?.vendor)?.toLowerCase() ?? null;
    const line = finite(row?.line_value);
    const marketObject = object(row?.market);
    const offerType = string(marketObject?.type);
    const observedAt = string(args.opening ? row?.opened_at : row?.updated_at);
    const observationId = id(row?.id);
    if (!market || !providerEventId || !providerPlayerId || !sportsbook || line === null || !marketObject
      || !observedAt || !observationId || (offerType !== "over_under" && offerType !== "milestone")) {
      rejectedRows += 1;
      continue;
    }
    const accepted = {
      providerEventId,
      providerPlayerId,
      sportsbook,
      market,
      providerMarket: providerMarket as string,
      offerType: offerType as "over_under" | "milestone",
      line,
      observedAt,
      observationId,
    };
    const event = args.events?.[providerEventId] ?? null;
    if (offerType === "over_under") {
      const over = american(marketObject.over_odds);
      const under = american(marketObject.under_odds);
      if (over === null || under === null) {
        rejectedRows += 1;
        continue;
      }
      rows.push(
        observation("over", over),
        observation("under", under),
      );
    } else {
      const yes = american(marketObject.odds);
      if (yes === null) {
        rejectedRows += 1;
        continue;
      }
      rows.push(observation("yes", yes));
    }

    function observation(side: "over" | "under" | "yes", price: number): NbaPlayerPropPriceObservation {
      return {
        release: NBA_PLAYER_PROPS_OBSERVATION_RELEASE,
        provider: "balldontlie",
        providerObservationId: `${accepted.observationId}:${side}`,
        providerEventId: accepted.providerEventId,
        canonicalGameId: event?.canonicalGameId ?? null,
        canonicalPlayerId: args.canonicalPlayers?.[accepted.providerPlayerId] ?? null,
        providerPlayerId: accepted.providerPlayerId,
        playerName,
        playerTeam: playerTeamIdentity,
        sportsbook: accepted.sportsbook,
        market: accepted.market,
        providerMarket: accepted.providerMarket,
        offerType: accepted.offerType,
        side,
        line: accepted.line,
        americanPrice: price,
        observedAt: new Date(Date.parse(accepted.observedAt)).toISOString(),
        fetchedAt: iso(args.fetchedAt),
        isOpening: args.opening === true,
        isLive: false,
        homeTeam: event?.homeTeam ?? null,
        awayTeam: event?.awayTeam ?? null,
        scheduledStart: event?.scheduledStart ?? null,
      };
    }
  }
  return {
    rows: dedupe(rows),
    inputRows: args.values.length,
    rejectedRows,
    unknownMarkets: Object.fromEntries([...unknownMarkets.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function normalizeTheOddsApiNbaPlayerProps(args: {
  events: readonly unknown[];
  fetchedAt: string;
  canonicalGames?: Readonly<Record<string, string>>;
  canonicalPlayers?: Readonly<Record<string, string>>;
  opening?: boolean;
}): NbaPlayerPropsProviderNormalization {
  const rows: NbaPlayerPropPriceObservation[] = [];
  const unknownMarkets = new Map<string, number>();
  let inputRows = 0;
  let rejectedRows = 0;
  for (const eventValue of args.events) {
    const event = object(eventValue);
    const providerEventId = id(event?.id);
    const scheduledStart = string(event?.commence_time);
    const homeTeam = string(event?.home_team);
    const awayTeam = string(event?.away_team);
    const isLive = scheduledStart ? Date.parse(scheduledStart) <= Date.parse(args.fetchedAt) : false;
    for (const bookValue of array(event?.bookmakers)) {
      const book = object(bookValue);
      const sportsbook = string(book?.key)?.toLowerCase() ?? string(book?.title)?.toLowerCase() ?? null;
      for (const marketValue of array(book?.markets)) {
        const marketObject = object(marketValue);
        const providerMarket = string(marketObject?.key);
        const market = providerMarket ? THE_ODDS_API_MARKETS[providerMarket] : undefined;
        if (providerMarket && !market) unknownMarkets.set(providerMarket, (unknownMarkets.get(providerMarket) ?? 0) + 1);
        const observedAt = string(marketObject?.last_update) ?? string(book?.last_update) ?? args.fetchedAt;
        for (const outcomeValue of array(marketObject?.outcomes)) {
          inputRows += 1;
          const outcome = object(outcomeValue);
          const side = normalizeSide(outcome?.name);
          const playerName = string(outcome?.description);
          const line = finite(outcome?.point);
          const price = american(outcome?.price);
          if (!providerEventId || !sportsbook || !market || !providerMarket || !side || !playerName
            || line === null || price === null || !scheduledStart) {
            rejectedRows += 1;
            continue;
          }
          const offerType = side === "yes" || side === "no" ? "milestone" : "over_under";
          rows.push({
            release: NBA_PLAYER_PROPS_OBSERVATION_RELEASE,
            provider: "the_odds_api",
            providerObservationId: [providerEventId, sportsbook, providerMarket, normalizeName(playerName), line, side, observedAt].join(":"),
            providerEventId,
            canonicalGameId: args.canonicalGames?.[providerEventId] ?? null,
            canonicalPlayerId: args.canonicalPlayers?.[normalizeName(playerName)] ?? null,
            providerPlayerId: null,
            playerName,
            playerTeam: null,
            sportsbook,
            market,
            providerMarket,
            offerType,
            side,
            line,
            americanPrice: price,
            observedAt: iso(observedAt),
            fetchedAt: iso(args.fetchedAt),
            isOpening: args.opening === true,
            isLive,
            homeTeam,
            awayTeam,
            scheduledStart: iso(scheduledStart),
          });
        }
      }
    }
  }
  return {
    rows: dedupe(rows),
    inputRows,
    rejectedRows,
    unknownMarkets: Object.fromEntries([...unknownMarkets.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function dedupe(rows: readonly NbaPlayerPropPriceObservation[]): NbaPlayerPropPriceObservation[] {
  return [...new Map(rows.map((row) => [
    [row.provider, row.providerObservationId, row.side].join("|"),
    row,
  ])).values()];
}

function normalizeSide(value: unknown): "over" | "under" | "yes" | "no" | null {
  const normalized = string(value)?.toLowerCase();
  return normalized === "over" || normalized === "under" || normalized === "yes" || normalized === "no"
    ? normalized
    : null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function id(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return string(value);
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function american(value: unknown): number | null {
  const number = finite(value);
  return number !== null && Number.isInteger(number) && number !== 0 ? number : null;
}

function iso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`NBA props received invalid timestamp ${value}.`);
  return new Date(parsed).toISOString();
}
