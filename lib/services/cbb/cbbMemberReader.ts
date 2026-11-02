import type { supabase } from "@/lib/db/supabase";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { cbbOfficialGameResultFromScores } from "./adaptCbbProvisionalToDailyEdge";
import { readCbbMemberGames } from "./cbbMemberGameStore";

type MemberLockIndex = {snapshot_key:string;storeRelease:string;gameId:string;startsAt:string;
  lockedAt:string|null;memberId:string;memberExternalId:string;memberStart:string;memberLock:string|null};

/** Verify every indexed identity/lock, downloading full evidence only for locks.
 * An unopened board must not repeatedly transfer every game's chart history. */
async function readLockIndex(board:DailyEdgeResponse,client:typeof supabase):Promise<Map<number,MemberLockIndex>>{
  const ids=board.games.map(game=>game.external_id),rows=new Map<number,MemberLockIndex>();
  for(let i=0;i<ids.length;i+=100){
    const {data,error}=await client.from("lab_response_snapshots").select(
      "snapshot_key,storeRelease:payload->>release,gameId:payload->snapshot->>gameId,startsAt:payload->snapshot->>startsAt,lockedAt:payload->snapshot->>lockedAt,memberId:payload->memberGame->>id,memberExternalId:payload->memberGame->>external_id,memberStart:payload->memberGame->>gameStartAt,memberLock:payload->memberGame->>lockedAt"
    ).in("snapshot_key",ids.slice(i,i+100).map(id=>`cbb::member-game::${id}`));
    if(error)throw new Error(`CBB member lock index read failed: ${error.message}`);
    for(const raw of data??[]){
      const row=raw as unknown as MemberLockIndex,id=Number(row.gameId);
      const game=board.games.find(game=>game.external_id===id);
      if(!game||rows.has(id)||row.snapshot_key!==`cbb::member-game::${id}`||
        !["cbb_member_game_store_2026_10_29_r1_single_leased_writer","cbb_member_game_store_2026_11_02_r2_preserved_market_evidence"].includes(row.storeRelease)||
        row.startsAt!==game.gameStartAt||row.memberStart!==row.startsAt||row.memberId!==game.id||
        Number(row.memberExternalId)!==id||row.memberLock!==row.lockedAt||
        row.lockedAt!==null&&(typeof row.lockedAt!=="string"||!Number.isFinite(Date.parse(row.lockedAt)))){
        throw new Error("CBB locked reader identity mismatch or corrupt lock index");
      }
      rows.set(id,row);
    }
  }
  if(ids.some(id=>!rows.has(id)))throw new Error("CBB board references a missing member game record");
  return rows;
}

/** The seven-day snapshot indexes the board, but each stored locked game is
 * still the public record. This overlay prevents an older cached board from
 * reinterpreting a lock when a later publication fails. */
export async function overlayCbbLockedMemberGames(board:DailyEdgeResponse,db?:typeof supabase):Promise<DailyEdgeResponse>{
  if(board.sport!=="cbb")throw new Error("CBB reader received a foreign sport");
  const client=db??(await import("@/lib/db/supabase")).supabase;
  const ids=board.games.map(game=>game.external_id);
  if(ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length)throw new Error("CBB board has ambiguous game IDs");
  const index=await readLockIndex(board,client);
  const lockedIds=ids.filter(id=>index.get(id)!.lockedAt!==null);
  const stored=await readCbbMemberGames(lockedIds,client);
  if(lockedIds.some(id=>!stored.has(id)))throw new Error("CBB board references a missing locked member game record");
  const finals=new Map<number,{status:string|null;home_score:number|null;away_score:number|null;game_date:string}>();
  for(let i=0;i<lockedIds.length;i+=100){
    const {data,error}=await client.from("games").select("external_id,status,home_score,away_score,game_date")
      .eq("sport","cbb").in("external_id",lockedIds.slice(i,i+100));
    if(error)throw new Error(`CBB official result read failed: ${error.message}`);
    for(const row of data??[]){
      if(finals.has(row.external_id))throw new Error("CBB official result duplicated");
      finals.set(row.external_id,row);
    }
  }
  const games=board.games.map(game=>{
    if(index.get(game.external_id)!.lockedAt===null)return game;
    const record=stored.get(game.external_id)!;
    if(record.snapshot.startsAt!==game.gameStartAt||record.memberGame.id!==game.id||
      record.snapshot.lockedAt!==index.get(game.external_id)!.lockedAt)throw new Error("CBB locked reader identity mismatch");
    const official=finals.get(game.external_id);
    if(!official||!Number.isFinite(Date.parse(official.game_date))||
      Date.parse(official.game_date)!==Date.parse(record.snapshot.startsAt))throw new Error("CBB locked result identity missing");
    return {...structuredClone(record.memberGame),result:cbbOfficialGameResultFromScores(record.snapshot,{
      status:official.status,statusState:official.status==="STATUS_FINAL"?"final":null,
      homeScore:official.home_score,awayScore:official.away_score})};
  });
  return {...board,games};
}
