/**
 * Phase 4.2.C.1.F — pure unit tests for `lib/services/firstInningResolver.ts`.
 * No HTTP, no DB. Covers the ID-resolution priority logic and the
 * nulled-cleanup guard.
 *
 * Slate-loading is DB-bound and exercised via the operator dry-run
 * smoke against a real slate, not here.
 */

import {
  dedupePlayerIds,
  isFullyNulledSeasonRow,
  resolveMlbStatsIdFromDbRow,
} from "../lib/services/firstInningResolver";

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

// ─────────────────────────────────────────────────────────────────────
// resolveMlbStatsIdFromDbRow — priority order
// ─────────────────────────────────────────────────────────────────────

async function testResolve_PrefersProviderIdsMlbStats() {
  section("resolveMlbStatsIdFromDbRow — prefers provider_ids.mlb_stats.id");
  const row = {
    mlb_person_id: 12345,
    dob: "1990-01-01",
    provider_ids: { mlb_stats: { id: 99999 } },
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("kind === 'ok'", r.kind === "ok");
  if (r.kind === "ok") {
    check("source === 'provider_ids_mlb_stats'", r.source === "provider_ids_mlb_stats");
    check("mlbId === 99999 (provider_ids wins over mlb_person_id)", r.mlbId === 99999);
  }
}

async function testResolve_FallsBackToMlbPersonId() {
  section("resolveMlbStatsIdFromDbRow — falls back to players.mlb_person_id");
  const row = {
    mlb_person_id: 543037,
    dob: "1990-09-08",
    provider_ids: {},
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("kind === 'ok'", r.kind === "ok");
  if (r.kind === "ok") {
    check("source === 'players_mlb_person_id'", r.source === "players_mlb_person_id");
    check("mlbId === 543037", r.mlbId === 543037);
  }
}

async function testResolve_FallsBackToMlbPersonIdWhenProviderIdsHasNoMlbStats() {
  section("resolveMlbStatsIdFromDbRow — provider_ids without mlb_stats key → mlb_person_id");
  const row = {
    mlb_person_id: 543037,
    dob: "1990-09-08",
    provider_ids: { bdl: { id: 569 } }, // bdl present, mlb_stats missing
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("kind === 'ok'", r.kind === "ok");
  if (r.kind === "ok") {
    check("source === 'players_mlb_person_id'", r.source === "players_mlb_person_id");
    check("mlbId === 543037", r.mlbId === 543037);
  }
}

async function testResolve_FallsBackToMlbPersonIdWhenMlbStatsIdIsString() {
  section("resolveMlbStatsIdFromDbRow — non-number mlb_stats.id → falls through");
  const row = {
    mlb_person_id: 543037,
    dob: "1990-09-08",
    provider_ids: { mlb_stats: { id: "not-a-number" } },
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("falls through to mlb_person_id (string id is invalid)", r.kind === "ok");
  if (r.kind === "ok") check("source === 'players_mlb_person_id'", r.source === "players_mlb_person_id");
}

async function testResolve_NeedsSearchWhenNoIdInDb() {
  section("resolveMlbStatsIdFromDbRow — both ids null + dob present → needs_search");
  const row = {
    mlb_person_id: null,
    dob: "1990-01-01",
    provider_ids: null,
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("kind === 'needs_search'", r.kind === "needs_search");
  if (r.kind === "needs_search") {
    check("reason === 'no_id_in_db'", r.reason === "no_id_in_db");
  }
}

async function testResolve_NeedsSearchWhenProviderIdsEmpty() {
  section("resolveMlbStatsIdFromDbRow — empty provider_ids + null mlb_person_id → needs_search");
  const row = {
    mlb_person_id: null,
    dob: "1990-01-01",
    provider_ids: {},
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("kind === 'needs_search'", r.kind === "needs_search");
}

async function testResolve_SkipWhenNoIdAndNoDob() {
  section("resolveMlbStatsIdFromDbRow — both ids null AND dob null → skip");
  const row = {
    mlb_person_id: null,
    dob: null,
    provider_ids: null,
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("kind === 'skip'", r.kind === "skip");
  if (r.kind === "skip") {
    check("reason === 'missing_dob'", r.reason === "missing_dob");
  }
}

async function testResolve_HandlesNullProviderIds() {
  section("resolveMlbStatsIdFromDbRow — null provider_ids is safe (no crash)");
  const row = {
    mlb_person_id: 12345,
    dob: "1990-01-01",
    provider_ids: null,
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("kind === 'ok' (falls back to mlb_person_id)", r.kind === "ok");
  if (r.kind === "ok") check("mlbId === 12345", r.mlbId === 12345);
}

async function testResolve_AaronJudgeRealFixture() {
  section("resolveMlbStatsIdFromDbRow — Aaron Judge (real-data fixture)");
  // Reproduces the actual shape of Judge's row post-Phase-4.2.C.1.M
  const row = {
    mlb_person_id: null, // Judge was in the 67 who got provider_ids.mlb_stats but no mlb_person_id write
    dob: "1992-04-26",
    provider_ids: {
      bdl: { id: 569, confidence: "high", mapped_via: "name_dob_v1" },
      mlb_stats: { id: 592450, last_seen_at: "2026-06-03T..." },
    },
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("kind === 'ok'", r.kind === "ok");
  if (r.kind === "ok") {
    check("source === 'provider_ids_mlb_stats' (mapping wins)", r.source === "provider_ids_mlb_stats");
    check("mlbId === 592450", r.mlbId === 592450);
  }
}

async function testResolve_GerritColeRealFixture() {
  section("resolveMlbStatsIdFromDbRow — Gerrit Cole (real-data fixture)");
  // Cole has BOTH mlb_person_id AND provider_ids.mlb_stats set (from
  // Phase 3.x + Phase 4.2.C.1.M). Provider_ids should win.
  const row = {
    mlb_person_id: 543037,
    dob: "1990-09-08",
    provider_ids: {
      bdl: { id: 380 },
      mlb_stats: { id: 543037 },
    },
  };
  const r = resolveMlbStatsIdFromDbRow(row);
  check("source === 'provider_ids_mlb_stats'", r.kind === "ok" && r.source === "provider_ids_mlb_stats");
  if (r.kind === "ok") check("mlbId === 543037", r.mlbId === 543037);
}

// ─────────────────────────────────────────────────────────────────────
// isFullyNulledSeasonRow — Cole-guard
// ─────────────────────────────────────────────────────────────────────

async function testNulledGuard_ColeSignature() {
  section("isFullyNulledSeasonRow — Cole-style nulled row → true");
  const row = {
    pitching_ip: null,
    pitching_era: null,
    pitching_k: null,
    batting_ab: null,
  };
  check("returns true", isFullyNulledSeasonRow(row) === true);
}

async function testNulledGuard_NormalPitcher() {
  section("isFullyNulledSeasonRow — normal pitcher (Skubal) → false");
  const row = {
    pitching_ip: 195.333,
    pitching_era: 2.21,
    pitching_k: 241,
    batting_ab: null, // batting null is normal for a pitcher
  };
  check("returns false (pitching_* populated)", isFullyNulledSeasonRow(row) === false);
}

async function testNulledGuard_NormalHitter() {
  section("isFullyNulledSeasonRow — normal hitter (Judge) → false");
  const row = {
    pitching_ip: null, // pitching null is normal for a hitter
    pitching_era: null,
    pitching_k: null,
    batting_ab: 541,
  };
  check("returns false (batting_ab populated)", isFullyNulledSeasonRow(row) === false);
}

async function testNulledGuard_PartialPitcher() {
  section("isFullyNulledSeasonRow — partial pitcher (only pitching_ip set) → false");
  const row = {
    pitching_ip: 50.0,
    pitching_era: null,
    pitching_k: null,
    batting_ab: null,
  };
  check("returns false (one pitching field populated)", isFullyNulledSeasonRow(row) === false);
}

async function testNulledGuard_NullRow() {
  section("isFullyNulledSeasonRow — null/undefined row → false (writer handles)");
  check("null → false", isFullyNulledSeasonRow(null) === false);
  check("undefined → false", isFullyNulledSeasonRow(undefined) === false);
}

// ─────────────────────────────────────────────────────────────────────
// dedupePlayerIds
// ─────────────────────────────────────────────────────────────────────

async function testDedupePlayerIds() {
  section("dedupePlayerIds");
  check("dedupes", JSON.stringify(dedupePlayerIds([6271, 6276, 6271, 6276])) === "[6271,6276]");
  check("sorts ascending", JSON.stringify(dedupePlayerIds([6276, 6271])) === "[6271,6276]");
  check("filters non-finite", JSON.stringify(dedupePlayerIds([6271, NaN, 6276])) === "[6271,6276]");
  check("filters non-positive", JSON.stringify(dedupePlayerIds([6271, 0, -5, 6276])) === "[6271,6276]");
  check("empty input → empty array", JSON.stringify(dedupePlayerIds([])) === "[]");
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.C.1.F — firstInningResolver unit tests");
  console.log("=================================================");

  await testResolve_PrefersProviderIdsMlbStats();
  await testResolve_FallsBackToMlbPersonId();
  await testResolve_FallsBackToMlbPersonIdWhenProviderIdsHasNoMlbStats();
  await testResolve_FallsBackToMlbPersonIdWhenMlbStatsIdIsString();
  await testResolve_NeedsSearchWhenNoIdInDb();
  await testResolve_NeedsSearchWhenProviderIdsEmpty();
  await testResolve_SkipWhenNoIdAndNoDob();
  await testResolve_HandlesNullProviderIds();
  await testResolve_AaronJudgeRealFixture();
  await testResolve_GerritColeRealFixture();
  await testNulledGuard_ColeSignature();
  await testNulledGuard_NormalPitcher();
  await testNulledGuard_NormalHitter();
  await testNulledGuard_PartialPitcher();
  await testNulledGuard_NullRow();
  await testDedupePlayerIds();

  console.log();
  console.log("=================================================");
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
