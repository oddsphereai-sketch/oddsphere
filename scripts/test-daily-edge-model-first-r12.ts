import { auditDailyEdgeBoards } from "../lib/services/dailyEdgeDeepAudit";
import { mlbModelLayerFieldsToCompare } from "../lib/services/dailyEdge/dailyEdgeDataHealthMonitor";

let failed = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log("━━━ r12 release-aware health contract ━━━");
const lockedFields = mlbModelLayerFieldsToCompare(true);
const unlockedFields = mlbModelLayerFieldsToCompare(false);
for (const policyField of ["grade_policy", "correction_policy", "tracking_contract"] as const) {
  check(`locked rows preserve historical ${policyField}`, !lockedFields.includes(policyField));
  check(`unlocked rows require current ${policyField}`, unlockedFields.includes(policyField));
}
check("locked rows still verify immutable probability head", lockedFields.includes("active_probability_head"));
check("locked rows still verify projection identity", lockedFields.includes("projection_core"));

console.log("\n━━━ r12 neutral FI audit explanation ━━━");
const neutralFiAudit = auditDailyEdgeBoards({
  mlb: {
    games: [{
      awayTeam: "TOR",
      homeTeam: "WSH",
      lockState: "open",
      markets: {
        first_inning: {
          pick: "Toss-Up",
          side: null,
          verdict: { key: "no_play" },
          recommendationConfidence: null,
          modelMarketGapPct: 2.8,
          guidedGuide: "Toss-Up: no actionable side in a coin-flip range.",
          capReasons: [],
          priceAmerican: null,
        },
      },
    }],
  },
});
check(
  "Toss-Up with an explicit neutral explanation is not a false critical alert",
  !neutralFiAudit.issues.some((issue) => issue.reason === "no_play_positive_edge_needs_explanation"),
);

if (failed > 0) {
  console.error(`\n${failed} r12 checks failed`);
  process.exit(1);
}
console.log("\nAll r12 focused checks passed.");
