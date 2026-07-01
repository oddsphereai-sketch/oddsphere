/**
 * Read-only validation audit for the member-facing Sharp Money row.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/sharp-money-validation-audit.ts --since 2026-06-25
 *
 * This script does not write to DB tables, flags, predictions, grades, or snapshots.
 */

import { GET as dailyEdgeGet } from "../../app/api/lab/daily-edge/route";
import { supabase } from "../../lib/db/supabase";
import { SHARP_SIGNAL_THRESHOLDS } from "../../lib/config/constants";
import { selectMarketIntelligenceSnapshotV2, type MarketIntelligenceSnapshotV2Row } from "../../lib/services/marketIntelligenceV2/snapshotSelector";
import { marketReadV2DtoFromSnapshot } from "../../lib/services/marketIntelligenceV2/dto";
import { readStringFlag } from "./_cliCommon";

type Sport = "mlb" | "wnba";
type Market = "moneyline" | "total" | "spread";
type Direction = "with" | "against" | "mixed";
type SignalType = "sharp-book price action" | "source-specific money divergence";
type Row = Record<string, any>;

type SharpSignal = {
  sport: Sport;
  market: Market;
  matchup: string;
  pick: string | null;
  side: string | null;
  direction: Direction;
  signalType: SignalType;
  sourceBook: string | null;
  timestamp: string | null;
  signalLine: number | null;
  signalPrice: number | null;
  currentLine: number | null;
  currentPrice: number | null;
  closingLine: number | null;
  closingPrice: number | null;
  finalResult: string | null;
  clv: number | null;
  helpedOrHurt: "helped" | "hurt" | "pending" | "neutral";
  grade: string | null;
  bestAngle: boolean | null;
  marketReadLabel: string | null;
  marketReadExplanation: string | null;
  sharpMoneySummary: string;
  conflictWithMarketRead: boolean;
  scope: "current_board" | "historical";
  slateDate: string | null;
};

const argv = process.argv.slice(2);
const since = readStringFlag(argv, "--since") ?? "2026-06-25";
const json = argv.includes("--json");
const minGap = SHARP_SIGNAL_THRESHOLDS.MIN_SHARP_MONEY_DIVERGENCE_PP / 100;

function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function grade(row: Row): Row {
  const g = row.prediction_grades;
  return Array.isArray(g) ? g[0] ?? {} : g ?? {};
}

function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

function americanProfit(odds: number | null, result: string | null): number | null {
  if (result === "push") return 0;
  if (result !== "win" && result !== "loss") return null;
  if (odds === null) return null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function implied(american: number | null): number | null {
  if (american === null || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

function clvFromSnapshot(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const obj = snapshot as Row;
  const clvObj = obj.clv && typeof obj.clv === "object" ? obj.clv as Row : {};
  return n(clvObj.clv_pct) ?? n(obj.clv_pct) ?? n(obj.clvPct) ?? n((obj.closing && typeof obj.closing === "object" ? obj.closing as Row : {}).clv_pct);
}

function closingFromSnapshot(snapshot: unknown): { line: number | null; price: number | null } {
  if (!snapshot || typeof snapshot !== "object") return { line: null, price: null };
  const obj = snapshot as Row;
  const closing = obj.closing && typeof obj.closing === "object" ? obj.closing as Row : {};
  return {
    line: n(closing.line) ?? n(closing.line_value) ?? n(obj.closing_line) ?? n(obj.closingLine),
    price: n(closing.odds_american) ?? n(closing.price) ?? n(obj.closing_odds_american) ?? n(obj.closingPrice),
  };
}

function detectSummary(summary: string | null | undefined): { direction: Direction; signalType: SignalType } | null {
  if (!summary) return null;
  const lower = summary.toLowerCase();
  const direction: Direction = lower.includes("mixed") ? "mixed" : lower.includes("against") ? "against" : "with";
  const signalType: SignalType = lower.includes("source-specific")
    ? "source-specific money divergence"
    : "sharp-book price action";
  return { direction, signalType };
}

function summaryFromEvidence(evidence: Row): string | null {
  const movement = evidence.marketMovementEvidence ?? {};
  const sharpWith = n(movement.sharpBooksMovingWithPick) ?? 0;
  const sharpAgainst = n(movement.sharpBooksMovingAgainstPick) ?? 0;
  if (sharpWith > sharpAgainst && sharpWith > 0) return "Sharp Money: sharp-book price action moved with our pick.";
  if (sharpAgainst > sharpWith && sharpAgainst > 0) return "Sharp Money: sharp-book price action moved against our pick.";

  const sources = Array.isArray(evidence.sharpApiSourceSpecific?.sources) ? evidence.sharpApiSourceSpecific.sources as Row[] : [];
  let withPick = 0;
  let againstPick = 0;
  for (const source of sources) {
    if (source.sourceType !== "sharp_adjacent_book") continue;
    const money = n(source.moneyPct);
    const bets = n(source.betsPct);
    if (money === null || bets === null) continue;
    const gap = money - bets;
    if (gap >= minGap) withPick++;
    else if (gap <= -minGap) againstPick++;
  }
  if (withPick > againstPick && withPick > 0) return "Sharp Money: source-specific money is showing with our pick.";
  if (againstPick > withPick && againstPick > 0) return "Sharp Money: source-specific money is showing against our pick.";
  if (withPick > 0 && againstPick > 0) return "Sharp Money: source-specific signals are mixed.";
  return null;
}

function marketReadConflict(signal: { direction: Direction }, label: string | null, explanation: string | null): boolean {
  const text = `${label ?? ""} ${explanation ?? ""}`.toLowerCase();
  const saysSupport = text.includes("support") || text.includes("toward our pick") || text.includes("leans our way");
  const saysResistance = text.includes("resistance") || text.includes("against our pick") || text.includes("not fully aligned");
  if (signal.direction === "with" && saysResistance) return true;
  if (signal.direction === "against" && saysSupport) return true;
  return false;
}

function helped(direction: Direction, result: string | null): SharpSignal["helpedOrHurt"] {
  if (direction === "mixed") return "neutral";
  if (result !== "win" && result !== "loss") return "pending";
  if (direction === "with") return result === "win" ? "helped" : "hurt";
  return result === "loss" ? "helped" : "hurt";
}

async function loadAll(table: string, select: string, configure: (q: any) => any): Promise<Row[]> {
  const pageSize = 1000;
  const out: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const q = configure(supabase.from(table).select(select).range(from, to));
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function snapshotKey(eventId: string, market: string, side: string | null): string {
  return `${eventId}:${market}:${side ?? ""}`;
}

function obsKey(eventId: string, market: string, side: string | null): string {
  return `${eventId}:${market}:${side ?? ""}`;
}

function latestBefore<T extends Row>(rows: T[], cutoffIso: string | null, timeFields: string[]): T | null {
  const cutoff = cutoffIso ? Date.parse(cutoffIso) : Number.POSITIVE_INFINITY;
  return rows
    .filter((r) => {
      const raw = timeFields.map((field) => s(r[field])).find(Boolean);
      const t = raw ? Date.parse(raw) : Number.NaN;
      return Number.isFinite(t) && t <= cutoff;
    })
    .sort((a, b) => {
      const ta = Date.parse(timeFields.map((field) => s(a[field])).find(Boolean) ?? "");
      const tb = Date.parse(timeFields.map((field) => s(b[field])).find(Boolean) ?? "");
      return tb - ta;
    })[0] ?? null;
}

function sourceSpecificDetail(splitRows: Row[], eventId: string, market: Market, side: string | null, direction: Direction, cutoff: string | null): Row | null {
  const candidates = splitRows.filter((r) => {
    if (String(r.canonical_event_id) !== eventId) return false;
    if (r.market_type !== market) return false;
    if (r.selection_key !== snapshotKey(eventId, market, side)) return false;
    if (r.provider !== "sharpapi" || r.source_type !== "sharp_adjacent_book") return false;
    const money = n(r.money_pct);
    const bets = n(r.bets_pct);
    if (money === null || bets === null) return false;
    const gap = money - bets;
    if (direction === "with") return gap >= minGap;
    if (direction === "against") return gap <= -minGap;
    return Math.abs(gap) >= minGap;
  });
  return latestBefore(candidates, cutoff, ["source_observed_at", "fetched_at"]);
}

function sharpPriceDetail(priceRows: Row[], eventId: string, market: Market, side: string | null, cutoff: string | null): Row | null {
  const candidates = priceRows.filter((r) =>
    String(r.canonical_event_id) === eventId &&
    r.market_type === market &&
    r.selection_key === snapshotKey(eventId, market, side) &&
    r.sharp_book === true
  );
  return latestBefore(candidates, cutoff, ["provider_timestamp", "fetched_at"]);
}

function buildSignal(opts: {
  scope: SharpSignal["scope"];
  sport: Sport;
  market: Market;
  matchup: string;
  pick: string | null;
  side: string | null;
  slateDate: string | null;
  readLabel: string | null;
  readExplanation: string | null;
  sharpSummary: string;
  result: string | null;
  grade: string | null;
  bestAngle: boolean | null;
  selectedLine: number | null;
  selectedPrice: number | null;
  snapshot: Row | null;
  splitRows: Row[];
  priceRows: Row[];
  snapshotJson?: unknown;
}): SharpSignal | null {
  const detected = detectSummary(opts.sharpSummary);
  if (!detected) return null;
  const eventId = String(opts.snapshot?.canonical_event_id ?? "");
  const movement = (opts.snapshot?.evidence_json?.marketMovementEvidence ?? {}) as Row;
  const cutoff = s(opts.snapshot?.generated_at) ?? s(opts.snapshot?.evidence_as_of);
  const sourceRow = detected.signalType === "source-specific money divergence"
    ? sourceSpecificDetail(opts.splitRows, eventId, opts.market, opts.side, detected.direction, cutoff)
    : null;
  const priceRow = detected.signalType === "sharp-book price action"
    ? sharpPriceDetail(opts.priceRows, eventId, opts.market, opts.side, cutoff)
    : null;
  const close = closingFromSnapshot(opts.snapshotJson);
  const clv = clvFromSnapshot(opts.snapshotJson);
  const result = opts.result;
  return {
    sport: opts.sport,
    market: opts.market,
    matchup: opts.matchup,
    pick: opts.pick,
    side: opts.side,
    direction: detected.direction,
    signalType: detected.signalType,
    sourceBook: s(sourceRow?.source_book) ?? s(priceRow?.sportsbook),
    timestamp: s(sourceRow?.source_observed_at) ?? s(sourceRow?.fetched_at) ?? s(priceRow?.provider_timestamp) ?? s(priceRow?.fetched_at) ?? s(movement.observedAt) ?? s(opts.snapshot?.evidence_as_of),
    signalLine: n(sourceRow?.market_line) ?? n(priceRow?.line) ?? n(movement.firstTrackedLine),
    signalPrice: n(sourceRow?.market_price) ?? n(priceRow?.american_price) ?? n(movement.firstTrackedPrice),
    currentLine: opts.selectedLine ?? n(movement.currentLine),
    currentPrice: opts.selectedPrice ?? n(movement.currentPrice),
    closingLine: close.line,
    closingPrice: close.price,
    finalResult: result,
    clv,
    helpedOrHurt: helped(detected.direction, result),
    grade: opts.grade,
    bestAngle: opts.bestAngle,
    marketReadLabel: opts.readLabel,
    marketReadExplanation: opts.readExplanation,
    sharpMoneySummary: opts.sharpSummary,
    conflictWithMarketRead: marketReadConflict(detected, opts.readLabel, opts.readExplanation),
    scope: opts.scope,
    slateDate: opts.slateDate,
  };
}

async function currentBoardSignals(splitRows: Row[], priceRows: Row[], snapshotsByKey: Map<string, MarketIntelligenceSnapshotV2Row[]>): Promise<SharpSignal[]> {
  const out: SharpSignal[] = [];
  for (const sport of ["mlb", "wnba"] as const) {
    const response = await dailyEdgeGet(new Request(`http://localhost/api/lab/daily-edge?sport=${sport}`));
    const board = await response.json() as Row;
    const games = Array.isArray(board.games) ? board.games as Row[] : [];
    for (const game of games) {
      const markets = game.markets && typeof game.markets === "object" ? game.markets as Row : {};
      for (const [dtoKey, rawMarket] of Object.entries(markets)) {
        if (dtoKey === "first_inning" && sport !== "wnba") continue;
        const market: Market = sport === "wnba" && dtoKey === "first_inning" ? "spread" : dtoKey as Market;
        if (market !== "moneyline" && market !== "total" && market !== "spread") continue;
        const m = rawMarket as Row;
        const read = m.marketReadV2 as Row | null;
        const sharpSummary = s(read?.sourceSummary?.sharpMoney);
        if (!sharpSummary) continue;
        const side = s(market === "moneyline" || market === "spread" ? inferTeamSide(game, m.pick) : String(m.pick ?? "").toLowerCase());
        const eventId = String(game.external_id);
        const key = obsKey(eventId, market, side);
        const snapshot = snapshotsByKey.get(key)?.find((r) => r.generated_at === read?.generatedAt) ?? snapshotsByKey.get(key)?.[0] ?? null;
        const signal = buildSignal({
          scope: "current_board",
          sport,
          market,
          matchup: `${game.awayTeam}@${game.homeTeam}`,
          pick: s(m.pick),
          side,
          slateDate: s(board.date),
          readLabel: s(read?.label),
          readExplanation: s(read?.explanation),
          sharpSummary,
          result: null,
          grade: s(m.grade) ?? s(m.verdict?.key),
          bestAngle: s(m.grade) === "best_signal" || s(m.verdict?.key) === "best_angle",
          selectedLine: n(m.line),
          selectedPrice: n(m.priceAmerican),
          snapshot: snapshot as Row | null,
          splitRows,
          priceRows,
        });
        if (signal) out.push(signal);
      }
    }
  }
  return out;
}

function inferTeamSide(game: Row, pick: unknown): string | null {
  const p = String(pick ?? "");
  if (!p) return null;
  if (p === String(game.homeTeam)) return "home";
  if (p === String(game.awayTeam)) return "away";
  return null;
}

async function historicalSignals(splitRows: Row[], priceRows: Row[], snapshots: MarketIntelligenceSnapshotV2Row[]): Promise<SharpSignal[]> {
  const records = await loadAll(
    "prediction_records",
    "id, sport, slate_date, game_id, matchup, market, pick, side, line_value, odds_american, locked_at, published_at, created_at, play_grade, best_angle, snapshot_json, prediction_grades(result,actual_home_score,actual_away_score,actual_total,graded_at)",
    (q) => q.gte("slate_date", since).in("sport", ["mlb", "wnba"]).in("market", ["moneyline", "total", "spread"]).order("slate_date", { ascending: true }),
  );
  const gameIds = [...new Set(records.map((r) => Number(r.game_id)).filter(Number.isFinite))];
  const games = gameIds.length > 0
    ? await loadAll("games", "id, external_id, game_date, status", (q) => q.in("id", gameIds))
    : [];
  const gameById = new Map(games.map((g) => [Number(g.id), g]));
  const out: SharpSignal[] = [];
  for (const r of records) {
    const sport = r.sport as Sport;
    const market = r.market as Market;
    if ((sport !== "mlb" && sport !== "wnba") || !["moneyline", "total", "spread"].includes(market)) continue;
    const game = gameById.get(Number(r.game_id));
    const eventId = String(game?.external_id ?? "");
    if (!eventId) continue;
    const side = s(r.side);
    const selectionKey = snapshotKey(eventId, market, side);
    const lockedAt = s(r.locked_at);
    const cutoff = lockedAt ?? s(r.published_at) ?? s(r.created_at) ?? s(game?.game_date) ?? new Date().toISOString();
    const snapshot = selectMarketIntelligenceSnapshotV2({
      rows: snapshots,
      mode: lockedAt ? { kind: "locked", recommendationLockedAt: lockedAt, recommendationSnapshotId: null } : { kind: "unlocked", responseAsOf: cutoff },
      canonicalEventId: eventId,
      marketType: market,
      selectionKey,
    });
    if (!snapshot) continue;
    const dto = marketReadV2DtoFromSnapshot(snapshot);
    const summary = dto?.sourceSummary.sharpMoney ?? summaryFromEvidence(snapshot.evidence_json as Row);
    if (!summary) continue;
    const g = grade(r);
    const result = s(g.result);
    const signal = buildSignal({
      scope: "historical",
      sport,
      market,
      matchup: s(r.matchup) ?? eventId,
      pick: s(r.pick),
      side,
      slateDate: s(r.slate_date),
      readLabel: dto?.label ?? s(snapshot.label),
      readExplanation: dto?.explanation ?? s(snapshot.explanation),
      sharpSummary: summary,
      result,
      grade: s(r.play_grade),
      bestAngle: r.best_angle === true,
      selectedLine: n(r.line_value),
      selectedPrice: n(r.odds_american),
      snapshot: snapshot as Row,
      splitRows,
      priceRows,
      snapshotJson: r.snapshot_json,
    });
    if (signal) out.push(signal);
  }
  return out;
}

function summarize(rows: SharpSignal[]) {
  const by = (fn: (r: SharpSignal) => string) => rows.reduce<Record<string, number>>((acc, row) => {
    const key = fn(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const settled = rows.filter((r) => r.finalResult === "win" || r.finalResult === "loss" || r.finalResult === "push");
  const withRows = settled.filter((r) => r.direction === "with");
  const againstRows = settled.filter((r) => r.direction === "against");
  const metric = (arr: SharpSignal[]) => {
    const w = arr.filter((r) => r.finalResult === "win").length;
    const l = arr.filter((r) => r.finalResult === "loss").length;
    const p = arr.filter((r) => r.finalResult === "push").length;
    const profits = arr.map((r) => americanProfit(r.currentPrice, r.finalResult)).filter((x): x is number => x !== null);
    const clvs = arr.map((r) => r.clv).filter((x): x is number => x !== null);
    return {
      record: p > 0 ? `${w}-${l}-${p}` : `${w}-${l}`,
      roiPct: profits.length ? +(100 * profits.reduce((a, b) => a + b, 0) / profits.length).toFixed(1) : null,
      avgClv: clvs.length ? +(clvs.reduce((a, b) => a + b, 0) / clvs.length).toFixed(3) : null,
      samples: arr.length,
    };
  };
  return {
    total: rows.length,
    withPick: rows.filter((r) => r.direction === "with").length,
    againstPick: rows.filter((r) => r.direction === "against").length,
    mixed: rows.filter((r) => r.direction === "mixed").length,
    bySportMarket: by((r) => `${r.sport}:${r.market}`),
    bySignalType: by((r) => r.signalType),
    settledWithUs: metric(withRows),
    settledAgainstUs: metric(againstRows),
    falsePositives: rows.filter((r) => r.helpedOrHurt === "hurt").length,
    conflictsWithMarketRead: rows.filter((r) => r.conflictWithMarketRead).length,
  };
}

async function main(): Promise<void> {
  const snapshots = await loadAll(
    "market_intelligence_snapshots_v2",
    "id, canonical_event_id, canonical_market_id, selection_key, league, market_type, resolver_version, score, label, explanation, evidence_json, generated_at, evidence_as_of, event_start_time, recommendation_snapshot_id, recommendation_locked_at, selected_side, selected_line, selected_price, validity_status",
    (q) => q.gte("generated_at", `${since}T00:00:00Z`).in("league", ["mlb", "wnba"]).order("generated_at", { ascending: false }),
  ) as MarketIntelligenceSnapshotV2Row[];
  const eventIds = [...new Set(snapshots.map((r) => String(r.canonical_event_id)))];
  const splitRows = eventIds.length > 0
    ? await loadAll(
        "market_split_observations_v2",
        "canonical_event_id, canonical_market_id, league, market_type, selection_key, provider, source_book, source_type, bets_pct, money_pct, market_line, market_price, source_observed_at, fetched_at",
        (q) => q.in("canonical_event_id", eventIds).in("league", ["mlb", "wnba"]),
      )
    : [];
  const priceRows = eventIds.length > 0
    ? await loadAll(
        "market_price_observations_v2",
        "canonical_event_id, canonical_market_id, league, sportsbook, sharp_book, market_type, selection_key, line, american_price, provider_timestamp, fetched_at",
        (q) => q.in("canonical_event_id", eventIds).in("league", ["mlb", "wnba"]),
      )
    : [];

  const snapshotsByKey = new Map<string, MarketIntelligenceSnapshotV2Row[]>();
  for (const row of snapshots) {
    const key = obsKey(String(row.canonical_event_id), row.market_type, String(row.selected_side ?? row.selection_key.split(":").at(-1) ?? ""));
    const list = snapshotsByKey.get(key) ?? [];
    list.push(row);
    snapshotsByKey.set(key, list);
  }

  const current = await currentBoardSignals(splitRows, priceRows, snapshotsByKey);
  const historical = await historicalSignals(splitRows, priceRows, snapshots);
  const report = {
    since,
    generatedAt: new Date().toISOString(),
    currentBoard: {
      summary: summarize(current),
      rows: current,
    },
    historical: {
      summary: summarize(historical),
      rows: historical,
    },
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`# Sharp Money validation audit`);
  console.log(`since=${since}`);
  console.log(`generatedAt=${report.generatedAt}`);
  console.log(`\n## Current board summary`);
  console.log(JSON.stringify(report.currentBoard.summary, null, 2));
  console.log(`\n## Current board rows`);
  for (const r of current) {
    console.log([
      r.sport.toUpperCase(),
      r.market,
      r.matchup,
      `pick=${r.pick}`,
      `dir=${r.direction}`,
      `type=${r.signalType}`,
      `book=${r.sourceBook ?? "n/a"}`,
      `ts=${r.timestamp ?? "n/a"}`,
      `signal=${r.signalLine ?? "n/a"}/${r.signalPrice ?? "n/a"}`,
      `current=${r.currentLine ?? "n/a"}/${r.currentPrice ?? "n/a"}`,
      `read=${r.marketReadLabel}`,
      `conflict=${r.conflictWithMarketRead}`,
    ].join(" | "));
  }
  console.log(`\n## Historical summary`);
  console.log(JSON.stringify(report.historical.summary, null, 2));
  console.log(`\n## Historical settled rows`);
  for (const r of historical.filter((x) => x.finalResult && x.finalResult !== "pending")) {
    console.log([
      r.slateDate,
      r.sport.toUpperCase(),
      r.market,
      r.matchup,
      `pick=${r.pick}`,
      `dir=${r.direction}`,
      `type=${r.signalType}`,
      `book=${r.sourceBook ?? "n/a"}`,
      `result=${r.finalResult}`,
      `help=${r.helpedOrHurt}`,
      `clv=${r.clv ?? "n/a"}`,
      `conflict=${r.conflictWithMarketRead}`,
    ].join(" | "));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
