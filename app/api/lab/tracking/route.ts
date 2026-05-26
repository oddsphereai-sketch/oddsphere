/**
 * GET /api/lab/tracking
 *
 * Query-time aggregations over prediction_results powering the Lab's
 * Tracking page. Per Decision F: no nightly rollup table — we recompute on
 * each request. Cheap until prediction_results crosses ~hundreds of
 * thousands of rows; revisit then.
 *
 * One round-trip: pull every prediction_results row (currently 450 in seed,
 * grows ~30/day) and aggregate in TypeScript. Returns five sections:
 *
 *   1. yesterdayRecap   — calendar-yesterday's per-(sport, market) outcomes.
 *                          Falls back to the most recent day with activity
 *                          when literal yesterday is empty (and flags it
 *                          with isYesterday=false so the UI can label it
 *                          "Last activity — ...").
 *   2. weeklyAggregate  — rolling 7-day window ending yesterday.
 *   3. last30Days       — rolling 30-day window, one bar per day (zero-fills
 *                          days with no activity), plus best/worst/most-picks.
 *   4. allTimeAggregate — totals across the full prediction_results set.
 *   5. streak           — consecutive winning (or losing) days from the most
 *                          recent activity day backward.
 *
 * Plus a sport × market `tallies` matrix (mock-equivalent). For sports with
 * zero prediction_results rows the tally still appears with zeros so the UI
 * can render an honest "Offseason — no activity yet" state instead of
 * fabricating numbers.
 *
 * Auth: public read. No member-identifying data.
 */

import { supabase } from "@/lib/db/supabase";
import { applyProductionSourceFilter } from "@/lib/db/productionFilter";
import type { Sport } from "@/lib/types/domain/Sport";
import type {
  AllTimeAggregate,
  DailyHitRatePoint,
  DailyMarketResult,
  DailyRecap,
  LastThirtyDays,
  SportMarketTally,
  Streak,
  TrackingResponse,
  WeeklyAggregate,
  WindowTally,
} from "@/app/lab/lib/labTypes";

// ─── Display ordering ────────────────────────────────────────────────────
const SPORT_DISPLAY_ORDER: Sport[] = ["mlb", "nba", "cbb", "nfl", "cfb", "nhl", "ucl"];

// ─── Sport × Market matrix definition ────────────────────────────────────
// What we WANT to surface in the UI per sport, regardless of whether the
// data exists yet. Keeps the table honest about coverage gaps.
const SPORT_MARKETS: Record<Sport, string[]> = {
  mlb: ["ML", "O/U", "NRFI", "YRFI", "NRFI/YRFI"],
  nba: ["ML", "O/U"],
  cbb: ["ML", "O/U"],
  nfl: ["ML", "O/U"],
  cfb: ["ML", "O/U"],
  nhl: ["ML", "O/U"],
  ucl: ["ML", "Double Chance"],
};

// DB market column → UI label. prop_* markets aren't surfaced individually
// here (they collapse into MLB's existing market rows via prediction_type='prop'
// — kept out of V1 by design to match the mock UI).
const MARKET_DB_TO_UI: Record<string, string> = {
  ml: "ML",
  total: "O/U",
  nrfi: "NRFI",
  yrfi: "YRFI",
  double_chance: "Double Chance",
};

// ─── Date helpers ────────────────────────────────────────────────────────

/** Returns YYYY-MM-DD for today UTC. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Yesterday in UTC (used for the recap fallback when DB hasn't caught up). */
function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Add `days` to a YYYY-MM-DD string and return YYYY-MM-DD. */
function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "May 21" style label from YYYY-MM-DD. */
function formatDayLabel(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) return yyyyMmDd;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

// ─── Aggregation helpers ─────────────────────────────────────────────────

type ResultRow = {
  sport: string;
  market: string;
  outcome: string;
  game_date: string; // YYYY-MM-DD
  prediction_type: string;
};

function emptyTally(): WindowTally {
  return { wins: 0, losses: 0, pushes: 0, total: 0, hitRate: 0 };
}

function buildTally(rows: ResultRow[]): WindowTally {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (const r of rows) {
    if (r.outcome === "win") wins++;
    else if (r.outcome === "loss") losses++;
    else if (r.outcome === "push") pushes++;
  }
  const total = wins + losses + pushes;
  const decided = wins + losses;
  return {
    wins,
    losses,
    pushes,
    total,
    hitRate: decided > 0 ? wins / decided : 0,
  };
}

/** Group rows by (sport, ui_market) — combined virtual markets handled below. */
function groupBySportMarket(rows: ResultRow[]): Map<string, ResultRow[]> {
  const groups = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const uiMarket = MARKET_DB_TO_UI[r.market];
    if (!uiMarket) continue; // prop_* markets stay out of these tallies
    const key = `${r.sport}|${uiMarket}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  return groups;
}

/**
 * Synthesize virtual markets (e.g., NRFI/YRFI = NRFI + YRFI). The UI surfaces
 * the combined market alongside the per-side breakdowns.
 */
function addCombinedMlbMarket(groups: Map<string, ResultRow[]>): Map<string, ResultRow[]> {
  const out = new Map(groups);
  const nrfi = groups.get("mlb|NRFI") ?? [];
  const yrfi = groups.get("mlb|YRFI") ?? [];
  if (nrfi.length + yrfi.length > 0) {
    out.set("mlb|NRFI/YRFI", [...nrfi, ...yrfi]);
  }
  return out;
}

// ─── Section builders ────────────────────────────────────────────────────

/**
 * Pick the recap-anchor date: if calendar-yesterday has rows, use it.
 * Otherwise fall back to the most recent date with data so the recap never
 * shows an empty state when the seed/DB is behind real-time.
 */
function pickRecapDate(rows: ResultRow[]): { date: string; isYesterday: boolean } {
  const yesterday = yesterdayUtc();
  const yesterdayRows = rows.filter((r) => r.game_date === yesterday);
  if (yesterdayRows.length > 0) {
    return { date: yesterday, isYesterday: true };
  }
  // Most recent date with any rows.
  const dates = Array.from(new Set(rows.map((r) => r.game_date))).sort();
  const latest = dates[dates.length - 1];
  return { date: latest ?? yesterday, isYesterday: false };
}

function buildYesterdayRecap(rows: ResultRow[]): DailyRecap {
  const { date, isYesterday } = pickRecapDate(rows);
  const dayRows = rows.filter((r) => r.game_date === date);
  const groups = addCombinedMlbMarket(groupBySportMarket(dayRows));

  const results: DailyMarketResult[] = [];
  // Iterate sports/markets in the canonical order so the UI presentation
  // matches the rest of the page.
  for (const sport of SPORT_DISPLAY_ORDER) {
    const markets = SPORT_MARKETS[sport];
    for (const market of markets) {
      const subset = groups.get(`${sport}|${market}`) ?? [];
      if (subset.length === 0) continue; // Don't list zero-activity rows on the recap.
      const tally = buildTally(subset);
      results.push({
        sport,
        market,
        wins: tally.wins,
        losses: tally.losses,
        pushes: tally.pushes,
        total: tally.total,
      });
    }
  }

  const totalWins = results.reduce((s, r) => s + r.wins, 0);
  const totalLosses = results.reduce((s, r) => s + r.losses, 0);
  const totalPushes = results.reduce((s, r) => s + r.pushes, 0);
  const totalPicks = totalWins + totalLosses + totalPushes;
  const decided = totalWins + totalLosses;
  return {
    date,
    label: formatDayLabel(date),
    isYesterday,
    results,
    totalPicks,
    totalWins,
    totalLosses,
    hitRate: decided > 0 ? totalWins / decided : 0,
  };
}

function buildWeekly(rows: ResultRow[]): WeeklyAggregate {
  const endDate = (() => {
    const yest = yesterdayUtc();
    const all = Array.from(new Set(rows.map((r) => r.game_date))).sort();
    const latest = all[all.length - 1] ?? yest;
    // Window ends at yesterday OR the latest day, whichever is earlier — so
    // a stale DB shows the relevant rolling 7-day band, not a future window.
    return latest < yest ? latest : yest;
  })();
  const startDate = addDays(endDate, -6);
  const subset = rows.filter((r) => r.game_date >= startDate && r.game_date <= endDate);
  const tally = buildTally(subset);
  return {
    weekStart: startDate,
    weekEnd: endDate,
    weekStartLabel: formatDayLabel(startDate),
    weekEndLabel: formatDayLabel(endDate),
    totalPicks: tally.total,
    wins: tally.wins,
    losses: tally.losses,
    pushes: tally.pushes,
    hitRate: tally.hitRate,
  };
}

function buildLast30Days(rows: ResultRow[]): LastThirtyDays {
  const endDate = (() => {
    const yest = yesterdayUtc();
    const all = Array.from(new Set(rows.map((r) => r.game_date))).sort();
    const latest = all[all.length - 1] ?? yest;
    return latest < yest ? latest : yest;
  })();
  const startDate = addDays(endDate, -29);

  const subset = rows.filter((r) => r.game_date >= startDate && r.game_date <= endDate);
  // Build per-day buckets including zero-activity days so the chart bars are
  // continuous.
  const byDay = new Map<string, ResultRow[]>();
  for (const r of subset) {
    const arr = byDay.get(r.game_date) ?? [];
    arr.push(r);
    byDay.set(r.game_date, arr);
  }
  const days: DailyHitRatePoint[] = [];
  for (let i = 0; i < 30; i++) {
    const date = addDays(startDate, i);
    const dayRows = byDay.get(date) ?? [];
    const tally = buildTally(dayRows);
    const decided = tally.wins + tally.losses;
    days.push({
      date,
      picks: tally.total,
      wins: tally.wins,
      hitRate: decided > 0 ? tally.wins / decided : 0,
    });
  }

  const aggregate = (() => {
    const tally = buildTally(subset);
    return {
      picks: tally.total,
      wins: tally.wins,
      losses: tally.losses,
      hitRate: tally.hitRate,
    };
  })();

  // Best/worst/most-picks gated on a small sample (5 picks) so a 1-0 day
  // doesn't outshine a 25-10 day.
  const sigDays = days.filter((d) => d.picks >= 5);
  const bestDay = sigDays.length
    ? sigDays.reduce((b, d) => (d.hitRate > b.hitRate ? d : b))
    : null;
  const worstDay = sigDays.length
    ? sigDays.reduce((w, d) => (d.hitRate < w.hitRate ? d : w))
    : null;
  const mostPicks = days.length ? days.reduce((m, d) => (d.picks > m.picks ? d : m)) : null;

  function recordOf(d: DailyHitRatePoint): string {
    const losses = d.picks - d.wins;
    const pct = d.picks > 0 ? Math.round((d.wins / d.picks) * 100) : 0;
    return `${d.wins}-${losses} (${pct}%)`;
  }

  return {
    days,
    aggregate,
    bestDay: bestDay
      ? { date: bestDay.date, dateLabel: formatDayLabel(bestDay.date), record: recordOf(bestDay) }
      : null,
    worstDay: worstDay
      ? { date: worstDay.date, dateLabel: formatDayLabel(worstDay.date), record: recordOf(worstDay) }
      : null,
    mostPicks: mostPicks && mostPicks.picks > 0
      ? { date: mostPicks.date, dateLabel: formatDayLabel(mostPicks.date), count: mostPicks.picks }
      : null,
  };
}

function buildAllTime(rows: ResultRow[]): AllTimeAggregate {
  const tally = buildTally(rows);
  return {
    totalPredictions: tally.total,
    wins: tally.wins,
    losses: tally.losses,
    pushes: tally.pushes,
    hitRate: tally.hitRate,
  };
}

function buildStreak(rows: ResultRow[]): Streak {
  // Aggregate daily — a "winning day" has wins > losses (strict). Walk back
  // from the most recent day with activity.
  const byDay = new Map<string, { wins: number; losses: number }>();
  for (const r of rows) {
    if (r.outcome !== "win" && r.outcome !== "loss") continue;
    const cur = byDay.get(r.game_date) ?? { wins: 0, losses: 0 };
    if (r.outcome === "win") cur.wins++;
    else cur.losses++;
    byDay.set(r.game_date, cur);
  }
  const dates = Array.from(byDay.keys()).sort();
  if (dates.length === 0) {
    return { type: "NONE", count: 0, description: "No resolved picks yet." };
  }
  const latest = dates[dates.length - 1]!;
  const latestDay = byDay.get(latest)!;
  const startedWinning = latestDay.wins > latestDay.losses;
  let count = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = byDay.get(dates[i]!)!;
    const isWin = d.wins > d.losses;
    if (isWin !== startedWinning) break;
    count++;
  }
  const type: Streak["type"] = startedWinning ? "W" : "L";
  const description = startedWinning
    ? `${count} winning ${count === 1 ? "day" : "days"} in a row across all sports`
    : `${count} losing ${count === 1 ? "day" : "days"} in a row across all sports`;
  return { type, count, description };
}

function buildTallies(rows: ResultRow[]): SportMarketTally[] {
  const allGroups = addCombinedMlbMarket(groupBySportMarket(rows));

  // Current season: anything in 2026 (matches seed data world). Could expand
  // to per-sport season boundaries in 5F.
  const currentYearStart = "2026-01-01";
  const seasonRows = rows.filter((r) => r.game_date >= currentYearStart);
  const seasonGroups = addCombinedMlbMarket(groupBySportMarket(seasonRows));

  // Weekly window matches buildWeekly.
  const endDate = (() => {
    const yest = yesterdayUtc();
    const all = Array.from(new Set(rows.map((r) => r.game_date))).sort();
    const latest = all[all.length - 1] ?? yest;
    return latest < yest ? latest : yest;
  })();
  const startDate = addDays(endDate, -6);
  const weeklyRows = rows.filter((r) => r.game_date >= startDate && r.game_date <= endDate);
  const weeklyGroups = addCombinedMlbMarket(groupBySportMarket(weeklyRows));

  const tallies: SportMarketTally[] = [];
  for (const sport of SPORT_DISPLAY_ORDER) {
    const markets = SPORT_MARKETS[sport];
    for (const market of markets) {
      const key = `${sport}|${market}`;
      const lifetime = buildTally(allGroups.get(key) ?? []);
      const season = seasonGroups.get(key) ?? null;
      const weekly = weeklyGroups.get(key) ?? null;
      tallies.push({
        sport,
        market,
        lifetime,
        currentSeason: season && season.length > 0 ? buildTally(season) : null,
        weekly: weekly && weekly.length > 0 ? buildTally(weekly) : null,
      });
    }
  }
  return tallies;
}

function determineSportOrder(rows: ResultRow[]): Sport[] {
  const present = new Set(rows.map((r) => r.sport));
  // Always include all canonical sports in fixed display order so the UI
  // can show "Offseason — no activity" for absent ones consistently.
  const ordered: Sport[] = [];
  for (const s of SPORT_DISPLAY_ORDER) {
    ordered.push(s);
  }
  // The `present` set is used to drive "isOffseason"-like UI cues client-side
  // (a sport's tally with lifetime.total === 0 IS the offseason marker).
  void present;
  return ordered;
}

// ───────────────────────────────────────────────────────────────────────────
// Route
// ───────────────────────────────────────────────────────────────────────────

export async function GET(_request: Request) {
  // Pull all rows. Paginate when this crosses ~50k.
  const PAGE = 1000;
  const allRows: ResultRow[] = [];
  let from = 0;
  // Bound the loop defensively — at 1M rows we'd want to materialize anyway.
  for (let i = 0; i < 100; i++) {
    // Production data-mode filter (Framework §"Signal Source Quality") drops
    // mock-sourced results before they roll up into member-facing tallies.
    // No-op in dev / preview.
    const { data, error } = await applyProductionSourceFilter(
      supabase
        .from("prediction_results")
        .select("sport, market, outcome, game_date, prediction_type")
        .order("game_date", { ascending: true })
        .range(from, from + PAGE - 1)
    );
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as ResultRow[];
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const body: TrackingResponse = {
    as_of: new Date().toISOString(),
    sportOrder: determineSportOrder(allRows),
    yesterdayRecap: buildYesterdayRecap(allRows),
    weeklyAggregate: buildWeekly(allRows),
    last30Days: buildLast30Days(allRows),
    allTimeAggregate: buildAllTime(allRows),
    streak: buildStreak(allRows),
    tallies: buildTallies(allRows),
  };

  // `todayUtc` referenced for parity with other routes' header — not used
  // directly in response shape but keeps the import live for future date
  // labels (e.g., "as of MM/DD").
  void todayUtc;

  return Response.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
