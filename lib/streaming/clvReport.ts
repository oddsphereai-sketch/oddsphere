/**
 * CLV report aggregation (2026-06-16). PURE — no DB, no Next. The read-only
 * route (app/api/internal/clv-report/route.ts) supplies the rows; this module
 * buckets them. This is the proof artifact that gates promoting any
 * projection/prediction change from SHADOW to live.
 */

export type ClvReportRow = {
  sport: string;
  market: string; // moneyline / total / first_inning
  side: string | null; // home/away/over/under
  grade: string | null; // best_angle / lean / watchlist / ...
  oddsAmerican: number | null; // picked-side price (bet)
  clvPct: number | null; // closing - bet implied prob, pp
  beatClosing: boolean | null;
  movementBucket?: string | null; // toward/against/flat (from line_movements)
  sourceQuality?: string | null; // two_sided_consensus / single_book / ...
  result?: string | null; // win/loss/push/void
};

export type ClvBucket = {
  key: string;
  n: number;
  withClv: number; // rows that had a computable clvPct
  avgClvPct: number | null;
  beatCloseRate: number | null; // share of withClv that beat the close
  wins: number;
  losses: number;
  winRate: number | null;
};

export type ClvReport = {
  total: ClvBucket;
  byGrade: ClvBucket[];
  byMarket: ClvBucket[];
  bySide: ClvBucket[];
  byPriceBucket: ClvBucket[];
  byMovementBucket: ClvBucket[];
  bySourceQuality: ClvBucket[];
  bySport: ClvBucket[];
};

/** Favorite/pick'em/dog buckets from American odds. */
export function priceBucket(odds: number | null): string {
  if (odds === null) return "unpriced";
  if (odds <= -200) return "heavy_fav";
  if (odds < 0) return "fav";
  if (odds <= 120) return "pickem";
  if (odds <= 200) return "dog";
  return "big_dog";
}

function summarize(key: string, rows: ClvReportRow[]): ClvBucket {
  const withClvRows = rows.filter((r) => r.clvPct !== null);
  const avgClvPct =
    withClvRows.length > 0
      ? withClvRows.reduce((s, r) => s + (r.clvPct as number), 0) / withClvRows.length
      : null;
  const beat = withClvRows.filter((r) => r.beatClosing === true).length;
  const decided = rows.filter((r) => r.result === "win" || r.result === "loss");
  const wins = decided.filter((r) => r.result === "win").length;
  const losses = decided.length - wins;
  return {
    key,
    n: rows.length,
    withClv: withClvRows.length,
    avgClvPct: avgClvPct === null ? null : round2(avgClvPct),
    beatCloseRate: withClvRows.length > 0 ? round2((100 * beat) / withClvRows.length) : null,
    wins,
    losses,
    winRate: decided.length > 0 ? round2((100 * wins) / decided.length) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function groupBy(rows: ClvReportRow[], keyFn: (r: ClvReportRow) => string): ClvBucket[] {
  const groups = new Map<string, ClvReportRow[]>();
  for (const r of rows) {
    const k = keyFn(r);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.entries()]
    .map(([k, rs]) => summarize(k, rs))
    .sort((a, b) => b.n - a.n);
}

export function aggregateClv(rows: ClvReportRow[]): ClvReport {
  return {
    total: summarize("all", rows),
    byGrade: groupBy(rows, (r) => r.grade ?? "ungraded"),
    byMarket: groupBy(rows, (r) => r.market),
    bySide: groupBy(rows, (r) => r.side ?? "unknown"),
    byPriceBucket: groupBy(rows, (r) => priceBucket(r.oddsAmerican)),
    byMovementBucket: groupBy(rows, (r) => r.movementBucket ?? "unknown"),
    bySourceQuality: groupBy(rows, (r) => r.sourceQuality ?? "unknown"),
    bySport: groupBy(rows, (r) => r.sport),
  };
}
