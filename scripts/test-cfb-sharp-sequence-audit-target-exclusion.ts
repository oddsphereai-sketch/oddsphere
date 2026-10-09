import assert from "node:assert/strict";
import type { CfbForwardMarketHistoryEvidence } from "../lib/services/football/cfbForwardEvidence";
import { targetExcludedCfbContextFamilies } from "./operator/cfb-sharp-sequence-audit-helpers";

const family = (name: string) => [
  name,
  "b",
  "n",
  null,
  null,
  ["2026-10-09T12:00:00.000Z", -3.5, -110, 3.5, -110, -110],
] as const;

const history = {
  payload: {
    contextualEvidenceCapture: {
      markets: {
        spread: {
          families: [family("draftkings"), family("circa"), family("pinnacle")],
          targetExcludedFamilies: ["circa", "pinnacle"],
        },
      },
    },
  },
} as unknown as CfbForwardMarketHistoryEvidence;

assert.deepEqual(
  targetExcludedCfbContextFamilies(history, "spread").map((entry) => entry[0]),
  ["circa", "pinnacle"],
  "the evaluated target family must never confirm its own historical decision",
);

const missingCapture = { payload: {} } as CfbForwardMarketHistoryEvidence;
assert.deepEqual(targetExcludedCfbContextFamilies(missingCapture, "spread"), []);

console.log("CFB sharp-sequence audit target-exclusion tests passed.");
