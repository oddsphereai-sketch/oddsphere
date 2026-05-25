/**
 * IParkFactorProvider — contract for ballpark park factors.
 *
 * Real implementation: FanGraphsProvider (scrapes public HTML page).
 * Mock implementation: MockParkFactorProvider (reads from JSON fixtures).
 *
 * Park factors are 3-year rolling values where 100 = league neutral. Values
 * >100 favor the stat in question; <100 suppress it (e.g., Coors park_factor_runs
 * ~115, Tropicana ~96). Updated quarterly via the weekly-park-factors cron.
 *
 * RECORD SHAPES: see IPlayerStatsProvider header for the conventions. Records use
 * team abbreviation (NOT our DB id) — service resolves to team_id and then
 * to ballpark_id during upsert.
 */

/**
 * One ballpark's park-factor row.
 *
 * Note that FanGraphs and other providers may expose more granular factors
 * (LHB vs RHB, situational, etc.). We capture the subset we model against:
 * runs, HR, hits, K, and handedness for HR.
 */
export type ParkFactorRecord = {
  /** Home team abbreviation — service resolves to team_id → ballpark_id. */
  team_abbreviation: string;
  /** Year the 3-year window ends (e.g., 2026 = factors over 2024–2026). */
  season: number;
  park_factor_runs: number;
  park_factor_hr: number;
  park_factor_hits: number;
  park_factor_so: number | null;
  park_factor_handedness_lhh: number | null;
  park_factor_handedness_rhh: number | null;
};

// ─────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────

export interface IParkFactorProvider {
  /**
   * Fetch the latest 3-year rolling park factors for all MLB ballparks.
   *
   * @param season Optional — year the 3-yr window ends. Defaults to the
   *               current season when omitted. Useful for pinning to a
   *               specific window when backtesting.
   */
  getParkFactors(season?: number): Promise<ParkFactorRecord[]>;
}
