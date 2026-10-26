#!/usr/bin/env tsx

/**
 * Research-only adapter for replaying an older frozen NBA props artifact under
 * the current grade and movement contracts. It does not write production or
 * member state.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";

const source = read(required("source"));
const active = read(required("active"));
const output = required("output");
const selectedMarkets = new Set((optional("markets") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const retainActiveCalibration = process.argv.includes("--retain-active-calibration");

const { payloadSha256: _sourceChecksum, ...sourceWithoutChecksum } = source;
void _sourceChecksum;

const artifact = selectedMarkets.size === 0 ? {
  ...sourceWithoutChecksum,
  release: `nba_player_props_research_candidate_${Date.now()}`,
  publicEnabled: false,
  exactPriceArbitrationMinimumDistance: active.exactPriceArbitrationMinimumDistance,
  exactPriceArbitrationMovementPolicy: active.exactPriceArbitrationMovementPolicy,
  genericMinutesUntilCurrentTeamAppearancesByMarket:
    source.genericMinutesUntilCurrentTeamAppearancesByMarket ?? {},
  gradePolicies: active.gradePolicies,
} : buildSelectiveArtifact();

writeFileSync(output, `${JSON.stringify({
  ...artifact,
  payloadSha256: nbaPlayerPropsArtifactSha256(artifact),
}, null, 2)}\n`, "utf8");

function read(file: string): Record<string, any> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
}

function buildSelectiveArtifact(): Record<string, any> {
  const selectedByMarket = structuredClone(active.selectedByMarket);
  const underlyingByMarket = structuredClone(active.underlyingByMarket);
  const candidateMarketMinimumDistance = structuredClone(active.candidateMarketMinimumDistance);
  const distributions = structuredClone(active.distributions);
  const reliabilityModels = structuredClone(active.reliabilityModels);
  const modelBundles = structuredClone(active.modelBundles ?? {});
  const modelBundleByMarket = structuredClone(active.modelBundleByMarket ?? {});
  modelBundles.cross_season = {
    ridgeModel: source.ridgeModel,
    minuteModel: source.minuteModel,
    structuralDirectModels: source.structuralDirectModels,
    structuralLogModels: source.structuralLogModels,
    opportunityModels: source.opportunityModels,
    robustMinuteModel: source.robustMinuteModel,
    robustModels: source.robustModels,
  };
  for (const market of selectedMarkets) {
    if (!(market in selectedByMarket)) throw new Error(`Unknown market ${market}.`);
    selectedByMarket[market] = source.selectedByMarket[market];
    underlyingByMarket[market] = source.underlyingByMarket[market];
    candidateMarketMinimumDistance[market] = source.candidateMarketMinimumDistance[market];
    if (!retainActiveCalibration) {
      distributions[market] = source.distributions[market];
      reliabilityModels[market] = source.reliabilityModels[market];
    }
    modelBundleByMarket[market] = "cross_season";
  }
  const { payloadSha256: _activeChecksum, ...activeWithoutChecksum } = active;
  void _activeChecksum;
  return {
    ...activeWithoutChecksum,
    release: `nba_player_props_research_selective_candidate_${Date.now()}`,
    sourceTournamentRelease: source.sourceTournamentRelease,
    selectedByMarket,
    underlyingByMarket,
    candidateMarketMinimumDistance,
    distributions,
    reliabilityModels,
    modelBundles,
    modelBundleByMarket,
  };
}

function required(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function optional(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
