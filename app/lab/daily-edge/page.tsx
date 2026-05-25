"use client";

/**
 * /lab/daily-edge — Daily Edge module page (Phase 6.2a).
 *
 * Lifted out of the old LabApp section dispatcher. Owns its own sport URL
 * state via useSportSelection; renders DailyEdgeView (the existing component
 * still drives data fetch via useDailyEdge and the slate-date picker via
 * URL ?date= param).
 */

import { useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Sport } from "../data/mockData";
import DailyEdgeView from "../components/DailyEdgeView";
import { useSportSelection } from "../hooks/useSportSelection";
import { useRefreshStatus } from "../hooks/useRefreshStatus";

export default function DailyEdgePage() {
  const { sport } = useSportSelection();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Prime the refresh-status SWR cache so the navbar pill renders without
  // a fetch round-trip on first paint (same intent as the old LabApp).
  useRefreshStatus({ sport });

  const setSport = useCallback(
    (next: Sport) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set("sport", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return <DailyEdgeView sport={sport} onSportChange={setSport} />;
}
