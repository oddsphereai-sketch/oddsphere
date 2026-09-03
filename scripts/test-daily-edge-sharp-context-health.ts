import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  currentSourceSharpContextSeverity,
} from "../lib/services/dailyEdge/dailyEdgeDataHealthMonitor";

assert.equal(
  currentSourceSharpContextSeverity("low"),
  "medium",
  "expected-but-unavailable Sharp context remains visible as an availability warning",
);
assert.equal(
  currentSourceSharpContextSeverity("medium"),
  "medium",
  "ordinary current-source unavailability must not make an otherwise coherent board unsafe",
);
assert.equal(
  currentSourceSharpContextSeverity("high"),
  "high",
  "an evidence contract that marks missing Sharp context high-materiality remains high",
);

const monitorSource = readFileSync("lib/services/dailyEdge/dailyEdgeDataHealthMonitor.ts", "utf8");
const currentSourceBranch = monitorSource.match(
  /sharpStatus === "sharp_context_unavailable_current_source"[\s\S]*?\n\s*}\n/,
)?.[0] ?? "";

assert.match(
  currentSourceBranch,
  /currentSourceSharpContextSeverity\(row\.marketEvidence\.sourceMissingMateriality\)/,
  "only the exact current-source-unavailable branch uses availability-aware severity",
);
assert.doesNotMatch(
  monitorSource,
  /row\.identity\.sport === "mlb" \? "high" : "medium"/,
  "MLB source unavailability is not hard-coded as a model-integrity failure",
);
assert.match(
  monitorSource,
  /for \(const gap of review\.persistenceGaps\)[\s\S]*?"high"/,
  "persistence gaps retain their independent high-severity path",
);

console.log("PASS Daily Edge Sharp-context health separates provider availability from integrity failures");
