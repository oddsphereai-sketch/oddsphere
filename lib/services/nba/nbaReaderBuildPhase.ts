/** Error-only request diagnostics. Never attach source payloads or mutate an
 * error/forecast. Inner source phases take precedence over outer adapters. */
export const NBA_READER_BUILD_PHASES = ["feature_sources", "professional_state", "professional_features", "active_roster", "current_contracts", "prior_knowledge", "consumer_history", "current_lines", "split_evidence", "price_evidence", "forecast", "locked_snapshot", "member_evidence", "rolling_schedule", "adapter"] as const;
export type NbaReaderBuildPhase = typeof NBA_READER_BUILD_PHASES[number];
const phases = new WeakMap<object, NbaReaderBuildPhase>();
export function markNbaReaderBuildFailure(error: unknown, phase: NbaReaderBuildPhase): void {
  if (error !== null && (typeof error === "object" || typeof error === "function") && !phases.has(error)) phases.set(error, phase);
}
export function nbaReaderBuildFailureCode(error: unknown): string | null {
  if (error === null || typeof error !== "object" && typeof error !== "function") return null;
  const phase = phases.get(error); return phase ? `nba_build_phase_${phase}` : null;
}
export function isNbaReaderBuildFailureCode(code: string): boolean {
  return NBA_READER_BUILD_PHASES.some(phase => code === `nba_build_phase_${phase}`);
}
