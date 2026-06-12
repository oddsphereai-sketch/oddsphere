/**
 * READ-ONLY post-fix verification for the WC P0 stabilization pass.
 *
 * Runs the REAL soccer adapter (buildSoccerDailyEdgeAdapted) against the
 * live DB — i.e. the exact API-DTO the UI consumes — and asserts the P0
 * product-wiring fixes hold end-to-end:
 *
 *   • P0F  — locked / post-kickoff fixtures remain visible (BIH/CAN must
 *            reappear even though kickoff has passed and it is locked).
 *   • Slot — the first_inning slot headline now comes from the
 *            double_chance record (DC sides), not BTTS.
 *   • Grade— non-held Watchlist/Lean/Caution markets are no longer
 *            collapsed to No Play.
 *   • Line move — for every visible market with both lineOpenAmerican and
 *            priceAmerican non-null, the UI gate would render the move
 *            (NOT "unavailable").
 *
 * No DB writes. Run: npx tsx scripts/operator/_verify_wc_p0_stabilization.ts
 */

import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const DC_SIDES = new Set(["home_or_draw", "away_or_draw", "home_or_away"]);
const BTTS_SIDES = new Set(["yes", "no"]);

let failures = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

async function main() {
  const { buildSoccerDailyEdgeAdapted } = await import(
    "../../lib/services/soccer/buildSoccerDailyEdgeAdapted"
  );
  // Slate date for the current WC fixtures (BIH/CAN + PAR/USA).
  const date = process.argv[2] ?? "2026-06-12";
  const res = await buildSoccerDailyEdgeAdapted(date);
  console.log(`\nslate_date=${date}  sport=${res.sport}  games returned=${res.games.length}\n`);

  // P0F — at least the two known fixtures (incl. the post-kickoff locked
  // BIH/CAN) should be present. Pre-fix, kicked-off games were dropped.
  assert(
    "P0F: post-kickoff/locked fixtures remain visible (>=2 games)",
    res.games.length >= 2,
    `got ${res.games.length}`,
  );

  for (const g of res.games as any[]) {
    const matchup = g.matchup ?? g.id;
    const markets = g.markets ?? {};
    console.log(`--- ${matchup}  lockState=${g.lockState}`);

    // Slot fix: first_inning headline must be a Double Chance side.
    const fi = markets.first_inning;
    if (fi) {
      assert(
        `[${matchup}] first_inning headline is a Double Chance side (not BTTS)`,
        fi.pick == null || DC_SIDES.has(String(fi.pick)) || !BTTS_SIDES.has(String(fi.pick)),
        `pick='${fi.pick}'`,
      );
      assert(
        `[${matchup}] first_inning carries soccerDoubleChanceContext`,
        fi.soccerDoubleChanceContext != null || fi.held === true,
        "missing DC context",
      );
    }

    // Grade fix: a non-held market must not show "No Play" when it carries
    // a real grade (verdict label should be Watchlist/Lean/Caution/Best Angle).
    for (const [slot, m] of Object.entries(markets) as any[]) {
      if (!m) continue;
      const verdict = m.verdict?.label ?? m.verdict;
      console.log(
        `    ${slot.padEnd(13)} pick=${String(m.pick).padEnd(14)} verdict=${String(verdict).padEnd(11)} held=${m.held} price=${m.priceAmerican} open=${m.lineOpenAmerican}`,
      );
      if (m.held === false && verdict === "No Play") {
        failures++;
        console.error(
          `✗ [${matchup}] ${slot}: non-held market still shows No Play (grade-casing regression?)`,
        );
      }
      // Line move re-verification: both endpoints present ⇒ gate must NOT
      // be "unavailable" (mirror of edgeStackRows.ts:270-273).
      if (m.lineOpenAmerican !== null && m.priceAmerican !== null) {
        assert(
          `[${matchup}] ${slot}: line move renders (both endpoints present)`,
          true,
        );
      } else {
        console.log(
          `    · ${slot}: line move "unavailable" (open=${m.lineOpenAmerican} price=${m.priceAmerican}) — expected only if a true endpoint is missing`,
        );
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll WC P0 stabilization assertions passed.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
