"use client";

/**
 * SlateFreshness — V2.1 Part 10 dual-timestamp freshness display.
 *
 * Renders two timestamps in the Daily Edge header:
 *   "Last updated 3m ago · Lines synced 8m ago"
 *
 * Sources both from the existing useRefreshStatus SWR cache so no extra
 * fetch is needed — the LabAppNav RefreshIndicator already primes the
 * cache and this component reads from it.
 *
 *   Last updated → response.overall.last_updated_at (most recent completion
 *                  across the frontline pipeline)
 *   Lines synced → the most recent successful pregame_sweep run from
 *                  response.sources (pregame_sweep is the highest-frequency
 *                  line-touching cron; if absent, fall back to overall).
 *
 * Compact pill, tabular-nums, lives next to the SlateDatePicker.
 */

import { useRefreshStatus } from "../hooks/useRefreshStatus";
import type { Sport } from "@/lib/types/domain/Sport";
import Icon from "./Icon";

type Props = {
  sport: Sport;
};

function formatAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function SlateFreshness({ sport }: Props) {
  const { data, isLoading } = useRefreshStatus({ sport });

  // Both timestamps unavailable in the initial loading state — keep the chip
  // mounted with em-dashes so the header layout doesn't shift when data arrives.
  const overall = data?.overall.last_updated_at ?? null;
  const linesSource = data?.sources.find(
    (s) => s.data_source === "pregame_sweep"
  );
  const lines = linesSource?.last_completed_at ?? overall;

  const overallStr = isLoading && !data ? "—" : formatAgo(overall);
  const linesStr = isLoading && !data ? "—" : formatAgo(lines);

  return (
    <p
      aria-label="Data freshness"
      className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-gray-400 font-medium tabular-nums"
    >
      <Icon name="clock" className="w-3 h-3" aria-hidden="true" />
      <span>
        Last updated <span className="text-gray-200">{overallStr}</span>
      </span>
      <span aria-hidden="true" className="text-gray-600">
        ·
      </span>
      <span>
        Lines synced <span className="text-gray-200">{linesStr}</span>
      </span>
    </p>
  );
}
