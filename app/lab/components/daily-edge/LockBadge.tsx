/**
 * Phase 4.2.B — minimal lock-state badge for Daily Edge cards + reader.
 *
 * Renders a single short label next to the game time:
 *
 *   lockState="open"     → renders NOTHING (compact default for unlocked
 *                          games, which is the majority during the day)
 *   lockState="locking"  → "Locks 5:05 PM CDT"  (uses scheduledLockAt)
 *   lockState="locked"   → "Locked 5:05 PM CDT" (uses lockedAt)
 *
 * Plain text, no chrome. Slot-in next to gameTime in any layout.
 *
 * Time formatting follows the member's browser timezone and includes the
 * timezone abbreviation. Stored lock timestamps remain canonical UTC.
 */

import type { LockState } from "@/app/lab/lib/labTypes";
import { formatZonedDateTime, useUserTimeZone } from "@/app/lab/components/UserTimeZone";

type LockBadgeProps = {
  lockState: LockState;
  lockedAt: string | null;
  scheduledLockAt: string;
  /**
   * When true AND the badge would otherwise render content, prepend a
   * "·" separator span. Use in layouts where the badge sits in a row
   * after sibling text (e.g. the reader detail row "BOS @ NYY · 7:05 PM
   * · Locked 6:05 PM"). Default false for compact card-level usage.
   */
  withSeparator?: boolean;
  className?: string;
};

export function LockBadge({
  lockState,
  lockedAt,
  scheduledLockAt,
  withSeparator,
  className,
}: LockBadgeProps) {
  const userTimeZone = useUserTimeZone();
  if (lockState === "open") return null;

  const label = lockState === "locked" ? "Locked" : "Locks";
  // For "locked" prefer the actual locked_at timestamp (real lock moment);
  // fall back to scheduledLockAt if locked_at is null (defensive — once
  // state is "locked" via the classifier mapping for already_started
  // games, lockedAt may be null, in which case the scheduled fire time
  // is the next best display value).
  const timeIso = lockState === "locked" && lockedAt !== null
    ? lockedAt
    : scheduledLockAt;
  const formatted = formatZonedDateTime(timeIso, userTimeZone);
  if (formatted === null) return null;

  return (
    <>
      {withSeparator ? <span className="text-gray-700 ml-1">·</span> : null}
      <span
        className={
          "text-[11px] text-gray-500 tabular-nums" +
          (className !== undefined ? " " + className : "")
        }
      >
        {label} {formatted}
      </span>
    </>
  );
}
