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
  // mlb / nba / nhl / soccer already track via their existing launch handling.
  // wnba: "2026-06-24",  // ← UNCOMMENT AT WNBA LAUNCH (with SPORT_DISPLAY_ORDER)
};

/**
 * Sports that use the launch-boundary system. ONLY these are gated by
 * isPublicallyTracked — every other sport (MLB/NBA/NHL/soccer) keeps its
 * existing tracking behavior untouched (always returns true below).
 */
const BOUNDARIED_SPORTS = new Set<Sport>(["wnba"]);

/** The official public-tracking start date for a sport, or null if not launched. */
export function officialTrackingStart(sport: Sport): string | null {
  return OFFICIAL_TRACKING_START[sport] ?? null;
}

/**
 * Whether a (sport, slate_date) record may appear in the PUBLIC lifetime tally.
 * Non-boundaried sports → always true (no behavior change). Boundaried sports
 * (WNBA) → only on/after their official start, and never before it's set. So
 * WNBA pre-launch is excluded; at launch (start=launch date) public starts 0-0
 * from that date forward, no backfill.
 */
export function isPublicallyTracked(sport: Sport, slateDate: string): boolean {
  if (!BOUNDARIED_SPORTS.has(sport)) return true;
  const start = officialTrackingStart(sport);
  return start != null && slateDate >= start;
}
