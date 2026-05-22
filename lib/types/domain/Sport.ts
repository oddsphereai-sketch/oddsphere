/**
 * Sports supported across the Lab.
 * V1 active: MLB. Others present in UI as "coming soon".
 *
 * Used as the foundational discriminator for sport-scoped data (teams,
 * players, games, predictions, tracking).
 */
export type Sport =
  | "mlb"
  | "nba"
  | "nfl"
  | "cbb"
  | "cfb"
  | "nhl"
  | "ucl";
