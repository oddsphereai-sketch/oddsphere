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
  //
  // key={sport} (P0 tab-switching fix, 2026-06-12): force a clean remount
  // on every sport switch. Without it the shell stayed mounted across
  // switches and could get stuck on the previous sport's SWR data / an
  // endless LoadingState (the recurring "tab switching stuck on prod"
  // signature). Remounting resets selected game/market state and guarantees
  // the new sport's fetch drives a fresh loading→render cycle.
  return <DailyEdgeShell key={sport} sport={sport} />;
}
