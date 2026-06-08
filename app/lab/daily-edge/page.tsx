"use client";

/**
 * /lab/daily-edge — Daily Edge product surface.
 *
 * MLB renders via DailyEdgeShell + the existing /api/lab/daily-edge route.
 *
 * NBA renders via NbaSlateInShell — admin/preview-only, fetches the
 * /api/admin/nba-preview endpoint (admin-gated). The NBA tab is clickable
 * inside the MLB SportRail; clicking it swaps ?sport=nba which triggers
 * this page to swap shells. Member-facing exposure stays gated by admin
 * auth at the API layer + the existing middleware bypass scope.
 *
 * v1 research model is NOT active — NBA uses v0 (nbaAutoModelV1) for
 * tonight's preview. See lib/automodel/nba/nbaAutoModelV2.ts for the
 * parked v1 research code.
 */

import { useSportSelection } from "../hooks/useSportSelection";
import { useRefreshStatus } from "../hooks/useRefreshStatus";
import DailyEdgeShell from "../components/daily-edge/DailyEdgeShell";
import NbaSlateInShell from "../components/daily-edge/NbaSlateInShell";

export default function DailyEdgePage() {
  const { sport } = useSportSelection();

  // Prime the refresh-status SWR cache for the navbar pill.
  useRefreshStatus({ sport });

  // NBA branches to its own shell so the MLB DailyEdgeShell stays 100%
  // untouched in the hot path. Both shells render the same SportRail
  // chrome so switching sports feels seamless.
  if (sport === "nba") return <NbaSlateInShell />;

  return <DailyEdgeShell sport={sport} />;
}
