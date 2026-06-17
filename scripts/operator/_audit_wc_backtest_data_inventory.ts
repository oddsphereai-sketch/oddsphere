/**
 * READ-ONLY — WC backtest data inventory.
 *
 * Pure SELECT audit. Counts historical soccer data available for
 * backtesting the World Cup model. NO WRITES.
 *
 * Usage: npx tsx scripts/operator/_audit_wc_backtest_data_inventory.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m === null) continue;
  if (!(m[1] in process.env)) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const SOCCER_SPORTS = ["soccer", "ucl"];
const SOCCER_MARKETS = ["match_result", "double_chance", "total", "btts"];

function hr(label: string): void {
  console.log("\n" + "=".repeat(72));
  console.log(label);
  console.log("=".repeat(72));
}

async function count(table: string, build: (q: any) => any): Promise<number | string> {
  const { count: c, error } = await build(
    supabase.from(table).select("*", { count: "exact", head: true }),
  );
  if (error) return `ERR: ${error.message}`;
  return c ?? 0;
}

async function main(): Promise<void> {
  console.log("READ-ONLY WC BACKTEST DATA INVENTORY");

  // ─── 1. SOCCER GAMES ──────────────────────────────────────────────
  hr("1. SOCCER GAMES (games table)");
  const totalGames = await count("games", (q) => q.in("sport", SOCCER_SPORTS));
  console.log(`Total games sport in (${SOCCER_SPORTS.join(",")}): ${totalGames}`);

  // pull all soccer games (small table expected) to inspect fields
  const { data: gamesData, error: gErr } = await supabase
    .from("games")
    .select("id, sport, game_date, slate_date, status, home_score, away_score, home_team_id, away_team_id, external_id")
    .in("sport", SOCCER_SPORTS)
    .order("game_date", { ascending: true });
  if (gErr) {
    console.log("games select error:", gErr.message);
  } else {
    const games = gamesData ?? [];
    console.log(`Rows pulled: ${games.length}`);
    const withScores = games.filter((g: any) => g.home_score !== null && g.away_score !== null);
    console.log(`With non-null home_score AND away_score: ${withScores.length}`);
    const statusCounts = new Map<string, number>();
    for (const g of games) statusCounts.set(String(g.status), (statusCounts.get(String(g.status)) ?? 0) + 1);
    console.log("Status distribution:", Object.fromEntries(statusCounts));
    const finalWithScores = games.filter(
      (g: any) => g.home_score !== null && g.away_score !== null && String(g.status).toLowerCase().includes("final"),
    );
    console.log(`status~final AND both scores present: ${finalWithScores.length}`);
    if (games.length > 0) {
      const dates = games.map((g: any) => g.game_date).filter(Boolean).sort();
      console.log(`game_date range: ${dates[0]} .. ${dates[dates.length - 1]}`);
      const sportCounts = new Map<string, number>();
      for (const g of games) sportCounts.set(String(g.sport), (sportCounts.get(String(g.sport)) ?? 0) + 1);
      console.log("by sport:", Object.fromEntries(sportCounts));
      // slate_date distribution (how many distinct slates)
      const slates = new Set(games.map((g: any) => g.slate_date));
      console.log(`distinct slate_date count: ${slates.size}; values:`, [...slates].sort().slice(0, 40));
    }
  }

  // ─── 2. ODDS HISTORY ──────────────────────────────────────────────
  hr("2. ODDS HISTORY (lines / line_history for soccer markets)");
  // Need soccer game ids
  const { data: soccerGameIdRows } = await supabase
    .from("games")
    .select("id")
    .in("sport", SOCCER_SPORTS);
  const soccerGameIds = (soccerGameIdRows ?? []).map((r: any) => r.id);
  console.log(`soccer game ids: ${soccerGameIds.length}`);

  for (const tbl of ["lines", "line_history"]) {
    console.log(`\n-- ${tbl} --`);
    // total rows for soccer markets restricted to soccer games (chunk the IN if large)
    const chunkSize = 200;
    let totalForSoccer = 0;
    const perMarket = new Map<string, number>();
    let minTs: string | null = null;
    let maxTs: string | null = null;
    const tsCol = tbl === "line_history" ? "recorded_at" : "created_at";
    for (let i = 0; i < soccerGameIds.length; i += chunkSize) {
      const chunk = soccerGameIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from(tbl)
        .select(`game_id, market_type, ${tsCol}`)
        .in("game_id", chunk)
        .in("market_type", SOCCER_MARKETS);
      if (error) {
        console.log(`  ${tbl} error:`, error.message);
        break;
      }
      for (const row of data ?? []) {
        totalForSoccer++;
        perMarket.set(String(row.market_type), (perMarket.get(String(row.market_type)) ?? 0) + 1);
        const ts = (row as any)[tsCol];
        if (ts) {
          if (minTs === null || ts < minTs) minTs = ts;
          if (maxTs === null || ts > maxTs) maxTs = ts;
        }
      }
    }
    console.log(`  total soccer-market rows: ${totalForSoccer}`);
    console.log(`  per market:`, Object.fromEntries(perMarket));
    console.log(`  ${tsCol} range: ${minTs} .. ${maxTs}`);
  }

  // ─── 3. PREDICTION HISTORY ────────────────────────────────────────
  hr("3. PREDICTION HISTORY (prediction_records / prediction_grades for soccer)");
  // prediction_records by sport
  const predTotalBySport = await count("prediction_records", (q) => q.in("sport", SOCCER_SPORTS));
  console.log(`prediction_records sport in (${SOCCER_SPORTS.join(",")}): ${predTotalBySport}`);

  const { data: predRows, error: predErr } = await supabase
    .from("prediction_records")
    .select("id, sport, market, game_id, created_at, result, status, slate_date")
    .in("sport", SOCCER_SPORTS)
    .order("created_at", { ascending: true });
  if (predErr) {
    console.log("prediction_records select error (trying without status/result cols):", predErr.message);
    const { data: predRows2, error: predErr2 } = await supabase
      .from("prediction_records")
      .select("id, sport, market, game_id, created_at")
      .in("sport", SOCCER_SPORTS);
    if (predErr2) console.log("  fallback error:", predErr2.message);
    else console.log(`  prediction_records soccer rows (minimal cols): ${(predRows2 ?? []).length}`);
  } else {
    const rows = predRows ?? [];
    console.log(`prediction_records soccer rows: ${rows.length}`);
    if (rows.length > 0) {
      const dates = rows.map((r: any) => r.created_at).filter(Boolean).sort();
      console.log(`created_at range: ${dates[0]} .. ${dates[dates.length - 1]}`);
      const mkt = new Map<string, number>();
      for (const r of rows) mkt.set(String(r.market), (mkt.get(String(r.market)) ?? 0) + 1);
      console.log("by market:", Object.fromEntries(mkt));
      const res = new Map<string, number>();
      for (const r of rows) res.set(String((r as any).result), (res.get(String((r as any).result)) ?? 0) + 1);
      console.log("by result:", Object.fromEntries(res));
      const st = new Map<string, number>();
      for (const r of rows) st.set(String((r as any).status), (st.get(String((r as any).status)) ?? 0) + 1);
      console.log("by status:", Object.fromEntries(st));
      const slates = new Set(rows.map((r: any) => r.slate_date));
      console.log("distinct slate_date:", [...slates].sort());
    }
  }

  // prediction_grades table (if exists)
  console.log("\n-- prediction_grades --");
  const { data: gradeProbe, error: gradeErr } = await supabase
    .from("prediction_grades")
    .select("*", { count: "exact", head: true });
  if (gradeErr) {
    console.log("prediction_grades table error/absent:", gradeErr.message);
  } else {
    console.log("prediction_grades exists. Probing soccer linkage...");
    // try a small select to inspect columns
    const { data: sample } = await supabase.from("prediction_grades").select("*").limit(1);
    console.log("sample columns:", sample && sample[0] ? Object.keys(sample[0]) : "(empty)");
  }

  // ─── 3b. prediction_grades joined to soccer prediction_records ────
  hr("3b. prediction_grades joined to soccer prediction_records");
  const { data: prIdRows } = await supabase
    .from("prediction_records")
    .select("id")
    .in("sport", SOCCER_SPORTS);
  const prIds = (prIdRows ?? []).map((r: any) => r.id);
  console.log(`soccer prediction_record ids: ${prIds.length}`);
  if (prIds.length > 0) {
    const { data: pg, error: pgErr } = await supabase
      .from("prediction_grades")
      .select("id, prediction_record_id, market, result, win, loss, push, void, pending, graded_at, actual_home_score, actual_away_score")
      .in("prediction_record_id", prIds);
    if (pgErr) console.log("prediction_grades join error:", pgErr.message);
    else {
      console.log(`prediction_grades rows for soccer preds: ${(pg ?? []).length}`);
      const resCounts = new Map<string, number>();
      for (const g of pg ?? []) resCounts.set(String(g.result), (resCounts.get(String(g.result)) ?? 0) + 1);
      console.log("grade result dist:", Object.fromEntries(resCounts));
      if (pg && pg[0]) console.log("sample grade row:", JSON.stringify(pg[0]));
    }
  }

  // ─── 3c. games detail (the in_progress / scored soccer rows) ──────
  hr("3c. soccer games detail");
  const { data: gd } = await supabase
    .from("games")
    .select("id, sport, status, home_score, away_score, game_date, slate_date, external_id")
    .in("sport", SOCCER_SPORTS)
    .order("game_date");
  console.log(JSON.stringify(gd, null, 1));

  // ─── 6. SUMMARY ───────────────────────────────────────────────────
  hr("INVENTORY COMPLETE — read-only, no writes performed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
