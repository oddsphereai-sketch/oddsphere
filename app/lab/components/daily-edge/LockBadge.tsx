/**
 * Phase 4.2.B — minimal lock-state badge for Daily Edge cards + reader.
 *
 * Renders a single short label next to the game time:
 *
 *   lockState="open"     → renders NOTHING (compact default for unlocked
 *                          games, which is the majority during the day)
 *   lockState="locking"  → "Locks 6:05 PM ET"   (uses scheduledLockAt)
 *   lockState="locked"   → "Locked 6:05 PM ET"  (uses lockedAt)
 *
 * Plain text, no chrome. Slot-in next to gameTime in any layout.
 *
 * Time formatting reuses the existing dateUtils.formatTimeET pattern from
 * the route's DTO build — short, no seconds, no timezone abbreviation
 * appended (the surrounding row already establishes ET context via the
 * adjacent gameTime).
 */

import type { LockState } from "@/app/lab/lib/labTypes";

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

// Format ISO 8601 UTC → "H:MM AM/PM ET" using Intl.DateTimeFormat with
// the America/New_York zone. Mirrors the formatTimeET helper used by the
// rest of the surface so the badge's "6:05 PM" matches the card's
// gameTime field exactly.
function formatET(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).format(new Date(ms));
}

export function LockBadge({
  lockState,
  lockedAt,
  scheduledLockAt,
  withSeparator,
  className,
}: LockBadgeProps) {
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
  const formatted = formatET(timeIso);
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
