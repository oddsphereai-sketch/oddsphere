/**
 * All-model source + locking readiness audit (READ-ONLY).
 *
 * Gives operators one slate-level view of whether each sport has the minimum
 * plumbing needed for a trustworthy betting card:
 *   - scheduled/final games
 *   - current line rows by market
 *   - public split rows by market
 *   - prediction_records by market
 *   - locked records
 *   - records missing odds/line values
 *
 * No writes. No provider calls. DB snapshot only.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-all-model-readiness.ts
 *   npx tsx --env-file=.env.local scripts/operator/audit-all-model-readiness.ts --date 2026-06-24 --json
 */

import { supabase } from "../../lib/db/supabase";
import { readBoolFlag, readStringFlag, todayUTC } from "./_cliCommon";

type Sport = "mlb" | "wnba" | "soccer" | "nba" | "nhl";

const SPORTS: readonly Sport[] = ["mlb", "wnba", "soccer", "nba", "nhl"];

const EXPECTED_MARKETS: Record<Sport, readonly string[]> = {
  mlb: ["moneyline", "total", "first_inning"],
  wnba: ["moneyline", "total", "spread"],
  soccer: ["match_result", "total", "btts", "double_chance"],
  nba: ["moneyline", "total"],
  nhl: ["moneyline", "total"],
};

const LINE_MARKETS: Record<Sport, readonly string[]> = {
  mlb: ["moneyline", "total", "first_inning_total"],
  wnba: ["moneyline", "total", "spread"],
  soccer: ["match_result", "total", "btts", "double_chance"],
  nba: ["moneyline", "total", "spread"],
  nhl: ["moneyline", "total", "puckline"],
};

type CountByMarket = Record<string, number>;

type SportReport = {
  sport: Sport;
  date: string;
  games: {
    total: number;
    scheduled: number;
    final: number;
    other: number;
  };
  linesByMarket: CountByMarket;
  publicSplitsByMarket: CountByMarket;
  predictionRecordsByMarket: CountByMarket;
  expectedMarketsMissingRecords: string[];
  records: {
    total: number;
    locked: number;
    missingOdds: number;
    missingLineValue: number;
    held: number;
    noBet: number;
  };
  notes: string[];
};

type DbGame = {
  id: number;
  status: string | null;
};

type DbMarketRow = {
  market_type?: string | null;
  market?: string | null;
};

type DbSignalRow = {
  market_type: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
};

type DbRecordRow = {
  market: string | null;
  locked_at: string | null;
  odds_american: number | null;
  line_value: number | null;
  held: boolean | null;
  no_bet: boolean | null;
};

function inc(map: CountByMarket, key: string | null | undefined): void {
  const k = key ?? "unknown";
  map[k] = (map[k] ?? 0) + 1;
}

function countMarkets(rows: readonly DbMarketRow[], key: "market_type" | "market"): CountByMarket {
  const out: CountByMarket = {};
  for (const r of rows) inc(out, r[key]);
  return out;
}

function formatCounts(counts: CountByMarket): string {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([k, v]) => `${k}:${v}`).join(", ") : "-";
}

async function auditSport(sport: Sport, date: string): Promise<SportReport> {
  const { data: gamesRaw, error: gamesErr } = await supabase
    .from("games")
    .select("id,status")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (gamesErr) throw new Error(`${sport} games query failed: ${gamesErr.message}`);
  const games = (gamesRaw ?? []) as DbGame[];
  const gameIds = games.map((g) => g.id);

  const notes: string[] = [];
  if (gameIds.length === 0) {
    return {
      sport,
      date,
      games: { total: 0, scheduled: 0, final: 0, other: 0 },
      linesByMarket: {},
      publicSplitsByMarket: {},
      predictionRecordsByMarket: {},
      expectedMarketsMissingRecords: [...EXPECTED_MARKETS[sport]],
      records: { total: 0, locked: 0, missingOdds: 0, missingLineValue: 0, held: 0, noBet: 0 },
      notes: ["no games on slate"],
    };
  }

  const { data: linesRaw, error: linesErr } = await supabase
    .from("lines")
    .select("market_type")
    .in("game_id", gameIds)
    .in("market_type", [...LINE_MARKETS[sport]]);
  if (linesErr) notes.push(`lines query failed: ${linesErr.message}`);

  const { data: sigRaw, error: sigErr } = await supabase
    .from("sharp_signals")
    .select("market_type,public_betting_pct,public_money_pct")
    .in("game_id", gameIds);
  if (sigErr) notes.push(`sharp_signals query failed: ${sigErr.message}`);

  const { data: prRaw, error: prErr } = await supabase
    .from("prediction_records")
    .select("market,locked_at,odds_american,line_value,held,no_bet")
    .eq("sport", sport)
    .eq("slate_date", date);
  if (prErr) notes.push(`prediction_records query failed: ${prErr.message}`);

  const records = (prRaw ?? []) as DbRecordRow[];
  const predictionRecordsByMarket = countMarkets(records, "market");
  const expectedMarketsMissingRecords = EXPECTED_MARKETS[sport].filter(
    (market) => (predictionRecordsByMarket[market] ?? 0) === 0
  );

  const publicSplitsByMarket: CountByMarket = {};
  for (const s of (sigRaw ?? []) as DbSignalRow[]) {
    if (s.public_betting_pct !== null || s.public_money_pct !== null) inc(publicSplitsByMarket, s.market_type);
  }

  const scheduled = games.filter((g) => g.status === "scheduled").length;
  const final = games.filter((g) => g.status === "final").length;

  if (sport === "soccer") notes.push("World Cup/soccer public splits are not expected unless provider coverage is verified.");
  if (sport === "wnba") notes.push("WNBA total/spread fallback may have line values without odds when Playbook fills a SharpAPI market gap.");
  if (sport === "mlb") notes.push("MLB public splits are model-impacting; dual-source promotion must stay gated by outcome validation.");

  return {
    sport,
    date,
    games: {
      total: games.length,
      scheduled,
      final,
      other: games.length - scheduled - final,
    },
    linesByMarket: countMarkets((linesRaw ?? []) as DbMarketRow[], "market_type"),
    publicSplitsByMarket,
    predictionRecordsByMarket,
    expectedMarketsMissingRecords,
    records: {
      total: records.length,
      locked: records.filter((r) => r.locked_at !== null).length,
      missingOdds: records.filter((r) => r.odds_american === null).length,
      missingLineValue: records.filter((r) => r.market !== "moneyline" && r.line_value === null).length,
      held: records.filter((r) => r.held === true).length,
      noBet: records.filter((r) => r.no_bet === true).length,
    },
    notes,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    console.error("READ-ONLY. --write is not supported.");
    process.exit(1);
  }
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  const json = readBoolFlag(argv, "--json");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid --date "${date}". Expected YYYY-MM-DD.`);

  const reports = await Promise.all(SPORTS.map((sport) => auditSport(sport, date)));
  const out = { generatedAt: new Date().toISOString(), readOnly: true, date, reports };

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`[audit-all-model-readiness] date=${date} mode=READ-ONLY`);
  for (const r of reports) {
    console.log(`\n${r.sport.toUpperCase()}`);
    console.log(`  games: total=${r.games.total} scheduled=${r.games.scheduled} final=${r.games.final} other=${r.games.other}`);
    console.log(`  lines: ${formatCounts(r.linesByMarket)}`);
    console.log(`  public splits: ${formatCounts(r.publicSplitsByMarket)}`);
    console.log(`  prediction_records: ${formatCounts(r.predictionRecordsByMarket)}`);
    console.log(
      `  records: total=${r.records.total} locked=${r.records.locked} ` +
      `missingOdds=${r.records.missingOdds} missingLine=${r.records.missingLineValue} held=${r.records.held} noBet=${r.records.noBet}`
    );
    console.log(`  expected markets missing records: ${r.expectedMarketsMissingRecords.join(", ") || "-"}`);
    for (const note of r.notes) console.log(`  note: ${note}`);
  }
  console.log("\n✓ Read-only audit complete. No writes.");
}

main().catch((e) => {
  console.error(`FATAL: ${(e as Error).message}`);
  process.exit(2);
});
