/**
 * Lock-safety suite for the stream recompute path.
 * Proves: (a) respectLocks:true ALWAYS passed; (b) locked ids excluded before
 * recompute; (c) shadow writes nothing; (d) recomputeActive-off writes nothing;
 * (e) a fully-locked request never calls the runner (locked rows cannot be
 * mutated); plus CRON_SECRET auth on the same helper the route uses.
 * Run: npx tsx scripts/test-stream-recompute-locksafety.ts
 */
import { runStreamRecompute, type RunSlateFn, type SlateRunOutcome } from "../lib/streaming/streamRecompute";
import { validateCronAuth } from "../lib/cron/auth";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

type Call = { sport: string; date: string; stage: string; opts: { writeToDb: boolean; gameExternalIdsFilter: number[]; respectLocks: boolean } };
function makeRunner(): { fn: RunSlateFn; calls: Call[] } {
  const calls: Call[] = [];
  const fn: RunSlateFn = async (sport, date, stage, opts): Promise<SlateRunOutcome> => {
    calls.push({ sport, date, stage, opts });
    return { game_count: opts.gameExternalIdsFilter.length, db_writes: opts.writeToDb ? {} : null };
  };
  return { fn, calls };
}
const lockedReader = (locked: number[]) => async () => new Set(locked);

async function main() {
  // (a) respectLocks ALWAYS true; ids pass through as filter.
  {
    const { fn, calls } = makeRunner();
    await runStreamRecompute(
      { sport: "mlb", date: "2026-06-16", gameExternalIds: [1, 2, 3], shadow: false },
      { runSlate: fn, readLockedExternalIds: lockedReader([]), recomputeActive: true },
    );
    check("runner called once", calls.length === 1);
    check("respectLocks:true ALWAYS", calls[0].opts.respectLocks === true);
    check("stage = morning_draft", calls[0].stage === "morning_draft");
    check("filter = requested ids", JSON.stringify(calls[0].opts.gameExternalIdsFilter) === JSON.stringify([1, 2, 3]));
  }

  // (b) locked ids excluded BEFORE recompute.
  {
    const { fn, calls } = makeRunner();
    const res = await runStreamRecompute(
      { sport: "mlb", date: "2026-06-16", gameExternalIds: [1, 2, 3], shadow: false },
      { runSlate: fn, readLockedExternalIds: lockedReader([2]), recomputeActive: true },
    );
    check("locked id excluded from filter", JSON.stringify(calls[0].opts.gameExternalIdsFilter) === JSON.stringify([1, 3]));
    check("excludedLocked reported", JSON.stringify(res.excludedLocked) === JSON.stringify([2]));
    check("respectLocks still true with exclusions", calls[0].opts.respectLocks === true);
  }

  // (e) ALL requested locked → runner NOT called (locked rows can't be mutated).
  {
    const { fn, calls } = makeRunner();
    const res = await runStreamRecompute(
      { sport: "mlb", date: "2026-06-16", gameExternalIds: [5, 6], shadow: false },
      { runSlate: fn, readLockedExternalIds: lockedReader([5, 6]), recomputeActive: true },
    );
    check("all-locked → runner NOT called", calls.length === 0);
    check("all-locked → ran:false", res.ran === false);
    check("all-locked → ok:true (clean no-op)", res.ok === true);
    check("all-locked → excludedLocked = both", JSON.stringify(res.excludedLocked) === JSON.stringify([5, 6]));
  }

  // (c) SHADOW writes nothing (even with recomputeActive).
  {
    const { fn, calls } = makeRunner();
    const res = await runStreamRecompute(
      { sport: "mlb", date: "2026-06-16", gameExternalIds: [1], shadow: true },
      { runSlate: fn, readLockedExternalIds: lockedReader([]), recomputeActive: true },
    );
    check("shadow → writeToDb:false", calls[0].opts.writeToDb === false);
    check("shadow → wroteToDb false", res.wroteToDb === false);
  }

  // shadow DEFAULTS to true when omitted (safety).
  {
    const { fn, calls } = makeRunner();
    await runStreamRecompute(
      { sport: "mlb", date: "2026-06-16", gameExternalIds: [1] },
      { runSlate: fn, readLockedExternalIds: lockedReader([]), recomputeActive: true },
    );
    check("shadow defaults true → writeToDb:false", calls[0].opts.writeToDb === false);
  }

  // (d) recomputeActive OFF → never writes, even with shadow:false.
  {
    const { fn, calls } = makeRunner();
    await runStreamRecompute(
      { sport: "mlb", date: "2026-06-16", gameExternalIds: [1], shadow: false },
      { runSlate: fn, readLockedExternalIds: lockedReader([]), recomputeActive: false },
    );
    check("flag OFF → writeToDb:false", calls[0].opts.writeToDb === false);
  }

  // live write ONLY when recomputeActive AND shadow:false.
  {
    const { fn, calls } = makeRunner();
    const res = await runStreamRecompute(
      { sport: "mlb", date: "2026-06-16", gameExternalIds: [1], shadow: false },
      { runSlate: fn, readLockedExternalIds: lockedReader([]), recomputeActive: true },
    );
    check("active + !shadow → writeToDb:true", calls[0].opts.writeToDb === true);
    check("active + !shadow → wroteToDb true", res.wroteToDb === true);
  }

  // validation: invalid sport / date / empty ids never call the runner.
  {
    const { fn, calls } = makeRunner();
    const r1 = await runStreamRecompute({ sport: "hockey", date: "2026-06-16", gameExternalIds: [1] }, { runSlate: fn, readLockedExternalIds: lockedReader([]), recomputeActive: true });
    check("invalid sport → ok:false", r1.ok === false);
    const r2 = await runStreamRecompute({ sport: "mlb", date: "06/16/2026", gameExternalIds: [1] }, { runSlate: fn, readLockedExternalIds: lockedReader([]), recomputeActive: true });
    check("invalid date → ok:false", r2.ok === false);
    const r3 = await runStreamRecompute({ sport: "mlb", date: "2026-06-16", gameExternalIds: [] }, { runSlate: fn, readLockedExternalIds: lockedReader([]), recomputeActive: true });
    check("empty ids → ok:true ran:false", r3.ok === true && r3.ran === false);
    check("validation failures never call runner", calls.length === 0);
  }

  // CRON_SECRET auth (same helper the route calls).
  {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test_secret";
    const good = validateCronAuth(new Request("https://x/api/internal/stream-recompute", { headers: { Authorization: "Bearer test_secret" } }));
    check("correct bearer → ok", good.ok === true);
    const bad = validateCronAuth(new Request("https://x/api/internal/stream-recompute", { headers: { Authorization: "Bearer wrong" } }));
    check("wrong bearer → 401", bad.ok === false && (bad as { response: Response }).response.status === 401);
    const none = validateCronAuth(new Request("https://x/api/internal/stream-recompute"));
    check("missing bearer → 401", none.ok === false && (none as { response: Response }).response.status === 401);
    delete process.env.CRON_SECRET;
    const misconfigured = validateCronAuth(new Request("https://x/api/internal/stream-recompute", { headers: { Authorization: "Bearer test_secret" } }));
    check("no CRON_SECRET set → 500", misconfigured.ok === false && (misconfigured as { response: Response }).response.status === 500);
    if (prev !== undefined) process.env.CRON_SECRET = prev;
  }
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); });
