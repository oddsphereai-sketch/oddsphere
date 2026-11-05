import type { supabase } from "@/lib/db/supabase";
import { CbbBallDontLieClient } from "@/lib/cbb/ballDontLie";
import { buildCbbTrainingGames } from "@/lib/cbb/dataset";
import { matchCbbProviderVenue as matchCbbVenue } from "@/lib/cbb/providerVenueIdentity";
import type { CbbTrainingGame } from "@/lib/cbb/types";
import { addDaysToSlate, computeSlateDate } from "@/lib/dates/slateDate";
import { fetchCbbDayEvents } from "./fetchCbbDayEvents";
import {cbbDivisionOneFixture,cbbDivisionOneTeamIds} from "@/lib/cbb/divisionOneMembership";
import {cbbOfficialD1FixtureContext} from "@/lib/cbb/crossDivisionIdentity";
import type {CrossDivisionGame} from "@/lib/cbb/crossDivisionPrior";

export const CBB_CURRENT_TRAINING_RELEASE="cbb_current_training_2026_11_05_r4_separate_cross_division_receipts" as const;
type Receipt={release:typeof CBB_CURRENT_TRAINING_RELEASE|"cbb_current_training_2026_11_03_r3_new_orleans_venue_identity"|"cbb_current_training_2026_11_02_r2_provider_venue_identity"|"cbb_current_training_2026_10_29_r1_exact_final_venues";season:number;updatedAt:string;games:CbbTrainingGame[];crossDivisionGames?:CrossDivisionGame[]};
const key=(season:number)=>`cbb::current-season-training::${season}`;
const isReceipt=(value:unknown,season:number):value is Receipt=>{
  if(!value||typeof value!=="object")return false;
  const row=value as Partial<Receipt>;
  if(row.release===CBB_CURRENT_TRAINING_RELEASE){
    const d1=cbbDivisionOneTeamIds(season),core=row.games,cross=row.crossDivisionGames??[];
    if(!Array.isArray(core)||!Array.isArray(cross)||core.some(g=>!d1.has(g.homeId)||!d1.has(g.awayId))||
      cross.some(g=>!d1.has(g.divisionOneId)||d1.has(g.opponentId))||
      new Set([...core,...cross].map(g=>g.id)).size!==core.length+cross.length)return false;
  }
  return (row.release===CBB_CURRENT_TRAINING_RELEASE||row.release==="cbb_current_training_2026_11_03_r3_new_orleans_venue_identity"||row.release==="cbb_current_training_2026_11_02_r2_provider_venue_identity"||row.release==="cbb_current_training_2026_10_29_r1_exact_final_venues")&&row.season===season&&Array.isArray(row.games)&&
    row.games.every(g=>g.season===season&&Number.isSafeInteger(g.id)&&g.neutral!==null)&&
    (row.crossDivisionGames===undefined||Array.isArray(row.crossDivisionGames)&&row.crossDivisionGames.every(g=>
      g.season===season&&Number.isSafeInteger(g.id)&&g.neutral!==null&&g.divisionOneId!==g.opponentId&&
      [g.homeId,g.awayId].includes(g.divisionOneId)&&[g.homeId,g.awayId].includes(g.opponentId)));
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
  const known=new Set([...(existing?.games??[]),...(existing?.crossDivisionGames??[])].map(g=>g.id)),now=Date.parse(args.now);
  const pending=recent.filter(game=>game.status==="post"&&game.status_state==="final"&&
    Date.parse(game.date)+6*60*60_000<=now&&!known.has(game.id));
  const venues=[];
  for(const day of [...new Set(pending.map(game=>computeSlateDate("cbb",game.date)))]){
    const evidence=await fetchCbbDayEvents(day,args.fetcher);
    for(const game of pending.filter(row=>computeSlateDate("cbb",row.date)===day)){
      const venue=matchCbbVenue(game,evidence.events,evidence.fetchedAt)??cbbOfficialD1FixtureContext(game,evidence.events,evidence.fetchedAt);
      if(venue?.timeConfirmed)venues.push({...venue,gameId:game.id});
    }
  }
  const boxes=[];
  for(let i=0;i<pending.length;i+=25)boxes.push(...await provider.boxesForGameIds(pending.slice(i,i+25).map(g=>g.id),args.season));
  const divisionOneTeamIds=cbbDivisionOneTeamIds(args.season);
  const built=buildCbbTrainingGames(pending.filter(g=>{const d=cbbDivisionOneFixture(g);return d.home&&d.away;}),boxes,venues,{divisionOneTeamIds});
  const crossBuilt=buildCbbTrainingGames(pending.filter(g=>cbbDivisionOneFixture(g).crossDivision),boxes,venues,{divisionOneTeamIds,includeLowerDivisionOpponents:true});
  const added=built.games.filter(g=>g.neutral!==null);
  const addedCross=crossBuilt.games.filter(g=>g.neutral!==null).map(g=>{
    const raw=pending.find(row=>row.id===g.id)!,homeD1=cbbDivisionOneFixture(raw).home;
    return {...g,divisionOneId:homeD1?g.homeId:g.awayId,opponentId:homeD1?g.awayId:g.homeId};
  });
  const games=[...(existing?.games??[]),...added].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
  if(new Set(games.map(g=>g.id)).size!==games.length)throw new Error("CBB training game duplicated across receipts");
  const crossDivisionGames=[...(existing?.crossDivisionGames??[]),...addedCross].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
  if(new Set([...games,...crossDivisionGames].map(g=>g.id)).size!==games.length+crossDivisionGames.length)throw Error("CBB training division receipts overlap or duplicate");
  const receipt:Receipt={release:CBB_CURRENT_TRAINING_RELEASE,season:args.season,updatedAt:args.now,games,crossDivisionGames};
  if(added.length||addedCross.length){
    const {error}=await db.from("lab_response_snapshots").upsert({snapshot_key:key(args.season),kind:"daily_edge",sport:"cbb",
      slate_date:null,payload:receipt,payload_version:CBB_CURRENT_TRAINING_RELEASE,source:"cbb_prediction_pipeline",
      generated_at:args.now,updated_at:args.now,expires_at:new Date(now+366*86_400_000).toISOString(),
      stale_until:new Date(now+366*86_400_000).toISOString()},{onConflict:"snapshot_key"});
    if(error)throw new Error(`CBB training write failed: ${error.message}`);
  }
  return {receipt,added:added.length,addedCross:addedCross.length,pending:pending.length,rejected:built.rejected,crossRejected:crossBuilt.rejected,providerCalls:provider.calls};
}
