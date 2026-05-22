/**
 * FanGraphs park factors — scraped from public HTML page.
 * Source: https://www.fangraphs.com/guts.aspx?type=pfh
 *
 * 3-year rolling park factors. 100 = league neutral. Updated quarterly via
 * `weekly-park-factors` cron (Mondays).
 */

export type FanGraphsParkFactorRow = {
  team: string; // team abbreviation, 'NYY' / 'BOS' / etc.
  season: number; // year the 3-yr window ends
  park_factor_runs: number;
  park_factor_hr: number;
  park_factor_hits: number;
  park_factor_so?: number;
  park_factor_handedness_lhh?: number;
  park_factor_handedness_rhh?: number;
};

export type FanGraphsScrapeResult = {
  fetched_at: string; // ISO timestamp
  rows: FanGraphsParkFactorRow[];
};
