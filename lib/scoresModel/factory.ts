/**
 * Scores-model source factory — per-sport routing on USE_AUTO_SCORES_MODEL_<SPORT>.
 *
 * Mirrors the Phase 1 provider factory pattern. Strict env-flag check:
 * ONLY the literal string "true" enables the auto model. A typo'd value
 * (e.g., "1", "TRUE") stays on manual — same defensive posture as the
 * provider factory's tri-state PLAYER_STATS_PROVIDER / ODDS_PROVIDER vars
 * (anything other than the three known modes falls back to mock).
 *
 * Auto sources aren't implemented yet (Phase 10+). Trying to enable one
 * throws a helpful error naming the missing class so future-me knows
 * exactly what's missing.
 *
 * Instances are cached per-sport to avoid re-creating Supabase clients
 * for repeated calls in the same process.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sport } from "../types/domain/Sport";
import type { IScoresModelSource } from "./interfaces/IScoresModelSource";
import { ManualScoresModelSource } from "./manual/ManualScoresModelSource";
import { AutoMlbScoresModelSource } from "./auto/AutoMlbScoresModelSource";

const SPORT_TO_ENV_SUFFIX: Record<Sport, string> = {
  mlb:  "MLB",
  nba:  "NBA",
  nfl:  "NFL",
  nhl:  "NHL",
  ucl:  "UCL",
  cfb:  "NCAAF",
  cbb:  "NCAAB",
  // WC-1 — soccer env suffix added so the sport-keyed lookup compiles.
  // No AutoSoccerScoresModelSource exists yet (WC-4 introduces the
  // BDL-WC backed source); enabling USE_AUTO_SCORES_MODEL_SOCCER while
  // the class is missing will still throw the documented helpful error.
  soccer: "SOCCER",
};

function useAutoFor(sport: Sport): boolean {
  const suffix = SPORT_TO_ENV_SUFFIX[sport];
  const key = `USE_AUTO_SCORES_MODEL_${suffix}`;
  return process.env[key] === "true";
}

function autoSourceClassName(sport: Sport): string {
  return `Auto${sport.toUpperCase()}ScoresModelSource`;
}

const cache = new Map<Sport, IScoresModelSource>();

export function getScoresModelSource(
  sport: Sport,
  client: SupabaseClient
): IScoresModelSource {
  const cached = cache.get(sport);
  if (cached) return cached;

  if (useAutoFor(sport)) {
    if (sport === "mlb") {
      const source = new AutoMlbScoresModelSource(client);
      cache.set(sport, source);
      return source;
    }
    throw new Error(
      `USE_AUTO_SCORES_MODEL_${SPORT_TO_ENV_SUFFIX[sport]}=true but ${autoSourceClassName(sport)} is not yet implemented (planned for Phase 10+). ` +
        `Set the env var to false (or unset) to use ManualScoresModelSource.`
    );
  }

  const source = new ManualScoresModelSource(sport, client);
  cache.set(sport, source);
  return source;
}

/**
 * Test-only escape hatch — clear cached instances between test runs without
 * restarting the process. Production code should never call this.
 */
export function __resetScoresModelSourceCache(): void {
  cache.clear();
}
