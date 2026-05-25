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
  const { data } = useRefreshStatus({ sport });

  const overall = data?.overall.last_updated_at ?? null;
  const linesSource = data?.sources.find(
    (s) => s.data_source === "pregame_sweep"
  );
  // Distinguish "lines is its own source" from "lines falls back to overall".
  // If pregame_sweep hasn't reported, the freshness chip should omit the
  // Lines line entirely rather than parrot the overall timestamp under a
  // different label (founder review #1: empty dashes erode trust; missing
  // components are cleaner than visible-but-empty ones).
  const lines = linesSource?.last_completed_at ?? null;

  // Render nothing when neither timestamp is available — the chip would just
  // be em-dashes that look like missing data. Once even one timestamp lands
  // the chip mounts with whichever is present.
  if (overall === null && lines === null) return null;

  return (
    <p
      aria-label="Data freshness"
      className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-gray-400 font-medium tabular-nums flex-wrap"
    >
      <Icon name="clock" className="w-3 h-3" aria-hidden="true" />
      {overall !== null && (
        <span>
          Last updated{" "}
          <span className="text-gray-200">{formatAgo(overall)}</span>
        </span>
      )}
      {overall !== null && lines !== null && (
        <span aria-hidden="true" className="text-gray-600">
          ·
        </span>
      )}
      {lines !== null && (
        <span>
          Lines synced <span className="text-gray-200">{formatAgo(lines)}</span>
        </span>
      )}
    </p>
  );
}
