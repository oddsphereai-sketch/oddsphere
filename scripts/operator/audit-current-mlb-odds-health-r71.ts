/** SELECT-only MLB line/price health audit. No provider calls and no writes. */

import { supabase } from "../../lib/db/supabase";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";

type Row = Record<string, unknown>;

const slateDate = process.argv[2] ?? "2026-08-28";
const SYNTHETIC_BOOKS = new Set(["splits_consensus", "locked_snapshot", "recommendation_snapshot"]);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function implied(american: number): number {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

function dbMarket(recordMarket: unknown): string {
  return recordMarket === "first_inning" ? "first_inning_total" : String(recordMarket ?? "");
}

async function main(): Promise<void> {
  const gamesResult = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate);
  if (gamesResult.error) throw new Error(gamesResult.error.message);
  const games = (gamesResult.data ?? []) as Row[];
  const gameIds = games.map((row) => Number(row.id));
  const teamIds = [...new Set(games.flatMap((row) => [Number(row.home_team_id), Number(row.away_team_id)]))];
  const [teamsResult, linesResult, dry] = await Promise.all([
    supabase.from("teams").select("id, abbreviation").in("id", teamIds),
    supabase
      .from("lines")
      .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
      .in("game_id", gameIds)
      .in("market_type", ["moneyline", "total", "first_inning_total"])
      .is("player_id", null),
    createPredictionRecords({ sport: "mlb", slateDate, launchDay: false, apply: false, supabase }),
  ]);
  if (teamsResult.error) throw new Error(teamsResult.error.message);
  if (linesResult.error) throw new Error(linesResult.error.message);
  if (dry.errors.length > 0) throw new Error(JSON.stringify(dry.errors));
  const abbr = new Map(((teamsResult.data ?? []) as Row[]).map((row) => [Number(row.id), String(row.abbreviation)]));
  const matchup = new Map(games.map((row) => [
    Number(row.id),
    `${abbr.get(Number(row.away_team_id)) ?? "?"}@${abbr.get(Number(row.home_team_id)) ?? "?"}`,
  ]));
  const rawLines = (linesResult.data ?? []) as Row[];
  const lines = rawLines.filter((row) => !SYNTHETIC_BOOKS.has(String(row.sportsbook ?? "").toLowerCase()));
  const grouped = new Map<string, Row[]>();
  for (const row of lines) {
    const key = `${row.game_id}::${row.market_type}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const missingTwoSided: Row[] = [];
  for (const gameId of gameIds) {
    for (const market of ["moneyline", "total", "first_inning_total"]) {
      const rows = grouped.get(`${gameId}::${market}`) ?? [];
      const books = new Set(rows.map((row) => String(row.sportsbook)));
      const requiredSides = market === "total" || market === "first_inning_total"
        ? ["over", "under"]
        : ["home", "away"];
      const coherentBooks = [...books].filter((book) => requiredSides.every((side) =>
        rows.some((row) => row.sportsbook === book && row.side === side && num(row.odds_american) !== null),
      ));
      if (coherentBooks.length === 0) {
        missingTwoSided.push({ gameId, matchup: matchup.get(gameId), market, rows: rows.length, books: books.size });
      }
    }
  }

  const totalOutliers: Row[] = [];
  const firstInningNonHalfRun: Row[] = [];
  for (const [key, rows] of grouped) {
    const [gameIdRaw, market] = key.split("::");
    if (market === "total") {
      const center = median(rows.map((row) => num(row.line_value)).filter((value): value is number => value !== null));
      if (center !== null) {
        for (const row of rows) {
          const line = num(row.line_value);
          if (line !== null && Math.abs(line - center) > 0.75) {
            totalOutliers.push({ matchup: matchup.get(Number(gameIdRaw)), center, ...row });
          }
        }
      }
    }
    if (market === "first_inning_total") {
      for (const row of rows) {
        const line = num(row.line_value);
        if (line !== null && line !== 0.5) firstInningNonHalfRun.push({ matchup: matchup.get(Number(gameIdRaw)), ...row });
      }
    }
  }

  const evaluatedOutliers: Row[] = [];
  for (const record of dry.proposed as unknown as Row[]) {
    const price = num(record.odds_american);
    if (price === null) continue;
    const market = dbMarket(record.market);
    const comparable = (grouped.get(`${record.game_id}::${market}`) ?? []).filter((row) =>
      row.side === record.side
      && num(row.odds_american) !== null
      && (market === "moneyline" || num(row.line_value) === num(record.line_value)),
    );
    const center = median(comparable.map((row) => implied(num(row.odds_american)!)));
    if (center === null) continue;
    const deviationPp = (implied(price) - center) * 100;
    if (Math.abs(deviationPp) > 5) {
      evaluatedOutliers.push({
        matchup: record.matchup,
        market: record.market,
        side: record.side,
        line: record.line_value,
        evaluatedPrice: price,
        comparableBooks: new Set(comparable.map((row) => row.sportsbook)).size,
        centerImpliedPct: Math.round(center * 10_000) / 100,
        deviationPp: Math.round(deviationPp * 100) / 100,
      });
    }
  }

  const newestLine = lines
    .map((row) => typeof row.fetched_at === "string" ? row.fetched_at : null)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  console.log(JSON.stringify({
    release: "mlb_odds_health_audit_2026_08_28_r71",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    slateDate,
    games: games.length,
    lineRows: lines.length,
    books: new Set(lines.map((row) => row.sportsbook)).size,
    newestLine,
    missingTwoSided,
    totalLineOutliersBeyondThreeQuarterRun: totalOutliers,
    firstInningNonHalfRunRows: firstInningNonHalfRun,
    evaluatedPriceOutliersBeyondFiveImpliedPp: evaluatedOutliers,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
