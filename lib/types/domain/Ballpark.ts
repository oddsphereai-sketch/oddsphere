/**
 * Mirrors the `ballparks` table.
 * Park factors are FanGraphs 3-year rolling values where 100 = league neutral
 * (>100 favors the stat, <100 suppresses it).
 */
export type Ballpark = {
  id: number;
  team_id: number | null;
  name: string;
  city: string;
  state: string | null;
  is_dome: boolean;
  is_retractable: boolean;
  latitude: number | null;
  longitude: number | null;
  park_factor_runs: number | null;
  park_factor_hr: number | null;
  park_factor_hits: number | null;
  park_factor_so: number | null;
  park_factor_handedness_lhh: number | null;
  park_factor_handedness_rhh: number | null;
  created_at: string;
  updated_at: string;
};
