#!/usr/bin/env tsx

/** Builds the qualified selective cross-season NBA props artifact without refitting. */
import { readFileSync, writeFileSync } from "node:fs";

import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";

const active = read(required("active"));
const source = read(required("source"));
const output = required("output");
const selectedMarkets = ["points", "assists", "points_rebounds_assists", "rebounds_assists"] as const;

const selectedByMarket = structuredClone(active.selectedByMarket);
const underlyingByMarket = structuredClone(active.underlyingByMarket);
const candidateMarketMinimumDistance = structuredClone(active.candidateMarketMinimumDistance);
const modelBundleByMarket = structuredClone(active.modelBundleByMarket ?? {});
for (const market of selectedMarkets) {
  selectedByMarket[market] = source.selectedByMarket[market];
  underlyingByMarket[market] = source.underlyingByMarket[market];
  candidateMarketMinimumDistance[market] = source.candidateMarketMinimumDistance[market];
  modelBundleByMarket[market] = "cross_season_r15";
}

const { payloadSha256: _checksum, ...prior } = active;
void _checksum;
const artifact = {
  ...prior,
  release: "nba_player_props_frozen_runtime_artifact_2026_10_26_r11_cross_season_market_heads",
  sourceTournamentRelease: "nba_player_props_model_tournament_2026_10_26_r15_cross_season_market_heads",
  selectedByMarket,
  underlyingByMarket,
  candidateMarketMinimumDistance,
  modelBundles: {
    ...(active.modelBundles ?? {}),
    cross_season_r15: {
      ridgeModel: source.ridgeModel,
      minuteModel: source.minuteModel,
      structuralDirectModels: source.structuralDirectModels,
      structuralLogModels: source.structuralLogModels,
      opportunityModels: source.opportunityModels,
      robustMinuteModel: source.robustMinuteModel,
      robustModels: source.robustModels,
    },
  },
  modelBundleByMarket,
};

writeFileSync(output, `${JSON.stringify({
  ...artifact,
  payloadSha256: nbaPlayerPropsArtifactSha256(artifact),
}, null, 2)}\n`, "utf8");

function read(file: string): Record<string, any> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
}

function required(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}
