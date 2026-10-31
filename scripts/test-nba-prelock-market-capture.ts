import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncMarketIntelligenceV2Shadow } from "../lib/services/marketIntelligenceV2/shadowSync";
import { assertNbaPrelockCaptureBudget, selectNbaPrelockCaptureGames } from "../lib/services/nba/nbaPrelockMarketCapture";

async function main() {
  assert.doesNotMatch(readFileSync("lib/services/marketIntelligenceV2/shadowSync.ts", "utf8"), /sharedCache:\s*false/,
    "scoped lock capture cannot silently bypass the production paid-provider shared cache");
  const now = new Date(), sourceAt = new Date(now.getTime() - 1000).toISOString(), slate = now.toISOString().slice(0, 10);
  const scope = { externalIds: [9], deadlineAtMs: Date.now() + 30_000 };
  assert.throws(() => assertNbaPrelockCaptureBudget({ ...scope, externalIds: [] }), /scope/);
  assert.throws(() => assertNbaPrelockCaptureBudget({ ...scope, externalIds: [9, 9] }), /scope/);
  assert.throws(() => assertNbaPrelockCaptureBudget({ ...scope, deadlineAtMs: 0 }), /deadline/);
  assert.throws(() => selectNbaPrelockCaptureGames("nfl", [{ externalId: 9 }], scope), /another sport/);
  assert.throws(() => selectNbaPrelockCaptureGames("nba", [], scope), /every entering game/);
  assert.deepEqual(selectNbaPrelockCaptureGames("nba", [{ externalId: 9 }, { externalId: 10 }], scope), [{ externalId: 9 }]);
  const writes: { table: string; rows: Record<string, unknown>[] }[] = [], calls: string[] = [], lineScopes: unknown[] = [];
  const teams = [{ id: 1, abbreviation: "NY", name: "New York Knicks" }, { id: 2, abbreviation: "DET", name: "Detroit Pistons" }];
  const games = [9, 10].map((id, i) => ({ id: 44 + i, external_id: id, slate_date: slate,
    game_date: new Date(now.getTime() + 6 * 3600_000).toISOString(), home_team_id: 1, away_team_id: 2 }));
  const lines = ["home", "away"].map((side, i) => ({ id: i + 1, game_id: 44, market_type: "spread", sportsbook: "circa", side,
    line_value: i ? 5.5 : -5.5, odds_american: -110, fetched_at: sourceAt }));
  const client = { from(table: string) {
    const result = () => ({ data: table === "teams" ? teams : table === "games" ? games : table === "lines" ? lines : [], error: null, count: lines.length });
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lte", "is", "order"]) chain[method] = () => chain;
    chain.in = (field: string, ids: unknown) => { if (table === "lines" && field === "game_id") lineScopes.push(ids); return chain; };
    chain.range = () => Promise.resolve(result());
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    chain.upsert = (rows: Record<string, unknown>[]) => { writes.push({ table, rows }); return Promise.resolve({ error: null }); };
    return chain;
  } } as unknown as SupabaseClient;
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  const enabled = process.env.MARKET_INTELLIGENCE_V2_ENABLED;
  let expireOnFetch = false;
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url);
    if (expireOnFetch) Date.now = () => scope.deadlineAtMs + 1;
    if (!url.includes("owlsinsight")) return Response.json({ data: [] });
    if (url.endsWith("/splits")) return Response.json({ sport: "nba", data: [{ event_id: "nba:Detroit Pistons@New York Knicks-20261031",
      home_team: "New York Knicks", away_team: "Detroit Pistons", splits: [{ book: "circa", as_of: sourceAt,
        moneyline: { home_handle_pct: 70, away_handle_pct: 30, home_bets_pct: 40, away_bets_pct: 60 } }] }] });
    if (url.endsWith("/odds")) return Response.json({ success: true, data: { circa: [{
      eventId: "nba:Detroit Pistons@New York Knicks-20261031", sport: "nba", home_team: "New York Knicks", away_team: "Detroit Pistons",
      bookmakers: [{ key: "circa", last_update: sourceAt, markets: [{ key: "h2h", outcomes: [
        { name: "New York Knicks", price: -160 }, { name: "Detroit Pistons", price: 140 } ] }] }] }] } });
    throw new Error(`Unexpected endpoint: ${url}`);
  };
  try {
    process.env.MARKET_INTELLIGENCE_V2_ENABLED = "true";
    const opts = { supabase: client, sport: "nba" as const, slateDate: slate, todayUtc: slate, now,
      apply: true, owlsApiKey: "fixture", playbookApiKey: "fixture", nbaPrelockScope: scope };
    await assert.rejects(syncMarketIntelligenceV2Shadow({ ...opts, slateDate: "2000-01-01" }), /current slate/);
    assert.equal(calls.length, 0, "a past-slate lock cannot silently call a history endpoint behind a current-only receipt");
    assert.equal(writes.length, 0);
    const captured = await syncMarketIntelligenceV2Shadow(opts);
    assert.equal(captured.gamesLoaded, 1);
    assert.ok(captured.priceObservationsWritten > 0 && captured.splitObservationsWritten > 0);
    assert.equal(calls.length, 4, "one league-level current call per endpoint, never per game or history");
    assert.ok(!calls.some(url => url.includes("history")));
    assert.deepEqual(lineScopes, [[44]]);
    assert.ok(writes.every(write => ["market_price_observations_v2", "market_split_observations_v2"].includes(write.table)));
    assert.ok(writes.flatMap(w => w.rows).every(row => row.canonical_event_id === "9" && row.ingestion_run_id));
    const owlsPrice = writes.flatMap(w => w.rows).find(r => r.provider === "owls" && r.provider_timestamp)!;
    assert.equal(owlsPrice.provider_timestamp, sourceAt);
    assert.ok(Date.parse(String(owlsPrice.fetched_at)) >= Date.parse(sourceAt));
    writes.length = 0; calls.length = 0;
    expireOnFetch = true;
    await assert.rejects(syncMarketIntelligenceV2Shadow(opts), /deadline/);
    assert.equal(writes.length, 0, "expired collection cannot write later observations behind the lock owner");
  } finally {
    Date.now = originalNow; globalThis.fetch = originalFetch;
    if (enabled === undefined) delete process.env.MARKET_INTELLIGENCE_V2_ENABLED; else process.env.MARKET_INTELLIGENCE_V2_ENABLED = enabled;
  }
  const route = readFileSync("app/api/cron/pregame-sweep/route.ts", "utf8");
  const refresh = route.indexOf("nbaPreLockLines = await refreshNbaLines");
  const capture = route.indexOf("nbaPrelockScope: scope", refresh);
  const model = route.indexOf("await createNbaPredictionRecords", capture);
  const coherence = route.indexOf("assessNbaLockCoherence({", model);
  const lock = route.indexOf("await applyLocks(sport, date, gamesReadyForLock)", coherence);
  const publish = route.indexOf("await refreshNbaPublishedLockMetadata", lock);
  assert.ok(refresh > 0 && capture > refresh && model > capture && coherence > model && lock > coherence && publish > lock);
  assert.match(route, /leaseGroup: "prediction_pipeline"/);
  const writer = readFileSync("lib/services/nba/buildNbaPredictionRecords.ts", "utf8");
  assert.match(writer, /buildNbaDailyEdgePipeline\(opts\.slateDate, \{ prelockMarketCapture: opts\.prelockMarketCapture \}\)/);
  const pipeline = readFileSync("lib/services/nba/buildNbaDailyEdgeAdapted.ts", "utf8");
  assert.ok(pipeline.indexOf("const injuryResolver = options.injuryResolver") < pipeline.indexOf("const candidate = resolvedExecution.candidate"));
  assert.ok(pipeline.indexOf("const pred = applyNbaProfessionalCandidate") < pipeline.indexOf("lock_time_market_capture:"));
  console.log("NBA scoped v2 T-60 capture: exact entering IDs, four-call ceiling, source clocks, deadline-before-write, sole lease and line→capture→fresh pipeline→coherence→lock→publish ordering passed; mocked providers/DB only.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
