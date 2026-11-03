import assert from "node:assert/strict";
import { CurrentSoccerMarketProvider, __TEST__, type StoredSoccerPriceObservation } from "@/lib/providers/real_api/CurrentSoccerMarketProvider";
import type { RawOwlsOddsEvent, RawOwlsOddsResponse } from "@/lib/providers/owls/owlsSharpBookOdds";
import { applyUclStoredQuoteFallback } from "@/lib/services/ucl/uclStoredQuoteFallback";
import {uclClubNamesMatch,eplClubNamesMatch} from "@/lib/providers/real_api/soccerClubIdentity";

assert.equal(uclClubNamesMatch("LASK", "LASK Linz"),true);
assert.equal(uclClubNamesMatch("RC Lens", "Lens"),true);
assert.equal(uclClubNamesMatch("Racing Club de Lens", "Lens"),true);
assert.equal(uclClubNamesMatch("LASK Amateure", "LASK Linz"),false);
assert.equal(uclClubNamesMatch("Lens B", "RC Lens"),false);
assert.equal(uclClubNamesMatch("LASK", "Slovan Bratislava"),false);
assert.equal(eplClubNamesMatch("Lens B", "RC Lens"),false,"EPL default behavior remains untouched");

const fixture = { providerId: 4243843, home: "LASK Linz", away: "Slovan Bratislava", kickoff: "2026-11-03T20:00:00.000Z" };
const eventId = "soccer:Slovan Bratislava@LASK Linz-20261103";
const at = (clock: string) => `2026-11-03T${clock}:00.000Z`;
const btts = (yes = -200, no: number | null = 150, stamp = at("16:00")) => ({ key: "btts", last_update: stamp,
  outcomes: [{ name: "Yes", price: yes }, ...(no === null ? [] : [{ name: "No", price: no }])] });
const response = (markets: NonNullable<NonNullable<RawOwlsOddsEvent["bookmakers"]>[number]["markets"]> = [btts()],
  stamp = at("16:00")): Omit<RawOwlsOddsResponse, "data"> & { data: RawOwlsOddsEvent[] } => ({ success: true, data: [{
  eventId, league: "UEFA - Champions League", sport: "soccer", home_team: fixture.home, away_team: fixture.away,
  commence_time: fixture.kickoff, bookmakers: [{ key: "draftkings", last_update: stamp, markets }],
}] });
const stored = (side: string, american: number, recordedAt = at("15:50")): StoredSoccerPriceObservation => ({
  providerId: fixture.providerId, market: "btts", side, line: null, american, sportsbook: "draftkings", recordedAt, isOpener: false,
});
async function load(input: {
  body: RawOwlsOddsResponse; start?: string; received?: string; history?: StoredSoccerPriceObservation[];
}) {
  let clock = Date.parse(input.start ?? at("16:01"));
  let mockCalls = 0;
  const provider = new CurrentSoccerMarketProvider({ competition: "ucl", owlsApiKey: "mock-only",
    storedPriceHistory: input.history, now: () => new Date(clock),
    fetchImpl: (async () => { mockCalls++; clock = Date.parse(input.received ?? at("16:01"));
      return new Response(JSON.stringify(input.body), { status: 200 }); }) as typeof fetch,
  });
  const value = await provider.loadFixture(fixture);
  return { value, mockCalls, provider };
}

async function main() {
// A quote updated during the request is historical by receipt time, not future.
const insideAwait = await load({ start: "2026-11-03T15:59:59.000Z", received: "2026-11-03T16:00:04.000Z",
  body: response([btts(-180, 140, "2026-11-03T16:00:02.000Z")], "2026-11-03T16:00:02.000Z") });
assert.equal(insideAwait.value.odds.length, 2);
assert.ok(insideAwait.value.odds.every(row => row.fetched_at === "2026-11-03T16:00:02.000Z"),
  "receipt-time validation never rewrites original source timestamps");
assert.equal(insideAwait.mockCalls, 1);
const trulyFuture = await load({ received: at("16:01"), body: response([btts(-180, 140, at("16:02"))], at("16:02")) });
assert.equal(trulyFuture.value.odds.length, 0);
const agedDuringAwait = await load({ start: at("16:00"), received: "2026-11-03T16:00:04.000Z",
  body: response([btts(-180, 140, "2026-11-03T15:30:02.000Z")], "2026-11-03T15:30:02.000Z") });
assert.equal(agedDuringAwait.value.odds.length, 0, "freshness uses actual receipt time after a slow response");

const history = [stored("yes", -180), stored("no", 140)];
const historyBefore = JSON.stringify(history);
const partial = await load({ body: response([btts(-200, null)]), history });
assert.deepEqual(partial.value.odds.map(row => [row.selection, row.odds_american, row.provider, row.fetched_at]), [
  ["yes", -180, "stored_quote", at("15:50")], ["no", 140, "stored_quote", at("15:50")],
], "a partial new Yes cannot be joined to an old No; use the intact stored family only");
assert.ok(partial.value.odds.every(row => row.persistable === false && row.provider_event_id === null));
assert.equal(partial.value.fixtureEventIdentities?.length, 0, "stored fallback grants no native forecast ownership");
assert.equal(JSON.stringify(history), historyBefore);
const complete = await load({ body: response(), history });
assert.deepEqual(complete.value.odds.map(row => [row.selection, row.odds_american, row.provider]), [
  ["yes", -200, "owls"], ["no", 150, "owls"],
], "an intact native family takes precedence over stored availability");

const noCurrent: RawOwlsOddsResponse = { success: true, data: [] };
const crossedStored = await load({ body: noCurrent, history: [stored("yes", -180), stored("no", 140, at("15:55"))] });
assert.equal(crossedStored.value.odds.length, 0, "sides recorded at different captures are not one stored pair");
const futureStored = await load({ body: noCurrent,
  history: [stored("yes", -180, at("16:02")), stored("no", 140, at("16:02"))] });
assert.equal(futureStored.value.odds.length, 0);
const conflictStored = await load({ body: noCurrent, history: [...history, stored("yes", -190)] });
assert.equal(conflictStored.value.odds.length, 0, "same-capture conflicting prices are quarantined");
const wrongGame = await load({ body: noCurrent, history: history.map(row => ({ ...row, providerId: 1 })) });
assert.equal(wrongGame.value.odds.length, 0);

// The final UCL availability fallback must not undo the provider's intact-pair
// rule when handed legacy partial observations directly.
const fallback = (rows: typeof history, current = partial.value) => applyUclStoredQuoteFallback({
  fixture: current, providerId: fixture.providerId, history: rows, kickoff: fixture.kickoff, now: new Date(at("16:01")),
});
const legacyPartial = { ...complete.value, odds: complete.value.odds.filter(row => row.selection === "yes") };
const finalFallback = fallback([...history, stored("yes", -210, at("15:59"))], legacyPartial);
assert.deepEqual(finalFallback.odds.map(row => [row.selection, row.odds_american, row.fetched_at]), [
  ["yes", -180, at("15:50")], ["no", 140, at("15:50")],
], "downstream fallback replaces partial current fragments with one complete original capture");
assert.equal(fallback([stored("yes", -180), stored("no", 140, at("15:55"))], legacyPartial), legacyPartial);
assert.equal(fallback([stored("yes", -180, at("16:02")), stored("no", 140, at("16:02"))], legacyPartial), legacyPartial);
assert.equal(fallback([...history, stored("yes", -190)], legacyPartial), legacyPartial);
assert.equal(fallback(history, complete.value), complete.value, "complete current family retains object identity and exact prices");

const splitCaptures = response([btts(-200, null), { key: "btts", last_update: at("15:59"), outcomes: [{ name: "No", price: 150 }] }]);
assert.equal((await load({ body: splitCaptures })).value.odds.length, 0,
  "partial native markets with different original clocks cannot be unioned");
const conflictingNative = response([btts(), btts(-190, 150)]);
assert.equal((await load({ body: conflictingNative })).value.odds.length, 0);
const owlTotal = complete.value.odds.map((row, index) => ({ ...row, market: "total" as const,
  selection: index === 0 ? "over" as const : "under" as const, line: 3.75,
  sportsbook: "pinnacle", odds_american: index === 0 ? -110 : -100 }));
const otherCatalogTotal = owlTotal.map((row, index) => ({ ...row, provider: "the_odds_api" as const,
  provider_event_id: "other-catalog-native-id", provider_endpoint: "/v4/events/other-catalog-native-id/odds",
  odds_american: index === 0 ? -150 : 125 }));
for (const rows of [[...owlTotal, ...otherCatalogTotal], [...otherCatalogTotal, ...owlTotal]]) {
  assert.deepEqual(__TEST__.intactUclQuoteFamilies(rows, fixture.kickoff, Date.parse(at("16:01"))), [],
    "conflicting complete native same-book/contract/clock economics are quarantined independent of input order");
}
const matchingCatalogTotal = otherCatalogTotal.map((row, index) => ({ ...row, odds_american: owlTotal[index]!.odds_american }));
assert.equal(__TEST__.intactUclQuoteFamilies([...owlTotal, ...matchingCatalogTotal], fixture.kickoff,
  Date.parse(at("16:01"))).length, 2, "identical economics from two catalogs remain one intact physical-book pair");
const laterCatalogTotal = otherCatalogTotal.map(row => ({ ...row, fetched_at: at("16:01") }));
assert.deepEqual(__TEST__.intactUclQuoteFamilies([...owlTotal, ...laterCatalogTotal], fixture.kickoff,
  Date.parse(at("16:01"))).map(row => row.odds_american), [-150, 125],
  "a genuinely newer complete capture remains distinguishable from a same-clock contradiction");
const duplicateOwnership = structuredClone(response());
const competing = structuredClone(duplicateOwnership.data![0]!);
competing.eventId = `${eventId}-other-native-owner`;
duplicateOwnership.data!.push(competing);
const ambiguous = await load({ body: duplicateOwnership });
assert.equal(ambiguous.value.odds.length, 0);
assert.equal(ambiguous.value.fixtureEventIdentities?.length, 0,
  "different native owners for one provider/book/market remain quarantined");

const otherTotal = await load({ body: response([{ key: "totals", last_update: at("16:00"),
  outcomes: [{ name: "Over", price: -110, point: 3.5 }, { name: "Under", price: -110, point: 3.5 }] }]) });
assert.equal(otherTotal.value.odds.length, 2);
assert.ok(otherTotal.value.odds.every(row => row.line === 3.5));
assert.equal(__TEST__.completeMarket(otherTotal.value.odds, "total"), false,
  "intact alternate contracts remain evidence without becoming an executable 2.5 contract");

async function paidMock(wrong: "id" | "teams" | null) {
  let clock = Date.parse(at("16:01"));
  const routes: string[] = [];
  const catalog = { id: "verified-catalog-id", home_team: fixture.home, away_team: fixture.away, commence_time: fixture.kickoff };
  const provider = new CurrentSoccerMarketProvider({ competition: "ucl", owlsApiKey: "mock-only", theOddsApiKey: "mock-only",
    now: () => new Date(clock), fetchImpl: (async (url: URL | RequestInfo) => {
      const pathname = new URL(String(url)).pathname; routes.push(pathname);
      if (pathname === "/api/v1/soccer/odds") return new Response(JSON.stringify(response([btts(-200, null)])));
      if (pathname.endsWith("/events")) return new Response(JSON.stringify([catalog]), { headers: { "x-requests-remaining": "10000" } });
      assert.ok(pathname.endsWith("/events/verified-catalog-id/odds"));
      clock = Date.parse("2026-11-03T16:01:04.000Z");
      return new Response(JSON.stringify({ ...catalog, id: wrong === "id" ? "unrequested-native-id" : catalog.id,
        home_team: wrong === "teams" ? "Real Madrid" : catalog.home_team,
        bookmakers: [{ key: "draftkings", last_update: "2026-11-03T16:01:02.000Z",
          markets: [btts(-180, 140, "2026-11-03T16:01:02.000Z")] }] }),
      { headers: { "x-requests-remaining": "9999", "x-requests-last": "1" } });
    }) as typeof fetch,
  });
  return { market: await provider.loadFixture(fixture), routes, telemetry: provider.telemetry() };
}
const recovered = await paidMock(null);
assert.equal(recovered.routes.length, 3, "the mocked provider follows one capture/catalog/recovery path");
assert.deepEqual(recovered.market.odds.map(row => [row.selection, row.odds_american, row.provider]), [
  ["yes", -180, "the_odds_api"], ["no", 140, "the_odds_api"],
], "a complete recovery family replaces a partial Owl family without blending providers");
assert.ok(recovered.market.odds.every(row => row.fetched_at === "2026-11-03T16:01:02.000Z"));
assert.ok(recovered.market.fixtureEventIdentities?.every(identity => identity.provider === "the_odds_api" &&
  identity.providerEventId === "verified-catalog-id"));
for (const wrong of ["id", "teams"] as const) {
  const invalid = await paidMock(wrong);
  assert.equal(invalid.market.odds.length, 0);
  assert.ok(invalid.telemetry.paidRequestHolds.includes("event_odds_identity_mismatch"));
}

// EPL keeps its original normalization/fallback branch; this scoped repair
// does not migrate another competition's source or matching semantics.
const eplBody = response([btts(-180, 140, at("15:55"))]);
eplBody.data![0]!.league = "England - Premier League";
const epl = new CurrentSoccerMarketProvider({ competition: "epl", owlsApiKey: "mock-only", now: () => new Date(at("16:01")),
  fetchImpl: (async () => new Response(JSON.stringify(eplBody))) as typeof fetch });
const eplRows = await epl.loadFixture(fixture);
assert.ok(eplRows.odds.every(row => row.fetched_at === at("16:00")), "EPL retains its existing book-level clock path");
console.log("PASS UCL receipt-time clock, intact current/stored/native quote families, future rejection, identity quarantine and EPL isolation (mock responses only; zero network calls).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
