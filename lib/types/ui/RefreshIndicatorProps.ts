/**
 * UI status states for the refresh indicator.
 *   - live:         🟢 fresh, all data current
 *   - pending:      🟡 lineup confirmation pending (typical pre-game state)
 *   - sharp_action: 🟠 sharp signal moved recently
 *   - stale:        🔴 data hasn't refreshed in expected window
 *   - error:        🔴 last refresh failed
 */
export type RefreshStatus =
  | "live"
  | "pending"
  | "sharp_action"
  | "stale"
  | "error";

/**
 * Props for the RefreshIndicator component.
 *
 * Renders "🟢 Live · Updated 2 minutes ago · Next refresh in 13 min" style
 * status, reading from the `data_refresh_log` table via the
 * `useRefreshStatus` hook.
 */
export type RefreshIndicatorProps = {
  /** Data source identifier — e.g., 'balldontlie_props', 'sharpapi_lines'. */
  dataSource: string;
  /** ISO timestamp of the most recent successful refresh. */
  lastRefreshAt: string | null;
  /** ISO timestamp of the next scheduled refresh, if known. */
  scheduledNextRefresh: string | null;
  status: RefreshStatus;
  /** Optional error detail when `status === 'error'`. */
  errorMessage?: string | null;
};
