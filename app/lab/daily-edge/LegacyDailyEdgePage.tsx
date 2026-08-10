"use client";

import { useSportSelection } from "../hooks/useSportSelection";
import { useRefreshStatus } from "../hooks/useRefreshStatus";
import DailyEdgeShell from "../components/daily-edge/DailyEdgeShell";

export default function LegacyDailyEdgePage() {
  const { sport } = useSportSelection();

  useRefreshStatus({ sport });

  return <DailyEdgeShell key={sport} sport={sport} />;
}
