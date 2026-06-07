/**
 * Phase 6B.2d — Premium tracking page redesign.
 *
 * Story-led layout: hero (yesterday / week / Best Angle / pending),
 * weekly trend chart, sport+category cards, FI module, Best Angle vs
 * Lean compare, model version (secondary), recent picks, explainer.
 *
 * Hard data rules (unchanged from 6B.2b):
 *   • Main win-rate counts decided actionable picks only —
 *     Toss-Up / Held / No Bet / pushes / voids / pending are surfaced
 *     separately and NEVER mixed into the win rate.
 *   • Sport × category is the primary hierarchy, not one blended
 *     overall record.
 *   • NRFI and YRFI are first-class — never hidden behind a single
 *     "First Inning" total.
 *   • Empty / low-sample states render honest copy. Never fake data.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import {
  CompareBars,
  DailyBars,
  TrendChart,
  type ChartMetrics,
  type DailyBucket,
} from "./components/TrackingCharts";

// ─── Types (mirror the member API shape) ───────────────────────────────

type Metrics = ChartMetrics;

type DimensionRow = { label: string; metrics: Metrics };

type SportMarketBucket = {
  sport: string;
  market: string;
  metrics: Metrics;
  bestAngles: Metrics;
  leans: Metrics;
};

type RecentPickRow = {
  slate_date: string;
  sport: string;
  market: string;
  matchup: string;
  pick: string | null;
  play_grade: string | null;
  model_version: string | null;
  result: "win" | "loss" | "push" | "void" | "pending";
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_first_inning_runs: number | null;
  best_angle: boolean;
  held: boolean;
};

type BaselineRow = {
  sport: string;
  market: string;
  source_label: string;
  lifetime_wins: number;
  lifetime_total: number;
  lifetime_pct: number;
};

type TrackingResponse = {
  sport: string;
  baselines: BaselineRow[];
  overall: Metrics;
  bySport: DimensionRow[];
  byMarket: DimensionRow[];
  bySportMarket?: SportMarketBucket[];
  byPlayGrade?: DimensionRow[];
  byModelVersion?: DimensionRow[];
  bestAngles: Metrics;
  leans?: Metrics;
  yesterday?: { date: string | null; overall: Metrics; bySportMarket: SportMarketBucket[] };
  thisWeek?: { from: string; to: string; overall: Metrics; bySportMarket: SportMarketBucket[]; daily: DailyBucket[] };
  dailyTrend?: DailyBucket[];
  recentPicks?: RecentPickRow[];
  tablesInitialized: boolean;
  freshTrackingStarted: boolean;
};

// ─── Constants ─────────────────────────────────────────────────────────

const SPORT_LABEL: Record<string, string> = {
  mlb: "MLB", nfl: "NFL", nba: "NBA", nhl: "NHL", cfb: "CFB", cbb: "CBB", ucl: "UCL",
};

const MARKET_LABEL: Record<string, string> = {
  moneyline: "Moneyline",
  total: "Total O/U",
  first_inning: "First Inning",
  nrfi: "NRFI",
  yrfi: "YRFI",
  spread: "Spread",
  double_chance: "Double Chance",
};

const MARKET_SHORT: Record<string, string> = {
  moneyline: "ML", total: "O/U", first_inning: "FI", nrfi: "NRFI", yrfi: "YRFI", spread: "ATS", double_chance: "DC",
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

// Order MLB cards as: ML, O/U, NRFI, YRFI (first_inning rollup goes
// after, since NRFI/YRFI are the actionable categories).
const MARKET_ORDER: Record<string, number> = {
  moneyline: 1, total: 2, nrfi: 3, yrfi: 4, first_inning: 5, spread: 6, double_chance: 7,
};

const SPORT_ORDER: Record<string, number> = {
  mlb: 1, nfl: 2, nba: 3, nhl: 4, cfb: 5, cbb: 6, ucl: 7,
};

// ─── Format helpers ────────────────────────────────────────────────────

function fmtRecord(m: Metrics): string {
  return `${m.wins}-${m.losses}${m.pushes > 0 ? `-${m.pushes}` : ""}`;
}
function fmtPct(m: Metrics): string {
  if (m.win_pct === null) return "—";
  return `${m.win_pct.toFixed(1)}%`;
}
function fmtDate(yyyyMmDd: string | null): string {
  if (yyyyMmDd === null) return "—";
  const [y, m, d] = yyyyMmDd.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtShortDate(yyyyMmDd: string): string {
  const [, m, d] = yyyyMmDd.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}
function emptyMetrics(): Metrics {
  return { picks: 0, wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0, win_pct: null };
}

function prettyModelVersion(label: string): string { return MODEL_VERSION_LABEL[label] ?? label; }
function prettyMarket(label: string): string { return MARKET_LABEL[label] ?? label; }
function shortMarket(label: string): string { return MARKET_SHORT[label] ?? label.toUpperCase(); }
function prettySport(label: string): string { return SPORT_LABEL[label] ?? label.toUpperCase(); }

// ─── Component ─────────────────────────────────────────────────────────

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

  // Group sport+market buckets by sport for the core section. Skip
  // legacy first_inning rollup when NRFI / YRFI carry the same data.
  const sportSections = useMemo(() => {
    if (data === null) return [];
    const buckets = data.bySportMarket ?? [];
    const groups = new Map<string, SportMarketBucket[]>();
    for (const b of buckets) {
      if (!groups.has(b.sport)) groups.set(b.sport, []);
      groups.get(b.sport)!.push(b);
    }
    const out: { sport: string; markets: SportMarketBucket[] }[] = [];
    for (const [sport, arr] of groups) {
      arr.sort((a, b) => (MARKET_ORDER[a.market] ?? 99) - (MARKET_ORDER[b.market] ?? 99));
      out.push({ sport, markets: arr });
    }
    out.sort((a, b) => (SPORT_ORDER[a.sport] ?? 99) - (SPORT_ORDER[b.sport] ?? 99));
    return out;
  }, [data]);

  if (error !== null) {
    return <Shell><div className="text-amber-300/90">Tracking is temporarily unavailable. {error}</div></Shell>;
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

  const yest = data.yesterday;
  const week = data.thisWeek;
  const trend = data.dailyTrend ?? [];
  const recent = data.recentPicks ?? [];

  return (
    <Shell>
      <Header lastUpdated={lastUpdated} freshTracking={data.freshTrackingStarted} weekRange={week ? `${week.from} → ${week.to}` : null} />

      {/* ─── Hero ──────────────────────────────────────────────────── */}
      <section className="mb-7 sm:mb-9">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <HeroCard
            kind="yesterday"
            title="Yesterday"
            metrics={yest?.overall ?? emptyMetrics()}
            subtitle={yest?.date !== null && yest?.date !== undefined ? fmtDate(yest.date) : "Awaiting first graded slate"}
            hasData={yest?.date !== null && yest?.date !== undefined && (yest?.overall.picks ?? 0) > 0}
            emptyBody="Yesterday's graded results appear after the post-game grading cycle."
          />
          <HeroCard
            kind="week"
            title="This week"
            metrics={week?.overall ?? emptyMetrics()}
            subtitle={week !== undefined ? `${fmtShortDate(week.from)} – ${fmtShortDate(week.to)}` : "—"}
            hasData={(week?.overall.picks ?? 0) > 0}
            emptyBody="Weekly trend builds as graded slates accumulate."
          />
          <HeroCard
            kind="best"
            title="Best Angle"
            metrics={data.bestAngles}
            subtitle="Strongest filtered tier"
            hasData={data.bestAngles.picks > 0}
            emptyBody="Best Angle record appears once first picks settle."
          />
          <HeroCard
            kind="pending"
            title="Pending"
            metrics={data.overall}
            subtitle="Awaiting result"
            hasData={true}
            emptyBody=""
          />
        </div>
      </section>

      {/* ─── Trend chart ──────────────────────────────────────────── */}
      <Section title="Performance trend" subtitle="Trailing 14 days — win rate per graded slate">
        <Panel>
          <TrendChart buckets={trend} />
          <DayLabelRow buckets={trend} />
        </Panel>
      </Section>

      {/* ─── Weekly module ──────────────────────────────────────── */}
      {week && (
        <Section title="This week" subtitle={`${fmtShortDate(week.from)} – ${fmtShortDate(week.to)} · wins and losses by day`}>
          <Panel>
            <DailyBars buckets={week.daily} />
            <DayLabelRow buckets={week.daily} />
            <WeeklyByMarket buckets={week.bySportMarket} />
          </Panel>
        </Section>
      )}

      {/* ─── Yesterday detail ──────────────────────────────────────── */}
      {yest?.date !== null && yest?.date !== undefined && (
        <Section title={`Yesterday — ${fmtDate(yest.date)}`} subtitle="By sport and category">
          <YesterdayDetail buckets={yest.bySportMarket} overall={yest.overall} />
        </Section>
      )}

      {/* ─── Sport × category core ──────────────────────────────────── */}
      <Section title="By sport and category" subtitle="Each model/category tracked separately — Toss-Up and Held are state counts only">
        {sportSections.length === 0 ? (
          <EmptyCard title="No category data yet" body="Sport / category records appear once the first slate has graded." />
        ) : (
          <div className="space-y-5">
            {sportSections.map((sec) => (
              <SportSection key={sec.sport} sport={sec.sport} markets={sec.markets} />
            ))}
          </div>
        )}
      </Section>

      {/* ─── Best Angle vs Lean ──────────────────────────────────── */}
      <Section title="Best Angle vs Lean" subtitle="Premium tier vs lighter calls">
        <Panel>
          <CompareBars
            rows={[
              { label: "Best Angle", metrics: data.bestAngles, color: "rgb(52 211 153)" },
              { label: "Lean",       metrics: data.leans ?? emptyMetrics(), color: "rgb(129 140 248)" },
            ]}
          />
        </Panel>
      </Section>

      {/* ─── Model version (secondary) ────────────────────────────── */}
      {data.byModelVersion && data.byModelVersion.length > 0 && (
        <Section title="By model version" subtitle="Secondary — V2.2, FI V2, legacy">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {data.byModelVersion.map((row) => (
              <ModelVersionCard key={row.label} label={prettyModelVersion(row.label)} metrics={row.metrics} />
            ))}
          </div>
        </Section>
      )}

      {/* ─── Recent picks ────────────────────────────────────────── */}
      <Section title="Recent picks" subtitle="Most recent 20 — wins, losses, and pending">
        {recent.length === 0 ? (
          <EmptyCard title="No recent picks yet" body="Recent picks appear once the first slate has run." />
        ) : (
          <div className="space-y-2">
            {recent.map((p, i) => <RecentPickCard key={`${p.slate_date}-${i}-${p.matchup}`} pick={p} />)}
          </div>
        )}
      </Section>

      {/* ─── Explainer ────────────────────────────────────────────── */}
      <Section title="What this means">
        <Panel>
          <div className="space-y-2 text-[12.5px] text-gray-300 leading-relaxed">
            <p><Tag>Model Prob</Tag> what the model thinks will happen for the picked side.</p>
            <p><Tag>Edge</Tag> model probability vs the book&apos;s no-vig price.</p>
            <p><Tag>Rec</Tag> how actionable the pick is — small or negative edge caps it.</p>
            <p><Tag>Best Angle</Tag> meaningful edge plus reliable data.</p>
            <p><Tag>Toss-Up / Held</Tag> model states, not bets — never counted as wins or losses.</p>
            <p><Tag>Push / Void</Tag> excluded from win rate; postponed games count as void.</p>
          </div>
        </Panel>
      </Section>

      {/* ─── Historical baselines (collapsed-feel) ──────────────────── */}
      {data.baselines.length > 0 && (
        <Section title="Historical baselines" subtitle="Pre-launch reference data — frozen at import">
          <Panel>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-[12px] min-w-[480px]">
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
                      <td className="py-2 px-4 sm:px-3 uppercase tracking-wide text-gray-400">{prettySport(b.sport)}</td>
                      <td className="py-2 px-3 text-gray-300">{b.source_label}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-gray-300">{b.lifetime_wins.toLocaleString()}/{b.lifetime_total.toLocaleString()}</td>
                      <td className="py-2 pr-4 sm:pr-3 text-right tabular-nums text-emerald-300/90">{b.lifetime_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </Section>
      )}

      <footer className="mt-10 text-[11px] text-gray-600 leading-relaxed">
        Win rate excludes pushes, voids, pending, Toss-Up and Held picks. Postponed and canceled games count as voids. First-inning grading requires the first-inning linescore.
      </footer>
    </Shell>
  );
}

// ─── Layout primitives ─────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-gray-100 px-4 sm:px-6 py-8" style={{ background: "radial-gradient(1100px 540px at 50% -120px, rgba(99,102,241,0.07), transparent 60%), linear-gradient(180deg, #07090f 0%, #0a0d14 100%)" }}>
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  );
}

function Header({ lastUpdated, freshTracking, weekRange }: { lastUpdated: string | null; freshTracking: boolean; weekRange: string | null }) {
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-[24px] sm:text-[30px] font-bold tracking-tight text-white" style={{ letterSpacing: "-0.025em" }}>
          Model Tracking
        </h1>
        {lastUpdated !== null && (
          <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-bold">
            Updated {new Date(lastUpdated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        )}
      </div>
      <p className="text-[13px] text-gray-400 mt-1.5 max-w-2xl leading-relaxed">
        Transparent performance by sport, market, and model version. Toss-Up and Held are model states, not bets — they never count as wins or losses.
      </p>
      {!freshTracking && (
        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/[0.08] border border-amber-500/20 text-[11px] text-amber-200/90">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          Fresh tracking starts after the first graded slate.
        </div>
      )}
      {weekRange !== null && (
        <div className="mt-2 text-[10.5px] uppercase tracking-[0.14em] text-gray-600 font-semibold">
          Trailing 7-day window
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
        {subtitle !== undefined && <p className="text-[11.5px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl px-4 py-4 sm:px-5 sm:py-5 border border-white/[0.05]"
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.012))" }}
    >
      {children}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.05] text-[10.5px] font-bold uppercase tracking-[0.1em] text-gray-200">{children}</span>;
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <Panel>
      <div className="text-center py-2">
        <div className="text-[14px] font-semibold text-gray-200">{title}</div>
        <div className="text-[12px] text-gray-500 mt-1.5">{body}</div>
      </div>
    </Panel>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────────

function HeroCard({
  kind, title, metrics, subtitle, hasData, emptyBody,
}: {
  kind: "yesterday" | "week" | "best" | "pending";
  title: string;
  metrics: Metrics;
  subtitle: string;
  hasData: boolean;
  emptyBody: string;
}) {
  const accent: Record<string, string> = {
    yesterday: "rgb(165 180 252)",
    week:      "rgb(110 231 183)",
    best:      "rgb(52 211 153)",
    pending:   "rgb(251 191 36)",
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-3.5 sm:p-4 border border-white/[0.06]"
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))" }}
    >
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${accent[kind]}, transparent)` }} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-400">{title}</span>
        <span className="text-[9.5px] uppercase tracking-[0.14em] text-gray-600 font-bold">{subtitle}</span>
      </div>
      {kind === "pending" ? (
        <>
          <div className="text-[26px] sm:text-[30px] font-black tabular-nums leading-none mt-2" style={{ color: accent[kind] }}>{metrics.pending}</div>
          <div className="text-[11px] text-gray-500 mt-1.5">awaiting result</div>
        </>
      ) : !hasData ? (
        <>
          <div className="text-[24px] sm:text-[26px] font-black text-gray-500/70 leading-none mt-2">—</div>
          <div className="text-[11px] text-gray-500 mt-1.5 leading-snug">{emptyBody}</div>
        </>
      ) : (metrics.wins + metrics.losses) === 0 && metrics.pending > 0 ? (
        // Window has picks but none have settled yet → show pending
        // count rather than a misleading 0-0 record.
        <>
          <div className="text-[26px] sm:text-[30px] font-black tabular-nums leading-none mt-2 text-gray-100">{metrics.pending}</div>
          <div className="text-[12px] tabular-nums mt-1.5" style={{ color: accent[kind] }}>
            pending · {metrics.picks} picks
          </div>
        </>
      ) : (
        <>
          <div className="text-[26px] sm:text-[30px] font-black tabular-nums leading-none mt-2 text-gray-100">{fmtRecord(metrics)}</div>
          <div className="text-[12px] tabular-nums mt-1.5" style={{ color: accent[kind] }}>
            {fmtPct(metrics)} · {metrics.picks} picks
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sport × category section ──────────────────────────────────────────

function SportSection({ sport, markets }: { sport: string; markets: SportMarketBucket[] }) {
  // For MLB, hide the rolled-up first_inning row IF we already render
  // NRFI or YRFI directly — those are the actionable ones.
  const hasNrfiOrYrfi = markets.some((m) => m.market === "nrfi" || m.market === "yrfi");
  const visible = markets.filter((m) => !(m.market === "first_inning" && hasNrfiOrYrfi));

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] uppercase tracking-[0.14em] font-bold text-white" style={{ background: "linear-gradient(180deg, rgba(99,102,241,0.55), rgba(99,102,241,0.25))" }}>
          {prettySport(sport)}
        </span>
        <span className="text-[11px] text-gray-500 tabular-nums">{visible.length} {visible.length === 1 ? "category" : "categories"}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {visible.map((b) => (
          <CategoryCard key={`${b.sport}-${b.market}`} bucket={b} />
        ))}
      </div>
    </div>
  );
}

function CategoryCard({ bucket }: { bucket: SportMarketBucket }) {
  const m = bucket.metrics;
  const dec = m.wins + m.losses;
  const pct = m.win_pct ?? 0;
  return (
    <div className="rounded-2xl p-4 border border-white/[0.05]" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.012))" }}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-gray-300">{prettyMarket(bucket.market)}</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.14em] font-bold bg-white/[0.04] border border-white/[0.05] text-gray-400">{shortMarket(bucket.market)}</span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-600">{m.picks} picks</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-3">
        <span className="text-[22px] tabular-nums font-black text-gray-100 leading-none">{m.picks === 0 ? "—" : fmtRecord(m)}</span>
        <span className="text-[14px] tabular-nums font-bold text-emerald-300/90 leading-none">{fmtPct(m)}</span>
      </div>
      {dec > 0 && (
        <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
          <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
      <div className="mt-2 text-[10.5px] tabular-nums text-gray-500">
        {m.pending > 0 ? `${m.pending} pending` : "—"}
        {m.pushes > 0 ? ` · ${m.pushes} push` : ""}
        {m.voids > 0 ? ` · ${m.voids} void` : ""}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <SubMetric label="Best Angle" metrics={bucket.bestAngles} color="rgb(52 211 153)" />
        <SubMetric label="Lean"       metrics={bucket.leans}       color="rgb(129 140 248)" />
      </div>
    </div>
  );
}

function SubMetric({ label, metrics, color }: { label: string; metrics: Metrics; color: string }) {
  const dec = metrics.wins + metrics.losses;
  return (
    <div className="rounded-lg px-2.5 py-2 bg-white/[0.02] border border-white/[0.04]">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold" style={{ color }}>{label}</span>
        <span className="text-[10px] tabular-nums text-gray-500">{metrics.picks}</span>
      </div>
      <div className="mt-1 text-[14px] tabular-nums font-extrabold text-gray-100 leading-none">{metrics.picks === 0 ? "—" : fmtRecord(metrics)}</div>
      <div className="mt-1 text-[10px] tabular-nums text-gray-500">
        {dec > 0 ? fmtPct(metrics) : metrics.pending > 0 ? `${metrics.pending} pend` : "—"}
      </div>
    </div>
  );
}

// ─── Weekly module helpers ────────────────────────────────────────────

function DayLabelRow({ buckets }: { buckets: DailyBucket[] }) {
  // Show first / mid / last labels under the chart to give time context
  // without crowding the SVG.
  if (buckets.length === 0) return null;
  const first = buckets[0];
  const mid = buckets[Math.floor(buckets.length / 2)];
  const last = buckets[buckets.length - 1];
  return (
    <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.14em] text-gray-600 font-semibold tabular-nums px-1">
      <span>{fmtShortDate(first.date)}</span>
      {buckets.length >= 4 && <span>{fmtShortDate(mid.date)}</span>}
      <span>{fmtShortDate(last.date)}</span>
    </div>
  );
}

function WeeklyByMarket({ buckets }: { buckets: SportMarketBucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <div className="mt-4 pt-4 border-t border-white/[0.04]">
      <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500 mb-2">This week by category</div>
      <div className="space-y-2">
        {buckets.map((b) => {
          const m = b.metrics;
          const dec = m.wins + m.losses;
          const pct = m.win_pct ?? 0;
          return (
            <div key={`${b.sport}-${b.market}`} className="flex items-center gap-3">
              <span className="w-14 text-[10.5px] uppercase tracking-[0.12em] font-bold text-gray-400 shrink-0">{prettySport(b.sport)}</span>
              <span className="w-14 text-[10.5px] uppercase tracking-[0.12em] font-bold text-gray-500 shrink-0">{shortMarket(b.market)}</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                {dec > 0 && (
                  <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${Math.min(100, pct)}%` }} />
                )}
              </div>
              <span className="w-20 text-right text-[10.5px] tabular-nums text-gray-300 shrink-0">{m.picks === 0 ? "—" : `${fmtRecord(m)} · ${fmtPct(m)}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Yesterday detail ──────────────────────────────────────────────────

function YesterdayDetail({ buckets, overall }: { buckets: SportMarketBucket[]; overall: Metrics }) {
  if (buckets.length === 0) {
    return <EmptyCard title="No graded picks for yesterday yet" body="Once post-game grading completes, yesterday's category breakdown lands here." />;
  }
  buckets = [...buckets].sort((a, b) => {
    const s = (SPORT_ORDER[a.sport] ?? 99) - (SPORT_ORDER[b.sport] ?? 99);
    if (s !== 0) return s;
    return (MARKET_ORDER[a.market] ?? 99) - (MARKET_ORDER[b.market] ?? 99);
  });
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500">Day total</div>
          <div className="text-[22px] tabular-nums font-black text-gray-100 leading-none mt-1">{fmtRecord(overall)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500">Win rate</div>
          <div className="text-[18px] tabular-nums font-extrabold text-emerald-300/90 leading-none mt-1">{fmtPct(overall)}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {buckets.map((b) => (
          <div key={`${b.sport}-${b.market}`} className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-300">{prettySport(b.sport)}</span>
                <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500">{shortMarket(b.market)}</span>
              </div>
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-600 font-bold">{b.metrics.picks} picks</span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[15px] tabular-nums font-extrabold text-gray-100 leading-none">{fmtRecord(b.metrics)}</span>
              <span className="text-[11.5px] tabular-nums font-bold text-emerald-300/90">{fmtPct(b.metrics)}</span>
            </div>
            {(b.bestAngles.picks > 0 || b.leans.picks > 0) && (
              <div className="mt-1.5 text-[10.5px] tabular-nums text-gray-500">
                {b.bestAngles.picks > 0 && <span>BA {fmtRecord(b.bestAngles)} · </span>}
                {b.leans.picks > 0 && <span>Lean {fmtRecord(b.leans)}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Model version card ──────────────────────────────────────────────

function ModelVersionCard({ label, metrics }: { label: string; metrics: Metrics }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-[0.14em] font-bold text-gray-400">{label}</div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-[18px] tabular-nums font-extrabold text-gray-100 leading-none">{metrics.picks === 0 ? "—" : fmtRecord(metrics)}</span>
        <span className="text-[13px] tabular-nums font-bold text-emerald-300/90 leading-none">{fmtPct(metrics)}</span>
      </div>
      <div className="mt-1.5 text-[10.5px] tabular-nums text-gray-500">
        {metrics.picks} picks{metrics.pending > 0 ? ` · ${metrics.pending} pending` : ""}
      </div>
    </div>
  );
}

// ─── Recent pick card ────────────────────────────────────────────────

function RecentPickCard({ pick }: { pick: RecentPickRow }) {
  const isStateOnly = pick.play_grade === "toss_up" || pick.held === true;
  const result = isStateOnly ? (pick.held ? "held" : "toss_up") : pick.result;

  const resultStyles: Record<string, { label: string; bg: string; fg: string }> = {
    win:     { label: "Win",     bg: "rgba(52,211,153,0.12)",  fg: "rgb(52 211 153)" },
    loss:    { label: "Loss",    bg: "rgba(244,114,182,0.10)", fg: "rgb(244 114 182)" },
    push:    { label: "Push",    bg: "rgba(148,163,184,0.10)", fg: "rgb(148 163 184)" },
    void:    { label: "Void",    bg: "rgba(148,163,184,0.10)", fg: "rgb(148 163 184)" },
    pending: { label: "Pending", bg: "rgba(251,191,36,0.10)",  fg: "rgb(251 191 36)" },
    toss_up: { label: "Toss-Up", bg: "rgba(148,163,184,0.10)", fg: "rgb(148 163 184)" },
    held:    { label: "Held",    bg: "rgba(148,163,184,0.10)", fg: "rgb(148 163 184)" },
  };
  const rs = resultStyles[result];

  // Score / FI line
  let scoreLine = "";
  if (pick.market === "moneyline" || pick.market === "total" || pick.market === "spread") {
    if (pick.actual_away_score !== null && pick.actual_home_score !== null) {
      scoreLine = `${pick.actual_away_score}–${pick.actual_home_score}`;
    }
  } else if (pick.market === "nrfi" || pick.market === "yrfi" || pick.market === "first_inning") {
    if (pick.actual_first_inning_runs !== null) {
      scoreLine = `${pick.actual_first_inning_runs} 1st-inning ${pick.actual_first_inning_runs === 1 ? "run" : "runs"}`;
    }
  }

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 sm:p-3.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-gray-500 tabular-nums">{fmtShortDate(pick.slate_date)}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.05] text-gray-400">{prettySport(pick.sport)}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.05] text-gray-400">{shortMarket(pick.market)}</span>
        {pick.best_angle && <span className="text-[10px] uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded bg-emerald-500/[0.08] border border-emerald-500/20 text-emerald-300">Best Angle</span>}
        {pick.play_grade === "lean" && <span className="text-[10px] uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded bg-indigo-500/[0.08] border border-indigo-500/20 text-indigo-300">Lean</span>}
        <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.14em] font-bold" style={{ background: rs.bg, color: rs.fg, border: `1px solid ${rs.fg}33` }}>
          {rs.label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[13px] sm:text-[14px] font-semibold text-gray-100 truncate max-w-full">
          {pick.matchup}
        </div>
        {scoreLine !== "" && <span className="text-[11px] tabular-nums text-gray-400 font-semibold">{scoreLine}</span>}
      </div>
      <div className="mt-0.5 text-[11.5px] text-gray-400 flex items-center gap-2 flex-wrap">
        {pick.pick !== null && <span className="font-semibold text-gray-300">{pick.pick}</span>}
        {pick.model_version !== null && <span className="text-[10.5px] uppercase tracking-[0.1em] text-gray-600 font-bold">· {prettyModelVersion(pick.model_version)}</span>}
      </div>
    </div>
  );
}
