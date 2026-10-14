import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateCfbFinalWinnerCoordinator,
} from "../../lib/services/football/cfbFinalWinnerCoordinator";

type Validation = {
  rows: Array<{
    gameId: string;
    readerMargin: number;
    features: Record<string, number | null>;
    expected: {
      baseline: number;
      learned: number;
      authority: number;
      combined: number;
      crosses: boolean;
      targetMargin: number | null;
    };
  }>;
};

const path = process.argv.find((value) => value.startsWith("--validation="))
  ?.slice("--validation=".length);
if (!path) throw new Error("Pass --validation=<generated validation JSON>.");
const validation = JSON.parse(readFileSync(path, "utf8")) as Validation;
let maximumDelta = 0;
let crossings = 0;
for (const row of validation.rows) {
  const actual = evaluateCfbFinalWinnerCoordinator(row.features, row.readerMargin);
  for (const [label, received, expected] of [
    ["baseline", actual.baselineHomeWinProbability, row.expected.baseline],
    ["learned", actual.learnedHomeWinProbability, row.expected.learned],
    ["authority", actual.authority, row.expected.authority],
    ["combined", actual.combinedHomeWinProbability, row.expected.combined],
  ] as const) {
    const delta = Math.abs(received - expected);
    maximumDelta = Math.max(maximumDelta, delta);
    assert.ok(delta <= 1e-12, `${row.gameId} ${label} differs by ${delta}.`);
  }
  assert.equal(actual.crossesWinnerBoundary, row.expected.crosses, `${row.gameId} crossing differs.`);
  if (actual.crossesWinnerBoundary) crossings += 1;
  if (row.expected.targetMargin === null) assert.equal(actual.targetMarginHome, null);
  else assert.ok(Math.abs(actual.targetMarginHome! - row.expected.targetMargin) <= 1e-12);
}
console.log(JSON.stringify({
  release: "cfb_final_winner_coordinator_artifact_parity_2026_10_14_r2_correct_qb",
  rows: validation.rows.length,
  crossings,
  maximumDelta,
  status: "pass",
}, null, 2));
