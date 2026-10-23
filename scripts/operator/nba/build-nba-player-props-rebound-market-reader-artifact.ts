#!/usr/bin/env tsx

/** Builds the audited rebound-family reader artifact without refitting any model or grade policy. */
import { readFileSync, writeFileSync } from "node:fs";

import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";

const input = required("input");
const output = required("output");
const source = JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>;
const exact = structuredClone(source.exactPriceArbitrationMinimumDistance) as Record<string, number | null>;
exact.rebounds = 0.04;
exact.rebounds_assists = 0.04;
exact.points_rebounds_assists = 0.04;
const movement = Object.fromEntries(Object.keys(exact).map((market) => [
  market,
  market === "rebounds" || market === "rebounds_assists" || market === "points_rebounds_assists"
    ? "not_opposed"
    : "none",
]));
const { payloadSha256: _priorChecksum, ...prior } = source;
void _priorChecksum;
const artifact = {
  ...prior,
  release: "nba_player_props_frozen_runtime_artifact_2026_10_23_r7_rebound_family_market_reader",
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
