/**
 * Full market-data chain audit for CZE @ KOR — end-to-end:
 *
 *   1. Internal DB: prediction_records, lines, line_history, sharp_signals
 *   2. Provider truth: BDL FIFA odds + SharpAPI WC odds + splits probe
 *   3. Per-market summary table (Daniel's required output format)
 *
 * Read-only.
 */
import { supabase } from "../../lib/db/supabase";
import { BallDontLieFifaProvider } from "../../lib/providers/real_api/BallDontLieFifaProvider";
import { BdlFifaClient } from "../../lib/providers/real_api/_bdlFifaClient";
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import { SharpApiSoccerOddsProvider } from "../../lib/providers/real_api/SharpApiSoccerOddsProvider";

const CZE_KOR_GAME_ID = 15721;
const CZE_KOR_BDL_MATCH_ID = 2;

async function main(): Promise<void> {
  // ── 1) prediction_records ───────────────────────────────────
  console.log("========== prediction_records (CZE@KOR) ==========");
  const { data: preds } = await supabase
    .from("prediction_records")
    .select("id, market, pick, side, line_value, odds_american, model_probability, market_probability, edge, confidence, play_grade, held, no_bet, hold_reason, no_bet_reason, locked_at, snapshot_json")
    .eq("game_id", CZE_KOR_GAME_ID);
  const predList = (preds ?? []) as Array<Record<string, unknown>>;
  for (const r of predList) {
    const sj = r.snapshot_json as Record<string, unknown> | null;
    const market = (sj?.market ?? null) as Record<string, unknown> | null;
    const splits = (sj?.splits ?? null) as Record<string, unknown> | null;
    console.log(`  pr.id=${r.id} market=${r.market} pick=${r.pick}`);
    console.log(`    model=${r.model_probability}  market=${r.market_probability}  edge=${r.edge}  confidence=${r.confidence}`);
    console.log(`    line=${r.line_value}  odds=${r.odds_american}  held=${r.held}  no_bet=${r.no_bet}`);
    console.log(`    hold_reason=${r.hold_reason}`);
    if (market !== null) console.log(`    snap.market = ${JSON.stringify(market).slice(0, 240)}`);
    if (splits !== null) console.log(`    snap.splits = ${JSON.stringify(splits).slice(0, 240)}`);
  }

  // ── 2) lines (+ line_history) ───────────────────────────────
  console.log("\n========== lines (rows for game_id=15721) ==========");
  const { data: lines } = await supabase
    .from("lines")
    .select("id, market_type, side, sportsbook, line_value, odds_american, captured_at, updated_at")
    .eq("game_id", CZE_KOR_GAME_ID);
  console.log(`  ${(lines ?? []).length} rows`);
  for (const l of ((lines ?? []) as Array<Record<string, unknown>>)) {
    console.log(`    ${l.market_type}/${l.side} ${l.sportsbook} line=${l.line_value} odds=${l.odds_american} cap=${l.captured_at}`);
  }

  console.log("\n========== line_history (rows for game_id=15721) ==========");
  const { data: lh } = await supabase
    .from("line_history")
    .select("id, market_type, side, sportsbook, line_value, odds_american, is_opener, captured_at")
    .eq("game_id", CZE_KOR_GAME_ID)
    .order("captured_at", { ascending: true });
  console.log(`  ${(lh ?? []).length} rows`);
  for (const l of ((lh ?? []) as Array<Record<string, unknown>>).slice(0, 8)) {
    console.log(`    ${l.market_type}/${l.side} ${l.sportsbook} line=${l.line_value} odds=${l.odds_american} opener=${l.is_opener} cap=${l.captured_at}`);
  }

  // ── 3) sharp_signals (public splits) ──────────────────────
  console.log("\n========== sharp_signals (CZE@KOR) ==========");
  const { data: ss } = await supabase
    .from("sharp_signals")
    .select("id, market, side, sportsbook, money_pct, bets_pct, line_value, odds_american, captured_at")
    .eq("game_id", CZE_KOR_GAME_ID)
    .order("captured_at", { ascending: false })
    .limit(10);
  console.log(`  ${(ss ?? []).length} rows`);
  for (const s of ((ss ?? []) as Array<Record<string, unknown>>)) {
    console.log(`    ${s.market}/${s.side} ${s.sportsbook} money=${s.money_pct}% bets=${s.bets_pct}% line=${s.line_value} odds=${s.odds_american} cap=${s.captured_at}`);
  }

  // ── 4) BDL FIFA truth ──────────────────────────────────────
  console.log("\n========== BDL FIFA odds for match_id=2 ==========");
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  if (!bdlKey) { console.log("  BALLDONTLIE_API_KEY missing"); }
  else {
    const bdl = new BallDontLieFifaProvider(new BdlFifaClient(bdlKey));
    try {
      const raw = await bdl.listRawOdds({ match_id: CZE_KOR_BDL_MATCH_ID, per_page: 25 });
      console.log(`  BDL returned ${raw.length} raw odds rows`);
      // Group by market_name + side
      const buckets = new Map<string, Array<Record<string, unknown>>>();
      for (const r of raw as unknown as Array<Record<string, unknown>>) {
        const key = `${r.market_name ?? "?"}/${r.outcome_label ?? r.side ?? "?"}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(r);
      }
      for (const [k, rows] of buckets) {
        const sample = rows[0];
        console.log(`    ${k}: ${rows.length} books, e.g. price=${sample.price_american ?? sample.american_odds ?? sample.odds_american} line=${sample.line ?? sample.line_value ?? sample.handicap ?? "—"} book=${sample.sportsbook_name ?? sample.bookmaker ?? "?"}`);
      }
    } catch (e) { console.log(`  ERR: ${(e as Error).message}`); }
  }

  // ── 5) SharpAPI truth ──────────────────────────────────────
  console.log("\n========== SharpAPI WC soccer odds (anchored to KOR/CZE) ==========");
  const sharpKey = process.env.SHARPAPI_KEY;
  if (!sharpKey) { console.log("  SHARPAPI_KEY missing"); }
  else {
    const sharp = new SharpApiSoccerOddsProvider(new SharpApiClient(sharpKey));
    try {
      const raw = await sharp.listRawOdds({ maxPages: 2, limit: 200 });
      // Filter to KOR/CZE-looking entries
      const cze_kor = raw.filter((r) => {
        const txt = JSON.stringify(r).toLowerCase();
        return txt.includes("kore") || txt.includes("czech");
      });
      console.log(`  SharpAPI total odds rows: ${raw.length}; CZE/KOR-matching: ${cze_kor.length}`);
      for (const r of cze_kor.slice(0, 8)) {
        console.log(`    ${JSON.stringify(r).slice(0, 250)}`);
      }
      // Splits probe
      const splits = await sharp.probeSplits();
      console.log(`  SharpAPI splits: classification=${splits.status.classification}  status=${splits.status.status}  rows=${splits.status.row_count}`);
    } catch (e) { console.log(`  ERR: ${(e as Error).message}`); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
