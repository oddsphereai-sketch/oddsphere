/**
 * Tests for the sport-aware Playbook team normalizer.
 *
 * Ticket: o-non-mlb-team-normalizer.
 *
 * Pure fixture test — no network, no DB. Pins that every WNBA provider name
 * form (full name, city-only, abbreviation, mascot-only, lowercase/punct
 * noise) resolves to OUR canonical abbreviation, and that ambiguous/unknown
 * input returns null rather than guessing.
 *
 * Run with: npm run test:playbook-team-normalizer
 */

import {
  resolveTeam,
  normalizeTeamAbbr,
  buildGameKey,
  hasRegistry,
  cleanName,
} from "../lib/providers/playbook/playbookTeamNormalizer";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function expectAbbr(name: string, expected: string | null, label: string) {
  const actual = normalizeTeamAbbr("wnba", name);
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: "${name}" -> got ${actual ?? "null"}, expected ${expected ?? "null"}`);
  }
}

function expectSportAbbr(
  sport: "wnba" | "nba",
  name: string,
  expected: string | null,
  label: string,
) {
  const actual = normalizeTeamAbbr(sport, name);
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: ${sport} "${name}" -> got ${actual ?? "null"}, expected ${expected ?? "null"}`);
  }
}

function expect(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(label);
  }
}

// ── Full club names (Playbook's primary form, live 2026-06-24) ─────────────
expectAbbr("Indiana Fever", "IND", "fullName");
expectAbbr("Phoenix Mercury", "PHX", "fullName");
expectAbbr("Washington Mystics", "WSH", "fullName");
expectAbbr("Minnesota Lynx", "MIN", "fullName");
expectAbbr("Chicago Sky", "CHI", "fullName");
expectAbbr("Portland Fire", "POR", "fullName");
expectAbbr("Golden State Valkyries", "GS", "fullName");
expectAbbr("New York Liberty", "NY", "fullName");
expectAbbr("Las Vegas Aces", "LV", "fullName");
expectAbbr("Los Angeles Sparks", "LA", "fullName");
expectAbbr("Connecticut Sun", "CON", "fullName");
expectAbbr("Toronto Tempo", "TOR", "fullName");

// ── City-only forms ────────────────────────────────────────────────────────
expectAbbr("Golden State", "GS", "city-only");
expectAbbr("Las Vegas", "LV", "city-only");
expectAbbr("Los Angeles", "LA", "city-only");
expectAbbr("New York", "NY", "city-only");

// ── Abbreviation forms ─────────────────────────────────────────────────────
expectAbbr("LV", "LV", "abbr");
expectAbbr("PHX", "PHX", "abbr");
expectAbbr("GS", "GS", "abbr");
expectAbbr("WSH", "WSH", "abbr");

// ── Mascot-only / nickname forms ───────────────────────────────────────────
expectAbbr("Valkyries", "GS", "mascot-only");
expectAbbr("Aces", "LV", "mascot-only");
expectAbbr("Liberty", "NY", "mascot-only");
expectAbbr("Sparks", "LA", "mascot-only");

// ── Noise tolerance (case, punctuation, spacing) ───────────────────────────
expectAbbr("  indiana   fever  ", "IND", "whitespace");
expectAbbr("PHOENIX MERCURY", "PHX", "uppercase");
expectAbbr("L.A. Sparks", "LA", "punctuation");

// ── Unknown / ambiguous -> null (never guess) ──────────────────────────────
expectAbbr("Brazil National", null, "exhibition-null");
expectAbbr("Team Wilson", null, "allstar-null");
expectAbbr("", null, "empty-null");
expectAbbr("TBD", null, "tbd-null");

// ── resolve() source attribution ───────────────────────────────────────────
expect(resolveTeam("wnba", "Indiana Fever")?.source === "fullName", "source=fullName");
// "Lynx" is a mascot-only form not present in any alias list -> mascot path.
expect(resolveTeam("wnba", "Lynx")?.source === "mascot", "source=mascot");
expect(resolveTeam("wnba", "Golden State")?.source === "city" || resolveTeam("wnba", "Golden State")?.source === "alias", "source=city/alias");

// ── buildGameKey ───────────────────────────────────────────────────────────
expect(buildGameKey("wnba", "Phoenix Mercury", "Indiana Fever") === "PHX@IND", "gameKey wnba");
expect(buildGameKey("wnba", "Brazil National", "Indiana Fever") === null, "gameKey null on unresolved");

// ── NBA registry and live ESPN/database abbreviation compatibility ─────────
expect(hasRegistry("wnba") === true, "wnba has registry");
expect(hasRegistry("nba") === true, "nba has exact registry");
expect(buildGameKey("nba", "Boston Celtics", "Los Angeles Lakers") === "BOS@LAL", "nba canonical game key");

const nbaDatabaseAbbreviations: Array<[string, string]> = [
  ["ATL", "ATL"], ["BKN", "BKN"], ["BOS", "BOS"], ["CHA", "CHA"],
  ["CHI", "CHI"], ["CLE", "CLE"], ["DAL", "DAL"], ["DEN", "DEN"],
  ["DET", "DET"], ["GS", "GSW"], ["HOU", "HOU"], ["IND", "IND"],
  ["LAC", "LAC"], ["LAL", "LAL"], ["MEM", "MEM"], ["MIA", "MIA"],
  ["MIL", "MIL"], ["MIN", "MIN"], ["NO", "NOP"], ["NY", "NYK"],
  ["OKC", "OKC"], ["ORL", "ORL"], ["PHI", "PHI"], ["PHX", "PHX"],
  ["POR", "POR"], ["SA", "SAS"], ["SAC", "SAC"], ["TOR", "TOR"],
  ["UTAH", "UTA"], ["WSH", "WAS"],
];
for (const [databaseAbbr, canonicalAbbr] of nbaDatabaseAbbreviations) {
  expectSportAbbr("nba", databaseAbbr, canonicalAbbr, "nba database abbreviation");
}
expectSportAbbr("nba", "New York Knicks", "NYK", "nba full team name");
expectSportAbbr("nba", "San Antonio Spurs", "SAS", "nba full team name");
expectSportAbbr("nba", "London Lions", null, "nba non-league exhibition team fails closed");

// ── cleanName sanity ───────────────────────────────────────────────────────
expect(cleanName("L.A.  Sparks!!") === "l a sparks", "cleanName punctuation/space");

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\nplaybook-team-normalizer: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("✓ all assertions passed");
