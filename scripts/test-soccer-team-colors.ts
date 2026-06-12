/**
 * Tests for SOCCER_TEAM_COLORS + sport-aware teamPrimaryColor lookup.
 *
 * WC-4 Phase G: prove that soccer team-color resolution works for
 * tonight's confirmed fixtures (CZE, KOR, MEX, RSA) and the broader
 * 2026 WC participant pool, while keeping MLB/NBA/NHL behavior
 * byte-identical to before.
 *
 * Pure constants. No DB. No HTTP.
 */
import {
  teamPrimaryColor,
  FALLBACK_TEAM_COLOR,
  SOCCER_TEAM_COLORS,
  MLB_TEAM_COLORS,
  NBA_TEAM_COLORS,
  NHL_TEAM_COLORS,
} from "../app/lab/components/daily-edge/teamColors";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`);
}
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-team-colors.ts");
console.log("─".repeat(60));

// ── Tonight's confirmed fixtures ─────────────────────────────────────

test("MEX returns Mexico flag green", () => {
  const c = teamPrimaryColor("MEX", "soccer");
  assert(c === "#006847", `expected #006847, got ${c}`);
  assert(c !== FALLBACK_TEAM_COLOR, "must not be fallback");
});

test("RSA returns South Africa flag green", () => {
  const c = teamPrimaryColor("RSA", "soccer");
  assert(c === "#007749", `expected #007749, got ${c}`);
});

test("CZE returns Czechia flag red", () => {
  const c = teamPrimaryColor("CZE", "soccer");
  assert(c === "#D7141A", `expected #D7141A, got ${c}`);
});

test("KOR returns South Korea flag red", () => {
  const c = teamPrimaryColor("KOR", "soccer");
  assert(c === "#CD2E3A", `expected #CD2E3A, got ${c}`);
});

// ── Broader WC2026 coverage (sanity, no fallback) ────────────────────

test("Hosts (USA, CAN) return real colors", () => {
  for (const code of ["USA", "CAN"]) {
    const c = teamPrimaryColor(code, "soccer");
    assert(c !== FALLBACK_TEAM_COLOR, `${code} fell back to gray`);
    assert(c.startsWith("#"), `${code} returned non-hex: ${c}`);
  }
});

test("Top European countries (BRA, ARG, ENG, FRA, GER, ESP) return real colors", () => {
  for (const code of ["BRA", "ARG", "ENG", "FRA", "GER", "ESP"]) {
    const c = teamPrimaryColor(code, "soccer");
    assert(c !== FALLBACK_TEAM_COLOR, `${code} fell back to gray`);
  }
});

test("African / Asian participants (JPN, AUS, GHA, SEN, MAR) return real colors", () => {
  for (const code of ["JPN", "AUS", "GHA", "SEN", "MAR"]) {
    const c = teamPrimaryColor(code, "soccer");
    assert(c !== FALLBACK_TEAM_COLOR, `${code} fell back to gray`);
  }
});

// ── Fallback behavior ────────────────────────────────────────────────

test("Unknown soccer abbreviation returns fallback", () => {
  const c = teamPrimaryColor("ZZZ", "soccer");
  assert(c === FALLBACK_TEAM_COLOR, `expected fallback, got ${c}`);
});

test("Null/empty abbreviation returns fallback regardless of sport", () => {
  assert(teamPrimaryColor(null, "soccer") === FALLBACK_TEAM_COLOR);
  assert(teamPrimaryColor("", "soccer") === FALLBACK_TEAM_COLOR);
  assert(teamPrimaryColor(undefined, "soccer") === FALLBACK_TEAM_COLOR);
});

test("UCL sport also routes to soccer map (shared)", () => {
  // For tonight UCL teams aren't seeded; this just proves the routing
  // doesn't divert UCL to MLB (which would silently break UCL cards).
  const c = teamPrimaryColor("ENG", "ucl");
  assert(c !== FALLBACK_TEAM_COLOR, "UCL should hit soccer map");
});

// ── MLB / NBA / NHL — no regression ─────────────────────────────────

test("MLB lookup unchanged (NYY remains Yankees navy)", () => {
  const c = teamPrimaryColor("NYY", "mlb");
  assert(c === MLB_TEAM_COLORS["NYY"]?.primary, `MLB NYY changed: ${c}`);
});

test("MLB lookup unchanged with default (sport omitted)", () => {
  const c = teamPrimaryColor("NYY");
  assert(c === MLB_TEAM_COLORS["NYY"]?.primary, `MLB default route changed: ${c}`);
});

test("NBA lookup unchanged (LAL remains Lakers purple)", () => {
  const c = teamPrimaryColor("LAL", "nba");
  assert(c === NBA_TEAM_COLORS["LAL"]?.primary, `NBA LAL changed: ${c}`);
});

test("NHL lookup unchanged (NYR remains Rangers blue)", () => {
  const c = teamPrimaryColor("NYR", "nhl");
  assert(c === NHL_TEAM_COLORS["NYR"]?.primary, `NHL NYR changed: ${c}`);
});

test("BOS — different sport contexts return different colors", () => {
  // BOS is Red Sox (MLB) AND Celtics (NBA). Sport-aware lookup must
  // disambiguate. Without sport-awareness this would silently collide.
  const mlbBos = teamPrimaryColor("BOS", "mlb");
  const nbaBos = teamPrimaryColor("BOS", "nba");
  assert(mlbBos !== nbaBos, "BOS must differ between MLB and NBA");
  assert(mlbBos === MLB_TEAM_COLORS["BOS"]?.primary);
  assert(nbaBos === NBA_TEAM_COLORS["BOS"]?.primary);
});

// ── SOCCER_TEAM_COLORS structural ────────────────────────────────────

test("SOCCER_TEAM_COLORS covers at least 30 nations", () => {
  const n = Object.keys(SOCCER_TEAM_COLORS).length;
  assert(n >= 30, `expected ≥ 30 soccer entries, got ${n}`);
});

test("Every SOCCER_TEAM_COLORS entry is a 7-char hex string", () => {
  for (const [code, entry] of Object.entries(SOCCER_TEAM_COLORS)) {
    assert(/^#[0-9A-F]{6}$/i.test(entry.primary), `bad hex on ${code}: ${entry.primary}`);
  }
});

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ soccer-team-colors tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
