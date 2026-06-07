/**
 * Phase 6B.2d — Inline SVG chart primitives for the tracking page.
 *
 * Lightweight, zero-dependency, mobile-friendly. Each chart accepts
 * its own "empty" state so the page can show an honest placeholder
 * when sample size is too low to draw anything meaningful.
 */

"use client";

import { useId } from "react";

export type ChartMetrics = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  win_pct: number | null;
};

export type DailyBucket = {
  date: string;
  metrics: ChartMetrics;
};

// ─── Trend line chart (win rate over time) ─────────────────────────────
/**
 * Drawn from a contiguous list of daily buckets. Days with no graded
 * picks fall back to null so the line breaks rather than misleadingly
 * dipping to 0%.
 */
export function TrendChart({
  buckets,
  height = 120,
}: {
  buckets: DailyBucket[];
  height?: number;
}) {
  const gradientId = useId();
  const decidedDays = buckets.filter(
    (b) => b.metrics.wins + b.metrics.losses > 0,
  ).length;
  if (decidedDays < 2) {
    return (
      <EmptyChart
        height={height}
        body="Trend chart appears after more graded slates."
      />
    );
  }

  const width = 600;
  const padX = 12;
  const padY = 16;
  const n = buckets.length;
  const xs = (i: number): number => padX + (i * (width - padX * 2)) / (n - 1);
  const ys = (pct: number): number =>
    height - padY - ((pct / 100) * (height - padY * 2));

  type Point = { x: number; y: number; pct: number; date: string };
  const points: Point[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const decided = b.metrics.wins + b.metrics.losses;
    if (decided === 0 || b.metrics.win_pct === null) continue;
    points.push({ x: xs(i), y: ys(b.metrics.win_pct), pct: b.metrics.win_pct, date: b.date });
  }
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height - padY} L ${points[0].x.toFixed(1)} ${height - padY} Z`
    : "";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full block" preserveAspectRatio="none" role="img" aria-label="Daily win-rate trend">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[25, 50, 75].map((g) => (
        <line key={g} x1={padX} x2={width - padX} y1={ys(g)} y2={ys(g)} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 4" />
      ))}
      <line x1={padX} x2={width - padX} y1={ys(50)} y2={ys(50)} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 4" />
      {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
      <path d={linePath} fill="none" stroke="rgb(110 231 183)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => (
        <circle key={`${p.date}-${p.x}`} cx={p.x} cy={p.y} r="2.5" fill="rgb(167 243 208)" />
      ))}
    </svg>
  );
}

// ─── Daily W/L bar chart ──────────────────────────────────────────────

export function DailyBars({
  buckets,
  height = 110,
}: {
  buckets: DailyBucket[];
  height?: number;
}) {
  const decidedDays = buckets.filter((b) => b.metrics.wins + b.metrics.losses > 0).length;
  if (decidedDays === 0) {
    return <EmptyChart height={height} body="Daily breakdown appears after the first graded slate." />;
  }
  const width = 600;
  const padX = 12;
  const padY = 14;
  const n = buckets.length;
  const slotW = (width - padX * 2) / n;
  const barW = Math.max(4, slotW * 0.55);

  // Stack max for y-scale = max W+L on any day.
  let maxStack = 0;
  for (const b of buckets) {
    const dec = b.metrics.wins + b.metrics.losses;
    if (dec > maxStack) maxStack = dec;
  }
  if (maxStack === 0) maxStack = 1;
  const scale = (count: number): number => ((count / maxStack) * (height - padY * 2));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full block" preserveAspectRatio="none" role="img" aria-label="Daily wins and losses">
      <line x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} stroke="rgba(255,255,255,0.08)" />
      {buckets.map((b, i) => {
        const cx = padX + slotW * i + slotW / 2;
        const wH = scale(b.metrics.wins);
        const lH = scale(b.metrics.losses);
        const baseY = height - padY;
        return (
          <g key={b.date}>
            {b.metrics.losses > 0 && (
              <rect x={cx - barW / 2} y={baseY - lH} width={barW} height={lH} fill="rgba(244,114,182,0.55)" rx="1.5" />
            )}
            {b.metrics.wins > 0 && (
              <rect
                x={cx - barW / 2}
                y={baseY - lH - wH}
                width={barW}
                height={wH}
                fill="rgb(52 211 153)"
                rx="1.5"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Compare bars (Best Angle vs Lean win rate) ────────────────────────

export function CompareBars({
  rows,
}: {
  rows: { label: string; metrics: ChartMetrics; color: string }[];
}) {
  // Only render rows that have decided picks. Pure-pending rows show
  // their pending count separately rather than a meaningless 0%.
  const decided = rows.filter((r) => (r.metrics.wins + r.metrics.losses) > 0);
  if (decided.length === 0) {
    return (
      <EmptyChart
        height={90}
        body="Best Angle vs Lean comparison appears after the first graded picks."
      />
    );
  }
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const dec = r.metrics.wins + r.metrics.losses;
        const pct = r.metrics.win_pct ?? 0;
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-gray-300">{r.label}</span>
              <span className="text-[11.5px] tabular-nums text-gray-400">
                {r.metrics.wins}-{r.metrics.losses}{r.metrics.pushes > 0 ? `-${r.metrics.pushes}` : ""}
                {dec === 0 ? ` · ${r.metrics.pending} pending` : ` · ${pct.toFixed(1)}%`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
              {dec > 0 && (
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, pct)}%`, backgroundColor: r.color }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Empty chart placeholder ──────────────────────────────────────────

function EmptyChart({ height, body }: { height: number; body: string }) {
  return (
    <div
      className="w-full rounded-md bg-white/[0.015] border border-dashed border-white/[0.06] flex items-center justify-center text-[11.5px] text-gray-500/80 px-3 text-center"
      style={{ height }}
    >
      {body}
    </div>
  );
}
