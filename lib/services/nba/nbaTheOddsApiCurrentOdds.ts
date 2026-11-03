import { isNbaConsumerRetailSportsbook } from "./nbaMarketSourceEligibility";

export const NBA_THE_ODDS_API_CURRENT_RELEASE =
  "nba_the_odds_api_current_2026_11_03_r1_bounded_board_fallback" as const;

const SPORT_KEY = "basketball_nba";
const BOOKMAKERS = [
  "fanduel",
  "draftkings",
  "betmgm",
  "betrivers",
  "williamhill_us",
  "fanatics",
  "hardrockbet",
  "bet365",
] as const;
const BOOK_ALIASES: Readonly<Record<string, string>> = {
  williamhill_us: "caesars",
};
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4_000_000;

type Json = Record<string, unknown>;

export type NbaTheOddsApiCurrentQuote = {
  providerEventId: string;
  scheduledStart: string;
  homeTeam: string;
  awayTeam: string;
  sportsbook: string;
  observedAt: string;
  market: "moneyline" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  line: number | null;
  americanPrice: number;
};

export type NbaTheOddsApiCurrentBoard = {
  release: typeof NBA_THE_ODDS_API_CURRENT_RELEASE;
  requests: 1;
  creditsUsed: number;
  creditsRemaining: number | null;
  eventsReturned: number;
  quotes: NbaTheOddsApiCurrentQuote[];
};

function record(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  return raw !== null && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

function nonnegativeInteger(value: string | null): number | null {
  const parsed = value === null ? NaN : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizedTeam(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeBook(value: unknown): string | null {
  const raw = text(value)?.toLowerCase() ?? null;
  if (raw === null) return null;
  const canonical = BOOK_ALIASES[raw] ?? raw;
  return isNbaConsumerRetailSportsbook(canonical) ? canonical : null;
}

function marketType(value: unknown): NbaTheOddsApiCurrentQuote["market"] | null {
  if (value === "h2h") return "moneyline";
  if (value === "spreads") return "spread";
  if (value === "totals") return "total";
  return null;
}

function outcomeSide(args: {
  market: NbaTheOddsApiCurrentQuote["market"];
  name: string;
  homeTeam: string;
  awayTeam: string;
}): NbaTheOddsApiCurrentQuote["side"] | null {
  if (args.market === "total") {
    const side = args.name.toLowerCase();
    return side === "over" ? "over" : side === "under" ? "under" : null;
  }
  const selection = normalizedTeam(args.name);
  if (selection === normalizedTeam(args.homeTeam)) return "home";
  if (selection === normalizedTeam(args.awayTeam)) return "away";
  return null;
}

export function parseNbaTheOddsApiCurrentBoard(
  value: unknown,
  headers: Pick<Headers, "get"> = new Headers(),
): NbaTheOddsApiCurrentBoard {
  if (!Array.isArray(value)) throw new Error("The Odds API NBA current board must be an array.");
  const quotes: NbaTheOddsApiCurrentQuote[] = [];
  for (const rawEvent of value) {
    const event = record(rawEvent);
    const providerEventId = text(event?.id);
    const scheduledStart = timestamp(event?.commence_time);
    const homeTeam = text(event?.home_team);
    const awayTeam = text(event?.away_team);
    if (!event || !providerEventId || !scheduledStart || !homeTeam || !awayTeam) continue;
    for (const rawBook of array(event.bookmakers)) {
      const book = record(rawBook);
      const sportsbook = normalizeBook(book?.key);
      const observedAt = timestamp(book?.last_update);
      if (!book || !sportsbook || !observedAt) continue;
      for (const rawMarket of array(book.markets)) {
        const market = record(rawMarket);
        const normalizedMarket = marketType(market?.key);
        if (!market || !normalizedMarket) continue;
        for (const rawOutcome of array(market.outcomes)) {
          const outcome = record(rawOutcome);
          const name = text(outcome?.name);
          const price = finite(outcome?.price);
          const side = name ? outcomeSide({ market: normalizedMarket, name, homeTeam, awayTeam }) : null;
          const line = normalizedMarket === "moneyline" ? null : finite(outcome?.point);
          if (!outcome || !side || price === null || price === 0 || (normalizedMarket !== "moneyline" && line === null)) continue;
          quotes.push({
            providerEventId,
            scheduledStart,
            homeTeam,
            awayTeam,
            sportsbook,
            observedAt,
            market: normalizedMarket,
            side,
            line,
            americanPrice: Math.round(price),
          });
        }
      }
    }
  }
  return {
    release: NBA_THE_ODDS_API_CURRENT_RELEASE,
    requests: 1,
    creditsUsed: nonnegativeInteger(headers.get("x-requests-last")) ?? 3,
    creditsRemaining: nonnegativeInteger(headers.get("x-requests-remaining")),
    eventsReturned: value.length,
    quotes,
  };
}

export async function fetchNbaTheOddsApiCurrentBoard(args: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<NbaTheOddsApiCurrentBoard> {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds`);
  url.searchParams.set("apiKey", args.apiKey);
  url.searchParams.set("bookmakers", BOOKMAKERS.join(","));
  url.searchParams.set("markets", "h2h,spreads,totals");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");
  const response = await (args.fetchImpl ?? fetch)(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("The Odds API NBA current board exceeded the response-size limit.");
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("The Odds API NBA current board exceeded the response-size limit.");
  }
  if (!response.ok) throw new Error(`The Odds API NBA current board failed (${response.status}): ${raw.slice(0, 160)}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The Odds API NBA current board returned invalid JSON.");
  }
  return parseNbaTheOddsApiCurrentBoard(parsed, response.headers);
}

export const __NBA_THE_ODDS_API_CURRENT_TEST__ = { BOOKMAKERS };
