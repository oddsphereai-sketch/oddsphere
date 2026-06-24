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

// ── Registry/scaffold behavior for other sports ────────────────────────────
expect(hasRegistry("wnba") === true, "wnba has registry");
expect(hasRegistry("nba") === false, "nba scaffolded (no registry yet)");
// Unpopulated sport: resolveTeam returns null, but buildGameKey falls back to
// mascot slug so name-to-name matching still works until a registry lands.
expect(normalizeTeamAbbr("nba", "Boston Celtics") === null, "nba abbr null (no registry)");
expect(buildGameKey("nba", "Boston Celtics", "Los Angeles Lakers") === "celtics@lakers", "nba fallback slug key");

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
