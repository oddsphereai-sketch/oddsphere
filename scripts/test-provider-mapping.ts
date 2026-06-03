/**
 * Phase 4.2.C.1.M — Unit tests for providerMappingService.
 *
 * Pure tests (no HTTP, no DB). Uses hand-crafted fixture pairs of MLB
 * Stats profiles + BDL candidates and asserts on tier assignment +
 * JSONB shape.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-provider-mapping.ts
 */

import {
  attemptMatch,
  attemptMatchForPlayer,
  normalizeName,
  normalizeBdlDob,
  normalizeMlbStatsDob,
  positionCompatible,
  buildMlbStatsBlock,
  buildBdlBlock,
  buildUnresolvedBdlBlock,
  MAPPING_ALGORITHM_VERSION,
  type BdlCandidate,
} from "../lib/services/providerMappingService";
import type { MlbPersonProfile } from "../lib/providers/real_api/_mlbStatsApiClient";

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

// Reference "today" for deterministic DOB century disambiguation
const TODAY = new Date("2026-06-03T18:00:00Z");

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function makeMlbProfile(overrides: Partial<MlbPersonProfile> = {}): MlbPersonProfile {
  return {
    id: 694973,
    fullName: "Paul Skenes",
    firstName: "Paul",
    lastName: "Skenes",
    useName: "Paul",
    useLastName: "Skenes",
    middleName: "David",
    birthDate: "2002-05-29",
    birthCity: "Fullerton",
    birthStateProvince: "CA",
    birthCountry: "USA",
    height: "6' 6\"",
    weight: 260,
    primaryPositionAbbr: "P",
    primaryPositionName: "Pitcher",
    primaryPositionType: "Pitcher",
    batSideCode: "R",
    pitchHandCode: "R",
    currentTeamId: 134,
    currentTeamName: "Pittsburgh Pirates",
    active: true,
    ...overrides,
  };
}

function makeBdlCandidate(overrides: Partial<BdlCandidate> = {}): BdlCandidate {
  return {
    external_id: 647,
    full_name: "Paul Skenes",
    first_name: "Paul",
    last_name: "Skenes",
    dob: "05/29/02",
    age: 24,
    birth_place: "Fullerton, CA",
    position_abbr: "SP",
    bats: "R",
    throws: "R",
    team_abbreviation: "PIT",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Normalization tests
// ─────────────────────────────────────────────────────────────────────

async function testNormalizeName() {
  section("normalizeName");
  check("lowercases", normalizeName("Paul Skenes") === "paul skenes");
  check("strips accents", normalizeName("José Ramírez") === "jose ramirez");
  check(
    "strips punctuation",
    normalizeName("J.D. Martinez") === "jd martinez"
  );
  check(
    "strips Jr. suffix",
    normalizeName("Ronald Acuña Jr.") === "ronald acuna"
  );
  check(
    "strips II/III/IV suffixes",
    normalizeName("Cal Ripken III") === "cal ripken"
  );
  check(
    "collapses internal whitespace",
    normalizeName("Paul   Skenes") === "paul skenes"
  );
  check(
    "preserves accent-free legitimate Spanish names",
    normalizeName("Cristopher Sanchez") === "cristopher sanchez"
  );
}

async function testNormalizeBdlDob() {
  section("normalizeBdlDob — century disambiguation via age");
  check(
    "2002 player aged 24 in 2026: 20YY chosen",
    normalizeBdlDob("05/29/02", 24, TODAY) === "2002-05-29"
  );
  check(
    "1980 player aged 45 in 2026: 19YY chosen",
    normalizeBdlDob("03/15/80", 45, TODAY) === "1980-03-15"
  );
  check(
    "no age: future-date heuristic falls back to 19YY",
    normalizeBdlDob("01/01/50", null, TODAY) === "1950-01-01"
  );
  check(
    "no age: present-or-past year resolves to 20YY",
    normalizeBdlDob("05/29/02", null, TODAY) === "2002-05-29"
  );
  check(
    "malformed input returns null",
    normalizeBdlDob("not-a-date", null, TODAY) === null
  );
  check(
    "month out of range returns null",
    normalizeBdlDob("13/29/02", 24, TODAY) === null
  );
  check("null input returns null", normalizeBdlDob(null, null, TODAY) === null);
}

async function testNormalizeMlbStatsDob() {
  section("normalizeMlbStatsDob");
  check(
    "passes through canonical ISO",
    normalizeMlbStatsDob("2002-05-29") === "2002-05-29"
  );
  check(
    "trims whitespace",
    normalizeMlbStatsDob("  2002-05-29  ") === "2002-05-29"
  );
  check(
    "rejects non-ISO formats",
    normalizeMlbStatsDob("05/29/2002") === null
  );
  check("null input returns null", normalizeMlbStatsDob(null) === null);
}

async function testPositionCompatible() {
  section("positionCompatible");
  check("BDL SP + MLB P → compatible", positionCompatible("SP", "P"));
  check("BDL RP + MLB P → compatible", positionCompatible("RP", "P"));
  check("BDL P + MLB P → compatible", positionCompatible("P", "P"));
  check("BDL 1B + MLB 1B → compatible", positionCompatible("1B", "1B"));
  check(
    "BDL CF + MLB P → INCOMPATIBLE (pitcher vs hitter)",
    !positionCompatible("CF", "P")
  );
  check(
    "BDL SP + MLB 1B → INCOMPATIBLE",
    !positionCompatible("SP", "1B")
  );
  check(
    "BDL null + MLB P → compatible (missing data tolerated)",
    positionCompatible(null, "P")
  );
  check(
    "BDL CF + MLB null → compatible (missing data tolerated)",
    positionCompatible("CF", null)
  );
}

// ─────────────────────────────────────────────────────────────────────
// attemptMatch tests
// ─────────────────────────────────────────────────────────────────────

async function testTier1Exact() {
  section("attemptMatch — Tier 1 (full name + DOB exact)");
  const mlb = makeMlbProfile();
  const candidates = [makeBdlCandidate()];
  const result = attemptMatch(mlb, candidates, TODAY);
  check("tier === 'high'", result.tier === "high");
  if (result.tier === "high") {
    check("bdlId === 647", result.bdlId === 647);
    check("method === 'name_dob_v1'", result.method === "name_dob_v1");
    check("bdlFullName preserved", result.bdlFullName === "Paul Skenes");
  }
}

async function testTier1AccentNormalized() {
  section("attemptMatch — Tier 1 with accents normalized");
  const mlb = makeMlbProfile({
    id: 650911,
    fullName: "Cristopher Sánchez",
    firstName: "Cristopher",
    lastName: "Sánchez",
    birthDate: "1996-12-12",
  });
  const candidates = [
    makeBdlCandidate({
      external_id: 1234,
      full_name: "Cristopher Sanchez",  // no accent in BDL — common
      first_name: "Cristopher",
      last_name: "Sanchez",
      dob: "12/12/96",
      age: 29,
      birth_place: "Santo Domingo, DR",
    }),
  ];
  const result = attemptMatch(mlb, candidates, TODAY);
  check(
    "tier === 'high' (accents normalized away)",
    result.tier === "high"
  );
}

async function testTier1WithJrSuffix() {
  section("attemptMatch — Tier 1 with Jr suffix");
  const mlb = makeMlbProfile({
    id: 660670,
    fullName: "Ronald Acuña Jr.",
    firstName: "Ronald",
    lastName: "Acuña",
    birthDate: "1997-12-18",
    primaryPositionAbbr: "RF",  // Acuna is an outfielder, not a pitcher
    primaryPositionType: "Outfielder",
  });
  const candidates = [
    makeBdlCandidate({
      external_id: 250,
      full_name: "Ronald Acuna Jr.",  // BDL: no accent
      first_name: "Ronald",
      last_name: "Acuna",
      dob: "12/18/97",
      age: 28,
      birth_place: "La Guaira, Venezuela",
      position_abbr: "RF",
    }),
  ];
  const result = attemptMatch(mlb, candidates, TODAY);
  check(
    "tier === 'high' (suffix stripped, accents normalized)",
    result.tier === "high"
  );
}

async function testTier2NameVariant() {
  section("attemptMatch — Tier 2 name variant ('J.D. Martinez' vs formal)");
  const mlb = makeMlbProfile({
    id: 502110,
    fullName: "Julio Daniel Martinez",
    firstName: "Julio Daniel",
    lastName: "Martinez",
    useName: "Julio Daniel",  // BUT useName isn't J.D.
    useLastName: "Martinez",
    birthDate: "1987-08-21",
    primaryPositionAbbr: "DH",  // J.D. is a designated hitter, not a pitcher
    primaryPositionType: "Designated Hitter",
  });
  const candidates = [
    makeBdlCandidate({
      external_id: 1834,
      full_name: "J.D. Martinez",
      first_name: "J.D.",
      last_name: "Martinez",
      dob: "08/21/87",
      age: 38,
      birth_place: "Miami, FL",
      position_abbr: "DH",
    }),
  ];
  const result = attemptMatch(mlb, candidates, TODAY);
  check("tier === 'medium' (DOB exact + name variant)", result.tier === "medium");
  if (result.tier === "medium") {
    check("method === 'name_dob_variant_v1'", result.method === "name_dob_variant_v1");
  }
}

async function testTier3MultipleCandidates() {
  section("attemptMatch — Tier 3 multiple DOB matches");
  const mlb = makeMlbProfile({
    id: 600051,
    fullName: "Will Smith",
    firstName: "Will",
    lastName: "Smith",
    birthDate: "1995-03-28",
  });
  const candidates = [
    makeBdlCandidate({ external_id: 103, full_name: "Will Smith", first_name: "Will", last_name: "Smith", dob: "03/28/95", age: 31, team_abbreviation: "LAD" }),
    makeBdlCandidate({ external_id: 987, full_name: "Will Smith", first_name: "Will", last_name: "Smith", dob: "03/28/95", age: 31, team_abbreviation: "LAA" }),
  ];
  const result = attemptMatch(mlb, candidates, TODAY);
  check("tier === 'low'", result.tier === "low");
  if (result.tier === "low") {
    check("reason === 'multiple_candidates'", result.reason === "multiple_candidates");
    check("candidates carried", result.candidates.length === 2);
    check(
      "candidates carry BDL IDs",
      result.candidates.some((c) => c.bdl_id === 103) &&
        result.candidates.some((c) => c.bdl_id === 987)
    );
  }
}

async function testTier4DobMissingOneSide() {
  section("attemptMatch — Tier 4 DOB missing on MLB side, city match");
  const mlb = makeMlbProfile({
    id: 999999,
    fullName: "Test Player",
    firstName: "Test",
    lastName: "Player",
    birthDate: null,
    birthCity: "Springfield",
  });
  const candidates = [
    makeBdlCandidate({
      external_id: 5555,
      full_name: "Test Player",
      first_name: "Test",
      last_name: "Player",
      dob: null,  // BDL also missing DOB
      age: null,
      birth_place: "Springfield, IL",
      position_abbr: "1B",
    }),
  ];
  const result = attemptMatch(mlb, candidates, TODAY);
  check("tier === 'low' (queue, no auto-write)", result.tier === "low");
  if (result.tier === "low") {
    check(
      "reason === 'dob_missing_one_side'",
      result.reason === "dob_missing_one_side"
    );
  }
}

async function testNoCandidates() {
  section("attemptMatch — no candidates");
  const mlb = makeMlbProfile();
  const result = attemptMatch(mlb, [], TODAY);
  check("tier === 'none'", result.tier === "none");
  if (result.tier === "none") {
    check("reason === 'no_candidates'", result.reason === "no_candidates");
  }
}

async function testDobMismatch() {
  section("attemptMatch — name match but DOB differs");
  const mlb = makeMlbProfile({
    fullName: "Paul Skenes",
    birthDate: "2002-05-29",
  });
  const candidates = [
    makeBdlCandidate({
      external_id: 9999,
      full_name: "Paul Skenes",
      dob: "01/01/95",  // wrong DOB
      age: 31,
    }),
  ];
  const result = attemptMatch(mlb, candidates, TODAY);
  check("tier === 'none'", result.tier === "none");
  if (result.tier === "none") {
    check("reason === 'dob_mismatch'", result.reason === "dob_mismatch");
  }
}

async function testPositionMismatch() {
  section("attemptMatch — DOB match but position incompatible (defensive)");
  const mlb = makeMlbProfile({
    fullName: "Paul Skenes",
    primaryPositionAbbr: "P",
    birthDate: "2002-05-29",
  });
  const candidates = [
    makeBdlCandidate({
      full_name: "Paul Skenes",
      position_abbr: "1B",  // contradicts MLB Stats
      dob: "05/29/02",
      age: 24,
    }),
  ];
  const result = attemptMatch(mlb, candidates, TODAY);
  check("tier === 'none'", result.tier === "none");
  if (result.tier === "none") {
    check("reason === 'position_mismatch'", result.reason === "position_mismatch");
  }
}

// ─────────────────────────────────────────────────────────────────────
// JSONB shape tests
// ─────────────────────────────────────────────────────────────────────

async function testJsonbShapes() {
  section("JSONB shape builders");
  const now = new Date("2026-06-03T18:42:31Z");
  const mlbBlock = buildMlbStatsBlock(694973, now);
  check("mlb_stats.id correct", mlbBlock.id === 694973);
  check(
    "mlb_stats.last_seen_at ISO",
    mlbBlock.last_seen_at === "2026-06-03T18:42:31.000Z"
  );

  const bdlBlock = buildBdlBlock(
    {
      tier: "high",
      bdlId: 647,
      bdlFullName: "Paul Skenes",
      method: "name_dob_v1",
    },
    now
  );
  check("bdl.id correct", bdlBlock.id === 647);
  check("bdl.confidence === 'high'", bdlBlock.confidence === "high");
  check("bdl.mapped_via === 'name_dob_v1'", bdlBlock.mapped_via === "name_dob_v1");
  check("bdl.mapped_at ISO", bdlBlock.mapped_at === "2026-06-03T18:42:31.000Z");

  const unresolvedBlock = buildUnresolvedBdlBlock(
    {
      tier: "low",
      reason: "multiple_candidates",
      candidates: [{ bdl_id: 103, name: "Will Smith", dob: "03/28/95", team: "LAD" }],
    },
    now
  );
  check(
    "unresolved_bdl.reason === 'multiple_candidates'",
    unresolvedBlock.reason === "multiple_candidates"
  );
  check(
    "unresolved_bdl.last_attempt_at ISO",
    unresolvedBlock.last_attempt_at === "2026-06-03T18:42:31.000Z"
  );
  check("unresolved_bdl.candidates carried", unresolvedBlock.candidates.length === 1);
}

async function testAlgorithmVersion() {
  section("Algorithm version constant");
  check(
    "MAPPING_ALGORITHM_VERSION === 'name_dob_v1'",
    MAPPING_ALGORITHM_VERSION === "name_dob_v1"
  );
}

// ─────────────────────────────────────────────────────────────────────
// End-to-end attemptMatchForPlayer with stubbed dependencies
// ─────────────────────────────────────────────────────────────────────

async function testEndToEnd_HighConfidenceMatch() {
  section("attemptMatchForPlayer — happy path: Tier 1 high");
  const mlb = makeMlbProfile();
  const { match, proposedProviderIds } = await attemptMatchForPlayer(
    mlb,
    {
      searchBdlByName: async () => [makeBdlCandidate()],
    },
    TODAY
  );
  check("match.tier === 'high'", match.tier === "high");
  check(
    "proposedProviderIds has mlb_stats key",
    "mlb_stats" in proposedProviderIds
  );
  check("proposedProviderIds has bdl key", "bdl" in proposedProviderIds);
  check(
    "proposedProviderIds does NOT have unresolved_bdl",
    !("unresolved_bdl" in proposedProviderIds)
  );
  const bdlBlock = proposedProviderIds.bdl as { id: number; confidence: string };
  check("bdl block carries the right id", bdlBlock.id === 647);
  check("bdl block confidence === 'high'", bdlBlock.confidence === "high");
}

async function testEndToEnd_UnresolvedMatch() {
  section("attemptMatchForPlayer — multiple-candidate queue");
  const mlb = makeMlbProfile({
    fullName: "Will Smith",
    firstName: "Will",
    lastName: "Smith",
    birthDate: "1995-03-28",
  });
  const { match, proposedProviderIds } = await attemptMatchForPlayer(
    mlb,
    {
      searchBdlByName: async () => [
        makeBdlCandidate({ external_id: 103, full_name: "Will Smith", first_name: "Will", last_name: "Smith", dob: "03/28/95", age: 31, team_abbreviation: "LAD" }),
        makeBdlCandidate({ external_id: 987, full_name: "Will Smith", first_name: "Will", last_name: "Smith", dob: "03/28/95", age: 31, team_abbreviation: "LAA" }),
      ],
    },
    TODAY
  );
  check("match.tier === 'low'", match.tier === "low");
  check(
    "proposedProviderIds has unresolved_bdl",
    "unresolved_bdl" in proposedProviderIds
  );
  check(
    "proposedProviderIds does NOT have bdl",
    !("bdl" in proposedProviderIds)
  );
}

async function testEndToEnd_NoCandidates() {
  section("attemptMatchForPlayer — BDL returns nothing");
  const mlb = makeMlbProfile({ fullName: "Ghost Player" });
  const { match, proposedProviderIds } = await attemptMatchForPlayer(
    mlb,
    { searchBdlByName: async () => [] },
    TODAY
  );
  check("match.tier === 'none'", match.tier === "none");
  if (match.tier === "none") {
    check("match.reason === 'no_candidates'", match.reason === "no_candidates");
  }
  check(
    "proposedProviderIds carries unresolved_bdl",
    "unresolved_bdl" in proposedProviderIds
  );
}

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.C.1.M — providerMappingService unit tests");
  console.log("===================================================");

  await testNormalizeName();
  await testNormalizeBdlDob();
  await testNormalizeMlbStatsDob();
  await testPositionCompatible();
  await testTier1Exact();
  await testTier1AccentNormalized();
  await testTier1WithJrSuffix();
  await testTier2NameVariant();
  await testTier3MultipleCandidates();
  await testTier4DobMissingOneSide();
  await testNoCandidates();
  await testDobMismatch();
  await testPositionMismatch();
  await testJsonbShapes();
  await testAlgorithmVersion();
  await testEndToEnd_HighConfidenceMatch();
  await testEndToEnd_UnresolvedMatch();
  await testEndToEnd_NoCandidates();

  console.log();
  console.log("===================================================");
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
