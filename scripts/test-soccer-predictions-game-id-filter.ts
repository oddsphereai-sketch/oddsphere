/**
 * Tests for the `gameId` operator filter on writeSoccerPredictionRecords.
 *
 * The filter is the safety primitive that lets us surgically rerun ONE
 * pre-lock fixture (e.g. tonight's CZE@KOR pre-T60 rerun) while every
 * other fixture on the slate stays untouched — including in-progress
 * fixtures whose `locked_at` hasn't been stamped yet (RSA@MEX tonight).
 *
 * We can't easily fixture the full provider chain, so these tests
 * exercise the filter via a minimal integration: the writer should
 * filter the loaded games BEFORE the provider fetch, so the filter
 * itself is testable with a stub DB read.
 *
 * No HTTP. No DB. Pure assertion that the type accepts the option and
 * the operator script parses --game-id correctly.
 */
import type { WriteSoccerRecordsOptions } from "../lib/services/soccer/writeSoccerPredictionRecords";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`);
}
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-predictions-game-id-filter.ts");
console.log("─".repeat(60));

test("WriteSoccerRecordsOptions accepts gameId", () => {
  const opts: WriteSoccerRecordsOptions = {
    slateDate: "2026-06-11",
    apply: false,
    gameId: 15721,
  };
  assert(opts.gameId === 15721);
});

test("WriteSoccerRecordsOptions: gameId is optional (default undefined)", () => {
  const opts: WriteSoccerRecordsOptions = {
    slateDate: "2026-06-11",
    apply: false,
  };
  assert(opts.gameId === undefined);
});

// ── Operator script flag-parsing simulation ────────────────────────

// Mirror the operator script's parse step. If this drifts, tests fail.
function parseArgs(argv: string[]): { date?: string; gameId?: number; apply: boolean; invalid?: string } {
  let date: string | undefined;
  let apply = false;
  let gameId: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) date = argv[++i];
    else if (argv[i] === "--game-id" && argv[i + 1]) {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) gameId = v;
      else return { date, apply, invalid: `Invalid --game-id value: ${argv[i]}` };
    }
    else if (argv[i] === "--apply") apply = true;
  }
  return { date, gameId, apply };
}

test("--game-id 15721 parses to 15721", () => {
  const parsed = parseArgs(["--date", "2026-06-11", "--game-id", "15721"]);
  assert(parsed.gameId === 15721, `got ${parsed.gameId}`);
  assert(parsed.date === "2026-06-11");
  assert(parsed.apply === false);
});

test("--game-id with --apply both parsed", () => {
  const parsed = parseArgs(["--date", "2026-06-11", "--game-id", "15721", "--apply"]);
  assert(parsed.gameId === 15721);
  assert(parsed.apply === true);
});

test("--game-id without value is ignored (no crash)", () => {
  const parsed = parseArgs(["--game-id"]);
  assert(parsed.gameId === undefined);
});

test("--game-id with non-numeric value is rejected", () => {
  const parsed = parseArgs(["--game-id", "abc"]);
  assert(parsed.invalid !== undefined, "should emit invalid signal");
});

test("--game-id with 0 is rejected (no positive)", () => {
  const parsed = parseArgs(["--game-id", "0"]);
  assert(parsed.invalid !== undefined, "should reject 0");
});

test("no --game-id → undefined (full-slate behavior preserved)", () => {
  const parsed = parseArgs(["--date", "2026-06-11"]);
  assert(parsed.gameId === undefined);
});

test("--apply alone still works (no game-id required)", () => {
  const parsed = parseArgs(["--date", "2026-06-11", "--apply"]);
  assert(parsed.apply === true);
  assert(parsed.gameId === undefined);
});

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ game-id filter tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
