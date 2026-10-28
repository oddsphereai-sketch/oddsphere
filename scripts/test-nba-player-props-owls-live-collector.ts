import assert from "node:assert/strict";

import { collectNbaPlayerPropsLiveMarket } from "../lib/services/nba/nbaPlayerPropsLiveCollector";

const start = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
const observedAt = new Date().toISOString();
const urls: string[] = [];
const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  urls.push(url);
  if (url.includes("api.balldontlie.io/v1/games")) {
    const regular = url.includes("season_type=regular");
    return json({ data: regular ? [{
      id: 99,
      datetime: start,
      home_team: { id: 1, abbreviation: "NYK" },
      visitor_team: { id: 2, abbreviation: "BOS" },
    }] : [] });
  }
  if (url.includes("api.balldontlie.io/v2/odds/player_props")) {
    return json({ data: [{
      id: "bdl-prop",
      game_id: 99,
      player_id: 10,
      team_id: 2,
      player: { id: 10, first_name: "Test", last_name: "Player", team_id: 2 },
      vendor: "fanduel",
      prop_type: "points",
      line_value: 20.5,
      updated_at: observedAt,
      market: { type: "over_under", over_odds: -108, under_odds: -112 },
    }] });
  }
  if (url.includes("api.owlsinsight.com/api/v1/nba/props")) {
    return json({ data: [{
      gameId: "owls-game",
      commenceTime: start,
      homeTeam: "NYK",
      awayTeam: "BOS",
      isLive: false,
      books: [{
        key: "pinnacle",
        lastUpdate: observedAt,
        props: [{
          propId: "owls-prop",
          category: "points",
          playerName: "Test Player",
          team: "BOS",
          line: 20.5,
          overPrice: -105,
          underPrice: -115,
          lastUpdate: observedAt,
        }],
      }],
    }] });
  }
  throw new Error(`Unexpected provider request ${url}`);
};

async function main(): Promise<void> {
  const result = await collectNbaPlayerPropsLiveMarket({
    slateDate: start.slice(0, 10),
    ballDontLieApiKey: "bdl-test",
    theOddsApiKey: "odds-test",
    owlsInsightApiKey: "owls-test",
    includeOpenings: false,
    canonicalPlayersByName: { testplayer: "nba-bdl-player:10" },
    fetchImpl,
  });

  assert.deepEqual(result.providerRequests, { balldontlie: 3, theOddsApi: 0, owls: 1 });
  assert.equal(result.theOddsApiCreditsUsed, 0);
  assert.equal(urls.filter((url) => url.includes("api.owlsinsight.com/api/v1/nba/props")).length, 1,
    "one bounded Owl league request is permitted per collection cycle");
  assert.equal(urls.some((url) => url.includes("api.the-odds-api.com")), false,
    "the paid Odds API gap lane must stay idle when BDL plus Owl corroborate the scope");
  assert.equal(result.observations.filter((row) => row.provider === "balldontlie").length, 2);
  assert.equal(result.observations.filter((row) => row.provider === "owls").length, 2);
  assert(result.observations.every((row) => row.canonicalGameId === "nba-bdl:99"));
  assert(result.observations.filter((row) => row.provider === "owls")
    .every((row) => row.canonicalPlayerId === "nba-bdl-player:10"));
  assert.equal(result.findings.some((finding) => finding.includes("failed") || finding.includes("unmatched")), false);

  process.stdout.write("NBA player-props Owl live collector contract passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
