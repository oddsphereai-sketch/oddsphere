/**
 * Backfill locked Daily Edge source-aware split rows.
 *
 * Scope: only prediction_records.snapshot_json.source_aware_split_rows_at_lock.
 * Does not change picks, grades, odds, projections, probabilities, outcomes,
 * tracking, or locked_at.
 */

import { supabase } from "../../lib/db/supabase";

type Args = {
  sport: string;
  date: string;
  apply: boolean;
};

type PredictionRecord = {
  id: number;
  game_id: number;
  market: string;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  games: { external_id: number | string | null } | Array<{ external_id: number | string | null }> | null;
};

type SourceAwareSplitObservationRow = {
  canonical_event_id: string;
  market_type: string;
  selection_key: string | null;
  provider: string | null;
  source_type: string | null;
  bets_pct: number | null;
  money_pct: number | null;
  source_observed_at: string | null;
  fetched_at: string | null;
};

function parseArgs(argv: readonly string[]): Args {
  let sport = "mlb";
  let date: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sport" && argv[i + 1]) sport = argv[++i]!;
    else if (arg === "--date" && argv[i + 1]) date = argv[++i]!;
    else if (arg === "--apply") apply = true;
  }
  if (!date) {
    console.error("Usage: backfill-locked-source-aware-splits.ts --sport mlb --date YYYY-MM-DD [--apply]");
    process.exit(1);
  }
  return { sport, date, apply };
}

function gameExternalId(row: PredictionRecord): string | null {
  const game = Array.isArray(row.games) ? row.games[0] : row.games;
  const id = game?.external_id;
  return id === null || id === undefined ? null : String(id);
}

function observedAt(row: SourceAwareSplitObservationRow): string | null {
  return row.source_observed_at ?? row.fetched_at ?? null;
}

function side(row: SourceAwareSplitObservationRow): string | null {
  const value = row.selection_key?.split(":").pop();
  return value === "home" || value === "away" || value === "over" || value === "under" ? value : null;
}

function pct(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function pairScore(a: SourceAwareSplitObservationRow, b: SourceAwareSplitObservationRow): number {
  const moneyA = pct(a.money_pct);
  const moneyB = pct(b.money_pct);
  const betsA = pct(a.bets_pct);
  const betsB = pct(b.bets_pct);
  let score = 0;
  let fields = 0;
  if (moneyA !== null && moneyB !== null) {
    score += Math.abs(moneyA + moneyB - 100);
    fields += 1;
  }
  if (betsA !== null && betsB !== null) {
    score += Math.abs(betsA + betsB - 100);
    fields += 1;
  }
  return fields === 0 ? Number.POSITIVE_INFINITY : score;
}

function compact(rows: readonly SourceAwareSplitObservationRow[]): SourceAwareSplitObservationRow[] {
  const out: SourceAwareSplitObservationRow[] = [];
  for (const market of ["moneyline", "total"] as const) {
    const sideOrder = market === "moneyline" ? ["away", "home"] : ["over", "under"];
    for (const source of ["consensus", "sharp"] as const) {
      const candidates = rows
        .filter((row) => row.market_type === market)
        .filter((row) => {
          const provider = (row.provider ?? "").toLowerCase();
          const sourceType = (row.source_type ?? "").toLowerCase();
          return source === "consensus"
            ? provider === "playbook" || sourceType === "multi_book_consensus"
            : provider === "sharpapi" && sourceType === "sharp_adjacent_book";
        })
        .map((row, index) => ({ row, index, side: side(row) }))
        .filter((candidate) => candidate.side !== null);
      const [leftSide, rightSide] = sideOrder;
      const leftRows = candidates.filter((candidate) => candidate.side === leftSide);
      const rightRows = candidates.filter((candidate) => candidate.side === rightSide);
      if (leftRows.length === 0 || rightRows.length === 0) continue;
      let best: { left: (typeof candidates)[number]; right: (typeof candidates)[number]; score: number; gap: number } | null = null;
      for (const left of leftRows) {
        for (const right of rightRows) {
          const score = pairScore(left.row, right.row);
          const gap = Math.abs(left.index - right.index);
          if (best === null || score < best.score || (score === best.score && gap < best.gap)) {
            best = { left, right, score, gap };
          }
        }
      }
      if (best !== null && best.score <= 2) out.push(best.left.row, best.right.row);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id, game_id, market, locked_at, snapshot_json, games!inner(external_id)")
    .eq("sport", args.sport)
    .eq("slate_date", args.date)
    .in("market", ["moneyline", "total"])
    .not("locked_at", "is", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PredictionRecord[];
  const byGame = new Map<number, PredictionRecord[]>();
  for (const row of rows) {
    const list = byGame.get(row.game_id) ?? [];
    list.push(row);
    byGame.set(row.game_id, list);
  }

  let gamesWithRows = 0;
  let recordsUpdated = 0;
  const examples: Array<{ gameId: number; eventId: string; compactRows: number; records: number }> = [];

  for (const [gameId, records] of byGame.entries()) {
    const eventId = gameExternalId(records[0]!);
    const lockedAt = records.map((row) => row.locked_at).filter((v): v is string => typeof v === "string").sort()[0] ?? null;
    if (!eventId || !lockedAt) continue;
    const { data: splitRows, error: splitErr } = await supabase
      .from("market_split_observations_v2")
      .select("canonical_event_id, market_type, selection_key, provider, source_type, bets_pct, money_pct, source_observed_at, fetched_at")
      .eq("league", args.sport)
      .eq("canonical_event_id", eventId)
      .in("market_type", ["moneyline", "total"])
      .order("fetched_at", { ascending: false })
      .limit(500);
    if (splitErr) throw new Error(splitErr.message);
    const eligible = ((splitRows ?? []) as SourceAwareSplitObservationRow[])
      .filter((row) => {
        const at = observedAt(row);
        return at !== null && at <= lockedAt;
      });
    const compactRows = compact(eligible);
    if (compactRows.length === 0) continue;
    gamesWithRows += 1;
    examples.push({ gameId, eventId, compactRows: compactRows.length, records: records.length });
    for (const record of records) {
      const snapshot = { ...(record.snapshot_json ?? {}) };
      snapshot.source_aware_split_rows_at_lock = compactRows;
      if (args.apply) {
        const { error: updateErr } = await supabase
          .from("prediction_records")
          .update({ snapshot_json: snapshot })
          .eq("id", record.id);
        if (updateErr) throw new Error(updateErr.message);
      }
      recordsUpdated += 1;
    }
  }

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    sport: args.sport,
    date: args.date,
    lockedRecordsScanned: rows.length,
    gamesWithSourceAwareRows: gamesWithRows,
    recordsToUpdate: recordsUpdated,
    examples: examples.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
