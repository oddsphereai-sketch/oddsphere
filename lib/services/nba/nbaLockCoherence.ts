import { NBA_PREDICTION_RECORD_RELEASE } from "../../automodel/nba/nbaChampionRuntime";

export const NBA_LOCK_COHERENCE_RELEASE =
  "nba_lock_coherence_2026_10_06_r1_official_and_context_tuple" as const;

export type NbaLockRow = {
  game_id: number;
  market: string;
  pick: string;
  line_value: number | null;
  model_version: string;
  locked_at: string | null;
  snapshot_json: unknown;
};

type NbaLockSnapshot = {
  predicted_home_score?: number;
  predicted_away_score?: number;
  predicted_total?: number;
  predicted_spread_home?: number;
  displayed_context_markets?: {
    spread?: {
      displayed_at_lock?: boolean;
      side?: "home" | "away" | null;
      line?: number | null;
      pick?: string | null;
    };
  };
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function assessNbaLockCoherence(opts: {
  gameIds: number[];
  rows: NbaLockRow[];
}): {
  checked: number;
  coherentGameIds: number[];
  blockedGameIds: number[];
  errors: string[];
} {
  const coherentGameIds: number[] = [];
  const blockedGameIds: number[] = [];
  const errors: string[] = [];
  const requiredMarkets = ["moneyline", "total"];

  for (const gameId of opts.gameIds) {
    const rows = opts.rows.filter((row) => row.game_id === gameId);
    const byMarket = new Map(rows.map((row) => [row.market, row]));
    const missing = requiredMarkets.filter((market) => !byMarket.has(market));
    if (rows.length !== 2 || missing.length > 0) {
      blockedGameIds.push(gameId);
      errors.push(`game_id=${gameId}: incomplete current NBA tuple (${rows.length}/2; missing=${missing.join(",") || "none"})`);
      continue;
    }
    const decoded = rows.map((row) => ({ row, snapshot: row.snapshot_json as NbaLockSnapshot | null }));
    const first = decoded[0]?.snapshot;
    const identity = first && finite(first.predicted_home_score) && finite(first.predicted_away_score) &&
        finite(first.predicted_total) && finite(first.predicted_spread_home)
      ? JSON.stringify({
          home: first.predicted_home_score,
          away: first.predicted_away_score,
          total: first.predicted_total,
          margin: first.predicted_spread_home,
        })
      : null;
    const releaseCoherent = identity !== null && decoded.every(({ row, snapshot }) => (
      row.model_version === NBA_PREDICTION_RECORD_RELEASE &&
      row.locked_at === null &&
      snapshot !== null &&
      JSON.stringify({
        home: snapshot.predicted_home_score,
        away: snapshot.predicted_away_score,
        total: snapshot.predicted_total,
        margin: snapshot.predicted_spread_home,
      }) === identity
    ));
    if (!releaseCoherent || !first) {
      blockedGameIds.push(gameId);
      errors.push(`game_id=${gameId}: NBA score/release tuple is incoherent`);
      continue;
    }
    const margin = first.predicted_home_score! - first.predicted_away_score!;
    const ml = byMarket.get("moneyline")!;
    const total = byMarket.get("total")!;
    const spread = first.displayed_context_markets?.spread;
    const mlExpected = margin >= 0 ? "home" : "away";
    const totalExpected = total.line_value === null || first.predicted_total! >= total.line_value ? "over" : "under";
    const spreadEdge = spread?.line === null || spread?.line === undefined || spread.side === null || spread.side === undefined
      ? null
      : spread.side === "home" ? margin + spread.line : -margin + spread.line;
    const spreadCoherent = spread?.displayed_at_lock !== true || spreadEdge === null || spreadEdge >= 0;
    const picksCoherent = ml.pick === mlExpected &&
      total.pick === totalExpected &&
      spreadCoherent;
    if (!picksCoherent) {
      blockedGameIds.push(gameId);
      errors.push(`game_id=${gameId}: NBA score and market picks contradict`);
      continue;
    }
    coherentGameIds.push(gameId);
  }

  return { checked: opts.gameIds.length, coherentGameIds, blockedGameIds, errors };
}
