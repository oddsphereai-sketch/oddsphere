/**
 * Shared date helpers for cron routes.
 *
 *   todaySlateDate()         → UTC date string (YYYY-MM-DD). The slate-date
 *                              convention inside providers handles late-night
 *                              UTC games (Pacific evening starts).
 *   parseDateFromUrl(req)    → ?date=YYYY-MM-DD if present + regex-valid,
 *                              else today. Used by all cron routes so manual
 *                              `curl '/api/cron/x?date=...'` can target a
 *                              specific slate for backfills/tests.
 */

export function todaySlateDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function parseDateFromUrl(request: Request): string {
  try {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return dateParam;
  } catch {
    // URL parsing failed — ignore and fall back
  }
  return todaySlateDate();
}
