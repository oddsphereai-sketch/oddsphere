/**
 * In-season detection — which sports are active on a given UTC date.
 *
 * Hybrid model per Daniel's I-decision:
 *   • Static calendar (this file) is primary source — predictable + offline-safe
 *   • Optional override via games-table check (Phase 7+) — if today's games
 *     exist for a sport not in the calendar, include it anyway
 *
 * V1 returns the static calendar only. Phase 7 can layer a DB-backed
 * override on top without changing call sites.
 */

import type { Sport } from "../types/domain/Sport";

/**
 * Per-UTC-month canonical list of in-season sports.
 *
 * Approximate windows:
 *   MLB — late March → late October
 *   NBA — October → mid-June
 *   NFL — September → early February
 *   NHL — October → mid-June
 *   UCL — September → late May
 *   NCAAF (cfb) — August → mid-January
 *   NCAAB (cbb) — November → April
 */
const SPORTS_IN_SEASON_BY_MONTH: Record<number, readonly Sport[]> = {
  1:  ["nba", "nhl", "cbb", "nfl"],
  2:  ["nba", "nhl", "cbb"],
  3:  ["nba", "nhl", "cbb", "mlb"],
  4:  ["nba", "nhl", "mlb", "ucl"],
  5:  ["nba", "nhl", "mlb", "ucl"],
  6:  ["mlb"],
  7:  ["mlb"],
  8:  ["mlb", "cfb"],
  9:  ["mlb", "cfb", "nfl", "ucl"],
  10: ["mlb", "cfb", "nfl", "nba", "nhl", "ucl"],
  11: ["cfb", "nfl", "nba", "nhl", "cbb", "ucl"],
  12: ["cfb", "nfl", "nba", "nhl", "cbb", "ucl"],
};

/**
 * Returns the list of sports we should iterate today.
 *
 * @param date — defaults to "now" (UTC). Pass a fixed date for backtests.
 */
export function sportsInSeasonToday(date: Date = new Date()): Sport[] {
  const month = date.getUTCMonth() + 1; // 1-12
  return [...(SPORTS_IN_SEASON_BY_MONTH[month] ?? ["mlb"])];
}
