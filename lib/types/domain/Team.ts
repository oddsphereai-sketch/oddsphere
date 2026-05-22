import type { Sport } from "./Sport";

/** Mirrors the `teams` table. */
export type Team = {
  id: number;
  external_id: number;
  sport: Sport;
  slug: string;
  abbreviation: string;
  display_name: string;
  short_display_name: string;
  name: string;
  location: string;
  league: string | null;
  division: string | null;
  logo_url: string | null;
  primary_color: string | null;
  created_at: string;
  updated_at: string;
};
