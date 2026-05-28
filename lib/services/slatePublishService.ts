/**
 * slatePublishService — manage the games.slate_status lifecycle (V2.1 Part 9).
 *
 * Lifecycle:
 *   draft     → admin loaded, not visible to members (V8 default)
 *   published → live on Daily Edge / Player Props
 *   final     → all games settled; kept for tracking, hidden from live views
 *   hidden    → retracted (escape hatch)
 *
 * Transitions (idempotent on current state — re-running publish on a
 * published slate is a no-op):
 *   draft     → published  via publishSlate
 *   published → final      via finalizeSlate  (only when ALL games STATUS_FINAL)
 *   any       → hidden     via hideSlate
 *   hidden    → published  via publishSlate   (manual revival path)
 *
 * AUDIT — every transition writes one row to admin_audit_log (V12 table).
 * action_type uses the slate.* namespace: slate.publish / slate.finalize /
 * slate.hide / slate.promote_historical. target_id is NULL because slate
 * actions are slate-level, not pinned to one game row. before/after_state
 * carries {sport, date, slate_status, gameCount} so the audit row alone
 * tells the full story without rejoining games at read time.
 *
 * MEMBER FILTER NOTE — V2.1 says member queries should filter to
 * slate_status IN ('published', 'final'). This service does NOT touch
 * those read paths in 6.3d; UI filter wiring lands in 6.4/6.5 when the
 * Daily Edge / Player Props pages get restructured. Daniel runs
 * promoteHistoricalDrafts once after 6.3d deploys so the seed slate
 * (V8-backfilled to 'draft') becomes 'published' before any member
 * filter goes live.
 */

import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";
import type { SlateStatus } from "../types/domain/Grade";

// ─── Audit helper ─────────────────────────────────────────────────────────

/**
 * Fix 6.1 (Gap-23.5 / Flag D1): the audit row's `source_type` now matches
 * the data-provenance tier of the action being recorded. Defaults to
 * `'manual'` because slate transitions (publish / finalize / hide /
 * promote_historical) are driven by admin operators; Phase 8 automation
 * may pass `'real_api'` when an automated provider triggers a transition.
 * Pre-Fix-6.1 the column was hardcoded `'mock'`, which made the audit
 * trail misleading post-launch — every admin action looked like seed.
 */
type AuditPayload = {
  action_type: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  /** Optional override; defaults to 'manual' (admin action). */
  source_type?: "mock" | "manual" | "real_api";
};

async function writeAudit(payload: AuditPayload): Promise<void> {
  const { error } = await supabase.from("admin_audit_log").insert({
    action_type: payload.action_type,
    target_table: "games",
    target_id: null,
    before_state: payload.before_state,
    after_state: payload.after_state,
    source_type: payload.source_type ?? "manual",
    // admin_user_id: NULL until Phase 7 auth wires real admin claims
  });
  if (error) {
    throw new Error(
      `slatePublishService.writeAudit failed (action=${payload.action_type}): ${error.message}`
    );
  }
}

// ─── Slate snapshot for audit / status reads ──────────────────────────────

type GameRow = {
  id: number;
  status: string;
  slate_status: SlateStatus;
};

async function loadSlateGames(
  sport: Sport,
  date: string
): Promise<GameRow[]> {
  const { data, error } = await supabase
    .from("games")
    .select("id, status, slate_status")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (error) {
    throw new Error(
      `slatePublishService.loadSlateGames failed: ${error.message}`
    );
  }
  return (data ?? []) as GameRow[];
}

function snapshotStatus(rows: GameRow[]): SlateStatus | "mixed" | "empty" {
  if (rows.length === 0) return "empty";
  const seen = new Set(rows.map((r) => r.slate_status));
  if (seen.size === 1) return rows[0].slate_status;
  return "mixed";
}

// ─── Public read helpers ──────────────────────────────────────────────────

/**
 * Returns the slate's collective status. If every game shares one
 * slate_status the function returns that value verbatim; if rows split
 * across multiple statuses returns "mixed"; empty slate returns "empty".
 */
export async function getPublishStatus(
  sport: Sport,
  date: string
): Promise<SlateStatus | "mixed" | "empty"> {
  const rows = await loadSlateGames(sport, date);
  return snapshotStatus(rows);
}

/**
 * List the most recent published slates for a sport. Useful for an admin
 * dashboard "what's live" widget. Distinct by slate_date with game counts.
 */
export async function listPublishedSlates(
  sport: Sport,
  options: { limit?: number } = {}
): Promise<Array<{ slate_date: string; gameCount: number }>> {
  const limit = options.limit ?? 30;
  const { data, error } = await supabase
    .from("games")
    .select("slate_date")
    .eq("sport", sport)
    .eq("slate_status", "published")
    .order("slate_date", { ascending: false });
  if (error) {
    throw new Error(
      `slatePublishService.listPublishedSlates failed: ${error.message}`
    );
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ slate_date: string }>) {
    counts.set(row.slate_date, (counts.get(row.slate_date) ?? 0) + 1);
  }
  const result = Array.from(counts.entries())
    .map(([slate_date, gameCount]) => ({ slate_date, gameCount }))
    .sort((a, b) => (a.slate_date > b.slate_date ? -1 : 1));
  return result.slice(0, limit);
}

// ─── Transitions ──────────────────────────────────────────────────────────

/**
 * Transition a slate to `published`. Idempotent — promoting an already-
 * published slate returns { promoted: 0 } with no audit write. Promotes
 * BOTH draft and hidden rows (hidden→published is the manual revival
 * path), which means the audit row's before_state may show mixed statuses.
 */
export async function publishSlate(
  sport: Sport,
  date: string
): Promise<{ promoted: number }> {
  const before = await loadSlateGames(sport, date);
  if (before.length === 0) return { promoted: 0 };

  const ids = before
    .filter((r) => r.slate_status !== "published" && r.slate_status !== "final")
    .map((r) => r.id);
  if (ids.length === 0) return { promoted: 0 };

  const { error } = await supabase
    .from("games")
    .update({ slate_status: "published" })
    .in("id", ids);
  if (error) {
    throw new Error(`slatePublishService.publishSlate failed: ${error.message}`);
  }

  const after = await loadSlateGames(sport, date);
  await writeAudit({
    action_type: "slate.publish",
    before_state: { sport, date, status: snapshotStatus(before), gameCount: before.length },
    after_state: { sport, date, status: snapshotStatus(after), gameCount: after.length, promoted: ids.length },
  });
  return { promoted: ids.length };
}

/**
 * Transition a slate to `final` — but ONLY when every game in the slate has
 * games.status === 'STATUS_FINAL'. If any game is still pending, returns
 * { finalized: 0 } with no audit write (avoids burying a partially-settled
 * slate). Idempotent.
 */
export async function finalizeSlate(
  sport: Sport,
  date: string
): Promise<{ finalized: number }> {
  const before = await loadSlateGames(sport, date);
  if (before.length === 0) return { finalized: 0 };
  const allFinal = before.every((r) => r.status === "STATUS_FINAL");
  if (!allFinal) return { finalized: 0 };

  const ids = before.filter((r) => r.slate_status !== "final").map((r) => r.id);
  if (ids.length === 0) return { finalized: 0 };

  const { error } = await supabase
    .from("games")
    .update({ slate_status: "final" })
    .in("id", ids);
  if (error) {
    throw new Error(
      `slatePublishService.finalizeSlate failed: ${error.message}`
    );
  }

  const after = await loadSlateGames(sport, date);
  await writeAudit({
    action_type: "slate.finalize",
    before_state: { sport, date, status: snapshotStatus(before), gameCount: before.length },
    after_state: { sport, date, status: snapshotStatus(after), gameCount: after.length, finalized: ids.length },
  });
  return { finalized: ids.length };
}

/**
 * Retract a slate. Works from any state. Optional `reason` string is
 * stored on the audit row for post-mortem context.
 */
export async function hideSlate(
  sport: Sport,
  date: string,
  reason?: string
): Promise<{ hidden: number }> {
  const before = await loadSlateGames(sport, date);
  if (before.length === 0) return { hidden: 0 };

  const ids = before.filter((r) => r.slate_status !== "hidden").map((r) => r.id);
  if (ids.length === 0) return { hidden: 0 };

  const { error } = await supabase
    .from("games")
    .update({ slate_status: "hidden" })
    .in("id", ids);
  if (error) {
    throw new Error(`slatePublishService.hideSlate failed: ${error.message}`);
  }

  const after = await loadSlateGames(sport, date);
  await writeAudit({
    action_type: "slate.hide",
    before_state: { sport, date, status: snapshotStatus(before), gameCount: before.length },
    after_state: {
      sport,
      date,
      status: snapshotStatus(after),
      gameCount: after.length,
      hidden: ids.length,
      reason: reason ?? null,
    },
  });
  return { hidden: ids.length };
}

/**
 * Bulk-promote draft slates older than `beforeDate` to published. Designed
 * to be run ONCE after V8's backfill so the seed slate (and any historical
 * data already in the DB) doesn't get black-holed when member-facing
 * filters land in 6.4/6.5. Idempotent — re-running finds zero remaining
 * drafts and exits cleanly.
 *
 * @param beforeDate YYYY-MM-DD inclusive cutoff. Drafts with slate_date <
 *                   beforeDate are promoted; drafts at or after stay.
 * @param sport      Optional sport filter. When omitted, promotes drafts
 *                   across every sport — the typical post-deploy use case.
 *                   When provided, scopes the bulk promotion to one sport,
 *                   useful for admin per-sport ops and for test isolation.
 */
export async function promoteHistoricalDrafts(
  beforeDate: string,
  sport?: Sport
): Promise<{ promoted: number }> {
  let query = supabase
    .from("games")
    .select("id, sport, slate_date")
    .eq("slate_status", "draft")
    .lt("slate_date", beforeDate);
  if (sport !== undefined) {
    query = query.eq("sport", sport);
  }
  const { data, error: readErr } = await query;
  if (readErr) {
    throw new Error(
      `slatePublishService.promoteHistoricalDrafts read failed: ${readErr.message}`
    );
  }
  const rows = (data ?? []) as Array<{
    id: number;
    sport: string;
    slate_date: string;
  }>;
  if (rows.length === 0) return { promoted: 0 };

  const ids = rows.map((r) => r.id);
  const { error: updErr } = await supabase
    .from("games")
    .update({ slate_status: "published" })
    .in("id", ids);
  if (updErr) {
    throw new Error(
      `slatePublishService.promoteHistoricalDrafts update failed: ${updErr.message}`
    );
  }

  // Audit per distinct (sport, slate_date) so the log row count matches the
  // count of slates promoted, not the raw row count.
  const slates = new Set<string>();
  for (const r of rows) slates.add(`${r.sport}::${r.slate_date}`);
  await writeAudit({
    action_type: "slate.promote_historical",
    before_state: {
      beforeDate,
      sport: sport ?? null,
      draftCount: rows.length,
      slateCount: slates.size,
    },
    after_state: {
      beforeDate,
      sport: sport ?? null,
      promotedCount: ids.length,
      slates: Array.from(slates).map((s) => {
        const [sportName, date] = s.split("::");
        return { sport: sportName, date };
      }),
    },
  });
  return { promoted: ids.length };
}
