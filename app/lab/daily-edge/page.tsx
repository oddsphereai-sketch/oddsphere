"use client";

/**
 * /lab/daily-edge — Daily Edge product surface (single shell, both sports).
 *
 * Both MLB and NBA render through the same DailyEdgeShell. NBA flows
 * through the adapter (lib/services/nba/adaptNbaToDailyEdgeResponse)
 * via /api/lab/daily-edge?sport=nba. The shell carries sport guards so
 * baseball-only renderers (StartersLine, MarketPulse first-inning
 * splits-not-offered branch, etc.) skip for NBA. MLB output is
 * byte-identical to before — verified via diff and MLB regression
 * tests.
 *
 * NBA model active: nbaAutoModelV1 (rule-seeded). NBA pipeline is
 * read-only: no DB writes, no prediction_records, no cron.
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
