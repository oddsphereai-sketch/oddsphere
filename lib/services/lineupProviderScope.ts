import type { Sport } from "../types/domain/Sport";

/** The legacy provider and persistence schema represent baseball batting orders. */
export function supportsLegacyLineupRefresh(sport: Sport): sport is "mlb" {
  return sport === "mlb";
}

export function assertLegacyLineupSport(sport: Sport): asserts sport is "mlb" {
  if (!supportsLegacyLineupRefresh(sport)) {
    throw new Error(`Legacy batting-order lineup refresh does not support ${sport}; use its sport-owned pipeline.`);
  }
}
