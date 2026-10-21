/**
 * Proves the frozen forward scorer reproduces the release evaluator on an
 * immutable preview block. Read-only; no provider, database, or member writes.
 */
import { readFile } from "node:fs/promises";

import { buildNbaPlayerPropsForwardDecisions } from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import type { NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";
import type { NbaPlayerPropFeatureRow } from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";

type Expected = Readonly<{
  scopeKey: string;
  finalSide: "over" | "under";
  finalProjection: number;
  finalProbability: number;
  sportsbook: string;
  americanPrice: number;
  grade: string;
}>;

async function main(): Promise<void> {
  const inputIndex = process.argv.indexOf("--input");
  const input = inputIndex >= 0 ? process.argv[inputIndex + 1] : null;
  if (!input) throw new Error("--input is required.");
  const payload = JSON.parse(await readFile(input, "utf8")) as {
  mode: string;
  actionable: boolean;
  features: NbaPlayerPropFeatureRow[];
  observations: NbaPlayerPropPriceObservation[];
  rows: Expected[];
  };
  if (payload.actionable !== false || !payload.mode.includes("private")) {
    throw new Error("Frozen-runtime parity accepts only a private non-actionable preview.");
  }
  const actual = buildNbaPlayerPropsForwardDecisions({ features: payload.features, observations: payload.observations });
  const expectedByScope = new Map(payload.rows.map((row) => [row.scopeKey, row]));
  const actualByScope = new Map(actual.map((row) => [row.scopeKey, row]));
  const mismatches: string[] = [];
  for (const [scopeKey, expected] of expectedByScope) {
    const row = actualByScope.get(scopeKey);
    if (!row) { mismatches.push(`${scopeKey}:missing`); continue; }
    if (row.side !== expected.finalSide) mismatches.push(`${scopeKey}:side:${expected.finalSide}->${row.side}`);
    if (Math.abs(row.finalProjection - expected.finalProjection) > 0.001) mismatches.push(`${scopeKey}:projection`);
    if (Math.abs(row.probability - expected.finalProbability) > 0.000_001) mismatches.push(`${scopeKey}:probability`);
    if (row.sportsbook !== expected.sportsbook || row.americanPrice !== expected.americanPrice) mismatches.push(`${scopeKey}:price`);
    if (row.grade !== expected.grade) mismatches.push(`${scopeKey}:grade:${expected.grade}->${row.grade}`);
  }
  for (const scopeKey of actualByScope.keys()) if (!expectedByScope.has(scopeKey)) mismatches.push(`${scopeKey}:unexpected`);
  const report = { expected: expectedByScope.size, actual: actualByScope.size, mismatches: mismatches.length, examples: mismatches.slice(0, 25) };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (mismatches.length > 0) process.exitCode = 1;
}

void main();
