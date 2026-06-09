/**
 * Phase 7B v0c — ET slate-date helpers for NBA admin preview.
 *
 * NBA games tip in the evening ET. A game scheduled for "tonight" in ET
 * (e.g. 8:30 PM ET on 2026-06-08) has a UTC `game_date` of 2026-06-09
 * (00:30 UTC). Querying by UTC date "2026-06-08" misses tonight's game.
 *
 * This helper translates an ET-interpreted YYYY-MM-DD into a UTC window
 * that covers the full ET day. For ET = UTC-4 (summer DST) or UTC-5
 * (standard), the boundary is computed using Intl.DateTimeFormat so we
 * don't hard-code an offset.
 *
 * Internal/admin-only. Production cron paths are unaffected (they don't
 * query NBA).
 */

const ET_TIMEZONE = "America/New_York";

/**
 * Get the UTC offset (in minutes, positive for west-of-UTC) for the
 * given UTC instant when expressed in ET. For 2026 summer this is 240
 * (UTC-4); winter is 300 (UTC-5).
 */
function etOffsetMinutesAtUtc(utc: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    timeZoneName: "longOffset",
  });
  const parts = fmt.formatToParts(utc);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-04:00";
  // tzPart looks like "GMT-04:00" or "GMT-05:00"
  const match = tzPart.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (match === null) return 240;
  const sign = match[1] === "+" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}

/**
 * Given an ET-interpreted date YYYY-MM-DD, return the UTC window that
 * covers the full ET day (midnight ET → next midnight ET).
 *
 * E.g. etSlateDateToUtcWindow("2026-06-08") returns approximately:
 *   { startISO: "2026-06-08T04:00:00.000Z", endISO: "2026-06-09T03:59:59.999Z" }
 * (DST may shift the boundary by 1 hour during transitions.)
 */
export function etSlateDateToUtcWindow(etDate: string): {
  startISO: string;
  endISO: string;
} {
  // Compute the UTC instant of "midnight ET on etDate" by:
  //   - Start with the UTC instant of midnight UTC on etDate
  //   - Find the ET offset at that instant
  //   - Add the offset to get the UTC instant of midnight ET
  const baseUtcMidnight = new Date(`${etDate}T00:00:00.000Z`);
  const offsetMin = etOffsetMinutesAtUtc(baseUtcMidnight);
  const startUtcMs = baseUtcMidnight.getTime() + offsetMin * 60_000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
  return {
    startISO: new Date(startUtcMs).toISOString(),
    endISO: new Date(endUtcMs).toISOString(),
  };
}

/**
 * Format a UTC ISO timestamp as an ET-localized display string.
 * Used by the admin UI to show game tip-off in ET.
 */
export function formatUtcAsEt(utcIso: string | null): string | null {
  if (utcIso === null) return null;
  try {
    const d = new Date(utcIso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("en-US", {
      timeZone: ET_TIMEZONE,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return null;
  }
}
