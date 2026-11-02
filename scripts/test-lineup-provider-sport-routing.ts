import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { Sport } from "../lib/types/domain/Sport";
import { assertLegacyLineupSport, supportsLegacyLineupRefresh } from "../lib/services/lineupProviderScope";

function load(file: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(output, {
    exports, Request, Response, console, process: { env },
    require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return exports;
}

async function main() {
  const unsupported: Sport[] = ["cbb", "nba", "nfl", "cfb", "nhl", "ucl", "wnba"];
  assert.equal(supportsLegacyLineupRefresh("mlb"), true);
  assert.doesNotThrow(() => assertLegacyLineupSport("mlb"));
  for (const sport of unsupported) {
    assert.equal(supportsLegacyLineupRefresh(sport), false);
    assert.throws(() => assertLegacyLineupSport(sport), /does not support/);
  }

  let providerConstructions = 0;
  let databaseReads = 0;
  const service = load("lib/services/lineupService.ts", {
    "../db/supabase": { supabase: { from() { databaseReads++; throw new Error("unexpected DB access"); } } },
    "../providers/factory": { getPlayerStatsProvider() { providerConstructions++; throw new Error("MLB provider reached"); } },
    "./_idMaps": new Proxy({}, { get() { return () => { databaseReads++; throw new Error("unexpected ID lookup"); }; } }),
    "./mlbOfficialLineupService": {},
    "./projectedLineupContinuity": {},
    "./lineupProviderScope": { assertLegacyLineupSport },
  }).lineupService as { refreshLineups(sport: Sport, date: string): Promise<unknown> };
  for (const sport of unsupported) {
    await assert.rejects(service.refreshLineups(sport, "2026-11-02"), /does not support/);
  }
  assert.equal(providerConstructions, 0, "unsupported sports cannot spend quota at the MLB endpoint");
  assert.equal(databaseReads, 0, "unsupported IDs cannot read or write batting-order data");
  await assert.rejects(service.refreshLineups("mlb", "2026-05-02"), /MLB provider reached/);
  assert.equal(providerConstructions, 1, "MLB still reaches its existing provider");

  let active: Sport[] = unsupported;
  const calls: string[] = [];
  const result = { records_updated: 1, api_calls_made: 1 };
  const route = load("app/api/cron/lineup-watch/route.ts", {
    "@/lib/cron/runCron": {
      async cronHandlerPerSport(_request: Request, source: string, sports: Sport[], handler: (args: {sport: Sport}) => Promise<unknown>, options: Record<string, unknown>) {
        assert.equal(source, "lineup_watch");
        assert.equal(options.leaseGroup, "prediction_pipeline");
        assert.equal(options.requireLease, true);
        assert.equal(options.minIntervalMinutes, 20);
        const runs = [];
        for (const sport of sports) runs.push({ sport, result: await handler({ sport }) });
        return Response.json({ runs });
      },
    },
    "@/lib/cron/dates": { parseDateFromUrl: () => "2026-11-02" },
    "@/lib/cron/seasons": { sportsInSeasonToday: () => active },
    "@/lib/db/supabase": { supabase: {} },
    "@/lib/services/lineupProviderScope": { supportsLegacyLineupRefresh },
    "@/lib/services/lineupService": { lineupService: { async refreshLineups(sport: Sport) { calls.push(`lineups:${sport}`); return result; } } },
    "@/lib/services/linesService": { linesService: { async refreshGameLinesV2(sport: Sport) { calls.push(`lines:${sport}`); return result; } } },
    "@/scripts/operator/backfill-first-inning-stats": { async runFirstInningCycle() { calls.push("first-inning"); return { rows_written: 1, mlb_api_calls: 1 }; } },
    "@/lib/services/automodelService": { async generatePredictionsForSlate(sport: Sport, _date: string, _mode: string, options: Record<string, unknown>) {
      assert.equal(options.respectLocks, true);
      assert.equal(options.writeToDb, true);
      calls.push(`model:${sport}`);
      return { game_count: 1, held_count: 0, errors: [], db_writes: { ingest: { inserted: 0, updated: 1 } } };
    } },
    "@/lib/services/predictionRecordService": { async createPredictionRecords() { calls.push("records"); return { insertedCount: 0, proposed: [], skippedExisting: 1, errors: [] }; } },
    "@/lib/services/labResponseSnapshotWriter": { async refreshDailyEdgeResponseSnapshot() { calls.push("snapshot"); return { ok: true }; } },
    "@/lib/automodel/mlbChampionRuntime": { assertMlbChampionRuntime() { calls.push("champion"); } },
  }, { AUTOMODEL_DB_WRITES_ENABLED: "true" }) as { GET(request: Request): Promise<Response> };

  const request = new Request("https://example.test/api/cron/lineup-watch");
  assert.deepEqual(await (await route.GET(request)).json(), { runs: [] });
  assert.deepEqual(calls, [], "the whole legacy flow, including its props path, excludes unsupported sports");
  active = ["mlb", ...unsupported];
  const response = await (await route.GET(request)).json();
  assert.deepEqual(response.runs.map((r: {sport: Sport}) => r.sport), ["mlb"]);
  assert.deepEqual(calls, ["champion", "lineups:mlb", "lines:mlb", "first-inning", "model:mlb", "records", "snapshot"]);
  assert.deepEqual(response.runs[0].result.details.prop_predictions, { delegated: true, writer: "mlb_player_props_refresh" });
  console.log("PASS actual lineup service and cron reject unsupported sports before MLB provider/DB/writer access; MLB sequence and lease/lock guards preserved");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
