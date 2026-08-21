import contract from "./nflPlayerPropsHistoricalContract.json";

export const NFL_PLAYER_PROPS_HISTORICAL_SCHEMA_RELEASE = contract.schemaRelease;
export const NFL_PLAYER_PROPS_HISTORICAL_DATASET_RELEASE = contract.datasetRelease;
export const NFL_PLAYER_PROPS_HISTORICAL_SOURCE_RELEASE = contract.sourceCacheRelease;
export const NFL_PLAYER_PROPS_HISTORICAL_LABELS = contract.phaseOneLabels;
export const NFL_PLAYER_PROPS_HISTORICAL_OPPORTUNITY_LABELS = contract.opportunityLabels;
export const NFL_PLAYER_PROPS_HISTORICAL_UNSTAMPED_CONTEXT = contract.unstampedContextColumns;

export type NflPlayerPropsHistoricalManifest = {
  schemaRelease: string;
  datasetRelease: string;
  sourceCacheRelease: string;
  sourceManifestSha256: string;
  generatedAt: string;
  localOnly: boolean;
  modelingReady: boolean;
  seasonRange: [number, number];
  phase: string;
  rows: number;
  games: number;
  players: number;
  featureFile: string;
  featureFileSha256: string;
  labelColumns: string[];
  modelFeatureColumns: string[];
  outcomeOnlyColumns: string[];
  unstampedContextColumns: string[];
  leakagePolicy: Record<string, string>;
  coverageBySeason: Record<string, unknown>;
  healthFindings: string[];
};

export type NflPlayerPropsHistoricalManifestFinding = {
  severity: "blocking" | "warning";
  code: string;
  detail: string;
};

/** Fail closed if a generated local dataset drifts from the shared contract. */
export function auditNflPlayerPropsHistoricalManifest(
  manifest: NflPlayerPropsHistoricalManifest,
): NflPlayerPropsHistoricalManifestFinding[] {
  const findings: NflPlayerPropsHistoricalManifestFinding[] = [];
  const block = (code: string, detail: string) => findings.push({ severity: "blocking" as const, code, detail });
  if (manifest.schemaRelease !== contract.schemaRelease) block("schema_release_mismatch", "Historical schema release does not match the shared contract.");
  if (manifest.datasetRelease !== contract.datasetRelease) block("dataset_release_mismatch", "Historical dataset release does not match the shared contract.");
  if (manifest.sourceCacheRelease !== contract.sourceCacheRelease) block("source_release_mismatch", "Historical source release does not match the checksum-pinned cache contract.");
  if (manifest.localOnly !== true || manifest.modelingReady !== false) block("unsafe_mode", "The foundation must remain local-only and not modeling-ready.");
  if (manifest.phase !== contract.phase) block("phase_mismatch", "Only regular-season rows are valid in this release.");
  if (manifest.seasonRange[0] < contract.minimumSeason || manifest.seasonRange[1] > contract.maximumSeason) block("season_range_mismatch", "Historical season range exceeds the completed-season contract.");
  if (!Number.isInteger(manifest.rows) || manifest.rows <= 0 || !Number.isInteger(manifest.games) || manifest.games <= 0) block("empty_dataset", "Historical dataset must contain rows and games.");
  if (!/^[a-f0-9]{64}$/.test(manifest.featureFileSha256)) block("invalid_checksum", "Historical feature checksum must be SHA-256.");
  for (const label of contract.phaseOneLabels) {
    if (!manifest.labelColumns.includes(label)) block("missing_label", `Historical dataset is missing ${label}.`);
    if (manifest.modelFeatureColumns.includes(label)) block("outcome_leak", `${label} cannot be a model feature.`);
  }
  for (const column of contract.unstampedContextColumns) {
    if (!manifest.unstampedContextColumns.includes(column)) block("unstamped_context_missing", `${column} must remain explicitly unstamped.`);
    if (manifest.modelFeatureColumns.includes(column)) block("unstamped_context_promoted", `${column} cannot be a model feature in this release.`);
  }
  return findings;
}
