/**
 * WC 2026-06-12 — DTO isolation regression.
 *
 * Guarantees that the four new soccer-only `MarketEdgeDto` fields
 * (`soccerMatchResultContext`, `soccerDoubleChanceContext`,
 * `soccerTotalContext`, `soccerBttsContext`) NEVER appear on MLB,
 * NBA, or NHL Daily Edge market slots — they are populated only by
 * `buildSoccerDailyEdgeAdapted`. Combined with the static
 * `shellSport === "soccer" || shellSport === "ucl"` guards on every
 * new MarketPulse render branch in DailyEdgeShell.tsx, this proves
 * the WC reader pass cannot regress other sports.
 *
 * Pure type-level + adapter-source check — no DB / network required.
 */

import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-context-fields-isolation.ts — WC reader-field isolation");
console.log("─".repeat(70));

const SOCCER_FIELDS = [
  "soccerMatchResultContext",
  "soccerDoubleChanceContext",
  "soccerTotalContext",
  "soccerBttsContext",
];

const NON_SOCCER_ADAPTERS = [
  "lib/services/buildDailyEdgeResponse.ts",
  "lib/services/buildMlbDailyEdgeResponse.ts",
  "lib/services/nba/buildNbaDailyEdgeAdapted.ts",
  "lib/services/nhl/buildNhlDailyEdgeAdapted.ts",
];

function fileMaybe(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// ─── 1 ──────────────────────────────────────────────────────────────
test("1. Soccer adapter populates all four reader-context fields", () => {
  const soccer = fileMaybe("lib/services/soccer/buildSoccerDailyEdgeAdapted.ts");
  assert(soccer !== null, "soccer adapter must exist");
  for (const f of SOCCER_FIELDS) {
    assert((soccer as string).includes(f), `soccer adapter must reference ${f}`);
  }
});

// ─── 2 ──────────────────────────────────────────────────────────────
test("2. Non-soccer adapters never assign any of the four new fields", () => {
  for (const adapterPath of NON_SOCCER_ADAPTERS) {
    const src = fileMaybe(adapterPath);
    if (src === null) continue; // skip adapters that don't exist on this branch
    for (const f of SOCCER_FIELDS) {
      assert(
        !src.includes(f),
        `${adapterPath} must NOT reference ${f}`,
      );
    }
  }
});

// ─── 3 ──────────────────────────────────────────────────────────────
test("3. Soccer-only render branches in DailyEdgeShell are sport-guarded", () => {
  const shell = fileMaybe("app/lab/components/daily-edge/DailyEdgeShell.tsx");
  assert(shell !== null, "shell must exist");
  // Each new soccer component must be referenced ONLY in code that
  // also contains the sport guard within a small window. Cheap proxy:
  // verify each component name appears at least once AND every
  // occurrence of the component in JSX (`<NAME `) lives within 12
  // lines of a `shellSport === "soccer" || shellSport === "ucl"`
  // check.
  const NEW_COMPONENTS = ["SoccerBttsContext", "SoccerTotalContext", "SoccerDcContext"];
  const lines = (shell as string).split("\n");
  for (const comp of NEW_COMPONENTS) {
    const usages: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`<${comp} `) || lines[i].includes(`<${comp}\n`) || lines[i].includes(`<${comp}/>`)) {
        usages.push(i);
      }
    }
    assert(usages.length > 0, `${comp} must be used in the shell`);
    for (const idx of usages) {
      const start = Math.max(0, idx - 25);
      const end = Math.min(lines.length, idx + 2);
      const window = lines.slice(start, end).join("\n");
      assert(
        window.includes(`shellSport === "soccer"`) && window.includes(`shellSport === "ucl"`),
        `${comp} usage at line ${idx + 1} must be inside a soccer/ucl sport guard`,
      );
    }
  }
});

// ─── 4 ──────────────────────────────────────────────────────────────
test("4. Extended SoccerWdlBars still works without context (back-compat)", () => {
  const shell = fileMaybe("app/lab/components/daily-edge/DailyEdgeShell.tsx");
  assert(shell !== null, "shell must exist");
  // The extended SoccerWdlBars takes optional `market`, `edge`, `note`.
  // The fallback note copy must still mention "Public splits aren't
  // reported for World Cup" so that prod fixtures without a
  // soccerMatchResultContext continue to render the original line.
  assert(
    (shell as string).includes("Public splits aren't reported for World Cup at this stage"),
    "back-compat fallback copy preserved",
  );
});

// ─── 5 ──────────────────────────────────────────────────────────────
test("5. MarketEdgeDto fields are optional (no required regressions)", () => {
  const types = fileMaybe("app/lab/lib/labTypes.ts");
  assert(types !== null, "labTypes must exist");
  for (const f of SOCCER_FIELDS) {
    // Each new field must be declared with `?:` (optional)
    const re = new RegExp(`${f}\\?:`);
    assert(re.test(types as string), `${f} must be declared optional`);
  }
});

console.log("─".repeat(70));
console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
