/**
 * Official PUBLIC tracking start per sport (2026-06-23).
 *
 * The public lifetime W/L tally for a sport counts ONLY graded records whose
 * game slate_date is on/after that sport's official start. A sport NOT listed
 * here (or listed with no date) has NO public tracking yet — its records are
 * pre-launch validation/shadow data and MUST be excluded from the member-facing
 * tally. No historical backfill, ever.
 *
 * WNBA: launches 6/24 but stays PENDING (absent below) while gated, so the
 * prediction_records we write pre-launch are internal-only. At the live flip,
 * uncomment `wnba: "2026-06-24"` AND add "wnba" to SPORT_DISPLAY_ORDER in the
 * tracking route — then public WNBA lifetime starts 0-0 from 6/24 forward, for
 * all three markets (ML / O-U / Spread).
 */
import type { Sport } from "@/lib/types/domain/Sport";

export const OFFICIAL_TRACKING_START: Partial<Record<Sport, string>> = {
  // MLB / NBA / soccer continue to use their existing launch handling.
  wnba: "2026-06-24", // WNBA launch — public lifetime starts 0-0 from this date, no backfill
  nfl: "2026-09-09", // NFL Week 1 opener in the ET slate convention; preseason is permanently excluded
  cfb: "2026-08-29", // CFB opening-week launch — forward-only, no historical backfill
  nhl: "2026-09-29", // NHL regular-season launch — excludes Finals and 2026 preseason records
};

/**
 * Sports that use the one-way launch-boundary system. Other sports keep their
 * existing launch handling, but may still have an explicit closed exclusion
 * window below (NBA offseason/preseason).
 */
const BOUNDARIED_SPORTS = new Set<Sport>(["wnba", "nfl", "cfb", "nhl"]);

/**
 * Closed periods that must not enter public tracking even though the sport has
 * valid public history before and after the period. NBA's 2025-26 postseason
 * rows remain part of lifetime tracking; only the 2026 offseason/preseason is
 * excluded before the 2026-27 regular-season opener.
 */
export const PUBLIC_TRACKING_EXCLUSION_WINDOWS: Partial<
  Record<Sport, ReadonlyArray<{ from: string; through: string }>>
> = {
  nba: [{ from: "2026-07-01", through: "2026-10-19" }],
};

/** The official public-tracking start date for a sport, or null if not launched. */
export function officialTrackingStart(sport: Sport): string | null {
  return OFFICIAL_TRACKING_START[sport] ?? null;
}

/**
 * Whether a (sport, slate_date) record may appear in the PUBLIC lifetime tally.
 * A sport/date in an explicit exclusion window is always false. Otherwise,
 * non-boundaried sports are true and launch-boundaried sports are true only
 * on/after their official start. This lets NBA preserve valid prior-season
 * history while excluding the offseason/preseason between seasons.
 */
export function isPublicallyTracked(sport: Sport, slateDate: string): boolean {
  const excluded = PUBLIC_TRACKING_EXCLUSION_WINDOWS[sport]?.some(
    (window) => slateDate >= window.from && slateDate <= window.through,
  ) ?? false;
  if (excluded) return false;
  if (!BOUNDARIED_SPORTS.has(sport)) return true;
  const start = officialTrackingStart(sport);
  return start != null && slateDate >= start;
}
