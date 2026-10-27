import assert from "node:assert/strict";
import {
  normalizeOwlsSharpBookOdds,
  type RawOwlsOddsResponse,
} from "../lib/providers/owls/owlsSharpBookOdds";

const response: RawOwlsOddsResponse = {
  success: true,
  data: {
    pinnacle: [{
      id: "123",
      eventId: "nba:Detroit Pistons@New York Knicks-20261028",
      sport: "nba",
      league: "NBA",
      commence_time: "2026-10-28T00:10:00Z",
      away_team: "Detroit Pistons",
      home_team: "New York Knicks",
      bookmakers: [{
        key: "pinnacle",
        title: "Pinnacle",
        last_update: "2026-10-27T22:16:46.884Z",
        markets: [
          { key: "h2h", outcomes: [{ name: "New York Knicks", price: -163 }, { name: "Detroit Pistons", price: 150 }] },
          { key: "spreads", outcomes: [{ name: "New York Knicks", price: -106, point: -4 }, { name: "Detroit Pistons", price: -104, point: 4 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -106, point: 219.5 }, { name: "Under", price: -106, point: 219.5 }] },
        ],
      }],
    }],
    circa: [{
      id: "123",
      eventId: "nba:Detroit Pistons@New York Knicks-20261028",
      sport: "nba",
      league: "NBA",
      commence_time: "2026-10-28T00:10:00Z",
      away_team: "Detroit Pistons",
      home_team: "New York Knicks",
      bookmakers: [{
        key: "circa",
        title: "Circa Sports",
        last_update: "2026-10-27T22:17:16.758Z",
        markets: [
          { key: "spreads", outcomes: [{ name: "Detroit Pistons", price: -110, point: 4 }, { name: "New York Knicks", price: -110, point: -4 }] },
          { key: "h2h", outcomes: [{ name: "Detroit Pistons", price: 145 }, { name: "New York Knicks", price: -165 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -110, point: 219.5 }, { name: "Under", price: -110, point: 219.5 }] },
        ],
      }],
    }],
    fanduel: [{
      id: "123",
      eventId: "nba:Detroit Pistons@New York Knicks-20261028",
      sport: "nba",
      away_team: "Detroit Pistons",
      home_team: "New York Knicks",
      bookmakers: [{ key: "fanduel", last_update: "2026-10-27T22:17:00Z", markets: [] }],
    }],
  },
};

const coverage = normalizeOwlsSharpBookOdds(response, "nba");
assert.equal(coverage.eventsReturned, 3);
assert.equal(coverage.matchedBookEvents, 2);
assert.equal(coverage.prices.length, 12, "two books x three markets x two sides");
assert.deepEqual(new Set(coverage.prices.map((row) => row.sportsbook)), new Set(["circa", "pinnacle"]));
assert.equal(coverage.rejected.length, 0);

const circaSpread = coverage.prices.filter((row) => row.sportsbook === "circa" && row.market === "spread");
assert.deepEqual(circaSpread.map((row) => [row.side, row.line, row.americanPrice]), [
  ["away", 4, -110],
  ["home", -4, -110],
]);
assert.ok(Math.abs(circaSpread.reduce((sum, row) => sum + row.noVigProbability, 0) - 1) < 1e-12);
assert.equal(circaSpread[0]?.observedAt, "2026-10-27T22:17:16.758Z");

const pinnacleMoneyline = coverage.prices.filter((row) => row.sportsbook === "pinnacle" && row.market === "moneyline");
assert.deepEqual(pinnacleMoneyline.map((row) => [row.side, row.line, row.americanPrice]), [
  ["home", null, -163],
  ["away", null, 150],
]);
assert.ok(pinnacleMoneyline.every((row) => row.decimalPrice > 1));

const incoherent = structuredClone(response);
const circaEvent = !Array.isArray(incoherent.data) ? incoherent.data?.circa?.[0] : null;
const spread = circaEvent?.bookmakers?.[0]?.markets?.find((market) => market.key === "spreads");
if (spread?.outcomes?.[1]) spread.outcomes[1].point = -3.5;
const rejected = normalizeOwlsSharpBookOdds(incoherent, "nba");
assert.equal(rejected.prices.filter((row) => row.sportsbook === "circa" && row.market === "spread").length, 0);
assert.ok(rejected.rejected.some((row) => row.reason === "incomplete or incoherent spread pair"));

const wrongSport = normalizeOwlsSharpBookOdds(response, "nfl");
assert.equal(wrongSport.prices.length, 0);
assert.equal(wrongSport.rejected.length, 3);

console.log("Owls sharp-book odds normalizer tests passed.");

