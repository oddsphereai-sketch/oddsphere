/**
 * Shared date helpers for cron routes.
 *
 * After Phase 5E.1, "today's slate" is anchored in the sport's broadcast
 * timezone (ET for North American, London for UCL), NOT in UTC. This is
 * critical: a Saturday 9pm ET MLB slate spans 01:00–04:00 UTC into Sunday,
 * but in members' minds (and Daniel's spreadsheet) it's Saturday's slate.
 *
 *   todaySlateDate(sport)       → YYYY-MM-DD for "today" in the sport's anchor TZ
 *   yesterdaySlateDate(sport)   → previous calendar day in the same anchor TZ
 *   parseDateFromUrl(req, ...)  → ?date=YYYY-MM-DD if present + regex-valid,
 *                                 else today's slate. Used by all cron routes
 *                                 so manual `curl '/api/cron/x?date=...'` can
 *                                 target a specific slate for backfills/tests.
 *
 * For cross-sport crons (post_game_results, weekly_*) callers pass any sport
 * — the date math is identical for all North American sports anyway.
 */

import type { Sport } from "../types/domain/Sport";
import {
  currentSlateDate,
  previousSlateDate,
  isSlateDate,
} from "../dates/slateDate";

/** Today's slate date in the sport's anchor timezone (YYYY-MM-DD). */
export function todaySlateDate(sport: Sport = "mlb"): string {
  return currentSlateDate(sport);
}

/** Yesterday's slate date in the sport's anchor timezone (YYYY-MM-DD). */
export function yesterdaySlateDate(sport: Sport = "mlb"): string {
  return previousSlateDate(sport);
}

/**
 * Parse ?date= from a cron request URL. Defaults to today's slate in the
 * provided sport's timezone. Optional sport param keeps existing call sites
 * (which don't pass sport) working — they fall through to MLB's anchor (ET).
 */
export function parseDateFromUrl(request: Request, sport: Sport = "mlb"): string {
  try {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    if (isSlateDate(dateParam)) return dateParam;
  } catch {
    // URL parsing failed — ignore and fall back
  }
  return todaySlateDate(sport);
}
