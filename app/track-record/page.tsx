import Link from "next/link";
import type { Metadata } from "next";
import { getPublicTrackRecordSummary } from "@/lib/services/tracking/publicTrackRecordSummary";
import type { PublicTrackRecordMetric } from "@/lib/services/tracking/publicTrackRecordSummary";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Track Record — OddSphere AI",
  description:
    "Public settled-result archive for OddSphere AI sports prediction models by sport and market, updated after games settle.",
  alternates: { canonical: "/track-record" },
  openGraph: {
    type: "website",
    url: "/track-record",
    title: "Track Record — OddSphere AI",
    description:
      "A public settled-result archive for OddSphere model families, separated from pending member-dashboard results.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "OddSphere AI public track record preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@OddSphereAI",
    title: "Track Record — OddSphere AI",
    description:
      "Public settled-result archive by sport and market. Past performance does not guarantee future results.",
    images: ["/og-image.png"],
  },
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
  if (from === null && to === null) return "Historical model archive";
  if (from !== null && to !== null && from !== to) return `${from} through ${to}`;
  return from ?? to ?? "Historical model archive";
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
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
        {label}
      </p>
      <p className={`mt-3 break-words text-3xl font-black tabular-nums ${color}`}>{value}</p>
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
          Model performance archive
        </p>
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          Historical Tracking, Not Cherry-Picked Screenshots
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-gray-200 sm:text-lg">
          OddSphere separates the dated legacy model archive from the current
          official since-launch ledger. Their records and denominators are never
          combined into one performance claim.
        </p>
        <p className="mt-3 text-xs text-gray-400">
          Legacy archive · Settled summaries · Last updated {summary.lastUpdatedLabel}
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
              label="Legacy archive record"
              value={record(summary.overall)}
              sub={`${pct(summary.overall)} win rate · ${compact(summary.overall.picks)} historical picks`}
            />
            <MetricCard
              label="Legacy Archive Picks"
              value={compact(summary.overall.picks)}
              sub="Dated manual archive; not current-release official tracking"
              tone="emerald"
            />
            <MetricCard
              label="Sports"
              value={String(summary.sports.length)}
              sub="Football, basketball, baseball, soccer, and hockey model families"
            />
            <MetricCard
              label="Markets"
              value={String(summary.markets.length)}
              sub="Moneyline, totals, first inning, Double Chance, and more"
              tone="amber"
            />
          </section>

          {summary.currentOfficial ? (
            <section className="mb-12 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.055] p-5 sm:p-6">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">Current official since-launch ledger</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <p className="text-3xl font-black tabular-nums text-white">
                  {summary.currentOfficial.wins}-{summary.currentOfficial.losses}{summary.currentOfficial.pushes ? `-${summary.currentOfficial.pushes}` : ""}
                </p>
                <p className="text-sm text-gray-300">
                  {summary.currentOfficial.totalPredictions.toLocaleString()} official predictions · {summary.currentOfficial.hitRate.toFixed(1)}% · latest settled activity {summary.currentOfficial.latestActivityDate}
                </p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-400">
                This ledger is separate from the {summary.overall.picks.toLocaleString()}-pick legacy archive below. The legacy source lacks standardized price and stake history, so units and ROI are not claimed for it.
              </p>
            </section>
          ) : null}

          <section className="mb-12 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-black tracking-tight">Sport summary</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {summary.dateRange.label}: {dateRange(summary.dateRange.from, summary.dateRange.to)}
                </p>
              </div>
              <p className="text-xs text-gray-500">
                Public accuracy is grouped by sport family and market.
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
                    {record(sport.metrics)} · {sport.metrics.picks.toLocaleString()} picks
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {sport.metrics.picks.toLocaleString()} historical picks
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
                <span className="text-right">Picks</span>
              </div>
              <div className="divide-y divide-white/10">
                {markets.map((row) => (
                  <div
                    key={`${row.sport}-${row.market}`}
                    className="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[1.1fr_1.1fr_0.8fr_0.8fr_0.8fr] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 md:hidden">Sport</p>
                      <p className="font-semibold text-white">{row.sportLabel}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 md:hidden">Market</p>
                      <p className="text-sm text-gray-200">{row.marketLabel}</p>
                    </div>
                    <div className="grid gap-2 rounded-xl border border-white/10 bg-gray-950/50 p-3 sm:grid-cols-3 md:contents">
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-500 md:hidden">Record</p>
                        <p className="mt-1 text-sm tabular-nums text-gray-200 md:mt-0 md:text-right">{record(row.metrics)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-500 md:hidden">Win Rate</p>
                        <p className="mt-1 text-sm font-black tabular-nums text-violet-300 md:mt-0 md:text-right">{pct(row.metrics)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-500 md:hidden">Picks</p>
                        <p className="mt-1 text-sm tabular-nums text-gray-400 md:mt-0 md:text-right">{row.metrics.picks.toLocaleString()}</p>
                      </div>
                    </div>
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
          OddSphere is an informational sports analytics product and does not place, accept, or settle wagers.
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
