#!/usr/bin/env tsx

/** Builds the confirmed NBA props side-accuracy grade rerank without refitting projections. */
import { readFileSync, writeFileSync } from "node:fs";

import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";

const input = required("input");
const output = required("output");
const source = JSON.parse(readFileSync(input, "utf8")) as Record<string, any>;
const gradePolicies = structuredClone(source.gradePolicies);

gradePolicies.points.accuracyRerank = {
  signalFamily: "model_market_average_probability",
  overBonus: -0.05,
  minimumAmericanPrice: -200,
  requireMarketEvidence: true,
};
gradePolicies.assists.accuracyRerank = {
  signalFamily: "final_probability",
  overBonus: -0.025,
  minimumAmericanPrice: -200,
  requireMarketEvidence: true,
};
gradePolicies.points_assists.accuracyRerank = {
  signalFamily: "final_probability",
  overBonus: 0.025,
  minimumAmericanPrice: -200,
  requireMarketEvidence: true,
};

const { payloadSha256: _priorChecksum, ...prior } = source;
void _priorChecksum;
const artifact = {
  ...prior,
  release: "nba_player_props_frozen_runtime_artifact_2026_10_27_r12_side_accuracy_rerank",
  sourceGradeRelease: "nba_player_props_exact_price_grade_2026_10_27_r14_side_accuracy_rerank",
  gradePolicies,
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
