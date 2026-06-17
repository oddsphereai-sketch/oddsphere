import { readFileSync } from "node:fs";
const e = readFileSync(".env.local", "utf8");
for (const l of e.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
process.env.PRODUCTION_DATA_MODE = process.env.PRODUCTION_DATA_MODE ?? "true";
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: g } = await sb.from("games").select("id,external_id").eq("sport", "soccer").in("external_id", [5, 6, 7]);
  const byExt = new Map((g ?? []).map((r) => [r.id, r.external_id]));
  const ids = (g ?? []).map((r) => r.id);
  const { data: pr } = await sb.from("prediction_records").select("game_id,market,pick,play_grade,confidence,edge,no_bet,best_angle,snapshot_json").in("game_id", ids).order("game_id");
  console.log(`WC prediction_records for ext 5/6/7: ${(pr ?? []).length}`);
  let nan = 0, ba = 0;
  for (const r of pr ?? []) {
    const sp = (r.snapshot_json ?? {}) as any;
    const rs = sp?.model?.rating_source ?? "—";
    const edgeNum = typeof r.edge === "number" ? r.edge : null;
    if (edgeNum !== null && !Number.isFinite(edgeNum)) nan++;
    if (r.best_angle) ba++;
    console.log(`ext${byExt.get(r.game_id)} ${r.market.padEnd(13)} pick=${String(r.pick).padEnd(11)} grade=${String(r.play_grade).padEnd(12)} edge=${edgeNum != null ? edgeNum.toFixed(1) : "—"} no_bet=${r.no_bet} BA=${r.best_angle} rating_src=${rs}`);
  }
  console.log(`\nNaN edges=${nan} · Best Angles=${ba}`);
  // route output
  const { GET } = await import("../../app/api/lab/daily-edge/route");
  const res = await GET(new Request("https://x/api/lab/daily-edge?sport=soccer&date=2026-06-13"));
  const b = await res.json() as any; const gm = (b.games ?? b.cards ?? []);
  console.log(`\nroute soccer 2026-06-13: HTTP=${res.status} games=${gm.length} -> ${gm.map((x: any) => x.awayTeam + "@" + x.homeTeam).join(", ")}`);
})().catch((e) => console.error("ERR", e?.message || e));
