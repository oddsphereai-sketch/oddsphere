#!/usr/bin/env tsx

/** Builds the predeclared component-aware market-reader artifact without refitting. */
import { readFileSync, writeFileSync } from "node:fs";

import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";

const input = required("input");
const output = required("output");
const source = JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>;
const exactDistance = structuredClone(source.exactPriceArbitrationMinimumDistance) as Record<string, number | null>;
const movementPolicy = structuredClone(source.exactPriceArbitrationMovementPolicy) as Record<string, "none" | "not_opposed">;

exactDistance.rebounds = 0.02;
exactDistance.rebounds_assists = 0.02;

for (const market of ["rebounds", "rebounds_assists"] as const) {
  movementPolicy[market] = "none";
}

const { payloadSha256: _priorChecksum, ...prior } = source;
void _priorChecksum;
const artifact = {
  ...prior,
  release: "nba_player_props_frozen_runtime_artifact_2026_10_26_r8_component_market_reader",
  exactPriceArbitrationMinimumDistance: exactDistance,
  exactPriceArbitrationMovementPolicy: movementPolicy,
};

writeFileSync(output, `${JSON.stringify({
  ...artifact,
  payloadSha256: nbaPlayerPropsArtifactSha256(artifact),
}, null, 2)}\n`, "utf8");

function required(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const found = index >= 0 ? process.argv[index + 1] : null;
  if (!found) throw new Error(`--${name} is required.`);
  return found;
}
