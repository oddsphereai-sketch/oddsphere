import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }

(async () => {
  const { buildSoccerDailyEdgeAdapted } = await import("../../lib/services/soccer/buildSoccerDailyEdgeAdapted");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const SLATE = "2026-06-12";
  const resp = await buildSoccerDailyEdgeAdapted(SLATE);
  console.log(`WC slate ${SLATE}: ${resp.games.length} games, slateState=${resp.slateState}`);

  // slot mapping: moneyline=match_result, total=total, first_inning=double_chance
  const slots: Array<{ slot: "moneyline"|"total"|"first_inning"; label: string }> = [
    { slot: "moneyline", label: "match_result" },
    { slot: "total", label: "total" },
    { slot: "first_inning", label: "double_chance" },
  ];

  console.log("\nsport | matchup | slot(market) | pick | DTO priceAmerican | DTO lineOpenAmerican | unavailable? | held");
  for (const g of resp.games) {
    const matchup = `${g.awayTeam} vs ${g.homeTeam}`;
    for (const s of slots) {
      const m = (g.markets as any)[s.slot];
      const price = m?.priceAmerican ?? null;
      const open = m?.lineOpenAmerican ?? null;
      const unavailable = price === null || open === null;
      console.log(`WC | ${matchup} | ${s.slot}(${s.label}) | ${m?.pick ?? "—"} | ${price ?? "null"} | ${open ?? "null"} | ${unavailable ? "YES" : "no"} | ${m?.held}`);
    }
  }

  // Inspect underlying soccer line_history coverage for openers
  const { data: games } = await sb.from("games").select("id, external_id, home_team_id, away_team_id").eq("sport","soccer").eq("slate_date",SLATE);
  const gameIds = (games??[]).map((g:any)=>g.id);
  const { data: preds } = await sb.from("prediction_records")
    .select("game_id, market, side, odds_american").eq("sport","soccer").eq("slate_date",SLATE);
  const { data: hist } = await sb.from("line_history")
    .select("game_id, market_type, side, odds_american, is_opener, recorded_at")
    .in("game_id", gameIds)
    .in("market_type", ["match_result","double_chance","total","btts"])
    .order("recorded_at", { ascending: true });
  console.log(`\nsoccer line_history rows for slate: ${(hist??[]).length}`);
  // openerMap per route logic
  const openerMap = new Map<string,number>();
  for (const r of (hist??[]) as any[]) { if(r.odds_american===null||r.side===null) continue; if(r.is_opener!==true) continue; const k=`${r.game_id}|${r.market_type}|${r.side}`; if(openerMap.has(k))continue; openerMap.set(k,r.odds_american); }
  for (const r of (hist??[]) as any[]) { if(r.odds_american===null||r.side===null) continue; const k=`${r.game_id}|${r.market_type}|${r.side}`; if(openerMap.has(k))continue; openerMap.set(k,r.odds_american); }
  console.log(`opener keys built: ${openerMap.size}`);

  // For each prediction_record, does a matching opener exist by (game,market,side)?
  console.log("\nprediction_records vs opener availability:");
  for (const p of (preds??[]) as any[]) {
    const k=`${p.game_id}|${p.market}|${p.side}`;
    const has = openerMap.has(k);
    console.log(`  game ${p.game_id} ${p.market} side=${p.side} odds_amer=${p.odds_american} → opener ${has?openerMap.get(k):"MISSING"}`);
  }

  // distinct markets present in soccer line_history
  const mkts = [...new Set((hist??[]).map((r:any)=>r.market_type))];
  console.log(`\nsoccer line_history distinct markets: ${mkts.join(", ") || "(none)"}`);
  const sides = [...new Set((hist??[]).map((r:any)=>`${r.market_type}:${r.side}`))];
  console.log(`soccer line_history market:side combos: ${sides.join(" | ") || "(none)"}`);
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
