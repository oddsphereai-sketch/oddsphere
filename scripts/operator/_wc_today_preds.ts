import { readFileSync } from "node:fs";
const e = readFileSync(".env.local", "utf8");
for (const l of e.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
process.env.PRODUCTION_DATA_MODE = process.env.PRODUCTION_DATA_MODE ?? "true";
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: g } = await sb.from("games").select("id,external_id").eq("sport", "soccer").in("external_id", [5, 6, 7]);
  const ids = (g ?? []).map((r) => r.id);
  const { data: pr } = await sb.from("prediction_records").select("game_id,market,pick,play_grade,confidence,model_probability,market_probability,edge,no_bet").in("game_id", ids).order("game_id");
  console.log(`today's WC predictions: ${(pr ?? []).length}`);
  for (const r of pr ?? []) {
    const edge = r.edge != null ? (r.edge * 100).toFixed(1) : (r.model_probability != null && r.market_probability != null ? ((r.model_probability - r.market_probability) * 100).toFixed(1) : "—");
    console.log(`g${r.game_id} ${r.market.padEnd(13)} pick=${String(r.pick).padEnd(11)} grade=${String(r.play_grade).padEnd(13)} conf=${r.confidence} model=${r.model_probability != null ? (r.model_probability * 100).toFixed(0) + "%" : "—"} mkt=${r.market_probability != null ? (r.market_probability * 100).toFixed(0) + "%" : "—"} edge=${edge}pp no_bet=${r.no_bet}`);
  }
  const { GET } = await import("../../app/api/lab/daily-edge/route");
  const res = await GET(new Request("https://x/api/lab/daily-edge?sport=soccer&date=2026-06-13"));
  const b = await res.json() as any; const gm = (b.games ?? b.cards ?? []);
  console.log(`\nroute soccer 2026-06-13: HTTP=${res.status} games=${gm.length} -> ${gm.map((x: any) => x.awayTeam + "@" + x.homeTeam).join(", ")}`);
})().catch((e) => console.error("ERR", e?.message || e));
