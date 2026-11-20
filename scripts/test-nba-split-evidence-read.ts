import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readNbaSplitEvidence, type NbaReaderSplitDbRow } from "../lib/services/nba/nbaSplitEvidenceRead";
const sample = (id: number, event: string) => ({ id, canonical_event_id: event, league: "nba", source_book: "pinnacle", value: `quote-${id}` }) as unknown as NbaReaderSplitDbRow & { league: string };
const rows = [sample(10, "a"), sample(20, "b"), sample(30, "a"), sample(40, "b"), sample(50, "a")];
function mock(options: { cap?: number; errorEvent?: string; emptyPage?: boolean; foreign?: boolean; wrongCount?: number; duplicate?: boolean } = {}) {
  let active = 0, peak = 0, writes = 0, reads = 0, countReads = 0;
  const client = { from(table: string) {
    assert.equal(table, "market_split_observations_v2"); let event = "", league = "", lower = 0, upper = Infinity, limit = Infinity, head = false, single = false;
    const q = { select(_fields: string, args?: { head?: boolean; count?: string }) { head = args?.head === true; if (head) { assert.equal(args?.count, "exact"); countReads++; } return q; },
      eq(k: string, v: string) { if (k === "canonical_event_id") event = v; else if (k === "league") league = v; else assert.fail(k); return q; },
      gt(k: string, v: number) { assert.equal(k, "id"); lower = v; return q; }, lte(k: string, v: number) { assert.equal(k, "id"); upper = v; return q; },
      order(k: string, args: { ascending: boolean }) { assert.equal(k, "id"); assert.equal(args.ascending, true, "Never use global-ID descending order to prove an empty scope"); return q; },
      limit(v: number) { limit = v; return q; }, maybeSingle() { single = true; return q; },
      insert() { writes++; throw new Error("No writes"); }, update() { writes++; throw new Error("No writes"); }, upsert() { writes++; throw new Error("No writes"); },
      async then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        active++; peak = Math.max(peak, active); reads++; await Promise.resolve();
        let matched = rows.filter(r => r.canonical_event_id === event && r.league === league && r.id > lower && r.id <= upper);
        const count = options.wrongCount ?? matched.length;
        if (options.emptyPage && !head && !single) matched = [];
        if (options.foreign && !head && !single && matched.length) matched[0] = sample(matched[0]!.id, "foreign");
        if (options.duplicate && !head && !single && matched.length) matched = [matched[0]!, matched[0]!];
        const selected = matched.slice(0, Math.min(limit, options.cap ?? Infinity));
        const result = { data: head ? null : single ? selected[0] ?? null : selected, count: head ? count : null,
          error: event === options.errorEvent ? { code: "57014", message: "secret SQL must not leak" } : null };
        active--; return Promise.resolve(result).then(resolve, reject);
      } }; return q;
  } } as unknown as SupabaseClient;
  return { client, stats: () => ({ peak, writes, reads, countReads }) };
}
async function main() {
  const m = mock({ cap: 1 }), original = JSON.stringify(rows);
  const result = await readNbaSplitEvidence({ client: m.client, eventIds: ["b", "a", "a", "empty"], highWater: 40 });
  assert.equal(result.error, null); assert.deepEqual(result.rows.map(r => r.id), [10, 20, 30, 40]);
  assert.equal(result.lastRead, 40); assert.equal(result.pages, 4, "A server cap of one row cannot truncate a requested1000-row page");
  assert.equal(result.events, 3); assert.equal(m.stats().countReads, 3); assert.ok(m.stats().peak <= 4); assert.equal(m.stats().writes, 0);
  assert.equal(JSON.stringify(rows), original); assert.ok(!result.rows.some(r => r.id === 50), "New observations after frozen frontier remain excluded");
  for (const options of [{ errorEvent: "b" }, { emptyPage: true }, { foreign: true }, { duplicate: true }, { wrongCount: 1 }]) {
    const bad = await readNbaSplitEvidence({ client: mock(options).client, eventIds: ["a", "b"], highWater: 40 });
    assert.notEqual(bad.error, null); assert.deepEqual(bad.rows, [], "No partial evidence may reach a forecast");
    assert.ok(!JSON.stringify(bad).includes("secret SQL"));
  }
  const none = await readNbaSplitEvidence({ client: mock().client, eventIds: ["empty"], highWater: 0 });
  assert.equal(none.error, null); assert.deepEqual(none.rows, []);
  const budget = await readNbaSplitEvidence({ client: mock().client, eventIds: Array.from({ length: 129 }, (_, i) => String(i)), highWater: 40 });
  assert.notEqual(budget.error, null);
  console.log("NBA split evidence: complete sorted-row parity, capped-page continuation, fixed frontier, bounded concurrency, empty future scopes, failures/foreign rows/duplicates/count mismatches and zero writes passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
