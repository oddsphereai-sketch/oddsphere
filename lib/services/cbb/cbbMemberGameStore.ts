import type { supabase } from "@/lib/db/supabase";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import { advanceCbbProvisionalSnapshot, type CbbProvisionalBoard, type CbbProvisionalSnapshot } from "@/lib/cbb/provisionalLifecycle";
import type { CbbGame } from "@/lib/cbb/types";
import type { CbbQuote } from "@/lib/cbb/types";
import type { cbbCurrentSplitEvidence } from "@/lib/cbb/owlsSplitEvidence";
import { adaptCbbProvisionalGame, cbbOfficialGameResult } from "./adaptCbbProvisionalToDailyEdge";

export const CBB_MEMBER_GAME_STORE_RELEASE="cbb_member_game_store_2026_10_29_r1_single_leased_writer" as const;
export type CbbStoredMemberGame={release:typeof CBB_MEMBER_GAME_STORE_RELEASE;snapshot:CbbProvisionalSnapshot;memberGame:DailyEdgeGameDto};
const key=(id:number)=>`cbb::member-game::${id}`;
const valid=(value:unknown,id:number):value is CbbStoredMemberGame=>{
  if(!value||typeof value!=="object")return false;
  const row=value as Partial<CbbStoredMemberGame>;
  const markets=row.snapshot?.board?.rows;
  return row.release===CBB_MEMBER_GAME_STORE_RELEASE&&row.snapshot?.gameId===id&&row.memberGame?.external_id===id&&
    row.memberGame?.sport==="cbb"&&row.memberGame?.gameStartAt===row.snapshot.startsAt&&
    row.memberGame?.lockedAt===row.snapshot.lockedAt&&Array.isArray(markets)&&markets.length===3&&
    new Set(markets.map(market=>market.market)).size===3&&
    ["moneyline","spread","total"].every(kind=>markets.some(market=>market.market===kind))&&
    Number.isFinite(row.memberGame?.projected?.home)&&Number.isFinite(row.memberGame?.projected?.away)&&
    !!row.memberGame?.markets?.moneyline&&!!row.memberGame?.markets?.total&&!!row.memberGame?.markets?.first_inning;
};

/** Strict read: a database error must never look like an absent lock. */
export async function readCbbMemberGame(id:number,db?:typeof supabase):Promise<CbbStoredMemberGame|null>{
  if(!Number.isSafeInteger(id)||id<=0)throw new Error("Invalid CBB member game ID");
  const client=db??(await import("@/lib/db/supabase")).supabase;
  const {data,error}=await client.from("lab_response_snapshots").select("payload").eq("snapshot_key",key(id)).maybeSingle();
  if(error)throw new Error(`CBB member game read failed: ${error.message}`);
  if(!data)return null;
  if(!valid(data.payload,id))throw new Error(`CBB member game ${id} stored payload corrupt or legacy; owner correction required`);
  return data.payload;
}

/** Bounded presence scan keeps a large seven-day schedule from becoming one
 * database round trip per unpriced, schedule-only matchup. */
export async function readCbbMemberGames(ids:number[],db?:typeof supabase):Promise<Map<number,CbbStoredMemberGame>>{
  const client=db??(await import("@/lib/db/supabase")).supabase;
  const unique=[...new Set(ids)];
  if(unique.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error("Invalid CBB member game ID batch");
  const records=new Map<number,CbbStoredMemberGame>();
  for(let i=0;i<unique.length;i+=100){
    const {data,error}=await client.from("lab_response_snapshots")
      .select("snapshot_key,payload").in("snapshot_key",unique.slice(i,i+100).map(key));
    if(error)throw new Error(`CBB member games read failed: ${error.message}`);
    for(const row of data??[]){
      const id=Number(String(row.snapshot_key).split("::").at(-1));
      if(!unique.includes(id)||records.has(id)||!valid(row.payload,id))throw new Error("CBB member game batch corrupt or duplicated");
      records.set(id,row.payload);
    }
  }
  return records;
}

/** The only CBB prediction writer. Caller must hold prediction_pipeline:cbb.
 * This function never calls a provider or regrades a locked public record. */
export async function writeCbbMemberGame(args:{game:CbbGame;candidate:CbbProvisionalBoard|null;
  homeLogo:string|null;awayLogo:string|null;now:string;splitEvidence?:ReturnType<typeof cbbCurrentSplitEvidence>|null;
  marketQuotes?:CbbQuote[]},db?:typeof supabase):Promise<{record:CbbStoredMemberGame;written:boolean}>{
  const client=db??(await import("@/lib/db/supabase")).supabase;
  const existing=await readCbbMemberGame(args.game.id,client);
  if(existing&&existing.snapshot.lockedAt!==null)return {record:existing,written:false};
  if(Date.parse(args.now)>=Date.parse(args.game.date)){
    throw new Error(`CBB ${args.game.id} missed pregame lock; never publish a post-start lock`);
  }
  const next=advanceCbbProvisionalSnapshot({existing:existing?.snapshot??null,candidate:args.candidate,
    startsAt:args.game.date,now:args.now});
  const memberGame=adaptCbbProvisionalGame({game:args.game,snapshot:next,
    homeLogo:args.homeLogo,awayLogo:args.awayLogo,now:args.now,splitEvidence:args.splitEvidence,marketQuotes:args.marketQuotes});
  const record:CbbStoredMemberGame={release:CBB_MEMBER_GAME_STORE_RELEASE,snapshot:next,memberGame};
  const now=Date.parse(args.now);
  if(!Number.isFinite(now))throw new Error("CBB writer clock invalid");
  const {error}=await client.from("lab_response_snapshots").upsert({snapshot_key:key(args.game.id),kind:"daily_edge",sport:"cbb",
    slate_date:null,payload:record,payload_version:CBB_MEMBER_GAME_STORE_RELEASE,source:"cbb_prediction_pipeline",
    generated_at:args.now,updated_at:args.now,expires_at:new Date(now+366*86_400_000).toISOString(),
    stale_until:new Date(now+366*86_400_000).toISOString()},{onConflict:"snapshot_key"});
  if(error)throw new Error(`CBB member game write failed: ${error.message}`);
  return {record,written:true};
}

/** Locked DTO first. Only official result fields may accrue afterward. */
export function cbbMemberGameForReader(record:CbbStoredMemberGame,latestGame:CbbGame):DailyEdgeGameDto{
  if(record.snapshot.gameId!==latestGame.id||record.snapshot.startsAt!==latestGame.date||
    record.memberGame.external_id!==latestGame.id)throw new Error("CBB reader identity changed after publication");
  if(record.snapshot.lockedAt!==null){
    if(record.memberGame.lockedAt!==record.snapshot.lockedAt)throw new Error("CBB locked DTO mismatch; preserve and request owner correction");
    return {...structuredClone(record.memberGame),result:cbbOfficialGameResult(latestGame,record.snapshot)};
  }
  return structuredClone(record.memberGame);
}
