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
import { bdlDobToIso } from "../lib/providers/real_api/BallDontLieProvider";

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
// Part 1 fix-bundle tests (4.2.C.1.M-fix-bundle)
// ─────────────────────────────────────────────────────────────────────

async function testBdlDobToIso_DdMmYyyy() {
  section("bdlDobToIso — BDL's DD/MM/YYYY format (modern entries)");
  // Garrett Crochet's actual BDL DOB string
  check(
    "Crochet: '21/6/1999' age=25 → '1999-06-21'",
    bdlDobToIso("21/6/1999", 25, TODAY) === "1999-06-21"
  );
  // Lindor: zero-padded both fields
  check(
    "Lindor: '14/11/1993' age=30 → '1993-11-14'",
    bdlDobToIso("14/11/1993", 30, TODAY) === "1993-11-14"
  );
  // Senga: padded day, single-digit month
  check(
    "Senga: '30/1/1993' age=31 → '1993-01-30'",
    bdlDobToIso("30/1/1993", 31, TODAY) === "1993-01-30"
  );
  // Anderson: full DD/MM/YYYY
  check(
    "Anderson: '30/12/1989' age=34 → '1989-12-30'",
    bdlDobToIso("30/12/1989", 34, TODAY) === "1989-12-30"
  );
  // Pepiot: DD/M/YYYY
  check(
    "Pepiot: '21/8/1997' age=27 → '1997-08-21'",
    bdlDobToIso("21/8/1997", 27, TODAY) === "1997-08-21"
  );
}

async function testBdlDobToIso_DSlashMSlashYyyy() {
  section("bdlDobToIso — BDL's D/M/YYYY single-digit format");
  // Hunter Greene: D/M/YYYY
  check(
    "Hunter Greene: '6/8/1999' age=25 → '1999-08-06'",
    bdlDobToIso("6/8/1999", 25, TODAY) === "1999-08-06"
  );
  // Pablo López: D/M/YYYY
  check(
    "López: '7/3/1996' age=28 → '1996-03-07'",
    bdlDobToIso("7/3/1996", 28, TODAY) === "1996-03-07"
  );
  // Robert Jr.: D/M/YYYY
  check(
    "Robert Jr.: '3/8/1997' age=27 → '1997-08-03'",
    bdlDobToIso("3/8/1997", 27, TODAY) === "1997-08-03"
  );
  // Casas: DD/M/YYYY (mix)
  check(
    "Casas: '15/1/2000' age=24 → '2000-01-15'",
    bdlDobToIso("15/1/2000", 24, TODAY) === "2000-01-15"
  );
  // Nootbaar: D/M/YYYY
  check(
    "Nootbaar: '8/9/1997' age=27 → '1997-09-08'",
    bdlDobToIso("8/9/1997", 27, TODAY) === "1997-09-08"
  );
}

async function testBdlDobToIso_MmDdYyRegression() {
  section("bdlDobToIso — legacy MM/DD/YY still parses (regression)");
  // Aaron Judge: original BDL format
  check(
    "Judge: '04/26/92' age=34 → '1992-04-26'",
    bdlDobToIso("04/26/92", 34, TODAY) === "1992-04-26"
  );
  // Ohtani's BDL DOB
  check(
    "Ohtani: '07/05/94' age=31 → '1994-07-05'",
    bdlDobToIso("07/05/94", 31, TODAY) === "1994-07-05"
  );
  // Davis Martin: MM/DD/YY
  check(
    "Davis Martin: '01/04/97' age=29 → '1997-01-04'",
    bdlDobToIso("01/04/97", 29, TODAY) === "1997-01-04"
  );
}

async function testBdlDobToIso_IsoPassthrough() {
  section("bdlDobToIso — ISO YYYY-MM-DD passthrough (regression)");
  check(
    "ISO passthrough: '1992-04-26' → '1992-04-26'",
    bdlDobToIso("1992-04-26", null, TODAY) === "1992-04-26"
  );
  check(
    "ISO passthrough with whitespace: '  1995-01-15 ' → '1995-01-15'",
    bdlDobToIso("  1995-01-15 ", null, TODAY) === "1995-01-15"
  );
}

async function testBdlDobToIso_Malformed() {
  section("bdlDobToIso — malformed inputs → null");
  check("null input → null", bdlDobToIso(null, null, TODAY) === null);
  check("empty string → null", bdlDobToIso("", null, TODAY) === null);
  check(
    "unrecognized 'foo' → null",
    bdlDobToIso("foo", null, TODAY) === null
  );
  check(
    "out-of-range month '13/15/1999' → null",
    bdlDobToIso("13/15/1999", null, TODAY) === null
  );
  check(
    "out-of-range day '15/13/1999' → null (treated as DD=15, MM=13)",
    bdlDobToIso("15/13/1999", null, TODAY) === null
  );
  check(
    "MM/DD/YY out-of-range '13/45/99' → null",
    bdlDobToIso("13/45/99", null, TODAY) === null
  );
}

async function testPositionCompatible_Twp() {
  section("positionCompatible — TWP (two-way player) compatibility");
  // MLB pos = TWP → universally compatible
  check("TWP (mlb) + SP (bdl) → compatible", positionCompatible("SP", "TWP") === true);
  check("TWP (mlb) + DH (bdl) → compatible", positionCompatible("DH", "TWP") === true);
  check("TWP (mlb) + P (bdl) → compatible", positionCompatible("P", "TWP") === true);
  check("TWP (mlb) + 1B (bdl) → compatible", positionCompatible("1B", "TWP") === true);
  check("TWP (mlb) + OF (bdl) → compatible", positionCompatible("OF", "TWP") === true);
  // Lowercase normalization
  check("TWP case-insensitive: 'twp' → compatible", positionCompatible("SP", "twp") === true);
  // Regression: TWP rule does NOT loosen other checks
  check(
    "regression: DH (mlb) + SP (bdl) → still incompatible",
    positionCompatible("SP", "DH") === false
  );
  check(
    "regression: 1B (mlb) + OF (bdl) → still incompatible",
    positionCompatible("OF", "1B") === false
  );
  check(
    "regression: SP (mlb) + RP (bdl) → still compatible (both pitchers)",
    positionCompatible("RP", "SP") === true
  );
}

async function testPositionCompatible_Outfield() {
  section("positionCompatible — outfield equivalence (LF/RF/CF/OF)");
  // Cross-corner / cross-source compatibility
  check("LF (mlb) + RF (bdl) → compatible", positionCompatible("RF", "LF") === true);
  check("RF (mlb) + LF (bdl) → compatible", positionCompatible("LF", "RF") === true);
  check("CF (mlb) + RF (bdl) → compatible", positionCompatible("RF", "CF") === true);
  check("RF (mlb) + CF (bdl) → compatible", positionCompatible("CF", "RF") === true);
  check("OF (mlb) + LF (bdl) → compatible", positionCompatible("LF", "OF") === true);
  check("OF (mlb) + RF (bdl) → compatible", positionCompatible("RF", "OF") === true);
  check("OF (mlb) + CF (bdl) → compatible", positionCompatible("CF", "OF") === true);
  check("LF (mlb) + OF (bdl) → compatible", positionCompatible("OF", "LF") === true);
  check("OF (mlb) + OF (bdl) → compatible", positionCompatible("OF", "OF") === true);
  // Case-insensitive
  check("lf + rf case-insensitive → compatible", positionCompatible("rf", "lf") === true);

  // Anti-regression: outfield NOT compatible with infield
  check(
    "regression: OF (mlb) + 1B (bdl) → incompatible",
    positionCompatible("1B", "OF") === false
  );
  check(
    "regression: LF (mlb) + 1B (bdl) → incompatible",
    positionCompatible("1B", "LF") === false
  );
  check(
    "regression: OF (mlb) + 2B (bdl) → incompatible",
    positionCompatible("2B", "OF") === false
  );
  check(
    "regression: OF (mlb) + SS (bdl) → incompatible",
    positionCompatible("SS", "OF") === false
  );
  check(
    "regression: OF (mlb) + 3B (bdl) → incompatible",
    positionCompatible("3B", "OF") === false
  );
  check(
    "regression: OF (mlb) + C (bdl) → incompatible",
    positionCompatible("C", "OF") === false
  );
  check(
    "regression: OF (mlb) + DH (bdl) → incompatible",
    positionCompatible("DH", "OF") === false
  );

  // Anti-regression: outfield NOT compatible with pitchers
  check(
    "regression: OF (mlb) + P (bdl) → incompatible",
    positionCompatible("P", "OF") === false
  );
  check(
    "regression: OF (mlb) + SP (bdl) → incompatible",
    positionCompatible("SP", "OF") === false
  );
  check(
    "regression: OF (mlb) + RP (bdl) → incompatible",
    positionCompatible("RP", "OF") === false
  );
  check(
    "regression: LF (mlb) + SP (bdl) → incompatible",
    positionCompatible("SP", "LF") === false
  );

  // Anti-regression: other rules still hold
  check(
    "regression: 1B + 1B still compatible",
    positionCompatible("1B", "1B") === true
  );
  check(
    "regression: 1B + 2B still incompatible",
    positionCompatible("2B", "1B") === false
  );
}

async function testAccentFoldSupplementalSearch() {
  section("attemptMatchForPlayer — accent-fold supplemental search");

  // Setup: MLB profile with accented last name where the accented BDL
  // search returns a wrong-person result, but the folded search
  // surfaces the right player.
  const mlb = makeMlbProfile({
    id: 650490,
    fullName: "Yandy Díaz",
    firstName: "Yandy",
    lastName: "Díaz",
    useName: "Yandy",
    useLastName: "Díaz",
    birthDate: "1991-08-08",
    primaryPositionAbbr: "1B",
    birthCity: "Sagua la Grande",
    birthCountry: "Cuba",
  });

  let calls: string[] = [];
  const stubFn = async (name: string): Promise<BdlCandidate[]> => {
    calls.push(name);
    if (name === "Díaz") {
      // Accented search: returns only a wrong-person result
      return [
        makeBdlCandidate({
          external_id: 999999,
          full_name: "Víctor Díaz",
          first_name: "Víctor",
          last_name: "Díaz",
          dob: "1981-12-10",
          age: 42,
          birth_place: "Chicago, IL",
          position_abbr: "RF",
        }),
      ];
    }
    if (name === "Diaz") {
      // Folded search: returns the right player
      return [
        makeBdlCandidate({
          external_id: 401,
          full_name: "Yandy Díaz",
          first_name: "Yandy",
          last_name: "Díaz",
          dob: "1991-08-08",
          age: 34,
          birth_place: "Sagua La Grande, Cuba",
          position_abbr: "1B",
        }),
        // Same wrong-person result (should be deduped)
        makeBdlCandidate({
          external_id: 999999,
          full_name: "Víctor Díaz",
          first_name: "Víctor",
          last_name: "Díaz",
          dob: "1981-12-10",
          age: 42,
          birth_place: "Chicago, IL",
          position_abbr: "RF",
        }),
      ];
    }
    return [];
  };

  const { match } = await attemptMatchForPlayer(
    mlb,
    { searchBdlByName: stubFn },
    TODAY
  );

  check("supplemental search invoked twice", calls.length === 2);
  check(
    "first call uses accented form",
    calls[0] === "Díaz"
  );
  check(
    "second call uses folded form",
    calls[1] === "Diaz"
  );
  check("match.tier === 'high' (Yandy resolved)", match.tier === "high");
  if (match.tier === "high" || match.tier === "medium") {
    check("matched bdl id === 401", match.bdlId === 401);
  }

  // Regression: when lastName has no accents, no supplemental call.
  calls = [];
  const mlb2 = makeMlbProfile({
    fullName: "Aaron Judge",
    firstName: "Aaron",
    lastName: "Judge",
    useName: "Aaron",
    useLastName: "Judge",
    birthDate: "1992-04-26",
    primaryPositionAbbr: "RF",
  });
  const stubFn2 = async (name: string): Promise<BdlCandidate[]> => {
    calls.push(name);
    return [
      makeBdlCandidate({
        external_id: 569,
        full_name: "Aaron Judge",
        first_name: "Aaron",
        last_name: "Judge",
        dob: "1992-04-26",
        age: 34,
        birth_place: "Linden, CA",
        position_abbr: "RF",
      }),
    ];
  };
  await attemptMatchForPlayer(mlb2, { searchBdlByName: stubFn2 }, TODAY);
  check(
    "no-accents lastName → only 1 call (no supplemental)",
    calls.length === 1
  );
}

async function testEndToEnd_OhtaniTwp() {
  section("attemptMatchForPlayer — Shohei Ohtani two-way player fixture");
  // MLB Stats lists Ohtani as primaryPosition="TWP" (two-way player).
  // BDL lists him as SP. With the TWP compat fix, identity match should
  // still resolve to Tier 1 HIGH.
  const mlb = makeMlbProfile({
    id: 660271,
    fullName: "Shohei Ohtani",
    firstName: "Shohei",
    lastName: "Ohtani",
    useName: "Shohei",
    useLastName: "Ohtani",
    birthDate: "1994-07-05",
    primaryPositionAbbr: "TWP",
    primaryPositionName: "Two-Way Player",
    birthCity: "Oshu",
    birthCountry: "Japan",
  });
  const bdl: BdlCandidate = makeBdlCandidate({
    external_id: 208,
    full_name: "Shohei Ohtani",
    first_name: "Shohei",
    last_name: "Ohtani",
    dob: "1994-07-05", // already ISO from our bdlDobToIso conversion
    age: 31,
    birth_place: "Oshu, Japan",
    position_abbr: "SP",
    team_abbreviation: "LAD",
  });
  const { match, proposedProviderIds } = await attemptMatchForPlayer(
    mlb,
    { searchBdlByName: async () => [bdl] },
    TODAY
  );
  check("Ohtani match.tier === 'high'", match.tier === "high");
  if (match.tier === "high" || match.tier === "medium") {
    check("Ohtani matched bdl id === 208", match.bdlId === 208);
  }
  check("provider_ids has bdl block", "bdl" in proposedProviderIds);
  const bdlBlock = proposedProviderIds.bdl as { id: number; confidence: string };
  check("Ohtani bdl confidence === 'high'", bdlBlock.confidence === "high");
}

async function testEndToEnd_DdMmYyyyPlayer() {
  section("attemptMatchForPlayer — DD/MM/YYYY player fixture (Garrett Crochet)");
  // Crochet's BDL DOB is "21/6/1999" — the new parser yields
  // "1999-06-21" which matches his MLB DOB exactly.
  const mlb = makeMlbProfile({
    id: 676979,
    fullName: "Garrett Crochet",
    firstName: "Garrett",
    lastName: "Crochet",
    useName: "Garrett",
    useLastName: "Crochet",
    birthDate: "1999-06-21",
    primaryPositionAbbr: "P",
    birthCity: "Ocean Springs",
    birthCountry: "USA",
  });
  // BdlCandidate.dob is post-conversion ISO (BallDontLieProvider's
  // mapPlayer runs bdlDobToIso at ingest time).
  const bdl: BdlCandidate = makeBdlCandidate({
    external_id: 555,
    full_name: "Garrett Crochet",
    first_name: "Garrett",
    last_name: "Crochet",
    dob: "1999-06-21",
    age: 25,
    birth_place: "Ocean Springs, MS",
    position_abbr: "SP",
    team_abbreviation: "BOS",
  });
  const { match } = await attemptMatchForPlayer(
    mlb,
    { searchBdlByName: async () => [bdl] },
    TODAY
  );
  check("Crochet match.tier === 'high'", match.tier === "high");
  if (match.tier === "high" || match.tier === "medium") {
    check("Crochet matched bdl id === 555", match.bdlId === 555);
    check("Crochet method === 'name_dob_v1'", match.method === "name_dob_v1");
  }
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

  // Part 1 fix-bundle tests (4.2.C.1.M-fix-bundle)
  await testBdlDobToIso_DdMmYyyy();
  await testBdlDobToIso_DSlashMSlashYyyy();
  await testBdlDobToIso_MmDdYyRegression();
  await testBdlDobToIso_IsoPassthrough();
  await testBdlDobToIso_Malformed();
  await testPositionCompatible_Twp();
  await testPositionCompatible_Outfield();
  await testAccentFoldSupplementalSearch();
  await testEndToEnd_OhtaniTwp();
  await testEndToEnd_DdMmYyyyPlayer();

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
