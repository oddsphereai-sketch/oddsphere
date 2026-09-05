/**
 * Authoritative lock-state stamp for Daily Edge cards + reader.
 *
 * Renders a single short label next to the game time:
 *
 *   lockState="open"     → renders NOTHING (compact default for unlocked
 *                          games, which is the majority during the day)
 *   lockState="locking"  → "LOCKS · 5:05 PM CDT"       (scheduled boundary)
 *   lockState="locked"   → "LOCKED · 5:05 PM CDT"      (actual immutable capture)
 *   lockState="missed"   → "LOCK MISSED · 5:05 PM CDT" (no valid capture)
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

  const label = lockState === "locked" ? "LOCKED" : lockState === "missed" ? "LOCK MISSED" : "LOCKS";
  const timeIso = lockState === "locked" && lockedAt !== null
    ? lockedAt
    : scheduledLockAt;
  const formatted = formatZonedDateTime(timeIso, userTimeZone);
  if (formatted === null) return null;

  return (
    <>
      {withSeparator ? <span className="text-gray-700 ml-1">·</span> : null}
      <span
        title={lockState === "missed" ? "No valid immutable T-60 capture was recorded for this game." : undefined}
        className={
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] tabular-nums " +
          (lockState === "locked"
            ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-300"
            : lockState === "missed"
              ? "border-rose-400/40 bg-rose-400/10 text-rose-300"
              : "border-amber-400/35 bg-amber-400/10 text-amber-300") +
          (className !== undefined ? " " + className : "")
        }
      >
        {label} · {formatted}
      </span>
    </>
  );
}
