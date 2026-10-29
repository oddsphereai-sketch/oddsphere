import assert from "node:assert/strict";

import { fetchNbaBdlRetailOdds } from "../lib/services/nba/balldontlieNbaRetailOdds";

const requests: URL[] = [];
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  requests.push(url);
  assert.equal(new Headers(init?.headers).get("Authorization"), "test-key");
  if (url.pathname === "/v1/games") {
    return Response.json({
      data: [{
        id: 21717987,
        datetime: "2026-10-30T00:00:00.000Z",
        home_team: { full_name: "Atlanta Hawks", abbreviation: "ATL" },
        visitor_team: { full_name: "Cleveland Cavaliers", abbreviation: "CLE" },
      }],
      meta: { per_page: 100 },
    });
  }
  if (url.pathname === "/v2/odds") {
    return Response.json({
      data: [{
        game_id: 21717987,
        vendor: "draftkings",
        spread_home_value: "-1.5",
        spread_home_odds: -105,
        spread_away_value: "1.5",
        spread_away_odds: -115,
        moneyline_home_odds: -115,
        moneyline_away_odds: -105,
        total_value: "237.5",
        total_over_odds: -112,
        total_under_odds: -108,
        updated_at: "2026-10-29T11:35:00.482Z",
      }, {
        game_id: 21717987,
        vendor: "kalshi",
        moneyline_home_odds: -110,
        moneyline_away_odds: -110,
        updated_at: "2026-10-29T11:35:00.482Z",
      }],
      meta: { per_page: 100 },
    });
  }
  return new Response("not found", { status: 404 });
};

async function main(): Promise<void> {
  const result = await fetchNbaBdlRetailOdds({
    slateDate: "2026-10-29",
    apiKey: "test-key",
    fetchImpl: fakeFetch,
  });
  assert.equal(result.requests, 2);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0]?.providerGameId, 21717987);
  assert.equal(result.quotes.length, 6, "one complete retail book must yield all three two-sided markets");
  assert.deepEqual([...new Set(result.quotes.map((quote) => quote.sportsbook))], ["draftkings"]);
  assert.equal(result.quotes.find((quote) => quote.market === "spread" && quote.side === "home")?.line, -1.5);
  assert.ok(requests.every((url) => url.searchParams.get("dates[]") === "2026-10-29"));
  assert.ok(requests.every((url) => url.searchParams.get("per_page") === "100"));

  await assert.rejects(
    fetchNbaBdlRetailOdds({ slateDate: "20261029", apiKey: "test-key", fetchImpl: fakeFetch }),
    /YYYY-MM-DD/,
  );

  console.log("NBA BALLDONTLIE retail-odds tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
