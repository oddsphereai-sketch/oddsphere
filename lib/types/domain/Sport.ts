/**
 * Sports supported across the Lab.
 * V1 active: MLB, NBA, NHL. Others present in UI as "coming soon".
 *
 * Used as the foundational discriminator for sport-scoped data (teams,
 * players, games, predictions, tracking).
 *
 * 2026-06-11 — WC-1: added "soccer" as the broad umbrella key per the
 * docs/audit/06-auditor-fixer-operator-roadmap.md §K decision. Soccer
 * matches carry a `competition` field on `games` (e.g.,
 * "fifa_world_cup") to distinguish FIFA WC from future UCL / league
 * play. This keeps schema fragmentation low as more competitions
 * launch under the same sport.
 */
export type Sport =
  | "mlb"
  | "nba"
  | "nfl"
  | "cbb"
  | "cfb"
  | "nhl"
  | "ucl"
  | "soccer"
  | "wnba";
