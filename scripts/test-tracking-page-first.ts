import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPredictionRecords } from "../lib/services/trackingAggregateService";

const name = "tracking_prediction_records_page";
const rows = Array.from({ length: 1001 }, (_, i) => Object.freeze({
  id: i + 1, locked_at: "2026-10-01T12:00:00Z", play_grade: "legacy_locked_grade",
  member_facing_grade: "Best Angle", model_version: "original-release",
  member_market_at_capture: Object.freeze({ side: "over", line: 143.5, price: -112 }),
}));
const frozen = JSON.stringify(rows);
const opts = { sport: "soccer" as const, from: "2026-06-07", to: "2026-11-08", competition: "uefa_champions_league" };

async function main() {
  const calls: Array<Record<string, unknown>> = [];
  const client = { from() { throw new Error("RPC must not read the legacy view"); },
    async rpc(fn: string, args: Record<string, unknown>) {
      assert.equal(fn, name); calls.push(args);
      return { data: rows.slice(Number(args.p_offset), Number(args.p_offset) + Number(args.p_limit)), error: null };
    } } as unknown as SupabaseClient;
  const result = await fetchAllPredictionRecords(client, opts);
  assert.equal(result.error, null);
  assert.deepEqual(result.rows, rows);
  assert.equal(result.rows[0], rows[0], "stored legacy fields must pass through without reinterpretation");
  assert.equal(JSON.stringify(rows), frozen, "reading must never mutate locked records");
  assert.deepEqual(calls, [0, 1000].map(p_offset => ({ p_sport: opts.sport, p_from: opts.from,
    p_to: opts.to, p_competition: opts.competition, p_offset, p_limit: 1000 })));

  for (const error of [
    { code: "57014", message: "statement timeout" },
    { code: "42501", message: `permission denied for ${name}` },
    { code: "PGRST202", message: "missing unrelated_function" },
  ]) {
    const failed = await fetchAllPredictionRecords({ ...client, async rpc() { return { data: null, error }; } } as unknown as SupabaseClient, opts);
    assert.equal(failed.error, error, "real failures must not retry an expensive legacy scan");
  }
  for (const malformed of [null, {}, "[]", Array(1001).fill(rows[0])]) {
    const failed = await fetchAllPredictionRecords({ ...client, async rpc() { return { data: malformed, error: null }; } } as unknown as SupabaseClient, {});
    assert(failed.error instanceof Error, "malformed pages must fail visibly");
  }

  // Reuse the exact legacy query on a missing additive migration, including
  // when the migration disappears after an earlier page has been read.
  for (const missingPage of [0, 1000]) for (const code of ["PGRST202", "42883"]) {
    const legacyRanges: number[] = [];
    const legacy = { async rpc(_fn: string, args: Record<string, unknown>) {
      return Number(args.p_offset) === missingPage
        ? { data: null, error: { code, message: `missing ${name}` } }
        : { data: rows.slice(Number(args.p_offset), Number(args.p_offset) + 1000), error: null };
    }, from(table: string) {
      assert.equal(table, "prediction_records_tracking_projection");
      let start = 0;
      const query = { select() { return query; }, order() { return query; },
        range(from: number) { start = from; legacyRanges.push(from); return query; },
        eq() { return query; }, gte() { return query; }, lte() { return query; }, contains() { return query; },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: rows.slice(start, start + 1000), error: null }).then(resolve); } };
      return query;
    } } as unknown as SupabaseClient;
    const fallback = await fetchAllPredictionRecords(legacy, opts);
    assert.deepEqual(fallback.rows, rows, "fallback must retain every row exactly once");
    assert.equal(fallback.error, null);
    assert.deepEqual(legacyRanges, missingPage === 0 ? [0, 1000] : [1000]);
  }
  const empty = await fetchAllPredictionRecords({ ...client, async rpc(_fn: string, args: Record<string, unknown>) {
    assert.deepEqual(args, { p_sport: null, p_from: null, p_to: null, p_competition: null, p_offset: 0, p_limit: 1000 });
    return { data: [], error: null };
  } } as unknown as SupabaseClient, {});
  assert.deepEqual(empty, { rows: [], error: null });
  const controller = new AbortController();
  const aborted = { code: "", message: "AbortError: request cancelled" };
  let signalReceived = false;
  const cancelledClient = { from() { throw new Error("cancellation must not fall back to another scan"); },
    rpc() {
      const query = {
        abortSignal(signal: AbortSignal) { assert.equal(signal, controller.signal); signalReceived = true; return query; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: null, error: aborted }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  controller.abort();
  const cancelled = await fetchAllPredictionRecords(cancelledClient, { ...opts, signal: controller.signal });
  assert(signalReceived, "the coordinated reader's AbortSignal must reach the RPC");
  assert.equal(cancelled.error, aborted);
  console.log("tracking page-first RPC, exact legacy payloads, bounded paging and migration fallback: PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
