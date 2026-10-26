#!/usr/bin/env tsx

/**
 * Compatibility entry point for rebuilding the current audited rebound-family
 * reader artifact without refitting any model or grade policy.
 *
 * Keep this legacy filename aligned with the authoritative component-reader
 * builder so an older operator command cannot restore the superseded r7 gate.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";

const input = required("input");
const output = required("output");
const source = JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>;
const exact = structuredClone(source.exactPriceArbitrationMinimumDistance) as Record<string, number | null>;
exact.rebounds = 0.02;
exact.rebounds_assists = 0.02;
const movement = structuredClone(source.exactPriceArbitrationMovementPolicy) as Record<
  string,
  "none" | "not_opposed"
>;
movement.rebounds = "none";
movement.rebounds_assists = "none";
const { payloadSha256: _priorChecksum, ...prior } = source;
void _priorChecksum;
const artifact = {
  ...prior,
  release: "nba_player_props_frozen_runtime_artifact_2026_10_26_r8_component_market_reader",
  exactPriceArbitrationMinimumDistance: exact,
  exactPriceArbitrationMovementPolicy: movement,
};
writeFileSync(output, `${JSON.stringify({
  ...artifact,
  payloadSha256: nbaPlayerPropsArtifactSha256(artifact),
}, null, 2)}\n`, "utf8");

function required(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}
