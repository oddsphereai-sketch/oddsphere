import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NHL_DAILY_STATS_RECEIPT_RELEASE, nhlDailyStatsReceiptKey, nhlDailyStatsRecoveryDue,
  readNhlDailyStatsCompletion, recordNhlDailyStatsCompletion,
} from "../lib/services/nhl/nhlDailyStatsRecovery";

async function main() {
  let receipt: Record<string, unknown> | null = null;
  const writes: Record<string, unknown>[] = [];
  const client = { from: (table: string) => {
    assert.equal(table, "lab_response_snapshots");
    return {
      select: () => ({ eq: (_column: string, key: string) => {
        assert.equal(key, nhlDailyStatsReceiptKey(2026));
        return { maybeSingle: async () => ({ data: receipt ? { payload: receipt } : null, error: null }) };
      } }),
      upsert: async (row: Record<string, unknown>) => {
        assert.equal(row.snapshot_key, nhlDailyStatsReceiptKey(2026), "completion cannot overwrite any member or locked snapshot");
        writes.push(row); receipt = row.payload as Record<string, unknown>;
        return { error: null };
      },
    };
  } } as unknown as Parameters<typeof readNhlDailyStatsCompletion>[0];
  const day = "2026-11-01", later = new Date("2026-11-01T12:18:00Z");
  assert.equal(nhlDailyStatsRecoveryDue(new Date("2026-11-01T11:18:00Z"), day, null), false);
  assert.equal(nhlDailyStatsRecoveryDue(new Date("2026-11-02T00:18:00Z"), day, null), true,
    "UTC midnight cannot cancel a missed ET-day recovery during the evening slate");
  // A skipped full run writes no success receipt. A later invocation of the
  // same leased writer must recover, including after process/cold-start loss.
  assert.equal(nhlDailyStatsRecoveryDue(later, day, await readNhlDailyStatsCompletion(client, 2026, later)), true);
  await assert.rejects(recordNhlDailyStatsCompletion(client, { season: 2026, slateDate: day, now: later, teamRows: 160, goalieRows: 0 }));
  assert.equal(writes.length, 0, "a partial scrape cannot suppress the next recovery attempt");
  await recordNhlDailyStatsCompletion(client, { season: 2026, slateDate: day, now: later, teamRows: 160, goalieRows: 360 });
  assert.equal(nhlDailyStatsRecoveryDue(new Date("2026-11-01T12:48:00Z"), day,
    await readNhlDailyStatsCompletion(client, 2026, later)), false, "later intraday runs stay lightweight once both packs succeed");
  assert.equal(nhlDailyStatsRecoveryDue(new Date("2026-11-02T12:18:00Z"), "2026-11-02", day), true, "yesterday's receipt cannot satisfy today's stats");
  receipt = { release: NHL_DAILY_STATS_RECEIPT_RELEASE, season: 2026, slateDate: day, completedAt: "2026-11-02T12:00:00Z" };
  assert.equal(await readNhlDailyStatsCompletion(client, 2026, later), null, "future receipts never count as a completed scrape");
  const route = readFileSync("app/api/cron/nhl-daily-refresh/route.ts", "utf8");
  assert.match(route, /leaseGroup:\s*"prediction_pipeline"/);
  assert.match(route, /requireLease:\s*true/);
  assert.match(route, /refreshStableInputs && teamStatsComplete && goalieStatsComplete/);
  assert.match(route, /intraday_stats_recovery/);
  console.log("NHL daily stats recovery: skipped/partial run catches up, durable success stops repeat scraping, next-day/future receipts and locked namespaces are protected");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
