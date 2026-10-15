import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "nba-r1-market-eligibility-"));
const input = join(directory, "input.csv");
const output = join(directory, "output");

try {
  writeFileSync(input, [
    "Date,Home,Away,OU,Spread,ML_Home,ML_Away,Points,Win_Margin,Days_Rest_Home,Days_Rest_Away,market_home_prob,market_available",
    "2024-10-22,Alpha,Beta,220,4,-180,155,218,6,7,7,0.62,true",
    "2024-10-23,Gamma,Delta,225,-3,135,-155,230,-7,7,7,0.40,true",
    "2025-10-21,Alpha,Gamma,221,5,-205,175,224,8,7,7,0.65,true",
    // Neutral placeholders preserve score/rest replay coverage but are not
    // allowed into spread, total, market benchmark, or market-marriage claims.
    "2025-10-22,Beta,Delta,210,0,-110,-110,210,-4,7,7,0.50,false",
  ].join("\n") + "\n");

  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    resolve("scripts/audit/nba/replay-nba-independent-score-state.ts"),
    input,
    output,
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
  assert.deepEqual(report.marketEligibility["2025"], {
    eligibleGames: 1,
    totalGames: 2,
    coverage: 0.5,
  });
  assert.equal(report.report["2025"].independent.games, 2);
  assert.equal(report.report["2025"].independentMarketEligible.games, 1);
  assert.equal(report.report["2025"].closingMarketBenchmark.games, 1);
  assert.equal(report.report["2025"].incumbentMarketGrounded65.games, 1);

  const ledger = readFileSync(join(output, "confirmation-predictions.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const unavailable = ledger.find((row) => row.marketAvailable === false);
  assert.ok(unavailable);
  assert.equal(unavailable.spreadDirectionCorrect, null);
  assert.equal(unavailable.totalDirectionCorrect, null);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("nba r1 replay market eligibility tests passed");
