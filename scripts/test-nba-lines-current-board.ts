import assert from "node:assert/strict";

import {
  __NBA_LINES_TEST__,
  fetchNbaCurrentEvents,
  fetchNbaCurrentOddsBoard,
} from "../lib/services/nba/refreshNbaLinesService";

const requested: string[] = [];
const pages = new Map<string, number>();

const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  requested.push(url.toString());
  const market = url.searchParams.get("market_type") ?? "";
  const page = pages.get(market) ?? 0;
  pages.set(market, page + 1);
  const hasMore = market === "moneyline" && page === 0;
  return new Response(JSON.stringify({
    data: [{
      event_id: `${market}-${page}`,
      market_type: market,
      sportsbook: "pinnacle",
      home_team: "Boston Celtics",
      away_team: "New York Knicks",
    }],
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? "next moneyline page" : null,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

async function main(): Promise<void> {
  const rows = await fetchNbaCurrentOddsBoard("test-key", () => {}, fakeFetch);

  assert.equal(rows.length, 4, "three markets plus the second moneyline page must be returned");
  assert.deepEqual(
    [...pages.entries()],
    [["moneyline", 2], ["point_spread", 1], ["total_points", 1]],
    "each canonical NBA game market must use independent cursor pagination",
  );
  assert.ok(requested.every((url) => !new URL(url).searchParams.has("date")), "unsupported date filter must never be sent");
  assert.equal(
    new URL(requested[1]!).searchParams.get("cursor"),
    "next moneyline page",
    "next_cursor must be passed verbatim through URL encoding",
  );
  assert.ok(requested.every((url) => new URL(url).searchParams.get("league") === "nba"));

  const events = await fetchNbaCurrentEvents("test-key", () => {}, async (input) => {
    const url = new URL(String(input));
    const second = url.searchParams.has("cursor");
    return new Response(JSON.stringify({
      data: [{ id: second ? "event-2" : "event-1" }],
      pagination: { has_more: !second, next_cursor: second ? null : "events next" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(events.map((event) => event.id), ["event-1", "event-2"]);

  const targetedRequests: string[] = [];
  const targeted = await fetchNbaCurrentOddsBoard("test-key", () => {}, async (input) => {
    targetedRequests.push(String(input));
    return new Response(JSON.stringify({ data: [], pagination: { has_more: false } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, ["nba-celtics-knicks"]);
  assert.deepEqual(targeted, []);
  assert.equal(targetedRequests.length, 3);
  assert.ok(targetedRequests.every((url) =>
    new URL(url).searchParams.get("event_id") === "nba-celtics-knicks"));

  const storedGames = [{
    id: 140080,
    external_id: 401909842,
    home_team_id: 807,
    away_team_id: 820,
    game_date: "2026-10-22T02:30:00Z",
  }];
  const storedTeams = new Map([
    [807, { id: 807, display_name: "LA Clippers", abbreviation: "LAC" }],
    [820, { id: 820, display_name: "Sacramento Kings", abbreviation: "SAC" }],
  ]);
  assert.deepEqual(
    __NBA_LINES_TEST__.eventIdsForGames([{
      id: "nba_clippers_kings_2026-10-21_b3",
      away_team: "Sacramento Kings",
      home_team: "Los Angeles Clippers",
      event_start_time: "2026-10-22T02:30:00Z",
    }], storedGames, storedTeams),
    ["nba_clippers_kings_2026-10-21_b3"],
    "the exact NBA alias registry must match Los Angeles Clippers to stored LA Clippers",
  );
  assert.equal(
    __NBA_LINES_TEST__.normalizeSide(undefined, "Los Angeles Clippers", "LA Clippers", "Sacramento Kings"),
    "home",
    "selection aliases must retain the correct home/away orientation",
  );

  console.log("NBA current-board odds fetch tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
