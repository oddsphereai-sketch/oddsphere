import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPredictionRecords } from "../lib/services/trackingAggregateService";

type Call = { table: string; select?: string; range?: number[]; filters: unknown[] };
const view = "prediction_records_tracking_projection";
const opts = { sport: "soccer" as const, from: "2026-10-01", to: "2026-11-02", competition: "uefa_champions_league" };

async function scenario(failure?: { code: string; message: string }, failurePage = 0) {
  const calls: Call[] = [];
  const rows = Array.from({ length: 1001 }, (_, index) => Object.freeze({ id: index + 1, locked_at: "2026-10-01T12:00:00Z" }));
  const before = JSON.stringify(rows);
  const client = { from(table: string) {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const builder = {
      select(columns: string) { call.select = columns; return builder; },
      order(column: string, options: unknown) { call.filters.push(["order", column, options]); return builder; },
      range(from: number, to: number) { call.range = [from, to]; return builder; },
      eq(column: string, value: unknown) { call.filters.push(["eq", column, value]); return builder; },
      gte(column: string, value: unknown) { call.filters.push(["gte", column, value]); return builder; },
      lte(column: string, value: unknown) { call.filters.push(["lte", column, value]); return builder; },
      contains(column: string, value: unknown) { call.filters.push(["contains", column, value]); return builder; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        const from = call.range![0];
        const error = table === view && from === failurePage ? failure ?? null : null;
        return Promise.resolve({ data: error ? null : rows.slice(from, call.range![1] + 1), error }).then(resolve, reject);
      },
    };
    return builder;
  } } as unknown as SupabaseClient;
  const result = await fetchAllPredictionRecords(client, opts);
  assert.equal(JSON.stringify(rows), before, "reader must not mutate locked records");
  for (const call of calls) {
    assert.deepEqual(call.filters, [
      ["order", "id", { ascending: true }], ["eq", "sport", opts.sport],
      ["gte", "slate_date", opts.from], ["lte", "slate_date", opts.to],
      ["contains", "snapshot_json", { competition: opts.competition }],
    ]);
    assert(!call.select!.split(",").includes("snapshot_json"), "full snapshots must not be downloaded");
  }
  return { result, calls };
}

async function main() {
const projected = await scenario();
assert.equal(projected.result.error, null);
assert.equal(projected.result.rows.length, 1001);
assert.deepEqual(projected.calls.map(c => c.range), [[0, 999], [1000, 1999]]);
assert(projected.calls.every(c => c.table === view && !c.select!.includes("->")));

for (const code of ["PGRST205", "42P01"]) {
  const legacy = await scenario({ code, message: `missing ${view}` });
  assert.deepEqual(legacy.result, projected.result);
  assert.deepEqual(legacy.calls.map(c => c.table), [view, "prediction_records", "prediction_records"]);
  assert.deepEqual(legacy.calls[0].select!.split(","), legacy.calls[1].select!.split(",").map(c => c.split(":")[0]));
  assert(legacy.calls[1].select!.includes("member_facing_grade:snapshot_json->member_facing_at_lock->>grade"));
}
const laterMissing = await scenario({ code: "42P01", message: `missing ${view}` }, 1000);
assert.deepEqual(laterMissing.result, projected.result, "fallback must neither drop nor duplicate an already read page");
for (const error of [
  { code: "57014", message: "statement timeout" },
  { code: "42501", message: `permission denied for ${view}` },
  { code: "42P01", message: "missing unrelated relation" },
]) {
  const failed = await scenario(error);
  assert.deepEqual(failed.result.error, error);
  assert.equal(failed.calls.length, 1, "real failures must not trigger an expensive retry");
}
console.log("tracking snapshot projection paging, exact legacy fallback and reader immutability: PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
