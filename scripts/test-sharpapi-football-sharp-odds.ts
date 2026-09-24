import assert from "node:assert/strict";
import {
  captureBooksWithSharpBooks,
  fetchSharpApiNcaafSharpOdds,
  fetchSharpApiNflSharpOdds,
  FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS,
  FOOTBALL_SHARP_PRICE_CAPTURE_MAX_PAGES_PER_BOOK,
} from "../lib/services/football/sharpApiFootballSharpOdds";

const observedAt = "2026-09-24T12:38:44.000Z";
const start = "2026-09-25T00:15:00.000Z";
const nflGame = {
  providerGameId: "nfl-1", providerWeek: 3, season: 2026, scheduledStart: start, status: "Scheduled",
  away: { id: 1, abbreviation: "ATL", name: "Atlanta Falcons" },
  home: { id: 2, abbreviation: "GB", name: "Green Bay Packers" },
};
const cfbGame = {
  providerGameId: "cfb-1", providerWeek: 4, season: 2026, scheduledStart: start, status: "Scheduled",
  awayScore: null, homeScore: null,
  away: { id: 1, conferenceId: 1, abbreviation: "LIB", name: "Liberty", fbs: true },
  home: { id: 2, conferenceId: 2, abbreviation: "CCU", name: "Coastal Carolina", fbs: true },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "football-event-1", event_start_time: start,
    home_team: "Green Bay Packers", away_team: "Atlanta Falcons",
    sportsbook: "circa", market_type: "moneyline", selection_type: "home",
    line: null, odds_american: -235, timestamp: observedAt,
    is_live: false, is_active: true, is_stale_pregame_price: false,
    is_player_prop: false, is_main_line: true, is_alternate_line: false,
    ...overrides,
  };
}

const nflRows = [
  row(), row({ selection_type: "away", odds_american: 200 }),
  row({ market_type: "point_spread", selection_type: "home", line: -5.5, odds_american: -110 }),
  row({ market_type: "point_spread", selection_type: "away", line: 5.5, odds_american: -110 }),
  row({ market_type: "total_points", selection_type: "over", line: 45.5, odds_american: -108 }),
  row({ market_type: "total_points", selection_type: "under", line: 45.5, odds_american: -112 }),
  row({ market_type: "point_spread", selection_type: "home", line: -14.5, odds_american: 300, is_main_line: false, is_alternate_line: true, timestamp: "2026-09-24T12:39:00Z" }),
  row({ is_stale_pregame_price: true, selection_type: "home", odds_american: -999 }),
  row({ home_team: "Wrong Team", selection_type: "home", odds_american: -999 }),
];

function client(pagesByBook: Record<string, unknown[][]>) {
  const queries: Array<Record<string, unknown> | undefined> = [];
  const counts = new Map<string, number>();
  return {
    queries,
    fetch: async (request: { query?: Record<string, unknown> }) => {
      queries.push(request.query);
      const sportsbook = String(request.query?.sportsbook ?? "");
      const index = counts.get(sportsbook) ?? 0;
      counts.set(sportsbook, index + 1);
      const pages = pagesByBook[sportsbook] ?? [];
      return {
        data: pages[index] ?? [],
        pagination: index < pages.length - 1
          ? { has_more: true, offset: index * 200, limit: 200, next_offset: (index + 1) * 200 }
          : { has_more: false, offset: index * 200, limit: 200 },
      };
    },
  };
}

async function main() {
const pinnacleRows = nflRows.slice(0, 6).map((value) => ({
  ...value,
  sportsbook: "pinnacle",
  odds_american: typeof value.odds_american === "number" ? value.odds_american + 2 : value.odds_american,
}));
const nflClient = client({ circa: [nflRows.slice(0, 4), nflRows.slice(4)], pinnacle: [pinnacleRows] });
const nfl = await fetchSharpApiNflSharpOdds({ games: [nflGame], client: nflClient as never });
assert.equal(nfl.requests, 3);
assert.equal(nfl.matchedGames, 1);
assert.deepEqual(nfl.failedBooks, []);
assert.deepEqual(new Set(nflClient.queries.map((query) => query?.sportsbook)), new Set(["circa", "pinnacle"]));
assert.ok(nflClient.queries.every((query) => query?.market === "main"));
assert.ok(nflClient.queries.some((query) => query?.sportsbook === "circa" && query.offset === 200));
const nflBooks = nfl.booksByGame["nfl-1"] ?? [];
assert.deepEqual(nflBooks.map((book) => book.sportsbook).sort(), ["circa", "pinnacle"]);
const nflBook = nflBooks.find((book) => book.sportsbook === "circa");
assert.ok(nflBook);
assert.equal(nflBook.provider, "sharpapi");
assert.equal(nflBook.targetEligible, false);
assert.deepEqual(nflBook.moneyline, { homePrice: -235, awayPrice: 200 });
assert.deepEqual(nflBook.spread, { homeLine: -5.5, homePrice: -110, awayLine: 5.5, awayPrice: -110 });
assert.deepEqual(nflBook.total, { line: 45.5, overPrice: -108, underPrice: -112 });

const cfbRows = nflRows.slice(0, 6).map((value) => ({
  ...value, event_id: "cfb-event-1", home_team: "COASTAL CAROLINA", away_team: "LIBERTY",
}));
const cfbPinnacleRows = cfbRows.map((value) => ({ ...value, sportsbook: "pinnacle" }));
const cfbClient = client({ circa: [cfbRows], pinnacle: [cfbPinnacleRows] });
const cfb = await fetchSharpApiNcaafSharpOdds({ games: [cfbGame], client: cfbClient as never });
assert.equal(cfb.matchedGames, 1);
assert.equal(cfb.booksByGame["cfb-1"]?.[0]?.providerEventId, "cfb-event-1");
assert.deepEqual(cfb.booksByGame["cfb-1"]?.map((book) => book.sportsbook).sort(), ["circa", "pinnacle"]);

const merged = captureBooksWithSharpBooks([
  { sportsbook: "circa", value: "old" },
  { sportsbook: "pinnacle", value: "old" },
  { sportsbook: "draftkings", value: "retained" },
], [
  { sportsbook: "Circa", value: "verified-circa" },
  { sportsbook: "Pinnacle", value: "verified-pinnacle" },
]);
assert.deepEqual(merged, [
  { sportsbook: "Circa", value: "verified-circa" },
  { sportsbook: "Pinnacle", value: "verified-pinnacle" },
  { sportsbook: "draftkings", value: "retained" },
]);

const deepQueries: Array<Record<string, unknown> | undefined> = [];
let pinnaclePage = 0;
const deepClient = {
  fetch: async (request: { query?: Record<string, unknown> }) => {
    deepQueries.push(request.query);
    if (request.query?.sportsbook === "circa") {
      return { data: [], pagination: { has_more: false, offset: 0, limit: 200 } };
    }
    const page = pinnaclePage++;
    return {
      data: Array.from({ length: 200 }, (_, index) => row({
        sportsbook: "pinnacle",
        event_id: `deep-${page}-${index}`,
      })),
      pagination: page < 3 ? {
        has_more: true,
        offset: page * 200,
        limit: 200,
        next_offset: page < 2 ? (page + 1) * 200 : null,
        next_cursor: `cursor-${page + 1}`,
      } : { has_more: false, offset: 600, limit: 200 },
    };
  },
};
const deep = await fetchSharpApiNflSharpOdds({ games: [], client: deepClient as never });
assert.equal(deep.requests, 5);
assert.equal(deep.rows, 800);
assert.deepEqual(deep.failedBooks, []);
assert.ok(deepQueries.some((query) => query?.cursor === "cursor-3"),
  "deep pagination must switch to the provider cursor before the offset ceiling");

const cappedClient = {
  fetch: async () => ({ data: [row()], pagination: { has_more: true, offset: 0, limit: 200 } }),
};
const capped = await fetchSharpApiNflSharpOdds({ games: [nflGame], client: cappedClient as never });
assert.deepEqual(capped.failedBooks, [...FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS]);
assert.equal(capped.requests, FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS.length * FOOTBALL_SHARP_PRICE_CAPTURE_MAX_PAGES_PER_BOOK);
assert.deepEqual(capped.booksByGame["nfl-1"], []);
assert.equal(FOOTBALL_SHARP_PRICE_CAPTURE_MAX_PAGES_PER_BOOK, 12);

console.log("SharpAPI football sharp-book capture tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
