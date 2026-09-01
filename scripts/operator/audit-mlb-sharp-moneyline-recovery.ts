/**
 * Read-only impact audit for targeted MLB sharp-book Moneyline recovery.
 *
 * One bounded SharpAPI fetch is compared with the currently persisted lines.
 * The authoritative prediction-record builder then runs twice: once against
 * production inputs and once against an in-memory client that overlays only
 * newly recovered, complete sharp-book Moneyline pairs. No provider result is
 * persisted and both writer passes use apply=false.
 */

import { createClient } from "@supabase/supabase-js";
import { getOddsProvider } from "../../lib/providers/factory";
import {
  SharpAPIOddsProvider,
  type SharpApiSlateGame,
} from "../../lib/providers/real_api/SharpAPIOddsProvider";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";

type Json = Record<string, unknown>;
type Line = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  odds_american: number | null;
  line_value: number | null;
  fetched_at: string;
};

const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);

function key(row: Pick<Line, "game_id" | "market_type" | "sportsbook" | "side">): string {
  return `${row.game_id}::${row.market_type}::${row.sportsbook}::${row.side ?? "null"}`;
}

function pairKey(gameId: number, book: string): string {
  return `${gameId}::${book}`;
}

function completeMoneylinePairs(rows: readonly Line[]): Set<string> {
  const sides = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.market_type !== "moneyline" || !SHARP_BOOKS.has(row.sportsbook)) continue;
    if (row.side !== "home" && row.side !== "away") continue;
    const k = pairKey(row.game_id, row.sportsbook);
    const found = sides.get(k) ?? new Set<string>();
    found.add(row.side);
    sides.set(k, found);
  }
  return new Set([...sides].filter(([, found]) => found.has("home") && found.has("away")).map(([k]) => k));
}

type QueryResult = { data?: unknown; [key: string]: unknown };
type BuilderLike = PromiseLike<QueryResult> & Record<PropertyKey, unknown>;

function wrapLinesBuilder(builder: BuilderLike, overlays: readonly Line[]): BuilderLike {
  const proxy = new Proxy(builder, {
    get(target, property, receiver) {
      if (property === "then") {
        return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
          target.then(
            (result: QueryResult) => {
              if (!Array.isArray(result.data)) return resolve(result);
              const rows = result.data as Json[];
              if (rows.length > 0 && !("game_id" in rows[0]!)) return resolve(result);
              const merged = new Map<string, Json>();
              for (const row of rows) {
                merged.set(key(row as unknown as Line), row);
              }
              for (const row of overlays) merged.set(key(row), row as unknown as Json);
              resolve({ ...result, data: [...merged.values()] });
            },
            reject,
          );
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const next = Reflect.apply(value, target, args) as unknown;
        return next === target ? proxy : wrapLinesBuilder(next as BuilderLike, overlays);
      };
    },
  });
  return proxy;
}

function overlayClient<T extends object>(client: T, overlays: readonly Line[]): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "from") {
        return (table: string) => {
          const from = Reflect.get(target, "from", receiver);
          if (typeof from !== "function") throw new Error("Supabase client has no from() method");
          const builder = Reflect.apply(from, target, [table]) as BuilderLike;
          return table === "lines" ? wrapLinesBuilder(builder, overlays) : builder;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function grade(row: Json): string {
  if (row.best_angle === true) return "best_angle";
  if (row.play_grade === "lean") return "lean";
  if (row.play_grade === "market_aligned") return "watchlist";
  return "no_play";
}

function boardCounts(rows: readonly Json[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[grade(row)] = (counts[grade(row)] ?? 0) + 1;
  return counts;
}

function recordKey(row: Json): string {
  return `${row.game_id}::${row.market}`;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase read credentials are required");
  const slateDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: gamesRaw, error: gamesError } = await client
    .from("games")
    .select("id, external_id, game_date, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation)")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .order("game_date", { ascending: true });
  if (gamesError) throw new Error(gamesError.message);
  const games = (gamesRaw ?? []) as unknown as Array<{
    id: number;
    external_id: number;
    game_date: string;
    home_team: { abbreviation: string } | Array<{ abbreviation: string }> | null;
    away_team: { abbreviation: string } | Array<{ abbreviation: string }> | null;
  }>;
  const gameIdByExternal = new Map(games.map((game) => [game.external_id, game.id]));
  const pairCounts = new Map<string, number>();
  const slateGames: SharpApiSlateGame[] = games.flatMap((game) => {
    const home = Array.isArray(game.home_team) ? game.home_team[0] : game.home_team;
    const away = Array.isArray(game.away_team) ? game.away_team[0] : game.away_team;
    if (!home?.abbreviation || !away?.abbreviation) return [];
    const pair = `${away.abbreviation}|${home.abbreviation}`;
    const gameNumber = (pairCounts.get(pair) ?? 0) + 1;
    pairCounts.set(pair, gameNumber);
    return [{
      externalId: game.external_id,
      home: home.abbreviation as SharpApiSlateGame["home"],
      away: away.abbreviation as SharpApiSlateGame["away"],
      gameNumber,
    }];
  });
  const gameIds = games.map((game) => game.id);
  const { data: currentRaw, error: currentError } = await client
    .from("lines")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value, fetched_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total", "first_inning_total"])
    .is("player_id", null);
  if (currentError) throw new Error(currentError.message);
  const current = (currentRaw ?? []) as Line[];

  const provider = getOddsProvider();
  if (!(provider instanceof SharpAPIOddsProvider)) {
    throw new Error("ODDS_PROVIDER must resolve to real_api");
  }
  const fetched = await provider.getGameLinesV2(slateDate, "mlb", { slateGames });
  const providerLines: Line[] = fetched.records.flatMap((row) => {
    const gameId = gameIdByExternal.get(row.game_external_id);
    if (gameId === undefined) return [];
    return [{
      game_id: gameId,
      market_type: row.market_type,
      side: row.side,
      sportsbook: String(row.sportsbook).toLowerCase(),
      odds_american: row.odds_american,
      line_value: row.line_value,
      fetched_at: row.fetched_at,
    }];
  });

  const currentSharpPairs = completeMoneylinePairs(current);
  const providerSharpPairs = completeMoneylinePairs(providerLines);
  const newlyRecoveredPairs = new Set([...providerSharpPairs].filter((k) => !currentSharpPairs.has(k)));
  const overlays = providerLines.filter((row) =>
    row.market_type === "moneyline" && newlyRecoveredPairs.has(pairKey(row.game_id, row.sportsbook)),
  );

  const opts = { sport: "mlb" as const, slateDate, launchDay: false, apply: false };
  const baseline = await createPredictionRecords({ ...opts, supabase: client });
  const candidate = await createPredictionRecords({ ...opts, supabase: overlayClient(client, overlays) });
  if (baseline.errors.length > 0 || candidate.errors.length > 0) {
    throw new Error(JSON.stringify({ baseline: baseline.errors, candidate: candidate.errors }));
  }
  const before = baseline.proposed as unknown as Json[];
  const after = candidate.proposed as unknown as Json[];
  const beforeByKey = new Map(before.map((row) => [recordKey(row), row]));
  const changes = after.flatMap((row) => {
    const prior = beforeByKey.get(recordKey(row));
    if (!prior) return [];
    const fields = ["pick", "side", "line_value", "odds_american", "model_probability", "market_probability", "edge", "play_grade", "best_angle", "no_bet_reason"];
    if (fields.every((field) => JSON.stringify(prior[field]) === JSON.stringify(row[field]))) return [];
    return [{
      gameId: row.game_id,
      matchup: row.matchup,
      market: row.market,
      beforeGrade: grade(prior),
      afterGrade: grade(row),
      beforePick: prior.pick,
      afterPick: row.pick,
      beforeBook: prior.sportsbook,
      afterBook: row.sportsbook,
      beforePrice: prior.odds_american,
      afterPrice: row.odds_american,
      beforeMarketProbability: prior.market_probability,
      afterMarketProbability: row.market_probability,
      beforeEdge: prior.edge,
      afterEdge: row.edge,
    }];
  });

  const providerFirstInning = providerLines.filter((row) => row.market_type === "first_inning_total");
  console.log(JSON.stringify({
    audit: "mlb_sharp_moneyline_recovery_2026_09_01",
    readOnly: true,
    writes: 0,
    slateDate,
    games: games.length,
    providerCalls: fetched.discovery.apiCallsMade,
    providerRows: providerLines.length,
    currentSharpMoneylinePairs: [...currentSharpPairs].sort(),
    providerSharpMoneylinePairs: [...providerSharpPairs].sort(),
    newlyRecoveredSharpMoneylinePairs: [...newlyRecoveredPairs].sort(),
    recoveredRows: overlays,
    firstInning: {
      providerRows: providerFirstInning.length,
      games: new Set(providerFirstInning.map((row) => row.game_id)).size,
      books: [...new Set(providerFirstInning.map((row) => row.sportsbook))].sort(),
      sharpRows: providerFirstInning.filter((row) => SHARP_BOOKS.has(row.sportsbook)).length,
    },
    beforeCounts: boardCounts(before),
    afterCounts: boardCounts(after),
    promotions: changes.filter((row) => !["best_angle", "lean"].includes(row.beforeGrade) && ["best_angle", "lean"].includes(row.afterGrade)).length,
    demotions: changes.filter((row) => ["best_angle", "lean"].includes(row.beforeGrade) && !["best_angle", "lean"].includes(row.afterGrade)).length,
    changes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
