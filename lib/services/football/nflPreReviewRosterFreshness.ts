import {reviewSlots} from '../../playerPropsAi/schedule';

export const NFL_PRE_REVIEW_ROSTER_RELEASE =
  'nfl_pre_review_roster_2026_11_26_r1_paired_window_sources' as const;
const PREPARATION_LEAD_MS = 15 * 60_000;
const utcInstant = (value: string | null | undefined) =>
  typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;

/** Existing scheduled forward captures prepare source metadata for the two
 * existing review windows. This never claims/replays a review or changes its
 * clock. A captured roster remains its original timestamp, including failures.
 */
export function needsNflPreReviewRoster(args: {
  start: string;
  now: string;
  capturedAt: string | null | undefined;
}): boolean {
  const start = utcInstant(args.start), now = utcInstant(args.now);
  const lock = start - 3_600_000;
  if (!Number.isFinite(start) || !Number.isFinite(now) || now >= lock) return false;
  let windows: ReturnType<typeof reviewSlots>;
  try {
    windows = reviewSlots({sport: 'nfl', id: 'roster-source-only', start: args.start,
      lock: new Date(lock).toISOString()});
  } catch {
    // A fixture that cannot have the existing day-of pair cannot authorize an
    // extra preparation window. Its ordinary opening/T60 paths remain intact.
    return false;
  }
  const duePreparation = windows.map(slot => Date.parse(slot.dueAt) - PREPARATION_LEAD_MS)
    .filter(at => at <= now);
  if (!duePreparation.length) return false;
  const requiredAt = Math.max(...duePreparation), capturedAt = utcInstant(args.capturedAt);
  return !Number.isFinite(capturedAt) || capturedAt < requiredAt || capturedAt > now;
}
