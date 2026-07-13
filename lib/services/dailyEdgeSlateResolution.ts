/**
 * Phase 4.2.C.1.R-19 Phase 1 (C7) — Daily Edge slate-state resolution.
 *
 * Pre-R-19: the route silently fell back to the most recent visible slate
 * whenever today's requested date had no published games. Users saw
 * yesterday's slate without knowing it WAS yesterday's. The amber
 * "Showing latest available slate" pill labeled the fallback but it ran
 * unconditionally, including for members who simply loaded the page
 * before tonight's slate was ingested.
 *
 * R-19 Phase 1 makes the slate-resolution state machine explicit and
 * fallback opt-in:
 *
 *   • Default behavior (no query opt-in): if today has no visible games,
 *     the route returns games:[] with a slateState explaining WHY —
 *     "today_pending_ingest", "today_draft_only", "today_hidden_only",
 *     or "no_data" when an official schedule probe confirms there are no
 *     supported games to ingest. UI can render honest copy.
 *   • Opt-in fallback (`?allowStale=true`): the route walks history to
 *     the most recent visible slate and returns its games, with
 *     slateState="stale_fallback", effectiveDate=that-past-date,
 *     fallback_used=true, and slate_status of the displayed slate.
 *
 * The state machine itself is a pure helper — the route handler does the
 * DB I/O and hands rows in. All branches are unit-tested in
 * scripts/test-daily-edge-slate-resolution.ts.
 */

/**
 * The visibility-and-freshness state of the slate a caller is being
 * served. Six distinct outcomes:
 *
 *   today_published      — requested date has visible (published/final) games.
 *   today_draft_only     — requested date has games, but only `draft` status.
 *                          UI should render pending-ingest copy (member can't
 *                          see drafts).
 *   today_hidden_only    — requested date has games, but only `hidden` status.
 *                          UI should render pending-ingest copy.
 *   today_pending_ingest — requested date has ZERO game rows of any status,
 *                          and the official schedule probe is unavailable
 *                          or confirms supported games exist.
 *   stale_fallback       — `?allowStale=true` and we returned a past slate.
 *                          UI should label this clearly (existing amber pill
 *                          still applies; effectiveDate != requestedDate).
 *   no_data              — official schedule confirms there are no supported
 *                          games to ingest, or fallback was attempted and
 *                          history has no visible slate at all.
 */
export type SlateState =
  | "today_published"
  | "today_draft_only"
  | "today_hidden_only"
  | "today_pending_ingest"
  | "stale_fallback"
  | "no_data";

/** Slate statuses considered visible to a member-facing request. */
export const VISIBLE_SLATE_STATUSES = new Set<string>(["published", "final"]);

export interface SlateStateInput {
  /** The slate_date the caller requested (either ?date= or today-anchored). */
  requestedDate: string;
  /** Every `games.slate_status` row for (sport, slate_date=requestedDate). */
  rowsForRequestedDate: ReadonlyArray<{ slate_status: string }>;
  /**
   * The most recent visible slate_date in history (status published/final),
   * or null when allowStale=false OR when no such slate exists at all.
   * Pre-filtered by the caller — this helper does not enforce visibility
   * on the fallback row.
   */
  mostRecentVisibleFallback:
    | { slate_date: string; slate_status: string }
    | null;
  /** Whether the caller explicitly opted into stale fallback via ?allowStale=true. */
  allowStale: boolean;
  /**
   * Official schedule count for supported games on the requested date.
   * Null/undefined means "unknown"; fail closed to pending-ingest so an
   * upstream outage never hides a real slate.
   */
  officialSupportedGameCountForRequestedDate?: number | null;
}

export interface SlateStateResult {
  /** The state to surface on the response. */
  slateState: SlateState;
  /**
   * The slate_date the route should query games against. Equals
   * `requestedDate` for every state except `stale_fallback`, where it
   * equals the fallback slate_date.
   */
  effectiveDate: string;
  /**
   * The dominant slate_status of the games being displayed. Null when
   * no games are displayed (pending/no_data) and no requested-date rows
   * exist; otherwise the most-frequent status on the displayed slate.
   */
  slate_status: string | null;
  /**
   * True iff the route should run its heavy games+predictions query.
   * False for pending / no_data states (return empty games[] directly).
   */
  shouldFetchGames: boolean;
}

/**
 * Pure state-machine resolver. Given the probe rows for the requested
 * date and (optionally) the most recent visible fallback, decide which
 * `SlateState` to surface and whether the route should fetch games.
 *
 * Decision order:
 *   1. ANY visible rows on the requested date → today_published.
 *   2. No visible rows but ANY rows → today_draft_only / today_hidden_only.
 *   3. Zero rows on the requested date + official supported count is 0 → no_data.
 *   4. Zero rows on the requested date + official count unknown/nonzero → today_pending_ingest.
 *   5. If allowStale=true AND mostRecentVisibleFallback != null:
 *      upgrade pending state → stale_fallback.
 *   6. Else if allowStale=true AND no fallback exists: no_data.
 */
export function determineSlateState(input: SlateStateInput): SlateStateResult {
  const {
    requestedDate,
    rowsForRequestedDate,
    mostRecentVisibleFallback,
    allowStale,
    officialSupportedGameCountForRequestedDate,
  } = input;

  const counts = new Map<string, number>();
  for (const r of rowsForRequestedDate) {
    counts.set(r.slate_status, (counts.get(r.slate_status) ?? 0) + 1);
  }
  const visibleCount =
    [...counts.entries()].reduce(
      (acc, [k, v]) => (VISIBLE_SLATE_STATUSES.has(k) ? acc + v : acc),
      0
    );

  if (visibleCount > 0) {
    // At least one published/final game exists. Use today.
    return {
      slateState: "today_published",
      effectiveDate: requestedDate,
      slate_status: dominantVisibleStatus(counts) ?? dominantStatus(counts),
      shouldFetchGames: true,
    };
  }

  // No visible games on requested date. Classify the empty state.
  let pendingState: SlateState;
  let pendingStatus: string | null;
  if (rowsForRequestedDate.length === 0) {
    pendingState =
      officialSupportedGameCountForRequestedDate === 0
        ? "no_data"
        : "today_pending_ingest";
    pendingStatus = null;
  } else {
    const hasDraft = counts.has("draft");
    const hasHidden = counts.has("hidden");
    if (hasHidden && !hasDraft) {
      pendingState = "today_hidden_only";
      pendingStatus = "hidden";
    } else if (hasDraft && !hasHidden) {
      pendingState = "today_draft_only";
      pendingStatus = "draft";
    } else {
      // Mixed draft + hidden, or unrecognized statuses. Prefer
      // "draft_only" copy since draft is the more actionable state
      // (someone needs to publish) — hidden is a deliberate retract.
      pendingState = "today_draft_only";
      pendingStatus = dominantStatus(counts);
    }
  }

  // Should we fall back?
  if (!allowStale) {
    return {
      slateState: pendingState,
      effectiveDate: requestedDate,
      slate_status: pendingStatus,
      shouldFetchGames: false,
    };
  }

  // allowStale=true. Use the fallback if one exists.
  if (mostRecentVisibleFallback === null) {
    return {
      slateState: "no_data",
      effectiveDate: requestedDate,
      slate_status: pendingStatus,
      shouldFetchGames: false,
    };
  }

  return {
    slateState: "stale_fallback",
    effectiveDate: mostRecentVisibleFallback.slate_date,
    slate_status: mostRecentVisibleFallback.slate_status,
    shouldFetchGames: true,
  };
}

function dominantStatus(counts: Map<string, number>): string | null {
  let best: [string, number] | null = null;
  for (const [k, v] of counts) {
    if (best === null || v > best[1]) best = [k, v];
  }
  return best?.[0] ?? null;
}

function dominantVisibleStatus(counts: Map<string, number>): string | null {
  let best: [string, number] | null = null;
  for (const [k, v] of counts) {
    if (!VISIBLE_SLATE_STATUSES.has(k)) continue;
    if (best === null || v > best[1]) best = [k, v];
  }
  return best?.[0] ?? null;
}
