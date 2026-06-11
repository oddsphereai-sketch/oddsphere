/**
 * Slate-date helpers — the canonical "what slate does a game belong to?" math.
 *
 * Background
 *   The games.game_date column stores TIMESTAMPTZ in UTC. A North American
 *   sports slate spans midnight UTC: a Saturday-evening MLB game at 9 PM ET
 *   is 01:00Z on the NEXT UTC date. Filtering by UTC date (or by a UTC
 *   window) misclassifies these games.
 *
 *   `slate_date` is the date the game starts in its sport's broadcast anchor
 *   timezone — ET for North American sports, London for UCL. This file is
 *   the single source of truth for that computation in TypeScript; the SQL
 *   migration uses the same semantics for the DB column (see
 *   lib/db/schema-migration-v3.sql).
 *
 * Why TypeScript needs the math at all
 *   1. The seed inserts games and must populate slate_date.
 *   2. The Lab UI defaults the date param to "today's slate" (ET-anchored,
 *      not the browser's local clock).
 *   3. The crons compute "today" / "yesterday" slates server-side.
 *
 * Why not just rely on the DB
 *   Most reads filter by slate_date directly and never need TS math. But
 *   inserts and route defaults need to compute a slate_date from a UTC
 *   timestamp without round-tripping to Postgres.
 */

import type { Sport } from "@/lib/types/domain/Sport";

/** Sport → IANA timezone for slate-date anchoring. */
const SPORT_TIMEZONE: Record<Sport, string> = {
  mlb: "America/New_York",
  nba: "America/New_York",
  nfl: "America/New_York",
  cbb: "America/New_York",
  cfb: "America/New_York",
  nhl: "America/New_York",
  ucl: "Europe/London",
  // WC-1 — soccer slate anchors to America/New_York to match the
  // ET-anchored daily slate model used elsewhere in the product. FIFA
  // WC 2026 is hosted in US/Mexico/Canada, so ET produces a sensible
  // single-day grouping for member-facing reads. If we later launch
  // a non-WC soccer competition with a different audience anchor,
  // this becomes a per-competition decision (not per-sport).
  soccer: "America/New_York",
};

/** Returns the IANA timezone used to anchor a sport's slate date. */
export function slateTimezone(sport: Sport): string {
  return SPORT_TIMEZONE[sport];
}

/**
 * Convert a UTC instant into the local YYYY-MM-DD for the given sport.
 *
 * Uses Intl.DateTimeFormat with the sport's anchor timezone. en-CA gives
 * us YYYY-MM-DD naturally — picked deliberately, not for the locale, but
 * for the format.
 *
 * @param sport — drives the anchor timezone
 * @param input — UTC instant: Date or ISO 8601 string
 * @returns YYYY-MM-DD (local date in the anchor timezone)
 */
export function computeSlateDate(sport: Sport, input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`computeSlateDate: invalid date input: ${String(input)}`);
  }
  const tz = SPORT_TIMEZONE[sport];
  // en-CA → YYYY-MM-DD. Locale picked for format, not for English-vs-French.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    // Intl should always return these; throw loudly if not.
    throw new Error(`computeSlateDate: failed to extract Y/M/D in ${tz}`);
  }
  return `${year}-${month}-${day}`;
}

/**
 * Today's slate date in the sport's anchor timezone.
 * Equivalent to computeSlateDate(sport, new Date()).
 */
export function currentSlateDate(sport: Sport): string {
  return computeSlateDate(sport, new Date());
}

/**
 * Yesterday's slate date — one calendar day earlier in the sport's anchor
 * timezone. Used by tracking-page recap and post-game-results cron semantics.
 */
export function previousSlateDate(sport: Sport, base?: string): string {
  const today = base ?? currentSlateDate(sport);
  return addDaysToSlate(today, -1);
}

/**
 * Add (or subtract) days to a YYYY-MM-DD slate-date string.
 *
 * Slate dates are calendar-day labels in their anchor timezone, NOT UTC
 * timestamps. To advance them we anchor at noon in the timezone (avoids DST
 * surprises near midnight), shift by N days as a wall-clock day, and
 * reformat.
 */
export function addDaysToSlate(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`addDaysToSlate: expected YYYY-MM-DD, got ${date}`);
  }
  // Construct a noon-UTC date and add days as UTC — slate dates are calendar
  // labels, so wall-clock arithmetic at noon avoids DST jumps cleanly.
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Validate that a string is YYYY-MM-DD. */
export function isSlateDate(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
