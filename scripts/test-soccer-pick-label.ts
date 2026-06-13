/**
 * Pure tests for the shared soccerPickLabel helper.
 *
 * Locks the contract that both the snapshot text composers (lib side)
 * and the card UI (app side) read from the same source of truth.
 */
import { soccerPickLabel } from "../lib/services/soccer/soccerPickLabel";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

async function main() {
  section("match_result");
  check(`home → "{Team} Win" ("KOR Win")`, soccerPickLabel("match_result", "home", null, "CZE", "KOR") === "KOR Win");
  check(`away → "{Team} Win" ("CZE Win")`, soccerPickLabel("match_result", "away", null, "CZE", "KOR") === "CZE Win");
  check(`draw → "Draw"`, soccerPickLabel("match_result", "draw", null, "CZE", "KOR") === "Draw");
  check(`home with no abbr → "Home"`, soccerPickLabel("match_result", "home", null) === "Home");
  check(`away with no abbr → "Away"`, soccerPickLabel("match_result", "away", null) === "Away");

  section("moneyline alias");
  check(`home → "{Team} Win" ("PAR Win")`, soccerPickLabel("moneyline", "home", null, "USA", "PAR") === "PAR Win");
  check(`away → "{Team} Win" ("USA Win")`, soccerPickLabel("moneyline", "away", null, "USA", "PAR") === "USA Win");
  check(`draw → "Draw"`, soccerPickLabel("moneyline", "draw", null, "USA", "PAR") === "Draw");

  section("btts / first_inning");
  check(`yes → "Yes"`, soccerPickLabel("btts", "yes", null) === "Yes");
  check(`no → "No"`, soccerPickLabel("btts", "no", null) === "No");
  check(`yes (first_inning slot) → "Yes"`, soccerPickLabel("first_inning", "yes", null) === "Yes");

  section("total");
  check(`over with line 2.5 → "Over 2.5"`, soccerPickLabel("total", "over", 2.5) === "Over 2.5");
  check(`under with line 3.0 → "Under 3"`, soccerPickLabel("total", "under", 3) === "Under 3");
  check(`over without line → "Over"`, soccerPickLabel("total", "over", null) === "Over");
  check(`UPPER over → "Over <line>"`, soccerPickLabel("total", "OVER", 2.5) === "Over 2.5");

  section("double_chance composites");
  check(`home_or_draw → "MEX or Draw"`, soccerPickLabel("double_chance", "home_or_draw", null, "RSA", "MEX") === "MEX or Draw");
  check(`away_or_draw → "RSA or Draw"`, soccerPickLabel("double_chance", "away_or_draw", null, "RSA", "MEX") === "RSA or Draw");
  check(`home_or_away → "RSA or MEX"`, soccerPickLabel("double_chance", "home_or_away", null, "RSA", "MEX") === "RSA or MEX");
  check(`home_or_draw with no abbr → "Home or Draw"`, soccerPickLabel("double_chance", "home_or_draw", null) === "Home or Draw");

  section("null + unknown values");
  check(`null pick → null`, soccerPickLabel("match_result", null, null) === null);
  check(`unknown pick → null (caller keeps original)`, soccerPickLabel("match_result", "weird_value", null) === null);

  section("case-insensitive raw pick");
  check(`HOME → "{Team} Win" ("KOR Win")`, soccerPickLabel("match_result", "HOME", null, "CZE", "KOR") === "KOR Win");
  check(`Draw → "Draw"`, soccerPickLabel("match_result", "Draw", null) === "Draw");

  // Summary
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All soccerPickLabel tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
