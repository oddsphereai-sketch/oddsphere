"use client";

/**
 * RefreshIndicator — top-bar status pill showing pipeline freshness.
 *
 * Consumes useRefreshStatus (5A). Visible on every Lab page via LabNav.
 *
 * States mirror the route's worst-of-frontline aggregate:
 *   • live     — pulsing emerald dot, "Live · Updated Nm ago · Next refresh in Nm"
 *   • updating — amber dot, "Updating now"
 *   • stale    — red dot, "Stale · Last update Nh ago"
 *   • error    — red dot, "Refresh failed · Last successful Nh ago"
 *   • unknown  — gray dot, "No status yet"
 *
 * Mobile collapses to the dot + a short label. Clicking expands a panel that
 * lists every cron source with its individual state (powered by the same
 * SWR cache the navbar reads — no second fetch).
 */

import { useEffect, useRef, useState } from "react";
import { useRefreshStatus } from "../hooks/useRefreshStatus";
import type { RefreshSource, RefreshState } from "../lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

// ─── Time-ago / time-to formatters ───────────────────────────────────────

function formatAgo(ageSeconds: number | null): string {
  if (ageSeconds === null || ageSeconds < 0) return "—";
  if (ageSeconds < 60) return "just now";
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatUntil(nextScheduled: string | null, referenceTimestamp: string | null): string | null {
  if (!nextScheduled || !referenceTimestamp) return null;
  const target = new Date(nextScheduled).getTime();
  const reference = new Date(referenceTimestamp).getTime();
  if (!Number.isFinite(target) || !Number.isFinite(reference)) return null;
  const deltaSeconds = Math.floor((target - reference) / 1000);
  if (deltaSeconds <= 0) return "imminent";
  if (deltaSeconds < 60) return `${deltaSeconds}s`;
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ─── Visual style per state ───────────────────────────────────────────────

type StateStyle = {
  label: string;
  dot: string;          // bg color class
  dotShadow: string;    // glow/shadow class
  text: string;         // primary text color
  pillBorder: string;
  pillBg: string;
  pulse: boolean;
};

// Phase 6B.4 launch reframe — the pill is now framed as a "Last
// updated" timestamp rather than an alarm. The state still informs
// the dot color (subtly), but the loud "Stale" / "Refresh failed"
// red labeling is replaced with a neutral "Last updated <time>"
// message. Members shouldn't see operational red flags during a
// normal cron lull.
const STATE_STYLES: Record<RefreshState, StateStyle> = {
  live: {
    label: "Last updated",
    dot: "bg-emerald-400",
    dotShadow: "shadow-[0_0_8px_rgba(52,211,153,0.55)]",
    text: "text-emerald-300",
    pillBorder: "border-emerald-700/30",
    pillBg: "bg-emerald-950/20",
    pulse: true,
  },
  updating: {
    label: "Updating",
    dot: "bg-amber-400",
    dotShadow: "shadow-[0_0_8px_rgba(251,191,36,0.55)]",
    text: "text-amber-300",
    pillBorder: "border-amber-700/30",
    pillBg: "bg-amber-950/20",
    pulse: true,
  },
  stale: {
    // Reframed: not a member-facing alarm. Show a neutral gray "Last
    // updated <time>" so a quiet day or off-peak hour doesn't look
    // like a broken product. The detail line carries the exact age.
    label: "Last updated",
    dot: "bg-gray-400",
    dotShadow: "",
    text: "text-gray-300",
    pillBorder: "border-gray-700/40",
    pillBg: "bg-gray-900/40",
    pulse: false,
  },
  error: {
    // Same reframing rationale — cron retry windows shouldn't paint
    // the entire UI red.
    label: "Last updated",
    dot: "bg-gray-400",
    dotShadow: "",
    text: "text-gray-300",
    pillBorder: "border-gray-700/40",
    pillBg: "bg-gray-900/40",
    pulse: false,
  },
  unknown: {
    label: "No status yet",
    dot: "bg-gray-500",
    dotShadow: "",
    text: "text-gray-400",
    pillBorder: "border-gray-700/50",
    pillBg: "bg-gray-900/60",
    pulse: false,
  },
};

// ─── Component ────────────────────────────────────────────────────────────

export default function RefreshIndicator({ sport }: { sport?: Sport }) {
  const { data, error, isLoading } = useRefreshStatus({ sport });
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close panel on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Loading + error fall back to "unknown" visuals.
  const state: RefreshState =
    error ? "error" : !data ? "unknown" : data.overall.state;

  // 6.4d founder review #6: hide the pill entirely in the unknown state.
  // It adds no value to members when the pipeline has nothing to report
  // (typically only the initial empty-DB state). Healthy/updating/stale/
  // error all still render — only "unknown" hides.
  if (state === "unknown") return null;

  const style = STATE_STYLES[state];
  const ageStr = formatAgo(data?.overall.age_seconds ?? null);
  // Use the API snapshot time for the initial countdown. Date.now() can cross
  // a minute boundary between server render and hydration, producing different
  // text for otherwise identical data. SWR advances `as_of` on each poll.
  const untilStr = formatUntil(
    data?.overall.next_scheduled_at ?? null,
    data?.as_of ?? null,
  );

  // Detail text. Phase 6B.4 — uniform "<ageStr>" format across live /
  // stale / error so the pill always reads as a "Last updated" time,
  // not as a loud operational alarm.
  let detail = "";
  if (state === "live") {
    detail = `${ageStr}${untilStr ? ` · Next in ${untilStr}` : ""}`;
  } else if (state === "updating") {
    detail = "Refresh in progress";
  } else if (state === "stale") {
    detail = ageStr;
  } else if (state === "error") {
    detail = ageStr;
  } else {
    detail = isLoading ? "Loading…" : "No status reported yet";
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Pipeline status: ${style.label} · ${detail}. Tap for details.`}
        className={`inline-flex items-center gap-2 rounded-full border ${style.pillBorder} ${style.pillBg} px-3 py-1.5 min-h-9 text-xs sm:text-[11px] font-medium transition-colors hover:bg-opacity-70`}
      >
        <span className="relative inline-flex h-2 w-2">
          {style.pulse && (
            <span
              aria-hidden="true"
              className={`absolute inset-0 rounded-full ${style.dot} opacity-40 animate-ping`}
            />
          )}
          <span
            aria-hidden="true"
            className={`relative inline-flex h-2 w-2 rounded-full ${style.dot} ${style.dotShadow}`}
          />
        </span>
        <span className={`${style.text} uppercase tracking-wider font-bold`}>
          {style.label}
        </span>
        {/* Detail visible on sm+ only; small screens get just the dot + label. */}
        <span className="hidden sm:inline text-gray-400 normal-case tracking-normal font-normal">
          · {detail}
        </span>
      </button>

      {open && data && (
        <SourcePanel
          sources={data.sources}
          asOf={data.as_of}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Detail panel ────────────────────────────────────────────────────────

function SourcePanel({
  sources,
  asOf,
  onClose,
}: {
  sources: RefreshSource[];
  asOf: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Refresh source details"
      className="absolute right-0 top-full mt-2 w-[320px] max-w-[88vw] bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl shadow-2xl shadow-black/40 z-50 overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold">
          Refresh sources
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-gray-400 hover:text-white text-base leading-none"
        >
          ×
        </button>
      </div>
      <ul className="max-h-[60vh] overflow-y-auto divide-y divide-gray-800/60">
        {sources.map((s) => (
          <SourceRow key={`${s.data_source}:${s.sport ?? "_"}`} source={s} />
        ))}
      </ul>
      <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-500 tabular-nums">
        Snapshot taken {formatAgo(Math.floor((Date.now() - new Date(asOf).getTime()) / 1000))}
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: RefreshSource }) {
  const style = STATE_STYLES[source.state];
  const ageStr = formatAgo(
    source.age_minutes === null ? null : Math.floor(source.age_minutes * 60)
  );
  return (
    <li className="px-4 py-2.5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-gray-100 font-medium truncate">
          {prettifySource(source.data_source)}
          {source.sport && (
            <span className="text-gray-500 ml-1.5 text-[10px] uppercase tracking-wider">
              {source.sport}
            </span>
          )}
        </p>
        <p className="text-xs text-gray-400">
          {source.records_updated !== null
            ? `${source.records_updated} records · `
            : ""}
          {ageStr}
        </p>
      </div>
      <span
        className={`shrink-0 inline-flex items-center gap-1.5 ${style.text} text-[10px] uppercase tracking-wider font-bold`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`}
        />
        {style.label}
      </span>
    </li>
  );
}

function prettifySource(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
