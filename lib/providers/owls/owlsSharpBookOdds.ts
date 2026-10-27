import type {
  MarketIntelligenceMarketType,
  MarketIntelligenceSelectionSide,
} from "../../types/domain/MarketIntelligenceV2";
import type { OwlsSport } from "./owlsInsightClient";

export const OWLS_SHARP_ODDS_BOOKS = ["circa", "pinnacle"] as const;

export type OwlsSharpOddsBook = typeof OWLS_SHARP_ODDS_BOOKS[number];

type RawOwlsOddsOutcome = {
  name?: string | null;
  price?: number | string | null;
  point?: number | string | null;
};

type RawOwlsOddsMarket = {
  key?: string | null;
  outcomes?: RawOwlsOddsOutcome[] | null;
};

type RawOwlsBookmaker = {
  key?: string | null;
  title?: string | null;
  last_update?: string | null;
  markets?: RawOwlsOddsMarket[] | null;
};

export type RawOwlsOddsEvent = {
  id?: string | number | null;
  eventId?: string | null;
  sport?: string | null;
  league?: string | null;
  commence_time?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  bookmakers?: RawOwlsBookmaker[] | null;
};

export type RawOwlsOddsResponse = {
  success?: boolean;
  data?: Record<string, RawOwlsOddsEvent[] | null> | RawOwlsOddsEvent[] | null;
  meta?: Record<string, unknown> | null;
};

export type NormalizedOwlsSharpPrice = {
  sport: OwlsSport;
  providerEventId: string;
  providerNumericEventId: string | null;
  scheduledStart: string | null;
  homeTeam: string;
  awayTeam: string;
  sportsbook: OwlsSharpOddsBook;
  observedAt: string;
  market: MarketIntelligenceMarketType;
  side: MarketIntelligenceSelectionSide;
  line: number | null;
  americanPrice: number;
  decimalPrice: number;
  noVigProbability: number;
};

export type OwlsSharpOddsCoverage = {
  eventsReturned: number;
  matchedBookEvents: number;
  prices: NormalizedOwlsSharpPrice[];
  rejected: Array<{ providerEventId: string | null; sportsbook: string | null; reason: string }>;
};

const MARKET_KEYS: Record<string, MarketIntelligenceMarketType | undefined> = {
  h2h: "moneyline",
  spreads: "spread",
  totals: "total",
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  const parsed = text(value);
  return parsed && Number.isFinite(Date.parse(parsed)) ? new Date(parsed).toISOString() : null;
}

function americanToDecimal(price: number): number {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function sideForOutcome(
  market: MarketIntelligenceMarketType,
  outcomeName: string,
  homeTeam: string,
  awayTeam: string,
): MarketIntelligenceSelectionSide | null {
  if (market === "total") {
    const side = normalized(outcomeName);
    return side === "over" ? "over" : side === "under" ? "under" : null;
  }
  const side = normalized(outcomeName);
  if (side === normalized(homeTeam)) return "home";
  if (side === normalized(awayTeam)) return "away";
  return null;
}

function eventRows(response: RawOwlsOddsResponse): RawOwlsOddsEvent[] {
  if (Array.isArray(response.data)) return response.data;
  if (!response.data || typeof response.data !== "object") return [];
  return Object.values(response.data).flatMap((rows) => Array.isArray(rows) ? rows : []);
}

function book(value: unknown): OwlsSharpOddsBook | null {
  const key = normalized(value);
  return OWLS_SHARP_ODDS_BOOKS.find((candidate) => candidate === key) ?? null;
}

/**
 * Converts Owls' Odds-API-compatible current feed into complete two-sided
 * Circa/Pinnacle observations. A malformed or one-sided market is rejected as
 * a unit so it cannot look like a coherent price pair downstream.
 */
export function normalizeOwlsSharpBookOdds(
  response: RawOwlsOddsResponse,
  expectedSport: OwlsSport,
): OwlsSharpOddsCoverage {
  const rows = eventRows(response);
  const prices: NormalizedOwlsSharpPrice[] = [];
  const rejected: OwlsSharpOddsCoverage["rejected"] = [];
  let matchedBookEvents = 0;

  for (const event of rows) {
    const providerEventId = text(event.eventId) ?? (event.id === null || event.id === undefined ? null : String(event.id));
    const homeTeam = text(event.home_team);
    const awayTeam = text(event.away_team);
    if (!providerEventId || !homeTeam || !awayTeam) {
      rejected.push({ providerEventId, sportsbook: null, reason: "missing event identity" });
      continue;
    }
    const eventSport = normalized(event.sport ?? event.league);
    if (eventSport && eventSport !== normalized(expectedSport)) {
      rejected.push({ providerEventId, sportsbook: null, reason: `wrong sport ${eventSport}` });
      continue;
    }

    for (const bookmaker of event.bookmakers ?? []) {
      const sportsbook = book(bookmaker.key ?? bookmaker.title);
      if (!sportsbook) continue;
      const observedAt = iso(bookmaker.last_update);
      if (!observedAt) {
        rejected.push({ providerEventId, sportsbook, reason: "missing provider timestamp" });
        continue;
      }
      matchedBookEvents++;

      for (const rawMarket of bookmaker.markets ?? []) {
        const market = MARKET_KEYS[normalized(rawMarket.key)];
        if (!market) continue;
        const outcomes = (rawMarket.outcomes ?? []).flatMap((outcome) => {
          const name = text(outcome.name);
          const price = finite(outcome.price);
          const side = name ? sideForOutcome(market, name, homeTeam, awayTeam) : null;
          const line = market === "moneyline" ? null : finite(outcome.point);
          return name && side && price !== null && price !== 0 && (market === "moneyline" || line !== null)
            ? [{ side, line, price }]
            : [];
        });
        const requiredSides: readonly MarketIntelligenceSelectionSide[] = market === "total"
          ? ["over", "under"]
          : ["home", "away"];
        if (
          outcomes.length !== 2 ||
          requiredSides.some((side) => outcomes.filter((outcome) => outcome.side === side).length !== 1) ||
          (market === "spread" && Math.abs((outcomes[0]?.line ?? 0) + (outcomes[1]?.line ?? 0)) > 0.001) ||
          (market === "total" && Math.abs((outcomes[0]?.line ?? 0) - (outcomes[1]?.line ?? 0)) > 0.001)
        ) {
          rejected.push({ providerEventId, sportsbook, reason: `incomplete or incoherent ${market} pair` });
          continue;
        }

        const implied = outcomes.map((outcome) => 1 / americanToDecimal(outcome.price));
        const overround = implied.reduce((sum, value) => sum + value, 0);
        if (!Number.isFinite(overround) || overround <= 0) {
          rejected.push({ providerEventId, sportsbook, reason: `invalid ${market} price pair` });
          continue;
        }
        outcomes.forEach((outcome, index) => {
          prices.push({
            sport: expectedSport,
            providerEventId,
            providerNumericEventId: event.id === null || event.id === undefined ? null : String(event.id),
            scheduledStart: iso(event.commence_time),
            homeTeam,
            awayTeam,
            sportsbook,
            observedAt,
            market,
            side: outcome.side,
            line: outcome.line,
            americanPrice: outcome.price,
            decimalPrice: americanToDecimal(outcome.price),
            noVigProbability: implied[index]! / overround,
          });
        });
      }
    }
  }

  return { eventsReturned: rows.length, matchedBookEvents, prices, rejected };
}

