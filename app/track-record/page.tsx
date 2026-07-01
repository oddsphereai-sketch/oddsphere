import Link from "next/link";
import { getPublicTrackRecordSummary } from "@/lib/services/tracking/publicTrackRecordSummary";
import type { PublicTrackRecordMetric } from "@/lib/services/tracking/publicTrackRecordSummary";

export const revalidate = 300;

export const metadata = {
  title: "Track Record — OddSphere AI",
  description:
    "Public tracked results for OddSphere AI sports prediction models by sport and market, updated after games settle.",
  alternates: { canonical: "/track-record" },
};

function pct(metric: PublicTrackRecordMetric): string {
  return metric.winPct === null ? "—" : `${metric.winPct.toFixed(1)}%`;
}

function record(metric: PublicTrackRecordMetric): string {
  return `${metric.wins.toLocaleString()}-${metric.losses.toLocaleString()}`;
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function dateRange(from: string | null, to: string | null): string {
  if (from === null && to === null) return "Updates as tracked results settle";
  if (from !== null && to !== null && from !== to) return `${from} through ${to}`;
  return from ?? to ?? "Updates as tracked results settle";
}

function MetricCard({
  label,
  value,
  sub,
  tone = "violet",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "violet" | "emerald" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-200"
        : "text-violet-300";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
        {label}
      </p>
      <p className={`mt-3 text-3xl font-black tabular-nums ${color}`}>{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-gray-300">{sub}</p>
    </div>
  );
}

export default async function PublicTrackRecordPage() {
  const summary = await getPublicTrackRecordSummary();
  const markets = summary.markets.filter((row) => row.metrics.picks > 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <header className="mx-auto mb-12 max-w-3xl text-center">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-violet-300">
          Public tracking
        </p>
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          Tracked Results Since Launch
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-gray-200 sm:text-lg">
          OddSphere tracks settled model predictions by sport and market from the
          public launch window beginning June 7, 2026. Pending games are kept separate
          and win rate excludes pushes, voids, and pending rows.
        </p>
        <p className="mt-3 text-xs text-gray-400">
          Public launch tracking, not legacy all-time history · Last updated {summary.lastUpdatedLabel}
        </p>
      </header>

      {!summary.tablesInitialized ? (
        <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-6 text-center text-amber-50">
          <h2 className="text-xl font-bold">Tracking summary temporarily unavailable</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-amber-100/85">
            The public page is connected to the live tracking service, but it could not
            load a safe aggregate summary right now. No stale manual numbers are shown.
          </p>
        </section>
      ) : (
        <>
          <section className="mb-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Overall settled record"
              value={record(summary.overall)}
              sub={`${pct(summary.overall)} win rate · ${compact(summary.overall.picks)} tracked rows`}
            />
            <MetricCard
              label="Settled"
              value={compact(summary.overall.settled)}
              sub={`${summary.overall.pending.toLocaleString()} pending rows update after games settle`}
              tone="emerald"
            />
            <MetricCard
              label="Best Angle"
              value={record(summary.bestAngles)}
              sub={`${pct(summary.bestAngles)} · ${compact(summary.bestAngles.picks)} tracked top-grade rows`}
            />
            <MetricCard
              label="Lean"
              value={record(summary.leans)}
              sub={`${pct(summary.leans)} · ${compact(summary.leans.picks)} tracked Lean rows`}
              tone="amber"
            />
          </section>

          <section className="mb-12 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-black tracking-tight">Sport summary</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Since public launch: {dateRange(summary.dateRange.from, summary.dateRange.to)}
                </p>
              </div>
              <p className="text-xs text-gray-500">
                Public accuracy counts only predictions with a tracked side.
              </p>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {summary.sports.map((sport) => (
                <div key={sport.sport} className="rounded-xl border border-white/10 bg-gray-950/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-bold text-white">{sport.label}</p>
                    <p className="text-sm font-black tabular-nums text-violet-300">
                      {pct(sport.metrics)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-gray-300">
                    {record(sport.metrics)} · {sport.metrics.pending.toLocaleString()} pending
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {sport.metrics.picks.toLocaleString()} total tracked rows
                  </p>
                </div>
              ))}
              {summary.sports.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-gray-950/60 p-4 text-sm text-gray-400">
                  No public tracked results are available yet.
                </p>
              ) : null}
            </div>
          </section>

          <section className="mb-12">
            <div className="mb-4">
              <h2 className="text-2xl font-black tracking-tight">Market breakdown</h2>
              <p className="mt-1 text-sm text-gray-400">
                Includes MLB Moneyline, Totals, First Inning, WNBA markets, and World Cup/Soccer markets when tracked.
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
              <div className="hidden grid-cols-[1.1fr_1.1fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-white/10 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 md:grid">
                <span>Sport</span>
                <span>Market</span>
                <span className="text-right">Record</span>
                <span className="text-right">Win Rate</span>
                <span className="text-right">Pending</span>
              </div>
              <div className="divide-y divide-white/10">
                {markets.map((row) => (
                  <div
                    key={`${row.sport}-${row.market}`}
                    className="grid gap-2 px-5 py-4 md:grid-cols-[1.1fr_1.1fr_0.8fr_0.8fr_0.8fr] md:items-center"
                  >
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 md:hidden">Sport</p>
                      <p className="font-semibold text-white">{row.sportLabel}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 md:hidden">Market</p>
                      <p className="text-sm text-gray-200">{row.marketLabel}</p>
                    </div>
                    <p className="text-sm tabular-nums text-gray-200 md:text-right">{record(row.metrics)}</p>
                    <p className="text-sm font-black tabular-nums text-violet-300 md:text-right">{pct(row.metrics)}</p>
                    <p className="text-sm tabular-nums text-gray-400 md:text-right">{row.metrics.pending.toLocaleString()}</p>
                  </div>
                ))}
                {markets.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-gray-400">
                    Market-level records will appear after public tracked results settle.
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </>
      )}

      <section className="mb-12 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-5 text-sm leading-relaxed text-amber-50">
        <p className="mb-1 font-semibold text-amber-200">Tracking is accountability, not a promise.</p>
        <p>
          Past results do not guarantee future outcomes. Prices, lines, timing, and user decisions all matter.
          OddSphere is an informational sports analytics product and does not place or settle wagers.
        </p>
      </section>

      <section className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.08] p-8 text-center sm:p-12">
        <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
          Want the Daily Edge dashboard behind the tracking?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-200">
          Premium members get the current slate reader, Play Grades, Market Read,
          Supporting Evidence, and sport-specific prediction context.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/pricing"
            className="rounded-lg bg-violet-600 px-7 py-3 text-sm font-bold text-white transition hover:bg-violet-500"
          >
            See Pricing
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-white/15 px-7 py-3 text-sm font-bold text-white transition hover:border-violet-400/40"
          >
            Back to Overview
          </Link>
        </div>
      </section>
    </main>
  );
}
