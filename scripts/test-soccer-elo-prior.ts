/**
 * Tests for the Elo prior loader — WC-3.
 */

import { buildEloPriorFromCsv, loadDefaultEloPrior } from "../lib/services/soccer/eloPrior";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`);
}
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-elo-prior.ts");
console.log("─".repeat(60));

const sampleCsv = `team_name,country_code,elo_rating,confederation,source_url,retrieval_date,notes
# comment line ignored
Argentina,ARG,2150,CONMEBOL,https://elo,2026-06-11,
Brazil,BRA,2100,CONMEBOL,https://elo,2026-06-11,
São Tomé,STP,1500,CAF,https://elo,2026-06-11,diacritics
USA,USA,1860,CONCACAF,https://elo,2026-06-11,host
`;

test("parses CSV ignoring comment + empty lines", () => {
  const t = buildEloPriorFromCsv(sampleCsv);
  assert(t.meta.team_count === 4, `expected 4 teams, got ${t.meta.team_count}`);
});

test("lookupByCountryCode is case-insensitive", () => {
  const t = buildEloPriorFromCsv(sampleCsv);
  assert(t.lookupByCountryCode("ARG")?.elo_rating === 2150);
  assert(t.lookupByCountryCode("arg")?.elo_rating === 2150);
});

test("lookupByTeamName tolerates diacritics + case", () => {
  const t = buildEloPriorFromCsv(sampleCsv);
  assert(t.lookupByTeamName("Sao Tome")?.country_code === "STP", "ASCII-folded match");
});

test("missing team returns null", () => {
  const t = buildEloPriorFromCsv(sampleCsv);
  assert(t.lookupByCountryCode("XXX") === null);
  assert(t.lookupByTeamName("Nowhereia") === null);
});

test("zScore is computed against mean + stddev", () => {
  const t = buildEloPriorFromCsv(sampleCsv);
  const arg = t.lookupByCountryCode("ARG")!;
  const z = t.zScore(arg.elo_rating);
  assert(z > 0, "Argentina should be above mean");
  const usa = t.lookupByCountryCode("USA")!;
  const zUsa = t.zScore(usa.elo_rating);
  assert(zUsa < 0 || Math.abs(zUsa) < 0.5, "USA near or below mean");
});

test("meta carries source + retrieval date for provenance", () => {
  const t = buildEloPriorFromCsv(sampleCsv);
  assert(t.meta.source_url === "https://elo");
  assert(t.meta.retrieval_date === "2026-06-11");
});

test("loadDefaultEloPrior reads the committed CSV with at least 48 teams", () => {
  const t = loadDefaultEloPrior();
  // Snapshot may include some teams that ultimately did not qualify
  // (e.g., reasonable approximations during the pre-tournament window).
  // The operator-verifiable invariant is ≥ 48 teams plus the WC-1
  // headline fixtures present.
  assert(t.meta.team_count >= 48, `expected ≥ 48 teams in default snapshot, got ${t.meta.team_count}`);
  assert(t.lookupByCountryCode("MEX") !== null, "Mexico must be in default snapshot");
  assert(t.lookupByCountryCode("RSA") !== null, "South Africa must be in default snapshot");
  assert(t.lookupByCountryCode("ARG") !== null, "Argentina must be in default snapshot");
});

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ elo-prior tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
