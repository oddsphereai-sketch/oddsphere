/**
 * Phase 4.2.B — Integration test for the Layer 1 ingester lock guard.
 *
 * Uses a hand-built fake SupabaseClient (no real DB I/O) to verify:
 *   • Cron writes to locked rows are SKIPPED (pushed to result.failed
 *     with a "locked:" error marker)
 *   • Manual override (is_override=true on the incoming row) BYPASSES
 *     the guard and writes successfully
 *   • Unlocked rows pass through cleanly
 *   • Mixed batch: some locked, some unlocked → only unlocked rows hit
 *     the upsert payload
 *   • Result accounting (inserted/updated) only counts rows that
 *     actually hit the UPSERT
 *
 * Run: npx tsx --env-file=.env.local scripts/test-ingester-lock-guard.ts
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ingestScoresModel,
  type ScoresModelInputRow,
} from "../lib/scoresModel/ingester";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

// ──────────────────────────────────────────────────────────────────────
// Fake Supabase — captures upserts + serves canned existing-row reads
// ──────────────────────────────────────────────────────────────────────

type FakeOpts = {
  /** game_id → existing row state for the pre-upsert SELECT. */
  existingByGameId: Map<number, { game_id: number; locked_at: string | null; is_override: boolean }>;
  /** Optional: simulate the UPSERT failing on game_predictions. */
  upsertFails?: { table: "game_predictions"; message: string };
};

type CapturedUpsert = {
  table: string;
  payload: Record<string, unknown>[];
  options?: { onConflict?: string };
};

function createFakeClient(opts: FakeOpts) {
  const upserts: CapturedUpsert[] = [];

  function from(table: string) {
    if (table === "game_predictions") {
      return {
        select(_cols: string) {
          return {
            in: async (
              _col: string,
              ids: number[]
            ): Promise<{ data: typeof opts.existingByGameId extends Map<number, infer T> ? T[] : never; error: null }> => {
              const rows: Array<{ game_id: number; locked_at: string | null; is_override: boolean }> = [];
              for (const id of ids) {
                const r = opts.existingByGameId.get(id);
                if (r !== undefined) rows.push(r);
              }
              return {
                data: rows as unknown as ReturnType<typeof from>["select"] extends never ? never : never,
                error: null,
              } as unknown as { data: typeof opts.existingByGameId extends Map<number, infer T> ? T[] : never; error: null };
            },
          };
        },
        async upsert(
          payload: Record<string, unknown>[],
          options?: { onConflict?: string }
        ) {
          upserts.push({ table, payload, options });
          if (opts.upsertFails?.table === table) {
            return { error: { message: opts.upsertFails.message } };
          }
          return { error: null };
        },
      };
    }
    if (table === "scores_model_runs") {
      // The audit upsert is also captured but always succeeds for these
      // tests — the lock guard is independent of audit success.
      return {
        upsert(payload: Record<string, unknown>) {
          upserts.push({ table, payload: [payload] });
          return {
            select: (_cols: string) => ({
              single: async () => ({ data: { id: 9999 }, error: null }),
            }),
          };
        },
      };
    }
    throw new Error(`fake client: unexpected table=${table}`);
  }
  return {
    client: { from } as unknown as SupabaseClient,
    upserts,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Fixture builder — a valid auto-model row that passes the validator
// ──────────────────────────────────────────────────────────────────────

function makeRow(
  game_external_id: number,
  overrides: Partial<ScoresModelInputRow> = {}
): ScoresModelInputRow {
  return {
    game_external_id,
    predicted_home_score: 4.5,
    predicted_away_score: 3.8,
    predicted_total: 8.3,
    predicted_ml_winner: "home",
    ml_confidence: 60,
    predicted_ou_side: "over",
    ou_confidence: 55,
    predicted_nrfi: true,
    nrfi_confidence: 62,
    sport_specific: {
      // auto_model validation mode lets pick fields be null when justified;
      // here we provide all picks so manual mode would also pass.
      auto_factors: { nrfi_expected_runs: 0.78 },
    },
    model_version: "auto_v1",
    computed_at: "2026-06-03T13:05:24.000Z",
    ...overrides,
  };
}

const gameIdByExternal = new Map<number, number>([
  [100, 1001],
  [101, 1002],
  [102, 1003],
  [103, 1004],
]);

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

async function testLockedRowSkipped() {
  section("Locked row + cron write → row pushed to failed with 'locked:' marker");

  const { client, upserts } = createFakeClient({
    existingByGameId: new Map([
      [1001, { game_id: 1001, locked_at: "2026-06-03T17:30:00.000Z", is_override: false }],
    ]),
  });

  const result = await ingestScoresModel(
    client,
    "mlb",
    [makeRow(100)],
    gameIdByExternal,
    { source: "auto_v1_mlb_rules", validationMode: "auto_model" }
  );

  check("result.failed has 1 entry", result.failed.length === 1);
  check(
    "failure carries 'locked:' error marker",
    result.failed[0]?.errors[0]?.startsWith("locked:") === true,
    `got "${result.failed[0]?.errors[0] ?? ""}"`
  );
  check("result.inserted === 0", result.inserted === 0);
  check("result.updated === 0", result.updated === 0);
  // The audit row was still written (scores_model_runs) but no upsert
  // against game_predictions because writable.length was 0.
  const gpUpserts = upserts.filter((u) => u.table === "game_predictions");
  check("NO upsert against game_predictions", gpUpserts.length === 0);
}

async function testManualOverrideBypassesLock() {
  section("Locked row + incoming is_override=true → bypass guard, write");

  const { client, upserts } = createFakeClient({
    existingByGameId: new Map([
      [1001, { game_id: 1001, locked_at: "2026-06-03T17:30:00.000Z", is_override: false }],
    ]),
  });

  const result = await ingestScoresModel(
    client,
    "mlb",
    [makeRow(100, { is_override: true })],
    gameIdByExternal,
    { source: "manual_daniel" }
  );

  check("result.failed is empty (manual override bypassed)", result.failed.length === 0);
  check("result.updated === 1 (existing row, overridden)", result.updated === 1);
  const gpUpserts = upserts.filter((u) => u.table === "game_predictions");
  check("ONE upsert against game_predictions", gpUpserts.length === 1);
  check(
    "upsert payload includes the overridden game_id",
    gpUpserts[0]?.payload.some((p) => p.game_id === 1001) ?? false
  );
}

async function testUnlockedRowPassesThrough() {
  section("Unlocked row → normal pass-through");

  const { client, upserts } = createFakeClient({
    existingByGameId: new Map([
      [1001, { game_id: 1001, locked_at: null, is_override: false }],
    ]),
  });

  const result = await ingestScoresModel(
    client,
    "mlb",
    [makeRow(100)],
    gameIdByExternal,
    { source: "auto_v1_mlb_rules", validationMode: "auto_model" }
  );

  check("result.failed is empty", result.failed.length === 0);
  check("result.updated === 1 (row existed, no insert)", result.updated === 1);
  check("result.inserted === 0", result.inserted === 0);
  const gpUpserts = upserts.filter((u) => u.table === "game_predictions");
  check("ONE upsert against game_predictions", gpUpserts.length === 1);
}

async function testNewRowInsertsCleanly() {
  section("No existing row + unlocked → INSERT path");

  const { client, upserts } = createFakeClient({
    existingByGameId: new Map(),
  });

  const result = await ingestScoresModel(
    client,
    "mlb",
    [makeRow(100)],
    gameIdByExternal,
    { source: "auto_v1_mlb_rules", validationMode: "auto_model" }
  );

  check("result.failed is empty", result.failed.length === 0);
  check("result.inserted === 1", result.inserted === 1);
  check("result.updated === 0", result.updated === 0);
  const gpUpserts = upserts.filter((u) => u.table === "game_predictions");
  check("ONE upsert against game_predictions", gpUpserts.length === 1);
}

async function testMixedBatch() {
  section("Mixed batch: 2 locked + 2 unlocked → 2 written, 2 skipped");

  const { client, upserts } = createFakeClient({
    existingByGameId: new Map([
      [1001, { game_id: 1001, locked_at: "2026-06-03T17:30:00.000Z", is_override: false }],
      [1002, { game_id: 1002, locked_at: null, is_override: false }],
      [1003, { game_id: 1003, locked_at: "2026-06-03T17:35:00.000Z", is_override: false }],
      [1004, { game_id: 1004, locked_at: null, is_override: false }],
    ]),
  });

  const result = await ingestScoresModel(
    client,
    "mlb",
    [makeRow(100), makeRow(101), makeRow(102), makeRow(103)],
    gameIdByExternal,
    { source: "auto_v1_mlb_rules", validationMode: "auto_model" }
  );

  check("2 rows in failed (the locked ones)", result.failed.length === 2);
  check(
    "all failures carry 'locked:' marker",
    result.failed.every((f) => f.errors[0]?.startsWith("locked:") === true)
  );
  check(
    "failed external_ids are 100 and 102",
    new Set(result.failed.map((f) => f.row.game_external_id)).has(100) &&
      new Set(result.failed.map((f) => f.row.game_external_id)).has(102)
  );
  check("result.updated === 2 (the unlocked existing rows)", result.updated === 2);
  check("result.inserted === 0 (all existed)", result.inserted === 0);
  const gpUpserts = upserts.filter((u) => u.table === "game_predictions");
  check("ONE upsert against game_predictions", gpUpserts.length === 1);
  check(
    "upsert payload contains exactly 2 rows",
    gpUpserts[0]?.payload.length === 2
  );
  const upsertedIds = new Set(gpUpserts[0]?.payload.map((p) => p.game_id) ?? []);
  check("upsert includes game_id=1002 (unlocked)", upsertedIds.has(1002));
  check("upsert includes game_id=1004 (unlocked)", upsertedIds.has(1004));
  check("upsert does NOT include game_id=1001 (locked)", !upsertedIds.has(1001));
  check("upsert does NOT include game_id=1003 (locked)", !upsertedIds.has(1003));
}

async function testMixedWithOverride() {
  section("Mixed batch with manual override on a locked row → override bypasses");

  const { client, upserts } = createFakeClient({
    existingByGameId: new Map([
      [1001, { game_id: 1001, locked_at: "2026-06-03T17:30:00.000Z", is_override: false }], // locked
      [1002, { game_id: 1002, locked_at: null, is_override: false }],                       // unlocked
      [1003, { game_id: 1003, locked_at: "2026-06-03T17:35:00.000Z", is_override: false }], // locked but override
    ]),
  });

  const result = await ingestScoresModel(
    client,
    "mlb",
    [
      makeRow(100),                          // locked, no override → skipped
      makeRow(101),                          // unlocked → write
      makeRow(102, { is_override: true }),   // locked + override → write
    ],
    gameIdByExternal,
    { source: "manual_daniel" }
  );

  check("exactly 1 row failed (the un-overridden locked one)", result.failed.length === 1);
  check(
    "failed row is external_id=100 (the un-overridden locked)",
    result.failed[0]?.row.game_external_id === 100
  );
  check("result.updated === 2 (1002 + 1003)", result.updated === 2);

  const gpUpserts = upserts.filter((u) => u.table === "game_predictions");
  const upsertedIds = new Set(gpUpserts[0]?.payload.map((p) => p.game_id) ?? []);
  check("upsert includes 1002", upsertedIds.has(1002));
  check("upsert includes 1003 (manual override)", upsertedIds.has(1003));
  check("upsert does NOT include 1001 (no override)", !upsertedIds.has(1001));
}

async function testAuditCounts() {
  section("Audit row reflects writable count, not validated count");

  const { client, upserts } = createFakeClient({
    existingByGameId: new Map([
      [1001, { game_id: 1001, locked_at: "2026-06-03T17:30:00.000Z", is_override: false }],
      [1002, { game_id: 1002, locked_at: null, is_override: false }],
    ]),
  });

  await ingestScoresModel(
    client,
    "mlb",
    [makeRow(100), makeRow(101)],
    gameIdByExternal,
    { source: "auto_v1_mlb_rules", validationMode: "auto_model" }
  );

  const auditUpserts = upserts.filter((u) => u.table === "scores_model_runs");
  check("audit row written", auditUpserts.length === 1);
  const audit = auditUpserts[0]?.payload[0] as Record<string, unknown> | undefined;
  check(
    "audit successful_count === 1 (writable, not validated)",
    audit?.successful_count === 1,
    `got ${audit?.successful_count}`
  );
  check(
    "audit failed_count === 1 (the locked-skip row)",
    audit?.failed_count === 1,
    `got ${audit?.failed_count}`
  );
  check(
    "audit error_messages mentions 'locked'",
    Array.isArray(audit?.error_messages) &&
      (audit.error_messages as string[]).some((m) => m.includes("locked"))
  );
}

// ──────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.B — ingester Layer 1 lock-guard tests");
  console.log("===============================================");

  await testLockedRowSkipped();
  await testManualOverrideBypassesLock();
  await testUnlockedRowPassesThrough();
  await testNewRowInsertsCleanly();
  await testMixedBatch();
  await testMixedWithOverride();
  await testAuditCounts();

  console.log();
  console.log("===============================================");
  console.log(`Total: ${pass + fail}  pass: ${pass}  fail: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
