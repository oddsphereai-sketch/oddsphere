export const UCL_LOCK_MANIFEST_MARKETS = [
  "match_result",
  "double_chance",
  "total",
  "btts",
] as const;

export type UclLockManifestRow = {
  sport: string;
  competition?: string | null;
  snapshot_json?: Record<string, unknown> | null;
  game_id: number | null;
  external_id: number | null;
  slate_date: string;
  model_version: string | null;
  calibration_version?: string | null;
  market: string;
  locked_at?: string | null;
};

export function isUclLockManifestRow(row: UclLockManifestRow): boolean {
  return row.sport === "soccer"
    && (row.competition ?? row.snapshot_json?.competition) === "uefa_champions_league";
}

export function uclLockManifestCohortKey(row: UclLockManifestRow): string | null {
  if (!isUclLockManifestRow(row)) return null;
  if (
    row.game_id === null
    || row.external_id === null
    || row.slate_date.length === 0
    || row.model_version === null
    || row.calibration_version == null
  ) return null;
  return [
    row.game_id,
    row.external_id,
    row.slate_date,
    row.model_version,
    row.calibration_version,
  ].join(":");
}

/**
 * UCL's immutable public record is one exact four-market cohort. Sequential
 * database writes can leave a partial cohort after a transient failure, so
 * every settlement and accuracy reader must fail closed until the same game,
 * external event, slate, model, and calibration identity has exactly one
 * locked row for each released market.
 */
export function filterCompleteUclLockManifestCohorts<T extends UclLockManifestRow>(rows: T[]): T[] {
  const rowsByCohort = new Map<string, T[]>();
  for (const row of rows) {
    const key = uclLockManifestCohortKey(row);
    if (key === null || row.locked_at == null) continue;
    const cohort = rowsByCohort.get(key) ?? [];
    cohort.push(row);
    rowsByCohort.set(key, cohort);
  }

  const complete = new Set([...rowsByCohort.entries()]
    .filter(([, cohort]) => (
      cohort.length === UCL_LOCK_MANIFEST_MARKETS.length
      && UCL_LOCK_MANIFEST_MARKETS.every(
        (market) => cohort.filter((row) => row.market === market).length === 1,
      )
    ))
    .map(([key]) => key));

  return rows.filter((row) => {
    if (!isUclLockManifestRow(row)) return true;
    const key = uclLockManifestCohortKey(row);
    return key !== null && complete.has(key);
  });
}
