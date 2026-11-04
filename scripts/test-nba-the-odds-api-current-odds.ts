import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  fetchNbaTheOddsApiCurrentBoard,
  nbaTheOddsApiSafeDiagnosticError,
  parseNbaTheOddsApiCurrentBoard,
} from "../lib/services/nba/nbaTheOddsApiCurrentOdds";

const fixture = [{
  id: "event-1",
  commence_time: "2026-11-05T00:00:00Z",
  home_team: "Detroit Pistons",
  away_team: "Philadelphia 76ers",
  bookmakers: [{
    key: "williamhill_us",
    last_update: "2026-11-03T12:00:00Z",
    markets: [
      { key: "h2h", outcomes: [{ name: "Detroit Pistons", price: -135 }, { name: "Philadelphia 76ers", price: 115 }] },
      { key: "spreads", outcomes: [{ name: "Detroit Pistons", price: -110, point: -2.5 }, { name: "Philadelphia 76ers", price: -110, point: 2.5 }] },
      { key: "totals", outcomes: [{ name: "Over", price: -108, point: 226.5 }, { name: "Under", price: -112, point: 226.5 }] },
    ],
  }, {
    key: "unapproved_book",
    last_update: "2026-11-03T12:00:00Z",
    markets: [{ key: "h2h", outcomes: [{ name: "Detroit Pistons", price: -130 }, { name: "Philadelphia 76ers", price: 110 }] }],
  }],
}];

async function main() {
  const parsed = parseNbaTheOddsApiCurrentBoard(fixture, new Headers({
    "x-requests-last": "3",
    "x-requests-remaining": "997",
  }));
  assert.equal(parsed.eventsReturned, 1);
  assert.equal(parsed.quotes.length, 6);
  assert.equal(parsed.creditsUsed, 3);
  assert.equal(parsed.creditsRemaining, 997);
  assert.ok(parsed.quotes.every((quote) => quote.sportsbook === "caesars"));
  assert.deepEqual(parsed.quotes.map((quote) => [quote.market, quote.side, quote.line]), [
    ["moneyline", "home", null], ["moneyline", "away", null],
    ["spread", "home", -2.5], ["spread", "away", 2.5],
    ["total", "over", 226.5], ["total", "under", 226.5],
  ]);

  assert.equal(nbaTheOddsApiSafeDiagnosticError("failed apiKey=test-secret test-secret", "test-secret"), "failed apiKey=[redacted] [redacted]");
  assert.equal(nbaTheOddsApiSafeDiagnosticError(null, "test-secret"), null);
  assert.equal(nbaTheOddsApiSafeDiagnosticError("x".repeat(1000), null)?.length, 400);
  let unauthorizedCalls = 0;
  for (const apiKey of [undefined, "", "   "]) {
    await assert.rejects(fetchNbaTheOddsApiCurrentBoard({ apiKey: apiKey as unknown as string,
      fetchImpl: async () => { unauthorizedCalls++; throw new Error("network must not be called"); } }),
    /requires a configured API key; no request was made/);
  }
  assert.equal(unauthorizedCalls, 0, "a keyless audit cannot masquerade as an invalid account/key response");
  const longSecret = "secret-" + "z".repeat(220);
  await assert.rejects(fetchNbaTheOddsApiCurrentBoard({ apiKey: longSecret,
    fetchImpl: async () => new Response(`key=${longSecret}`, { status: 401 }) }),
  error => error instanceof Error && error.message.includes("[redacted]") && !error.message.includes("secret-"),
  "HTTP error text is redacted before truncation or propagation to any writer warning");
  await assert.rejects(fetchNbaTheOddsApiCurrentBoard({ apiKey: "test+secret",
    fetchImpl: async () => { throw new Error("failed https://example.test?apiKey=test%2Bsecret"); } }),
  error => error instanceof Error && error.message.includes("[redacted]") && !error.message.includes("test%2Bsecret"),
  "network errors cannot leak query credentials into shared diagnostics or caller logs");
  let requested = "";
  const fetched = await fetchNbaTheOddsApiCurrentBoard({
    apiKey: "test-key",
    fetchImpl: async (input) => {
      requested = String(input);
      return new Response(JSON.stringify(fixture), { status: 200, headers: {
        "content-type": "application/json", "x-requests-last": "3", "x-requests-remaining": "997",
      } });
    },
  });
  assert.equal(fetched.quotes.length, 6);
  const requestedUrl = new URL(requested);
  assert.equal(requestedUrl.searchParams.get("markets"), "h2h,spreads,totals");
  assert.equal(requestedUrl.searchParams.get("apiKey"), "test-key");
  assert.equal(requestedUrl.searchParams.has("regions"), false, "explicit eight-book request must consume one region-equivalent, not multiple regions");

  const route = readFileSync(new URL("../app/api/cron/nba-daily-refresh/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/fetchNbaTheOddsApiCurrentBoard\(\{ apiKey: theOddsApiKey \}\)/g) ?? []).length, 1);
  assert.match(route, /getTheOddsApiCurrentBoard,/);
  assert.match(route, /theOddsApiCurrentPromise \?\?=/);
  assert.match(route, /nba_daily_refresh_schedule_2026_11_04_r24_paid_consumer_book_coverage/);

  const splitSource = readFileSync(new URL("../lib/providers/real_api/sharpApiCurrentSplits.ts", import.meta.url), "utf8");
  assert.match(splitSource, /revalidateTag\("owls-current-splits", \{ expire: 0 \}\)/);

  console.log("NBA bounded The Odds API current-board fallback tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
