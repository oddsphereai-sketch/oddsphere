export const NFL_DAILY_EDGE_ENABLED_FLAG = "NFL_DAILY_EDGE_ENABLED" as const;
export const NFL_DAILY_EDGE_PUBLICATION_ENABLED_FLAG =
  "NFL_DAILY_EDGE_PUBLICATION_ENABLED" as const;
export const NFL_WEEK_ONE_EVIDENCE_BOARD_ENABLED_FLAG =
  "NFL_WEEK_ONE_EVIDENCE_BOARD_ENABLED" as const;

export const NFL_DAILY_EDGE_PUBLICATION_RELEASE =
  "nfl_daily_edge_regular_week_one_publication_2026_08_25_r2_actionable_grades" as const;

/**
 * Local development keeps the checksum-backed rehearsal board available.
 * Production and preview deployments must opt in explicitly.
 */
export function isNflDailyEdgeEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env[NFL_DAILY_EDGE_ENABLED_FLAG] === "true";
}

/** Production snapshot writes require a second, independent server-only gate. */
export function isNflDailyEdgePublicationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[NFL_DAILY_EDGE_PUBLICATION_ENABLED_FLAG] === "true";
}

/**
 * Independent display gate for the authoritative Regular Season Week 1 board.
 * Model and grade publication still requires a coherent leased-writer tuple;
 * official tracking separately requires an on-time frozen T-60 tuple.
 */
export function isNflWeekOneEvidenceBoardEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[NFL_WEEK_ONE_EVIDENCE_BOARD_ENABLED_FLAG] === "true";
}
