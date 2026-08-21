import assert from "node:assert/strict";
import {
  NFL_PLAYER_PROPS_HISTORICAL_DATASET_RELEASE,
  NFL_PLAYER_PROPS_HISTORICAL_LABELS,
  NFL_PLAYER_PROPS_HISTORICAL_SCHEMA_RELEASE,
  NFL_PLAYER_PROPS_HISTORICAL_SOURCE_RELEASE,
  NFL_PLAYER_PROPS_HISTORICAL_UNSTAMPED_CONTEXT,
  auditNflPlayerPropsHistoricalManifest,
  type NflPlayerPropsHistoricalManifest,
} from "../lib/services/football/nflPlayerPropsHistoricalContract";

const manifest: NflPlayerPropsHistoricalManifest = {
  schemaRelease: NFL_PLAYER_PROPS_HISTORICAL_SCHEMA_RELEASE,
  datasetRelease: NFL_PLAYER_PROPS_HISTORICAL_DATASET_RELEASE,
  sourceCacheRelease: NFL_PLAYER_PROPS_HISTORICAL_SOURCE_RELEASE,
  sourceManifestSha256: "a".repeat(64),
  generatedAt: "2026-08-20T12:00:00Z",
  localOnly: true,
  modelingReady: false,
  seasonRange: [2016, 2025],
  phase: "regular",
  rows: 100,
  games: 10,
  players: 20,
  featureFile: "ignored.parquet",
  featureFileSha256: "b".repeat(64),
  labelColumns: [...NFL_PLAYER_PROPS_HISTORICAL_LABELS],
  modelFeatureColumns: ["prior_targets_avg3"],
  outcomeOnlyColumns: [...NFL_PLAYER_PROPS_HISTORICAL_LABELS],
  unstampedContextColumns: [...NFL_PLAYER_PROPS_HISTORICAL_UNSTAMPED_CONTEXT],
  leakagePolicy: {},
  coverageBySeason: {},
  healthFindings: [],
};

assert.deepEqual(auditNflPlayerPropsHistoricalManifest(manifest), []);
assert.equal(auditNflPlayerPropsHistoricalManifest({ ...manifest, modelingReady: true }).some((row) => row.code === "unsafe_mode"), true);
assert.equal(auditNflPlayerPropsHistoricalManifest({ ...manifest, modelFeatureColumns: ["passing_yards"] }).some((row) => row.code === "outcome_leak"), true);
assert.equal(auditNflPlayerPropsHistoricalManifest({ ...manifest, unstampedContextColumns: [] }).some((row) => row.code === "unstamped_context_missing"), true);

console.log("NFL player-props historical contract: release and leakage gates passed");
