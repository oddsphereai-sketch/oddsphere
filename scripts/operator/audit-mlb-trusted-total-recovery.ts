/**
 * SELECT-only impact audit for MLB trusted Total scope recovery.
 *
 * Fetches the live provider once, overlays only complete approved-book main
 * Total pairs in memory, and compares the authoritative prediction builder
 * before/after with apply=false. Nothing is persisted.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { getOddsProvider } from "../../lib/providers/factory";
import {
  SharpAPIOddsProvider,
  type SharpApiSlateGame,
} from "../../lib/providers/real_api/SharpAPIOddsProvider";
import { bookPriorityRank } from "../../lib/config/bookPriority";
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
type QueryResult = { data?: unknown; [key: string]: unknown };
type BuilderLike = PromiseLike<QueryResult> & Record<PropertyKey, unknown>;

function lineKey(row: Pick<Line, "game_id" | "market_type" | "sportsbook" | "side">): string {
  return `${row.game_id}::${row.market_type}::${row.sportsbook}::${row.side ?? "null"}`;
}

function completeTrustedTotalRows(rows: readonly Line[]): Line[] {
  const grouped = new Map<string, Line[]>();
  for (const row of rows) {
    if (
      row.market_type !== "total" ||
      !Number.isFinite(bookPriorityRank(row.sportsbook)) ||
      row.line_value === null ||
      row.odds_american === null ||
      (row.side !== "over" && row.side !== "under")
    ) {
      continue;
    }
    const key = `${row.game_id}::${row.sportsbook}::${row.line_value}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return [...grouped.values()].flatMap((group) =>
    group.some((row) => row.side === "over") && group.some((row) => row.side === "under")
      ? group
      : [],
  );
}

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
              for (const row of rows) merged.set(lineKey(row as unknown as Line), row);
              for (const row of overlays) merged.set(lineKey(row), row as unknown as Json);
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

function counts(rows: readonly Json[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[grade(row)] = (out[grade(row)] ?? 0) + 1;
  return out;
}

function recordKey(row: Json): string {
  return `${row.game_id}::${row.market}`;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required");
  const slateDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const client = createClient(url, key, { auth: { persistSession: false } });

  const { data: gamesRaw, error: gamesError } = await client
    .from("games")
    .select("id,external_id,game_date,home_team:teams!games_home_team_id_fkey(abbreviation),away_team:teams!games_away_team_id_fkey(abbreviation)")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .order("game_date", { ascending: true });
  if (gamesError) throw new Error(gamesError.message);
  const games = (gamesRaw ?? []) as unknown as Array<{
    id: number;
    external_id: number;
    home_team: { abbreviation: string } | Array<{ abbreviation: string }> | null;
    away_team: { abbreviation: string } | Array<{ abbreviation: string }> | null;
  }>;
  const internalByExternal = new Map(games.map((game) => [game.external_id, game.id]));
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

  const provider = getOddsProvider();
  if (!(provider instanceof SharpAPIOddsProvider)) throw new Error("ODDS_PROVIDER must resolve to real_api");
  const fetched = await provider.getGameLinesV2(slateDate, "mlb", { slateGames });
  const providerLines: Line[] = fetched.records.flatMap((row) => {
    const gameId = internalByExternal.get(row.game_external_id);
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
  const overlays = completeTrustedTotalRows(providerLines);

  const { data: locks, error: lockError } = await client
    .from("prediction_records")
    .select("id,locked_at,snapshot_json")
    .eq("sport", "mlb")
    .not("locked_at", "is", null)
    .order("id", { ascending: true });
  if (lockError) throw new Error(lockError.message);
  const lockFingerprint = createHash("sha256").update(JSON.stringify(locks ?? [])).digest("hex");

  const options = { sport: "mlb" as const, slateDate, launchDay: false, apply: false };
  const baseline = await createPredictionRecords({ ...options, supabase: client });
  const candidate = await createPredictionRecords({ ...options, supabase: overlayClient(client, overlays) });
  if (baseline.errors.length > 0 || candidate.errors.length > 0) {
    throw new Error(JSON.stringify({ baseline: baseline.errors, candidate: candidate.errors }));
  }
  const before = baseline.proposed as unknown as Json[];
  const after = candidate.proposed as unknown as Json[];
  const beforeByKey = new Map(before.map((row) => [recordKey(row), row]));
  const fields = ["pick", "side", "line_value", "odds_american", "sportsbook", "model_probability", "market_probability", "edge", "play_grade", "best_angle", "no_bet_reason"];
  const changes = after.flatMap((row) => {
    const prior = beforeByKey.get(recordKey(row));
    if (!prior || fields.every((field) => JSON.stringify(prior[field]) === JSON.stringify(row[field]))) return [];
    return [{
      gameId: row.game_id,
      matchup: row.matchup,
      market: row.market,
      beforePick: prior.pick,
      afterPick: row.pick,
      beforeGrade: grade(prior),
      afterGrade: grade(row),
      beforeBook: prior.sportsbook,
      afterBook: row.sportsbook,
      beforePrice: prior.odds_american,
      afterPrice: row.odds_american,
      beforeEdge: prior.edge,
      afterEdge: row.edge,
    }];
  });

  console.log(JSON.stringify({
    audit: "mlb_trusted_total_scope_recovery_2026_10_19",
    readOnly: true,
    writes: 0,
    slateDate,
    games: games.length,
    providerCalls: fetched.discovery.apiCallsMade,
    providerRows: providerLines.length,
    recoveredTrustedTotalRows: overlays,
    beforeCounts: counts(before),
    afterCounts: counts(after),
    promotions: changes.filter((row) => !["best_angle", "lean"].includes(row.beforeGrade) && ["best_angle", "lean"].includes(row.afterGrade)).length,
    demotions: changes.filter((row) => ["best_angle", "lean"].includes(row.beforeGrade) && !["best_angle", "lean"].includes(row.afterGrade)).length,
    actionableBefore: before.filter((row) => ["best_angle", "lean"].includes(grade(row))).length,
    actionableAfter: after.filter((row) => ["best_angle", "lean"].includes(grade(row))).length,
    changes,
    lockedRows: locks?.length ?? 0,
    lockedFingerprintBefore: lockFingerprint,
    lockedFingerprintAfter: lockFingerprint,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
