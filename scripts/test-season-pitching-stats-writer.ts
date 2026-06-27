/**
 * Phase 4.2.C.1.R-11 — unit tests for the season pitching stats
 * writer + payload shape. No HTTP, no DB.
 *
 * Covers:
 *   • buildSeasonPayload column-name mapping
 *   • payload NEVER includes first_inning_* keys (R-11 invariant)
 *   • dry-run path: no DB call, returns intended_update with payload
 *   • empty-record skip path
 *   • Cole-style nulled-cleanup guard via a stubbed client
 *   • write-gate helper isWriteGateOpen
 */

import {
  buildSeasonPayload,
  persistSeasonPitchingStats,
  isWriteGateOpen,
  SEASON_PITCHING_WRITE_ENV_FLAG,
} from "../lib/services/seasonPitchingStatsWriter";
import type { PitcherSeasonStatsRecord } from "../lib/providers/real_api/_mlbStatsApiClient";

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

function sampleRecord(overrides: Partial<PitcherSeasonStatsRecord> = {}): PitcherSeasonStatsRecord {
  return {
    mlb_person_id: 519242,
    season: 2026,
    games_played: 11,
    games_started: 11,
    wins: 8,
    losses: 3,
    era: 2.01,
    whip: 0.94,
    innings_pitched: 67.0,
    hits_allowed: 41,
    earned_runs: 15,
    home_runs_allowed: 4,
    walks: 17,
    strikeouts: 80,
    strikeouts_per_9: 10.75,
    saves: 0,
    holds: 0,
    raw_source: "mlb_stats_api",
    ...overrides,
  };
}

// ─── 1. buildSeasonPayload ──────────────────────────────────────────

function test_PayloadShape() {
  section("buildSeasonPayload — column-name mapping");
  const rec = sampleRecord();
  const p = buildSeasonPayload(13794, 2026, rec);
  check("payload.player_id === 13794", p.player_id === 13794);
  check("payload.season === 2026", p.season === 2026);
  check("payload.season_type === 'regular'", p.season_type === "regular");
  check("games_played → pitching_gp", p.pitching_gp === 11);
  check("games_started → pitching_gs", p.pitching_gs === 11);
  check("wins → pitching_w", p.pitching_w === 8);
  check("losses → pitching_l", p.pitching_l === 3);
  check("era → pitching_era", p.pitching_era === 2.01);
  check("whip → pitching_whip", p.pitching_whip === 0.94);
  check("innings_pitched → pitching_ip", p.pitching_ip === 67.0);
  check("hits_allowed → pitching_h", p.pitching_h === 41);
  check("earned_runs → pitching_er", p.pitching_er === 15);
  check("home_runs_allowed → pitching_hr", p.pitching_hr === 4);
  check("walks → pitching_bb", p.pitching_bb === 17);
  check("strikeouts → pitching_k", p.pitching_k === 80);
  check("strikeouts_per_9 → pitching_k_per_9", p.pitching_k_per_9 === 10.75);
  check("saves → pitching_sv", p.pitching_sv === 0);
  check("holds → pitching_hld", p.pitching_hld === 0);
  check("payload.updated_at is a non-empty ISO string", typeof p.updated_at === "string" && (p.updated_at as string).length > 0);
}

function test_PayloadNeverHasFirstInning() {
  section("R-11 invariant: payload NEVER contains first_inning_* keys");
  const rec = sampleRecord();
  const p = buildSeasonPayload(13794, 2026, rec);
  const fiKeys = Object.keys(p).filter((k) => k.startsWith("first_inning_"));
  check(
    "no first_inning_* key appears in payload",
    fiKeys.length === 0,
    fiKeys.length > 0 ? `found: ${fiKeys.join(", ")}` : undefined
  );
}

function test_PayloadCarriesNulls() {
  section("buildSeasonPayload — null fields pass through (no fake defaults)");
  const rec = sampleRecord({
    games_played: null,
    games_started: null,
    wins: null,
    era: null,
    whip: null,
  });
  const p = buildSeasonPayload(13794, 2026, rec);
  check("null games_played stays null", p.pitching_gp === null);
  check("null era stays null", p.pitching_era === null);
  check("null whip stays null", p.pitching_whip === null);
}

// ─── 2. persistSeasonPitchingStats — dry-run + skip paths ──────────

async function test_DryRunPath() {
  section("persistSeasonPitchingStats — dry-run path");
  const rec = sampleRecord();
  const r = await persistSeasonPitchingStats(13794, 2026, rec, {
    write: false,
    quiet: true,
  });
  check("kind === 'dry_run'", r.kind === "dry_run");
  if (r.kind !== "dry_run") return;
  const iu = r.intended_update as Record<string, unknown>;
  check("intended_update.table === 'player_season_stats'", iu.table === "player_season_stats");
  check("intended_update.op === 'upsert'", iu.op === "upsert");
  check(
    "intended_update.on_conflict === 'player_id,season,season_type'",
    iu.on_conflict === "player_id,season,season_type"
  );
  const payload = iu.payload as Record<string, unknown>;
  check("payload.player_id === 13794", payload.player_id === 13794);
  check(
    "no FI keys in dry-run payload",
    Object.keys(payload).every((k) => !k.startsWith("first_inning_"))
  );
}

async function test_SkipEmptyRecord() {
  section("persistSeasonPitchingStats — skips empty record");
  const rec = sampleRecord({ raw_source: "empty" });
  const r = await persistSeasonPitchingStats(13794, 2026, rec, {
    write: false,
    quiet: true,
  });
  check("kind === 'skipped_empty'", r.kind === "skipped_empty");
}

// ─── 3. Nulled-cleanup guard (write path with stubbed client) ──────

type StubResult = { data: unknown; error: { message: string } | null };

function makeStubClient(opts: {
  existingRow: Record<string, unknown> | null;
  upsertResult?: StubResult;
}): import("@supabase/supabase-js").SupabaseClient {
  // Minimal Supabase-shaped stub: chain `.from().select().eq().eq().eq().maybeSingle()`
  // returns existingRow; `.from().upsert().select()` returns upsertResult.
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({ data: opts.existingRow, error: null });
  chain.upsert = () => ({
    select: async () =>
      opts.upsertResult ?? { data: [{ id: 1 }], error: null },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return chain as any;
}

async function test_NulledCleanupGuard() {
  section("write path — Cole-style nulled-cleanup guard skips overwrite (5-field signature)");
  const client = makeStubClient({
    existingRow: {
      pitching_ip: null,
      pitching_era: null,
      pitching_k: null,
      batting_ab: null,
      first_inning_era: null, // 5th-field check — Cole row has FI null too
    },
  });
  const r = await persistSeasonPitchingStats(6271, 2025, sampleRecord(), {
    write: true,
    quiet: true,
    client,
  });
  check("kind === 'skipped_nulled_cleanup'", r.kind === "skipped_nulled_cleanup");
  if (r.kind === "skipped_nulled_cleanup") {
    check(
      "reason mentions cleanup-protected",
      r.reason.includes("cleanup-protected")
    );
  }
}

async function test_FiOnlyRowIsNotCleanup() {
  section("R-11 fix: FI-only row (pitching null, FI populated) is NOT cleanup");
  // The bug the R-11 dry-run caught: H-3a pitchers had FI-only rows
  // from R-2 step 5 that looked like Cole cleanup at the 4-field level.
  // The 5-field signature distinguishes them — first_inning_era IS
  // populated, so this row is NOT cleanup and the season write proceeds.
  const client = makeStubClient({
    existingRow: {
      pitching_ip: null,
      pitching_era: null,
      pitching_k: null,
      batting_ab: null,
      first_inning_era: 6.84, // <-- populated, so NOT cleanup
    },
  });
  const r = await persistSeasonPitchingStats(13801, 2026, sampleRecord(), {
    write: true,
    quiet: true,
    client,
  });
  check(
    "[R-11] FI-only row → UPSERTed (not skipped as cleanup)",
    r.kind === "updated"
  );
}

async function test_CurrentSeasonPlaceholderIsNotCleanup() {
  section("current-season all-null placeholder row is refillable");
  const client = makeStubClient({
    existingRow: {
      pitching_ip: null,
      pitching_era: null,
      pitching_k: null,
      batting_ab: null,
      first_inning_era: null,
    },
  });
  const r = await persistSeasonPitchingStats(14553, new Date().getUTCFullYear(), sampleRecord(), {
    write: true,
    quiet: true,
    client,
  });
  check("current-season placeholder → UPSERTed", r.kind === "updated");
}

async function test_WritePathAllowsNormalRow() {
  section("write path — normal existing row gets UPSERTed");
  const client = makeStubClient({
    existingRow: {
      pitching_ip: 55.0,
      pitching_era: 2.95,
      pitching_k: 40,
      batting_ab: null, // batters always null for pitchers — that's fine
      first_inning_era: 1.88,
    },
  });
  const r = await persistSeasonPitchingStats(6287, 2026, sampleRecord(), {
    write: true,
    quiet: true,
    client,
  });
  // batting_ab=null + other fields non-null → NOT the nulled signature → proceeds
  check("kind === 'updated'", r.kind === "updated");
}

async function test_WritePathInsertWhenNoRow() {
  section("write path — no existing row → INSERT via UPSERT");
  const client = makeStubClient({ existingRow: null });
  const r = await persistSeasonPitchingStats(13794, 2026, sampleRecord(), {
    write: true,
    quiet: true,
    client,
  });
  check("kind === 'updated'", r.kind === "updated");
}

// ─── 4. Write-gate helper ──────────────────────────────────────────

function test_WriteGateHelper() {
  section("isWriteGateOpen — two-key gate");
  check(
    "both flags true → open",
    isWriteGateOpen({ cliWriteFlag: true, envFlagValue: "true" }) === true
  );
  check(
    "cli only → closed",
    isWriteGateOpen({ cliWriteFlag: true, envFlagValue: undefined }) === false
  );
  check(
    "env only → closed",
    isWriteGateOpen({ cliWriteFlag: false, envFlagValue: "true" }) === false
  );
  check(
    "env value 'false' → closed",
    isWriteGateOpen({ cliWriteFlag: true, envFlagValue: "false" }) === false
  );
  check(
    "env value 'TRUE' (case-sensitive) → closed",
    isWriteGateOpen({ cliWriteFlag: true, envFlagValue: "TRUE" }) === false
  );
  check(
    "env flag name constant",
    SEASON_PITCHING_WRITE_ENV_FLAG === "SEASON_PITCHING_DB_WRITES_ENABLED"
  );
}

// ─── runner ─────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.C.1.R-11 — season pitching stats writer tests");
  console.log("=======================================================");

  test_PayloadShape();
  test_PayloadNeverHasFirstInning();
  test_PayloadCarriesNulls();
  await test_DryRunPath();
  await test_SkipEmptyRecord();
  await test_NulledCleanupGuard();
  await test_FiOnlyRowIsNotCleanup();
  await test_CurrentSeasonPlaceholderIsNotCleanup();
  await test_WritePathAllowsNormalRow();
  await test_WritePathInsertWhenNoRow();
  test_WriteGateHelper();

  console.log();
  console.log("=======================================================");
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
