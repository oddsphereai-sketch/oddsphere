#!/usr/bin/env tsx

/** Builds the predeclared rebound/threes architecture artifact without refitting. */
import { readFileSync, writeFileSync } from "node:fs";

import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";

const input = required("input");
const output = required("output");
const source = JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>;
const selectedByMarket = structuredClone(source.selectedByMarket) as Record<string, string>;
const underlyingByMarket = structuredClone(source.underlyingByMarket) as Record<string, string>;
const candidateDistance = structuredClone(source.candidateMarketMinimumDistance) as Record<string, number | null>;
const exactDistance = structuredClone(source.exactPriceArbitrationMinimumDistance) as Record<string, number | null>;
const movementPolicy = structuredClone(source.exactPriceArbitrationMovementPolicy) as Record<string, "none" | "not_opposed">;

selectedByMarket.rebounds = "fanduel_confirmed_2pp_disagreements";
underlyingByMarket.rebounds = "ridge_r2_minutes_regression";
candidateDistance.rebounds = 0.02;

selectedByMarket.threes = "structural_direct_counts";
underlyingByMarket.threes = "structural_direct_counts";
candidateDistance.threes = null;

exactDistance.rebounds = 0.02;
exactDistance.rebounds_assists = 0.02;

for (const market of ["rebounds", "rebounds_assists"] as const) {
  movementPolicy[market] = "none";
}

const { payloadSha256: _priorChecksum, ...prior } = source;
void _priorChecksum;
const artifact = {
  ...prior,
  release: "nba_player_props_frozen_runtime_artifact_2026_10_26_r10_rebound_threes_architecture",
  sourceTournamentRelease: "nba_player_props_model_tournament_2026_10_26_r14_rebound_threes_architecture",
  selectedByMarket,
  underlyingByMarket,
  genericMinutesUntilCurrentTeamAppearancesByMarket: {},
  candidateMarketMinimumDistance: candidateDistance,
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
