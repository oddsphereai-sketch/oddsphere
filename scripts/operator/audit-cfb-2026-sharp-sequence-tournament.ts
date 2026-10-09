#!/usr/bin/env tsx

/** SELECT-only CFB market-sequence tournament. No provider calls or writes. */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  readCfbForwardMarketHistory,
  readCfbForwardWriterEvidence,
} from "../../lib/services/football/cfbForwardEvidenceStore";
import type { CfbForwardContextFamily } from "../../lib/services/football/cfbForwardEvidenceCapture";
import type {
  CfbForwardEvidencePayload,
  CfbForwardMarketHistoryEvidence,
  CfbForwardPlaybookSplit,
  CfbForwardStoredEvidence,
} from "../../lib/services/football/cfbForwardEvidence";
import { matchesCfbForwardEvidencePayloadHash } from "../../lib/services/football/cfbForwardEvidence";
import type { CfbSharpApiSplitRecord } from "../../lib/services/football/cfbSharpApiSplits";
import { readCfbCurrentAdvancedState } from "../../lib/services/football/cfbCurrentAdvancedState";
import { getCfbV1WeeklyForecasts } from "../../lib/services/football/cfbV1WeeklyForecast";
import { resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import { buildCfbNamedBookPriceHierarchy } from "../../lib/services/football/cfbSharpApiOdds";
import { fetchCfbTheOddsApiHistoricalOpenings } from "../../lib/services/football/cfbTheOddsApiFallback";
import {
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketSharpAwareForecast,
  summarizePmf,
  tiltCfbMarginWithinTotals,
  tiltCfbTotalWithinMargins,
} from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { applyCfbVerifiedAvailabilityGradeCap } from "../../lib/services/football/cfbVerifiedAvailability";
import { buildCfbV1DecisionBundle, type CfbV1Forecast } from "../../lib/services/football/cfbV1Decision";
import { isGameInCfbWeeklyWindow, resolveCfbVisibleWindows } from "../../lib/services/football/cfbWeeklyWindow";
import {
  currentCfbMovementContextBook,
  runCfbForwardEvidenceWriter,
  type CfbForwardAuditForecast,
} from "../../lib/services/football/cfbForwardEvidenceWriter";
import { targetExcludedCfbContextFamilies } from "./cfb-sharp-sequence-audit-helpers";
import { applyCfbCompleteMarketReader } from "../../lib/services/football/cfbCompleteMarketReader";

loadEnvConfig(process.cwd());

type Market = "moneyline" | "spread" | "total";
type Side = "first" | "second";
type Result = "win" | "loss" | "push";
type Block = "development" | "confirmation" | "holdout";
type FinalGame = { external_id: string | number; status: string | null; away_score: number | null; home_score: number | null };
type Forecast = {
  expectedMarginHome: number;
  expectedTotal: number;
  homeWinProbability?: number;
  pmf?: Array<{ home: number; away: number; probability: number }>;
};
type Move = { source: string; sourceClass: "named" | "retail"; side: Side; channel: "line" | "price"; magnitude: number; firstAt: string; lastAt: string; line: number | null; keyCross: boolean; reversed: boolean; priceBeforeLine: boolean };
type SplitRead = { provenance: "named_sharp" | "fallback" | "public"; side: Side; gapPp: number; moneyPct: number; ticketsPct: number; firstAt: string; lastAt: string; moneyAccelerationPp: number | null };
type Game = {
  gameId: string;
  date: string;
  kickoffAt: string;
  awayTeam: string;
  homeTeam: string;
  awayFbs: boolean;
  homeFbs: boolean;
  awayConferenceId: number | null;
  homeConferenceId: number | null;
  independent: Forecast;
  authoritative: Forecast;
  targetLines: Record<Market, number | null>;
  targetGrades: Record<Market, string>;
  targetPrices: Record<Market, number | null>;
  awayScore: number;
  homeScore: number;
  histories: CfbForwardMarketHistoryEvidence[];
};
type Signal = { candidate: string; game: Game; market: Market; source: string; side: Side; line: number | null };
type Evaluation = { candidate: string; market: Market; gameId: string; date: string; block: Block; source: string; result: Result; authoritativeResult: Result; disagrees: boolean; correction: boolean; harm: boolean; authoritativeAxisError: number; reflectedAxisError: number };
type Trail = {
  source: string;
  sourceClass: "named" | "retail";
  openingAxis: number | null;
  currentAxis: number | null;
  openingProbability: number;
  currentProbability: number;
  moveCount: number;
  reversalCount: number;
  firstMoveAt: string | null;
  lastMoveAt: string | null;
};
type ResidualRow = {
  game: Game;
  marginFeatures: Record<string, number>;
  totalFeatures: Record<string, number>;
  actualMargin: number;
  actualTotal: number;
};
type RidgeModel = { names: string[]; means: number[]; scales: number[]; beta: number[]; prior?: number };
type ResidualConfig = { lambda: number; weight: number; threshold: number };
type LockedPredictionRow = {
  id: number;
  external_id: string | number;
  market: string;
  locked_at: string;
  snapshot_json: Record<string, unknown> | null;
};

const MARKETS: Market[] = ["moneyline", "spread", "total"];
const NAMED = new Set(["circa", "pinnacle", "bookmaker"]);
const SHARP_CURRENT_MINUTES = 120;
const MONEY_ACCELERATION_PP = 5;
const TOTAL_REFLECTION_CHRONOLOGICAL_SUPPORT_POINTS = 3.675883412119532;

const SOURCE_PRIORITY = new Map([
  ["circa", 0],
  ["pinnacle", 1],
  ["bookmaker", 2],
]);

function canonical(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function fairFirst(landmark: CfbForwardContextFamily[5]): number { const first = implied(landmark[4]); const second = implied(landmark[5]); return first / (first + second); }
function blockFor(date: string): Block { return date <= "2026-09-27" ? "development" : date <= "2026-10-04" ? "confirmation" : "holdout"; }
function isFinal(row: FinalGame | undefined): row is FinalGame { return Boolean(row && ["final", "completed", "post"].includes(row.status?.trim().toLowerCase() ?? "") && Number.isFinite(row.away_score) && Number.isFinite(row.home_score)); }
function families(history: CfbForwardMarketHistoryEvidence, market: Market): CfbForwardContextFamily[] { return targetExcludedCfbContextFamilies(history, market); }

async function readResults(client: SupabaseClient, ids: string[]): Promise<Map<string, FinalGame>> {
  const output = new Map<string, FinalGame>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await client.from("games").select("external_id,status,away_score,home_score").eq("sport", "cfb").in("external_id", ids.slice(index, index + 150));
    if (error) throw new Error(`CFB result read failed: ${error.message}`);
    for (const row of (data ?? []) as FinalGame[]) output.set(String(row.external_id), row);
  }
  return output;
}

async function readOfficialLockSelections(client: SupabaseClient): Promise<{
  byGame: Map<string, { payloadSha256: string; lockedAt: string }>;
  incompatibleGames: Array<{ gameId: string; hashes: string[] }>;
}> {
  const rows: LockedPredictionRow[] = [];
  for (let from = 0; from < 10_000; from += 500) {
    const { data, error } = await client.from("prediction_records")
      .select("id,external_id,market,locked_at,snapshot_json")
      .eq("sport", "cfb")
      .gte("slate_date", "2026-09-19")
      .not("locked_at", "is", null)
      .order("id", { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error(`CFB official lock read failed: ${error.message}`);
    const page = (data ?? []) as LockedPredictionRow[];
    rows.push(...page);
    if (page.length < 500) break;
  }
  const superseded = new Set(rows.flatMap((row) => {
    const value = row.snapshot_json?.supersedes_prediction_record_id;
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  }));
  const current = rows.filter((row) => !superseded.has(row.id) && MARKETS.includes(row.market as Market));
  const grouped = new Map<string, LockedPredictionRow[]>();
  for (const row of current) grouped.set(String(row.external_id), [...(grouped.get(String(row.external_id)) ?? []), row]);
  const byGame = new Map<string, { payloadSha256: string; lockedAt: string }>();
  const incompatibleGames: Array<{ gameId: string; hashes: string[] }> = [];
  for (const [gameId, gameRows] of grouped) {
    const hashes = [...new Set(gameRows.flatMap((row) => {
      const value = row.snapshot_json?.evidence_payload_sha256;
      return typeof value === "string" && value ? [value] : [];
    }))];
    if (hashes.length !== 1) {
      incompatibleGames.push({ gameId, hashes });
      continue;
    }
    const lockedAt = gameRows.map((row) => row.locked_at).sort().at(-1)!;
    byGame.set(gameId, { payloadSha256: hashes[0]!, lockedAt });
  }
  return { byGame, incompatibleGames };
}

async function readEvidenceByHashes(client: SupabaseClient, hashes: string[]): Promise<CfbForwardStoredEvidence[]> {
  type Row = {
    id: string;
    provider_game_id: string;
    stage: string;
    captured_at: string;
    game_start_at: string;
    payload_sha256: string;
    payload: CfbForwardEvidencePayload;
  };
  const output: CfbForwardStoredEvidence[] = [];
  for (let index = 0; index < hashes.length; index += 50) {
    const { data, error } = await client.from("cfb_forward_evidence_snapshots")
      .select("id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload")
      .in("payload_sha256", hashes.slice(index, index + 50));
    if (error) throw new Error(`CFB official evidence read failed: ${error.message}`);
    for (const row of (data ?? []) as Row[]) {
      if (!matchesCfbForwardEvidencePayloadHash(row.payload, row.payload_sha256)) {
        throw new Error(`CFB official evidence ${row.id} checksum mismatch.`);
      }
      output.push({
        id: row.id,
        providerGameId: row.provider_game_id,
        stage: row.payload.stage,
        capturedAt: row.payload.capturedAt,
        gameStartAt: new Date(row.game_start_at).toISOString(),
        payloadSha256: row.payload_sha256,
        payload: row.payload,
      });
    }
  }
  return output;
}

async function readMarketHistoryBatched(
  client: SupabaseClient,
  providerGameIds: string[],
  batchSize = 20,
): Promise<CfbForwardMarketHistoryEvidence[]> {
  const output: CfbForwardMarketHistoryEvidence[] = [];
  for (let index = 0; index < providerGameIds.length; index += batchSize) {
    output.push(...await readCfbForwardMarketHistory({
      client,
      season: 2026,
      providerGameIds: providerGameIds.slice(index, index + batchSize),
    }));
  }
  return output;
}

function moveAt(market: Market, family: CfbForwardContextFamily): Omit<Move, "source" | "sourceClass" | "firstAt" | "lastAt" | "keyCross" | "reversed" | "priceBeforeLine"> | null {
  const opening = family[4]; const current = family[5];
  if (!opening || opening[2] === "x" || current[2] === "x" || opening[0] >= current[0]) return null;
  if (market !== "moneyline" && opening[3] !== null && current[3] !== null) {
    const delta = current[3] - opening[3];
    if (Math.abs(delta) >= 0.5) return { side: market === "spread" ? (delta < 0 ? "second" : "first") : (delta > 0 ? "first" : "second"), channel: "line", magnitude: Math.abs(delta), line: current[3] };
    if (Math.abs(delta) > 1e-9) return null;
  }
  const deltaPp = 100 * (fairFirst(current) - fairFirst(opening));
  return Math.abs(deltaPp) >= 1 ? { side: deltaPp > 0 ? "first" : "second", channel: "price", magnitude: Math.abs(deltaPp), line: current[3] } : null;
}

function crossedKey(market: Market, opening: number | null, current: number | null): boolean {
  if (opening === null || current === null || market === "moneyline") return false;
  const keys = market === "spread" ? [-17, -14, -10, -7, -3, 0, 3, 7, 10, 14, 17] : [41, 44, 47, 51, 55];
  return keys.some((key) => (opening < key && current >= key) || (opening > key && current <= key));
}

function marketMoves(histories: CfbForwardMarketHistoryEvidence[], market: Market): Move[] {
  const bySource = new Map<string, Array<{ at: string; family: CfbForwardContextFamily; move: ReturnType<typeof moveAt> }>>();
  for (const history of histories) for (const family of families(history, market)) {
    const source = canonical(family[0]); const move = moveAt(market, family);
    bySource.set(source, [...(bySource.get(source) ?? []), { at: history.capturedAt, family, move }]);
  }
  return [...bySource.entries()].flatMap(([source, rows]): Move[] => {
    const moved = rows.filter((row): row is typeof row & { move: NonNullable<typeof row.move> } => row.move !== null).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = moved[0]; const last = moved.at(-1); if (!first || !last) return [];
    const opening = first.family[4]?.[3] ?? null; const current = last.family[5][3];
    const firstLine = moved.find((row) => row.move.channel === "line");
    const priceBeforeLine = Boolean(firstLine && moved.some((row) =>
      row.move.channel === "price" && row.move.side === firstLine.move.side &&
      Date.parse(row.family[5][0]) < Date.parse(firstLine.family[5][0])));
    return [{ source, sourceClass: NAMED.has(source) ? "named" : "retail", side: last.move.side, channel: last.move.channel, magnitude: last.move.magnitude, firstAt: first.family[5][0], lastAt: last.family[5][0], line: last.move.line, keyCross: crossedKey(market, opening, current), reversed: moved.some((row) => row.move.side !== last.move.side), priceBeforeLine }];
  });
}

function splitGap(side: { moneyPct: number; ticketsPct: number }): number { return side.moneyPct - side.ticketsPct; }
function playbookSide(split: CfbForwardPlaybookSplit, market: Market): { side: Side; gap: number; money: number; tickets: number } | null {
  if (market === "total") {
    if ([split.overMoneyPct, split.overBetsPct, split.underMoneyPct, split.underBetsPct].some((value) => value === null)) return null;
    const first = split.overMoneyPct! - split.overBetsPct!; const second = split.underMoneyPct! - split.underBetsPct!;
    if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
    return { side: first >= second ? "first" : "second", gap: first >= second ? first : second, money: first >= second ? split.overMoneyPct! : split.underMoneyPct!, tickets: first >= second ? split.overBetsPct! : split.underBetsPct! };
  }
  if ([split.awayMoneyPct, split.awayBetsPct, split.homeMoneyPct, split.homeBetsPct].some((value) => value === null)) return null;
  const first = split.awayMoneyPct! - split.awayBetsPct!; const second = split.homeMoneyPct! - split.homeBetsPct!;
  if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
  return { side: first >= second ? "first" : "second", gap: first >= second ? first : second, money: first >= second ? split.awayMoneyPct! : split.homeMoneyPct!, tickets: first >= second ? split.awayBetsPct! : split.homeBetsPct! };
}
function sharpSide(record: CfbSharpApiSplitRecord, market: Market): { side: Side; gap: number; money: number; tickets: number } | null {
  if (market === "total" && record.total) { const first = splitGap(record.total.over); const second = splitGap(record.total.under); if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null; return { side: first >= second ? "first" : "second", gap: first >= second ? first : second, money: first >= second ? record.total.over.moneyPct : record.total.under.moneyPct, tickets: first >= second ? record.total.over.ticketsPct : record.total.under.ticketsPct }; }
  const value = market === "moneyline" ? record.moneyline : record.spread;
  if (!value) return null; const first = splitGap(value.away); const second = splitGap(value.home);
  if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
  return { side: first >= second ? "first" : "second", gap: first >= second ? first : second, money: first >= second ? value.away.moneyPct : value.home.moneyPct, tickets: first >= second ? value.away.ticketsPct : value.home.ticketsPct };
}

function splitReads(histories: CfbForwardMarketHistoryEvidence[], market: Market): SplitRead[] {
  const buckets = new Map<string, Array<{ at: string; side: Side; gap: number; money: number; tickets: number; provenance: SplitRead["provenance"] }>>();
  for (const history of histories) {
    const publicSplit = history.payload.market.playbookSplits?.[market] ?? null;
    const publicRead = publicSplit ? playbookSide(publicSplit, market) : null;
    if (publicSplit && publicRead) buckets.set("public", [...(buckets.get("public") ?? []), { at: publicSplit.capturedAt, ...publicRead, provenance: "public" }]);
    for (const record of history.payload.market.sharpApiSplits ?? []) {
      const read = sharpSide(record, market); if (!read) continue;
      const provenance: SplitRead["provenance"] = record.sportsbook === "circa" && record.sourceSemantics === "sharp_adjacent" ? "named_sharp" : "fallback";
      const key = `${provenance}:${canonical(record.sportsbook)}`;
      buckets.set(key, [...(buckets.get(key) ?? []), { at: record.capturedAt, ...read, provenance }]);
    }
  }
  return [...buckets.values()].flatMap((values): SplitRead[] => {
    const unique = [...new Map(values.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map((value) => [`${value.at}:${value.side}:${value.gap}:${value.money}`, value])).values()];
    const first = unique[0]; const last = unique.at(-1); if (!first || !last) return [];
    const firstComparable = unique.find((value) => value.side === last.side) ?? first;
    return [{ provenance: last.provenance, side: last.side, gapPp: last.gap, moneyPct: last.money, ticketsPct: last.tickets, firstAt: first.at, lastAt: last.at, moneyAccelerationPp: last.side === firstComparable.side ? last.money - firstComparable.money : null }];
  });
}

function splitChronology(split: SplitRead, move: Move): { chronology: "money_before_move" | "move_before_money" | "contemporaneous"; freshness: "current" | "stale" } {
  const splitAt = Date.parse(split.lastAt);
  const moveAt = Date.parse(move.firstAt);
  const differenceMinutes = (splitAt - moveAt) / 60_000;
  const chronology = differenceMinutes < -30 ? "money_before_move" : differenceMinutes > 30 ? "move_before_money" : "contemporaneous";
  const ageMinutes = chronology === "money_before_move" ? -differenceMinutes : Math.abs((Date.parse(move.lastAt) - splitAt) / 60_000);
  return { chronology, freshness: ageMinutes <= SHARP_CURRENT_MINUTES ? "current" : "stale" };
}

function publicTicketSide(split: CfbForwardPlaybookSplit | null, market: Market): Side | null {
  if (!split) return null;
  const first = market === "total" ? split.overBetsPct : split.awayBetsPct; const second = market === "total" ? split.underBetsPct : split.homeBetsPct;
  return first !== null && second !== null && Math.abs(first - second) >= 10 ? first > second ? "first" : "second" : null;
}
function latestPublic(histories: CfbForwardMarketHistoryEvidence[], market: Market): CfbForwardPlaybookSplit | null {
  return histories.flatMap((history) => history.payload.market.playbookSplits?.[market] ? [history.payload.market.playbookSplits[market]!] : []).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] ?? null;
}
function sideAt(forecast: Forecast, market: Market, line: number | null): Side { if (market === "moneyline") return forecast.expectedMarginHome < 0 ? "first" : "second"; if (market === "spread") return -forecast.expectedMarginHome > (line ?? 0) ? "first" : "second"; return forecast.expectedTotal > (line ?? forecast.expectedTotal) ? "first" : "second"; }
function modelGap(game: Game, market: Market, line: number | null): number {
  if (market === "moneyline") return Math.abs(game.independent.expectedMarginHome);
  if (market === "spread") return Math.abs(game.independent.expectedMarginHome - -(line ?? 0));
  return Math.abs(game.independent.expectedTotal - (line ?? game.independent.expectedTotal));
}
function targetLine(game: Game, market: Market): number | null { return game.targetLines[market]; }
function isHomeDecisionSide(side: string, homeTeam: string): boolean {
  return side === "home" || side === homeTeam || side.startsWith(`${homeTeam} `);
}
function settle(game: Game, market: Market, side: Side, line: number | null): Result { const value = market === "moneyline" ? game.awayScore - game.homeScore : market === "spread" ? game.awayScore - game.homeScore - (line ?? 0) : game.awayScore + game.homeScore - (line ?? 0); if (Math.abs(value) < 1e-9) return "push"; return (value > 0 ? "first" : "second") === side ? "win" : "loss"; }
function settleExactDecision(args: {
  market: Market;
  side: string;
  line: number | null;
  awayTeam: string;
  awayScore: number;
  homeScore: number;
}): Result {
  let value: number;
  if (args.market === "moneyline") {
    value = args.side === args.awayTeam ? args.awayScore - args.homeScore : args.homeScore - args.awayScore;
  } else if (args.market === "spread") {
    const selectedAway = args.side.startsWith(`${args.awayTeam} `);
    value = selectedAway
      ? args.awayScore + (args.line ?? 0) - args.homeScore
      : args.homeScore + (args.line ?? 0) - args.awayScore;
  } else {
    const total = args.awayScore + args.homeScore;
    value = args.side.startsWith("Over ") ? total - (args.line ?? 0) : (args.line ?? 0) - total;
  }
  return Math.abs(value) < 1e-9 ? "push" : value > 0 ? "win" : "loss";
}
function dedupeSignals(signals: Signal[]): Signal[] {
  const retained = new Map<string, Signal>();
  for (const signal of signals) {
    const key = `${signal.candidate}:${signal.game.gameId}:${signal.market}`;
    const prior = retained.get(key);
    const signalPriority = SOURCE_PRIORITY.get(signal.source) ?? 100;
    const priorPriority = prior ? SOURCE_PRIORITY.get(prior.source) ?? 100 : Number.POSITIVE_INFINITY;
    if (!prior || signalPriority < priorPriority ||
      (signalPriority === priorPriority && signal.source.localeCompare(prior.source) < 0)) {
      retained.set(key, signal);
    }
  }
  return [...retained.values()];
}
function evaluate(signal: Signal): Evaluation {
  const baseSide = sideAt(signal.game.authoritative, signal.market, signal.line); const result = settle(signal.game, signal.market, signal.side, signal.line); const authoritativeResult = settle(signal.game, signal.market, baseSide, signal.line); const disagrees = signal.side !== baseSide;
  const actual = signal.market === "total" ? signal.game.awayScore + signal.game.homeScore : signal.game.homeScore - signal.game.awayScore; const expected = signal.market === "total" ? signal.game.authoritative.expectedTotal : signal.game.authoritative.expectedMarginHome; const boundary = signal.market === "moneyline" ? 0 : signal.market === "spread" ? -(signal.line ?? 0) : signal.line ?? expected;
  return { candidate: signal.candidate, market: signal.market, gameId: signal.game.gameId, date: signal.game.date, block: blockFor(signal.game.date), source: signal.source, result, authoritativeResult, disagrees, correction: disagrees && result === "win" && authoritativeResult === "loss", harm: disagrees && result === "loss" && authoritativeResult === "win", authoritativeAxisError: Math.abs(expected - actual), reflectedAxisError: Math.abs((2 * boundary - expected) - actual) };
}
function metrics(rows: Evaluation[]) { const resolved = rows.filter((row) => row.result !== "push"); const base = rows.filter((row) => row.authoritativeResult !== "push"); const disagree = rows.filter((row) => row.disagrees); return { games: new Set(rows.map((row) => row.gameId)).size, dates: [...new Set(rows.map((row) => row.date))].sort(), wins: resolved.filter((row) => row.result === "win").length, losses: resolved.filter((row) => row.result === "loss").length, pushes: rows.length - resolved.length, authoritativeWins: base.filter((row) => row.authoritativeResult === "win").length, authoritativeLosses: base.filter((row) => row.authoritativeResult === "loss").length, disagreements: disagree.length, corrections: disagree.filter((row) => row.correction).length, harms: disagree.filter((row) => row.harm).length, authoritativeMae: disagree.length ? disagree.reduce((sum, row) => sum + row.authoritativeAxisError, 0) / disagree.length : null, reflectedMae: disagree.length ? disagree.reduce((sum, row) => sum + row.reflectedAxisError, 0) / disagree.length : null } as const; }
function summarize(rows: Evaluation[]) { return Object.fromEntries([...new Set(rows.map((row) => `${row.market}:${row.candidate}`))].sort().map((key) => { const [market, candidate] = key.split(":") as [Market, string]; const selected = rows.filter((row) => row.market === market && row.candidate === candidate); const overall = metrics(selected); const byBlock = Object.fromEntries((["development", "confirmation", "holdout"] as const).map((block) => [block, metrics(selected.filter((row) => row.block === block))])); const confirmation = byBlock.confirmation; const holdout = byBlock.holdout; const passes = overall.games >= 12 && overall.dates.length >= 3 && confirmation.disagreements >= 4 && holdout.disagreements >= 2 && confirmation.corrections > confirmation.harms && holdout.corrections > holdout.harms && confirmation.reflectedMae !== null && confirmation.authoritativeMae !== null && confirmation.reflectedMae <= confirmation.authoritativeMae && holdout.reflectedMae !== null && holdout.authoritativeMae !== null && holdout.reflectedMae <= holdout.authoritativeMae; return [key, { overall, byBlock, passes }]; })); }
function binomialCoefficient(n: number, k: number): number {
  const selected = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= selected; index += 1) result = result * (n - selected + index) / index;
  return result;
}
function oneSidedCorrectionPValue(corrections: number, harms: number): number | null {
  const total = corrections + harms;
  if (total === 0 || corrections <= harms) return null;
  let probability = 0;
  for (let wins = corrections; wins <= total; wins += 1) probability += binomialCoefficient(total, wins) * (0.5 ** total);
  return probability;
}

function median(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle]! : (finite[middle - 1]! + finite[middle]!) / 2;
}

function average(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function standardDeviation(values: number[]): number | null {
  const mean = average(values);
  if (mean === null || values.length < 2) return values.length ? 0 : null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function axisValue(market: Market, landmark: CfbForwardContextFamily[5]): number | null {
  if (market === "moneyline") return null;
  if (landmark[3] === null) return null;
  return market === "spread" ? -landmark[3] : landmark[3];
}

function probabilityValue(market: Market, landmark: CfbForwardContextFamily[5]): number {
  const first = fairFirst(landmark);
  return market === "total" ? first : 1 - first;
}

function marketTrails(histories: CfbForwardMarketHistoryEvidence[], market: Market): Trail[] {
  const bySource = new Map<string, Array<{ opening: CfbForwardContextFamily[4]; current: CfbForwardContextFamily[5] }>>();
  for (const history of histories) {
    for (const family of families(history, market)) {
      const source = canonical(family[0]);
      bySource.set(source, [...(bySource.get(source) ?? []), { opening: family[4], current: family[5] }]);
    }
  }
  return [...bySource.entries()].flatMap(([source, observations]): Trail[] => {
    const ordered = observations.sort((a, b) => Date.parse(a.current[0]) - Date.parse(b.current[0]));
    const first = ordered[0];
    const last = ordered.at(-1);
    if (!first || !last) return [];
    const opening = ordered.flatMap((row) => row.opening ? [row.opening] : []).sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))[0] ?? first.current;
    const deltas: number[] = [];
    const deltaTimes: string[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      const prior = ordered[index - 1]!.current;
      const current = ordered[index]!.current;
      const priorValue = market === "moneyline" ? probabilityValue(market, prior) : axisValue(market, prior);
      const currentValue = market === "moneyline" ? probabilityValue(market, current) : axisValue(market, current);
      if (priorValue !== null && currentValue !== null && Math.abs(currentValue - priorValue) > 1e-9) {
        deltas.push(currentValue - priorValue);
        deltaTimes.push(current[0]);
      }
    }
    let reversalCount = 0;
    for (let index = 1; index < deltas.length; index += 1) if (Math.sign(deltas[index]!) !== Math.sign(deltas[index - 1]!)) reversalCount += 1;
    return [{
      source,
      sourceClass: NAMED.has(source) ? "named" : "retail",
      openingAxis: axisValue(market, opening),
      currentAxis: axisValue(market, last.current),
      openingProbability: probabilityValue(market, opening),
      currentProbability: probabilityValue(market, last.current),
      moveCount: deltas.length,
      reversalCount,
      firstMoveAt: deltas.length ? ordered[1]?.current[0] ?? last.current[0] : null,
      lastMoveAt: deltaTimes.at(-1) ?? null,
    }];
  });
}

function signedSplit(read: SplitRead, axis: "margin" | "total"): number {
  const positive = axis === "margin" ? read.side === "second" : read.side === "first";
  return (positive ? 1 : -1) * Math.abs(read.gapPp);
}

function addTrailFeatures(
  output: Record<string, number>,
  prefix: string,
  trails: Trail[],
  kickoffAt: string,
  detailed: boolean,
): void {
  for (const sourceClass of ["all", "named", "retail"] as const) {
    const selected = sourceClass === "all" ? trails : trails.filter((trail) => trail.sourceClass === sourceClass);
    const currentAxis = median(selected.flatMap((trail) => trail.currentAxis === null ? [] : [trail.currentAxis]));
    const openingAxis = median(selected.flatMap((trail) => trail.openingAxis === null ? [] : [trail.openingAxis]));
    const currentProbability = median(selected.map((trail) => trail.currentProbability));
    const openingProbability = median(selected.map((trail) => trail.openingProbability));
    if (currentAxis !== null) output[`${prefix}_${sourceClass}_current_axis`] = currentAxis;
    if (openingAxis !== null) output[`${prefix}_${sourceClass}_opening_axis`] = openingAxis;
    if (currentAxis !== null && openingAxis !== null) output[`${prefix}_${sourceClass}_axis_move`] = currentAxis - openingAxis;
    if (currentProbability !== null) output[`${prefix}_${sourceClass}_current_probability`] = currentProbability;
    if (openingProbability !== null) output[`${prefix}_${sourceClass}_opening_probability`] = openingProbability;
    if (currentProbability !== null && openingProbability !== null) output[`${prefix}_${sourceClass}_probability_move`] = currentProbability - openingProbability;
    output[`${prefix}_${sourceClass}_source_count`] = selected.length;
    output[`${prefix}_${sourceClass}_move_count`] = selected.reduce((sum, trail) => sum + trail.moveCount, 0);
    output[`${prefix}_${sourceClass}_reversal_count`] = selected.reduce((sum, trail) => sum + trail.reversalCount, 0);
    output[`${prefix}_${sourceClass}_late_6h_count`] = selected.filter((trail) => trail.firstMoveAt && (Date.parse(kickoffAt) - Date.parse(trail.firstMoveAt)) / 60_000 <= 360).length;
  }
  if (!detailed) return;
  const axisDispersion = standardDeviation(trails.flatMap((trail) => trail.currentAxis === null ? [] : [trail.currentAxis]));
  const probabilityDispersion = standardDeviation(trails.map((trail) => trail.currentProbability));
  if (axisDispersion !== null) output[`${prefix}_current_axis_dispersion`] = axisDispersion;
  if (probabilityDispersion !== null) output[`${prefix}_current_probability_dispersion`] = probabilityDispersion;
  for (const source of ["circa", "pinnacle", "bookmaker"] as const) {
    const trail = trails.find((candidate) => candidate.source === source);
    if (!trail) continue;
    if (trail.currentAxis !== null) output[`${prefix}_${source}_current_axis`] = trail.currentAxis;
    if (trail.openingAxis !== null) output[`${prefix}_${source}_opening_axis`] = trail.openingAxis;
    if (trail.currentAxis !== null && trail.openingAxis !== null) output[`${prefix}_${source}_axis_move`] = trail.currentAxis - trail.openingAxis;
    output[`${prefix}_${source}_current_probability`] = trail.currentProbability;
    output[`${prefix}_${source}_probability_move`] = trail.currentProbability - trail.openingProbability;
    output[`${prefix}_${source}_move_count`] = trail.moveCount;
    output[`${prefix}_${source}_reversal_count`] = trail.reversalCount;
  }
  const named = trails.filter((trail) => trail.sourceClass === "named");
  const retail = trails.filter((trail) => trail.sourceClass === "retail");
  const namedAxisMove = average(named.flatMap((trail) => trail.currentAxis === null || trail.openingAxis === null ? [] : [trail.currentAxis - trail.openingAxis]));
  const retailAxisMove = average(retail.flatMap((trail) => trail.currentAxis === null || trail.openingAxis === null ? [] : [trail.currentAxis - trail.openingAxis]));
  const namedProbabilityMove = average(named.map((trail) => trail.currentProbability - trail.openingProbability));
  const retailProbabilityMove = average(retail.map((trail) => trail.currentProbability - trail.openingProbability));
  if (namedAxisMove !== null && retailAxisMove !== null) output[`${prefix}_named_retail_axis_move_interaction`] = namedAxisMove * retailAxisMove;
  if (namedProbabilityMove !== null && retailProbabilityMove !== null) output[`${prefix}_named_retail_probability_move_interaction`] = namedProbabilityMove * retailProbabilityMove;
  const firstNamed = named.flatMap((trail) => trail.firstMoveAt ? [{ source: trail.source, at: Date.parse(trail.firstMoveAt) }] : []).sort((a, b) => a.at - b.at)[0];
  const firstRetail = retail.flatMap((trail) => trail.firstMoveAt ? [{ at: Date.parse(trail.firstMoveAt) }] : []).sort((a, b) => a.at - b.at)[0];
  if (firstNamed) output[`${prefix}_named_leader_${firstNamed.source}`] = 1;
  if (firstNamed && firstRetail) output[`${prefix}_named_lead_minutes`] = (firstRetail.at - firstNamed.at) / 60_000;
  for (const sourceClass of ["named", "retail"] as const) {
    const selected = sourceClass === "named" ? named : retail;
    const firstMinutes = median(selected.flatMap((trail) => trail.firstMoveAt
      ? [(Date.parse(kickoffAt) - Date.parse(trail.firstMoveAt)) / 60_000]
      : []));
    const lastMinutes = median(selected.flatMap((trail) => trail.lastMoveAt
      ? [(Date.parse(kickoffAt) - Date.parse(trail.lastMoveAt)) / 60_000]
      : []));
    if (firstMinutes !== null) output[`${prefix}_${sourceClass}_first_move_minutes_to_kickoff`] = firstMinutes;
    if (lastMinutes !== null) output[`${prefix}_${sourceClass}_last_move_minutes_to_kickoff`] = lastMinutes;
  }
}

function rawSplitFeatures(histories: CfbForwardMarketHistoryEvidence[], market: Market, axis: "margin" | "total"): Record<string, number> {
  const output: Record<string, number> = {};
  const buckets = new Map<string, Array<{ at: string; signedGap: number; signedMoney: number; signedTickets: number; provenance: string }>>();
  for (const history of histories) {
    const publicSplit = history.payload.market.playbookSplits?.[market] ?? null;
    if (publicSplit) {
      const firstMoney = market === "total" ? publicSplit.overMoneyPct : publicSplit.awayMoneyPct;
      const firstTickets = market === "total" ? publicSplit.overBetsPct : publicSplit.awayBetsPct;
      const secondMoney = market === "total" ? publicSplit.underMoneyPct : publicSplit.homeMoneyPct;
      const secondTickets = market === "total" ? publicSplit.underBetsPct : publicSplit.homeBetsPct;
      if ([firstMoney, firstTickets, secondMoney, secondTickets].every((value) => value !== null)) {
        const sign = axis === "margin" ? -1 : 1;
        const signedMoney = sign * (firstMoney! - secondMoney!);
        const signedTickets = sign * (firstTickets! - secondTickets!);
        buckets.set("public", [...(buckets.get("public") ?? []), { at: publicSplit.capturedAt, signedGap: signedMoney - signedTickets, signedMoney, signedTickets, provenance: "public" }]);
      }
    }
    for (const record of history.payload.market.sharpApiSplits ?? []) {
      const first = market === "total"
        ? record.total?.over ?? null
        : (market === "moneyline" ? record.moneyline : record.spread)?.away ?? null;
      const second = market === "total"
        ? record.total?.under ?? null
        : (market === "moneyline" ? record.moneyline : record.spread)?.home ?? null;
      if (!first || !second) continue;
      const sign = axis === "margin" ? -1 : 1;
      const signedMoney = sign * (first.moneyPct - second.moneyPct);
      const signedTickets = sign * (first.ticketsPct - second.ticketsPct);
      const provenance = record.sportsbook === "circa" && record.sourceSemantics === "sharp_adjacent" ? "named_sharp" : `fallback_${canonical(record.sportsbook)}`;
      buckets.set(provenance, [...(buckets.get(provenance) ?? []), { at: record.capturedAt, signedGap: signedMoney - signedTickets, signedMoney, signedTickets, provenance }]);
    }
  }
  for (const [provenance, values] of buckets) {
    const ordered = values.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = ordered[0]!;
    const last = ordered.at(-1)!;
    output[`raw_split_${provenance}_gap`] = last.signedGap;
    output[`raw_split_${provenance}_money`] = last.signedMoney;
    output[`raw_split_${provenance}_tickets`] = last.signedTickets;
    output[`raw_split_${provenance}_gap_change`] = last.signedGap - first.signedGap;
    output[`raw_split_${provenance}_money_change`] = last.signedMoney - first.signedMoney;
    output[`raw_split_${provenance}_observations`] = ordered.length;
  }
  return output;
}

function residualFeatures(game: Game, axis: "margin" | "total", detailed = true): Record<string, number> {
  const output: Record<string, number> = {
    independent_margin: game.independent.expectedMarginHome,
    independent_margin_abs: Math.abs(game.independent.expectedMarginHome),
    independent_total: game.independent.expectedTotal,
    both_fbs: Number(game.awayFbs && game.homeFbs),
    fbs_mismatch: Number(game.awayFbs !== game.homeFbs),
    same_conference: Number(game.awayConferenceId !== null && game.awayConferenceId === game.homeConferenceId),
  };
  const primaryMarket: Market = axis === "margin" ? "spread" : "total";
  const primaryTrails = marketTrails(game.histories, primaryMarket);
  addTrailFeatures(output, primaryMarket, primaryTrails, game.kickoffAt, detailed);
  if (axis === "margin") addTrailFeatures(output, "moneyline", marketTrails(game.histories, "moneyline"), game.kickoffAt, detailed);
  const primaryCurrent = median(primaryTrails.flatMap((trail) => trail.currentAxis === null ? [] : [trail.currentAxis]));
  const primaryOpening = median(primaryTrails.flatMap((trail) => trail.openingAxis === null ? [] : [trail.openingAxis]));
  const independent = axis === "margin" ? game.independent.expectedMarginHome : game.independent.expectedTotal;
  if (primaryCurrent !== null) output.market_disagreement = primaryCurrent - independent;
  if (primaryOpening !== null) output.opening_disagreement = primaryOpening - independent;
  if (primaryCurrent !== null && primaryOpening !== null) output.market_path = primaryCurrent - primaryOpening;
  const reads = splitReads(game.histories, primaryMarket);
  for (const provenance of ["named_sharp", "fallback", "public"] as const) {
    const selected = reads.filter((read) => read.provenance === provenance);
    const signed = average(selected.map((read) => signedSplit(read, axis)));
    const signedMoneyMajority = average(selected.map((read) => {
      const positive = axis === "margin" ? read.side === "second" : read.side === "first";
      return (positive ? 1 : -1) * (read.moneyPct - 50);
    }));
    const signedTicketMajority = average(selected.map((read) => {
      const positive = axis === "margin" ? read.side === "second" : read.side === "first";
      return (positive ? 1 : -1) * (read.ticketsPct - 50);
    }));
    const acceleration = average(selected.flatMap((read) => read.moneyAccelerationPp === null ? [] : [Math.sign(signedSplit(read, axis)) * Math.abs(read.moneyAccelerationPp)]));
    if (signed !== null) output[`split_${provenance}`] = signed;
    if (signedMoneyMajority !== null) output[`split_${provenance}_money_majority`] = signedMoneyMajority;
    if (signedTicketMajority !== null) output[`split_${provenance}_ticket_majority`] = signedTicketMajority;
    if (acceleration !== null) output[`split_${provenance}_acceleration`] = acceleration;
    output[`split_${provenance}_count`] = selected.length;
    if (signed !== null && output.market_path !== undefined) output[`split_${provenance}_path_alignment`] = signed * output.market_path;
    if (signed !== null && output.market_disagreement !== undefined) output[`split_${provenance}_disagreement_alignment`] = signed * output.market_disagreement;
  }
  if (detailed) Object.assign(output, rawSplitFeatures(game.histories, primaryMarket, axis));
  const namedCurrent = output[`${primaryMarket}_named_current_axis`];
  const retailCurrent = output[`${primaryMarket}_retail_current_axis`];
  if (namedCurrent !== undefined && retailCurrent !== undefined) output.named_retail_axis_gap = namedCurrent - retailCurrent;
  const namedMove = output[`${primaryMarket}_named_axis_move`];
  const retailMove = output[`${primaryMarket}_retail_axis_move`];
  if (namedMove !== undefined && retailMove !== undefined) output.named_retail_move_product = namedMove * retailMove;
  return output;
}

function solveLinear(matrix: number[][], vector: number[]): number[] {
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < matrix.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < matrix.length; row += 1) if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    if (Math.abs(divisor) < 1e-12) continue;
    for (let entry = column; entry <= matrix.length; entry += 1) augmented[column]![entry] /= divisor;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let entry = column; entry <= matrix.length; entry += 1) augmented[row]![entry] -= factor * augmented[column]![entry]!;
    }
  }
  return augmented.map((row, index) => Number.isFinite(row[matrix.length]!) ? row[matrix.length]! : index === 0 ? average(vector) ?? 0 : 0);
}

function fitRidge(rows: ResidualRow[], axis: "margin" | "total", lambda: number): RidgeModel {
  const featureKey = axis === "margin" ? "marginFeatures" : "totalFeatures";
  const names = [...new Set(rows.flatMap((row) => Object.keys(row[featureKey])))].sort();
  const means = names.map((name) => average(rows.flatMap((row) => row[featureKey][name] === undefined ? [] : [row[featureKey][name]!])) ?? 0);
  const scales = names.map((name, index) => {
    const values = rows.flatMap((row) => row[featureKey][name] === undefined ? [] : [row[featureKey][name]!]);
    const mean = means[index]!;
    const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
    return Math.sqrt(variance) || 1;
  });
  const x = rows.map((row) => [1, ...names.map((name, index) => ((row[featureKey][name] ?? means[index]!) - means[index]!) / scales[index]!) ]);
  const y = rows.map((row) => axis === "margin" ? row.actualMargin - row.game.independent.expectedMarginHome : row.actualTotal - row.game.independent.expectedTotal);
  const size = names.length + 1;
  const xtx = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  const xty = Array.from({ length: size }, () => 0);
  for (let row = 0; row < x.length; row += 1) for (let first = 0; first < size; first += 1) {
    xty[first] += x[row]![first]! * y[row]!;
    for (let second = 0; second < size; second += 1) xtx[first]![second] += x[row]![first]! * x[row]![second]!;
  }
  for (let index = 1; index < size; index += 1) xtx[index]![index] += lambda;
  return { names, means, scales, beta: solveLinear(xtx, xty) };
}

function predictRidge(model: RidgeModel, features: Record<string, number>): number {
  return model.beta[0]! + model.names.reduce((sum, name, index) => sum + model.beta[index + 1]! * (((features[name] ?? model.means[index]!) - model.means[index]!) / model.scales[index]!), 0);
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-Math.min(value, 35)));
  const exponential = Math.exp(Math.max(value, -35));
  return exponential / (1 + exponential);
}

function fitPosterior(
  rows: ResidualRow[],
  axis: "margin" | "total",
  lambda: number,
): RidgeModel {
  const market = axis === "margin" ? "spread" : "total";
  const featureKey = axis === "margin" ? "marginFeatures" : "totalFeatures";
  const eligible = rows.filter((row) => row[featureKey][`${market}_all_current_axis`] !== undefined);
  const names = [...new Set(eligible.flatMap((row) => Object.keys(row[featureKey])))].sort();
  const means = names.map((name) => average(eligible.flatMap((row) => row[featureKey][name] === undefined ? [] : [row[featureKey][name]!])) ?? 0);
  const scales = names.map((name, index) => {
    const values = eligible.flatMap((row) => row[featureKey][name] === undefined ? [] : [row[featureKey][name]!]);
    const mean = means[index]!;
    const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
    return Math.sqrt(variance) || 1;
  });
  const x = eligible.map((row) => [1, ...names.map((name, index) => ((row[featureKey][name] ?? means[index]!) - means[index]!) / scales[index]!) ]);
  const y = eligible.map((row) => {
    const active = axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal;
    const actual = axis === "margin" ? row.actualMargin : row.actualTotal;
    const boundary = row[featureKey][`${market}_all_current_axis`]!;
    const alternative = 2 * boundary - active;
    return Math.abs(alternative - actual) < Math.abs(active - actual) ? 1 : 0;
  });
  const beta = Array.from({ length: names.length + 1 }, () => 0);
  const prevalence = Math.min(0.99, Math.max(0.01, (average(y) ?? 0.5)));
  beta[0] = Math.log(prevalence / (1 - prevalence));
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const size = beta.length;
    const hessian = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    const gradient = Array.from({ length: size }, () => 0);
    for (let row = 0; row < x.length; row += 1) {
      const probability = sigmoid(x[row]!.reduce((sum, value, index) => sum + value * beta[index]!, 0));
      const weight = Math.max(1e-6, probability * (1 - probability));
      for (let first = 0; first < size; first += 1) {
        gradient[first] += x[row]![first]! * (y[row]! - probability);
        for (let second = 0; second < size; second += 1) hessian[first]![second] += x[row]![first]! * weight * x[row]![second]!;
      }
    }
    for (let index = 1; index < beta.length; index += 1) {
      hessian[index]![index] += lambda;
      gradient[index] -= lambda * beta[index]!;
    }
    const step = solveLinear(hessian, gradient);
    let largest = 0;
    for (let index = 0; index < beta.length; index += 1) { beta[index] += step[index]!; largest = Math.max(largest, Math.abs(step[index]!)); }
    if (largest < 1e-7) break;
  }
  return { names, means, scales, beta, prior: prevalence };
}

function predictPosterior(model: RidgeModel, features: Record<string, number>): number {
  return sigmoid(model.beta[0]! + model.names.reduce((sum, name, index) => sum + model.beta[index + 1]! * (((features[name] ?? model.means[index]!) - model.means[index]!) / model.scales[index]!), 0));
}

function posteriorAxis(row: ResidualRow, axis: "margin" | "total", model: RidgeModel): number {
  const market = axis === "margin" ? "spread" : "total";
  const features = axis === "margin" ? row.marginFeatures : row.totalFeatures;
  const boundary = features[`${market}_all_current_axis`];
  const active = axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal;
  if (boundary === undefined) return active;
  const alternative = 2 * boundary - active;
  const probability = predictPosterior(model, features);
  return (1 - probability) * active + probability * alternative;
}

function logit(value: number): number {
  const bounded = Math.min(1 - 1e-6, Math.max(1e-6, value));
  return Math.log(bounded / (1 - bounded));
}

function posteriorResidualAxis(row: ResidualRow, axis: "margin" | "total", model: RidgeModel, evidenceScale = 1): number {
  const market = axis === "margin" ? "spread" : "total";
  const features = axis === "margin" ? row.marginFeatures : row.totalFeatures;
  const boundary = features[`${market}_all_current_axis`];
  const active = axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal;
  if (boundary === undefined) return active;
  const alternative = 2 * boundary - active;
  const posterior = predictPosterior(model, features);
  const prior = model.prior ?? 0.5;
  const strength = Math.tanh(evidenceScale * (logit(posterior) - logit(prior)));
  return active + strength * (alternative - active);
}

function hasObservedMarketReadingEvidence(features: Record<string, number>, market: Market): boolean {
  const movementKeys = [
    `${market}_all_axis_move`,
    `${market}_all_probability_move`,
    `${market}_named_axis_move`,
    `${market}_named_probability_move`,
    `${market}_retail_axis_move`,
    `${market}_retail_probability_move`,
  ];
  const sequenceKeys = [
    `${market}_all_reversal_count`,
    `${market}_named_reversal_count`,
    `${market}_retail_reversal_count`,
  ];
  const splitKeys = ["split_named_sharp", "split_fallback", "split_public"];
  return movementKeys.some((key) => Math.abs(features[key] ?? 0) > 1e-12) ||
    sequenceKeys.some((key) => (features[key] ?? 0) > 0) ||
    splitKeys.some((key) => features[key] !== undefined);
}

function hasObservedAxisMarketReadingEvidence(features: Record<string, number>, axis: "margin" | "total"): boolean {
  if (axis === "total") return hasObservedMarketReadingEvidence(features, "total");
  return hasObservedMarketReadingEvidence(features, "spread") ||
    hasObservedMarketReadingEvidence(features, "moneyline");
}

function posteriorObservedEvidenceAxis(
  row: ResidualRow,
  axis: "margin" | "total",
  model: RidgeModel,
  evidenceScale = 1,
): number {
  const features = axis === "margin" ? row.marginFeatures : row.totalFeatures;
  const active = axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal;
  if (!hasObservedAxisMarketReadingEvidence(features, axis)) return active;
  return posteriorResidualAxis(row, axis, model, evidenceScale);
}

function posteriorFlipOnlyAxis(row: ResidualRow, axis: "margin" | "total", model: RidgeModel, evidenceScale = 1): number {
  const market = axis === "margin" ? "spread" : "total";
  const features = axis === "margin" ? row.marginFeatures : row.totalFeatures;
  const boundary = features[`${market}_all_current_axis`];
  const active = axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal;
  if (boundary === undefined) return active;
  if (!hasObservedMarketReadingEvidence(features, market)) return active;
  const proposed = posteriorResidualAxis(row, axis, model, evidenceScale);
  if (lineWinner(proposed, boundary) === lineWinner(active, boundary)) return active;
  const reflected = 2 * boundary - active;
  if (axis !== "total") return reflected;
  const activeMarketDistance = Math.abs(active - boundary);
  if (activeMarketDistance <= TOTAL_REFLECTION_CHRONOLOGICAL_SUPPORT_POINTS) return reflected;
  const proposedDirection = Math.sign(proposed - boundary);
  const supportedProposed = boundary + proposedDirection * Math.min(
    Math.abs(proposed - boundary),
    TOTAL_REFLECTION_CHRONOLOGICAL_SUPPORT_POINTS,
  );
  const reflectionWeight = Math.exp(
    -(activeMarketDistance - TOTAL_REFLECTION_CHRONOLOGICAL_SUPPORT_POINTS) /
      TOTAL_REFLECTION_CHRONOLOGICAL_SUPPORT_POINTS,
  );
  return reflectionWeight * reflected + (1 - reflectionWeight) * supportedProposed;
}

function posteriorProjectionFlipOnlyAxis(row: ResidualRow, axis: "margin" | "total", model: RidgeModel, evidenceScale = 1): number {
  const market = axis === "margin" ? "spread" : "total";
  const features = axis === "margin" ? row.marginFeatures : row.totalFeatures;
  const boundary = features[`${market}_all_current_axis`];
  const active = axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal;
  if (boundary === undefined || !hasObservedMarketReadingEvidence(features, market)) return active;
  const proposed = posteriorResidualAxis(row, axis, model, evidenceScale);
  return lineWinner(proposed, boundary) === lineWinner(active, boundary) ? active : proposed;
}

function posteriorMarginDirectionalAxis(row: ResidualRow, model: RidgeModel, evidenceScale = 1): number {
  const active = row.game.authoritative.expectedMarginHome;
  const proposed = posteriorObservedEvidenceAxis(row, "margin", model, evidenceScale);
  const boundaries = [
    0,
    ...(row.game.targetLines.spread === null ? [] : [-row.game.targetLines.spread]),
  ];
  return boundaries.some((boundary) => lineWinner(proposed, boundary) !== lineWinner(active, boundary))
    ? proposed
    : active;
}

function constrainedMarketFeatures(game: Game, axis: "margin" | "total"): Record<string, number> {
  const raw = residualFeatures(game, axis, false);
  const market = axis === "margin" ? "spread" : "total";
  const names = [
    axis === "margin" ? "independent_margin" : "independent_total",
    "independent_margin_abs",
    "both_fbs",
    "fbs_mismatch",
    "same_conference",
    "market_disagreement",
    "opening_disagreement",
    "market_path",
    `${market}_all_current_axis`,
    `${market}_all_axis_move`,
    `${market}_all_probability_move`,
    `${market}_all_reversal_count`,
    `${market}_all_late_6h_count`,
    `${market}_named_axis_move`,
    `${market}_named_probability_move`,
    `${market}_named_reversal_count`,
    `${market}_named_late_6h_count`,
    `${market}_retail_axis_move`,
    `${market}_retail_probability_move`,
    `${market}_retail_reversal_count`,
    `${market}_retail_late_6h_count`,
    "named_retail_axis_gap",
    "named_retail_move_product",
    "split_named_sharp",
    "split_named_sharp_money_majority",
    "split_named_sharp_ticket_majority",
    "split_named_sharp_acceleration",
    "split_named_sharp_path_alignment",
    "split_fallback",
    "split_fallback_money_majority",
    "split_fallback_ticket_majority",
    "split_fallback_acceleration",
    "split_fallback_path_alignment",
    "split_public",
    "split_public_money_majority",
    "split_public_ticket_majority",
    "split_public_acceleration",
    "split_public_path_alignment",
  ];
  return Object.fromEntries(names.flatMap((name) => raw[name] === undefined ? [] : [[name, raw[name]!]]));
}

function professionalMarginFeatures(game: Game): Record<string, number> {
  const output = constrainedMarketFeatures(game, "margin");
  const broad = residualFeatures(game, "margin", false);
  for (const name of [
    "moneyline_all_current_probability",
    "moneyline_all_opening_probability",
    "moneyline_all_probability_move",
    "moneyline_all_reversal_count",
    "moneyline_all_late_6h_count",
    "moneyline_named_probability_move",
    "moneyline_named_reversal_count",
    "moneyline_named_late_6h_count",
    "moneyline_retail_probability_move",
    "moneyline_retail_reversal_count",
    "moneyline_retail_late_6h_count",
  ]) if (broad[name] !== undefined) output[name] = broad[name]!;
  const moneylineReads = splitReads(game.histories, "moneyline");
  for (const provenance of ["named_sharp", "fallback", "public"] as const) {
    const selected = moneylineReads.filter((read) => read.provenance === provenance);
    const signed = average(selected.map((read) => signedSplit(read, "margin")));
    const signedMoneyMajority = average(selected.map((read) => {
      const positive = read.side === "second";
      return (positive ? 1 : -1) * (read.moneyPct - 50);
    }));
    const signedTicketMajority = average(selected.map((read) => {
      const positive = read.side === "second";
      return (positive ? 1 : -1) * (read.ticketsPct - 50);
    }));
    const acceleration = average(selected.flatMap((read) => read.moneyAccelerationPp === null
      ? []
      : [Math.sign(signedSplit(read, "margin")) * Math.abs(read.moneyAccelerationPp)]));
    if (signed !== null) output[`moneyline_split_${provenance}`] = signed;
    if (signedMoneyMajority !== null) output[`moneyline_split_${provenance}_money_majority`] = signedMoneyMajority;
    if (signedTicketMajority !== null) output[`moneyline_split_${provenance}_ticket_majority`] = signedTicketMajority;
    if (acceleration !== null) output[`moneyline_split_${provenance}_acceleration`] = acceleration;
    output[`moneyline_split_${provenance}_count`] = selected.length;
    const spreadSplit = output[`split_${provenance}`];
    if (signed !== null && spreadSplit !== undefined) {
      output[`cross_market_split_${provenance}_product`] = signed * spreadSplit;
      output[`cross_market_split_${provenance}_agreement`] = Math.sign(signed) === Math.sign(spreadSplit) ? 1 : -1;
    }
  }
  const spreadMove = output.spread_all_axis_move;
  const moneylineMove = output.moneyline_all_probability_move;
  if (spreadMove !== undefined && moneylineMove !== undefined) {
    output.cross_market_move_product = spreadMove * moneylineMove;
    output.cross_market_move_agreement = Math.sign(spreadMove) === Math.sign(moneylineMove) ? 1 : -1;
  }
  const currentSpread = output.spread_all_current_axis;
  if (currentSpread !== undefined) {
    output.short_spread_3 = Number(Math.abs(currentSpread) <= 3);
    output.short_spread_7 = Number(Math.abs(currentSpread) <= 7);
    if (moneylineMove !== undefined) output.short_spread_3_moneyline_move = output.short_spread_3 * moneylineMove;
    for (const provenance of ["named_sharp", "fallback", "public"] as const) {
      const moneylineSplit = output[`moneyline_split_${provenance}`];
      const spreadSplit = output[`split_${provenance}`];
      if (moneylineSplit !== undefined) output[`short_spread_3_moneyline_split_${provenance}`] = output.short_spread_3 * moneylineSplit;
      if (spreadSplit !== undefined) output[`short_spread_3_spread_split_${provenance}`] = output.short_spread_3 * spreadSplit;
    }
  }
  return output;
}

function spreadKeyCrossFeatures(game: Game): Record<string, number> {
  const output: Record<string, number> = {};
  const trails = marketTrails(game.histories, "spread");
  const keys = [-14, -10, -7, -3, 0, 3, 7, 10, 14];
  let crossings = 0;
  let namedCrossings = 0;
  for (const trail of trails) {
    if (trail.openingAxis === null || trail.currentAxis === null) continue;
    const openingAxis = trail.openingAxis;
    const currentAxis = trail.currentAxis;
    const crossed = keys.filter((key) =>
      (openingAxis < key && currentAxis >= key) ||
      (openingAxis > key && currentAxis <= key));
    crossings += crossed.length;
    if (trail.sourceClass === "named") namedCrossings += crossed.length;
    if (crossed.includes(0)) output.spread_pickem_cross = Math.sign(currentAxis - openingAxis);
  }
  output.spread_key_cross_count = crossings;
  output.spread_named_key_cross_count = namedCrossings;
  return output;
}

function professionalReconciliationMarginFeatures(
  game: Game,
  detail: "moneyline" | "full",
): Record<string, number> {
  const output = {
    ...reconciliationMarginFeatures(game),
    ...professionalMarginFeatures(game),
  };
  if (detail === "moneyline") return output;

  const detailed = residualFeatures(game, "margin", true);
  for (const [name, value] of Object.entries(detailed)) {
    if (
      /^(moneyline|spread)_(circa|pinnacle|bookmaker)_/.test(name) ||
      /^(moneyline|spread)_current_(axis|probability)_dispersion$/.test(name) ||
      /^(moneyline|spread)_named_(leader_|lead_minutes|first_move_minutes_to_kickoff|last_move_minutes_to_kickoff)/.test(name) ||
      /^(moneyline|spread)_retail_(first_move_minutes_to_kickoff|last_move_minutes_to_kickoff)/.test(name)
    ) output[name] = value;
  }
  Object.assign(output, spreadKeyCrossFeatures(game));
  const moneylineRawSplits = rawSplitFeatures(game.histories, "moneyline", "margin");
  for (const [name, value] of Object.entries(moneylineRawSplits)) {
    output[`moneyline_${name}`] = value;
  }
  return output;
}

function reconciliationMarginFeatures(game: Game): Record<string, number> {
  const output = residualFeatures(game, "margin", false);
  const active = game.authoritative.expectedMarginHome;
  const independent = game.independent.expectedMarginHome;
  const legacyShift = active - independent;
  output.active_margin = active;
  output.legacy_margin_shift = legacyShift;
  output.legacy_margin_shift_abs = Math.abs(legacyShift);
  output.legacy_moneyline_side_changed = Number(winner(active) !== winner(independent));
  const current = output.spread_all_current_axis;
  if (current !== undefined) {
    output.active_market_disagreement = current - active;
    output.active_market_disagreement_abs = Math.abs(current - active);
    output.independent_market_disagreement_abs = Math.abs(current - independent);
    output.legacy_market_distance_change = Math.abs(current - active) - Math.abs(current - independent);
    output.legacy_spread_side_changed = Number(lineWinner(active, current) !== lineWinner(independent, current));
    output.legacy_reflection_signature = legacyShift * (current - independent);
  }
  return output;
}

function runConstrainedPosteriorResidualTournament(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: constrainedMarketFeatures(game, "margin"),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const selectionTrain = rows.filter((row) => row.game.date <= "2026-09-20");
  const selection = rows.filter((row) => row.game.date >= "2026-09-25" && row.game.date <= "2026-09-27");
  const confirmation = rows.filter((row) => row.game.date >= "2026-10-02" && row.game.date <= "2026-10-04");
  const microHoldout = rows.filter((row) => row.game.date >= "2026-10-07");
  const configs = [10, 30, 100, 300, 1000, 3000].flatMap((lambda) =>
    [0.1, 0.25, 0.5, 0.75, 1].map((evidenceScale) => ({ lambda, evidenceScale })));
  const baselineSelection = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal);
  const totalCandidates = configs.map((config) => {
    const model = fitPosterior(selectionTrain, "total", config.lambda);
    const metrics = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => posteriorFlipOnlyAxis(row, "total", model, config.evidenceScale));
    const improvesBoth = metrics.totalMae <= baselineSelection.totalMae &&
      (metrics.total.accuracy ?? 0) > (baselineSelection.total.accuracy ?? 0);
    return { config, metrics, improvesBoth, objective: metrics.totalMae + 6 * (1 - (metrics.total.accuracy ?? 0)) };
  }).sort((a, b) => Number(b.improvesBoth) - Number(a.improvesBoth) ||
    (a.improvesBoth && b.improvesBoth ? a.metrics.totalMae - b.metrics.totalMae : a.objective - b.objective) ||
    a.metrics.totalMae - b.metrics.totalMae);
  const selectedTotal = totalCandidates[0]!;
  const fitRows = [...selectionTrain, ...selection];
  const totalModel = fitPosterior(fitRows, "total", selectedTotal.config.lambda);
  const totalPrediction = (row: ResidualRow) => posteriorFlipOnlyAxis(row, "total", totalModel, selectedTotal.config.evidenceScale);
  const evaluateBlock = (blockRows: ResidualRow[]) => ({
    active: residualMetrics(blockRows, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal),
    independent: residualMetrics(blockRows, (row) => row.game.independent.expectedMarginHome, (row) => row.game.independent.expectedTotal),
    candidate: residualMetrics(blockRows, (row) => row.game.authoritative.expectedMarginHome, totalPrediction),
  });
  return {
    release: "cfb_constrained_total_market_log_odds_residual_tournament_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    architecture: "continuous_cfb_specific_evidence_posterior_with_full_conviction_preserving_flip_at_natural_side_boundary",
    split: { selectionTrain: selectionTrain.length, selection: selection.length, confirmation: confirmation.length, microHoldout: microHoldout.length },
    selectedTotal,
    selectionBaseline: baselineSelection,
    confirmation: evaluateBlock(confirmation),
    microHoldout: evaluateBlock(microHoldout),
    topTotalCandidates: totalCandidates.slice(0, 8),
    featureCount: fitPosterior(fitRows, "total", selectedTotal.config.lambda).names.length,
  };
}

function runConstrainedContinuousResidualTournament(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: constrainedMarketFeatures(game, "margin"),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const selectionTrain = rows.filter((row) => row.game.date <= "2026-09-20");
  const selection = rows.filter((row) => row.game.date >= "2026-09-25" && row.game.date <= "2026-09-27");
  const confirmation = rows.filter((row) => row.game.date >= "2026-10-02" && row.game.date <= "2026-10-04");
  const microHoldout = rows.filter((row) => row.game.date >= "2026-10-07");
  const configs = [10, 30, 100, 300, 1000, 3000].flatMap((lambda) =>
    [0.1, 0.25, 0.5, 0.75, 1].map((residualScale) => ({ lambda, residualScale })));
  const baselineSelection = residualMetrics(selection, (row) => row.game.independent.expectedMarginHome, (row) => row.game.independent.expectedTotal);
  const totalCandidates = configs.map((config) => {
    const model = fitRidge(selectionTrain, "total", config.lambda);
    const totalPrediction = (row: ResidualRow) => row.game.independent.expectedTotal + config.residualScale * predictRidge(model, row.totalFeatures);
    const metrics = residualMetrics(selection, (row) => row.game.independent.expectedMarginHome, totalPrediction);
    return { config, metrics, objective: metrics.totalMae + 6 * (1 - (metrics.total.accuracy ?? 0)) };
  }).sort((a, b) => a.objective - b.objective || a.metrics.totalMae - b.metrics.totalMae);
  const selectedTotal = totalCandidates[0]!;
  const fitRows = [...selectionTrain, ...selection];
  const totalModel = fitRidge(fitRows, "total", selectedTotal.config.lambda);
  const totalPrediction = (row: ResidualRow) => row.game.independent.expectedTotal + selectedTotal.config.residualScale * predictRidge(totalModel, row.totalFeatures);
  const evaluateBlock = (blockRows: ResidualRow[]) => ({
    active: residualMetrics(blockRows, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal),
    independent: residualMetrics(blockRows, (row) => row.game.independent.expectedMarginHome, (row) => row.game.independent.expectedTotal),
    candidate: residualMetrics(blockRows, (row) => row.game.independent.expectedMarginHome, totalPrediction),
  });
  return {
    release: "cfb_constrained_total_continuous_residual_tournament_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    architecture: "continuous_regularized_independent_score_error_from_cfb_specific_market_evidence_no_market_target_no_thresholds",
    split: { selectionTrain: selectionTrain.length, selection: selection.length, confirmation: confirmation.length, microHoldout: microHoldout.length },
    selectedTotal,
    selectionBaseline: baselineSelection,
    confirmation: evaluateBlock(confirmation),
    microHoldout: evaluateBlock(microHoldout),
    topTotalCandidates: totalCandidates.slice(0, 8),
    featureCount: totalModel.names.length,
  };
}

function interventionSummary(
  rows: ResidualRow[],
  market: Market,
  activePrediction: (row: ResidualRow) => number,
  candidatePrediction: (row: ResidualRow) => number,
) {
  const eligible = rows.flatMap((row) => {
    const line = market === "moneyline" ? 0 : row.game.targetLines[market];
    if (line === null) return [];
    const boundary = market === "spread" ? -line : line;
    const actual = market === "total" ? row.actualTotal : row.actualMargin;
    const active = activePrediction(row);
    const candidate = candidatePrediction(row);
    const activeSide = lineWinner(active, boundary);
    const candidateSide = lineWinner(candidate, boundary);
    const actualSide = lineWinner(actual, boundary);
    return [{
      changed: activeSide !== candidateSide,
      correction: activeSide !== candidateSide && candidateSide === actualSide && activeSide !== actualSide,
      harm: activeSide !== candidateSide && activeSide === actualSide && candidateSide !== actualSide,
      activeDistance: Math.abs(active - boundary),
      candidateDistance: Math.abs(candidate - boundary),
      shift: candidate - active,
    }];
  });
  const changed = eligible.filter((row) => row.changed);
  return {
    eligible: eligible.length,
    flips: changed.length,
    corrections: changed.filter((row) => row.correction).length,
    harms: changed.filter((row) => row.harm).length,
    meanAbsoluteShift: average(eligible.map((row) => Math.abs(row.shift))),
    maximumAbsoluteShift: Math.max(0, ...eligible.map((row) => Math.abs(row.shift))),
    meanActiveDistanceFromLine: average(eligible.map((row) => row.activeDistance)),
    meanCandidateDistanceFromLine: average(eligible.map((row) => row.candidateDistance)),
  };
}

function evidenceRegimeSummary(
  rows: ResidualRow[],
  market: Market,
  activePrediction: (row: ResidualRow) => number,
  rawEvidencePrediction: (row: ResidualRow) => number,
  finalPrediction: (row: ResidualRow) => number,
) {
  const classified = rows.flatMap((row) => {
    const line = market === "moneyline" ? 0 : row.game.targetLines[market];
    if (line === null) return [];
    const boundary = market === "spread" ? -line : line;
    const actual = market === "total" ? row.actualTotal : row.actualMargin;
    const active = activePrediction(row);
    const raw = rawEvidencePrediction(row);
    const final = finalPrediction(row);
    const activeSide = lineWinner(active, boundary);
    const rawSide = lineWinner(raw, boundary);
    const finalSide = lineWinner(final, boundary);
    const actualSide = lineWinner(actual, boundary);
    const evidenceDistanceDelta = Math.abs(raw - boundary) - Math.abs(active - boundary);
    const regime = rawSide !== activeSide
      ? "flip"
      : evidenceDistanceDelta > 1e-9
        ? "confirmation"
        : evidenceDistanceDelta < -1e-9
          ? "resistance"
          : "neutral";
    const activeResult = actualSide === "push" ? "push" : activeSide === actualSide ? "win" : "loss";
    const finalResult = actualSide === "push" ? "push" : finalSide === actualSide ? "win" : "loss";
    return [{
      regime,
      grade: row.game.targetGrades[market],
      price: row.game.targetPrices[market],
      activeResult,
      finalResult,
      evidenceDistanceDelta,
    }];
  });
  const summarize = (selected: typeof classified) => {
    const activeWins = selected.filter((row) => row.activeResult === "win").length;
    const activeLosses = selected.filter((row) => row.activeResult === "loss").length;
    const activePushes = selected.filter((row) => row.activeResult === "push").length;
    const finalWins = selected.filter((row) => row.finalResult === "win").length;
    const finalLosses = selected.filter((row) => row.finalResult === "loss").length;
    const finalPushes = selected.filter((row) => row.finalResult === "push").length;
    const priced = selected.filter((row): row is typeof row & { price: number } => row.price !== null && Number.isFinite(row.price));
    const activeUnits = priced.reduce((units, row) => row.activeResult === "push"
      ? units
      : row.activeResult === "loss"
        ? units - 1
        : units + (row.price > 0 ? row.price / 100 : 100 / Math.abs(row.price)), 0);
    return {
      games: selected.length,
      activeWins,
      activeLosses,
      activePushes,
      activeAccuracy: activeWins + activeLosses ? activeWins / (activeWins + activeLosses) : null,
      pricedGames: priced.length,
      activeUnits,
      activeRoi: priced.length ? activeUnits / priced.length : null,
      finalWins,
      finalLosses,
      finalPushes,
      finalAccuracy: finalWins + finalLosses ? finalWins / (finalWins + finalLosses) : null,
      meanEvidenceDistanceDelta: average(selected.map((row) => row.evidenceDistanceDelta)),
    };
  };
  return Object.fromEntries(["confirmation", "resistance", "flip", "neutral"].map((regime) => {
    const selected = classified.filter((row) => row.regime === regime);
    return [regime, {
      ...summarize(selected),
      byGrade: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) =>
        [grade, summarize(selected.filter((row) => row.grade === grade))])),
    }];
  }));
}

function evidenceFlipDetails(
  rows: ResidualRow[],
  market: Market,
  model: RidgeModel,
  activePrediction: (row: ResidualRow) => number,
  rawEvidencePrediction: (row: ResidualRow) => number,
  finalPrediction: (row: ResidualRow) => number,
) {
  const axis = market === "total" ? "total" : "margin";
  return rows.flatMap((row) => {
    const line = market === "moneyline" ? 0 : row.game.targetLines[market];
    if (line === null) return [];
    const boundary = market === "spread" ? -line : line;
    const actual = market === "total" ? row.actualTotal : row.actualMargin;
    const active = activePrediction(row);
    const raw = rawEvidencePrediction(row);
    const final = finalPrediction(row);
    const activeSide = lineWinner(active, boundary);
    const rawSide = lineWinner(raw, boundary);
    if (rawSide === activeSide) return [];
    const finalSide = lineWinner(final, boundary);
    const actualSide = lineWinner(actual, boundary);
    const features = axis === "total" ? row.totalFeatures : row.marginFeatures;
    return [{
      game: `${row.game.awayTeam}@${row.game.homeTeam}`,
      date: row.game.date,
      grade: row.game.targetGrades[market],
      line,
      boundary,
      active,
      raw,
      final,
      actual,
      activeSide,
      rawSide,
      finalSide,
      actualSide,
      posterior: predictPosterior(model, features),
      prior: model.prior ?? null,
      result: finalSide === actualSide && activeSide !== actualSide
        ? "correction"
        : activeSide === actualSide && finalSide !== actualSide
          ? "harm"
          : "unchanged_or_push_transition",
      features,
    }];
  });
}

function runCombinedMarketReaderTournament(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: residualFeatures(game, "margin", false),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const developmentTrain = rows.filter((row) => row.game.date <= "2026-09-20");
  const developmentTest = rows.filter((row) => row.game.date >= "2026-09-25" && row.game.date <= "2026-09-27");
  const confirmation = rows.filter((row) => row.game.date >= "2026-10-02" && row.game.date <= "2026-10-04");
  const microHoldout = rows.filter((row) => row.game.date >= "2026-10-07");
  const evaluateFold = (training: ResidualRow[], testing: ResidualRow[]) => {
    const marginModel = fitPosterior(training, "margin", 1000);
    const totalModel = fitPosterior(training, "total", 30);
    const activeMargin = (row: ResidualRow) => row.game.authoritative.expectedMarginHome;
    const activeTotal = (row: ResidualRow) => row.game.authoritative.expectedTotal;
    const rawEvidenceMargin = (row: ResidualRow) => posteriorObservedEvidenceAxis(row, "margin", marginModel, 1);
    const candidateMargin = (row: ResidualRow) => posteriorMarginDirectionalAxis(row, marginModel, 1);
    const rawEvidenceTotal = (row: ResidualRow) => posteriorObservedEvidenceAxis(row, "total", totalModel, 1);
    const candidateTotal = (row: ResidualRow) => posteriorFlipOnlyAxis(row, "total", totalModel, 1);
    const variant = (
      margin: (row: ResidualRow) => number,
      total: (row: ResidualRow) => number,
    ) => ({
      metrics: residualMetrics(testing, margin, total),
      interventions: {
        moneyline: interventionSummary(testing, "moneyline", activeMargin, margin),
        spread: interventionSummary(testing, "spread", activeMargin, margin),
        total: interventionSummary(testing, "total", activeTotal, total),
      },
    });
    const candidateScores = testing.map((row) => {
      const margin = candidateMargin(row);
      const total = candidateTotal(row);
      return { home: (total + margin) / 2, away: (total - margin) / 2 };
    });
    return {
      trainingGames: training.length,
      testingGames: testing.length,
      active: residualMetrics(testing, activeMargin, activeTotal),
      candidate: residualMetrics(testing, candidateMargin, candidateTotal),
      variants: {
        directional: variant(candidateMargin, candidateTotal),
        continuousMarginFlipTotal: variant(rawEvidenceMargin, candidateTotal),
        flipMarginContinuousTotal: variant(candidateMargin, rawEvidenceTotal),
        continuousBoth: variant(rawEvidenceMargin, rawEvidenceTotal),
      },
      interventions: {
        moneyline: interventionSummary(testing, "moneyline", activeMargin, candidateMargin),
        spread: interventionSummary(testing, "spread", activeMargin, candidateMargin),
        total: interventionSummary(testing, "total", activeTotal, candidateTotal),
      },
      evidenceRegimes: {
        moneyline: evidenceRegimeSummary(testing, "moneyline", activeMargin, rawEvidenceMargin, candidateMargin),
        spread: evidenceRegimeSummary(testing, "spread", activeMargin, rawEvidenceMargin, candidateMargin),
        total: evidenceRegimeSummary(testing, "total", activeTotal, rawEvidenceTotal, candidateTotal),
      },
      flipDetails: {
        moneyline: evidenceFlipDetails(testing, "moneyline", marginModel, activeMargin, rawEvidenceMargin, candidateMargin),
        spread: evidenceFlipDetails(testing, "spread", marginModel, activeMargin, rawEvidenceMargin, candidateMargin),
        total: evidenceFlipDetails(testing, "total", totalModel, activeTotal, rawEvidenceTotal, candidateTotal),
      },
      coherence: {
        negativeTeamScores: candidateScores.filter((score) => score.home < 0 || score.away < 0).length,
        minimumTeamScore: Math.min(...candidateScores.flatMap((score) => [score.home, score.away])),
        maximumTeamScore: Math.max(...candidateScores.flatMap((score) => [score.home, score.away])),
      },
    };
  };
  return {
    release: "cfb_combined_independent_market_reader_tournament_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    architecture: {
      margin: "continuous_log_odds_evidence_relative_to_historical_prior_only_when_real_movement_or_split_evidence_exists",
      total: "continuous_evidence_posterior_with_full_conviction_preserving_flip_at_natural_side_boundary",
      score: "single_home_away_pair_derived_from_final_margin_and_total",
    },
    fixedDevelopmentSelectedConfiguration: {
      margin: { lambda: 1000, evidenceScale: 1 },
      total: { lambda: 30, evidenceScale: 1 },
    },
    rollingOrigin: {
      development: evaluateFold(developmentTrain, developmentTest),
      confirmation: evaluateFold([...developmentTrain, ...developmentTest], confirmation),
      microHoldout: evaluateFold([...developmentTrain, ...developmentTest, ...confirmation], microHoldout),
    },
  };
}

type ForwardPrediction = {
  date: string;
  gameId: string;
  row: ResidualRow;
  activeMargin: number;
  activeTotal: number;
  candidateMargin: number;
  candidateTotal: number;
};

function forwardMetrics(rows: ForwardPrediction[], candidate: boolean) {
  const predictions = rows.map((prediction) => ({
    row: prediction.row,
    margin: candidate ? prediction.candidateMargin : prediction.activeMargin,
    total: candidate ? prediction.candidateTotal : prediction.activeTotal,
  }));
  const marginMae = average(predictions.map(({ row, margin }) => Math.abs(margin - row.actualMargin))) ?? 0;
  const totalMae = average(predictions.map(({ row, total }) => Math.abs(total - row.actualTotal))) ?? 0;
  const teamScoreMae = average(predictions.flatMap(({ row, margin, total }) => {
    const home = (total + margin) / 2;
    const away = (total - margin) / 2;
    return [Math.abs(home - row.game.homeScore), Math.abs(away - row.game.awayScore)];
  })) ?? 0;
  const moneyline = accuracy(predictions.map(({ row, margin }) => ({ predicted: winner(margin), actual: winner(row.actualMargin) })));
  const spread = accuracy(predictions.filter(({ row }) => row.game.targetLines.spread !== null).map(({ row, margin }) => ({
    predicted: lineWinner(margin, -(row.game.targetLines.spread ?? 0)),
    actual: lineWinner(row.actualMargin, -(row.game.targetLines.spread ?? 0)),
  })));
  const total = accuracy(predictions.filter(({ row }) => row.game.targetLines.total !== null).map(({ row, total: predictedTotal }) => ({
    predicted: lineWinner(predictedTotal, row.game.targetLines.total ?? predictedTotal),
    actual: lineWinner(row.actualTotal, row.game.targetLines.total ?? row.actualTotal),
  })));
  const probability = probabilityMetrics(rows, candidate);
  return { games: rows.length, marginMae, totalMae, teamScoreMae, moneyline, spread, total, probability };
}

function probabilityMetrics(rows: ForwardPrediction[], candidate: boolean) {
  const observations = rows.flatMap((prediction) => {
    const basePmf = prediction.row.game.authoritative.pmf;
    if (!basePmf?.length) return [];
    let pmf = basePmf;
    if (candidate) {
      const marginAdjusted = tiltCfbMarginWithinTotals(
        pmf,
        prediction.candidateMargin - prediction.activeMargin,
      );
      const marginSummary = summarizePmf(marginAdjusted);
      pmf = tiltCfbTotalWithinMargins(
        marginAdjusted,
        prediction.candidateTotal - marginSummary.expectedTotal,
      );
    }
    return MARKETS.flatMap((market) => {
      const line = market === "moneyline" ? 0 : prediction.row.game.targetLines[market];
      if (line === null) return [];
      const boundary = market === "spread" ? -line : line;
      const actual = market === "total" ? prediction.row.actualTotal : prediction.row.actualMargin;
      const actualSide = lineWinner(actual, boundary);
      if (actualSide === "push") return [];
      let first = 0;
      let second = 0;
      for (const point of pmf) {
        const value = market === "total" ? point.home + point.away : point.home - point.away;
        const side = lineWinner(value, boundary);
        if (side === "first") first += point.probability;
        else if (side === "second") second += point.probability;
      }
      if (first + second <= 0) return [];
      const probabilityFirst = Math.min(1 - 1e-9, Math.max(1e-9, first / (first + second)));
      const outcomeFirst = actualSide === "first" ? 1 : 0;
      return [{
        market,
        probabilityFirst,
        outcomeFirst,
        brier: (probabilityFirst - outcomeFirst) ** 2,
        logLoss: -(outcomeFirst * Math.log(probabilityFirst) + (1 - outcomeFirst) * Math.log(1 - probabilityFirst)),
      }];
    });
  });
  return Object.fromEntries(MARKETS.map((market) => {
    const selected = observations.filter((row) => row.market === market);
    return [market, {
      games: selected.length,
      brier: average(selected.map((row) => row.brier)),
      logLoss: average(selected.map((row) => row.logLoss)),
      meanProbabilityFirst: average(selected.map((row) => row.probabilityFirst)),
      realizedFirstRate: average(selected.map((row) => row.outcomeFirst)),
    }];
  }));
}

function professionalInterventionLedger(rows: ForwardPrediction[]) {
  return rows.flatMap((prediction) => MARKETS.flatMap((market) => {
    const line = market === "moneyline" ? 0 : prediction.row.game.targetLines[market];
    if (line === null) return [];
    const boundary = market === "spread" ? -line : line;
    const actual = market === "total" ? prediction.row.actualTotal : prediction.row.actualMargin;
    const active = market === "total" ? prediction.activeTotal : prediction.activeMargin;
    const candidate = market === "total" ? prediction.candidateTotal : prediction.candidateMargin;
    const activeSide = lineWinner(active, boundary);
    const candidateSide = lineWinner(candidate, boundary);
    const actualSide = lineWinner(actual, boundary);
    const activeResult = actualSide === "push" || activeSide === "push"
      ? "push"
      : activeSide === actualSide ? "win" : "loss";
    const candidateResult = actualSide === "push" || candidateSide === "push"
      ? "push"
      : candidateSide === actualSide ? "win" : "loss";
    const changed = activeSide !== candidateSide;
    const classification = !changed
      ? activeResult === "loss" ? "preserved_loss" : activeResult === "win" ? "preserved_win" : "preserved_push"
      : activeResult === "loss" && candidateResult === "win" ? "correction"
        : activeResult === "win" && candidateResult === "loss" ? "harm"
          : "push_transition";
    const features = market === "total" ? prediction.row.totalFeatures : prediction.row.marginFeatures;
    const observedEvidence = Object.fromEntries(Object.entries(features)
      .filter(([, value]) => Math.abs(value) > 1e-9)
      .sort(([first], [second]) => first.localeCompare(second)));
    return [{
      date: prediction.date,
      gameId: prediction.gameId,
      matchup: `${prediction.row.game.awayTeam}@${prediction.row.game.homeTeam}`,
      market,
      grade: prediction.row.game.targetGrades[market],
      storedEvaluatedPrice: prediction.row.game.targetPrices[market],
      line: market === "moneyline" ? null : line,
      active,
      candidate,
      actual,
      shift: candidate - active,
      activeSide,
      candidateSide,
      actualSide,
      activeResult,
      candidateResult,
      changed,
      classification,
      score: `${prediction.row.game.awayScore}-${prediction.row.game.homeScore}`,
      observedEvidence,
    }];
  }));
}

function professionalUpsetSummary(rows: ForwardPrediction[]) {
  const classified = rows.flatMap((prediction) => {
    const homeSpread = prediction.row.game.targetLines.spread;
    if (homeSpread === null || Math.abs(homeSpread) < 1e-9) return [];
    const underdog = homeSpread < 0 ? "away" : "home";
    const actualWinner = winner(prediction.row.actualMargin);
    const activeWinner = winner(prediction.activeMargin);
    const candidateWinner = winner(prediction.candidateMargin);
    return [{
      date: prediction.date,
      gameId: prediction.gameId,
      matchup: `${prediction.row.game.awayTeam}@${prediction.row.game.homeTeam}`,
      homeSpread,
      shortSpread: Math.abs(homeSpread) <= 3,
      underdog,
      actualWinner,
      activeWinner,
      candidateWinner,
      actualUpset: actualWinner === underdog,
      activeUpsetCall: activeWinner === underdog,
      candidateUpsetCall: candidateWinner === underdog,
      changedWinner: activeWinner !== candidateWinner,
      activeMargin: prediction.activeMargin,
      candidateMargin: prediction.candidateMargin,
      actualMargin: prediction.row.actualMargin,
    }];
  });
  const summarize = (selected: typeof classified, candidate: boolean) => {
    const callKey = candidate ? "candidateUpsetCall" : "activeUpsetCall";
    const calls = selected.filter((row) => row[callKey]);
    const actual = selected.filter((row) => row.actualUpset);
    const correct = calls.filter((row) => row.actualUpset);
    return {
      games: selected.length,
      actualUpsets: actual.length,
      upsetCalls: calls.length,
      correctUpsetCalls: correct.length,
      precision: calls.length ? correct.length / calls.length : null,
      recall: actual.length ? correct.length / actual.length : null,
    };
  };
  return {
    all: { active: summarize(classified, false), candidate: summarize(classified, true) },
    shortSpread: {
      active: summarize(classified.filter((row) => row.shortSpread), false),
      candidate: summarize(classified.filter((row) => row.shortSpread), true),
    },
    changedWinnerCalls: classified.filter((row) => row.changedWinner),
    missedActualUpsets: classified.filter((row) => row.actualUpset && !row.candidateUpsetCall),
  };
}

function professionalAuditSummary(rows: ForwardPrediction[]) {
  const ledger = professionalInterventionLedger(rows);
  const summarizeMarket = (market: Market) => {
    const selected = ledger.filter((row) => row.market === market);
    const activeLosses = selected.filter((row) => row.activeResult === "loss");
    return {
      games: selected.length,
      activeLosses: activeLosses.length,
      correctedLosses: activeLosses.filter((row) => row.classification === "correction").length,
      preservedLosses: activeLosses.filter((row) => row.classification === "preserved_loss").length,
      corrections: selected.filter((row) => row.classification === "correction").length,
      harms: selected.filter((row) => row.classification === "harm").length,
      flips: selected.filter((row) => row.changed).length,
    };
  };
  return {
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, summarizeMarket(market)])),
    interventionLedger: ledger.filter((row) => row.changed),
    incumbentLossLedger: ledger.filter((row) => row.activeResult === "loss"),
    upsetEvaluation: professionalUpsetSummary(rows),
    exactPriceEvaluation: {
      status: "not_claimed",
      reason: "Historical snapshots retain the incumbent evaluated quote, not a guaranteed executable quote for the opposite side after every candidate flip.",
    },
  };
}

function predictionMetricDelta(rows: ForwardPrediction[]) {
  const active = forwardMetrics(rows, false);
  const candidate = forwardMetrics(rows, true);
  return {
    marginMaeReduction: active.marginMae - candidate.marginMae,
    totalMaeReduction: active.totalMae - candidate.totalMae,
    teamScoreMaeReduction: active.teamScoreMae - candidate.teamScoreMae,
    moneylineAccuracyDelta: (candidate.moneyline.accuracy ?? 0) - (active.moneyline.accuracy ?? 0),
    spreadAccuracyDelta: (candidate.spread.accuracy ?? 0) - (active.spread.accuracy ?? 0),
    totalAccuracyDelta: (candidate.total.accuracy ?? 0) - (active.total.accuracy ?? 0),
  };
}

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function percentile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((first, second) => first - second);
  const position = Math.max(0, Math.min(ordered.length - 1, Math.floor(probability * (ordered.length - 1))));
  return ordered[position]!;
}

function clusteredBootstrap(rows: ForwardPrediction[], iterations = 5000) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const byDate = new Map(dates.map((date) => [date, rows.filter((row) => row.date === date)] as const));
  const random = deterministicRandom(0xcfb2026);
  const samples = Array.from({ length: iterations }, () => {
    const sampled = Array.from({ length: dates.length }, (_, sampleIndex) => {
      const date = dates[Math.floor(random() * dates.length)]!;
      return (byDate.get(date) ?? []).map((row) => ({ ...row, gameId: `${sampleIndex}:${row.gameId}` }));
    }).flat();
    return predictionMetricDelta(sampled);
  });
  const summarize = (key: keyof ReturnType<typeof predictionMetricDelta>) => {
    const values = samples.map((sample) => sample[key]);
    return {
      observed: predictionMetricDelta(rows)[key],
      confidence90: [percentile(values, 0.05), percentile(values, 0.95)],
      confidence95: [percentile(values, 0.025), percentile(values, 0.975)],
      probabilityPositive: values.filter((value) => value > 0).length / values.length,
    };
  };
  return Object.fromEntries(([
    "marginMaeReduction",
    "totalMaeReduction",
    "teamScoreMaeReduction",
    "moneylineAccuracyDelta",
    "spreadAccuracyDelta",
    "totalAccuracyDelta",
  ] as const).map((key) => [key, summarize(key)]));
}

function runCombinedMarketReaderStability(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: residualFeatures(game, "margin", false),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const dates = [...new Set(rows.map((row) => row.game.date))].sort();
  const forward: ForwardPrediction[] = [];
  const folds = dates.flatMap((date) => {
    const training = rows.filter((row) => row.game.date < date);
    const testing = rows.filter((row) => row.game.date === date);
    if (training.length < 80 || testing.length === 0) return [];
    const marginModel = fitPosterior(training, "margin", 1000);
    const totalModel = fitPosterior(training, "total", 30);
    const predictions = testing.map((row): ForwardPrediction => ({
      date,
      gameId: row.game.gameId,
      row,
      activeMargin: row.game.authoritative.expectedMarginHome,
      activeTotal: row.game.authoritative.expectedTotal,
      candidateMargin: posteriorObservedEvidenceAxis(row, "margin", marginModel, 1),
      candidateTotal: posteriorFlipOnlyAxis(row, "total", totalModel, 1),
    }));
    forward.push(...predictions);
    return [{
      date,
      trainingGames: training.length,
      testingGames: testing.length,
      active: residualMetrics(testing, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal),
      candidate: residualMetrics(
        testing,
        (row) => predictions.find((prediction) => prediction.gameId === row.game.gameId)!.candidateMargin,
        (row) => predictions.find((prediction) => prediction.gameId === row.game.gameId)!.candidateTotal,
      ),
      interventions: {
        moneyline: interventionSummary(testing, "moneyline", (row) => row.game.authoritative.expectedMarginHome, (row) => predictions.find((prediction) => prediction.gameId === row.game.gameId)!.candidateMargin),
        spread: interventionSummary(testing, "spread", (row) => row.game.authoritative.expectedMarginHome, (row) => predictions.find((prediction) => prediction.gameId === row.game.gameId)!.candidateMargin),
        total: interventionSummary(testing, "total", (row) => row.game.authoritative.expectedTotal, (row) => predictions.find((prediction) => prediction.gameId === row.game.gameId)!.candidateTotal),
      },
    }];
  });
  return {
    release: "cfb_combined_independent_market_reader_stability_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    method: "fixed_configuration_expanding_window_by_slate_date_with_date_cluster_bootstrap",
    fixedConfiguration: {
      margin: { lambda: 1000, evidenceScale: 1, mode: "continuous_only_with_observed_movement_or_split_evidence" },
      total: { lambda: 30, evidenceScale: 1, mode: "flip_only_with_observed_movement_or_split_evidence" },
    },
    eligibleDates: dates,
    evaluatedDates: folds.map((fold) => fold.date),
    evaluatedGames: forward.length,
    folds,
    aggregate: {
      active: forwardMetrics(forward, false),
      candidate: forwardMetrics(forward, true),
      bootstrap: clusteredBootstrap(forward),
    },
    professionalAudit: professionalAuditSummary(forward),
  };
}

function runTotalProjectionModeAudit(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: reconciliationMarginFeatures(game),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const dates = [...new Set(rows.map((row) => row.game.date))].sort();
  const evaluate = (mode: "reflection" | "posterior_projection") => {
    const forward = dates.flatMap((date) => {
      const training = rows.filter((row) => row.game.date < date);
      const testing = rows.filter((row) => row.game.date === date);
      if (training.length < 80 || testing.length === 0) return [];
      const totalModel = fitPosterior(training, "total", 30);
      return testing.map((row): ForwardPrediction => ({
        date,
        gameId: row.game.gameId,
        row,
        activeMargin: row.game.authoritative.expectedMarginHome,
        activeTotal: row.game.authoritative.expectedTotal,
        candidateMargin: row.game.authoritative.expectedMarginHome,
        candidateTotal: mode === "reflection"
          ? posteriorFlipOnlyAxis(row, "total", totalModel, 1)
          : posteriorProjectionFlipOnlyAxis(row, "total", totalModel, 1),
      }));
    });
    return {
      mode,
      blocks: configurationBlockSummary(forward),
      professionalAudit: professionalAuditSummary(forward),
      bootstrap: clusteredBootstrap(forward),
    };
  };
  return {
    release: "cfb_total_projection_mode_audit_2026_10_09_r1",
    method: "fixed_side_decision_expanding_window_comparison_of_reflection_and_fitted_posterior_projection",
    reflection: evaluate("reflection"),
    posteriorProjection: evaluate("posterior_projection"),
  };
}

function configurationBlockSummary(rows: ForwardPrediction[]) {
  const summarize = (selected: ForwardPrediction[]) => {
    const audit = professionalAuditSummary(selected);
    return {
      games: selected.length,
      active: forwardMetrics(selected, false),
      candidate: forwardMetrics(selected, true),
      byMarket: audit.byMarket,
      upset: {
        all: audit.upsetEvaluation.all,
        shortSpread: audit.upsetEvaluation.shortSpread,
      },
    };
  };
  return {
    development: summarize(rows.filter((row) => row.date <= "2026-09-27")),
    confirmation: summarize(rows.filter((row) => row.date >= "2026-10-02" && row.date <= "2026-10-04")),
    microHoldout: summarize(rows.filter((row) => row.date >= "2026-10-07")),
    all: summarize(rows),
  };
}

function runProfessionalConfigurationAudit(games: Game[], candidateBase: "active" | "independent" = "active") {
  type MarginFeatureMode =
    | "broad"
    | "constrained"
    | "cross_market"
    | "reconciliation"
    | "reconciliation_moneyline"
    | "reconciliation_full";
  const originalByGame = new Map(games.map((game) => [game.gameId, game]));
  const modelingGames = candidateBase === "independent"
    ? games.map((game) => ({ ...game, authoritative: game.independent }))
    : games;
  const buildRows = (marginFeatureMode: MarginFeatureMode, sourceGames = modelingGames): ResidualRow[] => sourceGames.map((game) => ({
    game,
    marginFeatures: marginFeatureMode === "reconciliation_full"
      ? professionalReconciliationMarginFeatures(game, "full")
      : marginFeatureMode === "reconciliation_moneyline"
        ? professionalReconciliationMarginFeatures(game, "moneyline")
        : marginFeatureMode === "reconciliation"
      ? reconciliationMarginFeatures(game)
      : marginFeatureMode === "cross_market"
        ? professionalMarginFeatures(game)
        : marginFeatureMode === "constrained"
          ? constrainedMarketFeatures(game, "margin")
          : residualFeatures(game, "margin", false),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const dates = [...new Set(games.map((game) => game.date))].sort();
  const walkForward = (args: {
    marginFeatureMode: MarginFeatureMode;
    marginLambda: number;
    marginEvidenceScale: number;
    totalLambda: number;
    totalEvidenceScale: number;
    totalReflectionStrength: number;
    changeMargin: boolean;
    changeTotal: boolean;
  }, sourceGames = modelingGames): ForwardPrediction[] => {
    const rows = buildRows(args.marginFeatureMode, sourceGames);
    return dates.flatMap((date) => {
      const training = rows.filter((row) => row.game.date < date);
      const testing = rows.filter((row) => row.game.date === date);
      if (training.length < 80 || testing.length === 0) return [];
      const marginModel = args.changeMargin ? fitPosterior(training, "margin", args.marginLambda) : null;
      const totalModel = args.changeTotal ? fitPosterior(training, "total", args.totalLambda) : null;
      return testing.map((row): ForwardPrediction => {
        const originalGame = originalByGame.get(row.game.gameId)!;
        const activeMargin = originalGame.authoritative.expectedMarginHome;
        const activeTotal = originalGame.authoritative.expectedTotal;
        const candidateBaseMargin = row.game.authoritative.expectedMarginHome;
        const candidateBaseTotal = row.game.authoritative.expectedTotal;
        const reflectedTotal = totalModel
          ? posteriorFlipOnlyAxis(row, "total", totalModel, args.totalEvidenceScale)
          : candidateBaseTotal;
        return {
          date,
          gameId: row.game.gameId,
          row: { ...row, game: originalGame },
          activeMargin,
          activeTotal,
          candidateMargin: marginModel
            ? posteriorObservedEvidenceAxis(row, "margin", marginModel, args.marginEvidenceScale)
            : activeMargin,
          candidateTotal: args.changeTotal
            ? candidateBaseTotal + args.totalReflectionStrength * (reflectedTotal - candidateBaseTotal)
            : activeTotal,
        };
      });
    });
  };
  const margin = ([
    "broad",
    "constrained",
    "cross_market",
    "reconciliation",
    "reconciliation_moneyline",
    "reconciliation_full",
  ] as const).flatMap((marginFeatureMode) =>
    [100, 300, 1000, 3000].flatMap((marginLambda) =>
      [0.25, 0.5, 0.75, 1, 1.25].map((marginEvidenceScale) => {
        const rows = walkForward({
          marginFeatureMode,
          marginLambda,
          marginEvidenceScale,
          totalLambda: 30,
          totalEvidenceScale: 1,
          totalReflectionStrength: 0,
          changeMargin: true,
          changeTotal: false,
        });
        return {
          id: `${marginFeatureMode}_lambda_${marginLambda}_scale_${marginEvidenceScale}`,
          config: { marginFeatureMode, marginLambda, marginEvidenceScale },
          blocks: configurationBlockSummary(rows),
        };
      })));
  const total = [10, 30, 100, 300].flatMap((totalLambda) =>
    [0.5, 0.75, 1, 1.25].flatMap((totalEvidenceScale) =>
      [0.55, 0.75, 1].map((totalReflectionStrength) => {
        const rows = walkForward({
          marginFeatureMode: "broad",
          marginLambda: 1000,
          marginEvidenceScale: 0,
          totalLambda,
          totalEvidenceScale,
          totalReflectionStrength,
          changeMargin: false,
          changeTotal: true,
        });
        return {
          id: `lambda_${totalLambda}_evidence_${totalEvidenceScale}_reflection_${totalReflectionStrength}`,
          config: { totalLambda, totalEvidenceScale, totalReflectionStrength },
          blocks: configurationBlockSummary(rows),
        };
      })));
  const detailConfigs = [
    {
      id: "broad_lambda_1000_scale_0.75",
      args: { marginFeatureMode: "broad", marginLambda: 1000, marginEvidenceScale: 0.75, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 0, changeMargin: true, changeTotal: false },
    },
    {
      id: "constrained_lambda_100_scale_0.5",
      args: { marginFeatureMode: "constrained", marginLambda: 100, marginEvidenceScale: 0.5, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 0, changeMargin: true, changeTotal: false },
    },
    {
      id: "cross_market_lambda_300_scale_0.75",
      args: { marginFeatureMode: "cross_market", marginLambda: 300, marginEvidenceScale: 0.75, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 0, changeMargin: true, changeTotal: false },
    },
    {
      id: "reconciliation_lambda_300_scale_0.75",
      args: { marginFeatureMode: "reconciliation", marginLambda: 300, marginEvidenceScale: 0.75, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 0, changeMargin: true, changeTotal: false },
    },
    {
      id: "reconciliation_lambda_1000_scale_1",
      args: { marginFeatureMode: "reconciliation", marginLambda: 1000, marginEvidenceScale: 1, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 0, changeMargin: true, changeTotal: false },
    },
    {
      id: "reconciliation_moneyline_lambda_1000_scale_1",
      args: { marginFeatureMode: "reconciliation_moneyline", marginLambda: 1000, marginEvidenceScale: 1, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 0, changeMargin: true, changeTotal: false },
    },
    {
      id: "reconciliation_full_lambda_1000_scale_1",
      args: { marginFeatureMode: "reconciliation_full", marginLambda: 1000, marginEvidenceScale: 1, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 0, changeMargin: true, changeTotal: false },
    },
    {
      id: "total_lambda_30_evidence_1_reflection_1",
      args: { marginFeatureMode: "broad", marginLambda: 1000, marginEvidenceScale: 0, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 1, changeMargin: false, changeTotal: true },
    },
    {
      id: "selected_reconciliation_and_total",
      args: { marginFeatureMode: "reconciliation", marginLambda: 1000, marginEvidenceScale: 1, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 1, changeMargin: true, changeTotal: true },
    },
    {
      id: "selected_joint_moneyline_spread_and_total",
      args: { marginFeatureMode: "reconciliation_moneyline", marginLambda: 1000, marginEvidenceScale: 1, totalLambda: 30, totalEvidenceScale: 1, totalReflectionStrength: 1, changeMargin: true, changeTotal: true },
    },
  ] as const;
  const details = Object.fromEntries(detailConfigs.map(({ id, args }) => {
    const audit = professionalAuditSummary(walkForward(args));
    return [id, {
      interventions: audit.interventionLedger,
      changedWinnerCalls: audit.upsetEvaluation.changedWinnerCalls,
    }];
  }));
  const selectedCombinedRows = walkForward(detailConfigs.find((config) => config.id === "selected_reconciliation_and_total")!.args);
  const legacyShortSpreadPolicies = [1.5, 2.5, 3, 3.5, 7].flatMap((maximumSpread) =>
    [0.5, 0.75, 1].map((independentRestorationStrength) => {
      const rows = selectedCombinedRows.map((row): ForwardPrediction => {
        const spread = row.row.game.targetLines.spread;
        const independentMargin = row.row.game.independent.expectedMarginHome;
        const legacyChangedWinner = winner(row.activeMargin) !== winner(independentMargin);
        const eligible = spread !== null && Math.abs(spread) <= maximumSpread && legacyChangedWinner;
        return {
          ...row,
          candidateMargin: eligible
            ? row.candidateMargin + independentRestorationStrength * (independentMargin - row.candidateMargin)
            : row.candidateMargin,
        };
      });
      return {
        id: `legacy_short_spread_${maximumSpread}_restore_${independentRestorationStrength}`,
        config: { maximumSpread, independentRestorationStrength },
        blocks: configurationBlockSummary(rows),
        professionalAudit: professionalAuditSummary(rows),
      };
    }));
  const guardedNearPickemPolicies = [0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((maximumSpread) => {
    const guardedGames = modelingGames.map((game) => {
      const spread = game.targetLines.spread;
      const legacyChangedWinner = winner(game.authoritative.expectedMarginHome) !== winner(game.independent.expectedMarginHome);
      const guarded = spread !== null && Math.abs(spread) <= maximumSpread && legacyChangedWinner;
      return guarded ? {
        ...game,
        authoritative: {
          ...game.authoritative,
          expectedMarginHome: game.independent.expectedMarginHome,
        },
      } : game;
    });
    const rows = walkForward(
      detailConfigs.find((config) => config.id === "selected_reconciliation_and_total")!.args,
      guardedGames,
    );
    return {
      id: `guarded_legacy_near_pickem_${maximumSpread}`,
      config: { maximumSpread },
      blocks: configurationBlockSummary(rows),
      professionalAudit: professionalAuditSummary(rows),
    };
  });
  const corroboratedWinnerGames = modelingGames.map(suppressUncorroboratedLegacyWinnerFlip);
  const corroboratedWinnerRows = walkForward(
    detailConfigs.find((config) => config.id === "selected_reconciliation_and_total")!.args,
    corroboratedWinnerGames,
  );
  const jointCorroboratedWinnerRows = walkForward(
    detailConfigs.find((config) => config.id === "selected_joint_moneyline_spread_and_total")!.args,
    corroboratedWinnerGames,
  );
  return {
    release: `cfb_professional_market_reader_configuration_audit_2026_10_09_r1_${candidateBase}_base`,
    mode: "select_only_zero_writes_zero_provider_calls",
    protocol: `configuration_neighborhoods_compared_on_development_then_read_on_confirmation_and_micro_holdout_without_refitting_configuration_candidate_base_${candidateBase}`,
    margin,
    total,
    selectedCombined: {
      blocks: configurationBlockSummary(selectedCombinedRows),
      bootstrap: clusteredBootstrap(selectedCombinedRows),
      professionalAudit: professionalAuditSummary(selectedCombinedRows),
    },
    legacyShortSpreadPolicies,
    guardedNearPickemPolicies,
    corroboratedWinnerPolicy: {
      id: "spread_only_legacy_layer_cannot_reverse_outright_winner_without_moneyline_corroboration",
      blocks: configurationBlockSummary(corroboratedWinnerRows),
      professionalAudit: professionalAuditSummary(corroboratedWinnerRows),
    },
    jointCorroboratedWinnerPolicy: {
      id: "joint_moneyline_spread_reader_after_uncorroborated_legacy_winner_suppression",
      blocks: configurationBlockSummary(jointCorroboratedWinnerRows),
      professionalAudit: professionalAuditSummary(jointCorroboratedWinnerRows),
      bootstrap: clusteredBootstrap(jointCorroboratedWinnerRows),
    },
    details,
  };
}

function runProfessionalLossAudit(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: reconciliationMarginFeatures(game),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const dates = [...new Set(rows.map((row) => row.game.date))].sort();
  const forward = dates.flatMap((date) => {
    const training = rows.filter((row) => row.game.date < date);
    const testing = rows.filter((row) => row.game.date === date);
    if (training.length < 80 || testing.length === 0) return [];
    const marginModel = fitPosterior(training, "margin", 1000);
    const totalModel = fitPosterior(training, "total", 30);
    return testing.map((row): ForwardPrediction => ({
      date,
      gameId: row.game.gameId,
      row,
      activeMargin: row.game.authoritative.expectedMarginHome,
      activeTotal: row.game.authoritative.expectedTotal,
      candidateMargin: posteriorObservedEvidenceAxis(row, "margin", marginModel, 1),
      candidateTotal: posteriorFlipOnlyAxis(row, "total", totalModel, 1),
    }));
  });
  const ledger = professionalInterventionLedger(forward);
  const losses = ledger.filter((row) => row.activeResult === "loss").map((entry) => {
    const prediction = forward.find((row) => row.gameId === entry.gameId)!;
    const features = entry.market === "total" ? prediction.row.totalFeatures : prediction.row.marginFeatures;
    const axis = entry.market === "total" ? "total" : "margin";
    const observed = hasObservedAxisMarketReadingEvidence(features, axis);
    const activeError = Math.abs(entry.active - entry.actual);
    const candidateError = Math.abs(entry.candidate - entry.actual);
    const improvement = activeError - candidateError;
    const category = entry.classification === "correction"
      ? "corrected_by_selected_reader"
      : !observed
        ? "no_usable_sequence_warning"
        : Math.abs(entry.shift) < 1e-9
          ? "observed_evidence_but_no_selected_adjustment"
          : improvement > 1e-9
            ? "signal_toward_outcome_but_not_enough_to_flip"
            : improvement < -1e-9
              ? "signal_away_from_outcome"
              : "signal_axis_neutral";
    return { ...entry, observedSequenceEvidence: observed, activeError, candidateError, errorReduction: improvement, category };
  });
  const summarize = (selected: typeof losses) => ({
    losses: selected.length,
    meanAxisErrorReduction: average(selected.map((row) => row.errorReduction)),
    categories: Object.fromEntries([...new Set(selected.map((row) => row.category))].sort().map((category) =>
      [category, selected.filter((row) => row.category === category).length])),
    withSplits: selected.filter((row) => Object.keys(row.observedEvidence).some((name) => name.startsWith("split_"))).length,
    withNamedMovement: selected.filter((row) => Object.keys(row.observedEvidence).some((name) => name.includes("_named_") && name.includes("move"))).length,
  });
  const upset = professionalUpsetSummary(forward);
  const missedUpsetEvidence = upset.missedActualUpsets.map((missed) => {
    const prediction = forward.find((row) => row.gameId === missed.gameId)!;
    const features = prediction.row.marginFeatures;
    const selectedFeatureNames = [
      "active_margin",
      "independent_margin",
      "legacy_margin_shift",
      "legacy_margin_shift_abs",
      "legacy_moneyline_side_changed",
      "legacy_spread_side_changed",
      "spread_all_opening_axis",
      "spread_all_current_axis",
      "spread_all_axis_move",
      "spread_all_probability_move",
      "spread_all_reversal_count",
      "spread_named_axis_move",
      "spread_named_probability_move",
      "spread_named_reversal_count",
      "spread_retail_axis_move",
      "spread_retail_probability_move",
      "spread_retail_reversal_count",
      "moneyline_all_probability_move",
      "moneyline_all_reversal_count",
      "moneyline_named_probability_move",
      "moneyline_named_reversal_count",
      "moneyline_retail_probability_move",
      "moneyline_retail_reversal_count",
      "split_named_sharp",
      "split_fallback",
      "split_public",
    ];
    return {
      ...missed,
      targetSpreadHome: prediction.row.game.targetLines.spread,
      marketEvidence: Object.fromEntries(selectedFeatureNames.flatMap((name) =>
        features[name] === undefined ? [] : [[name, features[name]!]])),
    };
  });
  return {
    release: "cfb_professional_market_reader_loss_audit_2026_10_09_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    selectedConfiguration: {
      margin: { featureSet: "reconciliation_target_excluded_sequence", lambda: 1000, evidenceScale: 1 },
      total: { featureSet: "constrained_target_excluded_sequence", lambda: 30, evidenceScale: 1, reflectionStrength: 1 },
    },
    evaluatedGames: forward.length,
    overall: summarize(losses),
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(losses.filter((row) => row.market === market))])),
    byGrade: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) =>
      [grade, summarize(losses.filter((row) => row.grade === grade))])),
    losses,
    upsetEvaluation: upset,
    missedUpsetEvidence,
  };
}

function latestPublicMoneylineMajority(game: Game): "home" | "away" | null {
  const split = game.histories
    .flatMap((history) => history.payload.market.playbookSplits?.moneyline
      ? [history.payload.market.playbookSplits.moneyline]
      : [])
    .filter((candidate) => Date.parse(candidate.capturedAt) <= Date.parse(game.kickoffAt))
    .sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt))
    .at(-1);
  if (!split || split.homeMoneyPct === null || split.awayMoneyPct === null) return null;
  if (Math.abs(split.homeMoneyPct - split.awayMoneyPct) < 1e-9) return null;
  return split.homeMoneyPct > split.awayMoneyPct ? "home" : "away";
}

function suppressUncorroboratedLegacyWinnerFlip(game: Game): Game {
  const activeWinner = winner(game.authoritative.expectedMarginHome);
  const independentWinner = winner(game.independent.expectedMarginHome);
  if (activeWinner === "push" || independentWinner === "push") return game;
  if (activeWinner === independentWinner || latestPublicMoneylineMajority(game) === activeWinner) return game;
  return {
    ...game,
    authoritative: {
      ...game.authoritative,
      expectedMarginHome: game.independent.expectedMarginHome,
    },
  };
}

function exportCombinedMarketReaderArtifact(games: Game[]) {
  const guardedGames = games.map((game) => {
    const spread = game.targetLines.spread;
    const legacyChangedWinner = winner(game.authoritative.expectedMarginHome) !== winner(game.independent.expectedMarginHome);
    const moneylineDominantBand = spread !== null && Math.abs(spread) < 2.5;
    return moneylineDominantBand && legacyChangedWinner ? {
      ...game,
      authoritative: {
        ...game.authoritative,
        expectedMarginHome: game.independent.expectedMarginHome,
      },
    } : game;
  });
  const rows: ResidualRow[] = guardedGames.map((game) => ({
    game,
    marginFeatures: reconciliationMarginFeatures(game),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const marginModel = fitPosterior(rows, "margin", 1000);
  const totalModel = fitPosterior(rows, "total", 30);
  return {
    release: "cfb_market_reader_artifact_2026_10_09_r3_support_aware_reconciliation",
    trainedThrough: [...games.map((game) => game.date)].sort().at(-1),
    games: rows.length,
    selectionProtocol: "configurations_frozen_before_confirmation_then_refit_on_all_pregame_lock_boundary_rows",
    margin: { lambda: 1000, evidenceScale: 1, mode: "professional_reconciliation_continuous_only_with_observed_movement_or_split_evidence", model: marginModel },
    total: {
      lambda: 30,
      evidenceScale: 1,
      mode: "full_reflection_inside_chronological_support_then_continuous_extrapolation_decay",
      reflectionSupport: {
        method: "maximum_active_market_distance_among_chronologically_evaluated_total_flips",
        maximumChronologicalActiveMarketDistance: TOTAL_REFLECTION_CHRONOLOGICAL_SUPPORT_POINTS,
      },
      model: totalModel,
    },
  };
}

function currentBoardMarketReaderCandidate(
  trainingGames: Game[],
  rows: CfbForwardStoredEvidence[],
  historiesByGame: Map<string, CfbForwardMarketHistoryEvidence[]>,
  fullForecasts: Map<string, CfbV1Forecast>,
  mode = "select_only_zero_writes_zero_provider_calls",
) {
  const training = trainingGames.map((game): ResidualRow => ({
    game,
    marginFeatures: reconciliationMarginFeatures(game),
    totalFeatures: constrainedMarketFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const marginModel = fitPosterior(training, "margin", 1000);
  const totalModel = fitPosterior(training, "total", 30);
  const games = rows.flatMap((stored) => {
    const histories = (historiesByGame.get(stored.providerGameId) ?? [])
      .filter((history) => Date.parse(history.capturedAt) <= Date.parse(stored.capturedAt))
      .sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt));
    if (histories.length === 0) return [];
    const independent = stored.payload.independentForecast ?? stored.payload.decisions.forecast;
    const authoritative = stored.payload.decisions.forecast;
    const spreadDecision = stored.payload.decisions.evaluatedBets.find((decision) => decision.market === "spread") ?? null;
    const totalDecision = stored.payload.decisions.evaluatedBets.find((decision) => decision.market === "total") ?? null;
    const selectedSpreadLine = spreadDecision?.evaluatedQuote.line ?? null;
    const homeSpreadLine = selectedSpreadLine === null || !spreadDecision
      ? null
      : isHomeDecisionSide(spreadDecision.side, stored.payload.game.home.abbreviation)
        ? selectedSpreadLine
        : -selectedSpreadLine;
    const game: Game = {
      gameId: stored.providerGameId,
      date: stored.gameStartAt.slice(0, 10),
      kickoffAt: stored.gameStartAt,
      awayTeam: stored.payload.game.away.abbreviation,
      homeTeam: stored.payload.game.home.abbreviation,
      awayFbs: stored.payload.game.away.fbs,
      homeFbs: stored.payload.game.home.fbs,
      awayConferenceId: stored.payload.game.away.conferenceId,
      homeConferenceId: stored.payload.game.home.conferenceId,
      independent: {
        expectedMarginHome: independent.expectedMarginHome,
        expectedTotal: independent.expectedTotal,
        homeWinProbability: independent.homeWinProbability,
        pmf: "pmf" in independent ? independent.pmf as Forecast["pmf"] : undefined,
      },
      authoritative: {
        expectedMarginHome: authoritative.expectedMarginHome,
        expectedTotal: authoritative.expectedTotal,
        homeWinProbability: authoritative.homeWinProbability,
        pmf: "pmf" in authoritative ? authoritative.pmf as Forecast["pmf"] : undefined,
      },
      targetLines: { moneyline: null, spread: homeSpreadLine, total: totalDecision?.evaluatedQuote.line ?? null },
      targetGrades: Object.fromEntries(MARKETS.map((market) => [
        market,
        stored.payload.decisions.evaluatedBets.find((decision) => decision.market === market)?.grade ?? "Held",
      ])) as Record<Market, string>,
      targetPrices: Object.fromEntries(MARKETS.map((market) => [
        market,
        stored.payload.decisions.evaluatedBets.find((decision) => decision.market === market)?.evaluatedQuote.price ?? null,
      ])) as Record<Market, number | null>,
      awayScore: 0,
      homeScore: 0,
      histories,
    };
    const residual: ResidualRow = {
      game,
      marginFeatures: reconciliationMarginFeatures(game),
      totalFeatures: constrainedMarketFeatures(game, "total"),
      actualMargin: 0,
      actualTotal: 0,
    };
    const activeMargin = authoritative.expectedMarginHome;
    const activeTotal = authoritative.expectedTotal;
    const rawMargin = posteriorResidualAxis(residual, "margin", marginModel, 1);
    const rawTotal = posteriorResidualAxis(residual, "total", totalModel, 1);
    const candidateMargin = posteriorObservedEvidenceAxis(residual, "margin", marginModel, 1);
    const candidateTotal = posteriorFlipOnlyAxis(residual, "total", totalModel, 1);
    const reconstructedActive = fullForecasts.get(stored.providerGameId);
    if (!reconstructedActive) return [];
    const alignedMarginPmf = tiltCfbMarginWithinTotals(
      reconstructedActive.pmf,
      authoritative.expectedMarginHome - reconstructedActive.expectedMarginHome,
    );
    const alignedMargin = summarizePmf(alignedMarginPmf);
    const alignedActivePmf = tiltCfbTotalWithinMargins(
      alignedMarginPmf,
      authoritative.expectedTotal - alignedMargin.expectedTotal,
    );
    const alignedActiveSummary = summarizePmf(alignedActivePmf);
    const alignedActive: CfbV1Forecast = {
      ...reconstructedActive,
      ...alignedActiveSummary,
      pmf: alignedActivePmf,
    };
    const marginAdjustedPmf = tiltCfbMarginWithinTotals(
      alignedActive.pmf,
      candidateMargin - alignedActive.expectedMarginHome,
    );
    const marginAdjusted = summarizePmf(marginAdjustedPmf);
    const candidatePmf = tiltCfbTotalWithinMargins(
      marginAdjustedPmf,
      candidateTotal - marginAdjusted.expectedTotal,
    );
    const candidateSummary = summarizePmf(candidatePmf);
    const candidateForecast: CfbV1Forecast = {
      ...reconstructedActive,
      ...candidateSummary,
      pmf: candidatePmf,
    };
    const capture = stored.payload.contextualEvidenceCapture;
    const runtimeCandidate = capture ? applyCfbCompleteMarketReader({
      forecast: alignedActive,
      independentForecast: independent,
      histories: histories.slice(0, -1),
      currentObservation: {
        capturedAt: stored.capturedAt,
        markets: {
          moneyline: {
            families: capture.markets.moneyline.families,
            targetExcludedFamilies: capture.markets.moneyline.targetExcludedFamilies,
          },
          spread: {
            families: capture.markets.spread.families,
            targetExcludedFamilies: capture.markets.spread.targetExcludedFamilies,
          },
          total: {
            families: capture.markets.total.families,
            targetExcludedFamilies: capture.markets.total.targetExcludedFamilies,
          },
        },
        playbookSplits: stored.payload.market.playbookSplits,
        sharpApiSplits: stored.payload.market.sharpApiSplits ?? [],
      },
      kickoffAt: stored.gameStartAt,
      awayFbs: game.awayFbs,
      homeFbs: game.homeFbs,
      awayConferenceId: game.awayConferenceId,
      homeConferenceId: game.homeConferenceId,
    }) : null;
    const effectiveCandidateForecast = runtimeCandidate?.forecast ?? candidateForecast;
    const fixedEvaluatedSportsbookByMarket = Object.fromEntries(stored.payload.decisions.evaluatedBets.map((decision) =>
      [decision.market, decision.evaluatedQuote.sportsbook]));
    const decisionBundleFor = (forecast: CfbV1Forecast, healthHolds: string[]) => applyCfbVerifiedAvailabilityGradeCap({
      bundle: applyCfbMarketSharpAwareGrades({
        bundle: buildCfbV1DecisionBundle({
          providerGameId: stored.providerGameId,
          awayTeam: game.awayTeam,
          homeTeam: game.homeTeam,
          gameStartsAt: stored.gameStartAt,
          comparableCurrentBooks: stored.payload.market.currentBooks,
          stage: stored.stage === "t60" && healthHolds.length === 0 ? "t60_locked" : "unlocked",
          evaluatedAt: stored.capturedAt,
          lockedAt: stored.stage === "t60" && healthHolds.length === 0 ? stored.capturedAt : null,
          healthHolds,
          forecast,
          contextLines: {
            homeSpread: stored.payload.market.playbookLine?.homeSpread ?? null,
            totalLine: stored.payload.market.playbookLine?.total ?? null,
          },
          fixedEvaluatedSportsbookByMarket,
        }),
        homeTeam: game.homeTeam,
        sharpSplits: stored.payload.market.sharpApiSplits ?? [],
        playbookLine: stored.payload.market.playbookLine,
        publicSplits: stored.payload.market.playbookSplits,
        operationalOpening: stored.payload.market.operationalOpening,
        current: currentCfbMovementContextBook(
          stored.payload.market.currentBooks,
          stored.payload.market.operationalOpening,
        ),
      }),
      availability: stored.payload.availability.verifiedQuarterback ?? null,
    });
    const baselineBundle = decisionBundleFor(alignedActive, stored.payload.coverage.healthHolds);
    const candidateHealthHolds = stored.payload.coverage.healthHolds
      .filter((hold) => hold !== "authoritative_market_anchor_unavailable");
    const candidateBundle = decisionBundleFor(effectiveCandidateForecast, candidateHealthHolds);
    const replayChecks = MARKETS.map((market) => {
      const activeDecision = stored.payload.decisions.evaluatedBets.find((item) => item.market === market) ?? null;
      const baselineDecision = baselineBundle.evaluatedBets.find((item) => item.market === market) ?? null;
      return {
        market,
        gradeMatches: (activeDecision?.grade ?? "Held") === (baselineDecision?.grade ?? "Held"),
        priceMatches: (activeDecision?.evaluatedQuote.price ?? null) === (baselineDecision?.evaluatedQuote.price ?? null),
        probabilityDifference: activeDecision && baselineDecision
          ? Math.abs(activeDecision.modelProbability - baselineDecision.modelProbability)
          : activeDecision === baselineDecision ? 0 : Number.POSITIVE_INFINITY,
      };
    });
    const exactReplayValid = replayChecks.every((check) =>
      check.gradeMatches && check.priceMatches && check.probabilityDifference <= 0.002);
    const score = {
      away: effectiveCandidateForecast.expectedAwayPoints,
      home: effectiveCandidateForecast.expectedHomePoints,
    };
    const regime = (market: Market, raw: number) => {
      const line = market === "moneyline" ? 0 : game.targetLines[market];
      if (line === null) return "unpriced";
      const boundary = market === "spread" ? -line : line;
      const active = market === "total" ? activeTotal : activeMargin;
      if (lineWinner(raw, boundary) !== lineWinner(active, boundary)) return "flip_candidate";
      const distanceDelta = Math.abs(raw - boundary) - Math.abs(active - boundary);
      return distanceDelta > 1e-9 ? "confirmation" : distanceDelta < -1e-9 ? "resistance" : "neutral";
    };
    const markets = Object.fromEntries(MARKETS.map((market) => {
      const line = game.targetLines[market];
      const activeAxis = market === "total" ? activeTotal : activeMargin;
      const rawAxis = market === "total" ? rawTotal : rawMargin;
      const candidateAxis = market === "total"
        ? effectiveCandidateForecast.expectedTotal
        : effectiveCandidateForecast.expectedMarginHome;
      const activeSide = sideAt({ expectedMarginHome: activeMargin, expectedTotal: activeTotal }, market, line);
      const candidateSide = sideAt({ expectedMarginHome: candidateMargin, expectedTotal: candidateTotal }, market, line);
      const decision = stored.payload.decisions.evaluatedBets.find((item) => item.market === market) ?? null;
      const candidateDecision = candidateBundle.evaluatedBets.find((item) => item.market === market) ?? null;
      const candidateHeldMarket = candidateBundle.heldMarkets.find((item) => item.market === market) ?? null;
      const runtimeBaselineDecision = baselineBundle.evaluatedBets.find((item) => item.market === market) ?? null;
      const activeGrade = decision?.grade ?? "Held";
      const candidateGrade = exactReplayValid ? candidateDecision?.grade ?? "Held" : activeGrade;
      const runtimeBaselineGrade = runtimeBaselineDecision?.grade ?? "Held";
      const runtimeCandidateGrade = candidateDecision?.grade ?? "Held";
      const candidateAdjustment = exactReplayValid ? candidateDecision?.gradeAdjustment ?? null : decision?.gradeAdjustment ?? null;
      const evidenceAvailable = market === "total"
        ? hasObservedAxisMarketReadingEvidence(residual.totalFeatures, "total")
        : hasObservedAxisMarketReadingEvidence(residual.marginFeatures, "margin");
      const observedEvidence = Object.fromEntries(Object.entries(
        market === "total" ? residual.totalFeatures : residual.marginFeatures,
      ).filter(([, featureValue]) => Math.abs(featureValue) > 1e-9));
      const splitEvidenceAvailable = candidateAdjustment !== null && (
        candidateAdjustment.sharpDirection !== "unknown" || candidateAdjustment.publicDirection !== "unknown"
      );
      const movementEvidenceAvailable = candidateAdjustment !== null && candidateAdjustment.movementDirection !== "unknown";
      return [market, {
        line,
        regime: regime(market, rawAxis),
        evidenceAvailable,
        observedEvidence,
        splitEvidenceAvailable,
        movementEvidenceAvailable,
        activeAxis,
        rawEvidenceAxis: rawAxis,
        candidateAxis,
        axisShift: candidateAxis - activeAxis,
        activeSide,
        candidateSide,
        sideChanged: activeSide !== candidateSide,
        activeGrade,
        candidateGrade,
        gradeChanged: activeGrade !== candidateGrade,
        runtimeBaselineGrade,
        runtimeCandidateGrade,
        runtimeGradeChanged: runtimeBaselineGrade !== runtimeCandidateGrade,
        activeProbability: decision?.modelProbability ?? null,
        candidateProbability: candidateDecision?.modelProbability ?? null,
        activePrice: decision?.evaluatedQuote.price ?? null,
        candidatePrice: candidateDecision?.evaluatedQuote.price ?? null,
        candidateReasonCodes: candidateAdjustment?.reasonCodes ?? [],
        candidateHeldReasonCodes: candidateHeldMarket?.reasonCodes ?? [],
      }];
    }));
    return [{
      gameId: stored.providerGameId,
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      startsAt: stored.gameStartAt,
      capturedAt: stored.capturedAt,
      activeScore: { away: authoritative.expectedAwayPoints, home: authoritative.expectedHomePoints },
      candidateScore: score,
      reconstruction: {
        marginDifference: reconstructedActive.expectedMarginHome - authoritative.expectedMarginHome,
        totalDifference: reconstructedActive.expectedTotal - authoritative.expectedTotal,
        alignedMarginDifference: alignedActive.expectedMarginHome - authoritative.expectedMarginHome,
        alignedTotalDifference: alignedActive.expectedTotal - authoritative.expectedTotal,
      },
      runtimeParityDifference: runtimeCandidate ? Math.max(
        Math.abs(runtimeCandidate.forecast.expectedMarginHome - effectiveCandidateForecast.expectedMarginHome),
        Math.abs(runtimeCandidate.forecast.expectedTotal - effectiveCandidateForecast.expectedTotal),
      ) : null,
      runtimeParity: runtimeCandidate ? {
        auditMargin: effectiveCandidateForecast.expectedMarginHome,
        runtimeMargin: runtimeCandidate.forecast.expectedMarginHome,
        auditTotal: effectiveCandidateForecast.expectedTotal,
        runtimeTotal: runtimeCandidate.forecast.expectedTotal,
      } : null,
      exactReplayValid,
      replayChecks,
      negativeCandidateScore: score.away < 0 || score.home < 0,
      anchorHoldRemoved: candidateHealthHolds.length !== stored.payload.coverage.healthHolds.length,
      markets,
    }];
  });
  const marketRows = MARKETS.flatMap((market) => games.map((game) => ({ game, market, value: game.markets[market] as {
    regime: string; evidenceAvailable: boolean; splitEvidenceAvailable: boolean; movementEvidenceAvailable: boolean; axisShift: number;
    sideChanged: boolean; activeGrade: string; candidateGrade: string; gradeChanged: boolean; candidateReasonCodes: string[];
    runtimeBaselineGrade: string; runtimeCandidateGrade: string; runtimeGradeChanged: boolean; candidateHeldReasonCodes: string[];
  } })));
  const gradeRank = (grade: string) => ({ Held: 0, "No Play": 1, Watchlist: 2, Lean: 3, "Best Angle": 4 })[grade] ?? 0;
  return {
    release: "cfb_professional_market_reconciliation_current_board_candidate_2026_10_09_r3",
    mode,
    artifact: "cfb_market_reader_artifact_2026_10_09_r3_support_aware_reconciliation",
    trainedGames: training.length,
    boardGames: games.length,
    anchorHoldGames: games.filter((game) => game.anchorHoldRemoved).length,
    negativeCandidateScores: games.filter((game) => game.negativeCandidateScore).length,
    exactGradeReplayGames: games.filter((game) => game.exactReplayValid).length,
    invalidGradeReplayGames: games.filter((game) => !game.exactReplayValid).map((game) => ({
      matchup: game.matchup,
      startsAt: game.startsAt,
      checks: game.replayChecks,
    })),
    maximumAbsoluteReconstructionDifference: Math.max(0, ...games.flatMap((game) => [
      Math.abs(game.reconstruction.marginDifference),
      Math.abs(game.reconstruction.totalDifference),
    ])),
    maximumAbsoluteAlignedReconstructionDifference: Math.max(0, ...games.flatMap((game) => [
      Math.abs(game.reconstruction.alignedMarginDifference),
      Math.abs(game.reconstruction.alignedTotalDifference),
    ])),
    maximumRuntimeParityDifference: Math.max(0, ...games.flatMap((game) =>
      game.runtimeParityDifference === null ? [] : [game.runtimeParityDifference])),
    runtimeParityMismatches: games.filter((game) => (game.runtimeParityDifference ?? 0) > 1e-9)
      .map((game) => ({
        matchup: game.matchup,
        startsAt: game.startsAt,
        difference: game.runtimeParityDifference,
        ...game.runtimeParity,
      })),
    reconstructionMismatches: games.filter((game) =>
      Math.abs(game.reconstruction.marginDifference) > 1e-6 || Math.abs(game.reconstruction.totalDifference) > 1e-6)
      .map((game) => ({ matchup: game.matchup, startsAt: game.startsAt, ...game.reconstruction })),
    marketSummary: Object.fromEntries(MARKETS.map((market) => {
      const selected = marketRows.filter((row) => row.market === market);
      return [market, {
        priced: selected.filter((row) => row.value.regime !== "unpriced").length,
        evidenceAvailable: selected.filter((row) => row.value.evidenceAvailable).length,
        splitEvidenceAvailable: selected.filter((row) => row.value.splitEvidenceAvailable).length,
        movementEvidenceAvailable: selected.filter((row) => row.value.movementEvidenceAvailable).length,
        actionableWithoutSplits: selected.filter((row) =>
          !row.value.splitEvidenceAvailable && (row.value.candidateGrade === "Best Angle" || row.value.candidateGrade === "Lean")).length,
        noPlayWithoutSplits: selected.filter((row) =>
          !row.value.splitEvidenceAvailable && row.value.candidateGrade === "No Play").length,
        adjustedAxes: selected.filter((row) => Math.abs(row.value.axisShift) > 1e-9).length,
        meanAbsoluteAxisShift: average(selected.map((row) => Math.abs(row.value.axisShift))),
        maximumAbsoluteAxisShift: Math.max(0, ...selected.map((row) => Math.abs(row.value.axisShift))),
        sideChanges: selected.filter((row) => row.value.sideChanged).length,
        gradeChanges: selected.filter((row) => row.value.gradeChanged).length,
        recoveredHeldMarkets: selected.filter((row) => row.value.activeGrade === "Held" && row.value.candidateGrade !== "Held").length,
        recoveredHeldActionables: selected.filter((row) => row.value.activeGrade === "Held" && (
          row.value.candidateGrade === "Best Angle" || row.value.candidateGrade === "Lean"
        )).length,
        promotions: selected.filter((row) => gradeRank(row.value.candidateGrade) > gradeRank(row.value.activeGrade)).length,
        demotions: selected.filter((row) => gradeRank(row.value.candidateGrade) < gradeRank(row.value.activeGrade)).length,
        activeGrades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) =>
          [grade, selected.filter((row) => row.value.activeGrade === grade).length])),
        candidateGrades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) =>
          [grade, selected.filter((row) => row.value.candidateGrade === grade).length])),
        currentRuntimeAblation: {
          baselineGrades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) =>
            [grade, selected.filter((row) => row.value.runtimeBaselineGrade === grade).length])),
          candidateGrades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) =>
            [grade, selected.filter((row) => row.value.runtimeCandidateGrade === grade).length])),
          gradeChanges: selected.filter((row) => row.value.runtimeGradeChanged).length,
          actionablePromotions: selected.filter((row) =>
            !["Best Angle", "Lean"].includes(row.value.runtimeBaselineGrade) &&
            ["Best Angle", "Lean"].includes(row.value.runtimeCandidateGrade)).length,
          actionableDemotions: selected.filter((row) =>
            ["Best Angle", "Lean"].includes(row.value.runtimeBaselineGrade) &&
            !["Best Angle", "Lean"].includes(row.value.runtimeCandidateGrade)).length,
        },
        regimes: Object.fromEntries(["confirmation", "resistance", "flip_candidate", "neutral", "unpriced"].map((regime) =>
          [regime, selected.filter((row) => row.value.regime === regime).length])),
        evidenceByRegime: Object.fromEntries(["confirmation", "resistance", "flip_candidate", "neutral", "unpriced"].map((regime) =>
          [regime, selected.filter((row) => row.value.regime === regime && row.value.evidenceAvailable).length])),
        changedActiveGrades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) =>
          [grade, selected.filter((row) => row.value.sideChanged && row.value.activeGrade === grade).length])),
        candidateNoPlayReasons: Object.fromEntries([...new Set(selected
          .filter((row) => row.value.candidateGrade === "No Play")
          .flatMap((row) => row.value.candidateReasonCodes))]
          .sort()
          .map((reason) => [reason, selected.filter((row) =>
            row.value.candidateGrade === "No Play" && row.value.candidateReasonCodes.includes(reason)).length])),
        candidateHeldReasons: Object.fromEntries([...new Set(selected
          .filter((row) => row.value.candidateGrade === "Held")
          .flatMap((row) => row.value.candidateHeldReasonCodes))]
          .sort()
          .map((reason) => [reason, selected.filter((row) =>
            row.value.candidateGrade === "Held" && row.value.candidateHeldReasonCodes.includes(reason)).length])),
      }];
    })),
    changes: games.flatMap((game) => MARKETS.flatMap((market) => {
      const value = game.markets[market];
      return value.sideChanged || value.gradeChanged ? [{ matchup: game.matchup, startsAt: game.startsAt, market, ...value }] : [];
    })),
    games,
  };
}

function runPosteriorResidualTournament(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: residualFeatures(game, "margin", false),
    totalFeatures: residualFeatures(game, "total", false),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const selectionTrain = rows.filter((row) => row.game.date <= "2026-09-20");
  const selection = rows.filter((row) => row.game.date >= "2026-09-25" && row.game.date <= "2026-09-27");
  const confirmation = rows.filter((row) => row.game.date >= "2026-10-02" && row.game.date <= "2026-10-04");
  const microHoldout = rows.filter((row) => row.game.date >= "2026-10-07");
  const configs = [1, 3, 10, 30, 100, 300, 1000, 3000].flatMap((lambda) => [0.25, 0.5, 0.75, 1, 1.5].map((evidenceScale) => ({ lambda, evidenceScale })));
  const baselineSelection = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal);
  const marginCandidates = configs.map((config) => {
    const model = fitPosterior(selectionTrain, "margin", config.lambda);
    const metrics = residualMetrics(selection, (row) => posteriorResidualAxis(row, "margin", model, config.evidenceScale), (row) => row.game.authoritative.expectedTotal);
    return { config, metrics, objective: metrics.marginMae + 4 * (1 - (metrics.moneyline.accuracy ?? 0)) + 4 * (1 - (metrics.spread.accuracy ?? 0)) };
  }).sort((a, b) => a.objective - b.objective);
  const totalCandidates = configs.map((config) => {
    const model = fitPosterior(selectionTrain, "total", config.lambda);
    const metrics = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => posteriorResidualAxis(row, "total", model, config.evidenceScale));
    return { config, metrics, objective: metrics.totalMae + 6 * (1 - (metrics.total.accuracy ?? 0)) };
  }).sort((a, b) => a.objective - b.objective);
  const selectedMargin = marginCandidates[0]!;
  const selectedTotal = totalCandidates[0]!;
  const fitRows = [...selectionTrain, ...selection];
  const marginModel = fitPosterior(fitRows, "margin", selectedMargin.config.lambda);
  const totalModel = fitPosterior(fitRows, "total", selectedTotal.config.lambda);
  const marginPrediction = (row: ResidualRow) => posteriorResidualAxis(row, "margin", marginModel, selectedMargin.config.evidenceScale);
  const totalPrediction = (row: ResidualRow) => posteriorResidualAxis(row, "total", totalModel, selectedTotal.config.evidenceScale);
  const evaluateBlock = (blockRows: ResidualRow[]) => ({
    active: residualMetrics(blockRows, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal),
    candidate: residualMetrics(blockRows, marginPrediction, totalPrediction),
  });
  return {
    release: "cfb_market_log_odds_residual_tournament_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    architecture: "continuous_log_odds_evidence_relative_to_historical_prior_no_market_center_gravity_no_thresholds",
    split: { selectionTrain: selectionTrain.length, selection: selection.length, confirmation: confirmation.length, microHoldout: microHoldout.length },
    selected: { margin: selectedMargin, total: selectedTotal },
    selectionBaseline: baselineSelection,
    confirmation: evaluateBlock(confirmation),
    microHoldout: evaluateBlock(microHoldout),
    allMarginCandidates: marginCandidates,
    allTotalCandidates: totalCandidates,
  };
}

function runPosteriorTournament(games: Game[], detailed = true) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: residualFeatures(game, "margin", detailed),
    totalFeatures: residualFeatures(game, "total", detailed),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const selectionTrain = rows.filter((row) => row.game.date <= "2026-09-20");
  const selection = rows.filter((row) => row.game.date >= "2026-09-25" && row.game.date <= "2026-09-27");
  const confirmation = rows.filter((row) => row.game.date >= "2026-10-02" && row.game.date <= "2026-10-04");
  const microHoldout = rows.filter((row) => row.game.date >= "2026-10-07");
  const lambdas = [1, 3, 10, 30, 100, 300, 1000, 3000];
  const baselineSelection = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal);
  const marginCandidates = lambdas.map((lambda) => {
    const model = fitPosterior(selectionTrain, "margin", lambda);
    const metrics = residualMetrics(selection, (row) => posteriorAxis(row, "margin", model), (row) => row.game.authoritative.expectedTotal);
    const mlHarm = Math.max(0, (baselineSelection.moneyline.accuracy ?? 0) - (metrics.moneyline.accuracy ?? 0));
    const spreadHarm = Math.max(0, (baselineSelection.spread.accuracy ?? 0) - (metrics.spread.accuracy ?? 0));
    return { lambda, metrics, objective: metrics.marginMae + 100 * (mlHarm + spreadHarm), noDirectionalHarm: mlHarm === 0 && spreadHarm === 0 };
  }).sort((a, b) => Number(b.noDirectionalHarm) - Number(a.noDirectionalHarm) || a.objective - b.objective);
  const totalCandidates = lambdas.map((lambda) => {
    const model = fitPosterior(selectionTrain, "total", lambda);
    const metrics = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => posteriorAxis(row, "total", model));
    const totalHarm = Math.max(0, (baselineSelection.total.accuracy ?? 0) - (metrics.total.accuracy ?? 0));
    return { lambda, metrics, objective: metrics.totalMae + 100 * totalHarm, noDirectionalHarm: totalHarm === 0 };
  }).sort((a, b) => Number(b.noDirectionalHarm) - Number(a.noDirectionalHarm) || a.objective - b.objective);
  const selectedMargin = marginCandidates[0]!;
  const selectedTotal = totalCandidates[0]!;
  const fitRows = [...selectionTrain, ...selection];
  const marginModel = fitPosterior(fitRows, "margin", selectedMargin.lambda);
  const totalModel = fitPosterior(fitRows, "total", selectedTotal.lambda);
  const candidateMargin = (row: ResidualRow) => posteriorAxis(row, "margin", marginModel);
  const candidateTotal = (row: ResidualRow) => posteriorAxis(row, "total", totalModel);
  const interventions = (blockRows: ResidualRow[], market: Market) => blockRows.flatMap((row) => {
    const activeAxis = market === "total" ? row.game.authoritative.expectedTotal : row.game.authoritative.expectedMarginHome;
    const candidateAxis = market === "total" ? candidateTotal(row) : candidateMargin(row);
    const actualAxis = market === "total" ? row.actualTotal : row.actualMargin;
    const boundary = market === "moneyline" ? 0 : market === "spread" ? -(row.game.targetLines.spread ?? Number.NaN) : row.game.targetLines.total ?? Number.NaN;
    if (!Number.isFinite(boundary)) return [];
    const activeSide = lineWinner(activeAxis, boundary);
    const candidateSide = lineWinner(candidateAxis, boundary);
    if (activeSide === candidateSide) return [];
    const actualSide = lineWinner(actualAxis, boundary);
    const features = market === "total" ? row.totalFeatures : row.marginFeatures;
    const model = market === "total" ? totalModel : marginModel;
    return [{
      game: `${row.game.awayTeam}@${row.game.homeTeam}`,
      date: row.game.date,
      line: boundary,
      activeAxis,
      candidateAxis,
      actualAxis,
      posterior: predictPosterior(model, features),
      result: candidateSide === actualSide ? "correction" : activeSide === actualSide ? "harm" : "push_transition",
      marketPath: features.market_path ?? null,
      marketDisagreement: features.market_disagreement ?? null,
      namedMoves: features[`${market === "moneyline" ? "spread" : market}_named_move_count`] ?? 0,
      retailMoves: features[`${market === "moneyline" ? "spread" : market}_retail_move_count`] ?? 0,
      reversals: (features[`${market === "moneyline" ? "spread" : market}_all_reversal_count`] ?? 0),
      namedSplit: features.split_named_sharp ?? null,
      fallbackSplit: features.split_fallback ?? null,
      publicSplit: features.split_public ?? null,
      bothFbs: row.game.awayFbs && row.game.homeFbs,
      sameConference: row.game.awayConferenceId !== null && row.game.awayConferenceId === row.game.homeConferenceId,
    }];
  });
  const evaluateBlock = (blockRows: ResidualRow[]) => ({
    active: residualMetrics(blockRows, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal),
    candidate: residualMetrics(blockRows, candidateMargin, candidateTotal),
    posterior: {
      margin: {
        mean: average(blockRows.map((row) => predictPosterior(marginModel, row.marginFeatures))),
        min: Math.min(...blockRows.map((row) => predictPosterior(marginModel, row.marginFeatures))),
        max: Math.max(...blockRows.map((row) => predictPosterior(marginModel, row.marginFeatures))),
      },
      total: {
        mean: average(blockRows.map((row) => predictPosterior(totalModel, row.totalFeatures))),
        min: Math.min(...blockRows.map((row) => predictPosterior(totalModel, row.totalFeatures))),
        max: Math.max(...blockRows.map((row) => predictPosterior(totalModel, row.totalFeatures))),
      },
    },
  });
  return {
    release: "cfb_market_hypothesis_posterior_tournament_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    architecture: "continuous_regularized_active_vs_market_counterfactual_posterior_no_thresholds",
    featureSet: detailed ? "continuous_source_identity_and_raw_splits" : "coarse_provenance_aggregates",
    split: { selectionTrain: selectionTrain.length, selection: selection.length, confirmation: confirmation.length, microHoldout: microHoldout.length },
    selected: { margin: selectedMargin, total: selectedTotal },
    selectionBaseline: baselineSelection,
    confirmation: evaluateBlock(confirmation),
    confirmationInterventions: Object.fromEntries(MARKETS.map((market) => [market, interventions(confirmation, market)])),
    microHoldout: evaluateBlock(microHoldout),
    allMarginCandidates: marginCandidates,
    allTotalCandidates: totalCandidates,
  };
}

type JointModel = RidgeModel;
type JointConfig = { lambda: number; winnerWeight: number; lineWeight: number };

function fitJointModel(rows: ResidualRow[], axis: "margin" | "total", config: JointConfig): JointModel {
  const featureKey = axis === "margin" ? "marginFeatures" : "totalFeatures";
  const names = [...new Set(rows.flatMap((row) => Object.keys(row[featureKey])))].sort();
  const means = names.map((name) => average(rows.flatMap((row) => row[featureKey][name] === undefined ? [] : [row[featureKey][name]!])) ?? 0);
  const scales = names.map((name, index) => {
    const values = rows.flatMap((row) => row[featureKey][name] === undefined ? [] : [row[featureKey][name]!]);
    const mean = means[index]!;
    const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
    return Math.sqrt(variance) || 1;
  });
  const x = rows.map((row) => [1, ...names.map((name, index) => ((row[featureKey][name] ?? means[index]!) - means[index]!) / scales[index]!) ]);
  const active = rows.map((row) => axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal);
  const actual = rows.map((row) => axis === "margin" ? row.actualMargin : row.actualTotal);
  const residualScale = Math.sqrt(average(actual.map((value, index) => (value - active[index]!) ** 2)) ?? 1) || 1;
  const directionalScale = axis === "margin" ? 7 : 10;
  const beta = Array.from({ length: names.length + 1 }, () => 0);
  const firstMoment = Array.from({ length: beta.length }, () => 0);
  const secondMoment = Array.from({ length: beta.length }, () => 0);
  for (let iteration = 1; iteration <= 500; iteration += 1) {
    const gradient = Array.from({ length: beta.length }, () => 0);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const prediction = active[rowIndex]! + x[rowIndex]!.reduce((sum, value, index) => sum + value * beta[index]!, 0);
      let derivative = 2 * (prediction - actual[rowIndex]!) / (residualScale ** 2);
      if (axis === "margin" && config.winnerWeight > 0 && actual[rowIndex] !== 0) {
        const direction = Math.sign(actual[rowIndex]!);
        derivative += config.winnerWeight * (-direction / directionalScale) * sigmoid(-direction * prediction / directionalScale);
      }
      const line = axis === "margin" ? rows[rowIndex]!.game.targetLines.spread : rows[rowIndex]!.game.targetLines.total;
      if (line !== null && config.lineWeight > 0) {
        const boundary = axis === "margin" ? -line : line;
        const difference = actual[rowIndex]! - boundary;
        if (difference !== 0) {
          const direction = Math.sign(difference);
          derivative += config.lineWeight * (-direction / directionalScale) * sigmoid(-direction * (prediction - boundary) / directionalScale);
        }
      }
      for (let index = 0; index < beta.length; index += 1) gradient[index] += derivative * x[rowIndex]![index]! / rows.length;
    }
    for (let index = 1; index < beta.length; index += 1) gradient[index] += config.lambda * beta[index]! / rows.length;
    const learningRate = 0.02;
    for (let index = 0; index < beta.length; index += 1) {
      firstMoment[index] = 0.9 * firstMoment[index]! + 0.1 * gradient[index]!;
      secondMoment[index] = 0.999 * secondMoment[index]! + 0.001 * gradient[index]! ** 2;
      const correctedFirst = firstMoment[index]! / (1 - 0.9 ** iteration);
      const correctedSecond = secondMoment[index]! / (1 - 0.999 ** iteration);
      beta[index] -= learningRate * correctedFirst / (Math.sqrt(correctedSecond) + 1e-8);
    }
  }
  return { names, means, scales, beta };
}

function predictJoint(model: JointModel, row: ResidualRow, axis: "margin" | "total"): number {
  const features = axis === "margin" ? row.marginFeatures : row.totalFeatures;
  const active = axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal;
  return active + model.beta[0]! + model.names.reduce((sum, name, index) => sum + model.beta[index + 1]! * (((features[name] ?? model.means[index]!) - model.means[index]!) / model.scales[index]!), 0);
}

function runJointTournament(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: residualFeatures(game, "margin"),
    totalFeatures: residualFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const selectionTrain = rows.filter((row) => row.game.date <= "2026-09-20");
  const selection = rows.filter((row) => row.game.date >= "2026-09-25" && row.game.date <= "2026-09-27");
  const confirmation = rows.filter((row) => row.game.date >= "2026-10-02" && row.game.date <= "2026-10-04");
  const microHoldout = rows.filter((row) => row.game.date >= "2026-10-07");
  const marginConfigs: JointConfig[] = [1, 10, 30].flatMap((lambda) =>
    [0.25, 1, 2].flatMap((winnerWeight) => [0.25, 1, 2].map((lineWeight) => ({ lambda, winnerWeight, lineWeight }))));
  const totalConfigs: JointConfig[] = [1, 10, 30].flatMap((lambda) =>
    [0.5, 1, 2].map((lineWeight) => ({ lambda, winnerWeight: 0, lineWeight })));
  const baselineSelection = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal);
  const marginCandidates = marginConfigs.map((config) => {
    const model = fitJointModel(selectionTrain, "margin", config);
    const metrics = residualMetrics(selection, (row) => predictJoint(model, row, "margin"), (row) => row.game.authoritative.expectedTotal);
    const mlError = 1 - (metrics.moneyline.accuracy ?? 0);
    const spreadError = 1 - (metrics.spread.accuracy ?? 0);
    return { config, metrics, objective: metrics.marginMae + 4 * mlError + 4 * spreadError };
  }).sort((a, b) => a.objective - b.objective || a.metrics.marginMae - b.metrics.marginMae);
  const totalCandidates = totalConfigs.map((config) => {
    const model = fitJointModel(selectionTrain, "total", config);
    const metrics = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => predictJoint(model, row, "total"));
    return { config, metrics, objective: metrics.totalMae + 6 * (1 - (metrics.total.accuracy ?? 0)) };
  }).sort((a, b) => a.objective - b.objective || a.metrics.totalMae - b.metrics.totalMae);
  const selectedMargin = marginCandidates[0]!;
  const selectedTotal = totalCandidates[0]!;
  const fitRows = [...selectionTrain, ...selection];
  const marginModel = fitJointModel(fitRows, "margin", selectedMargin.config);
  const totalModel = fitJointModel(fitRows, "total", selectedTotal.config);
  const marginPrediction = (row: ResidualRow) => predictJoint(marginModel, row, "margin");
  const totalPrediction = (row: ResidualRow) => predictJoint(totalModel, row, "total");
  const evaluateBlock = (blockRows: ResidualRow[]) => ({
    active: residualMetrics(blockRows, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal),
    candidate: residualMetrics(blockRows, marginPrediction, totalPrediction),
  });
  return {
    release: "cfb_market_joint_score_direction_tournament_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    architecture: "continuous_regularized_score_error_plus_directional_likelihood_no_market_center_target_no_thresholds",
    split: { selectionTrain: selectionTrain.length, selection: selection.length, confirmation: confirmation.length, microHoldout: microHoldout.length },
    selected: { margin: selectedMargin, total: selectedTotal },
    selectionBaseline: baselineSelection,
    confirmation: evaluateBlock(confirmation),
    microHoldout: evaluateBlock(microHoldout),
    topMarginCandidates: marginCandidates.slice(0, 8),
    topTotalCandidates: totalCandidates.slice(0, 8),
  };
}

function winner(value: number): "home" | "away" | "push" { return Math.abs(value) < 1e-9 ? "push" : value > 0 ? "home" : "away"; }
function lineWinner(value: number, boundary: number): "first" | "second" | "push" { const delta = value - boundary; return Math.abs(delta) < 1e-9 ? "push" : delta > 0 ? "first" : "second"; }
function accuracy(pairs: Array<{ predicted: string; actual: string }>): { wins: number; losses: number; pushes: number; accuracy: number | null } {
  const resolved = pairs.filter((pair) => pair.actual !== "push" && pair.predicted !== "push");
  const wins = resolved.filter((pair) => pair.predicted === pair.actual).length;
  return { wins, losses: resolved.length - wins, pushes: pairs.length - resolved.length, accuracy: resolved.length ? wins / resolved.length : null };
}

function residualMetrics(rows: ResidualRow[], marginPrediction: (row: ResidualRow) => number, totalPrediction: (row: ResidualRow) => number) {
  const predictions = rows.map((row) => ({ row, margin: marginPrediction(row), total: totalPrediction(row) }));
  const marginMae = average(predictions.map(({ row, margin }) => Math.abs(margin - row.actualMargin))) ?? 0;
  const totalMae = average(predictions.map(({ row, total }) => Math.abs(total - row.actualTotal))) ?? 0;
  const teamScoreMae = average(predictions.flatMap(({ row, margin, total }) => {
    const home = (total + margin) / 2; const away = (total - margin) / 2;
    return [Math.abs(home - row.game.homeScore), Math.abs(away - row.game.awayScore)];
  })) ?? 0;
  const moneyline = accuracy(predictions.map(({ row, margin }) => ({ predicted: winner(margin), actual: winner(row.actualMargin) })));
  const spreadRows = predictions.filter(({ row }) => row.game.targetLines.spread !== null);
  const spread = accuracy(spreadRows.map(({ row, margin }) => ({ predicted: lineWinner(margin, -(row.game.targetLines.spread ?? 0)), actual: lineWinner(row.actualMargin, -(row.game.targetLines.spread ?? 0)) })));
  const totalRows = predictions.filter(({ row }) => row.game.targetLines.total !== null);
  const total = accuracy(totalRows.map(({ row, total }) => ({ predicted: lineWinner(total, row.game.targetLines.total ?? total), actual: lineWinner(row.actualTotal, row.game.targetLines.total ?? row.actualTotal) })));
  return { games: rows.length, marginMae, totalMae, teamScoreMae, moneyline, spread, total };
}

function runResidualTournament(games: Game[]) {
  const rows: ResidualRow[] = games.map((game) => ({
    game,
    marginFeatures: residualFeatures(game, "margin"),
    totalFeatures: residualFeatures(game, "total"),
    actualMargin: game.homeScore - game.awayScore,
    actualTotal: game.homeScore + game.awayScore,
  }));
  const selectionTrain = rows.filter((row) => row.game.date <= "2026-09-20");
  const selection = rows.filter((row) => row.game.date >= "2026-09-25" && row.game.date <= "2026-09-27");
  const confirmation = rows.filter((row) => row.game.date >= "2026-10-02" && row.game.date <= "2026-10-04");
  const microHoldout = rows.filter((row) => row.game.date >= "2026-10-07");
  const configs: ResidualConfig[] = [1, 3, 10, 30, 100, 300, 1000].flatMap((lambda) =>
    [0.25, 0.5, 0.75, 1].flatMap((weight) => [0, 1, 2, 3, 5, 7, 10].map((threshold) => ({ lambda, weight, threshold }))));
  const marginModels = new Map([...new Set(configs.map((config) => config.lambda))].map((lambda) => [lambda, fitRidge(selectionTrain, "margin", lambda)]));
  const totalModels = new Map([...new Set(configs.map((config) => config.lambda))].map((lambda) => [lambda, fitRidge(selectionTrain, "total", lambda)]));
  const baselineSelection = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal);
  const gated = (row: ResidualRow, axis: "margin" | "total", config: ResidualConfig, model: RidgeModel) => {
    const independent = axis === "margin" ? row.game.independent.expectedMarginHome : row.game.independent.expectedTotal;
    const active = axis === "margin" ? row.game.authoritative.expectedMarginHome : row.game.authoritative.expectedTotal;
    const raw = independent + config.weight * predictRidge(model, axis === "margin" ? row.marginFeatures : row.totalFeatures);
    return Math.abs(raw - active) >= config.threshold ? raw : active;
  };
  const marginCandidates = configs.map((config) => {
    const model = marginModels.get(config.lambda)!;
    const metrics = residualMetrics(selection, (row) => gated(row, "margin", config, model), (row) => row.game.authoritative.expectedTotal);
    const mlHarm = Math.max(0, (baselineSelection.moneyline.accuracy ?? 0) - (metrics.moneyline.accuracy ?? 0));
    const spreadHarm = Math.max(0, (baselineSelection.spread.accuracy ?? 0) - (metrics.spread.accuracy ?? 0));
    return { config, metrics, objective: metrics.marginMae + 100 * (mlHarm + spreadHarm), strict: mlHarm === 0 && spreadHarm === 0 && metrics.marginMae <= baselineSelection.marginMae };
  }).sort((a, b) => Number(b.strict) - Number(a.strict) || a.objective - b.objective || a.metrics.marginMae - b.metrics.marginMae);
  const totalCandidates = configs.map((config) => {
    const model = totalModels.get(config.lambda)!;
    const metrics = residualMetrics(selection, (row) => row.game.authoritative.expectedMarginHome, (row) => gated(row, "total", config, model));
    const totalHarm = Math.max(0, (baselineSelection.total.accuracy ?? 0) - (metrics.total.accuracy ?? 0));
    return { config, metrics, objective: metrics.totalMae + 100 * totalHarm, strict: totalHarm === 0 && metrics.totalMae <= baselineSelection.totalMae };
  }).sort((a, b) => Number(b.strict) - Number(a.strict) || a.objective - b.objective || a.metrics.totalMae - b.metrics.totalMae);
  const selectedMargin = marginCandidates[0]!;
  const selectedTotal = totalCandidates[0]!;
  const fitRows = [...selectionTrain, ...selection];
  const marginModel = fitRidge(fitRows, "margin", selectedMargin.config.lambda);
  const totalModel = fitRidge(fitRows, "total", selectedTotal.config.lambda);
  const candidatePredictions = {
    margin: (row: ResidualRow) => gated(row, "margin", selectedMargin.config, marginModel),
    total: (row: ResidualRow) => gated(row, "total", selectedTotal.config, totalModel),
  };
  const evaluateBlock = (blockRows: ResidualRow[]) => ({
    active: residualMetrics(blockRows, (row) => row.game.authoritative.expectedMarginHome, (row) => row.game.authoritative.expectedTotal),
    independent: residualMetrics(blockRows, (row) => row.game.independent.expectedMarginHome, (row) => row.game.independent.expectedTotal),
    candidate: residualMetrics(blockRows, candidatePredictions.margin, candidatePredictions.total),
  });
  return {
    release: "cfb_market_residual_tournament_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    split: { selectionTrain: selectionTrain.length, selection: selection.length, confirmation: confirmation.length, microHoldout: microHoldout.length },
    selected: {
      margin: { ...selectedMargin, metrics: undefined },
      total: { ...selectedTotal, metrics: undefined },
      combinedSelectionMetrics: residualMetrics(selection, candidatePredictions.margin, candidatePredictions.total),
    },
    baselines: { selection: baselineSelection },
    confirmation: evaluateBlock(confirmation),
    microHoldout: evaluateBlock(microHoldout),
    topMarginSelectionCandidates: marginCandidates.slice(0, 10),
    topTotalSelectionCandidates: totalCandidates.slice(0, 10),
    featureCounts: { margin: marginModel.names.length, total: totalModel.names.length },
  };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const writer = await readCfbForwardWriterEvidence({ client, season: 2026 });
  const officialLocks = process.argv.includes("--official-locks") ? await readOfficialLockSelections(client) : null;
  const evidencePool = officialLocks
    ? await readEvidenceByHashes(client, [...officialLocks.byGame.values()].map((lock) => lock.payloadSha256))
    : writer.evidence;
  const results = await readResults(client, [...new Set(evidencePool.map((row) => row.providerGameId))]);
  const latest = new Map<string, typeof writer.evidence[number]>();
  if (officialLocks) {
    const byHash = new Map(evidencePool.map((row) => [row.payloadSha256, row] as const));
    for (const [gameId, lock] of officialLocks.byGame) {
      const row = byHash.get(lock.payloadSha256);
      if (row && row.providerGameId === gameId) latest.set(gameId, row);
    }
  } else {
    for (const row of writer.evidence) { if (Date.parse(row.capturedAt) >= Date.parse(row.gameStartAt)) continue; const prior = latest.get(row.providerGameId); if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) latest.set(row.providerGameId, row); }
  }
  const settledIds = [...latest.values()].filter((row) => isFinal(results.get(row.providerGameId))).map((row) => row.providerGameId);
  const history = await readCfbForwardMarketHistory({ client, season: 2026, providerGameIds: settledIds }); const byGame = new Map<string, CfbForwardMarketHistoryEvidence[]>();
  for (const row of history) {
    const cutoff = officialLocks?.byGame.get(row.providerGameId)?.lockedAt ?? row.gameStartAt;
    if (Date.parse(row.capturedAt) <= Date.parse(cutoff)) byGame.set(row.providerGameId, [...(byGame.get(row.providerGameId) ?? []), row]);
  }
  if (process.argv.includes("--capture-audit")) {
    const selected = [...latest.values()].filter((row) => isFinal(results.get(row.providerGameId)));
    const leadMinutes = selected.map((row) => (Date.parse(row.gameStartAt) - Date.parse(row.capturedAt)) / 60_000);
    console.log(JSON.stringify({
      release: "cfb_market_reader_capture_integrity_2026_10_08_r1",
      source: officialLocks ? "official_prediction_record_payload" : "latest_pregame_writer_payload",
      officialLockGames: officialLocks?.byGame.size ?? null,
      incompatibleOfficialLockGames: officialLocks?.incompatibleGames ?? [],
      selectedGames: selected.length,
      byStage: Object.fromEntries([...new Set(selected.map((row) => row.stage))].sort().map((stage) => [stage, selected.filter((row) => row.stage === stage).length])),
      leadMinutes: {
        minimum: Math.min(...leadMinutes),
        median: median(leadMinutes),
        maximum: Math.max(...leadMinutes),
        insideFiftyMinutes: leadMinutes.filter((minutes) => minutes < 50).length,
        insideZeroMinutes: leadMinutes.filter((minutes) => minutes <= 0).length,
      },
    }, null, 2));
    return;
  }
  const games: Game[] = [];
  for (const row of latest.values()) {
    const result = results.get(row.providerGameId);
    const histories = byGame.get(row.providerGameId) ?? [];
    if (!isFinal(result) || !histories.length) continue;
    const independent = row.payload.independentForecast ?? row.payload.decisions.forecast;
    const authoritative = row.payload.decisions.forecast;
    const spreadDecision = row.payload.decisions.evaluatedBets.find((decision) => decision.market === "spread") ?? null;
    const totalDecision = row.payload.decisions.evaluatedBets.find((decision) => decision.market === "total") ?? null;
    const selectedSpreadLine = spreadDecision?.evaluatedQuote.line ?? null;
    const homeSpreadLine = selectedSpreadLine === null || !spreadDecision
      ? null
      : isHomeDecisionSide(spreadDecision.side, row.payload.game.home.abbreviation)
        ? selectedSpreadLine
        : -selectedSpreadLine;
    games.push({
      gameId: row.providerGameId,
      date: row.gameStartAt.slice(0, 10),
      kickoffAt: row.gameStartAt,
      awayTeam: row.payload.game.away.abbreviation,
      homeTeam: row.payload.game.home.abbreviation,
      awayFbs: row.payload.game.away.fbs,
      homeFbs: row.payload.game.home.fbs,
      awayConferenceId: row.payload.game.away.conferenceId,
      homeConferenceId: row.payload.game.home.conferenceId,
      independent: {
        expectedMarginHome: independent.expectedMarginHome,
        expectedTotal: independent.expectedTotal,
        homeWinProbability: independent.homeWinProbability,
        pmf: "pmf" in independent ? independent.pmf as Forecast["pmf"] : undefined,
      },
      authoritative: {
        expectedMarginHome: authoritative.expectedMarginHome,
        expectedTotal: authoritative.expectedTotal,
        homeWinProbability: authoritative.homeWinProbability,
        pmf: "pmf" in authoritative ? authoritative.pmf as Forecast["pmf"] : undefined,
      },
      targetLines: {
        moneyline: null,
        spread: homeSpreadLine,
        total: totalDecision?.evaluatedQuote.line ?? null,
      },
      targetGrades: Object.fromEntries(MARKETS.map((market) => [
        market,
        row.payload.decisions.evaluatedBets.find((decision) => decision.market === market)?.grade ?? "Held",
      ])) as Record<Market, string>,
      targetPrices: Object.fromEntries(MARKETS.map((market) => [
        market,
        row.payload.decisions.evaluatedBets.find((decision) => decision.market === market)?.evaluatedQuote.price ?? null,
      ])) as Record<Market, number | null>,
      awayScore: result.away_score!,
      homeScore: result.home_score!,
      histories: histories.sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt)),
    });
  }
  const requestedGame = process.argv.find((value) => value.startsWith("--game="))?.slice(7) ?? null;
  if (process.argv.includes("--stored-playbook-coverage")) {
    const latestPlaybookByGame = games.map((game) => {
      const observations = game.histories.flatMap((history) => {
        const splits = history.payload.market.playbookSplits;
        if (!splits) return [];
        const markets = MARKETS.filter((market) => splits[market] !== null);
        return markets.length ? [{ capturedAt: history.capturedAt, markets }] : [];
      }).sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt));
      return { gameId: game.gameId, latest: observations.at(-1) ?? null };
    });
    const captured = latestPlaybookByGame.filter((row) => row.latest !== null);
    console.log(JSON.stringify({
      release: "cfb_stored_playbook_coverage_2026_10_09_r1",
      mode: "select_only_zero_writes_zero_provider_calls",
      settledGames: games.length,
      gamesWithStoredPlaybookSplits: captured.length,
      latestCapturedAt: captured.map((row) => row.latest!.capturedAt).sort().at(-1) ?? null,
      byMarket: Object.fromEntries(MARKETS.map((market) => [market,
        captured.filter((row) => row.latest!.markets.includes(market)).length])),
    }, null, 2));
    return;
  }
  if (requestedGame) {
    const game = games.find((candidate) =>
      candidate.gameId === requestedGame ||
      `${candidate.awayTeam}@${candidate.homeTeam}`.toLowerCase() === requestedGame.toLowerCase());
    if (!game) throw new Error(`CFB audit game ${requestedGame} was not found in the selected evidence set.`);
    const stored = latest.get(game.gameId)!;
    const training = games.filter((candidate) => candidate.date < game.date).map((candidate): ResidualRow => ({
      game: candidate,
      marginFeatures: residualFeatures(candidate, "margin", false),
      totalFeatures: constrainedMarketFeatures(candidate, "total"),
      actualMargin: candidate.homeScore - candidate.awayScore,
      actualTotal: candidate.homeScore + candidate.awayScore,
    }));
    const row: ResidualRow = {
      game,
      marginFeatures: residualFeatures(game, "margin", false),
      totalFeatures: constrainedMarketFeatures(game, "total"),
      actualMargin: game.homeScore - game.awayScore,
      actualTotal: game.homeScore + game.awayScore,
    };
    const marginModel = fitPosterior(training, "margin", 1000);
    const totalModel = fitPosterior(training, "total", 30);
    const rawMargin = posteriorResidualAxis(row, "margin", marginModel, 1);
    const candidateMargin = posteriorObservedEvidenceAxis(row, "margin", marginModel, 1);
    const rawTotal = posteriorResidualAxis(row, "total", totalModel, 1);
    const candidateTotal = posteriorFlipOnlyAxis(row, "total", totalModel, 1);
    const independentBaseTraining = training.map((candidate) => ({
      ...candidate,
      game: { ...candidate.game, authoritative: candidate.game.independent },
    }));
    const independentBaseRow: ResidualRow = {
      ...row,
      game: { ...row.game, authoritative: row.game.independent },
    };
    const independentBaseMarginModel = fitPosterior(independentBaseTraining, "margin", 1000);
    const independentBaseTotalModel = fitPosterior(independentBaseTraining, "total", 30);
    const independentBaseRawMargin = posteriorResidualAxis(independentBaseRow, "margin", independentBaseMarginModel, 1);
    const independentBaseCandidateMargin = posteriorObservedEvidenceAxis(independentBaseRow, "margin", independentBaseMarginModel, 1);
    const independentBaseRawTotal = posteriorResidualAxis(independentBaseRow, "total", independentBaseTotalModel, 1);
    const independentBaseCandidateTotal = posteriorFlipOnlyAxis(independentBaseRow, "total", independentBaseTotalModel, 1);
    console.log(JSON.stringify({
      release: "cfb_game_market_sequence_review_2026_10_09_r1",
      mode: "select_only_zero_writes_zero_provider_calls",
      source: officialLocks ? "official_locked_payload" : "latest_pregame_payload",
      game: {
        providerGameId: game.gameId,
        matchup: `${game.awayTeam}@${game.homeTeam}`,
        kickoffAt: game.kickoffAt,
        final: { away: game.awayScore, home: game.homeScore },
        actualMarginHome: row.actualMargin,
        actualTotal: row.actualTotal,
      },
      lock: {
        capturedAt: stored.capturedAt,
        stage: stored.stage,
        schemaRelease: stored.payload.schemaRelease,
        memberRelease: stored.payload.memberRelease,
        decisionRelease: stored.payload.decisions.decisionRelease,
      },
      forecasts: {
        independent: game.independent,
        released: game.authoritative,
        correctedTargetExcludedReader: {
          trainingGames: training.length,
          rawMargin,
          candidateMargin,
          marginShift: candidateMargin - game.authoritative.expectedMarginHome,
          rawTotal,
          candidateTotal,
          totalShift: candidateTotal - game.authoritative.expectedTotal,
        },
        independentBaseTargetExcludedReader: {
          trainingGames: independentBaseTraining.length,
          rawMargin: independentBaseRawMargin,
          candidateMargin: independentBaseCandidateMargin,
          marginShift: independentBaseCandidateMargin - game.independent.expectedMarginHome,
          rawTotal: independentBaseRawTotal,
          candidateTotal: independentBaseCandidateTotal,
          totalShift: independentBaseCandidateTotal - game.independent.expectedTotal,
        },
      },
      releasedDecisions: stored.payload.decisions.evaluatedBets.map((decision) => ({
        market: decision.market,
        side: decision.side,
        grade: decision.grade,
        modelProbability: decision.modelProbability,
        evaluatedQuote: decision.evaluatedQuote,
        gradeAdjustment: decision.gradeAdjustment,
      })),
      sequence: Object.fromEntries(MARKETS.map((market) => [market, {
        movements: marketMoves(game.histories, market),
        splits: splitReads(game.histories, market),
        observations: game.histories.map((history) => ({
          capturedAt: history.capturedAt,
          families: families(history, market).map((family) => ({
            family: family[0],
            sourceClass: family[2],
            opening: family[4],
            current: family[5],
          })),
          public: history.payload.market.playbookSplits?.[market] ?? null,
          sharp: (history.payload.market.sharpApiSplits ?? []).map((record) => ({
            capturedAt: record.capturedAt,
            sportsbook: record.sportsbook,
            sourceSemantics: record.sourceSemantics,
            market: market === "moneyline" ? record.moneyline : market === "spread" ? record.spread : record.total,
          })),
        })),
      }])),
      features: {
        margin: row.marginFeatures,
        total: row.totalFeatures,
      },
    }, null, 2));
    return;
  }
  if (process.argv.includes("--fcs-historical-plan")) {
    const fcs = games.filter((game) => !game.awayFbs && !game.homeFbs);
    const kickoffGroups = [...new Map(fcs.map((game) => [game.kickoffAt, fcs.filter((candidate) => candidate.kickoffAt === game.kickoffAt)])).entries()]
      .sort(([first], [second]) => Date.parse(first) - Date.parse(second));
    console.log(JSON.stringify({
      settledFcsGames: fcs.length,
      kickoffGroups: kickoffGroups.length,
      historicalCreditsAtThirtyPerGroup: kickoffGroups.length * 30,
      groups: kickoffGroups.map(([kickoffAt, group]) => ({
        kickoffAt,
        snapshotAt: new Date(Date.parse(kickoffAt) - 60 * 60_000).toISOString(),
        games: group.length,
      })),
    }, null, 2));
    return;
  }
  if (process.argv.includes("--fcs-historical-grade-audit")) {
    const apiKey = process.env.THE_ODDS_API_KEY;
    if (!apiKey) throw new Error("The Odds API key is required for the FCS historical grade audit.");
    const fromDate = process.argv.find((value) => value.startsWith("--from-date="))?.split("=")[1] ?? null;
    const toDate = process.argv.find((value) => value.startsWith("--to-date="))?.split("=")[1] ?? null;
    const fcsRows = [...latest.values()].filter((row) => {
      const result = results.get(row.providerGameId);
      return isFinal(result) && !row.payload.game.away.fbs && !row.payload.game.home.fbs &&
        (!fromDate || row.gameStartAt.slice(0, 10) >= fromDate) &&
        (!toDate || row.gameStartAt.slice(0, 10) <= toDate);
    });
    const completedGames = [...latest.values()].flatMap((row) => {
      const result = results.get(row.providerGameId);
      return isFinal(result) ? [{
        ...row.payload.game,
        awayScore: result.away_score!,
        homeScore: result.home_score!,
      }] : [];
    });
    const advancedState = await readCfbCurrentAdvancedState({ client, season: 2026 });
    const weeklyForecasts = getCfbV1WeeklyForecasts({
      games: fcsRows.map((row) => row.payload.game),
      completedGames,
      advancedGames: advancedState?.games ?? [],
    });
    const groups = [...new Map(fcsRows.map((row) => [
      row.gameStartAt,
      fcsRows.filter((candidate) => candidate.gameStartAt === row.gameStartAt),
    ])).entries()].sort(([first], [second]) => Date.parse(first) - Date.parse(second));
    const historicalBooks = new Map<string, ReturnType<typeof buildCfbNamedBookPriceHierarchy>>();
    let creditsUsed = 0;
    let creditsRemaining: number | null = null;
    let requests = 0;
    for (const [kickoffAt, rows] of groups) {
      const snapshotAt = new Date(Date.parse(kickoffAt) - 60 * 60_000).toISOString();
      const response = await fetchCfbTheOddsApiHistoricalOpenings({
        games: rows.map((row) => row.payload.game),
        apiKey,
        snapshotDates: [snapshotAt],
      });
      requests += response.requests;
      creditsUsed += response.creditsUsed;
      creditsRemaining = response.creditsRemaining ?? creditsRemaining;
      for (const row of rows) {
        historicalBooks.set(row.providerGameId, response.booksByGame[row.providerGameId] ?? []);
      }
    }
    const decisions = fcsRows.flatMap((row) => {
      const result = results.get(row.providerGameId)!;
      const added = historicalBooks.get(row.providerGameId) ?? [];
      const comparableCurrentBooks = buildCfbNamedBookPriceHierarchy(row.payload.market.currentBooks, added);
      const evaluatedAt = new Date(Date.parse(row.gameStartAt) - 60 * 60_000).toISOString();
      const weeklyForecast = weeklyForecasts.get(row.providerGameId);
      if (!weeklyForecast) throw new Error(`Historical FCS forecast missing for ${row.providerGameId}.`);
      const fixedEvaluatedSportsbookByMarket = Object.fromEntries(row.payload.decisions.evaluatedBets.map((decision) =>
        [decision.market, decision.evaluatedQuote.sportsbook]));
      const bundle = applyCfbVerifiedAvailabilityGradeCap({
        bundle: applyCfbMarketSharpAwareGrades({
          bundle: buildCfbV1DecisionBundle({
            providerGameId: row.providerGameId,
            awayTeam: row.payload.game.away.abbreviation,
            homeTeam: row.payload.game.home.abbreviation,
            gameStartsAt: row.gameStartAt,
            comparableCurrentBooks,
            stage: "t60_locked",
            evaluatedAt,
            lockedAt: evaluatedAt,
            healthHolds: row.payload.coverage.healthHolds.filter((hold) => hold !== "authoritative_market_anchor_unavailable"),
            forecast: weeklyForecast.forecast,
            contextLines: {
              homeSpread: row.payload.market.playbookLine?.homeSpread ?? null,
              totalLine: row.payload.market.playbookLine?.total ?? null,
            },
            fixedEvaluatedSportsbookByMarket,
          }),
          homeTeam: row.payload.game.home.abbreviation,
          sharpSplits: row.payload.market.sharpApiSplits ?? [],
          playbookLine: row.payload.market.playbookLine,
          publicSplits: row.payload.market.playbookSplits,
          operationalOpening: row.payload.market.operationalOpening,
          current: currentCfbMovementContextBook(comparableCurrentBooks, row.payload.market.operationalOpening),
        }),
        availability: row.payload.availability.verifiedQuarterback ?? null,
      });
      return bundle.evaluatedBets.flatMap((decision) => {
        const previouslyHeld = !row.payload.decisions.evaluatedBets.some((existing) => existing.market === decision.market);
        if (!previouslyHeld) return [];
        const outcome = settleExactDecision({
          market: decision.market,
          side: decision.side,
          line: decision.evaluatedQuote.line,
          awayTeam: row.payload.game.away.abbreviation,
          awayScore: result.away_score!,
          homeScore: result.home_score!,
        });
        return [{
          providerGameId: row.providerGameId,
          date: row.gameStartAt.slice(0, 10),
          matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
          market: decision.market,
          grade: decision.grade,
          side: decision.side,
          price: decision.evaluatedQuote.price,
          modelProbability: decision.modelProbability,
          edgePercentagePoints: decision.edgePercentagePoints,
          expectedValue: decision.expectedValue,
          outcome,
          units: outcome === "push" ? 0 : outcome === "loss" ? -1 : decision.evaluatedQuote.price > 0
            ? decision.evaluatedQuote.price / 100
            : 100 / -decision.evaluatedQuote.price,
          consensusBooks: decision.consensus.books,
          consensusBookCount: decision.consensus.books.length,
          splitAvailable: decision.gradeAdjustment !== null && (
            decision.gradeAdjustment.sharpDirection !== "unknown" || decision.gradeAdjustment.publicDirection !== "unknown"
          ),
          movementAvailable: decision.gradeAdjustment !== null && decision.gradeAdjustment.movementDirection !== "unknown",
          movementDirection: decision.gradeAdjustment?.movementDirection ?? "unknown",
        }];
      });
    });
    const summary = (rows: typeof decisions) => {
      const resolved = rows.filter((row) => row.outcome !== "push");
      return {
        rows: rows.length,
        wins: resolved.filter((row) => row.outcome === "win").length,
        losses: resolved.filter((row) => row.outcome === "loss").length,
        pushes: rows.length - resolved.length,
        hitRate: resolved.length === 0 ? null : resolved.filter((row) => row.outcome === "win").length / resolved.length,
        units: rows.reduce((sum, row) => sum + row.units, 0),
      };
    };
    const laneVariants = [
      { id: "lean_base", eligible: (row: typeof decisions[number]) => row.grade === "Lean" },
      { id: "lean_price_300", eligible: (row: typeof decisions[number]) => row.grade === "Lean" && row.price >= -300 && row.price <= 300 },
      { id: "lean_supporting_move", eligible: (row: typeof decisions[number]) => row.grade === "Lean" && row.movementDirection === "support" },
      { id: "lean_price_300_supporting_move", eligible: (row: typeof decisions[number]) => row.grade === "Lean" && row.price >= -300 && row.price <= 300 && row.movementDirection === "support" },
      { id: "lean_three_books", eligible: (row: typeof decisions[number]) => row.grade === "Lean" && row.consensusBookCount >= 3 },
      { id: "lean_three_books_price_300", eligible: (row: typeof decisions[number]) => row.grade === "Lean" && row.consensusBookCount >= 3 && row.price >= -300 && row.price <= 300 },
      { id: "lean_probability_58", eligible: (row: typeof decisions[number]) => row.grade === "Lean" && row.modelProbability >= 0.58 },
      { id: "lean_probability_58_price_300", eligible: (row: typeof decisions[number]) => row.grade === "Lean" && row.modelProbability >= 0.58 && row.price >= -300 && row.price <= 300 },
    ];
    const laneTournament = Object.fromEntries(MARKETS.map((market) => {
      const marketRows = decisions.filter((row) => row.market === market);
      const variants = laneVariants.map((variant) => {
        const selection = marketRows.filter((row) => row.date <= "2026-09-27" && variant.eligible(row));
        const confirmation = marketRows.filter((row) => row.date >= "2026-10-03" && variant.eligible(row));
        return { id: variant.id, selection: summary(selection), confirmation: summary(confirmation) };
      });
      const selected = variants.filter((variant) =>
        variant.selection.rows >= 10 &&
        (variant.selection.hitRate ?? 0) >= 0.55 &&
        variant.selection.units > 0
      ).sort((first, second) =>
        second.selection.units - first.selection.units ||
        (second.selection.hitRate ?? 0) - (first.selection.hitRate ?? 0) ||
        second.selection.rows - first.selection.rows ||
        first.id.localeCompare(second.id)
      )[0] ?? null;
      return [market, { selected, variants }];
    }));
    console.log(JSON.stringify({
      release: "cfb_fcs_independent_price_corroboration_historical_audit_2026_10_08_r1",
      mode: "historical_provider_read_only_zero_writes",
      settledFcsGames: fcsRows.length,
      kickoffGroups: groups.length,
      requests,
      creditsUsed,
      creditsRemaining,
      historicalMatchedGames: [...historicalBooks.values()].filter((books) => books.length > 0).length,
      recoveredMarkets: decisions.length,
      byMarket: Object.fromEntries(MARKETS.map((market) => [market, summary(decisions.filter((row) => row.market === market))])),
      byGrade: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade, summary(decisions.filter((row) => row.grade === grade))])),
      byMarketGrade: Object.fromEntries(MARKETS.map((market) => [market,
        Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade,
          summary(decisions.filter((row) => row.market === market && row.grade === grade))]))])),
      byMarketMovement: Object.fromEntries(MARKETS.map((market) => [market, {
        present: summary(decisions.filter((row) => row.market === market && row.movementAvailable)),
        absent: summary(decisions.filter((row) => row.market === market && !row.movementAvailable)),
      }])),
      byDate: Object.fromEntries([...new Set(decisions.map((row) => row.date))].sort().map((date) => [date, summary(decisions.filter((row) => row.date === date))])),
      actionable: summary(decisions.filter((row) => row.grade === "Best Angle" || row.grade === "Lean")),
      actionableWithoutSplits: summary(decisions.filter((row) =>
        (row.grade === "Best Angle" || row.grade === "Lean") && !row.splitAvailable)),
      laneTournament,
      ...(process.argv.includes("--details") ? { decisions } : {}),
    }, null, 2));
    return;
  }
  if (process.argv.includes("--current-board-candidate") || process.argv.includes("--current-board-exact-writer")) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const exactWriter = process.argv.includes("--current-board-exact-writer");
    let writerDryRun: Awaited<ReturnType<typeof runCfbForwardEvidenceWriter>> | null = null;
    let auditForecasts: readonly CfbForwardAuditForecast[] = [];
    let currentRows: CfbForwardStoredEvidence[] = [...latest.values()].filter((row) => Date.parse(row.gameStartAt) > now);
    const storedCurrentRows = new Map(currentRows.map((row) => [row.providerGameId, row]));
    if (exactWriter) {
      const balldontlieApiKey = process.env.BALLDONTLIE_API_KEY;
      const playbookApiKey = process.env.PLAYBOOK_API_KEY;
      const sharpApiKey = process.env.SHARPAPI_KEY;
      if (!balldontlieApiKey || !playbookApiKey || !sharpApiKey) {
        throw new Error("Exact CFB writer replay requires configured BALLDONTLIE, Playbook, and SharpAPI credentials.");
      }
      const auditWindow = resolveCfbVisibleWindows({ now: nowIso, evidence: writer.evidence })
        .map((window) => ({
          window,
          games: currentRows.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)).length,
        }))
        .sort((first, second) => second.games - first.games)[0];
      if (!auditWindow || auditWindow.games === 0) throw new Error("Exact CFB writer replay could not resolve the active board window.");
      writerDryRun = await runCfbForwardEvidenceWriter({
        client,
        season: 2026,
        runId: `audit-${randomUUID()}`,
        now: nowIso,
        apply: false,
        balldontlieApiKey,
        playbookApiKey,
        sharpApiKey,
        collegeFootballDataApiKey: process.env.CFBD_API_KEY ?? null,
        theOddsApiKey: process.env.THE_ODDS_API_KEY ?? null,
        weatherProvider: null,
        auditWindowStartDate: auditWindow.window.boardStartDate,
        auditForceUnlocked: true,
        auditForceTheOddsApi: true,
        auditDisableIndependentPriceLane: process.argv.includes("--disable-independent-price-lane"),
        auditDisableCompleteMarketReader: true,
        auditForecasts: (forecasts) => { auditForecasts = forecasts; },
      });
      currentRows = auditForecasts.map((row, index) => ({
        id: `audit-${index}`,
        providerGameId: row.providerGameId,
        stage: row.payload.stage,
        capturedAt: row.payload.capturedAt,
        gameStartAt: row.payload.game.scheduledStart,
        payloadSha256: `audit-${index}`,
        payload: row.payload,
      }));
      if (currentRows.length === 0) throw new Error("Exact CFB writer replay produced no due audit forecasts.");
    }
    const currentHistory = await readMarketHistoryBatched(client, currentRows.map((row) => row.providerGameId));
    const currentByGame = new Map<string, CfbForwardMarketHistoryEvidence[]>();
    for (const row of currentHistory) currentByGame.set(row.providerGameId, [...(currentByGame.get(row.providerGameId) ?? []), row]);
    if (exactWriter) {
      for (const row of currentRows) {
        currentByGame.set(row.providerGameId, [...(currentByGame.get(row.providerGameId) ?? []), {
          id: row.id,
          providerGameId: row.providerGameId,
          stage: row.stage,
          capturedAt: row.capturedAt,
          gameStartAt: row.gameStartAt,
          payloadSha256: row.payloadSha256,
          payload: {
            market: row.payload.market,
            ...(row.payload.contextualEvidenceCapture
              ? { contextualEvidenceCapture: row.payload.contextualEvidenceCapture }
              : {}),
          },
        }]);
      }
    }
    const fullForecasts = new Map<string, CfbV1Forecast>();
    if (exactWriter) {
      for (const row of auditForecasts) fullForecasts.set(row.providerGameId, row.decisionBundle.forecast);
    } else {
      const advancedState = await readCfbCurrentAdvancedState({ client, season: 2026 });
      const weekly = new Map<string, { forecast: CfbV1Forecast }>();
      const windows = resolveCfbVisibleWindows({ now: nowIso, evidence: writer.evidence });
      for (const window of windows) {
        const windowRows = currentRows.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
        if (windowRows.length === 0) continue;
        const completedGames = [...latest.values()].flatMap((row) => {
          const result = results.get(row.providerGameId);
          return isFinal(result) && row.gameStartAt.slice(0, 10) < window.boardStartDate
            ? [{ ...row.payload.game, awayScore: result.away_score!, homeScore: result.home_score! }]
            : [];
        });
        for (const [gameId, forecastResult] of getCfbV1WeeklyForecasts({
          games: windowRows.map((row) => row.payload.game),
          completedGames,
          advancedGames: advancedState?.games ?? [],
        })) weekly.set(gameId, forecastResult);
      }
      for (const row of currentRows) {
        const base = weekly.get(row.providerGameId)?.forecast;
        if (!base) continue;
        const anchor = resolveCfbCanonicalMarketAnchor({
          books: row.payload.market.currentBooks,
          contextLines: {
            homeSpread: row.payload.market.playbookLine?.homeSpread ?? null,
            totalLine: row.payload.market.playbookLine?.total ?? null,
          },
        });
        if (!anchor) {
          fullForecasts.set(row.providerGameId, base);
          continue;
        }
        const priorSpreadSplits = (currentByGame.get(row.providerGameId) ?? []).flatMap((historyRow) =>
          historyRow.payload.market.playbookSplits?.spread ? [historyRow.payload.market.playbookSplits.spread] : []);
        fullForecasts.set(row.providerGameId, buildCfbMarketSharpAwareForecast({
          independentForecast: base,
          anchor,
          current: row.payload.market.current,
          operationalOpening: row.payload.market.operationalOpening,
          sharpSplits: row.payload.market.sharpApiSplits ?? [],
          playbookLine: row.payload.market.playbookLine,
          publicSplits: row.payload.market.playbookSplits,
          priorSpreadSplits,
          kickoffWeather: row.payload.availability.weather ?? null,
          evaluatedAt: row.capturedAt,
        }));
      }
    }
    const report = currentBoardMarketReaderCandidate(
      games,
      currentRows,
      currentByGame,
      fullForecasts,
      exactWriter ? "live_provider_select_only_zero_writes" : undefined,
    );
    const writerInputChanges = exactWriter ? currentRows.flatMap((row) => {
      const stored = storedCurrentRows.get(row.providerGameId);
      if (!stored) return [];
      return MARKETS.flatMap((market) => {
        const before = stored.payload.decisions.evaluatedBets.find((decision) => decision.market === market) ?? null;
        const after = row.payload.decisions.evaluatedBets.find((decision) => decision.market === market) ?? null;
        const beforeGrade = before?.grade ?? "Held";
        const afterGrade = after?.grade ?? "Held";
        if (beforeGrade === afterGrade && before?.side === after?.side && before?.evaluatedQuote.sportsbook === after?.evaluatedQuote.sportsbook) return [];
        return [{
          providerGameId: row.providerGameId,
          matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
          market,
          beforeGrade,
          afterGrade,
          beforeSide: before?.side ?? null,
          afterSide: after?.side ?? null,
          beforeSportsbook: before?.evaluatedQuote.sportsbook ?? null,
          afterSportsbook: after?.evaluatedQuote.sportsbook ?? null,
        }];
      });
    }) : [];
    const actionable = (grade: string) => grade === "Best Angle" || grade === "Lean";
    const writerInputDelta = exactWriter ? {
      changes: writerInputChanges,
      heldRecovered: writerInputChanges.filter((change) => change.beforeGrade === "Held" && change.afterGrade !== "Held").length,
      recoveredActionables: writerInputChanges.filter((change) => change.beforeGrade === "Held" && actionable(change.afterGrade)).length,
      actionablePromotions: writerInputChanges.filter((change) => !actionable(change.beforeGrade) && actionable(change.afterGrade)).length,
      actionableDemotions: writerInputChanges.filter((change) => actionable(change.beforeGrade) && !actionable(change.afterGrade)).length,
    } : null;
    const summaryOnly = process.argv.includes("--summary-only");
    if (process.argv.includes("--interventions-only")) {
      console.log(JSON.stringify({
        release: report.release,
        mode: report.mode,
        artifact: report.artifact,
        boardGames: report.boardGames,
        interventions: report.changes.map((change) => ({
          matchup: change.matchup,
          startsAt: change.startsAt,
          market: change.market,
          line: change.line,
          regime: change.regime,
          evidenceAvailable: change.evidenceAvailable,
          observedEvidence: change.observedEvidence,
          splitEvidenceAvailable: change.splitEvidenceAvailable,
          movementEvidenceAvailable: change.movementEvidenceAvailable,
          activeAxis: change.activeAxis,
          rawEvidenceAxis: change.rawEvidenceAxis,
          candidateAxis: change.candidateAxis,
          axisShift: change.axisShift,
          activeSide: change.activeSide,
          candidateSide: change.candidateSide,
          activeGrade: change.activeGrade,
          candidateGrade: change.candidateGrade,
          candidateReasonCodes: change.candidateReasonCodes,
          candidateHeldReasonCodes: change.candidateHeldReasonCodes,
        })),
      }, null, 2));
      return;
    }
    const output = process.argv.includes("--compact") ? {
      release: report.release,
      mode: report.mode,
      artifact: report.artifact,
      trainedGames: report.trainedGames,
      boardGames: report.boardGames,
      anchorHoldGames: report.anchorHoldGames,
      negativeCandidateScores: report.negativeCandidateScores,
      exactGradeReplayGames: report.exactGradeReplayGames,
      maximumAbsoluteReconstructionDifference: report.maximumAbsoluteReconstructionDifference,
      maximumAbsoluteAlignedReconstructionDifference: report.maximumAbsoluteAlignedReconstructionDifference,
      maximumRuntimeParityDifference: report.maximumRuntimeParityDifference,
      runtimeParityMismatches: report.runtimeParityMismatches,
      marketSummary: report.marketSummary,
      ...(writerInputDelta ? { writerInputDelta } : {}),
      ...(!summaryOnly ? {
        invalidGradeReplayGames: report.invalidGradeReplayGames,
        reconstructionMismatches: report.reconstructionMismatches,
        changes: report.changes,
      } : {}),
    } : report;
    console.log(JSON.stringify({
      ...output,
      ...(writerDryRun ? { writerDryRun } : {}),
    }, null, 2));
    return;
  }
  if (process.argv.includes("--dates")) {
    console.log(JSON.stringify({
      release: "cfb_2026_sharp_sequence_tournament_2026_10_08_r1",
      mode: "select_only_zero_writes_zero_provider_calls",
      settledGames: games.length,
      byDate: Object.fromEntries([...new Set(games.map((game) => game.date))].sort().map((date) => [date, games.filter((game) => game.date === date).length])),
    }, null, 2));
    return;
  }
  if (process.argv.includes("--residual-model")) {
    console.log(JSON.stringify(runResidualTournament(games), null, 2));
    return;
  }
  if (process.argv.includes("--posterior-model")) {
    console.log(JSON.stringify(runPosteriorTournament(games), null, 2));
    return;
  }
  if (process.argv.includes("--posterior-model-coarse")) {
    console.log(JSON.stringify(runPosteriorTournament(games, false), null, 2));
    return;
  }
  if (process.argv.includes("--posterior-residual-model")) {
    const report = runPosteriorResidualTournament(games);
    console.log(JSON.stringify(process.argv.includes("--compact") ? {
      release: report.release,
      mode: report.mode,
      architecture: report.architecture,
      split: report.split,
      selected: report.selected,
      selectionBaseline: report.selectionBaseline,
      confirmation: report.confirmation,
      microHoldout: report.microHoldout,
    } : report, null, 2));
    return;
  }
  if (process.argv.includes("--constrained-total-model")) {
    console.log(JSON.stringify(runConstrainedPosteriorResidualTournament(games), null, 2));
    return;
  }
  if (process.argv.includes("--constrained-total-residual")) {
    console.log(JSON.stringify(runConstrainedContinuousResidualTournament(games), null, 2));
    return;
  }
  if (process.argv.includes("--combined-market-reader")) {
    const report = runCombinedMarketReaderTournament(games);
    console.log(JSON.stringify(process.argv.includes("--compact") ? {
      release: report.release,
      mode: report.mode,
      architecture: report.architecture,
      fixedDevelopmentSelectedConfiguration: report.fixedDevelopmentSelectedConfiguration,
      rollingOrigin: Object.fromEntries(Object.entries(report.rollingOrigin).map(([block, value]) => [block, {
        trainingGames: value.trainingGames,
        testingGames: value.testingGames,
        active: value.active,
        variants: value.variants,
      }])),
    } : report, null, 2));
    return;
  }
  if (process.argv.includes("--combined-market-reader-independent-base")) {
    const independentBaseGames = games.map((game) => ({ ...game, authoritative: game.independent }));
    const report = runCombinedMarketReaderTournament(independentBaseGames);
    console.log(JSON.stringify(process.argv.includes("--compact") ? {
      release: `${report.release}_independent_base_counterfactual`,
      mode: report.mode,
      architecture: report.architecture,
      fixedDevelopmentSelectedConfiguration: report.fixedDevelopmentSelectedConfiguration,
      rollingOrigin: Object.fromEntries(Object.entries(report.rollingOrigin).map(([block, value]) => [block, {
        trainingGames: value.trainingGames,
        testingGames: value.testingGames,
        active: value.active,
        variants: value.variants,
      }])),
    } : report, null, 2));
    return;
  }
  if (process.argv.includes("--combined-market-reader-stability")) {
    const report = runCombinedMarketReaderStability(games);
    console.log(JSON.stringify(process.argv.includes("--compact") ? {
      release: report.release,
      mode: report.mode,
      method: report.method,
      fixedConfiguration: report.fixedConfiguration,
      eligibleDates: report.eligibleDates,
      evaluatedDates: report.evaluatedDates,
      evaluatedGames: report.evaluatedGames,
      aggregate: report.aggregate,
      professionalAudit: report.professionalAudit,
      byDate: Object.fromEntries(report.folds.map((fold) => [fold.date, {
        trainingGames: fold.trainingGames,
        testingGames: fold.testingGames,
        active: fold.active,
        candidate: fold.candidate,
        interventions: fold.interventions,
      }])),
    } : report, null, 2));
    return;
  }
  if (process.argv.includes("--professional-configuration-audit")) {
    const report = runProfessionalConfigurationAudit(
      games,
      process.argv.includes("--independent-base") ? "independent" : "active",
    );
    if (process.argv.includes("--moneyline-feature-audit")) {
      const summarizeBlock = (block: (typeof report.margin)[number]["blocks"][keyof (typeof report.margin)[number]["blocks"]]) => ({
        games: block.games,
        active: {
          marginMae: block.active.marginMae,
          moneyline: block.active.moneyline,
          spread: block.active.spread,
        },
        candidate: {
          marginMae: block.candidate.marginMae,
          moneyline: block.candidate.moneyline,
          spread: block.candidate.spread,
        },
        interventions: {
          moneyline: block.byMarket.moneyline,
          spread: block.byMarket.spread,
        },
        upset: block.upset,
      });
      const summarizeEntry = (entry: (typeof report.margin)[number]) => ({
        id: entry.id,
        config: entry.config,
        blocks: Object.fromEntries(Object.entries(entry.blocks).map(([name, block]) => [name, summarizeBlock(block)])),
      });
      const objective = (entry: (typeof report.margin)[number]) => {
        const metrics = entry.blocks.development.candidate;
        return metrics.marginMae +
          4 * (1 - (metrics.moneyline.accuracy ?? 0)) +
          4 * (1 - (metrics.spread.accuracy ?? 0));
      };
      const modes = [...new Set(report.margin.map((entry) => entry.config.marginFeatureMode))];
      const selectedByDevelopment = modes.map((mode) => {
        const selected = report.margin
          .filter((entry) => entry.config.marginFeatureMode === mode)
          .sort((a, b) => objective(a) - objective(b) || a.blocks.development.candidate.marginMae - b.blocks.development.candidate.marginMae)[0]!;
        return {
          mode,
          selectedOn: "development_only",
          objective: objective(selected),
          ...summarizeEntry(selected),
        };
      });
      const fixedScaleOne = report.margin.filter((entry) =>
        entry.config.marginLambda === 1000 && entry.config.marginEvidenceScale === 1);
      console.log(JSON.stringify({
        release: report.release,
        protocol: report.protocol,
        purpose: "audit_joint_moneyline_spread_features_without_using_confirmation_or_micro_holdout_for_selection",
        selectedByDevelopment,
        fixedScaleOne: fixedScaleOne.map(summarizeEntry),
      }, null, 2));
      return;
    }
    const compactPolicy = (policy: typeof report.corroboratedWinnerPolicy) => ({
      id: policy.id,
      blocks: policy.blocks,
      byMarket: policy.professionalAudit.byMarket,
      upset: {
        all: policy.professionalAudit.upsetEvaluation.all,
        shortSpread: policy.professionalAudit.upsetEvaluation.shortSpread,
        changedWinnerCalls: policy.professionalAudit.upsetEvaluation.changedWinnerCalls,
      },
    });
    if (process.argv.includes("--joint-final-candidate")) {
      console.log(JSON.stringify({
        release: report.release,
        selection: "fixed_lambda_1000_scale_1_from_predeclared_reader_authority_not_retuned_on_confirmation",
        baseline: compactPolicy(report.corroboratedWinnerPolicy),
        jointMoneylineSpread: {
          ...compactPolicy(report.jointCorroboratedWinnerPolicy),
          bootstrap: report.jointCorroboratedWinnerPolicy.bootstrap,
        },
      }, null, 2));
      return;
    }
    if (process.argv.includes("--corroborated-only")) {
      console.log(JSON.stringify(compactPolicy(report.corroboratedWinnerPolicy), null, 2));
      return;
    }
    if (process.argv.includes("--total-flips-only")) {
      const interventions = report.selectedCombined.professionalAudit.interventionLedger
        .filter((row) => row.market === "total");
      const buckets = [
        { id: "active_distance_0_to_3", minimum: 0, maximum: 3 },
        { id: "active_distance_3_to_7", minimum: 3, maximum: 7 },
        { id: "active_distance_7_plus", minimum: 7, maximum: Number.POSITIVE_INFINITY },
      ].map((bucket) => {
        const rows = interventions.filter((row) => {
          const distance = Math.abs(row.active - (row.line ?? row.active));
          return distance >= bucket.minimum && distance < bucket.maximum;
        });
        return {
          id: bucket.id,
          flips: rows.length,
          corrections: rows.filter((row) => row.classification === "correction").length,
          harms: rows.filter((row) => row.classification === "harm").length,
          meanAbsoluteShift: average(rows.map((row) => Math.abs(row.shift))),
          maximumAbsoluteShift: Math.max(0, ...rows.map((row) => Math.abs(row.shift))),
        };
      });
      console.log(JSON.stringify({
        release: report.release,
        policy: "selected_reconciliation_and_total",
        total: report.selectedCombined.professionalAudit.byMarket.total,
        buckets,
        interventions,
      }, null, 2));
      return;
    }
    console.log(JSON.stringify(process.argv.includes("--compact") ? {
      release: report.release,
      mode: report.mode,
      protocol: report.protocol,
      selectedCombined: {
        blocks: report.selectedCombined.blocks,
        byMarket: report.selectedCombined.professionalAudit.byMarket,
        upset: {
          all: report.selectedCombined.professionalAudit.upsetEvaluation.all,
          shortSpread: report.selectedCombined.professionalAudit.upsetEvaluation.shortSpread,
          changedWinnerCalls: report.selectedCombined.professionalAudit.upsetEvaluation.changedWinnerCalls,
        },
      },
      corroboratedWinnerPolicy: compactPolicy(report.corroboratedWinnerPolicy),
    } : report, null, 2));
    return;
  }
  if (process.argv.includes("--total-projection-mode-audit")) {
    const report = runTotalProjectionModeAudit(games);
    const compact = (result: typeof report.reflection) => ({
      mode: result.mode,
      blocks: result.blocks,
      byMarket: result.professionalAudit.byMarket,
      bootstrap: result.bootstrap,
    });
    console.log(JSON.stringify({
      release: report.release,
      method: report.method,
      reflection: compact(report.reflection),
      posteriorProjection: compact(report.posteriorProjection),
    }, null, 2));
    return;
  }
  if (process.argv.includes("--professional-loss-audit")) {
    console.log(JSON.stringify(runProfessionalLossAudit(games), null, 2));
    return;
  }
  if (process.argv.includes("--export-market-reader-artifact")) {
    const artifact = exportCombinedMarketReaderArtifact(games);
    if (process.argv.includes("--write-market-reader-artifact")) {
      writeFileSync(
        "lib/services/football/modelArtifacts/cfbCompleteMarketReaderArtifact.json",
        `${JSON.stringify(artifact, null, 2)}\n`,
        "utf8",
      );
      console.log(JSON.stringify({
        release: artifact.release,
        trainedThrough: artifact.trainedThrough,
        games: artifact.games,
        wrote: "lib/services/football/modelArtifacts/cfbCompleteMarketReaderArtifact.json",
      }, null, 2));
      return;
    }
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }
  if (process.argv.includes("--joint-model")) {
    console.log(JSON.stringify(runJointTournament(games), null, 2));
    return;
  }
  const signals: Signal[] = [];
  for (const game of games) for (const market of MARKETS) {
    const line = targetLine(game, market); if (market !== "moneyline" && line === null) continue;
    const moves = marketMoves(game.histories, market); const splitRows = splitReads(game.histories, market); const tickets = publicTicketSide(latestPublic(game.histories, market), market);
    for (const move of moves) {
      const prefix = move.sourceClass === "named" ? `named_${move.channel}` : `retail_${move.channel}`;
      const signal = (candidate: string, side = move.side) => signals.push({ candidate, game, market, source: move.source, side, line });
      signal(prefix);
      signal(`${prefix}_${move.source}`);
      if (!move.reversed) signal(`${prefix}_held`);
      if (move.keyCross) signal(`${prefix}_key_cross`);
      if (move.reversed) signal(`${prefix}_buyback_final`);
      if (move.priceBeforeLine) signal(`${prefix}_price_before_line`);
      const minutesToKickoff = (Date.parse(game.kickoffAt) - Date.parse(move.firstAt)) / 60_000;
      if (minutesToKickoff >= 0 && minutesToKickoff <= 360) signal(`${prefix}_late_6h`);
      if (minutesToKickoff >= 0 && minutesToKickoff <= 120) signal(`${prefix}_late_2h`);
      if (move.channel === "line" && move.magnitude >= 1) signal(`${prefix}_magnitude_1`);
      if (move.channel === "line" && move.magnitude >= 1.5) signal(`${prefix}_magnitude_1_5`);
      if (move.channel === "line" && move.magnitude >= 2) signal(`${prefix}_magnitude_2`);
      if (move.channel === "price" && move.magnitude >= 2.5) signal(`${prefix}_magnitude_2_5pp`);
      if (move.channel === "price" && move.magnitude >= 5) signal(`${prefix}_magnitude_5pp`);
      const independentSide = sideAt(game.independent, market, line);
      const gap = modelGap(game, market, line);
      if (move.side !== independentSide) {
        signal(`${prefix}_model_conflict`);
        const weakThreshold = market === "moneyline" ? 6 : 3;
        if (gap <= weakThreshold) signal(`${prefix}_model_conflict_weak`);
        else signal(`${prefix}_model_conflict_strong`);
      } else signal(`${prefix}_model_confirms`);
      if (tickets && tickets !== move.side) signal(`${prefix}_rlm`);
      for (const split of splitRows) {
        const { chronology, freshness } = splitChronology(split, move);
        if (split.side === move.side) {
          signal(`${prefix}_${split.provenance}_agrees_${chronology}_${freshness}`);
          signal(`${prefix}_${move.source}_${split.provenance}_agrees_${chronology}_${freshness}`);
          if ((split.moneyAccelerationPp ?? 0) >= MONEY_ACCELERATION_PP) signal(`${prefix}_${split.provenance}_money_accelerates`);
        } else {
          signal(`${prefix}_${split.provenance}_resists_${chronology}_${freshness}`, split.side);
        }
      }
    }
    const named = moves.filter((move) => move.sourceClass === "named"); const retail = moves.filter((move) => move.sourceClass === "retail");
    for (const side of ["first", "second"] as const) {
      const namedSame = named.filter((move) => move.side === side); const retailSame = retail.filter((move) => move.side === side);
      const namedOrdered = [...namedSame].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
      const retailOrdered = [...retailSame].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
      const consensusSignal = (candidate: string, sources: Move[]) => {
        const source = sources.map((move) => move.source).sort().join("+");
        signals.push({ candidate, game, market, source, side, line });
        const held = sources.every((move) => !move.reversed);
        const confirmationAt = Math.max(...sources.map((move) => Date.parse(move.firstAt)));
        const confirmationMinutesToKickoff = (Date.parse(game.kickoffAt) - confirmationAt) / 60_000;
        const independentSide = sideAt(game.independent, market, line);
        if (side !== independentSide) {
          const gap = modelGap(game, market, line);
          const weakThreshold = market === "moneyline" ? 6 : 3;
          const conflictStrength = gap <= weakThreshold ? "weak" : "strong";
          signals.push({ candidate: `${candidate}_model_conflict`, game, market, source, side, line });
          signals.push({ candidate: `${candidate}_model_conflict_${conflictStrength}`, game, market, source, side, line });
          if (held) signals.push({ candidate: `${candidate}_held_model_conflict_${conflictStrength}`, game, market, source, side, line });
          if (confirmationMinutesToKickoff >= 0 && confirmationMinutesToKickoff <= 360) signals.push({ candidate: `${candidate}_confirmed_late_6h_model_conflict_${conflictStrength}`, game, market, source, side, line });
          if (confirmationMinutesToKickoff >= 0 && confirmationMinutesToKickoff <= 120) signals.push({ candidate: `${candidate}_confirmed_late_2h_model_conflict_${conflictStrength}`, game, market, source, side, line });
          const consensusMove: Move = {
            source,
            sourceClass: sources.some((move) => move.sourceClass === "named") ? "named" : "retail",
            side,
            channel: sources.every((move) => move.channel === "line") ? "line" : "price",
            magnitude: Math.min(...sources.map((move) => move.magnitude)),
            firstAt: new Date(confirmationAt).toISOString(),
            lastAt: new Date(Math.max(...sources.map((move) => Date.parse(move.lastAt)))).toISOString(),
            line,
            keyCross: sources.some((move) => move.keyCross),
            reversed: !held,
            priceBeforeLine: sources.some((move) => move.priceBeforeLine),
          };
          for (const split of splitRows) {
            const { chronology, freshness } = splitChronology(split, consensusMove);
            if (split.side !== side) continue;
            signals.push({ candidate: `${candidate}_${split.provenance}_agrees_${chronology}_${freshness}_model_conflict_${conflictStrength}`, game, market, source, side, line });
            if (held) signals.push({ candidate: `${candidate}_held_${split.provenance}_agrees_${chronology}_${freshness}_model_conflict_${conflictStrength}`, game, market, source, side, line });
            if ((split.moneyAccelerationPp ?? 0) >= MONEY_ACCELERATION_PP) signals.push({ candidate: `${candidate}_${split.provenance}_money_accelerates_model_conflict_${conflictStrength}`, game, market, source, side, line });
          }
          if (tickets && tickets !== side) signals.push({ candidate: `${candidate}_rlm_model_conflict_${conflictStrength}`, game, market, source, side, line });
        } else signals.push({ candidate: `${candidate}_model_confirms`, game, market, source, side, line });
        if (held) signals.push({ candidate: `${candidate}_held`, game, market, source, side, line });
      };
      if (namedOrdered.length >= 2) consensusSignal("two_named_books_agree", namedOrdered);
      if (namedOrdered.length >= 2 && Date.parse(namedOrdered[0]!.firstAt) < Date.parse(namedOrdered[1]!.firstAt)) consensusSignal("named_leads_named_confirmation", namedOrdered);
      if (retailOrdered.length >= 2) consensusSignal("two_retail_books_agree", retailOrdered);
      const retailLineOrdered = retailOrdered.filter((move) => move.channel === "line");
      if (retailLineOrdered.length >= 2) consensusSignal("two_retail_line_books_agree", retailLineOrdered);
      const namedLineOrdered = namedOrdered.filter((move) => move.channel === "line");
      if (namedLineOrdered.length && retailLineOrdered.length >= 2) consensusSignal("named_and_two_retail_line_books_agree", [...namedLineOrdered, ...retailLineOrdered]);
      if (namedOrdered.length && retailOrdered.length >= 2 && Date.parse(namedOrdered[0]!.firstAt) <= Date.parse(retailOrdered[0]!.firstAt)) consensusSignal("named_leads_two_retail", [...namedOrdered, ...retailOrdered]);
    }
  }
  const dedupedSignals = dedupeSignals(signals);
  const evaluations = dedupedSignals.map(evaluate);
  const summary = summarize(evaluations);
  const requestedContains = process.argv.find((value) => value.startsWith("--contains="))?.slice(11) ?? null;
  if (requestedContains !== null) {
    console.log(JSON.stringify({
      release: "cfb_2026_sharp_sequence_tournament_2026_10_08_r1",
      mode: "select_only_zero_writes_zero_provider_calls",
      matches: Object.fromEntries(Object.entries(summary).filter(([key]) => key.includes(requestedContains))),
    }, null, 2));
    return;
  }
  const requestedCorrections = process.argv.find((value) => value.startsWith("--corrections="))?.slice(14) ?? null;
  const requestedHarms = process.argv.find((value) => value.startsWith("--harms="))?.slice(8) ?? null;
  if (requestedCorrections !== null || requestedHarms !== null) {
    const corrections = requestedCorrections === null ? null : Number(requestedCorrections);
    const harms = requestedHarms === null ? null : Number(requestedHarms);
    console.log(JSON.stringify({
      release: "cfb_2026_sharp_sequence_tournament_2026_10_08_r1",
      mode: "select_only_zero_writes_zero_provider_calls",
      matches: Object.fromEntries(Object.entries(summary).filter(([, value]) => {
        const partitions = [value.overall, ...Object.values(value.byBlock)];
        return partitions.some((partition) =>
          (corrections === null || partition.corrections === corrections) &&
          (harms === null || partition.harms === harms));
      })),
    }, null, 2));
    return;
  }
  const requestedCandidate = process.argv.find((value) => value.startsWith("--candidate="))?.slice(12) ?? null;
  if (requestedCandidate) {
    const selected = evaluations.filter((row) => `${row.market}:${row.candidate}` === requestedCandidate);
    const overall = metrics(selected);
    console.log(JSON.stringify({
      release: "cfb_2026_sharp_sequence_tournament_2026_10_08_r1",
      mode: "select_only_zero_writes_zero_provider_calls",
      candidate: requestedCandidate,
      overall,
      oneSidedCorrectionPValue: oneSidedCorrectionPValue(overall.corrections, overall.harms),
      byDate: Object.fromEntries(overall.dates.map((date) => [date, metrics(selected.filter((row) => row.date === date))])),
      sources: Object.fromEntries([...new Set(selected.map((row) => row.source))].sort().map((source) => {
        const sourceRows = selected.filter((row) => row.source === source);
        return [source, {
          overall: metrics(sourceRows),
          byBlock: Object.fromEntries((["development", "confirmation", "holdout"] as const).map((block) =>
            [block, metrics(sourceRows.filter((row) => row.block === block))])),
        }];
      })),
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({ release: "cfb_2026_sharp_sequence_tournament_2026_10_08_r1", mode: "select_only_zero_writes_zero_provider_calls", settledGames: games.length, historyRows: history.length, rawSignalRows: signals.length, signalRows: dedupedSignals.length, candidatesPassingFixedGates: Object.entries(summary).filter(([, value]) => value.passes).map(([key]) => key), summary }, null, 2));
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
