import { auditDailyEdgeBoards } from "../lib/services/dailyEdgeDeepAudit";
import {
  assessMlbModelLayerStamp,
  mlbModelLayerFieldsToCompare,
} from "../lib/services/dailyEdge/dailyEdgeDataHealthMonitor";
import {
  MLB_MODEL_LAYER_VERSION_IDS,
  MLB_MODEL_LAYER_VERSION_SCHEMA,
} from "../lib/automodel/mlbModelLayerVersions";

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

const currentMoneylineStamp = {
  schema_version: MLB_MODEL_LAYER_VERSION_SCHEMA,
  projection_core: MLB_MODEL_LAYER_VERSION_IDS.projection_core,
  score_distribution: MLB_MODEL_LAYER_VERSION_IDS.score_distribution,
  moneyline_probability_head: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
  total_probability_head: MLB_MODEL_LAYER_VERSION_IDS.total_probability_head,
  first_inning_probability_head: MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
  market_calibration_policy: MLB_MODEL_LAYER_VERSION_IDS.market_calibration_policy,
  grade_policy: MLB_MODEL_LAYER_VERSION_IDS.grade_policy,
  correction_policy: MLB_MODEL_LAYER_VERSION_IDS.correction_policy,
  tracking_contract: MLB_MODEL_LAYER_VERSION_IDS.tracking_contract,
  market: "moneyline",
  active_probability_head: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
};
check(
  "unlocked current release passes its complete current contract",
  assessMlbModelLayerStamp({ actual: currentMoneylineStamp, market: "moneyline", locked: false }).classification === "current_contract",
);
check(
  "unlocked older release remains a true current-contract error",
  assessMlbModelLayerStamp({
    actual: { ...currentMoneylineStamp, schema_version: "mlb_model_layer_versions_v12_prior" },
    market: "moneyline",
    locked: false,
  }).classification === "incoherent",
);
check(
  "current-schema locked row cannot hide same-release projection incoherence",
  assessMlbModelLayerStamp({
    actual: { ...currentMoneylineStamp, projection_core: "wrong_projection" },
    market: "moneyline",
    locked: true,
  }).classification === "incoherent",
);
const historicalMoneylineStamp = {
  ...currentMoneylineStamp,
  schema_version: "mlb_model_layer_versions_v12_prior",
  projection_core: "mlb_projection_core_v2_3_prior",
  moneyline_probability_head: "mlb_moneyline_probability_v2_prior",
  active_probability_head: "mlb_moneyline_probability_v2_prior",
};
check(
  "complete internally coherent older lock is classified as immutable history",
  assessMlbModelLayerStamp({ actual: historicalMoneylineStamp, market: "moneyline", locked: true }).classification === "locked_historical_release",
);
check(
  "older lock with the wrong active market head remains a true incoherence",
  assessMlbModelLayerStamp({
    actual: { ...historicalMoneylineStamp, active_probability_head: historicalMoneylineStamp.total_probability_head },
    market: "moneyline",
    locked: true,
  }).classification === "incoherent",
);
check(
  "older lock with a missing immutable release id remains a true incoherence",
  assessMlbModelLayerStamp({
    actual: { ...historicalMoneylineStamp, score_distribution: null },
    market: "moneyline",
    locked: true,
  }).classification === "incoherent",
);
check(
  "older lock with mismatched market identity remains a true incoherence",
  assessMlbModelLayerStamp({
    actual: { ...historicalMoneylineStamp, market: "total" },
    market: "moneyline",
    locked: true,
  }).classification === "incoherent",
);

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
