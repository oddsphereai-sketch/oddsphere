import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectNflPlayerPropsObservations } from "../lib/services/football/nflPlayerPropsCollector";

const calls: Array<{ url: string; authorization: string | null }> = [];
const fetchImpl: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  calls.push({ url: url.toString(), authorization: new Headers(init?.headers).get("authorization") });
  if (url.hostname === "api.balldontlie.io" && url.pathname.endsWith("/games")) {
    return json({ data: [{
      id: 424129,
      season: 2026,
      week: 9,
      date: "2026-10-30T00:15:00Z",
      home_team: { abbreviation: "GB", full_name: "Green Bay Packers" },
      visitor_team: { abbreviation: "CAR", full_name: "Carolina Panthers" },
    }], meta: { next_cursor: null } });
  }
  if (url.hostname === "api.balldontlie.io" && url.pathname.endsWith("/odds/player_props")) {
    return json({ data: [{
      id: 100,
      game_id: 424129,
      player_id: 500,
      vendor: "draftkings",
      prop_type: "passing_yards",
      line_value: "245.5",
      market: { type: "over_under", over_odds: -110, under_odds: -110 },
      updated_at: "2026-10-28T03:19:00Z",
    }], meta: { next_cursor: null } });
  }
  if (url.hostname === "api.balldontlie.io" && url.pathname.endsWith("/players")) {
    return json({ data: [{ id: 500, first_name: "Test", last_name: "Quarterback", team: { abbreviation: "GB" } }], meta: { next_cursor: null } });
  }
  if (url.hostname === "api.owlsinsight.com" && url.pathname === "/api/v1/nfl/props") {
    return json({ success: true, data: [{
      gameId: "nfl:Carolina Panthers@Green Bay Packers-20261030",
      sport: "nfl",
      homeTeam: "Green Bay Packers",
      awayTeam: "Carolina Panthers",
      commenceTime: "2026-10-30T00:15:00Z",
      isLive: false,
      books: [{
        key: "novig",
        title: "NoVig",
        lastUpdate: "2026-10-28T03:20:00Z",
        props: [{ playerName: "Test Quarterback", category: "passing_yards", line: 245.5, overPrice: -104, underPrice: -127, lastUpdate: "2026-10-28T03:20:04Z" }],
      }],
    }] });
  }
  throw new Error(`unexpected request ${url}`);
};

async function main(): Promise<void> {
const result = await collectNflPlayerPropsObservations({
  season: 2026,
  week: 9,
  phase: "regular",
  includeOpenings: false,
  ballDontLieApiKey: "bdl-test",
  owlsInsightApiKey: "owls-test",
  includeReferenceResearch: true,
  fetchImpl,
});

assert.equal(calls.filter((call) => call.url.includes("api.owlsinsight.com")).length, 1);
assert.equal(calls.find((call) => call.url.includes("api.owlsinsight.com"))?.authorization, "Bearer owls-test");
assert.equal(calls.some((call) => /sharpapi/i.test(call.url)), false, "active collection must make zero Sharp API requests");
assert.deepEqual(result.snapshot.providerRequests, { balldontlie: 3, owls: 1 });
assert.equal(result.snapshot.collectionComplete, true);
assert.equal(result.normalization.owls.rows.length, 2);
assert.equal(result.referenceResearchObservations.length, 2);
assert.ok(result.referenceResearchObservations.every((row) => row.provider === "owls" && row.canonicalGameId === "424129"));
assert.equal(result.snapshot.healthFindings.some((finding) => /SHARPAPI/.test(finding)), false);
const routeSource = readFileSync("app/api/cron/nfl-forward-evidence/route.ts", "utf8");
assert.match(routeSource, /owlsInsightApiKey:\s*owlsApiKey/);
const writerSource = readFileSync("lib/services/football/nflPlayerPropsProductionWriter.ts", "utf8");
const collectorSource = readFileSync("lib/services/football/nflPlayerPropsCollector.ts", "utf8");
assert.doesNotMatch(`${writerSource}\n${collectorSource}`, /SHARPAPI_KEY|new SharpApiClient|sharpApiKey/,
  "the active player-props writer and collector must not retain a Sharp API dependency");

console.log("NFL player-props Owls provider: all focused tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
