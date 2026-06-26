import { marketIntelligenceGameKey } from "../lib/services/marketIntelligenceV2/shadowSync";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) pass++;
  else {
    fail++;
    failures.push(detail ? `${label}: ${detail}` : label);
  }
}

check(
  "MLB key normalizes full team names",
  marketIntelligenceGameKey("mlb", "Houston Astros", "Detroit Tigers") === "HOU@DET",
);
check(
  "MLB key rejects unknown teams",
  marketIntelligenceGameKey("mlb", "Not A Team", "Detroit Tigers") === null,
);
check(
  "WNBA key normalizes known team names",
  marketIntelligenceGameKey("wnba", "Los Angeles Sparks", "Toronto Tempo") === "LA@TOR",
);
check(
  "Unregistered Playbook sports fall back to stable mascot keys",
  marketIntelligenceGameKey("nfl", "Buffalo Bills", "Houston Texans") === "bills@texans",
);

console.log(`\nmarket-intelligence-v2-shadow-sync: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log("all assertions passed");
