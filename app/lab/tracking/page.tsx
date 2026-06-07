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
 *   6. Method — combined glossary, model versions, baselines,
 *      tiny "all tracked actionable picks" footer
 *
 * Hard rules unchanged from earlier passes:
 *   • Toss-Up and Held are NEVER counted as wins or losses.
 *   • No Bet is never mixed into the main win rate.
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
  byMarket: DimensionRow[];
  bySportMarket?: SportMarketBucket[];
  byModelVersion?: DimensionRow[];
  bestAngles: Metrics;
  leans?: Metrics;
  yesterday?: { date: string | null; overall: Metrics; bySportMarket: SportMarketBucket[] };
  thisWeek?: { from: string; to: string; overall: Metrics; bySportMarket: SportMarketBucket[] };
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
  total: "Over / Under",
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
  "auto_v1.0_mlb_rules": "Rules V1",
  fi_v2: "FI V2",
  legacy: "Legacy",
  "(unknown)": "Pre-cutover",
};

// MLB order: ML, O/U, NRFI, YRFI. first_inning rollup goes last.
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
function prettyModelVersion(label: string): string { return MODEL_VERSION_LABEL[label] ?? label; }
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
 * "Automated" — live, recomputed each request from prediction_records
 * + prediction_grades. "Maintained" — stored lifetime record (today
 * the imported tracking_baselines table); manually updated until the
 * sport's automated tracking comes online.
 *
 * Both shapes render as Lifetime Tracking on the page. The source_type
 * field is kept for code/test clarity but is NOT shown as ugly "legacy"
 * UI — at most surfaced as a small "Auto-updating" hint when any row
 * in a sport has decided live picks.
 */
type LifetimeRecord = {
  sport: string;
  market: string;
  source_type: "automated" | "maintained";
  /** Display text for the record column. e.g. "1705/3027" or "1-0". */
  display_record: string;
  /** Display text for the win-rate column. e.g. "56.3%" or null. */
  display_pct: string | null;
  /** Total sample size for sort + footer rendering. */
  display_total: number;
  /** Only populated for automated rows. */
  pending: number;
  pushes: number;
  voids: number;
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

    if (live !== undefined && liveDecided > 0) {
      records.push({
        sport, market,
        source_type: "automated",
        display_record: fmtRecord(live.metrics),
        display_pct: fmtPct(live.metrics),
        display_total: live.metrics.picks,
        pending: live.metrics.pending,
        pushes: live.metrics.pushes,
        voids: live.metrics.voids,
        bestAngles: live.bestAngles,
        leans: live.leans,
      });
    } else if (base !== undefined) {
      records.push({
        sport, market,
        source_type: "maintained",
        display_record: `${base.lifetime_wins.toLocaleString()}/${base.lifetime_total.toLocaleString()}`,
        display_pct: `${base.lifetime_pct.toFixed(1)}%`,
        display_total: base.lifetime_total,
        pending: 0,
        pushes: 0,
        voids: 0,
      });
    } else if (live !== undefined && live.metrics.pending > 0) {
      records.push({
        sport, market,
        source_type: "automated",
        display_record: `${live.metrics.pending} pending`,
        display_pct: null,
        display_total: live.metrics.pending,
        pending: live.metrics.pending,
        pushes: 0,
        voids: 0,
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

  const yesterdayRows = useMemo(() => visibleBuckets(data?.yesterday?.bySportMarket ?? []), [data]);
  const weekRows      = useMemo(() => visibleBuckets(data?.thisWeek?.bySportMarket ?? []),  [data]);
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

      {/* ── 2. THIS WEEK ─────────────────────────────────────────────── */}
      <Section
        eyebrow={week !== undefined ? `${fmtShortDate(week.from)} → ${fmtShortDate(week.to)}` : "This week"}
        title="This week by category"
      >
        <Card>
          <CategoryBars
            rows={weekRows.map((b) => ({
              label: `${prettySport(b.sport)} ${prettyMarket(b.market)}`,
              sublabel: shortMarket(b.market),
              metrics: b.metrics,
            }))}
            emptyBody="Weekly category comparison appears once this week's picks have graded."
          />
        </Card>
      </Section>

      {/* ── 3. LIFETIME TRACKING ─────────────────────────────────────── */}
      <Section
        eyebrow="By sport and category"
        title="Lifetime Tracking"
      >
        <LifetimeTrackingBoard records={lifetimeRecords} />
      </Section>

      {/* ── 4. BEST ANGLES ───────────────────────────────────────────── */}
      <Section
        eyebrow="Premium tier"
        title="Best Angles by category"
      >
        <BestAnglesBoard rows={bestAngleRows} />
      </Section>

      {/* ── 5. RECENT PREDICTIONS ────────────────────────────────────── */}
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
          <ModelVersions rows={data.byModelVersion ?? []} />
          <MethodDivider />
          <AllActionableFooter overall={data.overall} bestAngles={data.bestAngles} leans={data.leans} />
        </Card>
      </Section>

      <footer className="mt-10 pt-6 border-t border-white/[0.04] text-[11px] text-gray-600 leading-relaxed">
        Win rate excludes pushes, voids, pending, Toss-Up and Held picks. Postponed and canceled games count as voids. First-inning grading requires the first-inning linescore.
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
          Model Tracking
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
        Records update after games are graded. Toss-Up and Held are not counted as wins or losses.
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

// ─── Lifetime tracking board — single unified source by sport+category

function LifetimeTrackingBoard({ records }: { records: LifetimeRecord[] }) {
  if (records.length === 0) {
    return (
      <Card>
        <Empty body="Lifetime records appear here as predictions settle and sport tracking comes online." />
      </Card>
    );
  }

  // Group records by sport so the section reads as a sport rollup, not
  // a long flat list. Sport order already enforced upstream.
  const groups: { sport: string; rows: LifetimeRecord[] }[] = [];
  for (const r of records) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.sport === r.sport) {
      last.rows.push(r);
    } else {
      groups.push({ sport: r.sport, rows: [r] });
    }
  }

  return (
    <div
      className="relative rounded-2xl border border-white/[0.06] p-4 sm:p-5 overflow-hidden"
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.030), rgba(255,255,255,0.012))" }}
    >
      <div className="absolute inset-x-0 top-0 h-[1.5px]" style={{ background: "linear-gradient(90deg, transparent, rgba(52,211,153,0.5), transparent)" }} />
      <p className="text-[11.5px] text-gray-500 mb-4 leading-relaxed max-w-xl">
        Records by sport and category. MLB updates automatically as games grade. Other sports are maintained as their models come online.
      </p>
      <div className="space-y-5">
        {groups.map((g) => (
          <SportGroup key={g.sport} sport={g.sport} rows={g.rows} />
        ))}
      </div>
    </div>
  );
}

function SportGroup({ sport, rows }: { sport: string; rows: LifetimeRecord[] }) {
  const hasAuto = rows.some((r) => r.source_type === "automated");
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <SportPill sport={sport} />
        <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-gray-500">
          {rows.length} {rows.length === 1 ? "category" : "categories"}
        </span>
        {hasAuto && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-bold text-emerald-300/85">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/85" />
            Auto-updating
          </span>
        )}
      </div>
      <ul className="divide-y divide-white/[0.05] -my-1.5 rounded-xl bg-white/[0.012] border border-white/[0.035] px-3 sm:px-4">
        {rows.map((r) => (
          <li key={`${r.sport}-${r.market}`} className="py-3">
            <LifetimeRow record={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LifetimeRow({ record }: { record: LifetimeRecord }) {
  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[14px] sm:text-[14.5px] font-semibold text-gray-100">{prettyMarket(record.market)}</span>
        <CategoryBadge market={record.market} />
        <div className="ml-auto flex items-baseline gap-3 sm:gap-4 tabular-nums">
          <span className="text-[17px] sm:text-[18px] font-extrabold text-gray-50 leading-none">{record.display_record}</span>
          {record.display_pct !== null && (
            <span className="text-[13px] font-bold text-emerald-300/95 leading-none">{record.display_pct}</span>
          )}
        </div>
      </div>
      {record.source_type === "automated" && (record.pending > 0 || (record.bestAngles?.picks ?? 0) > 0 || (record.leans?.picks ?? 0) > 0) && (
        <div className="mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] tabular-nums">
          {record.bestAngles !== undefined && record.bestAngles.picks > 0 && (
            <SubChip label="Best Angle" m={record.bestAngles} color="rgb(110 231 183)" />
          )}
          {record.leans !== undefined && record.leans.picks > 0 && (
            <SubChip label="Lean" m={record.leans} color="rgb(165 180 252)" />
          )}
          {record.pending > 0 && (
            <span className="text-gray-500"><span className="text-gray-400 font-semibold">{record.pending}</span> pending</span>
          )}
          {record.pushes > 0 && (
            <span className="text-gray-500"><span className="text-gray-400 font-semibold">{record.pushes}</span> push</span>
          )}
          {record.voids > 0 && (
            <span className="text-gray-500"><span className="text-gray-400 font-semibold">{record.voids}</span> void</span>
          )}
        </div>
      )}
    </div>
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
      <div className="flex items-center gap-2.5 flex-wrap">
        <SportPill sport={bucket.sport} />
        <span className="text-[14.5px] sm:text-[15.5px] font-semibold text-gray-50">{prettyMarket(bucket.market)}</span>
        <CategoryBadge market={bucket.market} />
        <div className="ml-auto flex items-baseline gap-3 sm:gap-4 tabular-nums">
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
              <div className="grid grid-cols-2 gap-3">
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
  return (
    <div className="rounded-lg bg-white/[0.018] border border-white/[0.04] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold" style={{ color }}>{label}</span>
        <span className="text-[10px] tabular-nums text-gray-500 font-semibold">{metrics.picks} picks</span>
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
      {(playGradeLabel !== null || pick.model_version !== null) && (
        <div className="mt-1 text-[10.5px] uppercase tracking-[0.14em] font-bold text-gray-500 flex items-center gap-2 flex-wrap">
          {playGradeLabel !== null && !showBestAngle && !showLean && <span>{playGradeLabel}</span>}
          {pick.model_version !== null && <span className="text-gray-600">· {prettyModelVersion(pick.model_version)}</span>}
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
    { term: "No Bet",     body: "Not playable; surfaced for transparency, not counted in main win rate." },
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

function ModelVersions({ rows }: { rows: DimensionRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-gray-500 mb-2.5">Model versions</div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] tabular-nums">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-2">
            <span className="text-gray-200 font-semibold">{prettyModelVersion(r.label)}</span>
            <span className="text-gray-500">
              {r.metrics.picks === 0 ? "—" : `${fmtRecord(r.metrics)}${fmtPct(r.metrics) !== null ? ` · ${fmtPct(r.metrics)}` : ""}`}
              {r.metrics.pending > 0 ? ` · ${r.metrics.pending} pend` : ""}
            </span>
          </div>
        ))}
      </div>
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
