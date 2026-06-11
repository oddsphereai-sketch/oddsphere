"use client";

/**
 * useSportSelection — URL-as-truth sport state for the Lab.
 *
 * Reads ?sport= from the current URL, validates against the Sport union, and
 * exposes `{ sport, setSport, propsSport }`. setSport mutates the same query
 * string LabApp manages today (no client-only state, no Context provider —
 * the URL is the single source of truth so deep-links and shares Just Work).
 *
 * `propsSport` mirrors the rule LabApp encodes: the Player Props subtree
 * only renders MLB/NBA/NFL/NHL today. If the active section is "props" and
 * the user has selected a sport outside that subset, propsSport falls back
 * to "mlb" for the props-specific highlight.
 *
 * Phase 5 callers: LabApp (5A refactor), Daily Edge / Player Props / Tracking
 * views (5B–5D) — they all derive their query keys from `sport` here.
 */

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Sport } from "@/lib/types/domain/Sport";

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl", "soccer"];
const PROPS_SPORTS: Sport[] = ["mlb", "nba", "nfl", "nhl"];
const DEFAULT_SPORT: Sport = "mlb";

function isSport(v: string | null): v is Sport {
  return !!v && (VALID_SPORTS as string[]).includes(v);
}

export type UseSportSelectionResult = {
  /** Validated sport from ?sport=, default "mlb". */
  sport: Sport;
  /**
   * Sport to render inside the Player Props subtree. Falls back to "mlb"
   * when section=props and `sport` is not in PROPS_SPORTS.
   */
  propsSport: Sport;
  /** Update ?sport= and preserve all other params. */
  setSport: (next: Sport) => void;
};

export function useSportSelection(): UseSportSelectionResult {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const sportParam = searchParams.get("sport");
  const sport: Sport = isSport(sportParam) ? sportParam : DEFAULT_SPORT;

  const section = searchParams.get("section");
  const propsSport: Sport =
    section === "props" && !PROPS_SPORTS.includes(sport) ? "mlb" : sport;

  const setSport = useCallback(
    (next: Sport) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set("sport", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { sport, propsSport, setSport };
}

export const SPORT_SELECTION_INTERNALS = {
  VALID_SPORTS,
  PROPS_SPORTS,
  DEFAULT_SPORT,
};
