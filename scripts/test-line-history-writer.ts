/**
 * Unit tests for the resilient line_history writer (lib/services/lineHistoryWriter.ts).
 * Env-free (mock Supabase client). Run: npx tsx scripts/test-line-history-writer.ts
 */
import { insertLineHistoryResilient, logLineHistoryInsertFailure } from "../lib/services/lineHistoryWriter";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// Mock client: a line_history insert of an array fails iff any row has __bad=true
// (mirrors Postgres batch atomicity — one rejected row rejects the call). A
// data_refresh_log insert is captured. Optionally throws to test logger safety.
function makeMock(opts: { logThrows?: boolean } = {}) {
  const calls = { lhInserts: [] as any[][], logRows: [] as any[] };
  const client: any = {
    from(table: string) {
      return {
        insert(rows: any) {
          const arr = Array.isArray(rows) ? rows : [rows];
          if (table === "data_refresh_log") {
            if (opts.logThrows) throw new Error("log insert boom");
            calls.logRows.push(arr[0]);
            return Promise.resolve({ error: null });
          }
          calls.lhInserts.push(arr);
          const bad = arr.find((r: any) => r.__bad === true);
          return Promise.resolve({ error: bad ? { message: `rejected row id=${bad.id}` } : null });
        },
      };
    },
  };
  return { client, calls };
}
const good = (id: number) => ({ id, game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "over", recorded_at: "t" });
const bad = (id: number) => ({ ...good(id), __bad: true });

(async () => {
  console.log("━━━ insertLineHistoryResilient ━━━");
  {
    const { client } = makeMock();
    const r = await insertLineHistoryResilient(client, [good(1), good(2), good(3)]);
    check("all-good batch: all inserted, no failures", r.inserted === 3 && r.failed === 0 && r.firstError === null);
  }
  {
    // Duplicates (no unique constraint) are not rejected — both land.
    const { client } = makeMock();
    const r = await insertLineHistoryResilient(client, [good(1), good(1)]);
    check("duplicate rows do NOT reject the batch", r.inserted === 2 && r.failed === 0);
  }
  {
    // One bad row must not strand the rest of the slate.
    const { client, calls } = makeMock();
    const r = await insertLineHistoryResilient(client, [good(1), bad(2), good(3)]);
    check("one bad row isolated: good rows persist", r.inserted === 2 && r.failed === 1);
    check("captures firstError + offending sample", r.firstError === "rejected row id=2" && (r.failedSample as any)?.id === 2);
    check("fell back to row-by-row after chunk failure", calls.lhInserts.length === 1 + 3, `inserts=${calls.lhInserts.length}`);
  }
  {
    // Bad row in chunk 1 must not strand chunk 2 (chunkSize=2).
    const { client } = makeMock();
    const r = await insertLineHistoryResilient(client, [good(1), bad(2), good(3), good(4)], 2);
    check("bad row in chunk 1 does not strand chunk 2", r.inserted === 3 && r.failed === 1);
  }
  {
    const { client } = makeMock();
    const r = await insertLineHistoryResilient(client, []);
    check("empty payload: no-op", r.attempted === 0 && r.inserted === 0 && r.failed === 0);
  }

  console.log("\n━━━ logLineHistoryInsertFailure ━━━");
  {
    const { client, calls } = makeMock();
    await logLineHistoryInsertFailure(client, "refreshGameLinesV2", "mlb", { attempted: 10, inserted: 7, failed: 3, firstError: "rejected row id=2", failedSample: { id: 2 } });
    const row = calls.logRows[0];
    check("writes a data_refresh_log row", row != null && row.data_source === "line_history_insert_failure");
    check("status=failed, real error in error_message", row?.refresh_status === "failed" && /rejected row id=2/.test(row?.error_message ?? ""));
    check("records partial inserted count", row?.records_updated === 7);
  }
  {
    // Logger must never throw (logging cannot break a refresh).
    const { client } = makeMock({ logThrows: true });
    let threw = false;
    try { await logLineHistoryInsertFailure(client, "x", "mlb", { attempted: 1, inserted: 0, failed: 1, firstError: "e", failedSample: null }); }
    catch { threw = true; }
    check("logger swallows its own errors (never throws)", threw === false);
  }

  console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
  console.log("\n✅ Line history writer tests passed.");
})();
