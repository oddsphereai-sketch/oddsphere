import { readFileSync } from "node:fs";
import { shouldRunPostPublishPredictionRecordSync } from "../lib/services/automationOrchestrator";

const source = readFileSync("lib/services/automationOrchestrator.ts", "utf8");
let pass = 0;
let fail = 0;
const check = (label: string, condition: boolean) => {
  console.log(`  ${condition ? "✓" : "✗"} ${label}`);
  condition ? pass++ : fail++;
};

const m2 = source.indexOf('"m2_automodel",');
const m3 = source.indexOf('"m3_prediction_records_sync",', m2 + 1);
const publish = source.indexOf("// ── S11. Publish gate", m3 + 1);
const sync = source.slice(m3, publish);
const publishGate = source.slice(publish);
const m4 = source.indexOf('"m4_post_publish_prediction_records_sync"', publish + 1);

console.log("\n━━━ Daily Edge post-model record synchronization ━━━\n");
check("sync runs after M2", m2 >= 0 && m3 > m2);
check("sync runs before publish", publish > m3);
check("sync rebuilds prediction_records", sync.includes("createPredictionRecords({"));
check("sync requires a writable M2", sync.includes('m2Step.mode === "wrote"'));
check("sync failure blocks publish", publishGate.includes("memberRecordSyncBlocking"));
check("post-publish sync follows publish", m4 > publish);
check(
  "post-publish sync runs only for an MLB publication with promoted games",
  shouldRunPostPublishPredictionRecordSync({ sport: "mlb", publishMode: "wrote", promotedGames: 1 }) &&
    !shouldRunPostPublishPredictionRecordSync({ sport: "mlb", publishMode: "wrote", promotedGames: 0 }) &&
    !shouldRunPostPublishPredictionRecordSync({ sport: "nfl", publishMode: "wrote", promotedGames: 1 }) &&
    !shouldRunPostPublishPredictionRecordSync({ sport: "mlb", publishMode: "skipped", promotedGames: 1 }),
);
check(
  "post-publish sync reuses the existing prediction-record writer",
  source.slice(m4).includes("createPredictionRecords({"),
);

console.log(`\n${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) process.exit(1);
