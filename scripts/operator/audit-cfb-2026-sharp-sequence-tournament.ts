#!/usr/bin/env tsx

/** SELECT-only CFB market-sequence tournament. No provider calls or writes. */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  readCfbForwardMarketHistory,
  readCfbForwardWriterEvidence,
} from "../../lib/services/football/cfbForwardEvidenceStore";
import type { CfbForwardContextFamily } from "../../lib/services/football/cfbForwardEvidenceCapture";
import type {
  CfbForwardMarketHistoryEvidence,
  CfbForwardPlaybookSplit,
} from "../../lib/services/football/cfbForwardEvidence";
import type { CfbSharpApiSplitRecord } from "../../lib/services/football/cfbSharpApiSplits";

loadEnvConfig(process.cwd());

type Market = "moneyline" | "spread" | "total";
type Side = "first" | "second";
type Result = "win" | "loss" | "push";
type Block = "development" | "confirmation" | "holdout";
type FinalGame = { external_id: string | number; status: string | null; away_score: number | null; home_score: number | null };
type Forecast = { expectedMarginHome: number; expectedTotal: number };
type Move = { source: string; sourceClass: "named" | "retail"; side: Side; channel: "line" | "price"; magnitude: number; firstAt: string; lastAt: string; line: number | null; keyCross: boolean; reversed: boolean; priceBeforeLine: boolean };
type SplitRead = { provenance: "named_sharp" | "fallback" | "public"; side: Side; gapPp: number; firstAt: string; lastAt: string; moneyAccelerationPp: number | null };
type Game = { gameId: string; date: string; kickoffAt: string; independent: Forecast; authoritative: Forecast; targetLines: Record<Market, number | null>; awayScore: number; homeScore: number; histories: CfbForwardMarketHistoryEvidence[] };
type Signal = { candidate: string; game: Game; market: Market; source: string; side: Side; line: number | null };
type Evaluation = { candidate: string; market: Market; gameId: string; date: string; block: Block; source: string; result: Result; authoritativeResult: Result; disagrees: boolean; correction: boolean; harm: boolean; authoritativeAxisError: number; reflectedAxisError: number };

const MARKETS: Market[] = ["moneyline", "spread", "total"];
const NAMED = new Set(["circa", "pinnacle", "bookmaker"]);
const SHARP_CURRENT_MINUTES = 120;
const MONEY_ACCELERATION_PP = 5;

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
function families(history: CfbForwardMarketHistoryEvidence, market: Market): CfbForwardContextFamily[] { return history.payload.contextualEvidenceCapture?.markets[market].families ?? []; }

async function readResults(client: SupabaseClient, ids: string[]): Promise<Map<string, FinalGame>> {
  const output = new Map<string, FinalGame>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await client.from("games").select("external_id,status,away_score,home_score").eq("sport", "cfb").in("external_id", ids.slice(index, index + 150));
    if (error) throw new Error(`CFB result read failed: ${error.message}`);
    for (const row of (data ?? []) as FinalGame[]) output.set(String(row.external_id), row);
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
function playbookSide(split: CfbForwardPlaybookSplit, market: Market): { side: Side; gap: number; money: number } | null {
  if (market === "total") {
    if ([split.overMoneyPct, split.overBetsPct, split.underMoneyPct, split.underBetsPct].some((value) => value === null)) return null;
    const first = split.overMoneyPct! - split.overBetsPct!; const second = split.underMoneyPct! - split.underBetsPct!;
    return Math.max(Math.abs(first), Math.abs(second)) >= 8 ? { side: first >= second ? "first" : "second", gap: first >= second ? first : second, money: first >= second ? split.overMoneyPct! : split.underMoneyPct! } : null;
  }
  if ([split.awayMoneyPct, split.awayBetsPct, split.homeMoneyPct, split.homeBetsPct].some((value) => value === null)) return null;
  const first = split.awayMoneyPct! - split.awayBetsPct!; const second = split.homeMoneyPct! - split.homeBetsPct!;
  return Math.max(Math.abs(first), Math.abs(second)) >= 8 ? { side: first >= second ? "first" : "second", gap: first >= second ? first : second, money: first >= second ? split.awayMoneyPct! : split.homeMoneyPct! } : null;
}
function sharpSide(record: CfbSharpApiSplitRecord, market: Market): { side: Side; gap: number; money: number } | null {
  if (market === "total" && record.total) { const first = splitGap(record.total.over); const second = splitGap(record.total.under); return Math.max(Math.abs(first), Math.abs(second)) >= 10 ? { side: first >= second ? "first" : "second", gap: first >= second ? first : second, money: first >= second ? record.total.over.moneyPct : record.total.under.moneyPct } : null; }
  const value = market === "moneyline" ? record.moneyline : record.spread;
  if (!value) return null; const first = splitGap(value.away); const second = splitGap(value.home);
  return Math.max(Math.abs(first), Math.abs(second)) >= 10 ? { side: first >= second ? "first" : "second", gap: first >= second ? first : second, money: first >= second ? value.away.moneyPct : value.home.moneyPct } : null;
}

function splitReads(histories: CfbForwardMarketHistoryEvidence[], market: Market): SplitRead[] {
  const buckets = new Map<string, Array<{ at: string; side: Side; gap: number; money: number; provenance: SplitRead["provenance"] }>>();
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
    return [{ provenance: last.provenance, side: last.side, gapPp: last.gap, firstAt: first.at, lastAt: last.at, moneyAccelerationPp: last.side === firstComparable.side ? last.money - firstComparable.money : null }];
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

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const writer = await readCfbForwardWriterEvidence({ client, season: 2026 }); const results = await readResults(client, [...new Set(writer.evidence.map((row) => row.providerGameId))]);
  const latest = new Map<string, typeof writer.evidence[number]>();
  for (const row of writer.evidence) { if (Date.parse(row.capturedAt) >= Date.parse(row.gameStartAt)) continue; const prior = latest.get(row.providerGameId); if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) latest.set(row.providerGameId, row); }
  const settledIds = [...latest.values()].filter((row) => isFinal(results.get(row.providerGameId))).map((row) => row.providerGameId);
  const history = await readCfbForwardMarketHistory({ client, season: 2026, providerGameIds: settledIds }); const byGame = new Map<string, CfbForwardMarketHistoryEvidence[]>();
  for (const row of history) if (Date.parse(row.capturedAt) < Date.parse(row.gameStartAt)) byGame.set(row.providerGameId, [...(byGame.get(row.providerGameId) ?? []), row]);
  const games: Game[] = [];
  for (const row of latest.values()) { const result = results.get(row.providerGameId); const histories = byGame.get(row.providerGameId) ?? []; if (!isFinal(result) || !histories.length) continue; const independent = row.payload.independentForecast ?? row.payload.decisions.forecast; const authoritative = row.payload.decisions.forecast; const spreadDecision = row.payload.decisions.evaluatedBets.find((decision) => decision.market === "spread") ?? null; const totalDecision = row.payload.decisions.evaluatedBets.find((decision) => decision.market === "total") ?? null; const selectedSpreadLine = spreadDecision?.evaluatedQuote.line ?? null; const homeSpreadLine = selectedSpreadLine === null || !spreadDecision ? null : isHomeDecisionSide(spreadDecision.side, row.payload.game.home.abbreviation) ? selectedSpreadLine : -selectedSpreadLine; games.push({ gameId: row.providerGameId, date: row.gameStartAt.slice(0, 10), kickoffAt: row.gameStartAt, independent: { expectedMarginHome: independent.expectedMarginHome, expectedTotal: independent.expectedTotal }, authoritative: { expectedMarginHome: authoritative.expectedMarginHome, expectedTotal: authoritative.expectedTotal }, targetLines: { moneyline: null, spread: homeSpreadLine, total: totalDecision?.evaluatedQuote.line ?? null }, awayScore: result.away_score!, homeScore: result.home_score!, histories: histories.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)) }); }
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
