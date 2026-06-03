/**
 * Phase 4.2.C.1.S.A — pure unit tests for the new BDL `/players/splits`
 * parser helpers. Fixture rows are derived from the actual probe data
 * captured in Phase 4.2.C.1.S Steps 1 + 2.
 *
 * No HTTP, no DB. Verifies:
 *   - mapBreakdownSplitNameToSplitType (string → split_type enum)
 *   - mapSplitsRowToSplitRecord (vs_lhp/vs_rhp/home/away/day/night)
 *   - mapSplitsRowToSeasonRecord (season aggregate + derived WHIP/K9/TB/PA)
 *   - computeWhip / computeKper9 / computeTotalBases / computePlateAppearances
 *     edge cases
 */

import {
  computeKper9,
  computePlateAppearances,
  computeTotalBases,
  computeWhip,
  mapBreakdownSplitNameToSplitType,
  mapSplitsRowToSeasonRecord,
  mapSplitsRowToSplitRecord,
} from "../lib/providers/real_api/BallDontLieProvider";

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

function approxEq(a: number | null, b: number, eps = 1e-6): boolean {
  if (a === null) return false;
  return Math.abs(a - b) < eps;
}

// ─────────────────────────────────────────────────────────────────────
// Fixture rows (from Phase 4.2.C.1.S Step 2 probe — Aaron Judge 2025)
// ─────────────────────────────────────────────────────────────────────

const judgeBdlId = 569;

// Real row from probe — "vs. Left" bucket
const vsLeftRow = {
  player: { id: judgeBdlId },
  season: 2025,
  category: "batting",
  split_category: "byBreakdown",
  split_name: "vs. Left",
  split_abbreviation: "vs. Left",
  at_bats: 123,
  hits: 42,
  home_runs: 16,
  walks: 37,
  strikeouts: 37,
  doubles: 5,
  triples: 0,
  rbis: 50,
  hit_by_pitch: 2,
  avg: 0.341,
  obp: 0.491,
  slg: 0.789,
  ops: 1.279,
};

// Real row from probe — "vs. Right" bucket
const vsRightRow = {
  player: { id: judgeBdlId },
  season: 2025,
  category: "batting",
  split_category: "byBreakdown",
  split_name: "vs. Right",
  split_abbreviation: "vs. Right",
  at_bats: 418,
  hits: 137,
  home_runs: 37,
  walks: 87,
  strikeouts: 123,
  doubles: 22,
  triples: 1,
  rbis: 100,
  hit_by_pitch: 5,
  avg: 0.328,
  obp: 0.446,
  slg: 0.658,
  ops: 1.104,
};

// Constructed season aggregate (data.split[0]) — sums of L+R approx
const seasonRowHitter = {
  player: { id: judgeBdlId },
  season: 2025,
  category: "batting",
  split_category: "split",
  split_name: "Season",
  at_bats: 541,
  hits: 179,
  home_runs: 53,
  walks: 124,
  strikeouts: 160,
  doubles: 27,
  triples: 1,
  rbis: 150,
  hit_by_pitch: 7,
  runs: 130,
  stolen_bases: 12,
  games_played: 158,
  avg: 0.331,
  obp: 0.457,
  slg: 0.701,
  ops: 1.158,
  // pitching fields null for hitter — endpoint may still surface them as 0/null
  era: null,
  innings_pitched: null,
  hits_allowed: null,
  walks_allowed: null,
  strikeouts_pitched: null,
};

// Constructed pitcher season aggregate (Skubal-style)
const seasonRowPitcher = {
  player: { id: 178 },
  season: 2025,
  category: "pitching",
  split_category: "split",
  split_name: "Season",
  games_played: 31,
  games_started: 31,
  innings_pitched: 192.0,
  hits_allowed: 140,
  walks_allowed: 35,
  strikeouts_pitched: 245,
  earned_runs: 50,
  home_runs_allowed: 18,
  era: 2.34,
  wins: 18,
  losses: 4,
  saves: 0,
  opponent_avg: 0.205,
};

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

async function testMapBreakdownSplitName() {
  section("mapBreakdownSplitNameToSplitType — exact BDL strings");
  check(`"vs. Left" → vs_lhp`, mapBreakdownSplitNameToSplitType("vs. Left") === "vs_lhp");
  check(`"vs. Right" → vs_rhp`, mapBreakdownSplitNameToSplitType("vs. Right") === "vs_rhp");
  check(`"Home" → home`, mapBreakdownSplitNameToSplitType("Home") === "home");
  check(`"Away" → away`, mapBreakdownSplitNameToSplitType("Away") === "away");
  check(`"Day" → day`, mapBreakdownSplitNameToSplitType("Day") === "day");
  check(`"Night" → night`, mapBreakdownSplitNameToSplitType("Night") === "night");

  section("mapBreakdownSplitNameToSplitType — trims whitespace");
  check(`"  vs. Left  " → vs_lhp`, mapBreakdownSplitNameToSplitType("  vs. Left  ") === "vs_lhp");

  section("mapBreakdownSplitNameToSplitType — unknown → null");
  check(`"" → null`, mapBreakdownSplitNameToSplitType("") === null);
  check(`null → null`, mapBreakdownSplitNameToSplitType(null) === null);
  check(`undefined → null`, mapBreakdownSplitNameToSplitType(undefined) === null);
  check(`"vs Left" (no period) → null (BDL convention)`, mapBreakdownSplitNameToSplitType("vs Left") === null);
  check(`"By Arena" → null`, mapBreakdownSplitNameToSplitType("By Arena") === null);
}

async function testComputeWhip() {
  section("computeWhip");
  check("ip=192, h=140, bb=35 → 0.911...", approxEq(computeWhip(192, 140, 35), 0.91145833));
  check("ip=0 → null", computeWhip(0, 50, 20) === null);
  check("ip=null → null", computeWhip(null, 50, 20) === null);
  check("h=null → null", computeWhip(100, null, 20) === null);
  check("bb=null → null", computeWhip(100, 50, null) === null);
  check("ip=-1 → null (defensive)", computeWhip(-1, 50, 20) === null);
}

async function testComputeKper9() {
  section("computeKper9");
  check("ip=192, k=245 → 11.484...", approxEq(computeKper9(192, 245), 11.484375));
  check("ip=0 → null", computeKper9(0, 100) === null);
  check("ip=null → null", computeKper9(null, 100) === null);
  check("k=null → null", computeKper9(100, null) === null);
}

async function testComputeTotalBases() {
  section("computeTotalBases");
  check("Judge season: h=179, 2b=27, 3b=1, hr=53 → 367", computeTotalBases(179, 27, 1, 53) === 367);
  check("all-singles: h=10, 0/0/0 → 10", computeTotalBases(10, 0, 0, 0) === 10);
  check("h=null → null", computeTotalBases(null, 0, 0, 0) === null);
  check("h=5, others null → 5 (defaults)", computeTotalBases(5, null, null, null) === 5);
}

async function testComputePlateAppearances() {
  section("computePlateAppearances");
  check("ab=541, bb=124, hbp=7 → 672", computePlateAppearances(541, 124, 7) === 672);
  check("ab=null → null", computePlateAppearances(null, 50, 5) === null);
  check("ab=100, bb=null, hbp=null → 100", computePlateAppearances(100, null, null) === 100);
}

async function testMapSplitsRowToSplitRecord_vsLhp() {
  section("mapSplitsRowToSplitRecord — Aaron Judge vs. Left fixture");
  const rec = mapSplitsRowToSplitRecord(vsLeftRow, judgeBdlId, 2025);
  check("non-null result", rec !== null);
  if (rec === null) return;
  check("player_external_id === 569", rec.player_external_id === 569);
  check("season === 2025", rec.season === 2025);
  check("split_type === 'vs_lhp'", rec.split_type === "vs_lhp");
  check("ab === 123", rec.ab === 123);
  check("h === 42", rec.h === 42);
  check("hr === 16 (mapped from home_runs)", rec.hr === 16);
  check("bb === 37 (mapped from walks)", rec.bb === 37);
  check("so === 37 (mapped from strikeouts)", rec.so === 37);
  check("rbi === 50 (mapped from rbis)", rec.rbi === 50);
  check("ops === 1.279 (passthrough)", rec.ops === 1.279);
  check("tb === 42 + 5 + 0 + 3*16 = 95", rec.tb === 95);
  check("pa === 123 + 37 + 2 = 162", rec.pa === 162);
}

async function testMapSplitsRowToSplitRecord_vsRhp() {
  section("mapSplitsRowToSplitRecord — Aaron Judge vs. Right fixture");
  const rec = mapSplitsRowToSplitRecord(vsRightRow, judgeBdlId, 2025);
  check("non-null result", rec !== null);
  if (rec === null) return;
  check("split_type === 'vs_rhp'", rec.split_type === "vs_rhp");
  check("ab === 418", rec.ab === 418);
  check("ops === 1.104", rec.ops === 1.104);
}

async function testMapSplitsRowToSplitRecord_skipsUnknown() {
  section("mapSplitsRowToSplitRecord — unknown split_name → null");
  const row = { ...vsLeftRow, split_name: "vs Lefty (variant)", split_abbreviation: "vs Lefty (variant)" };
  const rec = mapSplitsRowToSplitRecord(row, judgeBdlId, 2025);
  check("returns null", rec === null);
}

async function testMapSplitsRowToSeasonRecord_hitter() {
  section("mapSplitsRowToSeasonRecord — hitter season aggregate");
  const rec = mapSplitsRowToSeasonRecord(seasonRowHitter, judgeBdlId, 2025);
  check("player_external_id === 569", rec.player_external_id === 569);
  check("season === 2025", rec.season === 2025);
  check("season_type defaults to 'regular'", rec.season_type === "regular");
  check("postseason === false", rec.postseason === false);
  check("batting_ab === 541", rec.batting_ab === 541);
  check("batting_h === 179", rec.batting_h === 179);
  check("batting_hr === 53", rec.batting_hr === 53);
  check("batting_obp === 0.457", rec.batting_obp === 0.457);
  check("batting_slg === 0.701", rec.batting_slg === 0.701);
  check("batting_ops === 1.158", rec.batting_ops === 1.158);
  check("batting_tb derived === 367", rec.batting_tb === 367);
  check("batting_pa derived === 672", rec.batting_pa === 672);
  check("batting_war = null (not in BDL row)", rec.batting_war === null);
  check("batting_sf = null (not in BDL row)", rec.batting_sf === null);
  // pitching fields should be null/0 for hitter
  check("pitching_era === null", rec.pitching_era === null);
  check("pitching_whip === null (ip null)", rec.pitching_whip === null);
  check("pitching_k_per_9 === null (ip null)", rec.pitching_k_per_9 === null);
  check("pitching_qs = null (not in BDL row)", rec.pitching_qs === null);
}

async function testMapSplitsRowToSeasonRecord_pitcher() {
  section("mapSplitsRowToSeasonRecord — pitcher season aggregate + derived WHIP/K9");
  const rec = mapSplitsRowToSeasonRecord(seasonRowPitcher, 178, 2025);
  check("pitching_ip === 192", rec.pitching_ip === 192);
  check("pitching_h === 140", rec.pitching_h === 140);
  check("pitching_bb === 35", rec.pitching_bb === 35);
  check("pitching_k === 245", rec.pitching_k === 245);
  check("pitching_era === 2.34", rec.pitching_era === 2.34);
  check("pitching_w === 18", rec.pitching_w === 18);
  // Derived
  check("pitching_whip derived ≈ 0.911", approxEq(rec.pitching_whip, 0.91145833));
  check("pitching_k_per_9 derived ≈ 11.484", approxEq(rec.pitching_k_per_9, 11.484375));
  check("pitching_qs === null (not from BDL)", rec.pitching_qs === null);
  check("pitching_hld === null (not from BDL)", rec.pitching_hld === null);
  check("pitching_war === null (not from BDL)", rec.pitching_war === null);
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.C.1.S.A — BDL /players/splits parser unit tests");
  console.log("=========================================================");

  await testMapBreakdownSplitName();
  await testComputeWhip();
  await testComputeKper9();
  await testComputeTotalBases();
  await testComputePlateAppearances();
  await testMapSplitsRowToSplitRecord_vsLhp();
  await testMapSplitsRowToSplitRecord_vsRhp();
  await testMapSplitsRowToSplitRecord_skipsUnknown();
  await testMapSplitsRowToSeasonRecord_hitter();
  await testMapSplitsRowToSeasonRecord_pitcher();

  console.log();
  console.log("=========================================================");
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
