"use client";

/**
 * /lab/daily-edge — Phase 4.1.11 production UI port.
 *
 * The legacy DailyEdgeView (Hero/Watchlist/Caution card grouping) is
 * superseded by DailyEdgeShell, which renders the v13.1 locked-reader
 * + scrollable Edge Board architecture against the new
 * `games[].markets.{moneyline, total, first_inning}` DTO shape.
 *
 * The old `predictions` block stays in the DTO during 4.1.11 as a
 * backwards-compatibility safety net — see app/lab/lib/labTypes.ts —
 * and the old components remain in the tree until the new UI is
 * visually approved.
 */

import { useSportSelection } from "../hooks/useSportSelection";
import { useRefreshStatus } from "../hooks/useRefreshStatus";
import DailyEdgeShell from "../components/daily-edge/DailyEdgeShell";

export default function DailyEdgePage() {
  const { sport } = useSportSelection();

  // Prime the refresh-status SWR cache so the navbar pill renders without
  // a fetch round-trip on first paint (same intent as the old LabApp).
  useRefreshStatus({ sport });

  return <DailyEdgeShell sport={sport} />;
}
