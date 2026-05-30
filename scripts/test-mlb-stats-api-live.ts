/**
 * Phase 3.x.0b — operator-run live smoke for MLB Stats API helper.
 *
 * Run: npx tsx scripts/test-mlb-stats-api-live.ts
 * No DB writes. No env vars. ≤ 4 HTTP calls, ~500ms throttle.
 * Not part of the regression suite.
 */
import {
  searchPersonByNameDob,
  getPitcherFirstInningStats,
} from "../lib/providers/real_api/_mlbStatsApiClient";

type Fixture = { name: string; dob: string; expectedId: number };

const fixtures: Fixture[] = [
  { name: "Garrett Crochet", dob: "1999-06-21", expectedId: 676979 },
  { name: "Kyle Bradish", dob: "1996-09-12", expectedId: 680694 },
];

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

async function main(): Promise<void> {
  console.log("Phase 3.x.0b — MLB Stats API live smoke");
  console.log("─".repeat(60));

  for (const f of fixtures) {
    console.log(`\n${f.name} (DOB ${f.dob})`);

    const person = await searchPersonByNameDob(f.name, f.dob);
    check(
      `resolved id=${person?.id} (expected ${f.expectedId})`,
      person?.id === f.expectedId
    );
    if (!person) continue;
    await sleep(500);

    const stats = await getPitcherFirstInningStats(person.id, 2025);
    check("stats record returned", stats !== null);
    if (!stats) continue;

    const eraOk =
      stats.first_inning_era !== null &&
      stats.first_inning_era >= 0 &&
      stats.first_inning_era < 30;
    const startsOk =
      stats.first_inning_starts !== null && stats.first_inning_starts >= 1;
    const ipOk =
      stats.first_inning_innings_pitched !== null &&
      stats.first_inning_innings_pitched > 0;
    check(`era=${stats.first_inning_era} in sane range`, eraOk);
    check(`starts=${stats.first_inning_starts} ≥ 1`, startsOk);
    check(
      `ip=${stats.first_inning_innings_pitched?.toFixed(2)} > 0`,
      ipOk
    );
    console.log(
      `    ER=${stats.first_inning_earned_runs}  R=${stats.first_inning_runs_allowed}  WHIP=${stats.first_inning_whip}`
    );

    await sleep(500);
  }

  console.log("\n" + "─".repeat(60));
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log("\n❌ Live smoke failed.");
    process.exit(1);
  }
  console.log("\n✅ Live smoke passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
