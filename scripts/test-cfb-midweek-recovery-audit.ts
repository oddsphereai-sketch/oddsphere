import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/cron/cfb-midweek-recovery-audit/route.ts", "utf8");
const service = readFileSync("lib/services/football/cfbMidweekRecoveryAudit.ts", "utf8");
const writer = readFileSync("lib/services/football/cfbForwardEvidenceWriter.ts", "utf8");

assert.match(route, /cronHandler/);
assert.match(route, /leaseGroup: "prediction_pipeline"/);
assert.match(route, /records_updated: 0/);
assert.match(route, /requiredEnv\("THE_ODDS_API_KEY"\)/);
assert.match(service, /apply: false/);
assert.match(service, /auditForceTheOddsApi: true/);
assert.match(service, /auditUseMidweekRecoveryCandidate: true/);
assert.match(service, /auditIgnoreTheOddsApiCreditReserve: true/);
assert.match(service, /promotions/);
assert.match(service, /demotions/);
assert.match(writer, /args\.apply && \([^\n]*args\.auditUseMidweekRecoveryCandidate/);
assert.match(writer, /args\.apply && \([^\n]*args\.auditIgnoreTheOddsApiCreditReserve/);

console.log("CFB midweek recovery audit guard tests passed.");
