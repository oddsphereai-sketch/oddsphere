import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

// Replicates the route's BOOK_PRIORITY + pickPriceRow + opener logic
// closely enough to compute the DTO priceAmerican + lineOpenAmerican
// that buildMarketEdge WOULD produce for each MLB game x market.

const BOOK_PRIORITY = [
  "locked_snapshot", "pinnacle", "draftkings", "fanduel", "betmgm", "caesars",
  "bet365 us", "bookmaker", "ballybet", "onexbet", "saba", "fliff",
];

function pickPriceRow(rows: any[], preferredSide: string | null): any | null {
  if (rows.length === 0) return null;
  if (preferredSide === null) return null;
  const sideMatch = rows.filter((r) => r.side === preferredSide);
  const pool = sideMatch.length > 0 ? sideMatch : rows;
  for (const book of BOOK_PRIORITY) {
    const hit = pool.find((r) => r.sportsbook === book && r.odds_american !== null);
    if (hit) return hit;
  }
  return null;
}

(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const SLATE = "2026-06-12";

  // 1. Games on slate
  const { data: games } = await sb.from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, slate_date, slate_status")
    .eq("sport", "mlb").eq("slate_date", SLATE);
  const teamIds = [...new Set((games ?? []).flatMap((g: any) => [g.home_team_id, g.away_team_id]))];
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id", teamIds);
  const tm = new Map((teams ?? []).map((t: any) => [t.id, t.abbreviation]));
  const lbl = (g: any) => `${tm.get(g.away_team_id)}@${tm.get(g.home_team_id)}`;
  const gameIds = (games ?? []).map((g: any) => g.id);

  console.log(`MLB slate ${SLATE}: ${gameIds.length} games`);
  if (gameIds.length === 0) { process.exit(0); }

  // 2. game_predictions (picks)
  const { data: preds } = await sb.from("game_predictions")
    .select("game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi, locked_at, sport_specific")
    .in("game_id", gameIds);
  const predByGame = new Map((preds ?? []).map((p: any) => [p.game_id, p]));

  // 3. current lines
  const { data: lines } = await sb.from("lines")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total", "first_inning_total"])
    .is("player_id", null);
  const curByKey = new Map<string, any[]>();
  for (const r of (lines ?? []) as any[]) {
    const k = `${r.game_id}::${r.market_type}`;
    if (!curByKey.has(k)) curByKey.set(k, []);
    curByKey.get(k)!.push(r);
  }

  // 4. line_history openers — EXACT prod query (no .limit → PostgREST 1000-row cap)
  const { data: hist } = await sb.from("line_history")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, recorded_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total", "first_inning_total"])
    .is("player_id", null)
    .order("recorded_at", { ascending: true });
  console.log(`[prod-query] line_history returned ${(hist??[]).length} rows (cap=1000)`);
  const openByKey = new Map<string, any[]>();
  for (const r of (hist ?? []) as any[]) {
    const k = `${r.game_id}::${r.market_type}::${r.side ?? "null"}`;
    if (!openByKey.has(k)) openByKey.set(k, []);
    openByKey.get(k)!.push(r);
  }

  // 4b. CORRECTED openers — paginate so all rows are present (per-game fetch).
  const openByKeyFull = new Map<string, any[]>();
  for (const gid of gameIds) {
    const { data: h2 } = await sb.from("line_history")
      .select("game_id, market_type, sportsbook, side, odds_american, recorded_at")
      .eq("game_id", gid)
      .in("market_type", ["moneyline", "total", "first_inning_total"])
      .is("player_id", null)
      .order("recorded_at", { ascending: true });
    for (const r of (h2 ?? []) as any[]) {
      const k = `${r.game_id}::${r.market_type}::${r.side ?? "null"}`;
      if (!openByKeyFull.has(k)) openByKeyFull.set(k, []);
      openByKeyFull.get(k)!.push(r);
    }
  }

  // 5. locked prediction_records (the snapshot override)
  const { data: lockedRecs } = await sb.from("prediction_records")
    .select("game_id, market, pick, side, line_value, odds_american, locked_at, snapshot_json")
    .eq("sport", "mlb").eq("slate_date", SLATE)
    .in("market", ["moneyline", "total", "first_inning"])
    .not("locked_at", "is", null);
  const lockedByGM = new Map<string, any>();
  for (const r of (lockedRecs ?? []) as any[]) lockedByGM.set(`${r.game_id}::${r.market}`, r);

  // Replicate route's locked-snapshot injection into current lines (lines 3696-3744)
  for (const r of lockedByGM.values()) {
    const sj = r.snapshot_json as any;
    const linesAtLock = sj?.lines_at_lock;
    if (Array.isArray(linesAtLock)) {
      for (const market of ["moneyline", "total"]) curByKey.delete(`${r.game_id}::${market}`);
      for (const lr of linesAtLock) {
        const k = `${lr.game_id}::${lr.market_type}`;
        if (!curByKey.has(k)) curByKey.set(k, []);
        curByKey.get(k)!.push({ ...lr });
      }
    }
  }
  // (c) inject locked odds — NOTE: route uses market_type: r.market verbatim
  for (const r of lockedByGM.values()) {
    if (r.odds_american === null || r.side === null) continue;
    const k = `${r.game_id}::${r.market}`; // <-- "first_inning" NOT "first_inning_total"
    const lockedRow = { game_id: r.game_id, market_type: r.market, sportsbook: "locked_snapshot", side: r.side, line_value: r.line_value, odds_american: r.odds_american, fetched_at: r.locked_at };
    if (!curByKey.has(k)) curByKey.set(k, []);
    curByKey.get(k)!.unshift(lockedRow);
  }

  const markets: Array<{ dto: string; dbCur: string; sideOf: (p: any) => string | null }> = [
    { dto: "moneyline", dbCur: "moneyline", sideOf: (p) => p?.predicted_ml_winner ?? null },
    { dto: "total", dbCur: "total", sideOf: (p) => p?.predicted_ou_side ?? null },
    { dto: "first_inning", dbCur: "first_inning_total", sideOf: (p) => (p?.predicted_nrfi === null ? null : p.predicted_nrfi ? "under" : "over") },
  ];

  console.log("\nsport | matchup | market | side | odds_amer(PR) | curLines? | hist-opener? | DTO priceAmerican | DTO lineOpenAmerican | unavailable? | rootcause");
  for (const g of games as any[]) {
    const pred = predByGame.get(g.id);
    const locked = pred?.locked_at != null;
    for (const mk of markets) {
      const side = mk.sideOf(pred);
      const lockedRec = lockedByGM.get(`${g.id}::${mk.dto}`);

      // ---- compute DTO priceAmerican exactly like buildMarketEdge ----
      const curRows = curByKey.get(`${g.id}::${mk.dbCur}`) ?? [];
      const priceRow = pickPriceRow(curRows, side);
      const priceAmerican = priceRow?.odds_american ?? null;

      // ---- compute DTO lineOpenAmerican ----
      const candKey = `${g.id}::${mk.dbCur}::${side ?? "null"}`;
      const candidates = openByKey.get(candKey) ?? [];
      let liveOpen: number | null = null;
      if (priceRow) {
        const found = candidates.find((c) => c.sportsbook === priceRow.sportsbook);
        liveOpen = found?.odds_american ?? null;
      }
      const lm = (lockedRec?.snapshot_json as any)?.line_movement;
      const lockedOpen = locked ? (lm?.open_odds_american ?? null) : null;
      const lineOpenAmerican = liveOpen ?? lockedOpen;

      // corrected (full history) open
      const candidatesFull = openByKeyFull.get(candKey) ?? [];
      let liveOpenFull: number | null = null;
      if (priceRow) liveOpenFull = candidatesFull.find((c)=>c.sportsbook===priceRow.sportsbook)?.odds_american ?? null;
      const fixedOpen = liveOpenFull ?? lockedOpen;

      const prOdds = lockedRec?.odds_american ?? "(no PR)";
      const unavailable = priceAmerican === null || lineOpenAmerican === null;
      if (unavailable && lineOpenAmerican === null && priceRow) {
        console.error(`  DEBUG ${lbl(g)} ${mk.dto}: priceRow.book=${priceRow.sportsbook} candKey=${candKey} candBooks=[${candidates.map((c)=>c.sportsbook).join(",")}]`);
      }

      // root cause classification
      let rc = "OK";
      if (unavailable) {
        if (priceAmerican === null && lineOpenAmerican === null) {
          if (curRows.length === 0 && candidates.length === 0) rc = "(a) no current+no opener data";
          else if (curRows.length === 0) rc = "(d) no current price (locked? key?)";
          else rc = "(c?) price+opener null despite rows (side mismatch?)";
        } else if (priceAmerican === null) {
          rc = curRows.length === 0
            ? (mk.dto === "first_inning" ? "(d/f) FI current price missing - check key 'first_inning' vs 'first_inning_total'" : "(d) no current price")
            : "(c) current rows exist but pickPriceRow null (book/side)";
        } else { // lineOpenAmerican null only
          if (candidates.length === 0) rc = "(a) no opener in line_history for this side";
          else if (priceRow && !candidates.some((c) => c.sportsbook === priceRow.sportsbook)) rc = "(b/c) opener exists but NOT at current book (cross-book filter nulls it)";
          else rc = "(a) opener null";
        }
      }
      const wouldFlip = unavailable && priceAmerican !== null && lineOpenAmerican === null && fixedOpen !== null;
      console.log(`MLB | ${lbl(g)} | ${mk.dto} | ${side ?? "—"} | ${prOdds} | ${curRows.length} | ${candidates.length} | ${priceAmerican ?? "null"} | ${lineOpenAmerican ?? "null"} | ${unavailable ? "YES" : "no"} | fixedOpen=${fixedOpen ?? "null"}${wouldFlip ? " [ROWCAP→fixable]" : ""} | ${rc}`);
    }
  }

  // Structural FI check: does line_history / lines carry first_inning_total at all?
  const fiCur = (lines ?? []).filter((r: any) => r.market_type === "first_inning_total");
  const fiHist = (hist ?? []).filter((r: any) => r.market_type === "first_inning_total");
  console.log(`\nFI structural: lines(first_inning_total)=${fiCur.length} rows, line_history(first_inning_total)=${fiHist.length} rows across slate`);
  const totCur = (lines ?? []).filter((r: any) => r.market_type === "total");
  const totHist = (hist ?? []).filter((r: any) => r.market_type === "total");
  console.log(`TOTAL structural: lines(total)=${totCur.length} rows, line_history(total)=${totHist.length} rows`);
  const mlHist = (hist ?? []).filter((r: any) => r.market_type === "moneyline");
  console.log(`ML structural: line_history(moneyline)=${mlHist.length} rows`);

  // sample locked FI snapshot line_movement
  for (const r of lockedByGM.values()) {
    if (r.market === "first_inning") {
      const lm = (r.snapshot_json as any)?.line_movement;
      console.log(`FI locked sample game ${r.game_id}: odds_american=${r.odds_american} side=${r.side} line_movement=${JSON.stringify(lm ?? null)}`);
      break;
    }
  }
})().then(() => process.exit(0)).catch((e) => { console.error("ERR", e); process.exit(1); });
