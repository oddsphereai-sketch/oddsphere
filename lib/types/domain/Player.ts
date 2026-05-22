import type { Sport } from "./Sport";

/** Handedness for batting and pitching. 'S' (switch) only applies to bats. */
export type BatsHand = "L" | "R" | "S";
export type ThrowsHand = "L" | "R";

/** Mirrors the `players` table. */
export type Player = {
  id: number;
  external_id: number;
  sport: Sport;
  team_id: number | null;
  first_name: string;
  last_name: string;
  full_name: string;
  jersey: string | null;
  position: string | null;
  position_abbr: string | null;
  is_pitcher: boolean;
  active: boolean;
  bats: BatsHand | null;
  throws: ThrowsHand | null;
  birth_place: string | null;
  dob: string | null;
  age: number | null;
  height: string | null;
  weight: string | null;
  debut_year: number | null;
  draft: string | null;
  created_at: string;
  updated_at: string;
};
