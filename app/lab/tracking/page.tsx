/**
 * Phase 6B.2b — Member-facing tracking page.
 *
 * Polished, mobile-first record card sweeping summary → markets → play
 * grades → models. Matches the Daily Edge dark-premium palette. Data
 * rules from the spec:
 *
 *   • Main win rate = wins / (wins + losses) on actionable graded
 *     picks. Toss-Up and Held are NEVER mixed in.
 *   • Toss-Up and Held are surfaced as state counts only.
 *   • Pushes / voids / pending counted separately.
 *   • FI V2 vs legacy FI is filterable via the model-version split.
 *
 * Server route: /api/lab/tracking-foundation
 * Empty/loading/error states all rendered honestly — never fake data.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

type Metrics = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  win_pct: number | null;
};

type BaselineRow = {
  sport: string;
  market: string;
  source_label: string;
  model_family: string;
  lifetime_wins: number;
  lifetime_total: number;
  lifetime_pct: number;
};

type DimensionRow = { label: string; metrics: Metrics };

type TrackingResponse = {
  sport: string;
  baselines: BaselineRow[];
  overall: Metrics;
  bySport: DimensionRow[];
  byMarket: DimensionRow[];
  byPlayGrade?: DimensionRow[];
  byModelVersion?: DimensionRow[];
  bestAngles: Metrics;
  leans?: Metrics;
  tablesInitialized: boolean;
  freshTrackingStarted: boolean;
};

function fmtRecord(m: Metrics): string {
  return `${m.wins}-${m.losses}${m.pushes > 0 ? `-${m.pushes}` : ""}`;
}
function fmtPct(m: Metrics): string {
  if (m.win_pct === null) return "—";
  return `${m.win_pct.toFixed(1)}%`;
}

const MARKET_LABEL: Record<string, string> = {
  moneyline: "Moneyline",
  total: "Total O/U",
  first_inning: "First Inning",
  nrfi: "NRFI",
  yrfi: "YRFI",
};

const PLAY_GRADE_LABEL: Record<string, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  no_bet: "No Bet",
  market_aligned: "Market Aligned",
  toss_up: "Toss-Up",
  held: "Held",
  "(none)": "Unclassified",
};

const MODEL_VERSION_LABEL: Record<string, string> = {
  "auto_v2.2_mlb_full_game_projection": "V2.2 Full-Game",
  fi_v2: "FI V2",
  legacy: "Legacy",
  "(unknown)": "Legacy / Pre-cutover",
};

function prettyModelVersion(label: string): string {
  return MODEL_VERSION_LABEL[label] ?? label;
}

export default function LabTrackingPage() {
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lab/tracking-foundation")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLastUpdated(new Date().toISOString());
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const fiSlice = useMemo(() => {
    if (!data) return null;
    const fi = data.byMarket.find((r) => r.label === "first_inning");
    const nrfi = data.byMarket.find((r) => r.label === "nrfi");
    const yrfi = data.byMarket.find((r) => r.label === "yrfi");
    return { fi, nrfi, yrfi };
  }, [data]);

  // Page states ────────────────────────────────────────────────────────
  if (error) {
    return (
      <Shell>
        <div className="text-amber-300/90">Tracking is temporarily unavailable. {error}</div>
      </Shell>
    );
  }
  if (data === null) {
    return <Shell><div className="text-gray-400">Loading tracking…</div></Shell>;
  }
  if (!data.tablesInitialized) {
    return (
      <Shell>
        <EmptyCard
          title="Tracking is initializing"
          body="Performance records will appear here once the system has graded its first slate."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Header lastUpdated={lastUpdated} freshTracking={data.freshTrackingStarted} />

      {/* Summary cards */}
      <Section title="Overall record">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <RecordCard label="All picks"   metrics={data.overall}     tone="neutral" />
          <RecordCard label="Best Angle"  metrics={data.bestAngles}  tone="strong"  />
          {data.leans && <RecordCard label="Lean" metrics={data.leans} tone="lean" />}
          <PendingCard pending={data.overall.pending} />
        </div>
      </Section>

      {/* Market splits */}
      <Section title="By market" subtitle="Moneyline, Total, First Inning">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <MarketCard label="Moneyline"    metrics={data.byMarket.find((r) => r.label === "moneyline")?.metrics} />
          <MarketCard label="Total O/U"    metrics={data.byMarket.find((r) => r.label === "total")?.metrics} />
          <MarketCard
            label="First Inning"
            metrics={fiSlice?.fi?.metrics ?? aggregateFi(fiSlice?.nrfi?.metrics, fiSlice?.yrfi?.metrics)}
            note={fiSlice?.fi || fiSlice?.nrfi || fiSlice?.yrfi
              ? `NRFI ${fiSlice?.nrfi ? fmtRecord(fiSlice.nrfi.metrics) : "—"} · YRFI ${fiSlice?.yrfi ? fmtRecord(fiSlice.yrfi.metrics) : "—"}`
              : null}
          />
        </div>
      </Section>

      {/* Play-grade splits */}
      {data.byPlayGrade && data.byPlayGrade.length > 0 && (
        <Section title="By play grade" subtitle="Toss-Up and Held are state counts only — not wins or losses">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {["best_angle", "lean", "no_bet", "toss_up", "held"].map((pg) => {
              const row = data.byPlayGrade!.find((r) => r.label === pg);
              const m = row?.metrics ?? emptyMetrics();
              const isStateOnly = pg === "toss_up" || pg === "held";
              return <PlayGradeCard key={pg} label={PLAY_GRADE_LABEL[pg] ?? pg} metrics={m} stateOnly={isStateOnly} />;
            })}
          </div>
        </Section>
      )}

      {/* Model version splits */}
      {data.byModelVersion && data.byModelVersion.length > 0 && (
        <Section title="By model version" subtitle="FI V2 picks are tracked separately from legacy first-inning picks">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {data.byModelVersion.map((row) => (
              <ModelVersionCard key={row.label} label={prettyModelVersion(row.label)} metrics={row.metrics} />
            ))}
          </div>
        </Section>
      )}

      {/* Explainer */}
      <Section title="What this means">
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-2 text-[13px] text-gray-300 leading-relaxed">
          <p><span className="font-semibold text-gray-100">Model Prob</span> is what the model thinks will happen for the picked side.</p>
          <p><span className="font-semibold text-gray-100">Edge</span> measures the model probability against the book&apos;s no-vig price.</p>
          <p><span className="font-semibold text-gray-100">Rec</span> is how actionable the pick is relative to the book; small or negative edge caps it.</p>
          <p><span className="font-semibold text-gray-100">Best Angle</span> is the strongest filtered tier — meaningful edge plus reliable data.</p>
          <p><span className="font-semibold text-gray-100">Toss-Up</span> and <span className="font-semibold text-gray-100">Held</span> are model states, not bets. They are not counted as wins or losses.</p>
        </div>
      </Section>

      {/* Historical baselines */}
      {data.baselines && data.baselines.length > 0 && (
        <Section title="Historical baselines" subtitle="Pre-launch reference data — frozen at import">
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-[12.5px] min-w-[480px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-white/[0.06]">
                  <th className="py-2 px-4 sm:px-3 font-semibold tracking-wide uppercase text-[10px]">Sport</th>
                  <th className="py-2 px-3 font-semibold tracking-wide uppercase text-[10px]">Market</th>
                  <th className="py-2 px-3 text-right font-semibold tracking-wide uppercase text-[10px]">Lifetime</th>
                  <th className="py-2 pr-4 sm:pr-3 text-right font-semibold tracking-wide uppercase text-[10px]">Win %</th>
                </tr>
              </thead>
              <tbody>
                {data.baselines.map((b) => (
                  <tr key={`${b.sport}_${b.market}_${b.source_label}`} className="border-b border-white/[0.03]">
                    <td className="py-2 px-4 sm:px-3 uppercase tracking-wide text-gray-400">{b.sport}</td>
                    <td className="py-2 px-3 text-gray-300">{b.source_label}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-300">{b.lifetime_wins.toLocaleString()}/{b.lifetime_total.toLocaleString()}</td>
                    <td className="py-2 pr-4 sm:pr-3 text-right tabular-nums text-emerald-300/90">{b.lifetime_pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <footer className="mt-10 text-[11px] text-gray-600 leading-relaxed">
        Win rate excludes pushes, voids, pending, Toss-Up and Held picks. Postponed and canceled games count as voids. First-inning grading requires the first-inning linescore.
      </footer>
    </Shell>
  );
}

// ─── Components ────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0d14] text-gray-100 px-4 sm:px-6 py-8">
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  );
}

function Header({ lastUpdated, freshTracking }: { lastUpdated: string | null; freshTracking: boolean }) {
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight text-white" style={{ letterSpacing: "-0.02em" }}>
          Model Tracking
        </h1>
        {lastUpdated && (
          <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-bold">
            Updated {new Date(lastUpdated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        )}
      </div>
      <p className="text-[13px] text-gray-400 mt-1.5 max-w-2xl leading-relaxed">
        Transparent performance by market, pick type, and model version. Toss-Up and Held are model states, not bets — they are not counted as wins or losses.
      </p>
      {!freshTracking && (
        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/[0.08] border border-amber-500/20 text-[11px] text-amber-200/90">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          Fresh tracking starts after the first graded slate.
        </div>
      )}
    </header>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-7 sm:mb-9">
      <div className="mb-2.5">
        <h2 className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500/90">{title}</h2>
        {subtitle && <p className="text-[11.5px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function emptyMetrics(): Metrics {
  return { picks: 0, wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0, win_pct: null };
}

function aggregateFi(a: Metrics | undefined, b: Metrics | undefined): Metrics {
  const out = emptyMetrics();
  for (const x of [a, b]) {
    if (!x) continue;
    out.picks += x.picks; out.wins += x.wins; out.losses += x.losses;
    out.pushes += x.pushes; out.voids += x.voids; out.pending += x.pending;
  }
  const dec = out.wins + out.losses;
  out.win_pct = dec > 0 ? Math.round((out.wins / dec) * 1000) / 10 : null;
  return out;
}

function RecordCard({ label, metrics, tone }: { label: string; metrics: Metrics; tone: "strong" | "lean" | "neutral" }) {
  const accent =
    tone === "strong" ? "text-emerald-300"
    : tone === "lean" ? "text-indigo-300"
    : "text-gray-200";
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-3.5 py-3 sm:px-4 sm:py-3.5">
      <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500">{label}</div>
      <div className={`text-[22px] sm:text-[24px] font-black tabular-nums leading-none mt-1.5 ${accent}`}>
        {fmtRecord(metrics)}
      </div>
      <div className="text-[11.5px] tabular-nums text-gray-400 mt-1.5">
        {fmtPct(metrics)} · {metrics.picks} picks
      </div>
    </div>
  );
}

function PendingCard({ pending }: { pending: number }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-3.5 py-3 sm:px-4 sm:py-3.5">
      <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500">Pending</div>
      <div className="text-[22px] sm:text-[24px] font-black tabular-nums leading-none mt-1.5 text-gray-300">{pending}</div>
      <div className="text-[11.5px] tabular-nums text-gray-500 mt-1.5">awaiting result</div>
    </div>
  );
}

function MarketCard({ label, metrics, note }: { label: string; metrics: Metrics | undefined; note?: string | null }) {
  const m = metrics ?? emptyMetrics();
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-gray-400">{label}</div>
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-600">{m.picks} picks</span>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-[20px] tabular-nums font-extrabold text-gray-100 leading-none">{fmtRecord(m)}</span>
        <span className="text-[15px] tabular-nums font-bold text-emerald-300/90 leading-none">{fmtPct(m)}</span>
      </div>
      {m.pending > 0 && (
        <div className="mt-2 text-[11px] text-gray-500">{m.pending} pending</div>
      )}
      {note && <div className="mt-1 text-[10.5px] text-gray-500/80 tabular-nums">{note}</div>}
    </div>
  );
}

function PlayGradeCard({ label, metrics, stateOnly }: { label: string; metrics: Metrics; stateOnly: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500">{label}</div>
      {stateOnly ? (
        <>
          <div className="text-[18px] tabular-nums font-extrabold text-gray-200 leading-none mt-1.5">{metrics.picks}</div>
          <div className="text-[10.5px] text-gray-500 mt-1.5 leading-snug">model state · not graded as bet</div>
        </>
      ) : (
        <>
          <div className="text-[18px] tabular-nums font-extrabold text-gray-100 leading-none mt-1.5">{fmtRecord(metrics)}</div>
          <div className="text-[10.5px] tabular-nums text-gray-400 mt-1.5">
            {fmtPct(metrics)}{metrics.pending > 0 ? ` · ${metrics.pending} pend` : ""}
          </div>
        </>
      )}
    </div>
  );
}

function ModelVersionCard({ label, metrics }: { label: string; metrics: Metrics }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-gray-400">{label}</div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-[18px] tabular-nums font-extrabold text-gray-100 leading-none">{fmtRecord(metrics)}</span>
        <span className="text-[13px] tabular-nums font-bold text-emerald-300/90 leading-none">{fmtPct(metrics)}</span>
      </div>
      <div className="mt-1.5 text-[10.5px] tabular-nums text-gray-500">
        {metrics.picks} picks{metrics.pending > 0 ? ` · ${metrics.pending} pending` : ""}
      </div>
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-6 text-center">
      <div className="text-[15px] font-semibold text-gray-200">{title}</div>
      <div className="text-[12.5px] text-gray-500 mt-1.5">{body}</div>
    </div>
  );
}
