/** SELECT-only WNBA season split counterfactual across immutable releases. */
import { supabase } from "../../lib/db/supabase";

type Market = "moneyline" | "spread" | "total";
type Side = "home" | "away" | "over" | "under";
type Row = Record<string, unknown>;
type Split = {
  canonical_event_id: string;
  market_type: Market;
  selection_key: string;
  provider: string;
  source_book: string;
  source_type: string;
  bets_pct: number | null;
  money_pct: number | null;
  market_line: number | null;
  fetched_at: string;
  source_timestamp_verified: boolean;
  ingestion_run_id: string | null;
};

const object = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function resultFor(row: Row): Row | null {
  return Array.isArray(row.prediction_grades)
    ? object(row.prediction_grades[0])
    : object(row.prediction_grades);
}

function decisionAt(row: Row): string | null {
  if (typeof row.locked_at === "string" && Number.isFinite(Date.parse(row.locked_at))) return row.locked_at;
  const tuple = object(object(row.snapshot_json)?.decision_tuple);
  return typeof tuple?.decision_at === "string" && Number.isFinite(Date.parse(tuple.decision_at))
    ? tuple.decision_at
    : null;
}

function selectedMoneyTicketGap(
  rows: readonly Split[],
  target: { externalId: string; market: Market; side: Side; line: number | null; at: string },
): { sources: number; gap: number | null; verified: number } {
  const atMs = Date.parse(target.at);
  const captures = new Map<string, Split[]>();
  for (const split of rows) {
    if (split.canonical_event_id !== target.externalId || split.market_type !== target.market) continue;
    const fetchedMs = Date.parse(split.fetched_at);
    if (!Number.isFinite(fetchedMs) || fetchedMs > atMs || atMs - fetchedMs > 6 * 60 * 60 * 1000) continue;
    // Side is matched independently. Spread records and split archives use
    // opposite selected-handicap sign conventions, so line magnitude is the
    // coherent identity here.
    if (
      target.market !== "moneyline" &&
      (target.line === null || split.market_line === null ||
        Math.abs(Math.abs(split.market_line) - Math.abs(target.line)) >= 0.01)
    ) continue;
    const key = [split.provider, split.source_book, split.source_type, split.ingestion_run_id ?? split.fetched_at].join("|");
    captures.set(key, [...(captures.get(key) ?? []), split]);
  }
  const latest = new Map<string, { at: string; gap: number; verified: boolean }>();
  for (const capture of captures.values()) {
    const picked = capture.find((split) => split.selection_key.split(":").at(-1) === target.side);
    const opposite = capture.find((split) => split.selection_key.split(":").at(-1) !== target.side);
    if (!picked || !opposite || picked.bets_pct === null || picked.money_pct === null) continue;
    const source = [picked.provider, picked.source_book, picked.source_type].join("|");
    const candidate = {
      at: picked.fetched_at,
      gap: picked.money_pct - picked.bets_pct,
      verified: picked.source_timestamp_verified,
    };
    if (!latest.has(source) || candidate.at > latest.get(source)!.at) latest.set(source, candidate);
  }
  const values = [...latest.values()];
  return {
    sources: values.length,
    gap: values.length ? values.reduce((sum, value) => sum + value.gap, 0) / values.length : null,
    verified: values.filter((value) => value.verified).length,
  };
}

async function main(): Promise<void> {
  const recordsResult = await supabase.from("prediction_records")
    .select("game_id,slate_date,market,side,line_value,play_grade,model_version,locked_at,snapshot_json,prediction_grades(result)")
    .eq("sport", "wnba").order("slate_date", { ascending: true }).limit(1000);
  if (recordsResult.error) throw new Error(recordsResult.error.message);
  const raw = (recordsResult.data ?? []) as Row[];
  const gameIds = [...new Set(raw.map((row) => number(row.game_id)).filter((value): value is number => value !== null))];
  const gamesResult = await supabase.from("games").select("id,external_id").in("id", gameIds).limit(1000);
  if (gamesResult.error) throw new Error(gamesResult.error.message);
  const externalIds = new Map((gamesResult.data ?? []).map((game) => [Number(game.id), String(game.external_id)]));
  const records = raw.flatMap((row) => {
    const market = row.market as Market;
    const side = row.side as Side;
    const outcome = String(resultFor(row)?.result ?? "pending");
    const gameId = number(row.game_id);
    const at = decisionAt(row);
    if (
      gameId === null || at === null || !["win", "loss", "push"].includes(outcome) ||
      !["moneyline", "spread", "total"].includes(market) ||
      !["home", "away", "over", "under"].includes(side)
    ) return [];
    return [{
      gameId,
      externalId: externalIds.get(gameId) ?? "",
      date: String(row.slate_date),
      market,
      side,
      line: number(row.line_value),
      grade: String(row.play_grade),
      release: String(row.model_version),
      outcome,
      at,
    }];
  });
  const eventIds = [...new Set(records.map((row) => row.externalId).filter(Boolean))];
  const splits: Split[] = [];
  for (let from = 0; from < 150_000; from += 1000) {
    const page = await supabase.from("market_split_observations_v2")
      .select("canonical_event_id,market_type,selection_key,provider,source_book,source_type,bets_pct,money_pct,market_line,fetched_at,source_timestamp_verified,ingestion_run_id")
      .eq("league", "wnba").in("canonical_event_id", eventIds)
      .order("fetched_at", { ascending: true }).range(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    splits.push(...((page.data ?? []) as Split[]));
    if ((page.data ?? []).length < 1000) break;
  }
  const enriched = records.map((row) => ({ ...row, ...selectedMoneyTicketGap(splits, row) }));
  const games = [...new Set(enriched.map((row) => `${row.date}|${row.gameId}`))].sort();
  const confirmation = new Set(games.slice(-Math.floor(games.length / 3)));
  const summarize = (rows: typeof enriched) => {
    const decisions = rows.filter((row) => row.outcome !== "push");
    const flips = decisions.filter((row) => row.gap !== null && row.gap < 0);
    const actionable = decisions.filter((row) => row.grade === "best_angle" || row.grade === "lean");
    const actionableFlips = actionable.filter((row) => row.gap !== null && row.gap < 0);
    return {
      records: decisions.length,
      coverage: decisions.filter((row) => row.gap !== null).length,
      current_wins: decisions.filter((row) => row.outcome === "win").length,
      flips: flips.length,
      corrections: flips.filter((row) => row.outcome === "loss").length,
      harms: flips.filter((row) => row.outcome === "win").length,
      net: flips.filter((row) => row.outcome === "loss").length - flips.filter((row) => row.outcome === "win").length,
      actionable: actionable.length,
      actionable_flips: actionableFlips.length,
      actionable_corrections: actionableFlips.filter((row) => row.outcome === "loss").length,
      actionable_harms: actionableFlips.filter((row) => row.outcome === "win").length,
      actionable_net: actionableFlips.filter((row) => row.outcome === "loss").length - actionableFlips.filter((row) => row.outcome === "win").length,
    };
  };
  const report = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [market, {
    all: summarize(enriched.filter((row) => row.market === market)),
    selection: summarize(enriched.filter((row) => row.market === market && !confirmation.has(`${row.date}|${row.gameId}`))),
    confirmation: summarize(enriched.filter((row) => row.market === market && confirmation.has(`${row.date}|${row.gameId}`))),
  }]));
  console.log(JSON.stringify({
    mode: "select_only",
    writes: 0,
    provider_calls: 0,
    games: games.length,
    records: enriched.length,
    split_rows: splits.length,
    verified_source_rows: splits.filter((row) => row.source_timestamp_verified).length,
    by_market: report,
  }, null, 2));
}

void main();
