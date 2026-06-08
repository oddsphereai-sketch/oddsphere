"use client";

/**
 * /lab/daily-edge — Daily Edge product surface (single shell, both sports).
 *
 * Phase 7F (Path A): NBA renders through the SAME DailyEdgeShell as
 * MLB via the NBA-as-DailyEdge adapter (lib/services/nba/
 * adaptNbaToDailyEdgeResponse + /api/admin/nba-as-daily-edge). The
 * shell carries sport guards so baseball-only renderers (StartersLine,
 * MarketPulse first-inning splits-not-offered branch, etc.) skip for
 * NBA. MLB output is byte-identical to before — verified via diff and
 * MLB regression tests.
 *
 * v0 active (nbaAutoModelV1). v1 stays parked as research only.
 *
 * NBA preview is admin-gated at /api/admin/nba-as-daily-edge with the
 * nba-v0a Vercel preview-branch bypass for review. NOT member-facing.
 */

import { useSportSelection } from "../hooks/useSportSelection";
import { useRefreshStatus } from "../hooks/useRefreshStatus";
import DailyEdgeShell from "../components/daily-edge/DailyEdgeShell";

export default function DailyEdgePage() {
  const { sport } = useSportSelection();

  // Prime the refresh-status SWR cache for the navbar pill.
  useRefreshStatus({ sport });

  // Both sports render through the same shell.
  return <DailyEdgeShell sport={sport} />;
}
