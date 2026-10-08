#!/usr/bin/env tsx

/**
 * Reconstruct schedule-fixed 2026 CFB Total market paths from The Odds API.
 * Default mode plans/reads cache only. Pass --fetch to spend bounded credits.
 * This script never writes production data.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";

loadEnvConfig(process.cwd());

type JsonRecord = Record<string, unknown>;
type Direction = "over" | "under";
type Block = "development" | "confirmation" | "holdout";
type Result = "win" | "loss" | "push";
type FinalGame = {
  external_id: string | number;
  status: string | null;
  away_score: number | null;
  home_score: number | null;
};
type TotalQuote = {
  sportsbook: string;
  observedAt: string;
  snapshotAt: string;
  line: number;
  overPrice: number;
  underPrice: number;
};
type HistoricalEvent = {
  id: string;
  commenceTime: string;
  awayTeam: string;
  homeTeam: string;
  totals: TotalQuote[];
};
type CachedSnapshot = {
  requestedAt: string;
  providerTimestamp: string;
  sportKey: string;
  events: HistoricalEvent[];
};
type AuditGame = {
  gameId: string;
  kickoffAt: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
  authoritativeTotal: number;
  actualTotal: number;
  openingTarget: string;
  pregameTarget: string;
};
type Signal = {
  candidate: string;
  game: AuditGame;
  source: string;
  line: number;
  side: Direction;
};
type Evaluation = {
  candidate: string;
  gameId: string;
  date: string;
  block: Block;
  source: string;
  result: Result;
  authoritativeResult: Result;
  disagrees: boolean;
  correction: boolean;
  harm: boolean;
  authoritativeMae: number;
  reflectedMae: number;
};

const SPORT_KEY = "americanfootball_ncaaf";
const BOOKMAKERS = ["pinnacle", "draftkings", "fanduel", "betmgm", "betrivers", "betonlineag"] as const;
const RETAIL_BOOKS = BOOKMAKERS.filter((book) => book !== "pinnacle");
const COST_PER_SNAPSHOT = 10;
const MAX_TOTAL_CREDITS = 800;
const CREDIT_RESERVE = 18_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const CACHE_DIR = path.resolve("football-research/cache/cfb-total-market-2026-r1");

function record(value: unknown): JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function american(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}
function iso(value: unknown): string | null {
  const parsed = Date.parse(text(value) ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}
function floorFourHours(timestamp: number): string {
  const interval = 4 * 60 * 60_000;
  return new Date(Math.floor(timestamp / interval) * interval).toISOString();
}
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function fairOver(quote: TotalQuote): number {
  const over = implied(quote.overPrice);
  const under = implied(quote.underPrice);
  return over / (over + under);
}
function sideAt(total: number, line: number): Direction { return total > line ? "over" : "under"; }
function settle(side: Direction, actual: number, line: number): Result {
  if (Math.abs(actual - line) < 1e-9) return "push";
  return (actual > line ? "over" : "under") === side ? "win" : "loss";
}
function blockFor(date: string): Block {
  if (date <= "2026-09-27") return "development";
  if (date <= "2026-10-04") return "confirmation";
  return "holdout";
}
function cachePath(target: string): string {
  return path.join(CACHE_DIR, `${SPORT_KEY}-${target.replace(/[^0-9]/g, "")}.json`);
}

async function readResults(client: SupabaseClient, ids: string[]): Promise<Map<string, FinalGame>> {
  const output = new Map<string, FinalGame>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await client.from("games")
      .select("external_id,status,away_score,home_score")
      .eq("sport", "cfb")
      .in("external_id", ids.slice(index, index + 150));
    if (error) throw new Error(`CFB result read failed: ${error.message}`);
    for (const row of (data ?? []) as FinalGame[]) output.set(String(row.external_id), row);
  }
  return output;
}

function isFinal(row: FinalGame | undefined): row is FinalGame {
  return Boolean(row && ["final", "completed", "post"].includes(row.status?.trim().toLowerCase() ?? "") &&
    Number.isFinite(row.away_score) && Number.isFinite(row.home_score));
}

function normalizeSnapshot(raw: string, requestedAt: string): CachedSnapshot {
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new Error(`Historical snapshot ${requestedAt} exceeds byte ceiling.`);
  const wrapper = record(JSON.parse(raw));
  const providerTimestamp = iso(wrapper.timestamp) ?? requestedAt;
  const events = array(wrapper.data).map(record).flatMap((event): HistoricalEvent[] => {
    const id = text(event.id);
    const commenceTime = iso(event.commence_time);
    const awayTeam = text(event.away_team);
    const homeTeam = text(event.home_team);
    if (!id || !commenceTime || !awayTeam || !homeTeam) return [];
    const totals = array(event.bookmakers).map(record).flatMap((book): TotalQuote[] => {
      const sportsbook = text(book.key)?.toLowerCase() ?? "";
      if (!BOOKMAKERS.includes(sportsbook as typeof BOOKMAKERS[number])) return [];
      const markets = array(book.markets).map(record).filter((market) => text(market.key) === "totals");
      if (markets.length !== 1) return [];
      const outcomes = array(markets[0]!.outcomes).map(record);
      const overRows = outcomes.filter((outcome) => text(outcome.name)?.toLowerCase() === "over");
      const underRows = outcomes.filter((outcome) => text(outcome.name)?.toLowerCase() === "under");
      if (overRows.length !== 1 || underRows.length !== 1) return [];
      const overLine = finite(overRows[0]!.point);
      const underLine = finite(underRows[0]!.point);
      const overPrice = american(overRows[0]!.price);
      const underPrice = american(underRows[0]!.price);
      const observedAt = iso(markets[0]!.last_update) ?? iso(book.last_update);
      if (overLine === null || underLine === null || Math.abs(overLine - underLine) > 0.001 || overPrice === null || underPrice === null || !observedAt) return [];
      return [{ sportsbook, observedAt, snapshotAt: providerTimestamp, line: overLine, overPrice, underPrice }];
    });
    return [{ id, commenceTime, awayTeam, homeTeam, totals }];
  });
  return { requestedAt, providerTimestamp, sportKey: SPORT_KEY, events };
}

async function fetchSnapshot(target: string, apiKey: string): Promise<{ snapshot: CachedSnapshot; cost: number; remaining: number }> {
  const url = new URL(`https://api.the-odds-api.com/v4/historical/sports/${SPORT_KEY}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("bookmakers", BOOKMAKERS.join(","));
  url.searchParams.set("markets", "totals");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");
  url.searchParams.set("date", target.replace(".000Z", "Z"));
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Historical Total snapshot ${target} failed (${response.status}): ${raw.slice(0, 240)}`);
  const cost = Number(response.headers.get("x-requests-last"));
  const remaining = Number(response.headers.get("x-requests-remaining"));
  if (cost !== COST_PER_SNAPSHOT) throw new Error(`Historical Total cost changed: expected ${COST_PER_SNAPSHOT}, received ${cost}.`);
  if (!Number.isInteger(remaining) || remaining < CREDIT_RESERVE) throw new Error(`Historical Total reserve reached: ${remaining}.`);
  return { snapshot: normalizeSnapshot(raw, target), cost, remaining };
}

function matchEvent(game: AuditGame, snapshot: CachedSnapshot): HistoricalEvent | null {
  const matches = snapshot.events.filter((event) =>
    Math.abs(Date.parse(event.commenceTime) - Date.parse(game.kickoffAt)) <= 3 * 60 * 60_000 &&
    normalize(event.awayTeam) === normalize(game.awayTeam) &&
    normalize(event.homeTeam) === normalize(game.homeTeam));
  return matches.length === 1 ? matches[0]! : null;
}

function dedupePath(quotes: TotalQuote[]): TotalQuote[] {
  const unique = new Map<string, TotalQuote>();
  for (const quote of quotes.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))) {
    unique.set(`${quote.sportsbook}:${quote.observedAt}:${quote.line}:${quote.overPrice}:${quote.underPrice}`, quote);
  }
  return [...unique.values()].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
}

function baseMove(pathRows: TotalQuote[]): { side: Direction; channel: "line" | "price"; line: number } | null {
  const opening = pathRows[0];
  const current = pathRows.at(-1);
  if (!opening || !current || opening.observedAt >= current.observedAt) return null;
  const lineDelta = current.line - opening.line;
  if (Math.abs(lineDelta) >= 0.5) return { side: lineDelta > 0 ? "over" : "under", channel: "line", line: current.line };
  if (Math.abs(lineDelta) > 1e-9) return null;
  const priceDelta = (fairOver(current) - fairOver(opening)) * 100;
  if (Math.abs(priceDelta) < 1) return null;
  return { side: priceDelta > 0 ? "over" : "under", channel: "price", line: current.line };
}

function evaluate(signal: Signal): Evaluation {
  const authoritativeSide = sideAt(signal.game.authoritativeTotal, signal.line);
  const result = settle(signal.side, signal.game.actualTotal, signal.line);
  const authoritativeResult = settle(authoritativeSide, signal.game.actualTotal, signal.line);
  const disagrees = signal.side !== authoritativeSide;
  return {
    candidate: signal.candidate,
    gameId: signal.game.gameId,
    date: signal.game.date,
    block: blockFor(signal.game.date),
    source: signal.source,
    result,
    authoritativeResult,
    disagrees,
    correction: disagrees && result === "win" && authoritativeResult === "loss",
    harm: disagrees && result === "loss" && authoritativeResult === "win",
    authoritativeMae: Math.abs(signal.game.authoritativeTotal - signal.game.actualTotal),
    reflectedMae: Math.abs((2 * signal.line - signal.game.authoritativeTotal) - signal.game.actualTotal),
  };
}

function metrics(rows: Evaluation[]) {
  const resolved = rows.filter((row) => row.result !== "push");
  const baseResolved = rows.filter((row) => row.authoritativeResult !== "push");
  const disagreements = rows.filter((row) => row.disagrees);
  return {
    games: new Set(rows.map((row) => row.gameId)).size,
    dates: [...new Set(rows.map((row) => row.date))].sort(),
    wins: resolved.filter((row) => row.result === "win").length,
    losses: resolved.filter((row) => row.result === "loss").length,
    pushes: rows.length - resolved.length,
    accuracy: resolved.length ? resolved.filter((row) => row.result === "win").length / resolved.length : null,
    authoritativeWins: baseResolved.filter((row) => row.authoritativeResult === "win").length,
    authoritativeLosses: baseResolved.filter((row) => row.authoritativeResult === "loss").length,
    authoritativeAccuracy: baseResolved.length ? baseResolved.filter((row) => row.authoritativeResult === "win").length / baseResolved.length : null,
    disagreements: disagreements.length,
    corrections: disagreements.filter((row) => row.correction).length,
    harms: disagreements.filter((row) => row.harm).length,
    authoritativeMaeOnDisagreements: disagreements.length ? disagreements.reduce((sum, row) => sum + row.authoritativeMae, 0) / disagreements.length : null,
    reflectedMaeOnDisagreements: disagreements.length ? disagreements.reduce((sum, row) => sum + row.reflectedMae, 0) / disagreements.length : null,
  };
}

function summarize(rows: Evaluation[]) {
  return Object.fromEntries([...new Set(rows.map((row) => row.candidate))].sort().map((candidate) => {
    const selected = rows.filter((row) => row.candidate === candidate);
    return [candidate, {
      overall: metrics(selected),
      byBlock: Object.fromEntries((["development", "confirmation", "holdout"] as const).map((block) => [block, metrics(selected.filter((row) => row.block === block))])),
    }];
  }));
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const fetchMode = process.argv.includes("--fetch");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const evidence = (await readCfbForwardWriterEvidence({ client, season: 2026 })).evidence;
  const results = await readResults(client, [...new Set(evidence.map((row) => row.providerGameId))]);
  const latest = new Map<string, typeof evidence[number]>();
  for (const row of evidence) {
    if (Date.parse(row.capturedAt) >= Date.parse(row.gameStartAt)) continue;
    const prior = latest.get(row.providerGameId);
    if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) latest.set(row.providerGameId, row);
  }
  const games: AuditGame[] = [];
  for (const row of latest.values()) {
    const result = results.get(row.providerGameId);
    if (!isFinal(result) || (!row.payload.game.away.fbs && !row.payload.game.home.fbs)) continue;
    const kickoff = Date.parse(row.gameStartAt);
    games.push({
      gameId: row.providerGameId,
      kickoffAt: row.gameStartAt,
      date: row.gameStartAt.slice(0, 10),
      awayTeam: row.payload.game.away.name,
      homeTeam: row.payload.game.home.name,
      authoritativeTotal: row.payload.decisions.forecast.expectedTotal,
      actualTotal: result.away_score! + result.home_score!,
      openingTarget: floorFourHours(kickoff - 72 * 60 * 60_000),
      pregameTarget: floorFourHours(kickoff - 60 * 60_000),
    });
  }
  const targets = [...new Set(games.flatMap((game) => [game.openingTarget, game.pregameTarget]))].sort();
  const maximumCredits = targets.length * COST_PER_SNAPSHOT;
  if (maximumCredits > MAX_TOTAL_CREDITS) throw new Error(`Declared grid costs ${maximumCredits}, over the ${MAX_TOTAL_CREDITS}-credit ceiling.`);

  await mkdir(CACHE_DIR, { recursive: true });
  const snapshots = new Map<string, CachedSnapshot>();
  let fetched = 0;
  let creditsUsed = 0;
  let creditsRemaining: number | null = null;
  const apiKey = process.env.THE_ODDS_API_KEY?.trim() ?? "";
  for (const target of targets) {
    try {
      snapshots.set(target, JSON.parse(await readFile(cachePath(target), "utf8")) as CachedSnapshot);
      continue;
    } catch (error) {
      const missing = error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
      if (!missing) throw error;
    }
    if (!fetchMode) continue;
    if (!apiKey) throw new Error("THE_ODDS_API_KEY is required with --fetch.");
    const response = await fetchSnapshot(target, apiKey);
    await writeFile(cachePath(target), `${JSON.stringify(response.snapshot)}\n`, "utf8");
    snapshots.set(target, response.snapshot);
    fetched += 1;
    creditsUsed += response.cost;
    creditsRemaining = response.remaining;
  }

  const signals: Signal[] = [];
  let matchedGames = 0;
  let gamesWithPinnacle = 0;
  let gamesWithRetail = 0;
  for (const game of games) {
    const eligibleSnapshots = [...snapshots.entries()]
      .filter(([target]) => target >= game.openingTarget && target <= game.pregameTarget)
      .map(([, snapshot]) => snapshot);
    const events = eligibleSnapshots.map((snapshot) => matchEvent(game, snapshot)).filter((event): event is HistoricalEvent => event !== null);
    if (events.length === 0) continue;
    matchedGames += 1;
    const paths = new Map<string, TotalQuote[]>();
    for (const quote of events.flatMap((event) => event.totals)) paths.set(quote.sportsbook, [...(paths.get(quote.sportsbook) ?? []), quote]);
    const moves = new Map<string, NonNullable<ReturnType<typeof baseMove>>>();
    const rowsByBook = new Map<string, TotalQuote[]>();
    for (const [book, rows] of paths) {
      const pathRows = dedupePath(rows).filter((row) => Date.parse(row.observedAt) < Date.parse(game.kickoffAt));
      rowsByBook.set(book, pathRows);
      const move = baseMove(pathRows);
      if (move) moves.set(book, move);
    }
    if (rowsByBook.get("pinnacle")?.length) gamesWithPinnacle += 1;
    if (RETAIL_BOOKS.some((book) => rowsByBook.get(book)?.length)) gamesWithRetail += 1;
    const pinnacle = moves.get("pinnacle");
    if (pinnacle) {
      signals.push({ candidate: `pinnacle_${pinnacle.channel}`, game, source: "pinnacle", line: pinnacle.line, side: pinnacle.side });
      const pathRows = rowsByBook.get("pinnacle") ?? [];
      const opening = pathRows[0];
      const current = pathRows.at(-1);
      if (opening && current) {
        const lineDelta = current.line - opening.line;
        for (const threshold of [0.5, 1, 1.5]) if (Math.abs(lineDelta) >= threshold) {
          signals.push({ candidate: `pinnacle_line_${threshold.toFixed(1)}`, game, source: "pinnacle", line: current.line, side: lineDelta > 0 ? "over" : "under" });
        }
        if (Math.abs(lineDelta) < 1e-9) {
          const priceDelta = (fairOver(current) - fairOver(opening)) * 100;
          for (const threshold of [1, 1.5, 2.5]) if (Math.abs(priceDelta) >= threshold) {
            signals.push({ candidate: `pinnacle_price_${threshold.toFixed(1)}pp`, game, source: "pinnacle", line: current.line, side: priceDelta > 0 ? "over" : "under" });
          }
        }
        const intermediatePrice = pathRows.find((row) => row.line === opening.line && Math.abs((fairOver(row) - fairOver(opening)) * 100) >= 1.5);
        if (intermediatePrice && Math.abs(lineDelta) >= 0.5) {
          const priceSide = fairOver(intermediatePrice) > fairOver(opening) ? "over" : "under";
          const lineSide = lineDelta > 0 ? "over" : "under";
          if (priceSide === lineSide) signals.push({ candidate: "pinnacle_price_first_then_line", game, source: "pinnacle", line: current.line, side: lineSide });
        }
        const extreme = pathRows.reduce((best, row) => Math.abs(row.line - opening.line) > Math.abs(best.line - opening.line) ? row : best, opening);
        const excursion = extreme.line - opening.line;
        const returned = Math.abs(excursion) - Math.abs(current.line - opening.line);
        if (Math.abs(excursion) >= 1 && returned >= 0.5) {
          signals.push({ candidate: "pinnacle_buyback", game, source: "pinnacle", line: current.line, side: excursion > 0 ? "under" : "over" });
        }
      }
    }
    const retailMoves = [...moves.entries()].filter(([book]) => RETAIL_BOOKS.includes(book as typeof RETAIL_BOOKS[number]));
    const overRetail = retailMoves.filter(([, move]) => move.side === "over");
    const underRetail = retailMoves.filter(([, move]) => move.side === "under");
    const retailWinner = overRetail.length >= 2 && overRetail.length > underRetail.length
      ? { side: "over" as const, rows: overRetail }
      : underRetail.length >= 2 && underRetail.length > overRetail.length
        ? { side: "under" as const, rows: underRetail }
        : null;
    if (retailWinner) {
      const representative = retailWinner.rows.sort((left, right) => RETAIL_BOOKS.indexOf(left[0] as typeof RETAIL_BOOKS[number]) - RETAIL_BOOKS.indexOf(right[0] as typeof RETAIL_BOOKS[number]))[0]!;
      signals.push({ candidate: "retail_consensus_2", game, source: retailWinner.rows.map(([book]) => book).sort().join("+"), line: representative[1].line, side: retailWinner.side });
      if (pinnacle?.side === retailWinner.side) signals.push({ candidate: "pinnacle_and_retail_consensus", game, source: "pinnacle+retail", line: pinnacle.line, side: pinnacle.side });
      if (pinnacle && pinnacle.side !== retailWinner.side) signals.push({ candidate: "pinnacle_against_retail_consensus", game, source: "pinnacle", line: pinnacle.line, side: pinnacle.side });
    }
  }

  const report = {
    release: "cfb_2026_historical_total_market_paths_2026_10_08_r1",
    mode: fetchMode ? "research_cache_fetch_zero_production_writes" : "plan_or_cached_read_zero_provider_calls",
    source: "the_odds_api_historical_external_reconstruction_not_original_runtime_evidence",
    sportKey: SPORT_KEY,
    books: BOOKMAKERS,
    games: games.length,
    targets: targets.length,
    maximumCredits,
    cachedSnapshots: snapshots.size,
    fetchedSnapshots: fetched,
    creditsUsed,
    creditsRemaining,
    matchedGames,
    gamesWithPinnacle,
    gamesWithRetail,
    signalRows: signals.length,
    cacheManifestSha256: createHash("sha256").update(JSON.stringify([...snapshots.keys()].sort())).digest("hex"),
    summary: summarize(signals.map(evaluate)),
  };
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
