/**
 * Phase 4.2.C.1.H-2 — pure unit tests for missingPlayerIngestPlanner.
 *
 * No HTTP, no DB. Covers field-mapping correctness, skip reasons, and
 * the `external_id = NULL` + `provider_ids.mlb_stats.id` payload
 * contract that the future writer will rely on.
 */

import type { MlbPersonProfile } from "../lib/providers/real_api/_mlbStatsApiClient";
import {
  planPlayerInsertFromMlbProfile,
  truncatePlannedInserts,
  type PlannerResult,
} from "../lib/services/missingPlayerIngestPlanner";

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

// Real-data fixtures from the live MLB Stats /people/{id} probe
// (Phase 4.2.C.1.H-1 audit).
const ANDREW_ALVAREZ: MlbPersonProfile = {
  id: 674841,
  fullName: "Andrew Alvarez",
  firstName: "Michael",
  lastName: "Alvarez",
  useName: null,
  useLastName: null,
  middleName: null,
  birthDate: "1999-06-13",
  birthCity: "Anaheim",
  birthStateProvince: null,
  birthCountry: "USA",
  height: "6' 3\"",
  weight: 215,
  primaryPositionAbbr: "P",
  primaryPositionName: "Pitcher",
  primaryPositionType: "Pitcher",
  batSideCode: "L",
  pitchHandCode: "L",
  currentTeamId: null,
  currentTeamName: null,
  active: true,
};

const TAJ_BRADLEY: MlbPersonProfile = {
  id: 671737,
  fullName: "Taj Bradley",
  firstName: "Taj",
  lastName: "Bradley",
  useName: null,
  useLastName: null,
  middleName: null,
  birthDate: "2001-03-20",
  birthCity: "Los Angeles",
  birthStateProvince: null,
  birthCountry: "USA",
  height: "6' 2\"",
  weight: 220,
  primaryPositionAbbr: "P",
  primaryPositionName: "Pitcher",
  primaryPositionType: "Pitcher",
  batSideCode: "R",
  pitchHandCode: "R",
  currentTeamId: null,
  currentTeamName: null,
  active: true,
};

// Synthetic case: useName differs from firstName (mimics nicknamed players)
const NICKNAMED: MlbPersonProfile = {
  id: 999001,
  fullName: "Andy Smith",
  firstName: "Andrew",
  lastName: "Smith",
  useName: "Andy",
  useLastName: "Smith",
  middleName: null,
  birthDate: "1995-01-15",
  birthCity: "Anywhere",
  birthStateProvince: null,
  birthCountry: "USA",
  height: "6' 0\"",
  weight: 200,
  primaryPositionAbbr: "P",
  primaryPositionName: "Pitcher",
  primaryPositionType: "Pitcher",
  batSideCode: "L",
  pitchHandCode: "R",
  currentTeamId: null,
  currentTeamName: null,
  active: true,
};

// Synthetic catcher to exercise non-pitcher branch (we'd skip-write
// these in the operator, but the planner itself should still build them).
const HITTER: MlbPersonProfile = {
  ...NICKNAMED,
  id: 999002,
  fullName: "Cole Catcher",
  firstName: "Cole",
  lastName: "Catcher",
  useName: null,
  useLastName: null,
  primaryPositionAbbr: "C",
  primaryPositionName: "Catcher",
  primaryPositionType: "Catcher",
};

const FIXED_ISO = "2026-06-03T17:00:00.000Z";

// ─── Field mapping ────────────────────────────────────────────────────

async function testPlanner_AndrewAlvarezHappyPath() {
  section("planner — Andrew Alvarez (real fixture) happy path");
  const r = planPlayerInsertFromMlbProfile(ANDREW_ALVAREZ, {
    teamId: 767, // Marlins (arbitrary internal id)
    ingestedAtIso: FIXED_ISO,
  });
  check("kind === 'plan'", r.kind === "plan");
  if (r.kind !== "plan") return;
  const i = r.insert;
  check("external_id === null", i.external_id === null);
  check("mlb_person_id === 674841", i.mlb_person_id === 674841);
  check("sport === 'mlb'", i.sport === "mlb");
  check("team_id === 767 (passed through)", i.team_id === 767);
  check("full_name === 'Andrew Alvarez'", i.full_name === "Andrew Alvarez");
  check("first_name falls back to firstName (no useName)", i.first_name === "Michael");
  check("last_name falls back to lastName", i.last_name === "Alvarez");
  check("position === 'Pitcher'", i.position === "Pitcher");
  check("position_abbr === 'P'", i.position_abbr === "P");
  check("is_pitcher === true (abbr=P)", i.is_pitcher === true);
  check("active === true", i.active === true);
  check("bats === 'L'", i.bats === "L");
  check("throws === 'L'", i.throws === "L");
  check("dob === '1999-06-13'", i.dob === "1999-06-13");
  check('height === \'6\\\' 3"\'', i.height === "6' 3\"");
  check("weight === '215' (string)", i.weight === "215");
  check("birth_place === 'Anaheim, USA'", i.birth_place === "Anaheim, USA");
  check("provider_ids.mlb_stats.id === 674841", i.provider_ids.mlb_stats.id === 674841);
  check("provider_ids.mlb_stats.source === 'mlb_stats_people_endpoint'",
    i.provider_ids.mlb_stats.source === "mlb_stats_people_endpoint");
  check("provider_ids.mlb_stats.ingested_at passes through opts", i.provider_ids.mlb_stats.ingested_at === FIXED_ISO);
}

async function testPlanner_TajBradleyTeamIdNull() {
  section("planner — Taj Bradley team_id null when not provided");
  const r = planPlayerInsertFromMlbProfile(TAJ_BRADLEY, {
    teamId: null,
    ingestedAtIso: FIXED_ISO,
  });
  check("kind === 'plan'", r.kind === "plan");
  if (r.kind === "plan") {
    check("team_id === null", r.insert.team_id === null);
    check("mlb_person_id === 671737", r.insert.mlb_person_id === 671737);
    check("external_id === null", r.insert.external_id === null);
  }
}

async function testPlanner_UseNameWins() {
  section("planner — useName / useLastName prefer over legal firstName / lastName");
  const r = planPlayerInsertFromMlbProfile(NICKNAMED, {
    teamId: null,
    ingestedAtIso: FIXED_ISO,
  });
  check("kind === 'plan'", r.kind === "plan");
  if (r.kind === "plan") {
    check("first_name === 'Andy' (useName wins)", r.insert.first_name === "Andy");
    check("last_name === 'Smith'", r.insert.last_name === "Smith");
    check("full_name === 'Andy Smith' (passed through)", r.insert.full_name === "Andy Smith");
  }
}

async function testPlanner_NonPitcher() {
  section("planner — non-pitcher (catcher) builds row with is_pitcher=false");
  const r = planPlayerInsertFromMlbProfile(HITTER, {
    teamId: null,
    ingestedAtIso: FIXED_ISO,
  });
  check("kind === 'plan'", r.kind === "plan");
  if (r.kind === "plan") {
    check("is_pitcher === false", r.insert.is_pitcher === false);
    check("position_abbr === 'C'", r.insert.position_abbr === "C");
    check("position === 'Catcher'", r.insert.position === "Catcher");
  }
}

async function testPlanner_IsPitcherFromTypeAlone() {
  section("planner — is_pitcher=true when only primaryPositionType is set to Pitcher");
  // Defensive: MLB Stats sometimes has typeName='Pitcher' but abbr is
  // some weird value like 'TWP' (two-way) for Ohtani-style players.
  const twp: MlbPersonProfile = {
    ...ANDREW_ALVAREZ,
    primaryPositionAbbr: "TWP",
    primaryPositionType: "Pitcher",
  };
  const r = planPlayerInsertFromMlbProfile(twp, {
    teamId: null,
    ingestedAtIso: FIXED_ISO,
  });
  check("kind === 'plan'", r.kind === "plan");
  if (r.kind === "plan") {
    check("is_pitcher === true (via primaryPositionType)", r.insert.is_pitcher === true);
    check("position_abbr === 'TWP'", r.insert.position_abbr === "TWP");
  }
}

async function testPlanner_ActiveFalseRespected() {
  section("planner — active=false is respected");
  const r = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, active: false },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("active === false", r.kind === "plan" && r.insert.active === false);
}

async function testPlanner_ActiveNullDefaultsToTrue() {
  section("planner — active=null defaults to true (probable-starter heuristic)");
  const r = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, active: null },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("active === true (default)", r.kind === "plan" && r.insert.active === true);
}

async function testPlanner_BirthPlacePartialJoin() {
  section("planner — birth_place handles missing city / country gracefully");
  const cityOnly = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, birthCountry: null },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("city-only → 'Anaheim'", cityOnly.kind === "plan" && cityOnly.insert.birth_place === "Anaheim");

  const countryOnly = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, birthCity: null },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("country-only → 'USA'", countryOnly.kind === "plan" && countryOnly.insert.birth_place === "USA");

  const neither = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, birthCity: null, birthCountry: null },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("neither → null", neither.kind === "plan" && neither.insert.birth_place === null);
}

async function testPlanner_WeightNumberToString() {
  section("planner — weight numeric→string, null→null");
  const r1 = planPlayerInsertFromMlbProfile(ANDREW_ALVAREZ, {
    teamId: null,
    ingestedAtIso: FIXED_ISO,
  });
  check("weight=215 → '215'", r1.kind === "plan" && r1.insert.weight === "215");

  const r2 = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, weight: null },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("weight=null → null", r2.kind === "plan" && r2.insert.weight === null);
}

// ─── Skip reasons ────────────────────────────────────────────────────

async function testPlanner_SkipMissingMlbPersonId() {
  section("planner — skip when id is not a finite number");
  const r1 = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, id: NaN as unknown as number },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("NaN id → skip", r1.kind === "skip");
  if (r1.kind === "skip") check("reason === 'missing_mlb_person_id'", r1.reason === "missing_mlb_person_id");

  const r2 = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, id: undefined as unknown as number },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("undefined id → skip", r2.kind === "skip");
}

async function testPlanner_SkipMissingFullName() {
  section("planner — skip when fullName is empty/whitespace");
  const r1 = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, fullName: "" },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("empty → skip with reason missing_full_name",
    r1.kind === "skip" && r1.reason === "missing_full_name");

  const r2 = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, fullName: "   " },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("whitespace → skip", r2.kind === "skip" && r2.reason === "missing_full_name");
}

async function testPlanner_SkipMissingPositionAbbr() {
  section("planner — skip when primaryPositionAbbr is missing");
  const r = planPlayerInsertFromMlbProfile(
    { ...ANDREW_ALVAREZ, primaryPositionAbbr: null },
    { teamId: null, ingestedAtIso: FIXED_ISO }
  );
  check("kind === 'skip'", r.kind === "skip");
  if (r.kind === "skip") check("reason === 'missing_position_abbr'", r.reason === "missing_position_abbr");
}

// ─── external_id contract ────────────────────────────────────────────

async function testPlanner_ExternalIdAlwaysNull() {
  section("planner — external_id is ALWAYS null (Phase H-0 contract)");
  // Try a few different profiles and confirm the contract holds.
  for (const p of [ANDREW_ALVAREZ, TAJ_BRADLEY, NICKNAMED, HITTER]) {
    const r = planPlayerInsertFromMlbProfile(p, {
      teamId: null,
      ingestedAtIso: FIXED_ISO,
    });
    check(`external_id === null for pid=${p.id}`, r.kind === "plan" && r.insert.external_id === null);
  }
}

// ─── truncatePlannedInserts ──────────────────────────────────────────

async function testTruncate_UndefinedReturnsAll() {
  section("truncatePlannedInserts — undefined limit returns all");
  const r = truncatePlannedInserts([1, 2, 3], undefined);
  check("returns [1,2,3]", JSON.stringify(r) === "[1,2,3]");
  // Confirm it's a copy, not the same reference
  const input: number[] = [1, 2, 3];
  const out = truncatePlannedInserts(input, undefined);
  check("returns a NEW array (defensive copy)", out !== (input as unknown));
}

async function testTruncate_ZeroReturnsEmpty() {
  section("truncatePlannedInserts — limit=0 returns empty");
  check("[]", truncatePlannedInserts([1, 2, 3], 0).length === 0);
}

async function testTruncate_OneReturnsFirst() {
  section("truncatePlannedInserts — limit=1 returns first element");
  const r = truncatePlannedInserts([10, 20, 30], 1);
  check("length === 1", r.length === 1);
  check("first === 10", r[0] === 10);
}

async function testTruncate_LargerThanInputReturnsAll() {
  section("truncatePlannedInserts — limit > length returns all");
  const r = truncatePlannedInserts([1, 2, 3], 10);
  check("returns [1,2,3]", JSON.stringify(r) === "[1,2,3]");
}

async function testTruncate_NegativeReturnsEmpty() {
  section("truncatePlannedInserts — negative limit returns empty");
  check("limit=-1 → []", truncatePlannedInserts([1, 2, 3], -1).length === 0);
  check("limit=-100 → []", truncatePlannedInserts([1, 2, 3], -100).length === 0);
}

async function testTruncate_EmptyInput() {
  section("truncatePlannedInserts — empty input");
  check("[] + undefined → []", truncatePlannedInserts([], undefined).length === 0);
  check("[] + 1 → []", truncatePlannedInserts([], 1).length === 0);
}

async function testTruncate_PreservesOrder() {
  section("truncatePlannedInserts — preserves input order (caller is responsible for sorting)");
  // The operator sorts by mlb_person_id ASC before calling; verify
  // truncate doesn't re-sort or otherwise alter ordering.
  const sorted = [547179, 571578, 605135, 605488, 607067];
  const r = truncatePlannedInserts(sorted, 3);
  check("first 3 in input order", JSON.stringify(r) === "[547179,571578,605135]");
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.C.1.H-2 — missingPlayerIngestPlanner unit tests");
  console.log("=========================================================");

  await testPlanner_AndrewAlvarezHappyPath();
  await testPlanner_TajBradleyTeamIdNull();
  await testPlanner_UseNameWins();
  await testPlanner_NonPitcher();
  await testPlanner_IsPitcherFromTypeAlone();
  await testPlanner_ActiveFalseRespected();
  await testPlanner_ActiveNullDefaultsToTrue();
  await testPlanner_BirthPlacePartialJoin();
  await testPlanner_WeightNumberToString();
  await testPlanner_SkipMissingMlbPersonId();
  await testPlanner_SkipMissingFullName();
  await testPlanner_SkipMissingPositionAbbr();
  await testPlanner_ExternalIdAlwaysNull();

  await testTruncate_UndefinedReturnsAll();
  await testTruncate_ZeroReturnsEmpty();
  await testTruncate_OneReturnsFirst();
  await testTruncate_LargerThanInputReturnsAll();
  await testTruncate_NegativeReturnsEmpty();
  await testTruncate_EmptyInput();
  await testTruncate_PreservesOrder();

  // Silence unused-import warning — PlannerResult is load-bearing for
  // typing but not directly referenced as a value.
  void ({} as PlannerResult);

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
