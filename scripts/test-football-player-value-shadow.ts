import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const builderPath = path.join(root, "scripts/operator/build_nfl_player_value_features.py");
const tournamentPath = path.join(root, "scripts/operator/tournament_nfl_player_value_residual.py");
const builder = readFileSync(builderPath, "utf8");
const tournament = readFileSync(tournamentPath, "utf8");

assert.match(builder, /nfl_player_value_features_2016_2025_2026_08_20_r3/);
assert.match(builder, /prior offensive\/defensive snap share only/);
assert.match(builder, /Current-week snaps are outcomes of participation and are applied only/);
assert.match(tournament, /nfl_market_residual_player_value_shadow_2026_08_20_r2/);
assert.match(tournament, /nfl_market_reference_core_2026_08_20_r1/);
assert.match(tournament, /actionableGradesAuthorized": False/);
assert.match(tournament, /"promotions": 0/);

function sha256(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

const manifestPath = path.join(root, "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r3.manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.featureRelease, "nfl_player_value_features_2016_2025_2026_08_20_r3");
  assert.equal(manifest.baseFeatureRelease, "nfl_real_pregame_features_2016_2025_2026_08_19_r1");
  assert.equal(manifest.rows, 2639);
  assert.equal(manifest.localOnly, true);
  assert.equal(manifest.preseasonIncluded, false);
  assert.ok(manifest.playerValueColumns.length >= 90);
  for (const season of [2021, 2022, 2023, 2024, 2025]) {
    assert.ok(manifest.coverageBySeason[String(season)].reportCoverage >= 0.99);
    assert.ok(manifest.coverageBySeason[String(season)].meanRoleMatchRateWhenListed >= 0.90);
  }
  assert.equal(sha256(manifest.featureFile), manifest.featureFileSha256);
}

const reportPath = path.join(root, "football-research/reports/nfl_market_residual_player_value_tournament_2026_08_20_r2.json");
if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.tournamentRelease, "nfl_market_residual_player_value_tournament_2026_08_20_r2");
  assert.equal(report.modelRelease, "nfl_market_residual_player_value_shadow_2026_08_20_r2");
  assert.equal(report.featureRelease, "nfl_player_value_features_2016_2025_2026_08_20_r3");
  assert.equal(report.referenceRelease, "nfl_market_reference_core_2026_08_20_r1");
  assert.equal(report.localOnly, true);
  assert.equal(report.productionBehaviorChanged, false);
  assert.equal(report.officialTrackingChanged, false);
  assert.equal(report.actionableGradesAuthorized, false);
  assert.equal(report.preseasonIncluded, false);
  assert.equal(report.margin.historicalGatePassed, false);
  assert.equal(report.total.historicalGatePassed, true);
  assert.ok(report.total.stability.improvedSeasons >= 4);
  assert.equal(report.total.stability.materialLosingSeasons, 0);
  assert.ok(report.total.periods.allEvaluation.maeImprovement > 0);
  assert.ok(report.total.periods.allEvaluation.primaryBrierImprovement > 0);
  assert.ok(report.total.periods.confirmation.maeImprovement > 0);
  assert.ok(report.total.periods.historical2025.maeImprovement > 0);
  assert.equal(report.promotionGate.status, "historical_shadow_candidate");
  assert.equal(report.promotionGate.forwardProofRequired, true);
  assert.equal(report.promotionGate.actionableGradesAuthorized, false);
  assert.deepEqual(report.boardImpact, {
    promotions: 0,
    demotions: 0,
    netActionableChange: 0,
    reason: "shadow research only; no live grade or stake rule changed",
  });
  assert.equal(sha256(report.modelArtifact), report.modelArtifactSha256);
}

console.log("Football player-value shadow: immutable releases, leakage guard, coverage, and historical gate passed");
