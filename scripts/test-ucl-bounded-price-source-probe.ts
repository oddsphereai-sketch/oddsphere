import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseUclPriceProbeIds, runUclBoundedPriceSourceProbe } from "@/lib/services/ucl/uclBoundedPriceSourceProbe";

const now = new Date("2026-11-03T16:00:04.000Z");
const key = "mock-sensitive-key-never-output";
const fixtures = [
  { id: 4243843, home: "LASK Linz", away: "Slovan Bratislava", kickoff: "2026-11-03T20:00:00.000Z", native: "a" },
  { id: 4438978, home: "Lens", away: "Como", kickoff: "2026-11-04T20:00:00.000Z", native: "b" },
];
type Snapshot = NonNullable<Parameters<typeof runUclBoundedPriceSourceProbe>[0]["snapshot"]>;
const snapshot: Snapshot = { sport: "soccer", as_of: "2026-11-03T15:55:00.000Z", games: fixtures.map(fixture => ({
  id: `soccer-ucl-${fixture.id}`, external_id: fixture.id, sport: "soccer", homeTeamDisplayName: fixture.home,
  awayTeamDisplayName: fixture.away, gameStartAt: fixture.kickoff, lockState: "open", lockedAt: null,
  soccerCompetitionContext: { competition: "uefa_champions_league", stage: "league_phase", leg: null,
    aggregateBefore: null, neutralVenue: false, regulationTime: true, advancementMarket: false, provenance: "test" },
})) };
const catalog = fixtures.map(fixture => ({ id: fixture.native, sport_key: "soccer_uefa_champs_league",
  home_team: fixture.id === 4243843 ? "LASK" : "RC Lens", away_team: fixture.away, commence_time: fixture.kickoff }));
const sourceEvent = (index: number) => ({ ...catalog[index], bookmakers: [{ key: "draftkings", title: "DraftKings",
  last_update: "2026-11-03T16:00:02.000Z", markets: [
    { key: "h2h", outcomes: [{ name: catalog[index]!.home_team, price: -150 }, { name: "Draw", price: 250 }, { name: catalog[index]!.away_team, price: 400 }] },
    { key: "double_chance", outcomes: [{ name: "Home or Draw", price: -250 }, { name: "Away or Draw", price: 130 }, { name: "Home or Away", price: -200 }] },
    { key: "totals", outcomes: [{ name: "Over", price: -110, point: 3 }, { name: "Under", price: -110, point: 3 }] },
    { key: "btts", last_update: "2026-11-03T16:00:03.000Z", outcomes: [{ name: "Yes", price: -180 }, { name: "No", price: 140 }] },
  ] }] });
function mocked(options: { catalogBody?: unknown; catalogRemaining?: string; eventCost?: string;
  eventBody?: (index: number) => unknown; fail?: boolean } = {}) {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.origin, "https://api.the-odds-api.com");
    assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    assert.equal(url.searchParams.get("apiKey"), key);
    if (options.fail) throw new Error(`sensitive URL ${url}`);
    if (url.pathname.endsWith("/events")) {
      assert.equal(requests.length, 1, "one catalog, no retry");
      return Response.json(options.catalogBody ?? catalog, { headers: { "x-requests-last": "0", "x-requests-remaining": options.catalogRemaining ?? "10000" } });
    }
    assert.equal(url.searchParams.get("markets"), "h2h,double_chance,totals,btts");
    assert.equal(url.searchParams.get("bookmakers"), "pinnacle,draftkings,fanduel,betmgm,caesars");
    assert.equal(url.searchParams.get("oddsFormat"), "american");
    const index = url.pathname.endsWith("/a/odds") ? 0 : url.pathname.endsWith("/b/odds") ? 1 : -1;
    assert.ok(index >= 0, "no arbitrary event request");
    return Response.json(options.eventBody?.(index) ?? sourceEvent(index), {
      headers: { "x-requests-last": options.eventCost ?? "4", "x-requests-remaining": "9992" },
    });
  };
  return { requests, fetcher };
}
async function main() {
for (const invalid of [null, "", "4243843,4438978,1", "1", "4243843,4243843", "4243843%2C4438978", "4243843,"])
  assert.equal(parseUclPriceProbeIds(invalid), null);
assert.deepEqual(parseUclPriceProbeIds("4243843,4438978"), [4243843, 4438978]);
const before = JSON.stringify(snapshot);
const transport = mocked();
const run = (overrides: Partial<Parameters<typeof runUclBoundedPriceSourceProbe>[0]> = {}) => runUclBoundedPriceSourceProbe({
  snapshot, fixtureIds: [4243843, 4438978], apiKey: key, now: () => now, fetchImpl: transport.fetcher, ...overrides,
});
const result = await run();
assert.equal(result.catalogRequests, 1); assert.equal(result.paidRequests, 2); assert.equal(result.creditsUsed, 8);
assert.equal(result.reservedCredits, 8); assert.equal(transport.requests.length, 3); assert.equal(result.recordsUpdated, 0);
assert.equal(result.normalRefreshCadenceUpdated, false);
assert.deepEqual(result.fixtures.map(fixture => fixture.status), ["received_current_source", "received_current_source"]);
const text = JSON.stringify(result);
assert.ok(text.includes('"line":3')); assert.ok(!text.includes('"line":2.5'), "never fabricate absent main total line");
assert.ok(text.includes('"originalUpdatedAt":"2026-11-03T16:00:03.000Z"'));
assert.ok(text.includes('"clockStatus":"current"')); assert.ok(!text.includes(key));
assert.equal(JSON.stringify(snapshot), before, "locked/current snapshot is read only");
for (const bad of [
  { fixtureIds: [1] }, { fixtureIds: [4243843, 4438978, 1] }, { fixtureIds: [4243843, 4243843] }, { snapshot: null },
  { apiKey: undefined }, { snapshot: { ...snapshot, sport: "nba" as const } },
  { snapshot: { ...snapshot, games: [] } },
  { snapshot: { ...snapshot, games: [...snapshot.games, snapshot.games[0]!] } },
  { snapshot: { ...snapshot, games: snapshot.games.map(game => ({ ...game, lockState: "locked" as const, lockedAt: "2026-11-03T15:00:00Z" })) } },
  { snapshot: { ...snapshot, games: snapshot.games.map(game => ({ ...game, homeTeamDisplayName: "LASK Juniors" })) } },
  { snapshot: { ...snapshot, games: snapshot.games.map(game => ({ ...game, gameStartAt: "2026-11-05T20:00:00Z" })) } },
]) {
  const uncalled = mocked(); const failed = await run({ ...bad, fetchImpl: uncalled.fetcher });
  assert.ok(failed.holds.length > 0); assert.equal(uncalled.requests.length, 0, "invalid/locked/wrong fixture causes no source call");
}
for (const body of [catalog.map(event => ({ ...event, home_team: `${event.home_team} Women` })),
  catalog.map(event => ({ ...event, sport_key: "soccer_epl" })), [...catalog, catalog[0]]]) {
  const mock = mocked({ catalogBody: body }); const value = await run({ fixtureIds: [4243843], fetchImpl: mock.fetcher });
  assert.equal(value.paidRequests, 0); assert.equal(mock.requests.length, 1, "strict ambiguous/name/competition mismatch never spends");
}
for (const change of [(event: ReturnType<typeof sourceEvent>) => ({ ...event, id: "unrequested-id" }),
  (event: ReturnType<typeof sourceEvent>) => ({ ...event, away_team: "Como Women" })]) {
  const mock = mocked({ eventBody: index => change(sourceEvent(index)) });
  const value = await run({ fixtureIds: [4438978], fetchImpl: mock.fetcher });
  assert.equal(value.fixtures[0]!.status, "returned_fixture_identity_mismatch"); assert.deepEqual(value.fixtures[0]!.books, []);
}
const reserve = mocked({ catalogRemaining: "1003" });
assert.equal((await run({ fetchImpl: reserve.fetcher })).paidRequests, 0);
const overCost = mocked({ eventCost: "8" });
assert.equal((await run({ fetchImpl: overCost.fetcher })).paidRequests, 1, "unexpected billing stops the second event request");
const failure = mocked({ fail: true });
assert.ok(!JSON.stringify(await run({ fetchImpl: failure.fetcher })).includes(key), "raw network error/URL never reaches output");
let bodyClock = new Date("2026-11-03T16:00:00.000Z");
const bodyTransport = mocked();
const bodyDelayed: typeof fetch = async (url, init) => {
  const response = await bodyTransport.fetcher(url, init);
  if (String(url).includes("/odds?")) {
    const originalJson = response.json.bind(response);
    response.json = async () => { const body = await originalJson(); bodyClock = now; return body; };
  }
  return response;
};
const bodyReceipt = await run({ fixtureIds: [4243843], fetchImpl: bodyDelayed, now: () => bodyClock });
assert.ok(!JSON.stringify(bodyReceipt).includes('"clockStatus":"future"'), "source updates during body arrival use the full-body receipt clock");
const cadenceTransport = mocked({ eventBody: index => {
  const event = sourceEvent(index);
  event.bookmakers[0]!.last_update = "2026-11-03T15:15:00.000Z";
  event.bookmakers[0]!.markets.forEach(market => { if ("last_update" in market) market.last_update = "2026-11-03T15:15:00.000Z"; });
  return event;
} });
const cadence = await run({ fetchImpl: cadenceTransport.fetcher });
assert.ok(JSON.stringify(cadence.fixtures[0]).includes('"clockStatus":"stale"'), "within-six-hour fixture uses30-minute source cadence");
assert.ok(!JSON.stringify(cadence.fixtures[1]).includes('"clockStatus":"stale"'), "tomorrow fixture keeps its genuine60-minute cadence");
assert.ok(JSON.stringify(cadence.fixtures[1]).includes('"originalUpdatedAt":"2026-11-03T15:15:00.000Z"'));

// Execute the real route module with mocked imports. The probe cannot reach
// slate construction, Owl/history, inference, line history or snapshot writes.
const routeSource = readFileSync(new URL("../app/api/cron/ucl-price-source-probe/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"), /ucl-price-source-probe/,
  "the read-only diagnostic is never a scheduled job");
const compiled = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const calls: string[] = [];
let lastNormal: Date | null = null, authorized = true;
const invocations: Array<{ source: string; options: Record<string, unknown> }> = [];
const guarded = new Proxy({}, { get: (_target, name) => () => { calls.push(String(name)); throw new Error(`forbidden:${String(name)}`); } });
const mocks: Record<string, unknown> = {
  "@/lib/cron/runCron": {
    cronHandler: async (_request: Request, source: string, callback: () => Promise<unknown>, options: Record<string, unknown>) => {
      invocations.push({ source, options });
      if (!authorized) return new Response("Unauthorized", { status: 401 });
      return Response.json(await callback());
    },
    isWithinCronMinimumInterval: (last: Date | null, minutes: number) => last !== null && Date.now() - last.getTime() < minutes * 60_000,
  },
  "@/lib/services/refreshLogger": { refreshLogger: { getLastHealthyCompleted: async (source: string, sport: string) => {
    calls.push(`normalClock:${source}:${sport}`); return lastNormal;
  } } },
  "@/lib/services/ucl/uclFeatureFlags": { resolveUclFeatureFlags: () => ({ refresh: true, writes: true, publication: true }) },
  "@/lib/services/ucl/uclMemberSnapshotStore": {
    readCurrentUclMemberSnapshot: async () => { calls.push("snapshot_read"); return snapshot; },
    writeCurrentUclMemberSnapshot: () => { throw new Error("forbidden:snapshot_write"); },
  },
  "@/lib/services/ucl/uclBoundedPriceSourceProbe": { parseUclPriceProbeIds,
    runUclBoundedPriceSourceProbe: async (args: Parameters<typeof runUclBoundedPriceSourceProbe>[0]) => {
      calls.push("bounded_probe"); return runUclBoundedPriceSourceProbe({ ...args, apiKey: key, now: () => now, fetchImpl: mocked().fetcher });
    } },
};
const routeModule = { exports: {} as { GET: (request: Request) => Promise<Response> } };
new Function("require", "exports", compiled)((name: string) => mocks[name] ?? guarded, routeModule.exports);
const request = (query = "fixture_ids=4243843,4438978") => new Request(`https://example.test/api/cron/ucl-price-source-probe?${query}`);
const response = await routeModule.exports.GET(request()); assert.equal(response.status, 200);
assert.deepEqual(calls, ["normalClock:ucl_daily_refresh:soccer", "snapshot_read", "bounded_probe"]);
assert.equal(invocations[0]!.source, "ucl_price_source_probe");
assert.deepEqual(invocations[0]!.options, { sport: "soccer", leaseGroup: "prediction_pipeline", requireLease: true,
  lockMinutes: 8, minIntervalMinutes: 15, leaseRetryMaxWaitMs: 45_000, leaseRetryIntervalMs: 2_000 });
calls.length = 0; lastNormal = new Date(Date.now() - 5 * 60_000);
const tooSoon = await (await routeModule.exports.GET(request())).json();
assert.equal(tooSoon.details.reason, "normal_refresh_minimum_interval"); assert.deepEqual(calls, ["normalClock:ucl_daily_refresh:soccer"]);
calls.length = 0; lastNormal = null;
await routeModule.exports.GET(request("fixture_ids=1"));
assert.deepEqual(calls, ["normalClock:ucl_daily_refresh:soccer"], "malformed probe never falls through to forecast writes");
calls.length = 0; authorized = false;
assert.equal((await routeModule.exports.GET(request())).status, 401); assert.deepEqual(calls, []);
authorized = true;
calls.length = 0;
await routeModule.exports.GET(request(""));
assert.deepEqual(calls, ["normalClock:ucl_daily_refresh:soccer"], "empty diagnostic route cannot dispatch a normal refresh");
const normalRouteSource = readFileSync(new URL("../app/api/cron/ucl-daily-refresh/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(normalRouteSource, /price_source_probe/, "existing forecast route has no diagnostic dispatch or new query flag");
const normalCompiled = ts.transpileModule(normalRouteSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const normalModule = { exports: {} as { GET: (request: Request) => Promise<Response> } };
new Function("require", "exports", normalCompiled)((name: string) => mocks[name] ?? guarded, normalModule.exports);
await assert.rejects(() => normalModule.exports.GET(new Request("https://example.test/api/cron/ucl-daily-refresh")), /forbidden:buildUclSlate/);
assert.equal(invocations.at(-1)!.source, "ucl_daily_refresh", "default forecast audit/cadence namespace unchanged");
assert.deepEqual(invocations.at(-1)!.options, invocations[0]!.options);
console.log("PASS bounded UCL source probe: one catalog,≤2 requests/8 credits, exact unlocked identity/aliases, sanitized source-only output, no writes/provider retries, existing auth/lease and normal cadence preserved (mock network only).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
