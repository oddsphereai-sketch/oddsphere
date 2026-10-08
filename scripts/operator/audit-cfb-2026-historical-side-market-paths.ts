#!/usr/bin/env tsx

/**
 * SELECT-only reconstruction of schedule-fixed 2026 CFB ML/Spread paths.
 * Default mode plans/reads cache. --fetch spends a bounded 740-credit maximum.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";

loadEnvConfig(process.cwd());

type Json = Record<string, unknown>;
type Market = "moneyline" | "spread";
type Side = "home" | "away";
type Result = "win" | "loss" | "push";
type Block = "development" | "confirmation" | "holdout";
type FinalGame = { external_id: string | number; status: string | null; away_score: number | null; home_score: number | null };
type Quote = { sportsbook: string; market: Market; observedAt: string; snapshotAt: string; homeLine: number | null; homePrice: number; awayLine: number | null; awayPrice: number };
type Event = { id: string; commenceTime: string; awayTeam: string; homeTeam: string; quotes: Quote[] };
type Snapshot = { requestedAt: string; providerTimestamp: string; events: Event[] };
type Game = { gameId: string; kickoffAt: string; date: string; awayTeam: string; homeTeam: string; expectedMarginHome: number; actualMarginHome: number; openingTarget: string; pregameTarget: string };
type Signal = { candidate: string; game: Game; market: Market; source: string; line: number | null; side: Side };
type Evaluation = { candidate: string; market: Market; gameId: string; date: string; block: Block; source: string; result: Result; authoritativeResult: Result; disagrees: boolean; correction: boolean; harm: boolean; authoritativeMae: number; reflectedMae: number };

const SPORT_KEY = "americanfootball_ncaaf";
const BOOKS = ["pinnacle", "draftkings", "fanduel", "betmgm", "betrivers", "betonlineag"] as const;
const RETAIL = BOOKS.filter((book) => book !== "pinnacle");
const CACHE_DIR = path.resolve("football-research/cache/cfb-side-market-2026-r1");
const COST_PER_SNAPSHOT = 20;
const MAX_CREDITS = 800;
const CREDIT_RESERVE = 18_000;
const MAX_RESPONSE_BYTES = 8_000_000;

function object(value: unknown): Json { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finite(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }
function american(value: unknown): number | null { const parsed = finite(value); return parsed !== null && Number.isInteger(parsed) && parsed !== 0 ? parsed : null; }
function iso(value: unknown): string | null { const parsed = Date.parse(text(value) ?? ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function normalize(value: string): string { return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, ""); }
function floorFourHours(timestamp: number): string { const interval = 4 * 60 * 60_000; return new Date(Math.floor(timestamp / interval) * interval).toISOString(); }
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function fairHome(quote: Quote): number { const home = implied(quote.homePrice); const away = implied(quote.awayPrice); return home / (home + away); }
function blockFor(date: string): Block { return date <= "2026-09-27" ? "development" : date <= "2026-10-04" ? "confirmation" : "holdout"; }
function cachePath(target: string): string { return path.join(CACHE_DIR, `${SPORT_KEY}-${target.replace(/[^0-9]/g, "")}.json`); }
function authoritativeSide(game: Game, market: Market, line: number | null): Side { return game.expectedMarginHome + (market === "spread" ? line ?? 0 : 0) >= 0 ? "home" : "away"; }
function settle(game: Game, market: Market, side: Side, line: number | null): Result {
  const value = game.actualMarginHome + (market === "spread" ? line ?? 0 : 0);
  if (Math.abs(value) < 1e-9) return "push";
  return (value > 0 ? "home" : "away") === side ? "win" : "loss";
}

async function readResults(client: SupabaseClient, ids: string[]): Promise<Map<string, FinalGame>> {
  const output = new Map<string, FinalGame>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await client.from("games").select("external_id,status,away_score,home_score").eq("sport", "cfb").in("external_id", ids.slice(index, index + 150));
    if (error) throw new Error(`CFB result read failed: ${error.message}`);
    for (const row of (data ?? []) as FinalGame[]) output.set(String(row.external_id), row);
  }
  return output;
}
function isFinal(row: FinalGame | undefined): row is FinalGame { return Boolean(row && ["final", "completed", "post"].includes(row.status?.trim().toLowerCase() ?? "") && Number.isFinite(row.away_score) && Number.isFinite(row.home_score)); }

function normalizeSnapshot(raw: string, requestedAt: string): Snapshot {
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new Error(`Historical snapshot ${requestedAt} exceeds byte ceiling.`);
  const wrapper = object(JSON.parse(raw));
  const providerTimestamp = iso(wrapper.timestamp) ?? requestedAt;
  const events = array(wrapper.data).map(object).flatMap((event): Event[] => {
    const id = text(event.id); const commenceTime = iso(event.commence_time); const awayTeam = text(event.away_team); const homeTeam = text(event.home_team);
    if (!id || !commenceTime || !awayTeam || !homeTeam) return [];
    const quotes = array(event.bookmakers).map(object).flatMap((book): Quote[] => {
      const sportsbook = text(book.key)?.toLowerCase() ?? "";
      if (!BOOKS.includes(sportsbook as typeof BOOKS[number])) return [];
      return array(book.markets).map(object).flatMap((providerMarket): Quote[] => {
        const key = text(providerMarket.key);
        const market: Market | null = key === "h2h" ? "moneyline" : key === "spreads" ? "spread" : null;
        if (!market) return [];
        const outcomes = array(providerMarket.outcomes).map(object);
        const homeRows = outcomes.filter((outcome) => normalize(text(outcome.name) ?? "") === normalize(homeTeam));
        const awayRows = outcomes.filter((outcome) => normalize(text(outcome.name) ?? "") === normalize(awayTeam));
        if (homeRows.length !== 1 || awayRows.length !== 1) return [];
        const homePrice = american(homeRows[0]!.price); const awayPrice = american(awayRows[0]!.price);
        const homeLine = market === "spread" ? finite(homeRows[0]!.point) : null;
        const awayLine = market === "spread" ? finite(awayRows[0]!.point) : null;
        const observedAt = iso(providerMarket.last_update) ?? iso(book.last_update);
        if (homePrice === null || awayPrice === null || !observedAt || (market === "spread" && (homeLine === null || awayLine === null || Math.abs(homeLine + awayLine) > 0.001))) return [];
        return [{ sportsbook, market, observedAt, snapshotAt: providerTimestamp, homeLine, homePrice, awayLine, awayPrice }];
      });
    });
    return [{ id, commenceTime, awayTeam, homeTeam, quotes }];
  });
  return { requestedAt, providerTimestamp, events };
}

async function fetchSnapshot(target: string, apiKey: string): Promise<{ snapshot: Snapshot; cost: number; remaining: number }> {
  const url = new URL(`https://api.the-odds-api.com/v4/historical/sports/${SPORT_KEY}/odds`);
  url.searchParams.set("apiKey", apiKey); url.searchParams.set("bookmakers", BOOKS.join(",")); url.searchParams.set("markets", "h2h,spreads");
  url.searchParams.set("oddsFormat", "american"); url.searchParams.set("dateFormat", "iso"); url.searchParams.set("date", target.replace(".000Z", "Z"));
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Historical side snapshot ${target} failed (${response.status}): ${raw.slice(0, 240)}`);
  const cost = Number(response.headers.get("x-requests-last")); const remaining = Number(response.headers.get("x-requests-remaining"));
  if (cost !== COST_PER_SNAPSHOT) throw new Error(`Historical side cost changed: expected ${COST_PER_SNAPSHOT}, received ${cost}.`);
  if (!Number.isInteger(remaining) || remaining < CREDIT_RESERVE) throw new Error(`Historical side reserve reached: ${remaining}.`);
  return { snapshot: normalizeSnapshot(raw, target), cost, remaining };
}

function matchEvent(game: Game, snapshot: Snapshot): Event | null {
  const matches = snapshot.events.filter((event) => Math.abs(Date.parse(event.commenceTime) - Date.parse(game.kickoffAt)) <= 3 * 60 * 60_000 && normalize(event.awayTeam) === normalize(game.awayTeam) && normalize(event.homeTeam) === normalize(game.homeTeam));
  return matches.length === 1 ? matches[0]! : null;
}
function dedupePath(quotes: Quote[]): Quote[] {
  const unique = new Map<string, Quote>();
  for (const quote of quotes.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))) unique.set(`${quote.sportsbook}:${quote.market}:${quote.observedAt}:${quote.homeLine}:${quote.homePrice}:${quote.awayPrice}`, quote);
  return [...unique.values()].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
}
function baseMove(pathRows: Quote[]): { side: Side; channel: "line" | "price"; line: number | null } | null {
  const opening = pathRows[0]; const current = pathRows.at(-1);
  if (!opening || !current || opening.observedAt >= current.observedAt) return null;
  if (current.market === "spread") {
    const delta = current.homeLine! - opening.homeLine!;
    if (Math.abs(delta) >= 0.5) return { side: delta < 0 ? "home" : "away", channel: "line", line: current.homeLine };
    if (Math.abs(delta) > 1e-9) return null;
  }
  const probabilityDelta = (fairHome(current) - fairHome(opening)) * 100;
  return Math.abs(probabilityDelta) >= 1 ? { side: probabilityDelta > 0 ? "home" : "away", channel: "price", line: current.homeLine } : null;
}
function evaluate(signal: Signal): Evaluation {
  const baseSide = authoritativeSide(signal.game, signal.market, signal.line);
  const result = settle(signal.game, signal.market, signal.side, signal.line);
  const authoritativeResult = settle(signal.game, signal.market, baseSide, signal.line);
  const disagrees = signal.side !== baseSide;
  const reflectedMargin = signal.market === "spread" && signal.line !== null ? -2 * signal.line - signal.game.expectedMarginHome : -signal.game.expectedMarginHome;
  return { candidate: signal.candidate, market: signal.market, gameId: signal.game.gameId, date: signal.game.date, block: blockFor(signal.game.date), source: signal.source, result, authoritativeResult, disagrees, correction: disagrees && result === "win" && authoritativeResult === "loss", harm: disagrees && result === "loss" && authoritativeResult === "win", authoritativeMae: Math.abs(signal.game.expectedMarginHome - signal.game.actualMarginHome), reflectedMae: Math.abs(reflectedMargin - signal.game.actualMarginHome) };
}
function metrics(rows: Evaluation[]) {
  const resolved = rows.filter((row) => row.result !== "push"); const baseResolved = rows.filter((row) => row.authoritativeResult !== "push"); const disagreements = rows.filter((row) => row.disagrees);
  return { games: new Set(rows.map((row) => row.gameId)).size, dates: [...new Set(rows.map((row) => row.date))].sort(), wins: resolved.filter((row) => row.result === "win").length, losses: resolved.filter((row) => row.result === "loss").length, pushes: rows.length - resolved.length, authoritativeWins: baseResolved.filter((row) => row.authoritativeResult === "win").length, authoritativeLosses: baseResolved.filter((row) => row.authoritativeResult === "loss").length, disagreements: disagreements.length, corrections: disagreements.filter((row) => row.correction).length, harms: disagreements.filter((row) => row.harm).length, authoritativeMaeOnDisagreements: disagreements.length ? disagreements.reduce((sum, row) => sum + row.authoritativeMae, 0) / disagreements.length : null, reflectedMaeOnDisagreements: disagreements.length ? disagreements.reduce((sum, row) => sum + row.reflectedMae, 0) / disagreements.length : null };
}
function summarize(rows: Evaluation[]) { return Object.fromEntries([...new Set(rows.map((row) => `${row.market}:${row.candidate}`))].sort().map((key) => { const [market, candidate] = key.split(":") as [Market, string]; const selected = rows.filter((row) => row.market === market && row.candidate === candidate); return [key, { overall: metrics(selected), byBlock: Object.fromEntries((["development", "confirmation", "holdout"] as const).map((block) => [block, metrics(selected.filter((row) => row.block === block))])) }]; })); }

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const fetchMode = process.argv.includes("--fetch"); const client = createClient(url, key, { auth: { persistSession: false } });
  const evidence = (await readCfbForwardWriterEvidence({ client, season: 2026 })).evidence;
  const results = await readResults(client, [...new Set(evidence.map((row) => row.providerGameId))]);
  const latest = new Map<string, typeof evidence[number]>();
  for (const row of evidence) { if (Date.parse(row.capturedAt) >= Date.parse(row.gameStartAt)) continue; const prior = latest.get(row.providerGameId); if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) latest.set(row.providerGameId, row); }
  const games: Game[] = [];
  for (const row of latest.values()) { const result = results.get(row.providerGameId); if (!isFinal(result) || (!row.payload.game.away.fbs && !row.payload.game.home.fbs)) continue; const kickoff = Date.parse(row.gameStartAt); games.push({ gameId: row.providerGameId, kickoffAt: row.gameStartAt, date: row.gameStartAt.slice(0, 10), awayTeam: row.payload.game.away.name, homeTeam: row.payload.game.home.name, expectedMarginHome: row.payload.decisions.forecast.expectedMarginHome, actualMarginHome: result.home_score! - result.away_score!, openingTarget: floorFourHours(kickoff - 72 * 60 * 60_000), pregameTarget: floorFourHours(kickoff - 60 * 60_000) }); }
  const targets = [...new Set(games.flatMap((game) => [game.openingTarget, game.pregameTarget]))].sort(); const maximumCredits = targets.length * COST_PER_SNAPSHOT;
  if (maximumCredits > MAX_CREDITS) throw new Error(`Declared grid costs ${maximumCredits}, over the ${MAX_CREDITS}-credit ceiling.`);
  await mkdir(CACHE_DIR, { recursive: true }); const snapshots = new Map<string, Snapshot>(); let fetched = 0; let creditsUsed = 0; let creditsRemaining: number | null = null; const apiKey = process.env.THE_ODDS_API_KEY?.trim() ?? "";
  for (const target of targets) {
    try { snapshots.set(target, JSON.parse(await readFile(cachePath(target), "utf8")) as Snapshot); continue; } catch (error) { const missing = error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"; if (!missing) throw error; }
    if (!fetchMode) continue; if (!apiKey) throw new Error("THE_ODDS_API_KEY is required with --fetch.");
    const response = await fetchSnapshot(target, apiKey); await writeFile(cachePath(target), `${JSON.stringify(response.snapshot)}\n`, "utf8"); snapshots.set(target, response.snapshot); fetched += 1; creditsUsed += response.cost; creditsRemaining = response.remaining;
  }
  const signals: Signal[] = []; let matchedGames = 0; const coverage = { moneyline: 0, spread: 0 };
  for (const game of games) {
    const events = [...snapshots.entries()].filter(([target]) => target >= game.openingTarget && target <= game.pregameTarget).map(([, snapshot]) => matchEvent(game, snapshot)).filter((event): event is Event => event !== null);
    if (!events.length) continue; matchedGames += 1;
    for (const market of ["moneyline", "spread"] as const) {
      const paths = new Map<string, Quote[]>(); for (const quote of events.flatMap((event) => event.quotes).filter((quote) => quote.market === market)) paths.set(quote.sportsbook, [...(paths.get(quote.sportsbook) ?? []), quote]);
      const pathByBook = new Map<string, Quote[]>(); const moves = new Map<string, NonNullable<ReturnType<typeof baseMove>>>();
      for (const [book, rows] of paths) { const clean = dedupePath(rows).filter((row) => Date.parse(row.observedAt) < Date.parse(game.kickoffAt)); pathByBook.set(book, clean); const move = baseMove(clean); if (move) moves.set(book, move); }
      if (pathByBook.size) coverage[market] += 1;
      const pinnacle = moves.get("pinnacle");
      if (pinnacle) {
        signals.push({ candidate: `pinnacle_${pinnacle.channel}`, game, market, source: "pinnacle", line: pinnacle.line, side: pinnacle.side });
        const pathRows = pathByBook.get("pinnacle") ?? []; const opening = pathRows[0]; const current = pathRows.at(-1);
        if (opening && current) {
          const probabilityDelta = (fairHome(current) - fairHome(opening)) * 100;
          for (const threshold of [1, 1.5, 2.5]) if ((market === "moneyline" || Math.abs(current.homeLine! - opening.homeLine!) < 1e-9) && Math.abs(probabilityDelta) >= threshold) signals.push({ candidate: `pinnacle_price_${threshold.toFixed(1)}pp`, game, market, source: "pinnacle", line: current.homeLine, side: probabilityDelta > 0 ? "home" : "away" });
          if (market === "spread") {
            const lineDelta = current.homeLine! - opening.homeLine!;
            for (const threshold of [0.5, 1, 1.5]) if (Math.abs(lineDelta) >= threshold) signals.push({ candidate: `pinnacle_line_${threshold.toFixed(1)}`, game, market, source: "pinnacle", line: current.homeLine, side: lineDelta < 0 ? "home" : "away" });
            const intermediate = pathRows.find((row) => row.homeLine === opening.homeLine && Math.abs((fairHome(row) - fairHome(opening)) * 100) >= 1.5);
            if (intermediate && Math.abs(lineDelta) >= 0.5) { const priceSide: Side = fairHome(intermediate) > fairHome(opening) ? "home" : "away"; const lineSide: Side = lineDelta < 0 ? "home" : "away"; if (priceSide === lineSide) signals.push({ candidate: "pinnacle_price_first_then_line", game, market, source: "pinnacle", line: current.homeLine, side: lineSide }); }
            const extreme = pathRows.reduce((best, row) => Math.abs(row.homeLine! - opening.homeLine!) > Math.abs(best.homeLine! - opening.homeLine!) ? row : best, opening); const excursion = extreme.homeLine! - opening.homeLine!; const returned = Math.abs(excursion) - Math.abs(current.homeLine! - opening.homeLine!);
            if (Math.abs(excursion) >= 1 && returned >= 0.5) signals.push({ candidate: "pinnacle_buyback", game, market, source: "pinnacle", line: current.homeLine, side: excursion < 0 ? "away" : "home" });
          }
        }
      }
      const retailMoves = [...moves.entries()].filter(([book]) => RETAIL.includes(book as typeof RETAIL[number])); const home = retailMoves.filter(([, move]) => move.side === "home"); const away = retailMoves.filter(([, move]) => move.side === "away");
      const winner = home.length >= 2 && home.length > away.length ? { side: "home" as const, rows: home } : away.length >= 2 && away.length > home.length ? { side: "away" as const, rows: away } : null;
      if (winner) { const representative = winner.rows.sort((left, right) => RETAIL.indexOf(left[0] as typeof RETAIL[number]) - RETAIL.indexOf(right[0] as typeof RETAIL[number]))[0]!; signals.push({ candidate: "retail_consensus_2", game, market, source: winner.rows.map(([book]) => book).sort().join("+"), line: representative[1].line, side: winner.side }); if (pinnacle?.side === winner.side) signals.push({ candidate: "pinnacle_and_retail_consensus", game, market, source: "pinnacle+retail", line: pinnacle.line, side: pinnacle.side }); if (pinnacle && pinnacle.side !== winner.side) signals.push({ candidate: "pinnacle_against_retail_consensus", game, market, source: "pinnacle", line: pinnacle.line, side: pinnacle.side }); }
    }
  }
  console.log(JSON.stringify({ release: "cfb_2026_historical_side_market_paths_2026_10_08_r1", mode: fetchMode ? "research_cache_fetch_zero_production_writes" : "plan_or_cached_read_zero_provider_calls", source: "the_odds_api_historical_external_reconstruction_not_original_runtime_evidence", books: BOOKS, games: games.length, targets: targets.length, maximumCredits, cachedSnapshots: snapshots.size, fetchedSnapshots: fetched, creditsUsed, creditsRemaining, matchedGames, coverage, signalRows: signals.length, cacheManifestSha256: createHash("sha256").update(JSON.stringify([...snapshots.keys()].sort())).digest("hex"), summary: summarize(signals.map(evaluate)) }, null, 2));
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
