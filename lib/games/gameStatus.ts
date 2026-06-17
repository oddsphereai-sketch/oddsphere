/**
 * Pure game-lifecycle status helpers. No I/O, no server deps — safe to import
 * from routes and from plain test scripts.
 */

/**
 * True when a game has already FINISHED (vendor status normalized across
 * sports). Used to drop completed games from the Daily Edge — they belong in
 * Tracking, not "tonight's edges." Deliberately does NOT match in-progress,
 * suspended, postponed, or scheduled states (a suspended MLB game that resumes
 * is still actionable and must stay on the card until it actually goes final).
 * Matches: STATUS_FINAL / final / completed / closed / full-time / "ft".
 */
export function isFinishedGame(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  if (s.length === 0) return false;
  if (s === "ft") return true;
  return (
    s.includes("final") ||
    s.includes("complete") ||
    s.includes("closed") ||
    s.includes("full_time") ||
    s.includes("full-time") ||
    s.includes("fulltime")
  );
}
