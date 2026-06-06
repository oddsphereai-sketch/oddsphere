/**
 * Push 2 — Slate-driven SharpAPI event_id candidate generator.
 *
 * Why this exists: SharpAPI's `/opportunities/ev` discovery omits games
 * that don't currently have a flagged +EV opportunity, even when their
 * `/odds` endpoint would return real-book lines on a direct query
 * (proven 2026-06-06 for SF@CHC and TB@MIA). The slate-driven fallback
 * uses this generator to construct the candidate event_ids it would
 * probe to recover those games' markets.
 *
 * SharpAPI's event_id format (verified live):
 *   `mlb_<homeMascot>_<awayMascot>_<YYYY-MM-DD>_b{0|3}`
 *
 * Variance observed:
 *   • Bucket can be either `_b0` or `_b3` — both used in production
 *     events; SharpAPI doesn't expose which a given game lives under
 *     until /odds is queried.
 *   • Team order in the event_id sometimes follows home_away,
 *     sometimes away_home — SharpAPI's convention isn't consistent
 *     across events.
 *   • Three teams have multi-word mascots whose underscore form
 *     (`red_sox`, `white_sox`, `blue_jays`) is the dominant variant
 *     but a concatenated variant (`redsox`, `whitesox`, `bluejays`)
 *     has been observed for some events.
 *
 * Strategy: enumerate every reasonable combination, dedupe, return.
 * Caller iterates through the list and uses the first event_id that
 * returns a non-empty /odds response. Quota impact is bounded — 4
 * candidates for single-mascot games, 8 for one multi-word team, 16
 * for two multi-word teams, hit only when a game is missing from
 * primary discovery (typically 0-3 games per slate).
 *
 * Determinism: same (home, away, date) inputs always produce the same
 * ordered list. Test fixtures rely on this.
 *
 * NEVER call this with a date that isn't already in YYYY-MM-DD form;
 * the function throws to fail fast rather than constructing a malformed
 * event_id that would silently miss every match.
 */

import {
  providerMascotsForAbbrev,
  type MlbTeamAbbrev,
} from "./_teamNameNormalizer";

const BUCKETS = ["_b0", "_b3"] as const;

/**
 * Push 2 — generate candidate SharpAPI MLB event_ids for an expected
 * game on a given slate date.
 *
 * @param home Canonical 3-letter abbreviation of the home team
 * @param away Canonical 3-letter abbreviation of the away team
 * @param date Slate date in YYYY-MM-DD form
 * @returns Deterministic, deduplicated list of candidate event_ids
 *
 * @throws When `date` is not in YYYY-MM-DD form
 */
export function generateMlbEventIdCandidates(
  home: MlbTeamAbbrev,
  away: MlbTeamAbbrev,
  date: string,
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      `generateMlbEventIdCandidates: invalid date "${date}", expected YYYY-MM-DD`,
    );
  }
  const homeMascots = providerMascotsForAbbrev(home);
  const awayMascots = providerMascotsForAbbrev(away);

  // Two team orderings × N × M mascot variants × 2 buckets.
  const orderings: Array<[ReadonlyArray<string>, ReadonlyArray<string>]> = [
    [homeMascots, awayMascots],
    [awayMascots, homeMascots],
  ];

  const out = new Set<string>();
  for (const [first, second] of orderings) {
    for (const f of first) {
      for (const s of second) {
        for (const b of BUCKETS) {
          out.add(`mlb_${f}_${s}_${date}${b}`);
        }
      }
    }
  }
  return Array.from(out);
}

export const __TEST__ = {
  BUCKETS,
};
