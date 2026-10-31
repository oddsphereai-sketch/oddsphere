import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CurrentSoccerMarketProvider,
  THE_ODDS_API_SOCCER_CREDIT_RESERVE,
  __TEST__,
} from "../lib/providers/real_api/CurrentSoccerMarketProvider";
import type { RawOwlsOddsResponse } from "../lib/providers/owls/owlsSharpBookOdds";
import { eplClubNamesMatch, uclClubNamesMatch } from "../lib/providers/real_api/soccerClubIdentity";

const kickoff = "2026-10-31T15:00:00.000Z";
const now = () => new Date("2026-10-28T02:00:00.000Z");

function owlsPayload(): RawOwlsOddsResponse {
  return {
    success: true,
    data: {
      pinnacle: [{
        id: "1638676646",
        eventId: "soccer:Brighton@Manchester City-20261031",
        sport: "soccer",
        league: "England - Premier League",
        commence_time: kickoff,
        home_team: "Manchester City",
        away_team: "Brighton",
        bookmakers: [{
          key: "pinnacle",
          title: "Pinnacle",
          last_update: "2026-10-28T01:59:50.000Z",
          markets: [
            { key: "h2h", outcomes: [
              { name: "Manchester City", price: -160 },
              { name: "Brighton", price: 387 },
              { name: "Draw", price: 362 },
            ] },
            { key: "totals", outcomes: [
              { name: "Over", price: -110, point: 2.5 },
              { name: "Under", price: -102, point: 2.5 },
            ] },
          ],
        }],
      }],
    },
  };
}

function theOddsEvent(partialDoubleChance = false) {
  return {
    id: "the-odds-epl-1",
    commence_time: kickoff,
    home_team: "Manchester City",
    away_team: "Brighton",
    bookmakers: [{
      key: "pinnacle",
      title: "Pinnacle",
      last_update: "2026-10-28T01:59:55.000Z",
      markets: [
        { key: "double_chance", outcomes: [
          { name: "Manchester City or Draw", price: -310 },
          { name: "Brighton or Draw", price: 135 },
          ...(!partialDoubleChance ? [{ name: "Manchester City or Brighton", price: -450 }] : []),
        ] },
        { key: "btts", outcomes: [
          { name: "Yes", price: -125 },
          { name: "No", price: 105 },
        ] },
      ],
    }],
  };
}

const fixture = { home: "Manchester City", away: "Brighton", kickoff, providerId: 77 };
assert.equal(eplClubNamesMatch("Manchester City", "Man City"), true);
assert.equal(eplClubNamesMatch("", "Manchester City"), false);
assert.equal(uclClubNamesMatch("Internazionale Milano", "Inter Milan"), true);
assert.equal(uclClubNamesMatch("Inter", "Inter Club d’Escaldes"), false);
assert.equal(uclClubNamesMatch("Bodø/Glimt", "Bodo/Glimt"), true);
assert.equal(uclClubNamesMatch("Feyenoord Rotterdam", "Feyenoord"), true);
assert.equal(uclClubNamesMatch("Feyenoord", "Feyenoord Academy"), false);
assert.equal(uclClubNamesMatch("Man Utd", "Manchester United"), true);
assert.equal(uclClubNamesMatch("Como", "Calcio Como 1907"), true);
assert.equal(uclClubNamesMatch("Como", "Como Women"), false);
const owls = __TEST__.normalizeOwlsFixture(owlsPayload(), "epl", fixture, now().getTime());
assert.equal(__TEST__.completeMarket(owls.rows, "match_result"), true);
assert.equal(__TEST__.completeMarket(owls.rows, "total"), true);
assert.equal(__TEST__.completeMarket(owls.rows, "btts"), false);
assert.deepEqual(new Set(owls.rows.map((row) => row.provider)), new Set(["owls"]));
assert.equal(owls.rows.filter((row) => row.market === "match_result").length, 3);
const completeOwlsPayload = owlsPayload();
const completeOwlsEvent = Array.isArray(completeOwlsPayload.data)
  ? completeOwlsPayload.data[0] : completeOwlsPayload.data?.pinnacle?.[0];
assert.ok(completeOwlsEvent?.bookmakers?.[0]);
completeOwlsEvent.bookmakers[0].markets!.push(...theOddsEvent().bookmakers[0]!.markets);
const completeOwls = __TEST__.normalizeOwlsFixture(completeOwlsPayload, "epl", fixture, now().getTime());
assert.equal(__TEST__.completeMarket(completeOwls.rows, "double_chance"), true);
assert.equal(__TEST__.completeMarket(completeOwls.rows, "btts"), true);
assert.equal(completeOwls.rows.find((row) => row.market === "btts" && row.selection === "yes")?.odds_american, -125);
assert.ok(completeOwls.rows.every((row) => row.provider === "owls" && row.fetched_at === "2026-10-28T01:59:50.000Z"));
assert.equal(__TEST__.completeMarket(completeOwls.rows.filter((row) => row.selection !== "no"), "btts"), false);
assert.equal(__TEST__.normalizeOwlsFixture(completeOwlsPayload, "epl", { ...fixture, home: fixture.away, away: fixture.home }, now().getTime()).rows.length, 0);
assert.equal(__TEST__.normalizeOwlsFixture(completeOwlsPayload, "epl", { ...fixture, kickoff: "2026-11-07T15:00:00.000Z" }, now().getTime()).rows.length, 0);
const staleOwlsPayload = owlsPayload();
const staleEvent = Array.isArray(staleOwlsPayload.data) ? staleOwlsPayload.data[0] : staleOwlsPayload.data?.pinnacle?.[0];
if (staleEvent?.bookmakers?.[0]) staleEvent.bookmakers[0].last_update = "2026-10-28T01:00:00.000Z";
assert.equal(__TEST__.normalizeOwlsFixture(staleOwlsPayload, "epl", fixture, now().getTime()).rows.length, 0);

const supplemental = __TEST__.normalizeTheOddsFixture(theOddsEvent(), ["double_chance", "btts"]);
assert.equal(__TEST__.completeMarket(supplemental, "double_chance"), true);
assert.equal(__TEST__.completeMarket(supplemental, "btts"), true);
assert.deepEqual(new Set(supplemental.map((row) => row.provider)), new Set(["the_odds_api"]));
assert.equal(__TEST__.completeMarket(__TEST__.normalizeTheOddsFixture(theOddsEvent(true), ["double_chance"]), "double_chance"), false);

function fetchHarness(args: { remaining?: number; event?: ReturnType<typeof theOddsEvent>; reverseCatalog?: boolean; duplicateCatalog?: boolean }) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.searchParams.get("markets") ?? ""}`);
    if (url.hostname === "api.owlsinsight.com") {
      return new Response(JSON.stringify(owlsPayload()), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.endsWith("/events")) {
      const event = theOddsEvent();
      const catalogEvent = {
        id: event.id,
        commence_time: event.commence_time,
        home_team: args.reverseCatalog ? event.away_team : event.home_team,
        away_team: args.reverseCatalog ? event.home_team : event.away_team,
      };
      return new Response(JSON.stringify(args.duplicateCatalog
        ? [catalogEvent, { ...catalogEvent, id: `${event.id}-duplicate` }]
        : [catalogEvent]), {
        status: 200,
        headers: { "content-type": "application/json", "x-requests-remaining": String(args.remaining ?? 5_000) },
      });
    }
    return new Response(JSON.stringify(args.event ?? theOddsEvent()), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-requests-last": "2",
        "x-requests-remaining": String((args.remaining ?? 5_000) - 2),
      },
    });
  };
  return { calls, fetchImpl };
}

async function main(): Promise<void> {
{
  const harness = fetchHarness({});
  const provider = new CurrentSoccerMarketProvider({
    competition: "epl",
    owlsApiKey: "owls-test",
    theOddsApiKey: "odds-test",
    now,
    fetchImpl: harness.fetchImpl,
  });
  const result = await provider.loadFixture(fixture);
  for (const market of ["match_result", "double_chance", "total", "btts"] as const) {
    assert.equal(__TEST__.completeMarket(result.odds, market), true, `${market} should be complete`);
  }
  assert.equal(provider.telemetry().owlsRequests, 1);
  assert.equal(provider.telemetry().theOddsApiCatalogRequests, 1);
  assert.equal(provider.telemetry().theOddsApiPaidRequests, 1);
  assert.equal(provider.telemetry().theOddsApiCreditsUsed, 2);
  assert.equal(harness.calls.filter((call) => call.includes("/v4/") && call.includes("/odds?")).length, 1);
  await provider.loadFixture(fixture);
  assert.equal(provider.telemetry().theOddsApiPaidRequests, 1, "fixture cache prevents duplicate paid recovery calls");
}

{
  const stored = supplemental.map((row) => ({
    providerId: fixture.providerId,
    market: row.market,
    side: row.selection,
    line: row.line,
    american: row.odds_american!,
    sportsbook: row.sportsbook,
    recordedAt: "2026-10-28T01:58:00.000Z",
    isOpener: false,
  }));
  const harness = fetchHarness({});
  const provider = new CurrentSoccerMarketProvider({
    competition: "epl",
    owlsApiKey: "owls-test",
    theOddsApiKey: "odds-test",
    storedPriceHistory: stored,
    now,
    fetchImpl: harness.fetchImpl,
  });
  const result = await provider.loadFixture(fixture);
  assert.equal(__TEST__.completeMarket(result.odds, "double_chance"), true);
  assert.equal(__TEST__.completeMarket(result.odds, "btts"), true);
  assert.equal(provider.telemetry().theOddsApiCatalogRequests, 0);
  assert.equal(provider.telemetry().theOddsApiPaidRequests, 0);
  assert.equal(result.odds.filter((row) => row.provider === "stored_quote").every((row) => row.persistable === false), true);
  assert.equal(__TEST__.freshStoredRows({
    history: stored.map((row) => ({ ...row, recordedAt: "2026-10-27T18:00:00.000Z" })),
    providerId: fixture.providerId,
    market: "btts",
    kickoff,
    nowMs: now().getTime(),
  }).length, 0, "stored quotes outside the kickoff cadence are rejected");
}

{
  const harness = fetchHarness({ reverseCatalog: true });
  const provider = new CurrentSoccerMarketProvider({ competition: "epl", owlsApiKey: "owls-test", theOddsApiKey: "odds-test", now, fetchImpl: harness.fetchImpl });
  const result = await provider.loadFixture(fixture);
  assert.equal(__TEST__.completeMarket(result.odds, "btts"), false);
  assert.deepEqual(provider.telemetry().paidRequestHolds, ["event_not_published"]);
  assert.equal(provider.telemetry().theOddsApiPaidRequests, 0);
}

{
  const harness = fetchHarness({ duplicateCatalog: true });
  const provider = new CurrentSoccerMarketProvider({ competition: "epl", owlsApiKey: "owls-test", theOddsApiKey: "odds-test", now, fetchImpl: harness.fetchImpl });
  const result = await provider.loadFixture(fixture);
  assert.equal(__TEST__.completeMarket(result.odds, "btts"), false);
  assert.deepEqual(provider.telemetry().paidRequestHolds, ["ambiguous_event_identity"]);
  assert.equal(provider.telemetry().theOddsApiPaidRequests, 0);
}

{
  const harness = fetchHarness({});
  const provider = new CurrentSoccerMarketProvider({ competition: "epl", owlsApiKey: "owls-test", now, fetchImpl: harness.fetchImpl });
  const result = await provider.loadFixture(fixture);
  assert.equal(__TEST__.completeMarket(result.odds, "btts"), false);
  assert.deepEqual(provider.telemetry().paidRequestHolds, ["api_key_unavailable"]);
  assert.equal(provider.telemetry().theOddsApiCatalogRequests, 0);
  assert.equal(provider.telemetry().theOddsApiPaidRequests, 0);
}

{
  const harness = fetchHarness({ remaining: THE_ODDS_API_SOCCER_CREDIT_RESERVE + 1 });
  const provider = new CurrentSoccerMarketProvider({ competition: "epl", owlsApiKey: "owls-test", theOddsApiKey: "odds-test", now, fetchImpl: harness.fetchImpl });
  const result = await provider.loadFixture(fixture);
  assert.equal(__TEST__.completeMarket(result.odds, "double_chance"), false);
  assert.deepEqual(provider.telemetry().paidRequestHolds, ["credit_reserve"]);
  assert.equal(provider.telemetry().theOddsApiPaidRequests, 0);
}

const eplBuilderSource = readFileSync("lib/services/epl/buildEplDailyEdgePreview.ts", "utf8");
const uclBuilderSource = readFileSync("lib/services/ucl/buildUclDailyEdgePreview.ts", "utf8");
const eplRouteSource = readFileSync("app/api/cron/epl-daily-refresh/route.ts", "utf8");
const uclRouteSource = readFileSync("app/api/cron/ucl-daily-refresh/route.ts", "utf8");
assert.doesNotMatch(eplBuilderSource, /SHARPAPI_KEY|new SharpApiEplMarketProvider/);
assert.doesNotMatch(uclBuilderSource, /SHARPAPI_KEY|new SharpApiUclMarketProvider/);
assert.match(eplBuilderSource, /options\.forceCurrentProviderRefresh \? undefined : previewCache\.get/);
assert.match(eplRouteSource, /const apply = !providerProbe &&/);
assert.match(uclRouteSource, /const apply = !providerProbe &&/);
assert.match(uclRouteSource, /const publication = apply && flags\.publication/);

console.log("soccer current market provider tests passed");
}

void main();
