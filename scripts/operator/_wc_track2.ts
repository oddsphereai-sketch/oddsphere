import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:wc}=await sb.from("games").select("id,external_id,game_date").eq("sport","soccer").gte("game_date","2026-06-12T00:00:00Z").lte("game_date","2026-06-14T07:00:00Z");
  const gids=(wc??[]).map(r=>r.id);
  const {data:pr}=await sb.from("prediction_records").select("game_id,market,pick,result,graded_at,locked_at,play_grade,confidence").in("game_id",gids).order("game_id");
  console.log("=== WC prediction_records grading/tracking ===");
  for(const r of pr??[]) console.log(`g${r.game_id} ${r.market.padEnd(13)} pick=${String(r.pick).padEnd(10)} grade=${String(r.play_grade).padEnd(11)} result=${String(r.result).padEnd(6)} graded=${r.graded_at?"Y":"N"} locked=${r.locked_at?"Y":"N"}`);
  const gradedN=(pr??[]).filter(r=>r.graded_at).length, resN=(pr??[]).filter(r=>r.result&&r.result!=="null"&&r.result!==null).length;
  console.log(`\ntotal=${(pr??[]).length} graded_at set=${gradedN} result set=${resN}`);
  // route by date for soccer (does PAR@USA show under any date?)
  const {GET}=await import("../../app/api/lab/daily-edge/route");
  for(const d of ["2026-06-12","2026-06-13"]){const res=await GET(new Request(`https://x/api/lab/daily-edge?sport=soccer&date=${d}`));const b=await res.json() as any;const g=(b.games??b.cards??[]);console.log(`route soccer ${d}: ${g.length} games -> ${g.map((x:any)=>x.awayTeam+"@"+x.homeTeam).join(", ")}`);}
})().catch(e=>console.error("ERR",e?.message||e));
