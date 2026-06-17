/**
 * Trusted-sportsbook priority for selecting ONE price among many books.
 *
 * Lower index = sharper / more trusted. Shared by the cron `lines` selection
 * (pickPriceRow in the daily-edge route) AND the live stream overlay
 * (loadStreamCurrentForSlate) so the displayed line, the current price, and the
 * movement read all anchor to the SAME book ranking — no cross-source
 * incoherence (e.g. a sharp 9.5 line next to an outlier book's current price).
 *
 * A book NOT in this list is untrusted and must never be the customer-facing
 * price — both consumers FAIL CLOSED (return nothing rather than an arbitrary
 * book). fliff + kalshi are intentionally absent (centralized in
 * BLOCKED_SPORTSBOOKS, #39 — kalshi also flips home/away at our provider).
 *
 * `locked_snapshot` (the route injects this for locked games) and
 * `splits_consensus` (synthetic last-resort) are cron-only sources with no rows
 * in the live odds_current_stream — harmless extras there.
 */
export const BOOK_PRIORITY = [
  "locked_snapshot",
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365 us",
  "bookmaker",
  "ballybet",
  "onexbet",
  "saba",
  "splits_consensus",
] as const;

/**
 * Rank of a sportsbook in BOOK_PRIORITY (lower = sharper). Returns
 * Number.POSITIVE_INFINITY for any book not in the list (untrusted), so callers
 * can treat "not found" as "never select."
 */
export function bookPriorityRank(sportsbook: string): number {
  const i = (BOOK_PRIORITY as readonly string[]).indexOf(sportsbook);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}
