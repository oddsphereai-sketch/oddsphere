/**
 * Phase 6B.2e — Tracking page product design reset.
 *
 * The 2b → 2c → 2d sequence stacked modules on top of modules.
 * This pass throws that out and builds the page around a single
 * idea: a member should be able to scan how each category is
 * performing without their eyes hopping between disconnected
 * card grids.
 *
 * Final structure (locked in the brief):
 *   1. Header (no hero metrics)
 *   2. Yesterday — category list, not cards
 *   3. This week — single chart, category-comparison bars
 *   4. Best Angles — category list, not cards
 *   5. Recent results — stacked cards
 *   6. Method — combined glossary, baselines,
 *      tiny "all tracked actionable picks" footer
 *
 * Hard rules unchanged from earlier passes:
 *   • Toss-Up and Held are NEVER counted as wins or losses.
 *   • No Bet / stand-downs with a real side DO count in the main
 *     prediction-accuracy win rate; they are only excluded from
 *     recommendation-performance cuts like Best Angle / Lean.
 *   • Pushes / voids / pending always surfaced separately.
 *   • Empty / low-sample states render honest copy.
 *   • NRFI and YRFI are first-class, never hidden behind a
 *     blended First Inning rollup.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import { CategoryBars, type ChartMetrics } from "./components/TrackingCharts";

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
  result: "win" | "loss" | "push" | "void" | "pending";
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_first_inning_runs: number | null;
  best_angle: boolean;
  held: boolean;
};

type RecentlySettledRow = {
  slate_date: string;
  sport: string;
  market: string;
  matchup: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  play_grade: string | null;
  best_angle: boolean;
  result: "win" | "loss" | "push" | "void";
  win: boolean;
  loss: boolean;
  push: boolean;
  void: boolean;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_first_inning_runs: number | null;
  graded_at: string | null;
  grade_notes: string | null;
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
  byMarket: DimensionRow[];
  bySportMarket?: SportMarketBucket[];
  bestAngles: Metrics;
  leans?: Metrics;
  yesterday?: { date: string | null; overall: Metrics; bySportMarket: SportMarketBucket[] };
  thisWeek?: { from: string; to: string; overall: Metrics; bySportMarket: SportMarketBucket[] };
  thisMonth?: { from: string; to: string; overall: Metrics; bySportMarket: SportMarketBucket[] };
  recentPicks?: RecentPickRow[];
  recentlySettled?: RecentlySettledRow[];
  tablesInitialized: boolean;
  freshTrackingStarted: boolean;
  generatedAt?: string;
  trackingCacheStatus?: "hit" | "miss" | "stale" | "error";
};

// ─── Constants ─────────────────────────────────────────────────────────

const SPORT_LABEL: Record<string, string> = {
  mlb: "MLB", wnba: "WNBA", nfl: "NFL", nba: "NBA", nhl: "NHL", cfb: "CFB", cbb: "CBB", ucl: "UCL",
  // Soccer surfaces in tracking as "World Cup" — UCL keeps its own label
  // above. When a non-WC competition launches, the competition column on
  // prediction_records (see project-wc-launch-contract) is the planned
  // discriminator; today the tracker only filters by sport so soccer is
  // a 1:1 stand-in for the WC tab.
  soccer: "World Cup",
};

const MARKET_LABEL: Record<string, string> = {
  moneyline: "Moneyline",
  match_result: "Match Result",
  total: "Over / Under",
  btts: "BTTS",
  first_inning: "First Inning",
  nrfi: "NRFI",
  yrfi: "YRFI",
  spread: "Spread",
  double_chance: "Double Chance",
};

const MARKET_SHORT: Record<string, string> = {
  moneyline: "ML", match_result: "Match", total: "O/U", btts: "BTTS", first_inning: "FI", nrfi: "NRFI", yrfi: "YRFI", spread: "ATS", double_chance: "DC",
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

// MLB order: ML, O/U, NRFI, YRFI. first_inning rollup goes last.
const MARKET_ORDER: Record<string, number> = {
  moneyline: 1, match_result: 1, total: 2, nrfi: 3, yrfi: 4, first_inning: 5, spread: 6, double_chance: 7, btts: 8,
};

const SPORT_ORDER: Record<string, number> = {
  mlb: 1,
  nba: 2, cbb: 3, wnba: 4,
  nfl: 5, cfb: 6,
  nhl: 7,
  soccer: 8, ucl: 9,
};

// ─── Format helpers ────────────────────────────────────────────────────

function fmtRecord(m: Metrics): string {
  return `${m.wins}-${m.losses}${m.pushes > 0 ? `-${m.pushes}` : ""}`;
}
function fmtPct(m: Metrics): string | null {
  if (m.win_pct === null) return null;
  return `${m.win_pct.toFixed(1)}%`;
}
function fmtLongDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtShortDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function prettyMarket(label: string): string { return MARKET_LABEL[label] ?? label; }
function shortMarket(label: string): string { return MARKET_SHORT[label] ?? label.toUpperCase(); }
function prettySport(label: string): string { return SPORT_LABEL[label] ?? label.toUpperCase(); }

// Drop the rolled-up first_inning bucket when NRFI or YRFI is present —
// those are the actionable categories and first_inning would otherwise
// double-count them in the page view.
function visibleBuckets(buckets: SportMarketBucket[]): SportMarketBucket[] {
  const hasNrfiOrYrfi = buckets.some((b) => b.market === "nrfi" || b.market === "yrfi");
  const out = buckets.filter((b) => !(b.market === "first_inning" && hasNrfiOrYrfi));
  out.sort((a, b) => {
    const s = (SPORT_ORDER[a.sport] ?? 99) - (SPORT_ORDER[b.sport] ?? 99);
    if (s !== 0) return s;
    return (MARKET_ORDER[a.market] ?? 99) - (MARKET_ORDER[b.market] ?? 99);
  });
  return out;
}

// ─── Lifetime record merge ─────────────────────────────────────────────
/**
 * Single source-of-truth shape for the Lifetime Tracking section.
 *
 * Phase 6B.24 fix — when both a stored baseline AND live tracked picks
 * exist for the same category, MERGE them. Previously the page picked
 * one or the other, which silently discarded the live record under the
 * baseline (NRFI/YRFI showed only history) or discarded the baseline
 * under the live record (ML/OU showed only today's picks despite years
 * of historical baseline). Source type values:
 *
 *   "lifetime_merged"   — baseline + live decided picks combined.
 *   "lifetime_baseline" — only the imported historical baseline so far
 *                         (no live decided picks yet today).
 *   "since_launch"      — only live tracked picks (no baseline exists
 *                         for this category yet); label makes this
 *                         clear so members don't mistake "5-2 (71%)"
 *                         for an all-time lifetime number.
 */
type LifetimeRecord = {
  sport: string;
  market: string;
  source_type: "lifetime_merged" | "lifetime_baseline" | "since_launch";
  /** Display text for the record column. e.g. "1719/3043" or "5-2". */
  display_record: string;
  /** Display text for the win-rate column. e.g. "56.5%" or null. */
  display_pct: string | null;
  /** Total sample size for sort + footer rendering. */
  display_total: number;
  /** Only populated when live contributes. */
  pending: number;
  pushes: number;
  voids: number;
  /** How many of the live wins / losses are merged in (0 when none). */
  live_decided_contribution: number;
  /** Numeric record used by the same category chart as weekly/monthly. */
  metrics: Metrics;
  bestAngles?: Metrics;
  leans?: Metrics;
};

function buildLifetimeRecords(
  bySportMarket: SportMarketBucket[],
  baselines: BaselineRow[],
): LifetimeRecord[] {
  const baseIdx = new Map<string, BaselineRow>();
  for (const b of baselines) baseIdx.set(`${b.sport}:${b.market}`, b);
  const liveIdx = new Map<string, SportMarketBucket>();
  for (const b of bySportMarket) liveIdx.set(`${b.sport}:${b.market}`, b);

  const keys = new Set<string>([...baseIdx.keys(), ...liveIdx.keys()]);
  const records: LifetimeRecord[] = [];
  for (const key of keys) {
    const [sport, market] = key.split(":");
    const base = baseIdx.get(key);
    const live = liveIdx.get(key);
    const liveDecided = (live?.metrics.wins ?? 0) + (live?.metrics.losses ?? 0);
    const liveWins = live?.metrics.wins ?? 0;
    const livePending = live?.metrics.pending ?? 0;

    if (base !== undefined && liveDecided > 0) {
      // MERGED — baseline + live decided picks combined.
      const mergedWins = base.lifetime_wins + liveWins;
      const mergedTotal = base.lifetime_total + liveDecided;
      const mergedPct = mergedTotal > 0 ? (mergedWins / mergedTotal) * 100 : 0;
      records.push({
        sport, market,
        source_type: "lifetime_merged",
        display_record: `${mergedWins.toLocaleString()}/${mergedTotal.toLocaleString()}`,
        display_pct: `${mergedPct.toFixed(1)}%`,
        display_total: mergedTotal,
        pending: livePending,
        pushes: live?.metrics.pushes ?? 0,
        voids: live?.metrics.voids ?? 0,
        live_decided_contribution: liveDecided,
        metrics: {
          picks: mergedTotal,
          wins: mergedWins,
          losses: mergedTotal - mergedWins,
          pushes: live?.metrics.pushes ?? 0,
          voids: live?.metrics.voids ?? 0,
          pending: livePending,
          win_pct: mergedPct,
        },
        bestAngles: live?.bestAngles,
        leans: live?.leans,
      });
    } else if (base !== undefined) {
      // Baseline only — live has no decided picks yet for this category.
      records.push({
        sport, market,
        source_type: "lifetime_baseline",
        display_record: `${base.lifetime_wins.toLocaleString()}/${base.lifetime_total.toLocaleString()}`,
        display_pct: `${base.lifetime_pct.toFixed(1)}%`,
        display_total: base.lifetime_total,
        pending: livePending,
        pushes: 0,
        voids: 0,
        live_decided_contribution: 0,
        metrics: {
          picks: base.lifetime_total,
          wins: base.lifetime_wins,
          losses: base.lifetime_total - base.lifetime_wins,
          pushes: 0,
          voids: 0,
          pending: livePending,
          win_pct: base.lifetime_pct,
        },
        bestAngles: live?.bestAngles,
        leans: live?.leans,
      });
    } else if (live !== undefined && liveDecided > 0) {
      // No baseline — live-only "since launch" record. Label clearly so
      // members don't read this as all-time history.
      records.push({
        sport, market,
        source_type: "since_launch",
        display_record: fmtRecord(live.metrics),
        display_pct: fmtPct(live.metrics),
        display_total: live.metrics.picks,
        pending: livePending,
        pushes: live.metrics.pushes,
        voids: live.metrics.voids,
        live_decided_contribution: liveDecided,
        metrics: live.metrics,
        bestAngles: live.bestAngles,
        leans: live.leans,
      });
    } else if (live !== undefined && live.metrics.pending > 0) {
      // Nothing decided yet for this category — surface the pending count
      // so members know the slate's live but nothing has settled.
      records.push({
        sport, market,
        source_type: "since_launch",
        display_record: `${live.metrics.pending} pending`,
        display_pct: null,
        display_total: live.metrics.pending,
        pending: live.metrics.pending,
        pushes: 0,
        voids: 0,
        live_decided_contribution: 0,
        metrics: live.metrics,
        bestAngles: live.bestAngles,
        leans: live.leans,
      });
    }
  }

  // MLB: drop the rolled-up first_inning row when NRFI and YRFI are
  // both first-class so we don't double-render the same picks.
  const mlbHasNrfiYrfi =
    records.some((r) => r.sport === "mlb" && r.market === "nrfi") &&
    records.some((r) => r.sport === "mlb" && r.market === "yrfi");
  const filtered = records.filter((r) => !(r.sport === "mlb" && r.market === "first_inning" && mlbHasNrfiYrfi));

  filtered.sort((a, b) => {
    const s = (SPORT_ORDER[a.sport] ?? 99) - (SPORT_ORDER[b.sport] ?? 99);
    if (s !== 0) return s;
    return (MARKET_ORDER[a.market] ?? 99) - (MARKET_ORDER[b.market] ?? 99);
  });

  return filtered;
}

// ─── Component ─────────────────────────────────────────────────────────

export default function LabTrackingPage() {
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35000);
    fetch("/api/lab/tracking-foundation", {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null) as { error?: string; detail?: string } | null;
          const detail = body?.detail || body?.error || `HTTP ${r.status}`;
          throw new Error(detail);
        }
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLastUpdated(typeof d.generatedAt === "string" ? d.generatedAt : new Date().toISOString());
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") {
          setError("Tracking data is taking too long to respond. Please refresh in a moment.");
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        setError(/timed out|522|temporarily_unavailable|failed to fetch|network/i.test(message)
          ? "The data service is taking too long to respond. Please refresh in a moment."
          : message);
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const yesterdayRows = useMemo(() => visibleBuckets(data?.yesterday?.bySportMarket ?? []), [data]);
  const weekRows      = useMemo(() => visibleBuckets(data?.thisWeek?.bySportMarket ?? []),  [data]);
  const monthRows     = useMemo(() => visibleBuckets(data?.thisMonth?.bySportMarket ?? []), [data]);
  // Window tab for the category-tracking section (Weekly / Monthly / Lifetime).
  const [trackWindow, setTrackWindow] = useState<"weekly" | "monthly" | "lifetime">("weekly");
  // Lifetime Tracking: ONE record per (sport, market). Live automated
  // data takes precedence when decided > 0; otherwise the stored
  // baseline number stands in. Non-MLB sports currently always fall
  // back to baseline — they get treated as first-class Lifetime
  // Tracking rows, not as a "legacy" surface (which would mislead
  // members into thinking they're separate frozen reference data).
  const lifetimeRecords = useMemo(
    () => buildLifetimeRecords(data?.bySportMarket ?? [], data?.baselines ?? []),
    [data],
  );
  // Best Angles still derived from live joint sport+market buckets —
  // it's strictly a live concept (premium tier), so we don't fall
  // back to baselines here.
  const bestAngleRows = useMemo(() => {
    return visibleBuckets(data?.bySportMarket ?? []).filter((b) => b.bestAngles.picks > 0 || b.leans.picks > 0);
  }, [data]);

  if (error !== null) {
    return <Shell><div className="text-amber-300/90 max-w-md">Tracking is temporarily unavailable. {error}</div></Shell>;
  }
  if (data === null) {
    return <Shell><div className="text-gray-400">Loading tracking…</div></Shell>;
  }
  if (!data.tablesInitialized) {
    return (
      <Shell>
        <Header lastUpdated={lastUpdated} />
        <div className="mt-10 rounded-2xl border border-white/[0.05] p-8 text-center" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.012))" }}>
          <div className="text-[16px] font-semibold text-gray-100">Tracking is initializing</div>
          <div className="text-[12.5px] text-gray-400 mt-2">Performance records appear here once the system has graded its first slate.</div>
        </div>
      </Shell>
    );
  }

  const yest = data.yesterday;
  const week = data.thisWeek;
  const recent = (data.recentPicks ?? []).slice(0, 12);
  const settled = (data.recentlySettled ?? []).slice(0, 12);

  return (
    <Shell>
      <Header lastUpdated={lastUpdated} />

      {/* ── 1. YESTERDAY ─────────────────────────────────────────────── */}
      <Section
        eyebrow={yest?.date !== null && yest?.date !== undefined ? fmtLongDate(yest.date) : "Yesterday"}
        title="Yesterday's results"
      >
        <YesterdayBoard date={yest?.date ?? null} rows={yesterdayRows} overall={yest?.overall ?? null} />
      </Section>

      {/* ── 2. TRACKING BY CATEGORY (Weekly / Monthly / Lifetime) ────── */}
      <Section
        eyebrow={
          trackWindow === "weekly"
            ? (week !== undefined ? `${fmtShortDate(week.from)} → ${fmtShortDate(week.to)}` : "This week")
            : trackWindow === "monthly"
              ? (data.thisMonth !== undefined ? `${fmtShortDate(data.thisMonth.from)} → ${fmtShortDate(data.thisMonth.to)}` : "Last 30 days")
              : "All-time"
        }
        title="Tracking by category"
      >
        <WindowTabs active={trackWindow} onChange={setTrackWindow} />
        <div className="mt-3.5">
          {trackWindow === "lifetime" ? (
            <LifetimeTrackingBoard records={lifetimeRecords} />
          ) : (
            <Card>
              <CategoryBars
                rows={(trackWindow === "weekly" ? weekRows : monthRows).map((b) => ({
                  label: `${prettySport(b.sport)} ${prettyMarket(b.market)}`,
                  sublabel: shortMarket(b.market),
                  metrics: b.metrics,
                }))}
                emptyBody={
                  trackWindow === "weekly"
                    ? "Weekly category comparison appears once this week's picks have graded."
                    : "Monthly category comparison appears once the last 30 days have graded."
                }
              />
            </Card>
          )}
        </div>
      </Section>

      {/* ── 4. BEST ANGLES ───────────────────────────────────────────── */}
      <Section
        eyebrow="Premium tier"
        title="Best Angles by category"
      >
        <BestAnglesBoard rows={bestAngleRows} />
      </Section>

      {/* ── 5. LATEST RESULTS (settled feed, ordered by graded_at) ───── */}
      <Section
        eyebrow="As they grade"
        title="Latest Results"
      >
        {settled.length === 0 ? (
          <Card>
            <Empty body="Latest Results populate as picks grade — FI rows after the first inning, ML / O/U at final." />
          </Card>
        ) : (
          <div className="space-y-2">
            {settled.map((p, i) => <RecentlySettledCard key={`set-${p.graded_at ?? p.slate_date}-${i}-${p.matchup}`} pick={p} />)}
          </div>
        )}
      </Section>

      {/* ── 6. RECENT PREDICTIONS ────────────────────────────────────── */}
      <Section
        eyebrow="Latest activity"
        title="Recent Predictions"
      >
        {recent.length === 0 ? (
          <Card>
            <Empty body="Recent predictions appear once the first slate has run." />
          </Card>
        ) : (
          <div className="space-y-2">
            {recent.map((p, i) => <RecentPickCard key={`${p.slate_date}-${i}-${p.matchup}`} pick={p} />)}
          </div>
        )}
      </Section>

      {/* ── 5. METHOD (combined) ─────────────────────────────────────── */}
      <Section eyebrow="Reference" title="Method">
        <Card>
          <Glossary />
          <MethodDivider />
          <AllActionableFooter overall={data.overall} bestAngles={data.bestAngles} leans={data.leans} />
        </Card>
      </Section>

      <footer className="mt-10 pt-6 border-t border-white/[0.04] text-[11px] text-gray-600 leading-relaxed">
        Win rate excludes pushes, voids, pending, Toss-Up and Held picks. Sided No Play stand-downs still count for prediction accuracy. Postponed and canceled games count as voids. First-inning grading requires the first-inning linescore.
      </footer>
    </Shell>
  );
}

// ─── Layout primitives ─────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen text-gray-100 px-4 sm:px-6 lg:px-8 py-8 sm:py-10"
      style={{ background: "radial-gradient(1200px 600px at 50% -180px, rgba(99,102,241,0.07), transparent 60%), linear-gradient(180deg, #06080d 0%, #0a0d14 100%)" }}
    >
      <div className="max-w-4xl mx-auto">{children}</div>
    </div>
  );
}

function Header({ lastUpdated }: { lastUpdated: string | null }) {
  return (
    <header className="mb-9 sm:mb-12">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight text-white" style={{ letterSpacing: "-0.025em" }}>
          Prediction Tracking
        </h1>
        {lastUpdated !== null && (
          <span className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-bold">
            Updated {new Date(lastUpdated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        )}
      </div>
      <p className="text-[14px] text-gray-300 mt-2 max-w-2xl leading-relaxed font-medium">
        Performance by sport, market, and prediction type.
      </p>
      <p className="text-[12px] text-gray-500 mt-1.5 max-w-2xl leading-relaxed">
        Records update after games are graded. Every sided prediction counts; Toss-Up and Held are not counted as wins or losses.
      </p>
    </header>
  );
}

function Section({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 sm:mb-14">
      <div className="mb-3.5 flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[17px] sm:text-[19px] font-bold text-gray-50" style={{ letterSpacing: "-0.012em" }}>{title}</h2>
        {eyebrow !== undefined && (
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-gray-500 ml-auto sm:ml-0">{eyebrow}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function WindowTabs({
  active,
  onChange,
}: {
  active: "weekly" | "monthly" | "lifetime";
  onChange: (w: "weekly" | "monthly" | "lifetime") => void;
}) {
  const tabs: { key: "weekly" | "monthly" | "lifetime"; label: string }[] = [
    { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" },
    { key: "lifetime", label: "Lifetime" },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-pressed={on}
            className={
              "px-3 sm:px-4 py-1.5 rounded-md text-[11px] sm:text-[12px] uppercase tracking-[0.12em] font-bold transition-colors " +
              (on
                ? "bg-indigo-500/[0.18] text-indigo-100 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.25)]"
                : "text-gray-400 hover:text-gray-200")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border border-white/[0.05] p-4 sm:p-5"
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.012))" }}
    >
      {children}
    </div>
  );
}

function Empty({ body }: { body: string }) {
  return (
    <div className="rounded-lg bg-white/[0.012] border border-dashed border-white/[0.05] py-6 px-4 text-center text-[12px] text-gray-500/85 leading-relaxed">
      {body}
    </div>
  );
}

// ─── Lifetime tracking board — shared visual, honest merged source ─────

function lifetimeSourceLabel(record: LifetimeRecord): string {
  if (record.source_type === "lifetime_merged") {
    return `Lifetime · live +${record.live_decided_contribution}`;
  }
  return record.source_type === "since_launch" ? "Since launch" : "Lifetime";
}

function LifetimeTrackingBoard({ records }: { records: LifetimeRecord[] }) {
  return (
    <Card>
      <CategoryBars
        rows={records.map((record) => ({
          label: `${prettySport(record.sport)} ${prettyMarket(record.market)}`,
          sublabel: `${shortMarket(record.market)} · ${lifetimeSourceLabel(record)}`,
          group: record.sport,
          metrics: record.metrics,
        }))}
        emptyBody="Lifetime records appear here as predictions settle and sport tracking comes online."
      />
      <p className="mt-4 border-t border-white/[0.05] pt-3 text-[11px] leading-relaxed text-gray-500">
        MLB updates automatically as games grade. Other sports are maintained as their models come online.
      </p>
    </Card>
  );
}

// ─── Yesterday board — category list (NOT cards) ───────────────────────

function YesterdayBoard({ date, rows, overall }: { date: string | null; rows: SportMarketBucket[]; overall: Metrics | null }) {
  if (date === null || rows.length === 0) {
    return (
      <Card>
        <Empty body="Yesterday's results are pending grading. Records appear once the post-game grading cycle has run." />
      </Card>
    );
  }
  const decided = (overall?.wins ?? 0) + (overall?.losses ?? 0);
  const allPending = decided === 0 && (overall?.pending ?? 0) > 0;
  return (
    <Card>
      <ul className="divide-y divide-white/[0.04] -my-2">
        {rows.map((b) => (
          <li key={`${b.sport}-${b.market}`} className="py-3 first:pt-0 last:pb-0">
            <CategoryListRow bucket={b} />
          </li>
        ))}
      </ul>
      {overall !== null && (
        <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-gray-500">Day total</span>
          {allPending ? (
            <span className="text-[12.5px] tabular-nums text-gray-300 font-semibold">{overall.pending} pending</span>
          ) : (
            <span className="text-[12.5px] tabular-nums text-gray-300 font-semibold">
              {fmtRecord(overall)}{fmtPct(overall) !== null ? ` · ${fmtPct(overall)}` : ""}
              {overall.pending > 0 ? ` · ${overall.pending} pending` : ""}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

// One row per category. Two visual zones:
//   top    — sport pill · category name · short badge · record · win-rate
//   bottom — Best Angle · Lean · pending / pushes / voids
// The bottom zone is suppressed when none of the sub-stats are populated.
function CategoryListRow({ bucket }: { bucket: SportMarketBucket }) {
  const m = bucket.metrics;
  const decided = m.wins + m.losses;
  const allPending = decided === 0 && m.pending > 0;
  const hasSubStats =
    bucket.bestAngles.picks > 0 ||
    bucket.leans.picks > 0 ||
    (!allPending && m.pending > 0) ||
    m.pushes > 0 ||
    m.voids > 0;

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <SportPill sport={bucket.sport} />
        <span className="text-[14.5px] sm:text-[15.5px] font-semibold text-gray-50">{prettyMarket(bucket.market)}</span>
        <CategoryBadge market={bucket.market} />
        </div>
        <div className="flex w-full items-baseline justify-between gap-3 tabular-nums sm:ml-auto sm:w-auto sm:justify-start sm:gap-4">
          {allPending ? (
            <>
              <span className="text-[19px] sm:text-[20px] font-extrabold text-gray-50 leading-none">{m.pending}</span>
              <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-amber-300/85 leading-none">pending</span>
            </>
          ) : (
            <>
              <span className="text-[19px] sm:text-[20px] font-extrabold text-gray-50 leading-none">{fmtRecord(m)}</span>
              <span className="text-[13px] font-bold text-emerald-300/95 leading-none">{fmtPct(m) ?? "—"}</span>
            </>
          )}
        </div>
      </div>
      {hasSubStats && (
        <div className="mt-2 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] tabular-nums">
          <SubChip label="Best Angle" m={bucket.bestAngles} color="rgb(110 231 183)" />
          <SubChip label="Lean"       m={bucket.leans}       color="rgb(165 180 252)" />
          {m.pending > 0 && !allPending && (
            <span className="text-gray-500"><span className="text-gray-400 font-semibold">{m.pending}</span> pending</span>
          )}
          {m.pushes > 0 && <span className="text-gray-500"><span className="text-gray-400 font-semibold">{m.pushes}</span> push</span>}
          {m.voids > 0 && <span className="text-gray-500"><span className="text-gray-400 font-semibold">{m.voids}</span> void</span>}
        </div>
      )}
    </div>
  );
}

function SubChip({ label, m, color }: { label: string; m: Metrics; color: string }) {
  if (m.picks === 0) {
    return (
      <span className="tabular-nums text-gray-600">
        <span className="font-semibold" style={{ color, opacity: 0.55 }}>{label}</span> —
      </span>
    );
  }
  const decided = m.wins + m.losses;
  return (
    <span className="tabular-nums text-gray-400">
      <span className="font-semibold" style={{ color }}>{label}</span>{" "}
      <span className="text-gray-100 font-bold">{fmtRecord(m)}</span>
      {decided > 0 && <span className="text-gray-500"> · {fmtPct(m) ?? ""}</span>}
      {decided === 0 && m.pending > 0 && <span className="text-gray-500"> · {m.pending} pend</span>}
    </span>
  );
}

function SportPill({ sport }: { sport: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] uppercase tracking-[0.14em] font-bold text-white shrink-0"
      style={{ background: "linear-gradient(180deg, rgba(99,102,241,0.6), rgba(99,102,241,0.3))" }}
    >
      {prettySport(sport)}
    </span>
  );
}

function CategoryBadge({ market }: { market: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] uppercase tracking-[0.14em] font-bold bg-white/[0.04] border border-white/[0.05] text-gray-400 shrink-0">
      {shortMarket(market)}
    </span>
  );
}

// ─── Best Angles board ────────────────────────────────────────────────

function BestAnglesBoard({ rows }: { rows: SportMarketBucket[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <Empty body="Best Angles are surfaced per category once the first ones have graded. Yesterday's Best Angles are visible above as soon as games settle." />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-white/[0.04] -my-2">
        {rows.map((b) => {
          const ba = b.bestAngles;
          const le = b.leans;
          const baDecided = ba.wins + ba.losses;
          const leDecided = le.wins + le.losses;
          return (
            <li key={`${b.sport}-${b.market}`} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                <SportPill sport={b.sport} />
                <span className="text-[14px] font-semibold text-gray-100">{prettyMarket(b.market)}</span>
                <CategoryBadge market={b.market} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <BestAnglesPanel
                  label="Best Angle"
                  color="rgb(52 211 153)"
                  metrics={ba}
                  decided={baDecided}
                />
                <BestAnglesPanel
                  label="Lean"
                  color="rgb(129 140 248)"
                  metrics={le}
                  decided={leDecided}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function BestAnglesPanel({ label, color, metrics, decided }: { label: string; color: string; metrics: Metrics; decided: number }) {
  const nonDecisionCount = metrics.pending + metrics.pushes + metrics.voids;
  const nonDecisionParts = [
    metrics.pending > 0 ? `${metrics.pending} pending` : null,
    metrics.pushes > 0 ? `${metrics.pushes} push` : null,
    metrics.voids > 0 ? `${metrics.voids} void` : null,
  ].filter(Boolean);
  return (
    <div className="rounded-lg bg-white/[0.018] border border-white/[0.04] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold" style={{ color }}>{label}</span>
        <span className="text-[10px] tabular-nums text-gray-500 font-semibold">
          {decided > 0 ? `${decided} decided` : `${metrics.picks} picks`}
        </span>
      </div>
      {metrics.picks === 0 ? (
        <div className="mt-1.5 text-[13px] text-gray-600">—</div>
      ) : decided === 0 ? (
        <>
          <div className="mt-1.5 text-[16px] tabular-nums font-extrabold text-gray-100 leading-none">{metrics.pending}</div>
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-amber-300/85 mt-1.5">pending</div>
        </>
      ) : (
        <>
          <div className="mt-1.5 text-[16px] tabular-nums font-extrabold text-gray-100 leading-none">{fmtRecord(metrics)}</div>
          <div className="text-[10.5px] tabular-nums text-emerald-300/90 font-bold mt-1.5">{fmtPct(metrics) ?? ""}</div>
        </>
      )}
      {nonDecisionCount > 0 && decided > 0 && (
        <div className="mt-1.5 text-[10px] tabular-nums text-gray-500">
          + {nonDecisionParts.join(" · ")}
        </div>
      )}
    </div>
  );
}

// ─── Recent results — stacked cards ──────────────────────────────────

function RecentPickCard({ pick }: { pick: RecentPickRow }) {
  const isStateOnly = pick.play_grade === "toss_up" || pick.held === true;
  const result = isStateOnly ? (pick.held ? "held" : "toss_up") : pick.result;

  const resultStyles: Record<string, { label: string; bg: string; fg: string; border: string }> = {
    win:     { label: "Win",     bg: "rgba(52,211,153,0.10)",  fg: "rgb(110 231 183)", border: "rgba(52,211,153,0.32)" },
    loss:    { label: "Loss",    bg: "rgba(244,114,182,0.08)", fg: "rgb(244 114 182)", border: "rgba(244,114,182,0.28)" },
    push:    { label: "Push",    bg: "rgba(148,163,184,0.08)", fg: "rgb(203 213 225)", border: "rgba(148,163,184,0.22)" },
    void:    { label: "Void",    bg: "rgba(148,163,184,0.08)", fg: "rgb(203 213 225)", border: "rgba(148,163,184,0.22)" },
    pending: { label: "Pending", bg: "rgba(251,191,36,0.08)",  fg: "rgb(252 211 77)",  border: "rgba(251,191,36,0.26)" },
    toss_up: { label: "Toss-Up", bg: "rgba(148,163,184,0.08)", fg: "rgb(203 213 225)", border: "rgba(148,163,184,0.22)" },
    held:    { label: "Held",    bg: "rgba(148,163,184,0.08)", fg: "rgb(203 213 225)", border: "rgba(148,163,184,0.22)" },
  };
  const rs = resultStyles[result];

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

  const playGradeLabel = pick.play_grade !== null ? PLAY_GRADE_LABEL[pick.play_grade] ?? null : null;
  const showBestAngle = pick.best_angle === true;
  const showLean = pick.play_grade === "lean" && !showBestAngle;

  return (
    <div
      className="rounded-xl p-3.5 sm:p-4 border border-white/[0.05]"
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.010))" }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-gray-500 tabular-nums">{fmtShortDate(pick.slate_date)}</span>
        <span className="text-gray-700 text-[10px]">·</span>
        <SportPill sport={pick.sport} />
        <CategoryBadge market={pick.market} />
        {showBestAngle && <span className="text-[10px] uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded bg-emerald-500/[0.10] border border-emerald-500/25 text-emerald-300">Best Angle</span>}
        {showLean && <span className="text-[10px] uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded bg-indigo-500/[0.10] border border-indigo-500/25 text-indigo-300">Lean</span>}
        <span
          className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.16em] font-bold"
          style={{ background: rs.bg, color: rs.fg, border: `1px solid ${rs.border}` }}
        >
          {rs.label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[13.5px] sm:text-[14.5px] font-semibold text-gray-100 truncate max-w-full">
          {pick.matchup}
          {pick.pick !== null && (
            <span className="text-gray-400 font-normal"> · <span className="text-gray-200 font-semibold">{pick.pick}</span></span>
          )}
        </div>
        {scoreLine !== "" && <span className="text-[11.5px] tabular-nums text-gray-400 font-semibold">{scoreLine}</span>}
      </div>
      {playGradeLabel !== null && !showBestAngle && !showLean && (
        <div className="mt-1 text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-500 flex items-center gap-2 flex-wrap">
          <span>{playGradeLabel}</span>
        </div>
      )}
    </div>
  );
}

// ─── Recently settled — stacked cards (6B.21) ────────────────────────

function fmtOdds(o: number | null): string {
  if (o === null) return "";
  return o > 0 ? `+${o}` : `${o}`;
}

function fmtClock(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const ageMs = now - d.getTime();
  if (ageMs < 60_000) return "just now";
  const ageMin = Math.round(ageMs / 60_000);
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.round(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  const days = Math.round(ageHr / 24);
  return `${days}d ago`;
}

function RecentlySettledCard({ pick }: { pick: RecentlySettledRow }) {
  const resultStyles: Record<string, { label: string; bg: string; fg: string; border: string }> = {
    win:  { label: "Win",  bg: "rgba(52,211,153,0.10)",  fg: "rgb(110 231 183)", border: "rgba(52,211,153,0.32)" },
    loss: { label: "Loss", bg: "rgba(244,114,182,0.08)", fg: "rgb(244 114 182)", border: "rgba(244,114,182,0.28)" },
    push: { label: "Push", bg: "rgba(148,163,184,0.08)", fg: "rgb(203 213 225)", border: "rgba(148,163,184,0.22)" },
    void: { label: "Void", bg: "rgba(148,163,184,0.08)", fg: "rgb(203 213 225)", border: "rgba(148,163,184,0.22)" },
  };
  const rs = resultStyles[pick.result];

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

  const showBestAngle = pick.best_angle === true;
  const showLean = pick.play_grade === "lean" && !showBestAngle;
  const odds = fmtOdds(pick.odds_american);
  const line = pick.line_value !== null ? pick.line_value.toString() : null;
  const conf = pick.confidence !== null ? `${Math.round(pick.confidence)}%` : null;
  const ago = fmtClock(pick.graded_at);
  const soccerRegulationNote = pick.sport === "soccer" && (
    pick.market === "match_result" ||
    pick.market === "double_chance" ||
    pick.market === "total" ||
    pick.market === "btts"
  );

  return (
    <div
      className="rounded-xl p-3.5 sm:p-4 border border-white/[0.05]"
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.010))" }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-emerald-300/70 tabular-nums">{ago}</span>
        <span className="text-gray-700 text-[10px]">·</span>
        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-gray-500 tabular-nums">{fmtShortDate(pick.slate_date)}</span>
        <span className="text-gray-700 text-[10px]">·</span>
        <SportPill sport={pick.sport} />
        <CategoryBadge market={pick.market} />
        {showBestAngle && <span className="text-[10px] uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded bg-emerald-500/[0.10] border border-emerald-500/25 text-emerald-300">Best Angle</span>}
        {showLean && <span className="text-[10px] uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded bg-indigo-500/[0.10] border border-indigo-500/25 text-indigo-300">Lean</span>}
        <span
          className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.16em] font-bold"
          style={{ background: rs.bg, color: rs.fg, border: `1px solid ${rs.border}` }}
        >
          {rs.label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[13.5px] sm:text-[14.5px] font-semibold text-gray-100 truncate max-w-full">
          {pick.matchup}
          {pick.pick !== null && (
            <span className="text-gray-400 font-normal"> · <span className="text-gray-200 font-semibold">{pick.pick}</span></span>
          )}
        </div>
        {scoreLine !== "" && <span className="text-[11.5px] tabular-nums text-gray-400 font-semibold">{scoreLine}</span>}
      </div>
      {(line !== null || odds !== "" || conf !== null) && (
        <div className="mt-1 text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-500 flex items-center gap-2 flex-wrap">
          {line !== null && <span>Line {line}</span>}
          {odds !== "" && <span className="text-gray-600">· {odds}</span>}
          {conf !== null && <span className="text-gray-600">· Conf {conf}</span>}
          {soccerRegulationNote && <span className="text-gray-600">· Regulation result</span>}
        </div>
      )}
    </div>
  );
}

// ─── Method (combined) ────────────────────────────────────────────────

function MethodDivider() {
  return <div className="my-4 border-t border-white/[0.04]" />;
}

function Glossary() {
  const items: { term: string; body: string }[] = [
    { term: "Best Angle", body: "Strongest filtered tier — meaningful edge plus reliable data." },
    { term: "Lean",       body: "Lighter actionable call with positive edge." },
    { term: "No Bet",     body: "Not playable; still counted for prediction accuracy when it has a side." },
    { term: "Toss-Up",    body: "Model state, not a bet. Never counted as a win or loss." },
    { term: "Held",       body: "Pick withheld by safety gate. Never counted as a win or loss." },
    { term: "Pending",    body: "Awaiting result." },
    { term: "Push / Void", body: "Excluded from win rate. Postponed games count as voids." },
  ];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-gray-500 mb-2.5">Glossary</div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] leading-relaxed">
        {items.map((it) => (
          <div key={it.term} className="flex gap-2">
            <dt className="text-gray-200 font-semibold shrink-0">{it.term}</dt>
            <dd className="text-gray-400">— {it.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AllActionableFooter({ overall, bestAngles, leans }: { overall: Metrics; bestAngles: Metrics; leans?: Metrics }) {
  // Secondary blended footer — explicitly NOT a hero. Lives at the
  // very bottom of Method to satisfy "small secondary note" rule.
  const decided = overall.wins + overall.losses;
  const allPending = decided === 0 && overall.pending > 0;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-gray-500 mb-2">All tracked actionable picks</div>
      <div className="text-[12px] text-gray-400 leading-relaxed">
        {allPending ? (
          <>
            <span className="text-gray-200 font-semibold tabular-nums">{overall.pending}</span> pending across all sports and categories. Records appear once games grade.
          </>
        ) : overall.picks === 0 ? (
          <>No tracked picks yet.</>
        ) : (
          <span className="tabular-nums">
            <span className="text-gray-200 font-semibold">{fmtRecord(overall)}</span>
            {fmtPct(overall) !== null && <span> · <span className="text-emerald-300/85 font-semibold">{fmtPct(overall)}</span></span>}
            {overall.pending > 0 && <span className="text-gray-500"> · {overall.pending} pending</span>}
            {bestAngles.picks > 0 && (
              <span className="text-gray-500"> · Best Angle {fmtRecord(bestAngles)}{fmtPct(bestAngles) !== null ? ` ${fmtPct(bestAngles)}` : ""}</span>
            )}
            {leans !== undefined && leans.picks > 0 && (
              <span className="text-gray-500"> · Lean {fmtRecord(leans)}{fmtPct(leans) !== null ? ` ${fmtPct(leans)}` : ""}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
