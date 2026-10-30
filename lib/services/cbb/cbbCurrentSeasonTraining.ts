import type { supabase } from "@/lib/db/supabase";
import { CbbBallDontLieClient } from "@/lib/cbb/ballDontLie";
import { buildCbbTrainingGames, matchCbbVenue } from "@/lib/cbb/dataset";
import type { CbbTrainingGame } from "@/lib/cbb/types";
import { addDaysToSlate, computeSlateDate } from "@/lib/dates/slateDate";
import { fetchCbbDayEvents } from "./fetchCbbDayEvents";

export const CBB_CURRENT_TRAINING_RELEASE="cbb_current_training_2026_10_29_r1_exact_final_venues" as const;
type Receipt={release:typeof CBB_CURRENT_TRAINING_RELEASE;season:number;updatedAt:string;games:CbbTrainingGame[]};
const key=(season:number)=>`cbb::current-season-training::${season}`;
const isReceipt=(value:unknown,season:number):value is Receipt=>{
  if(!value||typeof value!=="object")return false;
  const row=value as Partial<Receipt>;
  return row.release===CBB_CURRENT_TRAINING_RELEASE&&row.season===season&&Array.isArray(row.games)&&
    row.games.every(g=>g.season===season&&Number.isSafeInteger(g.id)&&g.neutral!==null);
};
export async function readCbbCurrentTraining(season:number,db?:typeof supabase):Promise<Receipt|null>{
  const client=db??(await import("@/lib/db/supabase")).supabase;
  const {data,error}=await client.from("lab_response_snapshots").select("payload").eq("snapshot_key",key(season)).maybeSingle();
  if(error)throw new Error(`CBB training read failed: ${error.message}`);
  if(!data)return null;
  if(!isReceipt(data.payload,season))throw new Error("CBB current-season training receipt corrupt");
  return data.payload;
}

/** One leased daily writer accumulates exact final games with verified venues.
 * Missing boxes/venues remain absent and are retried on later daily cycles. */
export async function refreshCbbCurrentTraining(args:{season:number;anchorDate:string;apiKey:string;now:string;
  provider?:CbbBallDontLieClient;db?:typeof supabase;fetcher?:typeof fetch}){
  const db=args.db??(await import("@/lib/db/supabase")).supabase;
  const existing=await readCbbCurrentTraining(args.season,db);
  const provider=args.provider??new CbbBallDontLieClient(args.apiKey,{maxRequests:150});
  const dates=Array.from({length:7},(_,i)=>addDaysToSlate(args.anchorDate,i-6));
  const recent=await provider.gamesForDates(dates,args.season);
  const known=new Set(existing?.games.map(g=>g.id)??[]),now=Date.parse(args.now);
  const pending=recent.filter(game=>game.status==="post"&&game.status_state==="final"&&
    Date.parse(game.date)+6*60*60_000<=now&&!known.has(game.id));
  const venues=[];
  for(const day of [...new Set(pending.map(game=>computeSlateDate("cbb",game.date)))]){
    const evidence=await fetchCbbDayEvents(day,args.fetcher);
    for(const game of pending.filter(row=>computeSlateDate("cbb",row.date)===day)){
      const venue=matchCbbVenue(game,evidence.events,evidence.fetchedAt);
      if(venue?.timeConfirmed)venues.push(venue);
    }
  }
  const boxes=[];
  for(let i=0;i<pending.length;i+=25)boxes.push(...await provider.boxesForGameIds(pending.slice(i,i+25).map(g=>g.id),args.season));
  const built=buildCbbTrainingGames(pending,boxes,venues);
  const added=built.games.filter(g=>g.neutral!==null);
  const games=[...(existing?.games??[]),...added].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
  if(new Set(games.map(g=>g.id)).size!==games.length)throw new Error("CBB training game duplicated across receipts");
  const receipt:Receipt={release:CBB_CURRENT_TRAINING_RELEASE,season:args.season,updatedAt:args.now,games};
  if(added.length){
    const {error}=await db.from("lab_response_snapshots").upsert({snapshot_key:key(args.season),kind:"daily_edge",sport:"cbb",
      slate_date:null,payload:receipt,payload_version:CBB_CURRENT_TRAINING_RELEASE,source:"cbb_prediction_pipeline",
      generated_at:args.now,updated_at:args.now,expires_at:new Date(now+366*86_400_000).toISOString(),
      stale_until:new Date(now+366*86_400_000).toISOString()},{onConflict:"snapshot_key"});
    if(error)throw new Error(`CBB training write failed: ${error.message}`);
  }
  return {receipt,added:added.length,pending:pending.length,rejected:built.rejected,providerCalls:provider.calls};
}
