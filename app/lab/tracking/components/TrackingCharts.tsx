/**
 * Phase 6B.2e — Tracking chart primitives.
 *
 * The 6B.2e redesign uses one intentional chart: a horizontal
 * category-comparison bar for "this week by category". The
 * previous 14-day trend + daily-bars charts were removed —
 * they read as decorative on launch-week data, not designed.
 *
 * Each component carries its own honest empty state.
 */

"use client";

export type ChartMetrics = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  win_pct: number | null;
};

/**
 * Horizontal bar comparing win rate across categories. Each row is
 * "label · record · pct" with a thin progress bar tied to win rate.
 * Rows with zero decided picks render with a muted state and the
 * pending count instead of a misleading 0% bar.
 */
export function CategoryBars({
  rows,
  emptyBody = "Comparison appears once categories have graded picks.",
}: {
  rows: { label: string; sublabel?: string; metrics: ChartMetrics }[];
  emptyBody?: string;
}) {
  const anyDecided = rows.some((r) => r.metrics.wins + r.metrics.losses > 0);
  if (!anyDecided) {
    return <EmptyState body={emptyBody} />;
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const m = r.metrics;
        const decided = m.wins + m.losses;
        const pct = m.win_pct ?? 0;
        return (
          <div key={`${r.label}-${r.sublabel ?? ""}`}>
            <div className="mb-1.5 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[12.5px] font-semibold text-gray-100 truncate">{r.label}</span>
                {r.sublabel !== undefined && (
                  <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-bold shrink-0">{r.sublabel}</span>
                )}
              </div>
              <div className="shrink-0 text-[11px] tabular-nums text-gray-400">
                {decided > 0 ? (
                  <>
                    <span className="font-bold text-gray-200">{m.wins}-{m.losses}{m.pushes > 0 ? `-${m.pushes}` : ""}</span>
                    <span className="ml-2 text-emerald-300/90 font-bold">{pct.toFixed(1)}%</span>
                  </>
                ) : (
                  <span className="text-gray-500">{m.pending} pending</span>
                )}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
              {decided > 0 ? (
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: "linear-gradient(90deg, rgb(52 211 153), rgb(110 231 183))" }} />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ body }: { body: string }) {
  return (
    <div className="rounded-lg bg-white/[0.012] border border-dashed border-white/[0.05] py-5 px-4 text-center text-[11.5px] text-gray-500/80 leading-relaxed">
      {body}
    </div>
  );
}
