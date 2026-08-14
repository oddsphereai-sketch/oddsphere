/**
 * Static UI guard for reader-selection vs Play Grade color separation.
 * Selection must remain neutral and desktop-only; every market pill keeps
 * its own verdict tint even while it is open in the reader.
 */

import { readFileSync } from "node:fs";

const shell = readFileSync("app/lab/components/daily-edge/DailyEdgeShell.tsx", "utf8");

const checks: Array<[string, boolean]> = [
  ["reader selection uses a neutral white outline", shell.includes("sm:outline-white/35")],
  ["reader selection is desktop-only", shell.includes('const ACTIVE_SELECTION =\n  "sm:outline')],
  ["selected card preserves its verdict border", shell.includes("${CARD_BASE_DEPTH} ${t.ring}")],
  ["selected market preserves its verdict tint", shell.includes("${VERDICT_PILL_TINT[mv]}")],
  ["selected market uses a neutral desktop ring", shell.includes("sm:ring-white/40")],
  ["desktop selection is explicitly labelled", shell.includes("Open in reader")],
  ["mobile keeps the normal breakdown affordance", shell.includes('className="sm:hidden inline-flex')],
  ["legacy violet active ring is removed", !shell.includes("const ACTIVE_RING")],
  ["selection no longer recolors the market violet", !shell.includes('isActiveMarket ? "text-violet')],
  ["slate card reserves a fixed row for matchup status", shell.includes('className="mb-3.5 grid gap-y-2"')],
  ["slate card verdict row has stable height", shell.includes('className="flex min-h-7 items-center gap-2"')],
  ["slate card header no longer conditionally wraps verdict beside matchup", !shell.includes('className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2 mb-3.5"')],
];

let failures = 0;
console.log("\n━━━ Daily Edge selection clarity tests ━━━\n");
for (const [name, passed] of checks) {
  console.log(`  ${passed ? "✓" : "✗"} ${name}`);
  if (!passed) failures++;
}
console.log(`\n  result: ${checks.length - failures}/${checks.length} pass`);
if (failures > 0) process.exit(1);
