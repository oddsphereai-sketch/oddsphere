/**
 * Tracking Aggregator — compute per-(sport, market, time_window) hit-rate
 * aggregates from prediction_results rows. Pure function over the result set;
 * the runner / cron handles the DB read + write.
 *
 * Four time windows (locked):
 *   • yesterday   — game_date == today - 1 day
 *   • this_week   — last 7 days (today-1 through today-7)
 *   • season      — from configured opening day through today
 *   • all_time    — every result regardless of date
 *
 * Combos with zero data are dropped so we don't insert empty rows.
 * hit_rate = wins / (wins + losses)  — pushes excluded from the denominator
 * (industry standard; pushes return your stake).
 */

export type PredictionResultRow = {
  sport: string;
  market: string;
  outcome: "win" | "loss" | "push" | "void";
  game_date: string; // YYYY-MM-DD
};

export type TimeWindowName = "yesterday" | "this_week" | "season" | "all_time";

export type AggregateRow = {
  sport: string;
  market: string;
  time_window: TimeWindowName;
  window_start: string | null;
  window_end: string | null;
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  hit_rate: number | null;
};

export type AggregatorOptions = {
  /** YYYY-MM-DD — anchor day for "today" semantics. */
  today: string;
  /** YYYY-MM-DD — season opening day. */
  seasonStart: string;
};

function daysBetweenISO(later: string, earlier: string): number {
  return (
    (new Date(later).getTime() - new Date(earlier).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type WindowSpec = {
  name: TimeWindowName;
  start: string | null;
  end: string | null;
  matches: (gameDate: string) => boolean;
};

function buildWindows(opts: AggregatorOptions): WindowSpec[] {
  const today = opts.today;
  const yesterday = isoAddDays(today, -1);
  const sevenAgo = isoAddDays(today, -7);
  return [
    {
      name: "yesterday",
      start: yesterday,
      end: yesterday,
      matches: (d) => d === yesterday,
    },
    {
      name: "this_week",
      start: sevenAgo,
      end: yesterday,
      matches: (d) => {
        const delta = daysBetweenISO(today, d);
        return delta >= 1 && delta <= 7;
      },
    },
    {
      name: "season",
      start: opts.seasonStart,
      end: today,
      matches: (d) => d >= opts.seasonStart && d <= today,
    },
    { name: "all_time", start: null, end: null, matches: () => true },
  ];
}

export function computeAggregates(
  results: PredictionResultRow[],
  opts: AggregatorOptions
): AggregateRow[] {
  const windows = buildWindows(opts);
  // Distinct (sport, market) pairs across the result set
  const sportsMarkets = new Set<string>(
    results.map((r) => `${r.sport}::${r.market}`)
  );

  const rows: AggregateRow[] = [];
  for (const w of windows) {
    for (const sm of sportsMarkets) {
      const [sport, market] = sm.split("::") as [string, string];
      const matching = results.filter(
        (r) => r.sport === sport && r.market === market && w.matches(r.game_date)
      );
      if (matching.length === 0) continue;
      const wins = matching.filter((r) => r.outcome === "win").length;
      const losses = matching.filter((r) => r.outcome === "loss").length;
      const pushes = matching.filter((r) => r.outcome === "push").length;
      const total = wins + losses + pushes;
      const denom = wins + losses;
      const hitRate = denom > 0 ? +((wins / denom) * 100).toFixed(2) : null;
      rows.push({
        sport,
        market,
        time_window: w.name,
        window_start: w.start,
        window_end: w.end,
        wins,
        losses,
        pushes,
        total,
        hit_rate: hitRate,
      });
    }
  }
  return rows;
}
